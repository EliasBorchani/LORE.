//! Content written in the app (PRD 5: the structured editor). Every save is a new entity version with its author
//! and note, as an import makes. Homebrew goes into a ruleset its owner and editors change (docs/prd-multi.md);
//! official content only the platform admin changes.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};

use super::ids;
use crate::access::{self, RulesetRow};
use crate::auth::CurrentUser;
use crate::error::AppError;

/// From a team copy to the entity it started from (before rulesets; still read, no longer written).
pub const VARIANT_OF: &str = "variant_of";
pub const ON_SPELL_LIST: &str = "on_spell_list";
pub const DEFAULT_RPG: &str = "dnd35";
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
    /// The ruleset (slug) it goes into; absent = official content (platform admin).
    pub ruleset: Option<String>,
    /// Official content only: its RPG (default `dnd35`).
    pub rpg: Option<String>,
    /// The official entity it replaces in the groups using the ruleset (a house rule).
    pub overrides: Option<String>,
    /// A spell's levels; absent = none (or the official entity's, for a house rule).
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

/// Where a new entity goes: its RPG, and its ruleset unless it is official.
struct Target {
    rpg: String,
    ruleset: Option<RulesetRow>,
}

async fn target(
    pool: &PgPool,
    user: CurrentUser,
    id: &str,
    request: &NewEntity,
) -> Result<Target, AppError> {
    let slug = ids::parse(id).and_then(|id| id.slug);
    match &request.ruleset {
        Some(ruleset) => {
            let (row, access) = access::ruleset(pool, user, ruleset).await?;
            access::edits_ruleset(&row, access)?;
            if slug != Some(row.slug.as_str()) {
                return Err(AppError::BadRequest(format!(
                    "id: content of the ruleset {0} starts with {0}:",
                    row.slug
                )));
            }
            Ok(Target {
                rpg: row.rpg.clone(),
                ruleset: Some(row),
            })
        }
        None => {
            access::edits_official(user)?;
            if slug.is_some() || request.overrides.is_some() {
                return Err(AppError::BadRequest(
                    "ruleset: homebrew ids and house rules belong to a ruleset".into(),
                ));
            }
            let rpg = request.rpg.clone().unwrap_or_else(|| DEFAULT_RPG.into());
            let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM rpg WHERE id = $1)")
                .bind(&rpg)
                .fetch_one(pool)
                .await?;
            if !known {
                return Err(AppError::BadRequest(format!("rpg: {rpg} is unknown")));
            }
            Ok(Target { rpg, ruleset: None })
        }
    }
}

pub async fn create(
    pool: &PgPool,
    user: CurrentUser,
    request: NewEntity,
) -> Result<Saved, AppError> {
    let entity = request.entity.clone();
    let (id, entity_type) = check_shape(&entity)?;
    let target = target(pool, user, &id, &request).await?;
    let mut tx = pool.begin().await?;
    if let Some(current) = current(&mut tx, &id).await? {
        return Err(AppError::Conflict(
            serde_json::to_value(current).expect("serializes"),
        ));
    }
    if let Some(official) = &request.overrides {
        let found: Option<String> = sqlx::query_scalar(
            "SELECT type FROM entity WHERE id = $1 AND rpg = $2 AND ruleset_id IS NULL",
        )
        .bind(official)
        .bind(&target.rpg)
        .fetch_optional(&mut *tx)
        .await?;
        match found {
            None => {
                return Err(AppError::BadRequest(format!(
                    "overrides: {official} is not official content of this RPG"
                )));
            }
            Some(official_type) if official_type != entity_type => {
                return Err(AppError::BadRequest(format!(
                    "overrides: {official} is a {official_type}, not a {entity_type}"
                )));
            }
            Some(_) => {}
        }
    }
    let author = login(&mut tx, user).await?;
    sqlx::query(
        "INSERT INTO entity (id, type, provenance, source, current_version, rpg, ruleset_id, overrides)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7)",
    )
    .bind(&id)
    .bind(&entity_type)
    .bind(entity.get("provenance").and_then(Value::as_str))
    .bind(entity.get("source").and_then(Value::as_str))
    .bind(&target.rpg)
    .bind(target.ruleset.as_ref().map(|r| r.id))
    .bind(&request.overrides)
    .execute(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => AppError::BadRequest(format!(
            "overrides: this ruleset already has a house rule for {}",
            request.overrides.as_deref().unwrap_or_default()
        )),
        _ => error.into(),
    })?;
    if let Some(official) = &request.overrides {
        inherit(&mut tx, &id, official).await?;
    }
    let lists = match request.spell_lists {
        Some(lists) => {
            let lists = check_lists(&mut tx, &entity_type, lists).await?;
            write_lists(&mut tx, &id, &lists).await?;
            Some(lists)
        }
        None if entity_type == "spell" => Some(current_lists(&mut tx, &id).await?),
        None => None,
    };
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

/// A house rule starts with the relations (class skills, spell levels…) and the class table of the entity it
/// replaces: the group sees the override's, not the official ones. Does nothing when it already has its own.
pub async fn inherit(conn: &mut PgConnection, id: &str, official: &str) -> Result<(), sqlx::Error> {
    let has_relations: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM entity_relation WHERE from_id = $1 AND relation <> $2)",
    )
    .bind(id)
    .bind(VARIANT_OF)
    .fetch_one(&mut *conn)
    .await?;
    if !has_relations {
        sqlx::query(
            "INSERT INTO entity_relation (from_id, to_id, relation, extra)
             SELECT $1, to_id, relation, extra FROM entity_relation WHERE from_id = $2 AND relation <> $3",
        )
        .bind(id)
        .bind(official)
        .bind(VARIANT_OF)
        .execute(&mut *conn)
        .await?;
    }
    let has_rows: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM progression_row WHERE class_id = $1)")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    if !has_rows {
        sqlx::query(
            "INSERT INTO progression_row (rpg, class_id, level, content)
             SELECT rpg, $1, level, jsonb_set(content, '{classId}', to_jsonb($1::text))
             FROM progression_row WHERE class_id = $2",
        )
        .bind(id)
        .bind(official)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Saves a new version. The id and the type never change. Saving the same content again writes nothing.
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
    let not_found = || AppError::NotFound(format!("{id}: unknown entity"));
    let ruleset_id: Option<Option<i64>> =
        sqlx::query_scalar("SELECT ruleset_id FROM entity WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    match ruleset_id.ok_or_else(not_found)? {
        Some(ruleset_id) => {
            let Some((row, Some(access))) = access::ruleset_by_id(pool, user, ruleset_id).await?
            else {
                return Err(not_found());
            };
            access::edits_ruleset(&row, access)?;
        }
        None => access::edits_official(user)?,
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
    .ok_or_else(not_found)?;
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
    let is_id = ids::parse(id).is_some();
    if !is_id {
        return Err(bad(
            "id: lowercase English words joined by '_' after a type prefix, as in feat.power_attack (eberron:feat.power_attack in a ruleset)",
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
