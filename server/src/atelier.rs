//! The « Atelier » of a group (docs/prd-cms.md): the caller's private drafts, and what changed lately in the group's
//! rulesets. Members only; a draft is seen by its author alone (anyone else: 404).

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::access::{self, Membership};
use crate::auth::CurrentUser;
use crate::catalog::stack::Layers;
use crate::error::AppError;

const MAX_PAYLOAD_BYTES: usize = 256 * 1024;
const MAX_DRAFTS: i64 = 200;
const DEFAULT_CHANGES: i64 = 30;
const MAX_CHANGES: i64 = 100;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub id: Uuid,
    /// From the payload's entity, for the list; absent while not typed yet.
    pub r#type: Option<String>,
    pub name: Option<Value>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: Uuid,
    pub payload: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftBody {
    payload: Value,
}

fn draft_not_found(id: Uuid) -> AppError {
    AppError::NotFound(format!("{id}: unknown draft"))
}

fn checked(payload: &Value) -> Result<(), AppError> {
    if !payload.is_object() {
        return Err(AppError::BadRequest("payload: a JSON object".into()));
    }
    if payload.to_string().len() > MAX_PAYLOAD_BYTES {
        return Err(AppError::BadRequest(format!(
            "payload: at most {} KB",
            MAX_PAYLOAD_BYTES / 1024
        )));
    }
    Ok(())
}

/// A draft is written only in a live group: an archived one is read-only, but its drafts can still be deleted.
async fn writer(pool: &PgPool, user: CurrentUser, group_id: &str) -> Result<Membership, AppError> {
    let member = access::membership(pool, user, group_id).await?;
    if member.group_archived {
        return Err(access::group_read_only());
    }
    Ok(member)
}

pub async fn list_drafts(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
) -> Result<Json<Vec<DraftSummary>>, AppError> {
    access::membership(&pool, user, &group_id).await?;
    Ok(Json(
        sqlx::query_as(
            "SELECT id, payload -> 'entity' ->> 'type' AS type, payload -> 'entity' -> 'name' AS name, updated_at
             FROM entity_draft WHERE author_id = $1 AND group_id = $2 ORDER BY updated_at DESC, id",
        )
        .bind(user.id)
        .bind(&group_id)
        .fetch_all(&pool)
        .await?,
    ))
}

pub async fn create_draft(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Json(body): Json<DraftBody>,
) -> Result<(StatusCode, Json<Draft>), AppError> {
    writer(&pool, user, &group_id).await?;
    checked(&body.payload)?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM entity_draft WHERE author_id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await?;
    if count >= MAX_DRAFTS {
        return Err(AppError::Forbidden(format!(
            "at most {MAX_DRAFTS} drafts: publish or delete some first"
        )));
    }
    let draft = sqlx::query_as(
        "INSERT INTO entity_draft (id, author_id, group_id, payload) VALUES ($1, $2, $3, $4)
         RETURNING id, payload, created_at, updated_at",
    )
    .bind(Uuid::new_v4())
    .bind(user.id)
    .bind(&group_id)
    .bind(&body.payload)
    .fetch_one(&pool)
    .await?;
    Ok((StatusCode::CREATED, Json(draft)))
}

pub async fn get_draft(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, id)): Path<(String, Uuid)>,
) -> Result<Json<Draft>, AppError> {
    access::membership(&pool, user, &group_id).await?;
    sqlx::query_as(
        "SELECT id, payload, created_at, updated_at FROM entity_draft
         WHERE id = $1 AND author_id = $2 AND group_id = $3",
    )
    .bind(id)
    .bind(user.id)
    .bind(&group_id)
    .fetch_optional(&pool)
    .await?
    .map(Json)
    .ok_or_else(|| draft_not_found(id))
}

pub async fn update_draft(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, id)): Path<(String, Uuid)>,
    Json(body): Json<DraftBody>,
) -> Result<Json<Draft>, AppError> {
    writer(&pool, user, &group_id).await?;
    checked(&body.payload)?;
    sqlx::query_as(
        "UPDATE entity_draft SET payload = $4, updated_at = greatest(now(), updated_at + interval '1 microsecond')
         WHERE id = $1 AND author_id = $2 AND group_id = $3
         RETURNING id, payload, created_at, updated_at",
    )
    .bind(id)
    .bind(user.id)
    .bind(&group_id)
    .bind(&body.payload)
    .fetch_optional(&pool)
    .await?
    .map(Json)
    .ok_or_else(|| draft_not_found(id))
}

pub async fn delete_draft(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, id)): Path<(String, Uuid)>,
) -> Result<StatusCode, AppError> {
    access::membership(&pool, user, &group_id).await?;
    let deleted =
        sqlx::query("DELETE FROM entity_draft WHERE id = $1 AND author_id = $2 AND group_id = $3")
            .bind(id)
            .bind(user.id)
            .bind(&group_id)
            .execute(&pool)
            .await?
            .rows_affected();
    if deleted == 0 {
        return Err(draft_not_found(id));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangesQuery {
    limit: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    pub r#type: String,
    pub name: Option<Value>,
    pub version: i32,
    pub author: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub note: Option<String>,
    pub ruleset: String,
    /// A house rule: the official id the group sees it under.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overrides: Option<String>,
}

/// The latest saves in the group's rulesets, newest first.
pub async fn changes(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Query(query): Query<ChangesQuery>,
) -> Result<Json<Vec<Change>>, AppError> {
    access::membership(&pool, user, &group_id).await?;
    let layers = Layers::for_group(&pool, &group_id).await?;
    let limit = query.limit.unwrap_or(DEFAULT_CHANGES).clamp(1, MAX_CHANGES);
    Ok(Json(
        sqlx::query_as(
            "SELECT v.entity_id AS id, e.type, v.content -> 'name' AS name, v.version, v.author, v.created_at,
                    v.note, r.slug AS ruleset, e.overrides
             FROM entity_version v JOIN entity e ON e.id = v.entity_id JOIN ruleset r ON r.id = e.ruleset_id
             WHERE e.ruleset_id = ANY($1)
             ORDER BY v.created_at DESC, v.entity_id, v.version DESC LIMIT $2",
        )
        .bind(&layers.rulesets)
        .bind(limit)
        .fetch_all(&pool)
        .await?,
    ))
}
