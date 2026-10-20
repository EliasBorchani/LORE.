//! `server migrate-groups`: moves today's single table into the first group, and its team content into one private
//! ruleset (docs/prd-multi.md, section 10). One transaction; a second run finds nothing to do. Team ids get the
//! ruleset's slug (`feat.x` → `myslug:feat.x`), the one planned exception to « ids never change »; the map is kept in
//! `id_migration` and in every export. A team variant (`feat.x_team`, `variant_of` `feat.x`) becomes a house rule:
//! `myslug:feat.x`, overriding `feat.x`, and references to the variant become `feat.x`, which the group then resolves
//! to the house rule.

use std::collections::BTreeMap;

use anyhow::{Context, bail, ensure};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::access::{Permission, Permissions};
use crate::catalog::edit::{self, DEFAULT_RPG, VARIANT_OF};
use crate::catalog::ids;
use crate::catalog::refs::rewrite_ids;
use crate::groups;

pub struct Options {
    /// Login (email) of the account that becomes platform admin, group admin and ruleset owner.
    pub owner: String,
    pub group_name: String,
    pub ruleset_slug: String,
    pub ruleset_name: String,
}

#[derive(Debug, Default)]
pub struct Report {
    pub group_id: Option<String>,
    pub members: usize,
    /// Old id → new id of every moved entity.
    pub moved: BTreeMap<String, String>,
    /// House rule id → the official id it replaces.
    pub overrides: BTreeMap<String, String>,
    pub characters: usize,
    /// Characters whose choices named a moved id: they got a new version.
    pub characters_rewritten: usize,
    /// Other entity versions, class table rows and rule sections that named a moved id, rewritten in place.
    pub other_rewritten: usize,
}

impl std::fmt::Display for Report {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Some(group) = &self.group_id else {
            return write!(f, "nothing to migrate: every character has a group");
        };
        writeln!(
            f,
            "group {group}: {} members, {} characters ({} with renamed ids, saved as a new version)",
            self.members, self.characters, self.characters_rewritten
        )?;
        writeln!(
            f,
            "{} other rows (entity versions, class table rows, rule sections) named team ids: rewritten",
            self.other_rewritten
        )?;
        writeln!(
            f,
            "{} team entities moved into the ruleset, {} of them house rules:",
            self.moved.len(),
            self.overrides.len()
        )?;
        for (old, new) in &self.moved {
            match self.overrides.get(new) {
                Some(official) => writeln!(f, "  {old} → {new} (overrides {official})")?,
                None => writeln!(f, "  {old} → {new}")?,
            }
        }
        Ok(())
    }
}

pub async fn migrate_groups(
    pool: &PgPool,
    options: &Options,
    commit: bool,
) -> anyhow::Result<Report> {
    ensure!(
        ids::is_slug(&options.ruleset_slug),
        "{}: a slug is 3 to 31 lowercase letters, digits or '_', starting with a letter",
        options.ruleset_slug
    );
    let mut tx = pool.begin().await?;
    let pending: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM player_character WHERE group_id IS NULL)
             OR EXISTS (SELECT 1 FROM entity WHERE provenance = 'team' AND ruleset_id IS NULL)",
    )
    .fetch_one(&mut *tx)
    .await?;
    if !pending {
        return Ok(Report::default());
    }
    let owner: i64 = sqlx::query_scalar("SELECT id FROM app_user WHERE lower(login) = lower($1)")
        .bind(options.owner.trim())
        .fetch_optional(&mut *tx)
        .await?
        .with_context(|| format!("{}: unknown account", options.owner))?;

    // Read before roles change: today's admins become the group's admins.
    let accounts: Vec<(i64, bool)> = sqlx::query_as(
        "SELECT id, role = 'admin' OR id = $1 FROM app_user WHERE disabled_at IS NULL OR id = $1 ORDER BY id",
    )
    .bind(owner)
    .fetch_all(&mut *tx)
    .await?;
    // The owner is the platform admin; other admins keep their power in the group only.
    sqlx::query("UPDATE app_user SET role = CASE WHEN id = $1 THEN 'admin' ELSE 'member' END")
        .bind(owner)
        .execute(&mut *tx)
        .await?;
    let group_id = groups::insert_group(&mut tx, options.group_name.trim(), DEFAULT_RPG)
        .await
        .map_err(|error| anyhow::anyhow!("cannot create the group: {error:?}"))?;
    let mut report = Report {
        group_id: Some(group_id.clone()),
        ..Report::default()
    };
    for (id, admin) in &accounts {
        let permissions: Permissions = if *admin {
            [Permission::Admin].into()
        } else {
            [Permission::SeeCharacters, Permission::EditContent].into()
        };
        groups::add_member(&mut tx, &group_id, *id, &permissions).await?;
        report.members += 1;
    }

    let ruleset_id: i64 = sqlx::query_scalar(
        "INSERT INTO ruleset (slug, rpg, owner_id, name, visibility) VALUES ($1, $2, $3, $4, 'private') RETURNING id",
    )
    .bind(&options.ruleset_slug)
    .bind(DEFAULT_RPG)
    .bind(owner)
    .bind(options.ruleset_name.trim())
    .fetch_one(&mut *tx)
    .await
    .with_context(|| format!("{}: slug taken", options.ruleset_slug))?;
    sqlx::query("INSERT INTO group_ruleset (group_id, ruleset_id, position) VALUES ($1, $2, 0)")
        .bind(&group_id)
        .bind(ruleset_id)
        .execute(&mut *tx)
        .await?;

    let (moved, references, overrides) = plan_ids(&mut tx, &options.ruleset_slug).await?;
    for (old, new) in &moved {
        move_entity(
            &mut tx,
            old,
            new,
            ruleset_id,
            overrides.get(new),
            &references,
        )
        .await?;
    }
    rewrite_relations(&mut tx, &moved, &references).await?;
    report.other_rewritten = rewrite_elsewhere(&mut tx, &moved, &references).await?;
    for (id, official) in &overrides {
        edit::inherit(&mut tx, id, official).await?;
    }
    for (old, new) in &moved {
        sqlx::query("INSERT INTO id_migration (old_id, new_id) VALUES ($1, $2)")
            .bind(old)
            .bind(new)
            .execute(&mut *tx)
            .await?;
    }

    let (characters, rewritten) = move_characters(&mut tx, &group_id, owner, &references).await?;
    report.characters = characters;
    report.characters_rewritten = rewritten;
    report.moved = moved;
    report.overrides = overrides;

    if commit {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    Ok(report)
}

/// The new id of every team entity, the id references to it become (the official id for a variant), and the house
/// rules among them (new id → official id).
#[allow(clippy::type_complexity)]
async fn plan_ids(
    conn: &mut PgConnection,
    slug: &str,
) -> anyhow::Result<(
    BTreeMap<String, String>,
    BTreeMap<String, String>,
    BTreeMap<String, String>,
)> {
    let team: Vec<(String, Option<String>, Option<bool>)> = sqlx::query_as(
        "SELECT e.id, r.to_id, o.ruleset_id IS NULL AND o.provenance IS DISTINCT FROM 'team'
         FROM entity e
         LEFT JOIN entity_relation r ON r.from_id = e.id AND r.relation = $1
         LEFT JOIN entity o ON o.id = r.to_id
         WHERE e.provenance = 'team' AND e.ruleset_id IS NULL
         ORDER BY e.id",
    )
    .bind(VARIANT_OF)
    .fetch_all(&mut *conn)
    .await?;
    let mut moved = BTreeMap::new();
    let mut references = BTreeMap::new();
    let mut overrides = BTreeMap::new();
    for (id, original, original_is_official) in team {
        ensure!(
            ids::parse(&id).is_some_and(|id| id.slug.is_none()),
            "{id}: not a plain id"
        );
        match original.filter(|_| original_is_official == Some(true)) {
            Some(official) if !overrides.values().any(|o| *o == official) => {
                let new = ids::in_ruleset(slug, &official);
                references.insert(id.clone(), official.clone());
                overrides.insert(new.clone(), official);
                moved.insert(id, new);
            }
            _ => {
                let new = ids::in_ruleset(slug, &id);
                references.insert(id.clone(), new.clone());
                moved.insert(id, new);
            }
        }
    }
    let mut taken = Vec::new();
    for new in moved.values() {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM entity WHERE id = $1)")
            .bind(new)
            .fetch_one(&mut *conn)
            .await?;
        if exists {
            taken.push(new.clone());
        }
    }
    if !taken.is_empty() {
        bail!("these ids exist already: {}", taken.join(", "));
    }
    Ok((moved, references, overrides))
}

/// A new row under the new id with every version (the id and the references inside rewritten), then the old row
/// goes: versions keep their number, author, date and note.
async fn move_entity(
    conn: &mut PgConnection,
    old: &str,
    new: &str,
    ruleset_id: i64,
    overrides: Option<&String>,
    references: &BTreeMap<String, String>,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO entity (id, type, provenance, source, current_version, rpg, ruleset_id, overrides)
         SELECT $2, type, provenance, source, current_version, rpg, $3, $4 FROM entity WHERE id = $1",
    )
    .bind(old)
    .bind(new)
    .bind(ruleset_id)
    .bind(overrides)
    .execute(&mut *conn)
    .await?;
    let versions: Vec<(i32, Value, Option<Value>)> = sqlx::query_as(
        "SELECT version, content, relations FROM entity_version WHERE entity_id = $1 ORDER BY version",
    )
    .bind(old)
    .fetch_all(&mut *conn)
    .await?;
    for (version, content, relations) in versions {
        let mut content = rewrite_ids(&content, references);
        if let Some(fields) = content.as_object_mut() {
            fields.insert("id".into(), Value::String(new.to_owned()));
        }
        sqlx::query(
            "INSERT INTO entity_version (entity_id, version, content, author, created_at, note, relations)
             SELECT $2, version, $4, author, created_at, note, $5 FROM entity_version
             WHERE entity_id = $1 AND version = $3",
        )
        .bind(old)
        .bind(new)
        .bind(version)
        .bind(&content)
        .bind(relations.map(|r| rewrite_ids(&r, references)))
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query("DELETE FROM entity_version WHERE entity_id = $1")
        .bind(old)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM entity WHERE id = $1")
        .bind(old)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE progression_row SET class_id = $2, content = jsonb_set(content, '{classId}', to_jsonb($2::text))
         WHERE class_id = $1",
    )
    .bind(old)
    .bind(new)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Relations from a moved entity follow it; relations to one point where references go. A variant's `variant_of`
/// goes: the house rule's `overrides` says it now.
async fn rewrite_relations(
    conn: &mut PgConnection,
    moved: &BTreeMap<String, String>,
    references: &BTreeMap<String, String>,
) -> anyhow::Result<()> {
    let old: Vec<&String> = moved.keys().collect();
    sqlx::query("DELETE FROM entity_relation WHERE from_id = ANY($1) AND relation = $2")
        .bind(&old)
        .bind(VARIANT_OF)
        .execute(&mut *conn)
        .await?;
    for (from, to) in moved {
        sqlx::query("UPDATE entity_relation SET from_id = $2 WHERE from_id = $1")
            .bind(from)
            .bind(to)
            .execute(&mut *conn)
            .await?;
    }
    for (from, to) in references {
        sqlx::query("UPDATE entity_relation SET to_id = $2 WHERE to_id = $1")
            .bind(from)
            .bind(to)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Class table rows (the powers a level grants), rule sections, and entities that stay official but name a team id:
/// rewritten in place, so nothing points to an id that no longer exists.
async fn rewrite_elsewhere(
    conn: &mut PgConnection,
    moved: &BTreeMap<String, String>,
    references: &BTreeMap<String, String>,
) -> anyhow::Result<usize> {
    let patterns: Vec<String> = references.keys().map(|id| format!("%{id}%")).collect();
    let new_ids: Vec<&String> = moved.values().collect();
    let mut count = 0;
    let versions: Vec<(String, i32, Value, Option<Value>)> = sqlx::query_as(
        "SELECT entity_id, version, content, relations FROM entity_version
         WHERE NOT entity_id = ANY($2) AND (content::text LIKE ANY($1) OR relations::text LIKE ANY($1))",
    )
    .bind(&patterns)
    .bind(&new_ids)
    .fetch_all(&mut *conn)
    .await?;
    for (id, version, content, relations) in versions {
        let new_content = rewrite_ids(&content, references);
        let new_relations = relations.as_ref().map(|r| rewrite_ids(r, references));
        if new_content != content || new_relations != relations {
            sqlx::query("UPDATE entity_version SET content = $3, relations = $4 WHERE entity_id = $1 AND version = $2")
                .bind(&id)
                .bind(version)
                .bind(&new_content)
                .bind(&new_relations)
                .execute(&mut *conn)
                .await?;
            count += 1;
        }
    }
    let rows: Vec<(String, String, i32, Value)> = sqlx::query_as(
        "SELECT rpg, class_id, level, content FROM progression_row WHERE content::text LIKE ANY($1)",
    )
    .bind(&patterns)
    .fetch_all(&mut *conn)
    .await?;
    for (rpg, class_id, level, content) in rows {
        let new_content = rewrite_ids(&content, references);
        if new_content != content {
            sqlx::query("UPDATE progression_row SET content = $4 WHERE rpg = $1 AND class_id = $2 AND level = $3")
                .bind(&rpg)
                .bind(&class_id)
                .bind(level)
                .bind(&new_content)
                .execute(&mut *conn)
                .await?;
            count += 1;
        }
    }
    let sections: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT rpg, name, content FROM catalog_section WHERE content::text LIKE ANY($1)",
    )
    .bind(&patterns)
    .fetch_all(&mut *conn)
    .await?;
    for (rpg, name, content) in sections {
        let new_content = rewrite_ids(&content, references);
        if new_content != content {
            sqlx::query("UPDATE catalog_section SET content = $3 WHERE rpg = $1 AND name = $2")
                .bind(&rpg)
                .bind(&name)
                .bind(&new_content)
                .execute(&mut *conn)
                .await?;
            count += 1;
        }
    }
    Ok(count)
}

/// Every character without a group goes into the new one. When its choices name a moved id, the new choices are a
/// new version written by the owner of the migration, and `updatedAt` moves so devices pull it.
async fn move_characters(
    conn: &mut PgConnection,
    group_id: &str,
    author: i64,
    references: &BTreeMap<String, String>,
) -> anyhow::Result<(usize, usize)> {
    let characters: Vec<(uuid::Uuid, i32, Value, Value)> = sqlx::query_as(
        "SELECT c.id, c.version, c.content, p.state FROM player_character c
         JOIN player_character_play p ON p.character_id = c.id
         WHERE c.group_id IS NULL ORDER BY c.id",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut rewritten = 0;
    for (id, version, content, play) in &characters {
        let new_content = rewrite_ids(content, references);
        if new_content != *content {
            rewritten += 1;
            sqlx::query(
                "UPDATE player_character SET content = $2, version = $3,
                        updated_at = greatest(now(), updated_at + interval '1 microsecond') WHERE id = $1",
            )
            .bind(id)
            .bind(&new_content)
            .bind(version + 1)
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "INSERT INTO player_character_version (character_id, version, content, author_id) VALUES ($1, $2, $3, $4)",
            )
            .bind(id)
            .bind(version + 1)
            .bind(&new_content)
            .bind(author)
            .execute(&mut *conn)
            .await?;
        }
        let new_play = rewrite_ids(play, references);
        if new_play != *play {
            sqlx::query(
                "UPDATE player_character_play SET state = $2,
                        updated_at = greatest(now(), updated_at + interval '1 microsecond') WHERE character_id = $1",
            )
            .bind(id)
            .bind(&new_play)
            .execute(&mut *conn)
            .await?;
        }
        sqlx::query(
            "UPDATE player_character SET group_id = $2,
                    updated_at = greatest(now(), updated_at + interval '1 microsecond') WHERE id = $1",
        )
        .bind(id)
        .bind(group_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok((characters.len(), rewritten))
}
