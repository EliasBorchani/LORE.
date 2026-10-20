//! Groups (docs/prd-multi.md, section 4): a table of players with one RPG, its rulesets in order, and members with
//! permissions. Every route needs the caller to be a member; anyone else gets 404.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;

use crate::access::{self, Membership, Permission, Permissions, permission_texts};
use crate::auth::CurrentUser;
use crate::auth::invitations;
use crate::catalog::stack::{Conflict, Layers};
use crate::error::AppError;
use crate::state::{AppState, Mailer};

const ID_LENGTH: usize = 10;
const ID_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_NAME: usize = 80;
/// What a person invited by a member without « Moderator » gets.
const DEFAULT_PERMISSIONS: [Permission; 1] = [Permission::SeeCharacters];

/// A short random id for addresses (`/g/k3x9q2ab7d`): says nothing about how many groups exist.
pub fn new_id() -> String {
    let mut bytes = [0u8; ID_LENGTH];
    getrandom::fill(&mut bytes).expect("the system random source is available");
    bytes
        .iter()
        .map(|b| ID_ALPHABET[*b as usize % ID_ALPHABET.len()] as char)
        .collect()
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

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub id: String,
    pub name: String,
    pub rpg: String,
    pub archived: bool,
    pub permissions: Vec<String>,
}

/// The groups the caller is in, archived ones last.
pub async fn list(
    State(pool): State<PgPool>,
    user: CurrentUser,
) -> Result<Json<Vec<GroupSummary>>, AppError> {
    Ok(Json(
        sqlx::query_as(
            "SELECT g.id, g.name, g.rpg, g.archived_at IS NOT NULL AS archived, m.permissions
             FROM lore_group g JOIN group_member m ON m.group_id = g.id
             WHERE m.user_id = $1 AND m.left_at IS NULL
             ORDER BY g.archived_at IS NOT NULL, lower(g.name), g.id",
        )
        .bind(user.id)
        .fetch_all(&pool)
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewGroup {
    name: String,
    rpg: String,
}

pub async fn create(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Json(body): Json<NewGroup>,
) -> Result<(StatusCode, Json<GroupDetail>), AppError> {
    let name = checked_name(&body.name)?;
    let mut tx = pool.begin().await?;
    let (limit, count): (i32, i64) = sqlx::query_as(
        "SELECT u.max_groups, (SELECT count(*) FROM group_member m JOIN lore_group g ON g.id = m.group_id
                               WHERE m.user_id = u.id AND m.left_at IS NULL AND g.archived_at IS NULL
                                 AND 'admin' = ANY(m.permissions))
         FROM app_user u WHERE u.id = $1 FOR UPDATE",
    )
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= i64::from(limit) {
        return Err(AppError::Forbidden(format!(
            "at most {limit} groups as admin: archive one first"
        )));
    }
    let id = insert_group(&mut tx, &name, &body.rpg).await?;
    add_member(&mut tx, &id, user.id, &[Permission::Admin].into()).await?;
    tx.commit().await?;
    let member = access::membership(&pool, user, &id).await?;
    Ok((StatusCode::CREATED, Json(detail(&pool, &member).await?)))
}

pub async fn insert_group(
    conn: &mut PgConnection,
    name: &str,
    rpg: &str,
) -> Result<String, AppError> {
    let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM rpg WHERE id = $1)")
        .bind(rpg)
        .fetch_one(&mut *conn)
        .await?;
    if !known {
        return Err(AppError::BadRequest(format!("rpg: {rpg} is unknown")));
    }
    let id = new_id();
    sqlx::query("INSERT INTO lore_group (id, rpg, name) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(rpg)
        .bind(name)
        .execute(&mut *conn)
        .await?;
    Ok(id)
}

/// Adds the account, or brings back a member who had left, with these permissions.
pub async fn add_member(
    conn: &mut PgConnection,
    group_id: &str,
    user_id: i64,
    permissions: &Permissions,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO group_member (group_id, user_id, permissions) VALUES ($1, $2, $3)
         ON CONFLICT (group_id, user_id) DO UPDATE
         SET permissions = CASE WHEN group_member.left_at IS NULL THEN group_member.permissions ELSE $3 END,
             left_at = NULL,
             joined_at = CASE WHEN group_member.left_at IS NULL THEN group_member.joined_at ELSE now() END",
    )
    .bind(group_id)
    .bind(user_id)
    .bind(permission_texts(permissions))
    .execute(conn)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GroupRuleset {
    pub slug: String,
    pub name: String,
    pub visibility: String,
    pub archived: bool,
    /// The caller may change its content.
    #[sqlx(skip)]
    pub editable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetail {
    pub id: String,
    pub name: String,
    pub rpg: String,
    pub archived: bool,
    /// The caller's permissions.
    pub permissions: Vec<String>,
    /// In order: the last one wins when two override the same entity.
    pub rulesets: Vec<GroupRuleset>,
    pub conflicts: Vec<Conflict>,
}

async fn detail(pool: &PgPool, member: &Membership) -> Result<GroupDetail, AppError> {
    let (name, rpg): (String, String) =
        sqlx::query_as("SELECT name, rpg FROM lore_group WHERE id = $1")
            .bind(&member.group_id)
            .fetch_one(pool)
            .await?;
    let mut rulesets: Vec<GroupRuleset> = sqlx::query_as(
        "SELECT r.slug, r.name, r.visibility, r.archived_at IS NOT NULL AS archived
         FROM group_ruleset gr JOIN ruleset r ON r.id = gr.ruleset_id
         WHERE gr.group_id = $1 ORDER BY gr.position, r.id",
    )
    .bind(&member.group_id)
    .fetch_all(pool)
    .await?;
    for ruleset in &mut rulesets {
        ruleset.editable = match access::ruleset(pool, member.user, &ruleset.slug).await {
            Ok((row, access)) => access::edits_ruleset(&row, access).is_ok(),
            Err(_) => false,
        };
    }
    let layers = Layers::for_group(pool, &member.group_id).await?;
    Ok(GroupDetail {
        id: member.group_id.clone(),
        name,
        rpg,
        archived: member.group_archived,
        permissions: permission_texts(&member.permissions),
        rulesets,
        conflicts: layers.conflicts,
    })
}

pub async fn get(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
) -> Result<Json<GroupDetail>, AppError> {
    let member = access::membership(&pool, user, &group_id).await?;
    Ok(Json(detail(&pool, &member).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupChange {
    name: Option<String>,
    archived: Option<bool>,
}

/// Admins only: the name, and archiving (the group stays readable, characters included).
pub async fn update(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Json(body): Json<GroupChange>,
) -> Result<Json<GroupDetail>, AppError> {
    let member = access::membership(&pool, user, &group_id).await?;
    require_admin(&member)?;
    if let Some(name) = &body.name {
        sqlx::query("UPDATE lore_group SET name = $2 WHERE id = $1")
            .bind(&group_id)
            .bind(checked_name(name)?)
            .execute(&pool)
            .await?;
    }
    if let Some(archived) = body.archived {
        sqlx::query(
            "UPDATE lore_group SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now()) END WHERE id = $1",
        )
        .bind(&group_id)
        .bind(archived)
        .execute(&pool)
        .await?;
    }
    let member = access::membership(&pool, user, &group_id).await?;
    Ok(Json(detail(&pool, &member).await?))
}

fn require_admin(member: &Membership) -> Result<(), AppError> {
    if member.is_admin() {
        Ok(())
    } else {
        Err(AppError::Forbidden("only a group admin does this".into()))
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub user_id: i64,
    pub login: String,
    pub permissions: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
}

/// Current members, for every member: the group is a table of people who know each other.
pub async fn members(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
) -> Result<Json<Vec<Member>>, AppError> {
    access::membership(&pool, user, &group_id).await?;
    Ok(Json(
        sqlx::query_as(
            "SELECT m.user_id, u.login, m.permissions, m.joined_at
             FROM group_member m JOIN app_user u ON u.id = m.user_id
             WHERE m.group_id = $1 AND m.left_at IS NULL ORDER BY lower(u.login)",
        )
        .bind(&group_id)
        .fetch_all(&pool)
        .await?,
    ))
}

async fn target_permissions(
    conn: &mut PgConnection,
    group_id: &str,
    user_id: i64,
) -> Result<Permissions, AppError> {
    let texts: Vec<String> = sqlx::query_scalar(
        "SELECT permissions FROM group_member WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL FOR UPDATE",
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("{user_id}: not a member of this group")))?;
    Ok(texts.iter().filter_map(|p| p.parse().ok()).collect())
}

/// A group keeps at least one admin: the last one can't lose « admin » or leave before naming another.
async fn other_admins(
    conn: &mut PgConnection,
    group_id: &str,
    user_id: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT count(*) FROM group_member
         WHERE group_id = $1 AND user_id <> $2 AND left_at IS NULL AND 'admin' = ANY(permissions)",
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(conn)
    .await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PermissionsChange {
    permissions: Vec<String>,
}

/// Moderators and admins change permissions. A moderator can't touch an admin nor make one.
pub async fn set_permissions(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, user_id)): Path<(String, i64)>,
    Json(body): Json<PermissionsChange>,
) -> Result<Json<Vec<String>>, AppError> {
    let member = access::membership(&pool, user, &group_id).await?;
    if !member.manages_members() {
        return Err(AppError::Forbidden(
            "« Moderator » is needed to change permissions".into(),
        ));
    }
    let wanted = access::parse_permissions(&body.permissions)?;
    let mut tx = pool.begin().await?;
    let current = target_permissions(&mut tx, &group_id, user_id).await?;
    let touches_admin = current.contains(&Permission::Admin) || wanted.contains(&Permission::Admin);
    if touches_admin && !member.is_admin() {
        return Err(AppError::Forbidden(
            "only an admin names or changes an admin".into(),
        ));
    }
    if current.contains(&Permission::Admin)
        && !wanted.contains(&Permission::Admin)
        && other_admins(&mut tx, &group_id, user_id).await? == 0
    {
        return Err(AppError::BadRequest(
            "a group keeps at least one admin: name another one first".into(),
        ));
    }
    sqlx::query("UPDATE group_member SET permissions = $3 WHERE group_id = $1 AND user_id = $2")
        .bind(&group_id)
        .bind(user_id)
        .bind(permission_texts(&wanted))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(permission_texts(&wanted)))
}

/// Moderators and admins remove members (not an admin, unless the caller is one). Their characters stay in the
/// group, archived; they still own them.
pub async fn remove_member(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path((group_id, user_id)): Path<(String, i64)>,
) -> Result<StatusCode, AppError> {
    let member = access::membership(&pool, user, &group_id).await?;
    if !member.manages_members() {
        return Err(AppError::Forbidden(
            "« Moderator » is needed to remove a member".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let current = target_permissions(&mut tx, &group_id, user_id).await?;
    if current.contains(&Permission::Admin) {
        if !member.is_admin() {
            return Err(AppError::Forbidden("only an admin removes an admin".into()));
        }
        if other_admins(&mut tx, &group_id, user_id).await? == 0 {
            return Err(AppError::BadRequest(
                "a group keeps at least one admin".into(),
            ));
        }
    }
    leave_group(&mut tx, &group_id, user_id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn leave(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
) -> Result<StatusCode, AppError> {
    access::membership(&pool, user, &group_id).await?;
    let mut tx = pool.begin().await?;
    let current = target_permissions(&mut tx, &group_id, user.id).await?;
    if current.contains(&Permission::Admin) && other_admins(&mut tx, &group_id, user.id).await? == 0
    {
        return Err(AppError::BadRequest(
            "you are the last admin: name another one before leaving".into(),
        ));
    }
    leave_group(&mut tx, &group_id, user.id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn leave_group(
    conn: &mut PgConnection,
    group_id: &str,
    user_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE group_member SET left_at = now() WHERE group_id = $1 AND user_id = $2")
        .bind(group_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE player_character
         SET archived_at = coalesce(archived_at, now()), updated_at = greatest(now(), updated_at + interval '1 microsecond')
         WHERE group_id = $1 AND owner_id = $2 AND archived_at IS NULL",
    )
    .bind(group_id)
    .bind(user_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RulesetsChange {
    /// Slugs, in order.
    rulesets: Vec<String>,
}

/// Admins only. A ruleset already in the group may stay; a new one must be of the group's RPG, not archived, and
/// public or edited by the caller (owner or editor).
pub async fn set_rulesets(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Json(body): Json<RulesetsChange>,
) -> Result<Json<GroupDetail>, AppError> {
    let member = access::membership(&pool, user, &group_id).await?;
    require_admin(&member)?;
    let current: Vec<i64> =
        sqlx::query_scalar("SELECT ruleset_id FROM group_ruleset WHERE group_id = $1")
            .bind(&group_id)
            .fetch_all(&pool)
            .await?;
    let mut ids = Vec::new();
    for slug in &body.rulesets {
        let (row, access) = access::ruleset(&pool, user, slug).await?;
        if ids.contains(&row.id) {
            return Err(AppError::BadRequest(format!("{slug}: twice")));
        }
        if !current.contains(&row.id) {
            if row.rpg != member.rpg {
                return Err(AppError::BadRequest(format!(
                    "{slug}: made for {}, not {}",
                    row.rpg, member.rpg
                )));
            }
            if row.archived {
                return Err(AppError::BadRequest(format!("{slug}: archived")));
            }
            let editor = access >= access::RulesetAccess::Edit;
            if row.visibility != "public" && !editor {
                return Err(AppError::Forbidden(format!(
                    "{slug}: private, only its owner or an editor adds it to a group"
                )));
            }
        }
        ids.push(row.id);
    }
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM group_ruleset WHERE group_id = $1")
        .bind(&group_id)
        .execute(&mut *tx)
        .await?;
    for (position, id) in ids.iter().enumerate() {
        sqlx::query(
            "INSERT INTO group_ruleset (group_id, ruleset_id, position) VALUES ($1, $2, $3)",
        )
        .bind(&group_id)
        .bind(id)
        .bind(position as i32)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(detail(&pool, &member).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InviteRequest {
    email: String,
    /// Only a moderator or an admin chooses; otherwise « See characters ».
    #[serde(default)]
    permissions: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteReply {
    pub email: String,
    pub sent: bool,
    /// Only when the mail could not be sent, so the inviter passes it on another way.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

/// « Invite » is needed; the inviter's pending invitations are capped. The link creates the account, or adds an
/// existing one to the group once its owner logs in.
pub async fn invite(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(group_id): Path<String>,
    Json(body): Json<InviteRequest>,
) -> Result<(StatusCode, Json<InviteReply>), AppError> {
    let pool = &state.pool;
    let member = access::membership(pool, user, &group_id).await?;
    if !member.has(Permission::Invite) {
        return Err(AppError::Forbidden(
            "« Invite » is needed to invite someone".into(),
        ));
    }
    let permissions = match &body.permissions {
        Some(texts) => {
            let wanted = access::parse_permissions(texts)?;
            if !member.manages_members() {
                return Err(AppError::Forbidden(
                    "« Moderator » is needed to choose permissions".into(),
                ));
            }
            if wanted.contains(&Permission::Admin) && !member.is_admin() {
                return Err(AppError::Forbidden("only an admin names an admin".into()));
            }
            wanted
        }
        None => DEFAULT_PERMISSIONS.into(),
    };
    let (limit, pending): (i32, i64) = sqlx::query_as(
        "SELECT u.max_pending_invites, (SELECT count(*) FROM invitation i
                                        WHERE i.invited_by = u.id AND i.used_at IS NULL AND i.expires_at > now())
         FROM app_user u WHERE u.id = $1",
    )
    .bind(user.id)
    .fetch_one(pool)
    .await?;
    if pending >= i64::from(limit) {
        return Err(AppError::Forbidden(format!(
            "at most {limit} pending invitations: wait until some are used or expire"
        )));
    }
    let created =
        invitations::create_for_group(pool, &body.email, &group_id, &permissions, user.id).await?;
    let reply = send(&state.mailer, &created).await;
    Ok((StatusCode::CREATED, Json(reply)))
}

async fn send(
    mailer: &Option<std::sync::Arc<Mailer>>,
    created: &invitations::Created,
) -> InviteReply {
    let reply = |sent: bool, link: Option<String>| InviteReply {
        email: created.email.clone(),
        sent,
        link,
        expires_at: created.expires_at,
    };
    let Some(mailer) = mailer else {
        return reply(false, None);
    };
    let link = mailer.link(&created.token);
    match &mailer.smtp {
        Some(smtp) => {
            match crate::mail::send_invitation(smtp, &created.email, &link, created.expires_at)
                .await
            {
                Ok(()) => reply(true, None),
                Err(error) => {
                    tracing::warn!("invitation mail not sent: {error:#}");
                    reply(false, Some(link))
                }
            }
        }
        None => reply(false, Some(link)),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JoinRequest {
    token: String,
}

/// An existing account opens a group invitation sent to its email: it joins the group.
pub async fn join(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Json(body): Json<JoinRequest>,
) -> Result<Json<GroupSummary>, AppError> {
    let group_id = invitations::join(&pool, user, &body.token).await?;
    let summary = sqlx::query_as(
        "SELECT g.id, g.name, g.rpg, g.archived_at IS NOT NULL AS archived, m.permissions
         FROM lore_group g JOIN group_member m ON m.group_id = g.id WHERE g.id = $1 AND m.user_id = $2",
    )
    .bind(&group_id)
    .bind(user.id)
    .fetch_one(&pool)
    .await?;
    Ok(Json(summary))
}
