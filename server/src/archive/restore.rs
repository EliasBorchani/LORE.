use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail, ensure};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::{
    ACCOUNTS, Account, CHARACTERS, CharacterFile, Counts, ENTITIES, EntityFile, FORMAT, MANIFEST,
    Manifest, PROGRESSIONS, READABLE_FORMATS, RELATIONS, SECTIONS, Section, file_name, read_json,
};

/// Loads an archive into an empty database, all or nothing: on any error nothing is written.
pub async fn restore(pool: &PgPool, dir: &Path) -> anyhow::Result<Counts> {
    let manifest: Manifest = read_json(&dir.join(MANIFEST))?;
    ensure!(
        READABLE_FORMATS.contains(&manifest.format),
        "archive format {} is not supported (this server reads {READABLE_FORMATS:?}, writes {FORMAT})",
        manifest.format
    );
    let schema: i64 = sqlx::query_scalar("SELECT coalesce(max(version), 0) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await?;
    ensure!(
        manifest.schema <= schema,
        "the archive comes from a newer server (schema {}, this one {schema}): update this server first",
        manifest.schema
    );

    let mut tx = pool.begin().await?;
    let filled: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM app_user) OR EXISTS (SELECT 1 FROM entity) OR EXISTS (SELECT 1 FROM catalog_section)
             OR EXISTS (SELECT 1 FROM entity_relation) OR EXISTS (SELECT 1 FROM progression_row)
             OR EXISTS (SELECT 1 FROM player_character)",
    )
    .fetch_one(&mut *tx)
    .await?;
    if filled {
        bail!("the database is not empty: restore only into a new database");
    }

    let mut counts = Counts::default();
    restore_accounts(&mut tx, &dir.join(ACCOUNTS), &mut counts).await?;
    for path in json_files(&dir.join(SECTIONS))? {
        let section: Section = read_json(&path)?;
        check_name(&path, &section.name)?;
        sqlx::query("INSERT INTO catalog_section (name, content) VALUES ($1, $2)")
            .bind(&section.name)
            .bind(&section.content)
            .execute(&mut *tx)
            .await?;
        counts.sections += 1;
    }
    for type_dir in dirs(&dir.join(ENTITIES))? {
        for path in json_files(&type_dir)? {
            restore_entity(&mut tx, &path, &mut counts)
                .await
                .with_context(|| path.display().to_string())?;
        }
    }
    restore_relations(&mut tx, &dir.join(RELATIONS), &mut counts).await?;
    for path in json_files(&dir.join(PROGRESSIONS))? {
        let rows: Vec<Value> = read_json(&path)?;
        for row in rows {
            let class_id = row["classId"]
                .as_str()
                .with_context(|| format!("{}: a row has no classId", path.display()))?;
            check_name(&path, class_id)?;
            let level = row["level"]
                .as_i64()
                .with_context(|| format!("{}: a row has no level", path.display()))?;
            sqlx::query(
                "INSERT INTO progression_row (class_id, level, content) VALUES ($1, $2, $3)",
            )
            .bind(class_id)
            .bind(i32::try_from(level)?)
            .bind(&row)
            .execute(&mut *tx)
            .await
            .with_context(|| path.display().to_string())?;
            counts.progression_rows += 1;
        }
    }
    for path in json_files(&dir.join(CHARACTERS))? {
        restore_character(&mut tx, &path, &mut counts)
            .await
            .with_context(|| path.display().to_string())?;
    }

    ensure!(
        counts == manifest.counts,
        "the archive does not hold what its manifest lists: found {counts}, manifest says {}",
        manifest.counts
    );
    // Ids were restored as they were: the next new account must start after the highest one.
    sqlx::query("SELECT setval(pg_get_serial_sequence('app_user', 'id'), coalesce(max(id), 0) + 1, false) FROM app_user")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(counts)
}

async fn restore_accounts(
    tx: &mut PgConnection,
    path: &Path,
    counts: &mut Counts,
) -> anyhow::Result<()> {
    let accounts: Vec<Account> = read_json(path)?;
    for account in accounts {
        sqlx::query(
            "INSERT INTO app_user (id, login, password_hash, role, created_at, disabled_at)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(account.id)
        .bind(&account.login)
        .bind(&account.password_hash)
        .bind(&account.role)
        .bind(account.created_at)
        .bind(account.disabled_at)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("{}: account {}", path.display(), account.login))?;
        counts.accounts += 1;
    }
    Ok(())
}

async fn restore_entity(
    tx: &mut PgConnection,
    path: &Path,
    counts: &mut Counts,
) -> anyhow::Result<()> {
    let entity: EntityFile = read_json(path)?;
    check_name(path, &entity.id)?;
    ensure!(
        entity
            .versions
            .iter()
            .any(|v| v.version == entity.current_version),
        "current version {} is not among its versions",
        entity.current_version
    );
    sqlx::query("INSERT INTO entity (id, type, provenance, source, current_version) VALUES ($1, $2, $3, $4, $5)")
        .bind(&entity.id)
        .bind(&entity.entity_type)
        .bind(&entity.provenance)
        .bind(&entity.source)
        .bind(entity.current_version)
        .execute(&mut *tx)
        .await?;
    for version in &entity.versions {
        sqlx::query(
            "INSERT INTO entity_version (entity_id, version, content, author, created_at, note, relations)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&entity.id)
        .bind(version.version)
        .bind(&version.content)
        .bind(&version.author)
        .bind(version.created_at)
        .bind(&version.note)
        .bind(&version.relations)
        .execute(&mut *tx)
        .await?;
    }
    counts.entities += 1;
    counts.entity_versions += entity.versions.len();
    Ok(())
}

async fn restore_relations(
    tx: &mut PgConnection,
    path: &Path,
    counts: &mut Counts,
) -> anyhow::Result<()> {
    let relations: Vec<Value> = read_json(path)?;
    for relation in relations {
        let mut extra = relation
            .as_object()
            .cloned()
            .with_context(|| format!("{}: a relation is not an object", path.display()))?;
        let mut take = |key: &str| -> anyhow::Result<String> {
            match extra.remove(key) {
                Some(Value::String(text)) => Ok(text),
                _ => bail!("{}: a relation has no {key}", path.display()),
            }
        };
        let (from, to, kind) = (take("from")?, take("to")?, take("relation")?);
        sqlx::query(
            "INSERT INTO entity_relation (from_id, to_id, relation, extra) VALUES ($1, $2, $3, $4)",
        )
        .bind(from)
        .bind(to)
        .bind(kind)
        .bind(Value::Object(extra))
        .execute(&mut *tx)
        .await?;
        counts.relations += 1;
    }
    Ok(())
}

async fn restore_character(
    tx: &mut PgConnection,
    path: &Path,
    counts: &mut Counts,
) -> anyhow::Result<()> {
    let character: CharacterFile = read_json(path)?;
    check_name(path, &character.id.to_string())?;
    let current = character
        .versions
        .iter()
        .find(|v| v.version == character.version)
        .with_context(|| {
            format!(
                "current version {} is not among its versions",
                character.version
            )
        })?;
    sqlx::query(
        "INSERT INTO player_character (id, owner_id, name, content, version, created_at, updated_at, archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(character.id)
    .bind(character.owner_id)
    .bind(&character.name)
    .bind(&current.content)
    .bind(character.version)
    .bind(character.created_at)
    .bind(character.updated_at)
    .bind(character.archived_at)
    .execute(&mut *tx)
    .await?;
    for version in &character.versions {
        sqlx::query(
            "INSERT INTO player_character_version (character_id, version, content, author_id, saved_at)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(character.id)
        .bind(version.version)
        .bind(&version.content)
        .bind(version.author_id)
        .bind(version.saved_at)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO player_character_play (character_id, state, updated_at) VALUES ($1, $2, $3)",
    )
    .bind(character.id)
    .bind(&character.play.state)
    .bind(character.play.updated_at)
    .execute(&mut *tx)
    .await?;
    counts.characters += 1;
    counts.character_versions += character.versions.len();
    Ok(())
}

/// A file renamed by hand would be restored under the wrong id: its name must match the id inside.
fn check_name(path: &Path, id: &str) -> anyhow::Result<()> {
    let expected = format!("{}.json", file_name(id));
    ensure!(
        path.file_name().and_then(|n| n.to_str()) == Some(expected.as_str()),
        "{} holds {id}, so it should be named {expected}",
        path.display()
    );
    Ok(())
}

/// `.json` files of a folder in name order; a missing folder is an empty one (an archive without characters).
fn json_files(dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
    Ok(entries(dir)?
        .into_iter()
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect())
}

fn dirs(dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
    Ok(entries(dir)?.into_iter().filter(|p| p.is_dir()).collect())
}

fn entries(dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(dir)
        .with_context(|| format!("cannot read {}", dir.display()))?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();
    Ok(paths)
}
