//! Rulesets (docs/prd-multi.md, section 5): homebrew for one RPG, owned by an account, changed by its editors, used
//! by groups. Their entities' ids start with the slug (`eberron:feat.dragon_blood`).

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;

use crate::access::{self, RulesetAccess, RulesetRow};
use crate::auth::CurrentUser;
use crate::catalog::ids;
use crate::error::AppError;

const MAX_NAME: usize = 80;
const DEFAULT_PAGE: i64 = 50;
const MAX_PAGE: i64 = 200;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RulesetSummary {
    pub slug: String,
    pub name: String,
    pub rpg: String,
    pub visibility: String,
    pub archived: bool,
    /// `own` or `edit`.
    pub access: String,
}

/// The rulesets the caller owns or edits (as an editor, or through a group it owns).
pub async fn list(
    State(pool): State<PgPool>,
    user: CurrentUser,
) -> Result<Json<Vec<RulesetSummary>>, AppError> {
    let rows: Vec<RulesetRow> = sqlx::query_as(
        "SELECT r.id, r.slug, r.rpg, r.owner_id, r.name, r.visibility, r.archived_at IS NOT NULL AS archived
         FROM ruleset r
         WHERE r.owner_id = $1
            OR EXISTS (SELECT 1 FROM ruleset_editor e WHERE e.ruleset_id = r.id AND e.user_id = $1)
            OR EXISTS (SELECT 1 FROM group_ruleset gr JOIN group_member m ON m.group_id = gr.group_id
                       WHERE gr.ruleset_id = r.id AND m.user_id = $1 AND m.left_at IS NULL)
         ORDER BY lower(r.name), r.slug",
    )
    .bind(user.id)
    .fetch_all(&pool)
    .await?;
    let mut summaries = Vec::new();
    for row in rows {
        let Ok((row, access)) = access::ruleset(&pool, user, &row.slug).await else {
            continue;
        };
        if access < RulesetAccess::Edit {
            continue;
        }
        summaries.push(RulesetSummary {
            access: if access == RulesetAccess::Own {
                "own"
            } else {
                "edit"
            }
            .into(),
            slug: row.slug,
            name: row.name,
            rpg: row.rpg,
            visibility: row.visibility,
            archived: row.archived,
        });
    }
    Ok(Json(summaries))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewRuleset {
    slug: String,
    name: String,
    rpg: String,
    visibility: String,
}

fn checked_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(AppError::BadRequest(format!(
            "name: 1 to {MAX_NAME} characters"
        )));
    }
    Ok(name.to_owned())
}

fn checked_visibility(visibility: &str) -> Result<(), AppError> {
    if ["private", "public"].contains(&visibility) {
        Ok(())
    } else {
        Err(AppError::BadRequest("visibility: private or public".into()))
    }
}

pub async fn create(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Json(body): Json<NewRuleset>,
) -> Result<(StatusCode, Json<RulesetDetail>), AppError> {
    let name = checked_name(&body.name)?;
    checked_visibility(&body.visibility)?;
    if !ids::is_slug(&body.slug) {
        return Err(AppError::BadRequest(
            "slug: 3 to 31 lowercase letters, digits or '_', starting with a letter".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let (limit, count): (i32, i64) = sqlx::query_as(
        "SELECT u.max_rulesets, (SELECT count(*) FROM ruleset r WHERE r.owner_id = u.id AND r.archived_at IS NULL)
         FROM app_user u WHERE u.id = $1 FOR UPDATE",
    )
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= i64::from(limit) {
        return Err(AppError::Forbidden(format!(
            "at most {limit} rulesets: archive one first"
        )));
    }
    let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM rpg WHERE id = $1)")
        .bind(&body.rpg)
        .fetch_one(&mut *tx)
        .await?;
    if !known {
        return Err(AppError::BadRequest(format!(
            "rpg: {} is unknown",
            body.rpg
        )));
    }
    sqlx::query(
        "INSERT INTO ruleset (slug, rpg, owner_id, name, visibility) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&body.slug)
    .bind(&body.rpg)
    .bind(user.id)
    .bind(&name)
    .bind(&body.visibility)
    .execute(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::AlreadyExists(format!("{}: slug taken", body.slug))
        }
        _ => error.into(),
    })?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(detail(&pool, user, &body.slug).await?),
    ))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: i64,
    pub login: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesetDetail {
    pub slug: String,
    pub name: String,
    pub rpg: String,
    pub visibility: String,
    pub archived: bool,
    pub access: RulesetAccess,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// Owner and editors: logins are emails, so only people who edit the ruleset see them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<Person>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editors: Option<Vec<Person>>,
    pub entities: i64,
}

async fn detail(pool: &PgPool, user: CurrentUser, slug: &str) -> Result<RulesetDetail, AppError> {
    let (row, access) = access::ruleset(pool, user, slug).await?;
    let (created_at, entities): (OffsetDateTime, i64) = sqlx::query_as(
        "SELECT r.created_at, (SELECT count(*) FROM entity e WHERE e.ruleset_id = r.id) FROM ruleset r WHERE r.id = $1",
    )
    .bind(row.id)
    .fetch_one(pool)
    .await?;
    let (owner, editors) = if access >= RulesetAccess::Edit {
        let owner = sqlx::query_as("SELECT id, login FROM app_user WHERE id = $1")
            .bind(row.owner_id)
            .fetch_one(pool)
            .await?;
        let editors = sqlx::query_as(
            "SELECT u.id, u.login FROM ruleset_editor e JOIN app_user u ON u.id = e.user_id
             WHERE e.ruleset_id = $1 ORDER BY lower(u.login)",
        )
        .bind(row.id)
        .fetch_all(pool)
        .await?;
        (Some(owner), Some(editors))
    } else {
        (None, None)
    };
    Ok(RulesetDetail {
        slug: row.slug,
        name: row.name,
        rpg: row.rpg,
        visibility: row.visibility,
        archived: row.archived,
        access,
        created_at,
        owner,
        editors,
        entities,
    })
}

pub async fn get(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(slug): Path<String>,
) -> Result<Json<RulesetDetail>, AppError> {
    Ok(Json(detail(&pool, user, &slug).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RulesetChange {
    name: Option<String>,
    visibility: Option<String>,
    archived: Option<bool>,
}

/// Owner only. Nothing is ever deleted: archiving keeps it working, read-only, for the groups using it.
pub async fn update(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(slug): Path<String>,
    Json(body): Json<RulesetChange>,
) -> Result<Json<RulesetDetail>, AppError> {
    let (row, access) = access::ruleset(&pool, user, &slug).await?;
    if access != RulesetAccess::Own {
        return Err(AppError::Forbidden(format!(
            "{slug}: only its owner changes this"
        )));
    }
    if let Some(name) = &body.name {
        sqlx::query("UPDATE ruleset SET name = $2 WHERE id = $1")
            .bind(row.id)
            .bind(checked_name(name)?)
            .execute(&pool)
            .await?;
    }
    if let Some(visibility) = &body.visibility {
        checked_visibility(visibility)?;
        sqlx::query("UPDATE ruleset SET visibility = $2 WHERE id = $1")
            .bind(row.id)
            .bind(visibility)
            .execute(&pool)
            .await?;
    }
    if let Some(archived) = body.archived {
        sqlx::query(
            "UPDATE ruleset SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now()) END WHERE id = $1",
        )
        .bind(row.id)
        .bind(archived)
        .execute(&pool)
        .await?;
    }
    Ok(Json(detail(&pool, user, &slug).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorsChange {
    /// Account ids. Each must share a group with the owner: logins are emails, so the owner picks among people they
    /// play with instead of typing addresses (which would tell whether an email has an account).
    editors: Vec<i64>,
}

pub async fn set_editors(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(slug): Path<String>,
    Json(body): Json<EditorsChange>,
) -> Result<Json<RulesetDetail>, AppError> {
    let (row, access) = access::ruleset(&pool, user, &slug).await?;
    if access != RulesetAccess::Own {
        return Err(AppError::Forbidden(format!(
            "{slug}: only its owner chooses its editors"
        )));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM ruleset_editor WHERE ruleset_id = $1")
        .bind(row.id)
        .execute(&mut *tx)
        .await?;
    for editor in &body.editors {
        let shares: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM group_member a JOIN group_member b ON b.group_id = a.group_id
                            WHERE a.user_id = $1 AND b.user_id = $2 AND a.left_at IS NULL AND b.left_at IS NULL)",
        )
        .bind(user.id)
        .bind(editor)
        .fetch_one(&mut *tx)
        .await?;
        if !shares || *editor == user.id {
            return Err(AppError::BadRequest(format!(
                "editors: {editor} is not someone you play with"
            )));
        }
        sqlx::query("INSERT INTO ruleset_editor (ruleset_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(row.id)
            .bind(editor)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(detail(&pool, user, &slug).await?))
}

#[derive(Deserialize)]
pub struct EntitiesQuery {
    r#type: Option<String>,
    after: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RulesetEntity {
    id: String,
    r#type: String,
    name: Option<Value>,
    labels: Option<Value>,
    /// The official entity it replaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    overrides: Option<String>,
    version: i32,
}

#[derive(Serialize)]
pub struct EntitiesPage {
    items: Vec<RulesetEntity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next: Option<String>,
}

/// The ruleset's own entities, paged by id.
pub async fn entities(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(slug): Path<String>,
    Query(query): Query<EntitiesQuery>,
) -> Result<Json<EntitiesPage>, AppError> {
    let (row, _) = access::ruleset(&pool, user, &slug).await?;
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let mut items: Vec<RulesetEntity> = sqlx::query_as(
        "SELECT e.id, e.type, v.content -> 'name' AS name, v.content -> 'labels' AS labels, e.overrides,
                e.current_version AS version
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.ruleset_id = $1 AND ($2::text IS NULL OR e.type = $2) AND ($3::text IS NULL OR e.id > $3)
         ORDER BY e.id LIMIT $4",
    )
    .bind(row.id)
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
    Ok(Json(EntitiesPage { items, next }))
}
