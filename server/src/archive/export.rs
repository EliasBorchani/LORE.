use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, bail};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    ACCOUNTS, Account, CHARACTERS, CharacterFile, CharacterVersion, Counts, ENTITIES, EntityFile,
    EntityVersion, FORMAT, MANIFEST, Manifest, PROGRESSIONS, Play, RELATIONS, SECTIONS, Section,
    file_name, write_json,
};
use crate::catalog::relation_json;

#[derive(FromRow)]
struct EntityRow {
    id: String,
    #[sqlx(rename = "type")]
    entity_type: String,
    provenance: Option<String>,
    source: Option<String>,
    current_version: i32,
}

#[derive(FromRow)]
struct EntityVersionRow {
    entity_id: String,
    version: i32,
    author: String,
    created_at: OffsetDateTime,
    note: Option<String>,
    content: Value,
    relations: Option<Value>,
}

#[derive(FromRow)]
struct CharacterRow {
    id: Uuid,
    owner_id: i64,
    name: String,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    archived_at: Option<OffsetDateTime>,
    version: i32,
    play_state: Value,
    play_updated_at: OffsetDateTime,
}

#[derive(FromRow)]
struct CharacterVersionRow {
    character_id: Uuid,
    version: i32,
    author_id: i64,
    saved_at: OffsetDateTime,
    content: Value,
}

/// Writes the whole database into [dir], which must not exist yet or be empty.
pub async fn export(pool: &PgPool, dir: &Path) -> anyhow::Result<Counts> {
    if dir.exists() && fs::read_dir(dir)?.next().is_some() {
        bail!("{} is not empty", dir.display());
    }
    fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    private(dir, 0o700)?;

    // One snapshot for every query, so a write during the export cannot give a half-old, half-new archive.
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let mut counts = Counts::default();

    let schema: i64 = sqlx::query_scalar("SELECT coalesce(max(version), 0) FROM _sqlx_migrations")
        .fetch_one(&mut *tx)
        .await?;

    let accounts: Vec<Account> = sqlx::query_as(
        "SELECT id, login, password_hash, role, created_at, disabled_at FROM app_user ORDER BY id",
    )
    .fetch_all(&mut *tx)
    .await?;
    counts.accounts = accounts.len();
    write_json(&dir.join(ACCOUNTS), &accounts)?;
    private(&dir.join(ACCOUNTS), 0o600)?;

    let sections: Vec<(String, Value)> =
        sqlx::query_as("SELECT name, content FROM catalog_section ORDER BY name")
            .fetch_all(&mut *tx)
            .await?;
    counts.sections = sections.len();
    for (name, content) in sections {
        let path = dir
            .join(SECTIONS)
            .join(format!("{}.json", file_name(&name)));
        write_json(&path, &Section { name, content })?;
    }

    let entities: Vec<EntityRow> = sqlx::query_as(
        "SELECT id, type, provenance, source, current_version FROM entity ORDER BY id",
    )
    .fetch_all(&mut *tx)
    .await?;
    let versions: Vec<EntityVersionRow> = sqlx::query_as(
        "SELECT entity_id, version, author, created_at, note, content, relations
         FROM entity_version ORDER BY entity_id, version",
    )
    .fetch_all(&mut *tx)
    .await?;
    counts.entities = entities.len();
    counts.entity_versions = versions.len();
    let mut versions_by_entity: BTreeMap<String, Vec<EntityVersion>> = BTreeMap::new();
    for row in versions {
        versions_by_entity
            .entry(row.entity_id)
            .or_default()
            .push(EntityVersion {
                version: row.version,
                author: row.author,
                created_at: row.created_at,
                note: row.note,
                content: row.content,
                relations: row.relations,
            });
    }
    for row in entities {
        let path = dir
            .join(ENTITIES)
            .join(file_name(&row.entity_type))
            .join(format!("{}.json", file_name(&row.id)));
        let file = EntityFile {
            versions: versions_by_entity.remove(&row.id).unwrap_or_default(),
            id: row.id,
            entity_type: row.entity_type,
            provenance: row.provenance,
            source: row.source,
            current_version: row.current_version,
        };
        write_json(&path, &file)?;
    }

    let relations: Vec<(String, String, String, Value)> = sqlx::query_as(
        "SELECT from_id, to_id, relation, extra FROM entity_relation ORDER BY from_id, relation, to_id, extra::text",
    )
    .fetch_all(&mut *tx)
    .await?;
    counts.relations = relations.len();
    let relations: Vec<Value> = relations
        .into_iter()
        .map(|(from, to, relation, extra)| relation_json(from, to, relation, extra))
        .collect();
    write_json(&dir.join(RELATIONS), &relations)?;

    let rows: Vec<(String, Value)> =
        sqlx::query_as("SELECT class_id, content FROM progression_row ORDER BY class_id, level")
            .fetch_all(&mut *tx)
            .await?;
    counts.progression_rows = rows.len();
    let mut by_class: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (class_id, content) in rows {
        by_class.entry(class_id).or_default().push(content);
    }
    for (class_id, rows) in by_class {
        write_json(
            &dir.join(PROGRESSIONS)
                .join(format!("{}.json", file_name(&class_id))),
            &rows,
        )?;
    }

    let characters: Vec<CharacterRow> = sqlx::query_as(
        "SELECT c.id, c.owner_id, c.name, c.created_at, c.updated_at, c.archived_at, c.version,
                p.state AS play_state, p.updated_at AS play_updated_at
         FROM player_character c JOIN player_character_play p ON p.character_id = c.id ORDER BY c.id",
    )
    .fetch_all(&mut *tx)
    .await?;
    let versions: Vec<CharacterVersionRow> = sqlx::query_as(
        "SELECT character_id, version, author_id, saved_at, content FROM player_character_version
         ORDER BY character_id, version",
    )
    .fetch_all(&mut *tx)
    .await?;
    counts.characters = characters.len();
    counts.character_versions = versions.len();
    let mut versions_by_character: BTreeMap<Uuid, Vec<CharacterVersion>> = BTreeMap::new();
    for row in versions {
        versions_by_character
            .entry(row.character_id)
            .or_default()
            .push(CharacterVersion {
                version: row.version,
                author_id: row.author_id,
                saved_at: row.saved_at,
                content: row.content,
            });
    }
    for row in characters {
        let file = CharacterFile {
            id: row.id,
            owner_id: row.owner_id,
            name: row.name,
            created_at: row.created_at,
            updated_at: row.updated_at,
            archived_at: row.archived_at,
            version: row.version,
            versions: versions_by_character.remove(&row.id).unwrap_or_default(),
            play: Play {
                state: row.play_state,
                updated_at: row.play_updated_at,
            },
        };
        write_json(
            &dir.join(CHARACTERS).join(format!("{}.json", row.id)),
            &file,
        )?;
    }

    tx.commit().await?;
    let manifest = Manifest {
        format: FORMAT,
        schema,
        counts,
    };
    write_json(&dir.join(MANIFEST), &manifest)?;
    Ok(manifest.counts)
}

/// The archive holds password hashes: only its owner may open the folder and read the accounts file.
fn private(path: &Path, mode: u32) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .with_context(|| format!("cannot restrict {}", path.display()))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}
