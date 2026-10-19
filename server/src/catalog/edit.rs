//! Content written in the app (PRD 5: the structured editor). Every save is a new entity version with its author
//! and note, as an import makes. Team content is open to every member; official content only to admins.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};

use crate::auth::{CurrentUser, Role};
use crate::error::AppError;

pub const TEAM: &str = "team";
/// From a team copy to the entity it started from.
pub const VARIANT_OF: &str = "variant_of";
pub const ON_SPELL_LIST: &str = "on_spell_list";
const LIST_TYPES: [&str; 3] = ["class", "prestige_class", "domain"];
const MAX_SPELL_LEVEL: i32 = 30;

/// A spell's place on a class or domain list.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct ListEntry {
    pub to: String,
    pub level: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEntity {
    pub entity: Value,
    pub note: Option<String>,
    /// The entity this one copies: a team variant of official content keeps a link to its original.
    pub variant_of: Option<String>,
    /// A spell's levels; absent = none.
    pub spell_lists: Option<Vec<ListEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityUpdate {
    /// The version the client edited; another save since then is a conflict.
    pub version: i32,
    pub entity: Value,
    pub note: Option<String>,
    /// A spell's levels, replacing the current ones; absent = unchanged.
    pub spell_lists: Option<Vec<ListEntry>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub id: String,
    pub r#type: String,
    pub version: i32,
    pub content: Value,
}

pub async fn create(
    pool: &PgPool,
    user: CurrentUser,
    request: NewEntity,
) -> Result<Saved, AppError> {
    let mut entity = request.entity;
    let (id, entity_type) = check_shape(&entity)?;
    if user.role != Role::Admin || entity.get("provenance").is_none() {
        entity["provenance"] = TEAM.into();
    }
    let mut tx = pool.begin().await?;
    if let Some(current) = current(&mut tx, &id).await? {
        return Err(AppError::Conflict(
            serde_json::to_value(current).expect("serializes"),
        ));
    }
    if let Some(original) = &request.variant_of {
        if current(&mut tx, original).await?.is_none() {
            return Err(AppError::BadRequest(format!(
                "variantOf: {original} is not in the catalog"
            )));
        }
        sqlx::query("INSERT INTO entity_relation (from_id, to_id, relation) VALUES ($1, $2, $3)")
            .bind(&id)
            .bind(original)
            .bind(VARIANT_OF)
            .execute(&mut *tx)
            .await?;
    }
    let lists = match request.spell_lists {
        Some(lists) => {
            let lists = check_lists(&mut tx, &entity_type, lists).await?;
            write_lists(&mut tx, &id, &lists).await?;
            Some(lists)
        }
        None => (entity_type == "spell").then(Vec::new),
    };
    let author = login(&mut tx, user).await?;
    sqlx::query("INSERT INTO entity (id, type, provenance, source, current_version) VALUES ($1, $2, $3, $4, 1)")
        .bind(&id)
        .bind(&entity_type)
        .bind(entity.get("provenance").and_then(Value::as_str))
        .bind(entity.get("source").and_then(Value::as_str))
        .execute(&mut *tx)
        .await?;
    write_version(
        &mut tx,
        &id,
        1,
        &entity,
        &author,
        request.note.as_deref(),
        lists.as_deref(),
    )
    .await?;
    tx.commit().await?;
    Ok(Saved {
        id,
        r#type: entity_type,
        version: 1,
        content: entity,
    })
}

/// Saves a new version. The id and the type never change; a member may not edit official content or turn team
/// content into official content. Saving the same content again writes nothing.
pub async fn update(
    pool: &PgPool,
    user: CurrentUser,
    id: &str,
    request: EntityUpdate,
) -> Result<Saved, AppError> {
    let entity = request.entity;
    let (entity_id, entity_type) = check_shape(&entity)?;
    if entity_id != id {
        return Err(AppError::BadRequest("an entity id never changes".into()));
    }
    let mut tx = pool.begin().await?;
    let current = sqlx::query_as::<_, Saved>(
        "SELECT e.id, e.type, e.current_version AS version, v.content
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.id = $1 FOR UPDATE OF e",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("{id}: unknown entity")))?;
    if user.role != Role::Admin {
        let team =
            |content: &Value| content.get("provenance").and_then(Value::as_str) == Some(TEAM);
        if !team(&current.content) {
            return Err(AppError::Forbidden(
                "only an admin edits official content".into(),
            ));
        }
        if !team(&entity) {
            return Err(AppError::Forbidden(
                "team content keeps the provenance 'team'".into(),
            ));
        }
    }
    if entity_type != current.r#type {
        return Err(AppError::BadRequest("an entity type never changes".into()));
    }
    if request.version != current.version {
        return Err(AppError::Conflict(
            serde_json::to_value(current).expect("serializes"),
        ));
    }
    let before = current_lists(&mut tx, id).await?;
    let lists = match request.spell_lists {
        Some(lists) => Some(check_lists(&mut tx, &entity_type, lists).await?),
        None => None,
    };
    let lists_changed = lists.as_ref().is_some_and(|lists| *lists != before);
    if entity == current.content && !lists_changed {
        return Ok(current);
    }
    if let Some(lists) = lists.as_ref().filter(|_| lists_changed) {
        write_lists(&mut tx, id, lists).await?;
    }
    let snapshot = lists.unwrap_or(before);
    let version = current.version + 1;
    let author = login(&mut tx, user).await?;
    sqlx::query(
        "UPDATE entity SET provenance = $2, source = $3, current_version = $4 WHERE id = $1",
    )
    .bind(id)
    .bind(entity.get("provenance").and_then(Value::as_str))
    .bind(entity.get("source").and_then(Value::as_str))
    .bind(version)
    .execute(&mut *tx)
    .await?;
    write_version(
        &mut tx,
        id,
        version,
        &entity,
        &author,
        request.note.as_deref(),
        (entity_type == "spell").then_some(snapshot.as_slice()),
    )
    .await?;
    tx.commit().await?;
    Ok(Saved {
        id: id.to_owned(),
        r#type: entity_type,
        version,
        content: entity,
    })
}

/// What the server checks itself (it never runs the engine): an object with an id shaped like `feat.power_attack`,
/// a type, and a name. The client checks the rest with the engine before saving.
fn check_shape(entity: &Value) -> Result<(String, String), AppError> {
    let bad = |message: &str| AppError::BadRequest(message.into());
    let object = entity
        .as_object()
        .ok_or_else(|| bad("the entity must be a JSON object"))?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("id: missing"))?;
    let is_id = id.split_once('.').is_some_and(|(prefix, name)| {
        !prefix.is_empty()
            && !name.is_empty()
            && prefix.chars().all(|c| c.is_ascii_lowercase() || c == '_')
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    });
    if !is_id {
        return Err(bad(
            "id: lowercase English words joined by '_' after a type prefix, as in feat.power_attack",
        ));
    }
    let entity_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if entity_type.is_empty()
        || !entity_type
            .chars()
            .all(|c| c.is_ascii_lowercase() || c == '_')
    {
        return Err(bad("type: missing or not a lowercase word"));
    }
    let named = object
        .get("name")
        .and_then(Value::as_object)
        .is_some_and(|names| {
            names
                .values()
                .any(|n| n.as_str().is_some_and(|n| !n.trim().is_empty()))
        });
    if !named {
        return Err(bad("name: at least one language"));
    }
    Ok((id.to_owned(), entity_type.to_owned()))
}

async fn current(conn: &mut PgConnection, id: &str) -> Result<Option<Saved>, sqlx::Error> {
    sqlx::query_as(
        "SELECT e.id, e.type, e.current_version AS version, v.content
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.id = $1",
    )
    .bind(id)
    .fetch_optional(conn)
    .await
}

async fn login(conn: &mut PgConnection, user: CurrentUser) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT login FROM app_user WHERE id = $1")
        .bind(user.id)
        .fetch_one(conn)
        .await
}

async fn write_version(
    conn: &mut PgConnection,
    id: &str,
    version: i32,
    entity: &Value,
    author: &str,
    note: Option<&str>,
    lists: Option<&[ListEntry]>,
) -> Result<(), sqlx::Error> {
    let note = note.map(str::trim).filter(|note| !note.is_empty());
    let relations = lists.map(|lists| json!({ ON_SPELL_LIST: lists }));
    sqlx::query(
        "INSERT INTO entity_version (entity_id, version, content, author, note, relations)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(version)
    .bind(entity)
    .bind(author)
    .bind(note)
    .bind(relations)
    .execute(conn)
    .await?;
    Ok(())
}

/// Only a spell has levels, each on a class or domain of the catalog, once, from 0. Sorted, so two lists compare
/// equal whatever order they came in.
async fn check_lists(
    conn: &mut PgConnection,
    entity_type: &str,
    mut lists: Vec<ListEntry>,
) -> Result<Vec<ListEntry>, AppError> {
    if entity_type != "spell" && !lists.is_empty() {
        return Err(AppError::BadRequest(
            "spellLists: only a spell has levels".into(),
        ));
    }
    lists.sort();
    let mut seen = BTreeSet::new();
    for entry in &lists {
        if !seen.insert(entry.to.as_str()) {
            return Err(AppError::BadRequest(format!(
                "spellLists: {} twice",
                entry.to
            )));
        }
        if !(0..=MAX_SPELL_LEVEL).contains(&entry.level) {
            return Err(AppError::BadRequest(format!(
                "spellLists: level {} for {}",
                entry.level, entry.to
            )));
        }
        let to_type: Option<String> = sqlx::query_scalar("SELECT type FROM entity WHERE id = $1")
            .bind(&entry.to)
            .fetch_optional(&mut *conn)
            .await?;
        if !to_type.is_some_and(|t| LIST_TYPES.contains(&t.as_str())) {
            return Err(AppError::BadRequest(format!(
                "spellLists: {} is not a class or a domain",
                entry.to
            )));
        }
    }
    Ok(lists)
}

async fn current_lists(conn: &mut PgConnection, id: &str) -> Result<Vec<ListEntry>, sqlx::Error> {
    let rows: Vec<(String, Option<i32>)> = sqlx::query_as(
        "SELECT to_id, (extra ->> 'level')::int FROM entity_relation WHERE from_id = $1 AND relation = $2",
    )
    .bind(id)
    .bind(ON_SPELL_LIST)
    .fetch_all(&mut *conn)
    .await?;
    let mut lists: Vec<ListEntry> = rows
        .into_iter()
        .map(|(to, level)| ListEntry {
            to,
            level: level.unwrap_or_default(),
        })
        .collect();
    lists.sort();
    Ok(lists)
}

/// Replaces the spell's lists. Other fields an import put on a relation (a `note`) stay while the list stays.
async fn write_lists(
    conn: &mut PgConnection,
    id: &str,
    lists: &[ListEntry],
) -> Result<(), sqlx::Error> {
    let old: Vec<(String, Value)> = sqlx::query_as(
        "DELETE FROM entity_relation WHERE from_id = $1 AND relation = $2 RETURNING to_id, extra",
    )
    .bind(id)
    .bind(ON_SPELL_LIST)
    .fetch_all(&mut *conn)
    .await?;
    for entry in lists {
        let mut extra = old
            .iter()
            .find(|(to, _)| *to == entry.to)
            .map(|(_, extra)| extra.clone())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        extra["level"] = entry.level.into();
        sqlx::query(
            "INSERT INTO entity_relation (from_id, to_id, relation, extra) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(&entry.to)
        .bind(ON_SPELL_LIST)
        .bind(extra)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
