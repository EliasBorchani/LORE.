//! Catalog reads, always through a group (`/groups/{group}/…`): its RPG's official content, then its rulesets in
//! order, with house rules in place of the official entities they replace (`stack.rs`). Members only.

use std::collections::BTreeSet;

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::PgPool;
use time::OffsetDateTime;

use super::closure::{self, Closure};
use super::edit::VARIANT_OF;
use super::refs::collect_candidate_ids;
use super::search::{self, SearchPage, SearchQuery};
use super::stack::{Layers, bind_visible, bind_visible_scalar};
use crate::access;
use crate::auth::{CurrentUser, Role};
use crate::error::AppError;

const MAX_ROOTS: usize = 2_000;
const DEFAULT_PAGE: i64 = 50;
const MAX_PAGE: i64 = 200;

/// The caller is a member: the group's layers.
async fn layers(pool: &PgPool, user: CurrentUser, group_id: &str) -> Result<Layers, AppError> {
    access::membership(pool, user, group_id).await?;
    Ok(Layers::for_group(pool, group_id).await?)
}

pub async fn core(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
) -> Result<Json<Map<String, Value>>, AppError> {
    let member = access::membership(&pool, user, &group_id).await?;
    Ok(Json(closure::sections(&pool, &member.rpg).await?))
}

/// Either explicit roots, or a character (a draft not saved yet): its closure is then the one
/// `GET /characters/{id}/catalog` would give, every skill included.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClosureRequest {
    #[serde(default)]
    roots: Vec<String>,
    character: Option<Value>,
}

pub async fn catalog_closure(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Json(request): Json<ClosureRequest>,
) -> Result<Json<Closure>, AppError> {
    if request.roots.len() > MAX_ROOTS {
        return Err(AppError::BadRequest(format!("at most {MAX_ROOTS} roots")));
    }
    let layers = layers(&pool, user, &group_id).await?;
    match request.character {
        Some(character) if request.roots.is_empty() => Ok(Json(
            closure::closure_for(&pool, &layers, &character).await?,
        )),
        Some(_) => Err(AppError::BadRequest("roots or character, not both".into())),
        None => Ok(Json(
            closure::closure(&pool, &layers, &request.roots).await?,
        )),
    }
}

#[derive(Serialize, sqlx::FromRow)]
pub struct SpellListEntry {
    id: String,
    level: Option<i32>,
    name: Option<Value>,
}

/// The spells on a class's list with their level, for picking spells known (the closure leaves `on_spell_list` out).
pub async fn spell_list(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, class_id)): Path<(String, String)>,
) -> Result<Json<Vec<SpellListEntry>>, AppError> {
    let layers = layers(&pool, user, &group_id).await?;
    let targets = vec![class_id.clone(), layers.stored(&class_id).to_owned()];
    let mut spells: Vec<SpellListEntry> = bind_visible(
        sqlx::query_as(&format!(
            "SELECT r.from_id AS id, (r.extra ->> 'level')::int AS level, v.content -> 'name' AS name
             FROM entity_relation r
             JOIN entity e ON e.id = r.from_id
             JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
             WHERE r.to_id = ANY($1) AND r.relation = 'on_spell_list' AND {}",
            Layers::visible("e", 2)
        ))
        .bind(&targets),
        &layers,
    )
    .fetch_all(&pool)
    .await?;
    for spell in &mut spells {
        spell.id = layers.canonical(&spell.id).to_owned();
    }
    spells.sort_by(|a, b| (a.level, &a.id).cmp(&(b.level, &b.id)));
    spells.dedup_by(|a, b| a.id == b.id && a.level == b.level);
    Ok(Json(spells))
}

#[derive(Deserialize)]
pub struct ListQuery {
    r#type: Option<String>,
    after: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EntitySummary {
    id: String,
    r#type: String,
    name: Option<Value>,
    labels: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(skip)]
    house_rule: Option<super::stack::HouseRule>,
}

#[derive(Serialize)]
pub struct Page {
    items: Vec<EntitySummary>,
    /// Pass as `after` to get the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    next: Option<String>,
}

/// The group's entities, paged by the id the group knows them by (a house rule by its official id).
pub async fn list_entities(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Page>, AppError> {
    let layers = layers(&pool, user, &group_id).await?;
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let mut items: Vec<EntitySummary> = bind_visible(
        sqlx::query_as(&format!(
            "SELECT coalesce(e.overrides, e.id) AS id, e.type, v.content -> 'name' AS name,
                    v.content -> 'labels' AS labels
             FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
             WHERE ($1::text IS NULL OR e.type = $1) AND ($5::text IS NULL OR coalesce(e.overrides, e.id) > $5)
               AND {}
             ORDER BY coalesce(e.overrides, e.id) LIMIT $6",
            Layers::visible("e", 2)
        ))
        .bind(&query.r#type),
        &layers,
    )
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
    for item in &mut items {
        item.house_rule = layers.house_rule(&item.id).cloned();
    }
    Ok(Json(Page { items, next }))
}

pub async fn catalog_search(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchPage>, AppError> {
    let layers = layers(&pool, user, &group_id).await?;
    Ok(Json(search::search(&pool, &layers, query).await?))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetail {
    /// The stored id: a house rule's own id, the one to edit.
    id: String,
    r#type: String,
    version: i32,
    content: Value,
    /// The entity a team copy started from (before rulesets).
    #[serde(skip_serializing_if = "Option::is_none")]
    variant_of: Option<String>,
    /// The official entity this house rule replaces in the group.
    #[serde(skip_serializing_if = "Option::is_none")]
    overrides: Option<String>,
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    ruleset: Option<RulesetRef>,
    #[serde(skip)]
    ruleset_id: Option<i64>,
    /// Its outgoing relations (spell lists with their level, class skills…), each with the target's name.
    #[sqlx(skip)]
    relations: Value,
    /// The entities its content names (`has('feat.power_attack')`), so a client can show names instead of ids.
    #[sqlx(skip)]
    references: Vec<Reference>,
    /// The caller may change it (ruleset editor, or platform admin for official content).
    #[sqlx(skip)]
    editable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesetRef {
    slug: String,
    name: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Reference {
    id: String,
    r#type: String,
    name: Value,
}

/// The stored id behind an id the group uses, or 404 when the group does not see it.
async fn visible_id(pool: &PgPool, layers: &Layers, id: &str) -> Result<String, AppError> {
    let stored = layers.stored(layers.canonical(id)).to_owned();
    let found: Option<String> = bind_visible_scalar(
        sqlx::query_scalar(&format!(
            "SELECT e.id FROM entity e WHERE e.id = $1 AND {}",
            Layers::visible("e", 2)
        ))
        .bind(&stored),
        layers,
    )
    .fetch_optional(pool)
    .await?;
    found.ok_or_else(|| AppError::NotFound(format!("{id}: unknown entity")))
}

pub async fn entity(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, id)): Path<(String, String)>,
) -> Result<Json<EntityDetail>, AppError> {
    let layers = layers(&pool, user, &group_id).await?;
    let stored = visible_id(&pool, &layers, &id).await?;
    let mut detail: EntityDetail = sqlx::query_as(
        "SELECT e.id, e.type, e.current_version AS version, v.content, e.overrides, e.ruleset_id,
                (SELECT r.to_id FROM entity_relation r WHERE r.from_id = e.id AND r.relation = $2 LIMIT 1) AS variant_of
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.id = $1",
    )
    .bind(&stored)
    .bind(VARIANT_OF)
    .fetch_one(&pool)
    .await?;

    detail.editable = match detail.ruleset_id {
        Some(ruleset_id) => match access::ruleset_by_id(&pool, user, ruleset_id).await? {
            Some((row, access)) => {
                let editable =
                    access.is_some_and(|access| access::edits_ruleset(&row, access).is_ok());
                detail.ruleset = Some(RulesetRef {
                    slug: row.slug,
                    name: row.name,
                });
                editable
            }
            None => false,
        },
        None => user.role == Role::Admin,
    };

    let relations: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT relation, to_id, extra FROM entity_relation WHERE from_id = $1 ORDER BY relation, to_id",
    )
    .bind(&stored)
    .fetch_all(&pool)
    .await?;
    let targets: Vec<String> = relations
        .iter()
        .map(|(_, to, _)| layers.stored(layers.canonical(to)).to_owned())
        .collect();
    let target_names = names(&pool, &layers, &targets).await?;
    detail.relations = relations
        .into_iter()
        .map(|(relation, to, extra)| {
            let to = layers.canonical(&to).to_owned();
            let name = target_names
                .iter()
                .find(|reference| reference.id == to)
                .map_or(Value::Null, |reference| reference.name.clone());
            serde_json::json!({ "relation": relation, "to": to, "extra": extra, "name": name })
        })
        .collect();

    let mut ids = BTreeSet::new();
    collect_candidate_ids(&detail.content, &mut ids);
    let own = [stored.as_str(), layers.canonical(&stored)];
    let ids: Vec<String> = ids
        .iter()
        .map(|id| layers.stored(layers.canonical(id)).to_owned())
        .filter(|id| !own.contains(&id.as_str()))
        .collect();
    // Statistic keys (`ability.str`) look like ids too: the query keeps only real entities.
    detail.references = names(&pool, &layers, &ids).await?;
    Ok(Json(detail))
}

/// `{id, type, name}` of the entities the group sees among these stored ids, under the ids the group uses.
async fn names(pool: &PgPool, layers: &Layers, ids: &[String]) -> Result<Vec<Reference>, AppError> {
    let mut references: Vec<Reference> = bind_visible(
        sqlx::query_as(&format!(
            "SELECT e.id, e.type, coalesce(v.content -> 'name', 'null') AS name
             FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
             WHERE e.id = ANY($1) AND {}",
            Layers::visible("e", 2)
        ))
        .bind(ids),
        layers,
    )
    .fetch_all(pool)
    .await?;
    for reference in &mut references {
        reference.id = layers.canonical(&reference.id).to_owned();
    }
    references.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(references)
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    version: i32,
    author: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    note: Option<String>,
    /// The relations edited in the app as they were at this version (a spell's levels); absent for imports.
    #[serde(skip_serializing_if = "Option::is_none")]
    relations: Option<Value>,
}

pub async fn versions(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, id)): Path<(String, String)>,
) -> Result<Json<Vec<VersionSummary>>, AppError> {
    let layers = layers(&pool, user, &group_id).await?;
    let stored = visible_id(&pool, &layers, &id).await?;
    Ok(Json(
        sqlx::query_as(
            "SELECT version, author, created_at, note, relations FROM entity_version
             WHERE entity_id = $1 ORDER BY version DESC",
        )
        .bind(&stored)
        .fetch_all(&pool)
        .await?,
    ))
}

const STATE_USERS: usize = 3;

/// A state (`toggle.x`, switched on at the table) or a situation (`situation.x`) named by the group's content.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateUse {
    id: String,
    kind: &'static str,
    /// A few entities that name it, so the editor can say « Rage (Rage de berserker) ».
    used_by: Vec<Reference>,
    count: usize,
}

/// Every state and situation the group's content names, for the editor's « Quand… » picker.
pub async fn states(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
) -> Result<Json<Vec<StateUse>>, AppError> {
    let layers = layers(&pool, user, &group_id).await?;
    let rows: Vec<(String, String, String, Value)> = bind_visible(
        sqlx::query_as(&format!(
            "SELECT s, e.id, e.type, coalesce(v.content -> 'name', 'null')
             FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version,
                  unnest(v.facet_states) s
             WHERE v.facet_states <> '{{}}' AND {}
             ORDER BY s, e.id",
            Layers::visible("e", 1)
        )),
        &layers,
    )
    .fetch_all(&pool)
    .await?;
    let mut states: Vec<StateUse> = Vec::new();
    for (state, id, r#type, name) in rows {
        if states.last().is_none_or(|last| last.id != state) {
            let kind = if state.contains("situation.") {
                "situation"
            } else {
                "toggle"
            };
            states.push(StateUse {
                id: state,
                kind,
                used_by: Vec::new(),
                count: 0,
            });
        }
        let last = states.last_mut().expect("pushed above");
        last.count += 1;
        if last.used_by.len() < STATE_USERS {
            last.used_by.push(Reference {
                id: layers.canonical(&id).to_owned(),
                r#type,
                name,
            });
        }
    }
    Ok(Json(states))
}
