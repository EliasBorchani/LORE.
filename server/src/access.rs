//! Who may read or change what (docs/prd-multi.md, sections 4 and 5). Every handler asks here. Anything a person
//! may not see answers 404, as if it did not exist; 403 is only for something they see but may not change.

use std::collections::BTreeSet;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{CurrentUser, Role};
use crate::error::AppError;

/// What a member may do in a group. Permissions, not fixed roles (owner's choice): « admin » holds all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    SeeCharacters,
    EditCharacters,
    EditContent,
    Invite,
    Moderator,
    Admin,
}

impl Permission {
    pub const ALL: [Permission; 6] = [
        Permission::SeeCharacters,
        Permission::EditCharacters,
        Permission::EditContent,
        Permission::Invite,
        Permission::Moderator,
        Permission::Admin,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Permission::SeeCharacters => "see_characters",
            Permission::EditCharacters => "edit_characters",
            Permission::EditContent => "edit_content",
            Permission::Invite => "invite",
            Permission::Moderator => "moderator",
            Permission::Admin => "admin",
        }
    }
}

impl FromStr for Permission {
    type Err = AppError;

    fn from_str(text: &str) -> Result<Self, AppError> {
        Permission::ALL
            .into_iter()
            .find(|p| p.as_str() == text)
            .ok_or_else(|| AppError::BadRequest(format!("{text}: unknown permission")))
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

pub type Permissions = BTreeSet<Permission>;

pub fn permission_texts(permissions: &Permissions) -> Vec<String> {
    permissions.iter().map(|p| p.as_str().to_owned()).collect()
}

pub fn parse_permissions(texts: &[String]) -> Result<Permissions, AppError> {
    texts.iter().map(|text| text.parse()).collect()
}

/// An account's place in a group it has not left.
#[derive(Debug, Clone)]
pub struct Membership {
    pub user: CurrentUser,
    pub group_id: String,
    pub rpg: String,
    pub group_archived: bool,
    pub permissions: Permissions,
}

impl Membership {
    pub fn has(&self, permission: Permission) -> bool {
        self.permissions.contains(&Permission::Admin) || self.permissions.contains(&permission)
    }

    pub fn is_admin(&self) -> bool {
        self.permissions.contains(&Permission::Admin)
    }

    /// Changes permissions and removes members (moderators and admins).
    pub fn manages_members(&self) -> bool {
        self.has(Permission::Moderator)
    }
}

pub fn group_not_found(group_id: &str) -> AppError {
    AppError::NotFound(format!("{group_id}: unknown group"))
}

/// The caller's membership, or 404 for a group they are not in (or left).
pub async fn membership(
    pool: &PgPool,
    user: CurrentUser,
    group_id: &str,
) -> Result<Membership, AppError> {
    let row: Option<(String, bool, Vec<String>)> = sqlx::query_as(
        "SELECT g.rpg, g.archived_at IS NOT NULL, m.permissions
         FROM lore_group g JOIN group_member m ON m.group_id = g.id
         WHERE g.id = $1 AND m.user_id = $2 AND m.left_at IS NULL",
    )
    .bind(group_id)
    .bind(user.id)
    .fetch_optional(pool)
    .await?;
    let (rpg, group_archived, permissions) = row.ok_or_else(|| group_not_found(group_id))?;
    Ok(Membership {
        user,
        group_id: group_id.to_owned(),
        rpg,
        group_archived,
        permissions: permissions.iter().filter_map(|p| p.parse().ok()).collect(),
    })
}

/// What decides who reaches a character.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CharacterMeta {
    pub owner_id: i64,
    pub group_id: Option<String>,
    pub archived: bool,
    pub group_archived: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterAccess {
    Read,
    Write,
}

pub fn character_not_found(id: Uuid) -> AppError {
    AppError::NotFound(format!("{id}: unknown character"))
}

/// The owner always reads and writes their character. In its group, « See characters » reads it and « Edit
/// characters » changes it, unless it is archived (a member who left: read-only for the others). Anyone else: 404.
/// An archived group is read-only for everyone; its owner can still move a character out.
pub async fn character(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
    wanted: CharacterAccess,
) -> Result<CharacterMeta, AppError> {
    let meta: CharacterMeta = sqlx::query_as(
        "SELECT c.owner_id, c.group_id, c.archived_at IS NOT NULL AS archived,
                coalesce(g.archived_at IS NOT NULL, false) AS group_archived
         FROM player_character c LEFT JOIN lore_group g ON g.id = c.group_id WHERE c.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| character_not_found(id))?;
    if meta.owner_id != user.id {
        other_members(pool, user, &meta, id, wanted).await?;
    }
    if wanted == CharacterAccess::Write && meta.group_archived {
        return Err(group_read_only());
    }
    Ok(meta)
}

pub fn group_read_only() -> AppError {
    AppError::Forbidden("this group is archived: read-only".into())
}

/// Someone else's character: the caller's permissions in its group decide (404 when they don't open it).
async fn other_members(
    pool: &PgPool,
    user: CurrentUser,
    meta: &CharacterMeta,
    id: Uuid,
    wanted: CharacterAccess,
) -> Result<(), AppError> {
    let Some(group_id) = &meta.group_id else {
        return Err(character_not_found(id));
    };
    let member = membership(pool, user, group_id)
        .await
        .map_err(|_| character_not_found(id))?;
    let reads = member.has(Permission::SeeCharacters) || member.has(Permission::EditCharacters);
    if !reads {
        return Err(character_not_found(id));
    }
    if wanted == CharacterAccess::Write && !member.has(Permission::EditCharacters) {
        return Err(AppError::Forbidden(
            "« Edit characters » is needed to change someone else's character".into(),
        ));
    }
    if wanted == CharacterAccess::Write && meta.archived {
        return Err(AppError::Forbidden(
            "an archived character is read-only for everyone but its owner".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RulesetAccess {
    Read,
    Edit,
    Own,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RulesetRow {
    pub id: i64,
    pub slug: String,
    pub rpg: String,
    pub owner_id: i64,
    pub name: String,
    pub visibility: String,
    pub archived: bool,
}

pub fn ruleset_not_found(slug: &str) -> AppError {
    AppError::NotFound(format!("{slug}: unknown ruleset"))
}

const SELECT_RULESET: &str = "SELECT id, slug, rpg, owner_id, name, visibility, archived_at IS NOT NULL AS archived FROM ruleset";

/// The owner, its editors, and members with « Edit content » of a group that uses it and whose admin is its owner
/// (« a group that owns the ruleset ») edit it. A public one is read by everyone, a private one by its editors and
/// the members of the groups that use it. Anyone else: 404.
pub async fn ruleset(
    pool: &PgPool,
    user: CurrentUser,
    slug: &str,
) -> Result<(RulesetRow, RulesetAccess), AppError> {
    let row: RulesetRow = sqlx::query_as(&format!("{SELECT_RULESET} WHERE slug = $1"))
        .bind(slug)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ruleset_not_found(slug))?;
    let access = ruleset_access(pool, user, &row).await?;
    access
        .map(|access| (row, access))
        .ok_or_else(|| ruleset_not_found(slug))
}

pub async fn ruleset_by_id(
    pool: &PgPool,
    user: CurrentUser,
    id: i64,
) -> Result<Option<(RulesetRow, Option<RulesetAccess>)>, AppError> {
    let Some(row): Option<RulesetRow> = sqlx::query_as(&format!("{SELECT_RULESET} WHERE id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?
    else {
        return Ok(None);
    };
    let access = ruleset_access(pool, user, &row).await?;
    Ok(Some((row, access)))
}

async fn ruleset_access(
    pool: &PgPool,
    user: CurrentUser,
    row: &RulesetRow,
) -> Result<Option<RulesetAccess>, AppError> {
    if row.owner_id == user.id {
        return Ok(Some(RulesetAccess::Own));
    }
    let (editor, through_group, used_by_my_group): (bool, bool, bool) = sqlx::query_as(
        "SELECT
            EXISTS (SELECT 1 FROM ruleset_editor WHERE ruleset_id = $1 AND user_id = $2),
            EXISTS (SELECT 1 FROM group_ruleset gr
                    JOIN group_member owner ON owner.group_id = gr.group_id AND owner.user_id = $3
                         AND owner.left_at IS NULL AND 'admin' = ANY(owner.permissions)
                    JOIN group_member me ON me.group_id = gr.group_id AND me.user_id = $2 AND me.left_at IS NULL
                         AND me.permissions && ARRAY['edit_content', 'admin']
                    JOIN lore_group g ON g.id = gr.group_id AND g.archived_at IS NULL
                    WHERE gr.ruleset_id = $1),
            EXISTS (SELECT 1 FROM group_ruleset gr
                    JOIN group_member me ON me.group_id = gr.group_id AND me.user_id = $2 AND me.left_at IS NULL
                    WHERE gr.ruleset_id = $1)",
    )
    .bind(row.id)
    .bind(user.id)
    .bind(row.owner_id)
    .fetch_one(pool)
    .await?;
    Ok(if editor || through_group {
        Some(RulesetAccess::Edit)
    } else if used_by_my_group || row.visibility == "public" {
        Some(RulesetAccess::Read)
    } else {
        None
    })
}

/// Official content: read by everyone, changed by the platform admin only.
pub fn edits_official(user: CurrentUser) -> Result<(), AppError> {
    if user.role == Role::Admin {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "only the platform admin edits official content".into(),
        ))
    }
}

/// A ruleset's content changes only while it is not archived, and only with « edit » access.
pub fn edits_ruleset(row: &RulesetRow, access: RulesetAccess) -> Result<(), AppError> {
    if access < RulesetAccess::Edit {
        return Err(AppError::Forbidden(format!(
            "{}: only its owner and editors change it",
            row.slug
        )));
    }
    if row.archived {
        return Err(AppError::Forbidden(format!(
            "{}: archived, read-only",
            row.slug
        )));
    }
    Ok(())
}
