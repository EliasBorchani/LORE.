use axum::extract::{Path, Query, State};
use axum::middleware;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::PgPool;
use time::OffsetDateTime;

use crate::auth::CurrentUser;
use crate::auth::routes as auth;
use crate::catalog::closure::{self, Closure};
use crate::catalog::edit::{self, EntityUpdate, NewEntity, Saved};
use crate::characters::routes as characters;
use crate::error::AppError;
use crate::state::AppState;

const MAX_ROOTS: usize = 2_000;
const DEFAULT_PAGE: i64 = 50;
const MAX_PAGE: i64 = 200;

pub fn app(state: AppState) -> Router {
    // All content requires a logged-in user (PRD 5.6); only health and getting tokens are open.
    let protected = Router::new()
        .route("/auth/me", get(auth::me))
        .route("/catalog/core", get(core))
        .route("/catalog/closure", post(catalog_closure))
        .route("/catalog/spell-list/{class_id}", get(spell_list))
        .route("/entities", get(list_entities).post(create_entity))
        .route("/search", get(search))
        .route("/entities/{id}", get(entity).put(update_entity))
        .route("/entities/{id}/versions", get(versions))
        .route(
            "/characters",
            get(characters::list).post(characters::create),
        )
        .route(
            "/characters/{id}",
            get(characters::get).put(characters::update),
        )
        .route("/characters/{id}/play", put(characters::update_play))
        .route("/characters/{id}/archive", post(characters::archive))
        .route("/characters/{id}/restore", post(characters::restore))
        .route("/characters/{id}/duplicate", post(characters::duplicate))
        .route("/characters/{id}/versions", get(characters::versions))
        .route(
            "/characters/{id}/versions/{version}",
            get(characters::version),
        )
        .route("/characters/{id}/catalog", get(characters::catalog))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_user,
        ));
    Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(auth::login))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/logout", post(auth::logout))
        .merge(protected)
        .with_state(state)
}

async fn health(State(pool): State<PgPool>) -> Result<&'static str, AppError> {
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok("ok")
}

async fn core(State(pool): State<PgPool>) -> Result<Json<Map<String, Value>>, AppError> {
    Ok(Json(closure::sections(&pool).await?))
}

/// Either explicit roots, or a character (a draft not saved yet): its closure is then the one
/// `GET /characters/{id}/catalog` would give, every skill included.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClosureRequest {
    #[serde(default)]
    roots: Vec<String>,
    character: Option<Value>,
}

async fn catalog_closure(
    State(pool): State<PgPool>,
    Json(request): Json<ClosureRequest>,
) -> Result<Json<Closure>, AppError> {
    if request.roots.len() > MAX_ROOTS {
        return Err(AppError::BadRequest(format!("at most {MAX_ROOTS} roots")));
    }
    match request.character {
        Some(character) if request.roots.is_empty() => {
            Ok(Json(closure::closure_for(&pool, &character).await?))
        }
        Some(_) => Err(AppError::BadRequest("roots or character, not both".into())),
        None => Ok(Json(closure::closure(&pool, &request.roots).await?)),
    }
}

#[derive(Serialize, sqlx::FromRow)]
struct SpellListEntry {
    id: String,
    level: Option<i32>,
    name: Option<Value>,
}

/// The spells on a class's list with their level, for picking spells known (the closure leaves `on_spell_list` out).
async fn spell_list(
    State(pool): State<PgPool>,
    Path(class_id): Path<String>,
) -> Result<Json<Vec<SpellListEntry>>, AppError> {
    let spells: Vec<SpellListEntry> = sqlx::query_as(
        "SELECT r.from_id AS id, (r.extra ->> 'level')::int AS level, v.content -> 'name' AS name
         FROM entity_relation r
         JOIN entity e ON e.id = r.from_id
         JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE r.to_id = $1 AND r.relation = 'on_spell_list'
         ORDER BY level, r.from_id",
    )
    .bind(&class_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(spells))
}

#[derive(Deserialize)]
struct ListQuery {
    r#type: Option<String>,
    after: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct EntitySummary {
    id: String,
    r#type: String,
    name: Option<Value>,
    labels: Option<Value>,
}

#[derive(Serialize)]
struct Page {
    items: Vec<EntitySummary>,
    /// Pass as `after` to get the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    next: Option<String>,
}

async fn list_entities(
    State(pool): State<PgPool>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Page>, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let mut items: Vec<EntitySummary> = sqlx::query_as(
        "SELECT e.id, e.type, v.content -> 'name' AS name, v.content -> 'labels' AS labels
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE ($1::text IS NULL OR e.type = $1) AND ($2::text IS NULL OR e.id > $2)
         ORDER BY e.id LIMIT $3",
    )
    .bind(&query.r#type)
    .bind(&query.after)
    .bind(limit + 1)
    .fetch_all(&pool)
    .await?;
    let next = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|item| item.id.clone())
    } else {
        None
    };
    Ok(Json(Page { items, next }))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    r#type: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
}

#[derive(Serialize)]
struct SearchPage {
    items: Vec<EntitySummary>,
    /// Pass as `offset` to get the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    next: Option<i64>,
}

const MAX_SEARCH_WORDS: usize = 8;
const MAX_SEARCH_OFFSET: i64 = 10_000;

/// Entities whose names (any language) or id contain every word of `q`, accents and case ignored. Names that are the
/// query or start with it come first, then names with a word starting with it, then the rest, each by name.
async fn search(
    State(pool): State<PgPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchPage>, AppError> {
    // Ids are searched with `.` and `_` as spaces, so `feat.power_attack` finds Power Attack too.
    let words: Vec<String> = query
        .q
        .replace(['.', '_'], " ")
        .split_whitespace()
        .take(MAX_SEARCH_WORDS)
        .map(escape_like)
        .collect();
    if words.is_empty() {
        return Err(AppError::BadRequest("q: type at least one word".into()));
    }
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let offset = query.offset.unwrap_or(0).clamp(0, MAX_SEARCH_OFFSET);
    let phrase = words.join(" ");

    let mut sql = sqlx::QueryBuilder::new(
        "SELECT e.id, e.type, v.content -> 'name' AS name, v.content -> 'labels' AS labels
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE TRUE",
    );
    // One LIKE per word, so the words may come in any order; the trigram index serves each of them.
    for word in &words {
        sql.push(" AND lore_search_text(v.content) LIKE '%' || lore_fold(")
            .push_bind(word.clone())
            .push(") || '%'");
    }
    if let Some(r#type) = &query.r#type {
        sql.push(" AND e.type = ").push_bind(r#type.clone());
    }
    sql.push(" ORDER BY CASE WHEN lore_sort_name(v.content) LIKE lore_fold(")
        .push_bind(phrase.clone())
        .push(") || '%' THEN 0 WHEN lore_sort_name(v.content) LIKE '% ' || lore_fold(")
        .push_bind(phrase)
        .push(") || '%' THEN 1 ELSE 2 END, lore_sort_name(v.content), e.id LIMIT ")
        .push_bind(limit + 1)
        .push(" OFFSET ")
        .push_bind(offset);
    let mut items: Vec<EntitySummary> = sql.build_query_as().fetch_all(&pool).await?;
    let next = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        Some(offset + limit).filter(|next| *next <= MAX_SEARCH_OFFSET)
    } else {
        None
    };
    Ok(Json(SearchPage { items, next }))
}

/// `%` and `\` typed by the user are plain characters, not LIKE wildcards (`_` became a space before).
fn escape_like(word: &str) -> String {
    word.replace('\\', "\\\\").replace('%', "\\%")
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct EntityDetail {
    id: String,
    r#type: String,
    version: i32,
    content: Value,
    /// The entity a team copy started from.
    #[serde(skip_serializing_if = "Option::is_none")]
    variant_of: Option<String>,
    /// Its outgoing relations (spell lists with their level, class skills…), each with the target's name.
    relations: Value,
}

async fn create_entity(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Json(request): Json<NewEntity>,
) -> Result<Json<Saved>, AppError> {
    Ok(Json(edit::create(&pool, user, request).await?))
}

async fn update_entity(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(request): Json<EntityUpdate>,
) -> Result<Json<Saved>, AppError> {
    Ok(Json(edit::update(&pool, user, &id, request).await?))
}

async fn entity(
    State(pool): State<PgPool>,
    Path(id): Path<String>,
) -> Result<Json<EntityDetail>, AppError> {
    sqlx::query_as(
        "SELECT e.id, e.type, e.current_version AS version, v.content,
                (SELECT r.to_id FROM entity_relation r WHERE r.from_id = e.id AND r.relation = $2 LIMIT 1) AS variant_of,
                (SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'relation', r.relation, 'to', r.to_id, 'extra', r.extra, 'name', tv.content -> 'name')
                            ORDER BY r.relation, r.to_id), '[]')
                 FROM entity_relation r
                 LEFT JOIN entity t ON t.id = r.to_id
                 LEFT JOIN entity_version tv ON tv.entity_id = t.id AND tv.version = t.current_version
                 WHERE r.from_id = e.id) AS relations
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.id = $1",
    )
    .bind(&id)
    .bind(edit::VARIANT_OF)
    .fetch_optional(&pool)
    .await?
    .map(Json)
    .ok_or_else(|| AppError::NotFound(format!("{id}: unknown entity")))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct VersionSummary {
    version: i32,
    author: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    note: Option<String>,
    /// The relations edited in the app as they were at this version (a spell's levels); absent for imports.
    #[serde(skip_serializing_if = "Option::is_none")]
    relations: Option<Value>,
}

async fn versions(
    State(pool): State<PgPool>,
    Path(id): Path<String>,
) -> Result<Json<Vec<VersionSummary>>, AppError> {
    let versions: Vec<VersionSummary> = sqlx::query_as(
        "SELECT version, author, created_at, note, relations FROM entity_version WHERE entity_id = $1 ORDER BY version DESC",
    )
    .bind(&id)
    .fetch_all(&pool)
    .await?;
    if versions.is_empty() {
        return Err(AppError::NotFound(format!("{id}: unknown entity")));
    }
    Ok(Json(versions))
}
