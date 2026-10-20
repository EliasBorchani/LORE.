//! Characters: build choices (the engine's character JSON, versioned) and play state, kept apart (Character model).
//!
//! Sync rule (owner, 2026-10-15): every write carries the `updatedAt` the client last pulled. If the server copy is
//! newer, the write is refused with the current record and the client takes it: the server wins.

pub mod routes;

use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::access::{self, CharacterAccess, Permission, character_not_found};
use crate::auth::CurrentUser;
use crate::error::AppError;

/// Strictly increasing, even for two writes in the same microsecond, so "newer" is always well defined.
const NEXT_UPDATED_AT: &str = "greatest(now(), updated_at + interval '1 microsecond')";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRecord {
    pub id: Uuid,
    pub owner_id: i64,
    /// Absent only for characters made before groups, until `server migrate-groups` runs.
    pub group_id: Option<String>,
    pub version: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub archived: bool,
    pub character: Value,
    pub play: PlayRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRecord {
    pub state: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(FromRow)]
struct CharacterRow {
    id: Uuid,
    owner_id: i64,
    group_id: Option<String>,
    version: i32,
    updated_at: OffsetDateTime,
    archived: bool,
    content: Value,
    play_state: Value,
    play_updated_at: OffsetDateTime,
}

impl From<CharacterRow> for CharacterRecord {
    fn from(row: CharacterRow) -> Self {
        CharacterRecord {
            id: row.id,
            owner_id: row.owner_id,
            group_id: row.group_id,
            version: row.version,
            updated_at: row.updated_at,
            archived: row.archived,
            character: row.content,
            play: PlayRecord {
                state: row.play_state,
                updated_at: row.play_updated_at,
            },
        }
    }
}

const SELECT_CHARACTER: &str = "
    SELECT c.id, c.owner_id, c.group_id, c.version, c.updated_at, c.archived_at IS NOT NULL AS archived, c.content,
           p.state AS play_state, p.updated_at AS play_updated_at
    FROM player_character c JOIN player_character_play p ON p.character_id = c.id";

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSummary {
    pub id: Uuid,
    pub owner_id: i64,
    pub group_id: Option<String>,
    pub name: String,
    /// Number of level-up records.
    pub level: i32,
    pub archived: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub play_updated_at: OffsetDateTime,
}

#[derive(Debug, Default)]
pub struct ListFilter {
    /// Sync delta: characters whose build choices or play state changed after this time, archived ones included.
    pub updated_since: Option<OffsetDateTime>,
    pub include_archived: bool,
    /// One group: the caller's characters there, and the others' with « See characters ». Without it, the
    /// caller's own characters in every group (a device's sync).
    pub group: Option<String>,
}

/// Who may read and write is decided in `access::character`; anyone else gets 404, so the character's existence
/// stays hidden.
pub async fn read(pool: &PgPool, user: CurrentUser, id: Uuid) -> Result<CharacterRecord, AppError> {
    access::character(pool, user, id, CharacterAccess::Read).await?;
    load(pool, id).await
}

async fn load(pool: &PgPool, id: Uuid) -> Result<CharacterRecord, AppError> {
    let row: Option<CharacterRow> = sqlx::query_as(&format!("{SELECT_CHARACTER} WHERE c.id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.map(CharacterRecord::from)
        .ok_or_else(|| character_not_found(id))
}

pub async fn list(
    pool: &PgPool,
    user: CurrentUser,
    filter: &ListFilter,
) -> Result<Vec<CharacterSummary>, AppError> {
    let others = match &filter.group {
        Some(group) => {
            let member = access::membership(pool, user, group).await?;
            member.has(Permission::SeeCharacters) || member.has(Permission::EditCharacters)
        }
        None => false,
    };
    let summaries = sqlx::query_as(
        "SELECT c.id, c.owner_id, c.group_id, c.name,
                CASE WHEN jsonb_typeof(c.content -> 'levels') = 'array'
                     THEN jsonb_array_length(c.content -> 'levels') ELSE 0 END AS level,
                c.archived_at IS NOT NULL AS archived, c.updated_at, p.updated_at AS play_updated_at
         FROM player_character c JOIN player_character_play p ON p.character_id = c.id
         WHERE (c.owner_id = $1 OR $2) AND ($5::text IS NULL OR c.group_id = $5)
           AND ($3::timestamptz IS NULL OR c.updated_at > $3 OR p.updated_at > $3)
           AND ($3::timestamptz IS NOT NULL OR $4 OR c.archived_at IS NULL)
         ORDER BY lower(c.name), c.id",
    )
    .bind(user.id)
    .bind(others)
    .bind(filter.updated_since)
    .bind(filter.include_archived)
    .bind(&filter.group)
    .fetch_all(pool)
    .await?;
    Ok(summaries)
}

/// A new character always lives in a group the caller is in.
pub async fn create(
    pool: &PgPool,
    user: CurrentUser,
    group_id: &str,
    character: Value,
) -> Result<CharacterRecord, AppError> {
    access::membership(pool, user, group_id).await?;
    let id = Uuid::new_v4();
    let (content, name) = checked(character, id)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO player_character (id, owner_id, name, content, version, group_id) VALUES ($1, $2, $3, $4, 1, $5)",
    )
        .bind(id)
        .bind(user.id)
        .bind(&name)
        .bind(&content)
        .bind(group_id)
        .execute(&mut *tx)
        .await?;
    save_version(&mut tx, id, 1, &content, user.id).await?;
    sqlx::query("INSERT INTO player_character_play (character_id) VALUES ($1)")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    read(pool, user, id).await
}

pub async fn update(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
    base: OffsetDateTime,
    character: Value,
) -> Result<CharacterRecord, AppError> {
    access::character(pool, user, id, CharacterAccess::Write).await?;
    let (content, name) = checked(character, id)?;
    let mut tx = pool.begin().await?;
    // Two pushes from the same base: the second one waits for the first one's row lock, then no longer matches.
    let version: Option<i32> = sqlx::query_scalar(&format!(
        "UPDATE player_character SET content = $3, name = $4, version = version + 1, updated_at = {NEXT_UPDATED_AT}
         WHERE id = $1 AND updated_at = $2 RETURNING version"
    ))
    .bind(id)
    .bind(base)
    .bind(&content)
    .bind(&name)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(version) = version else {
        drop(tx);
        return Err(stale(pool, id).await);
    };
    save_version(&mut tx, id, version, &content, user.id).await?;
    tx.commit().await?;
    read(pool, user, id).await
}

pub async fn update_play(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
    base: OffsetDateTime,
    state: Value,
) -> Result<CharacterRecord, AppError> {
    if !state.is_object() {
        return Err(AppError::BadRequest(
            "the play state must be a JSON object".into(),
        ));
    }
    access::character(pool, user, id, CharacterAccess::Write).await?;
    let updated = sqlx::query(
        "UPDATE player_character_play p
         SET state = $3, updated_at = greatest(now(), p.updated_at + interval '1 microsecond')
         WHERE p.character_id = $1 AND p.updated_at = $2",
    )
    .bind(id)
    .bind(base)
    .bind(&state)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(stale(pool, id).await);
    }
    read(pool, user, id).await
}

/// Archiving is not a new version of the choices, but it changes `updatedAt` so other devices pull it.
pub async fn set_archived(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
    archived: bool,
) -> Result<CharacterRecord, AppError> {
    access::character(pool, user, id, CharacterAccess::Write).await?;
    sqlx::query(&format!(
        "UPDATE player_character
         SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now()) END, updated_at = {NEXT_UPDATED_AT}
         WHERE id = $1"
    ))
    .bind(id)
    .bind(archived)
    .execute(pool)
    .await?;
    read(pool, user, id).await
}

/// To another group of the same RPG: its owner only, a member of both. It may then name entities the new group
/// does not see; the sheet shows them as missing.
pub async fn move_to(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
    group_id: &str,
) -> Result<CharacterRecord, AppError> {
    let meta = access::character(pool, user, id, CharacterAccess::Read).await?;
    if meta.owner_id != user.id {
        return Err(AppError::Forbidden(
            "only its owner moves a character".into(),
        ));
    }
    let target = access::membership(pool, user, group_id).await?;
    let from_rpg: Option<String> = match &meta.group_id {
        Some(from) => {
            sqlx::query_scalar("SELECT rpg FROM lore_group WHERE id = $1")
                .bind(from)
                .fetch_optional(pool)
                .await?
        }
        None => None,
    };
    if from_rpg.is_some_and(|rpg| rpg != target.rpg) {
        return Err(AppError::BadRequest(
            "a character moves only to a group of the same RPG".into(),
        ));
    }
    sqlx::query(&format!(
        "UPDATE player_character SET group_id = $2, updated_at = {NEXT_UPDATED_AT} WHERE id = $1"
    ))
    .bind(id)
    .bind(group_id)
    .execute(pool)
    .await?;
    read(pool, user, id).await
}

/// A copy owned by the caller in the same group, with fresh history and an empty play state.
pub async fn duplicate(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
) -> Result<CharacterRecord, AppError> {
    let record = read(pool, user, id).await?;
    let group_id = record.group_id.ok_or_else(|| {
        AppError::BadRequest("this character has no group yet (server migrate-groups)".into())
    })?;
    let mut content = record.character;
    let name = content["name"].as_str().unwrap_or_default().to_owned();
    content["name"] = Value::String(format!("{name} (copy)"));
    create(pool, user, &group_id, content).await
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub version: i32,
    pub author_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub saved_at: OffsetDateTime,
}

pub async fn versions(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
) -> Result<Vec<VersionSummary>, AppError> {
    read(pool, user, id).await?;
    Ok(sqlx::query_as(
        "SELECT version, author_id, saved_at FROM player_character_version WHERE character_id = $1 ORDER BY version DESC",
    )
    .bind(id)
    .fetch_all(pool)
    .await?)
}

pub async fn version(
    pool: &PgPool,
    user: CurrentUser,
    id: Uuid,
    version: i32,
) -> Result<Value, AppError> {
    read(pool, user, id).await?;
    sqlx::query_scalar(
        "SELECT content FROM player_character_version WHERE character_id = $1 AND version = $2",
    )
    .bind(id)
    .bind(version)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("{id}: no version {version}")))
}

async fn save_version(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    version: i32,
    content: &Value,
    author_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO player_character_version (character_id, version, content, author_id) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(version)
        .bind(content)
        .bind(author_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// After a write matched no row (access already checked): the client's copy is stale, 409 with the current record.
async fn stale(pool: &PgPool, id: Uuid) -> AppError {
    match load(pool, id).await {
        Ok(current) => {
            AppError::Conflict(serde_json::to_value(current).expect("a record always serializes"))
        }
        Err(error) => error,
    }
}

/// The engine requires `name` and `baseAbilities`; deeper checks stay with the engine on the client. The stored `id`
/// is always the server's.
fn checked(character: Value, id: Uuid) -> Result<(Value, String), AppError> {
    let Value::Object(mut fields) = character else {
        return Err(AppError::BadRequest(
            "the character must be a JSON object".into(),
        ));
    };
    let name = fields
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| AppError::BadRequest("the character needs a name".into()))?
        .to_owned();
    if !fields.get("baseAbilities").is_some_and(Value::is_object) {
        return Err(AppError::BadRequest(
            "the character needs baseAbilities".into(),
        ));
    }
    fields.insert("id".into(), Value::String(id.to_string()));
    Ok((Value::Object(fields), name))
}
