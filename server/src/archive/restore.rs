use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail, ensure};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::{
    ACCOUNTS, Account, CHARACTERS, CharacterFile, Counts, DRAFTS, DraftRecord, ENTITIES,
    EntityFile, FORMAT, GROUPS, GroupRecord, ID_MAP, IdMigration, MANIFEST, Manifest, OLD_RPG,
    PROGRESSIONS, READABLE_FORMATS, RELATIONS, RPGS, RULESETS, Rpg, RulesetRecord, SECTIONS,
    Section, file_name, read_json,
};

/// Format 3 keeps sections and class tables in one folder per RPG; before, everything was D&D 3.5.
const PER_RPG_FORMAT: u32 = 3;

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
             OR EXISTS (SELECT 1 FROM player_character) OR EXISTS (SELECT 1 FROM ruleset)
             OR EXISTS (SELECT 1 FROM lore_group)",
    )
    .fetch_one(&mut *tx)
    .await?;
    if filled {
        bail!("the database is not empty: restore only into a new database");
    }

    let mut counts = Counts::default();
    let per_rpg = manifest.format >= PER_RPG_FORMAT;
    if per_rpg {
        let rpgs: Vec<Rpg> = read_json(&dir.join(RPGS))?;
        for rpg in rpgs {
            // The schema already holds D&D 3.5 (migration 0008): the archive's name wins.
            sqlx::query("INSERT INTO rpg (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2")
                .bind(&rpg.id)
                .bind(&rpg.name)
                .execute(&mut *tx)
                .await?;
            counts.rpgs += 1;
        }
    }
    restore_accounts(&mut tx, &dir.join(ACCOUNTS), &mut counts).await?;
    if per_rpg {
        restore_groups(&mut tx, dir, &mut counts).await?;
    }
    for (rpg, path) in per_rpg_files(&dir.join(SECTIONS), per_rpg)? {
        let section: Section = read_json(&path)?;
        check_name(&path, &section.name)?;
        ensure!(
            section.rpg == rpg,
            "{} holds a section of {}, not {rpg}",
            path.display(),
            section.rpg
        );
        sqlx::query("INSERT INTO catalog_section (rpg, name, content) VALUES ($1, $2, $3)")
            .bind(&rpg)
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
    for (rpg, path) in per_rpg_files(&dir.join(PROGRESSIONS), per_rpg)? {
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
                "INSERT INTO progression_row (rpg, class_id, level, content) VALUES ($4, $1, $2, $3)",
            )
            .bind(class_id)
            .bind(i32::try_from(level)?)
            .bind(&row)
            .bind(&rpg)
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
    if dir.join(ID_MAP).exists() {
        let map: Vec<IdMigration> = read_json(&dir.join(ID_MAP))?;
        for entry in map {
            sqlx::query(
                "INSERT INTO id_migration (old_id, new_id, migrated_at) VALUES ($1, $2, $3)",
            )
            .bind(&entry.old_id)
            .bind(&entry.new_id)
            .bind(entry.migrated_at)
            .execute(&mut *tx)
            .await?;
            counts.id_migrations += 1;
        }
    }

    if dir.join(DRAFTS).exists() {
        let drafts: Vec<DraftRecord> = read_json(&dir.join(DRAFTS))?;
        for draft in drafts {
            sqlx::query(
                "INSERT INTO entity_draft (id, author_id, group_id, payload, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(draft.id)
            .bind(draft.author_id)
            .bind(&draft.group_id)
            .bind(&draft.payload)
            .bind(draft.created_at)
            .bind(draft.updated_at)
            .execute(&mut *tx)
            .await?;
            counts.drafts += 1;
        }
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
    sqlx::query("SELECT setval(pg_get_serial_sequence('ruleset', 'id'), coalesce(max(id), 0) + 1, false) FROM ruleset")
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
            "INSERT INTO app_user (id, login, password_hash, role, created_at, disabled_at, max_groups, max_rulesets,
                                   max_pending_invites)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(account.id)
        .bind(&account.login)
        .bind(&account.password_hash)
        .bind(&account.role)
        .bind(account.created_at)
        .bind(account.disabled_at)
        .bind(account.max_groups)
        .bind(account.max_rulesets)
        .bind(account.max_pending_invites)
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
    sqlx::query(
        "INSERT INTO entity (id, type, provenance, source, current_version, rpg, ruleset_id, overrides)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&entity.id)
    .bind(&entity.entity_type)
    .bind(&entity.provenance)
    .bind(&entity.source)
    .bind(entity.current_version)
    .bind(&entity.rpg)
    .bind(entity.ruleset_id)
    .bind(&entity.overrides)
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
        "INSERT INTO player_character (id, owner_id, name, content, version, created_at, updated_at, archived_at,
                                       group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(character.id)
    .bind(character.owner_id)
    .bind(&character.name)
    .bind(&current.content)
    .bind(character.version)
    .bind(character.created_at)
    .bind(character.updated_at)
    .bind(character.archived_at)
    .bind(&character.group_id)
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

/// Rulesets (with their editors) and groups (members, ruleset order), after the accounts they name.
async fn restore_groups(
    tx: &mut PgConnection,
    dir: &Path,
    counts: &mut Counts,
) -> anyhow::Result<()> {
    let rulesets: Vec<RulesetRecord> = read_json(&dir.join(RULESETS))?;
    for ruleset in rulesets {
        sqlx::query(
            "INSERT INTO ruleset (id, slug, rpg, owner_id, name, visibility, created_at, archived_at)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(ruleset.id)
        .bind(&ruleset.slug)
        .bind(&ruleset.rpg)
        .bind(ruleset.owner_id)
        .bind(&ruleset.name)
        .bind(&ruleset.visibility)
        .bind(ruleset.created_at)
        .bind(ruleset.archived_at)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("ruleset {}", ruleset.slug))?;
        for editor in &ruleset.editors {
            sqlx::query("INSERT INTO ruleset_editor (ruleset_id, user_id) VALUES ($1, $2)")
                .bind(ruleset.id)
                .bind(editor)
                .execute(&mut *tx)
                .await?;
        }
        counts.rulesets += 1;
    }
    let groups: Vec<GroupRecord> = read_json(&dir.join(GROUPS))?;
    for group in groups {
        sqlx::query(
            "INSERT INTO lore_group (id, rpg, name, created_at, archived_at) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&group.id)
        .bind(&group.rpg)
        .bind(&group.name)
        .bind(group.created_at)
        .bind(group.archived_at)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("group {}", group.id))?;
        for member in &group.members {
            sqlx::query(
                "INSERT INTO group_member (group_id, user_id, permissions, joined_at, left_at) VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(&group.id)
            .bind(member.user_id)
            .bind(&member.permissions)
            .bind(member.joined_at)
            .bind(member.left_at)
            .execute(&mut *tx)
            .await?;
            counts.group_members += 1;
        }
        for (position, ruleset) in group.rulesets.iter().enumerate() {
            sqlx::query(
                "INSERT INTO group_ruleset (group_id, ruleset_id, position) VALUES ($1, $2, $3)",
            )
            .bind(&group.id)
            .bind(ruleset)
            .bind(position as i32)
            .execute(&mut *tx)
            .await?;
        }
        counts.groups += 1;
    }
    Ok(())
}

/// `(rpg, file)` of each `.json` file: in one folder per RPG (format 3), or all D&D 3.5 in the folder itself.
fn per_rpg_files(dir: &Path, per_rpg: bool) -> anyhow::Result<Vec<(String, PathBuf)>> {
    if !per_rpg {
        return Ok(json_files(dir)?
            .into_iter()
            .map(|path| (OLD_RPG.to_owned(), path))
            .collect());
    }
    let mut files = Vec::new();
    for rpg_dir in dirs(dir)? {
        let rpg = rpg_dir
            .file_name()
            .and_then(|name| name.to_str())
            .with_context(|| format!("{}: not an RPG folder", rpg_dir.display()))?
            .to_owned();
        for path in json_files(&rpg_dir)? {
            files.push((rpg.clone(), path));
        }
    }
    Ok(files)
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
