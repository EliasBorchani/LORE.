use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{CharacterRecord, CharacterSummary, ListFilter, VersionSummary};
use crate::auth::CurrentUser;
use crate::catalog::closure::{Closure, closure_for};
use crate::error::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    #[serde(default, with = "time::serde::rfc3339::option")]
    updated_since: Option<OffsetDateTime>,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    all: bool,
}

pub async fn list(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<CharacterSummary>>, AppError> {
    let filter = ListFilter {
        updated_since: query.updated_since,
        include_archived: query.archived,
        all: query.all,
    };
    Ok(Json(super::list(&pool, user, &filter).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    character: Value,
}

pub async fn create(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Json(body): Json<CreateRequest>,
) -> Result<(StatusCode, Json<CharacterRecord>), AppError> {
    Ok((
        StatusCode::CREATED,
        Json(super::create(&pool, user, body.character).await?),
    ))
}

pub async fn get(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<CharacterRecord>, AppError> {
    Ok(Json(super::read(&pool, user, id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdateRequest {
    /// The `updatedAt` of the copy this change was made on.
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    character: Value,
}

pub async fn update(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRequest>,
) -> Result<Json<CharacterRecord>, AppError> {
    Ok(Json(
        super::update(&pool, user, id, body.updated_at, body.character).await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayRequest {
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    state: Value,
}

pub async fn update_play(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(body): Json<PlayRequest>,
) -> Result<Json<CharacterRecord>, AppError> {
    Ok(Json(
        super::update_play(&pool, user, id, body.updated_at, body.state).await?,
    ))
}

pub async fn archive(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<CharacterRecord>, AppError> {
    Ok(Json(super::set_archived(&pool, user, id, true).await?))
}

pub async fn restore(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<CharacterRecord>, AppError> {
    Ok(Json(super::set_archived(&pool, user, id, false).await?))
}

pub async fn duplicate(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<CharacterRecord>), AppError> {
    Ok((
        StatusCode::CREATED,
        Json(super::duplicate(&pool, user, id).await?),
    ))
}

pub async fn versions(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<VersionSummary>>, AppError> {
    Ok(Json(super::versions(&pool, user, id).await?))
}

pub async fn version(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((id, version)): Path<(Uuid, i32)>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(super::version(&pool, user, id, version).await?))
}

/// The part of the catalog this character needs, for the engine on the client.
pub async fn catalog(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Closure>, AppError> {
    let character = super::read(&pool, user, id).await?.character;
    Ok(Json(closure_for(&pool, &character).await?))
}
