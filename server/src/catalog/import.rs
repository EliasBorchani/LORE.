use std::collections::BTreeSet;
use std::fmt;

use anyhow::{Context, bail};
use serde_json::{Map, Value};
use sqlx::PgPool;

use super::ids;
use super::{ENTITIES, PROGRESSIONS, RELATIONS};

/// Where content goes: an RPG's official content (platform admin), or one ruleset (ids `<slug>:…`).
#[derive(Debug, Clone)]
pub enum Target {
    Official { rpg: String },
    Ruleset { id: i64, slug: String, rpg: String },
}

impl Target {
    pub fn rpg(&self) -> &str {
        match self {
            Target::Official { rpg } | Target::Ruleset { rpg, .. } => rpg,
        }
    }

    pub fn ruleset_id(&self) -> Option<i64> {
        match self {
            Target::Official { .. } => None,
            Target::Ruleset { id, .. } => Some(*id),
        }
    }

    /// `--ruleset <slug>`, or else `--rpg <id>` (default `dnd35`).
    pub async fn find(
        pool: &PgPool,
        rpg: Option<&str>,
        ruleset: Option<&str>,
    ) -> anyhow::Result<Self> {
        if let Some(slug) = ruleset {
            let (id, rpg): (i64, String) =
                sqlx::query_as("SELECT id, rpg FROM ruleset WHERE slug = $1")
                    .bind(slug)
                    .fetch_optional(pool)
                    .await?
                    .with_context(|| format!("{slug}: unknown ruleset"))?;
            return Ok(Target::Ruleset {
                id,
                slug: slug.to_owned(),
                rpg,
            });
        }
        let rpg = rpg.unwrap_or(super::edit::DEFAULT_RPG);
        let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM rpg WHERE id = $1)")
            .bind(rpg)
            .fetch_one(pool)
            .await?;
        if !known {
            bail!("{rpg}: unknown RPG");
        }
        Ok(Target::Official {
            rpg: rpg.to_owned(),
        })
    }

    /// Official ids have no slug; a ruleset's ids all start with its own.
    fn check_id(&self, id: &str) -> anyhow::Result<()> {
        let slug = ids::parse(id).and_then(|id| id.slug);
        match self {
            Target::Official { .. } if slug.is_some() => {
                bail!("{id}: homebrew id in official content (import it with --ruleset)")
            }
            Target::Ruleset { slug: own, .. } if slug != Some(own.as_str()) => {
                bail!("{id}: content of the ruleset {own} has ids starting with {own}:")
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportReport {
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub relations: usize,
    pub progression_rows: usize,
    pub sections: usize,
}

impl fmt::Display for ImportReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "entities: {} created, {} updated, {} unchanged; {} relations, {} progression rows, {} sections",
            self.created,
            self.updated,
            self.unchanged,
            self.relations,
            self.progression_rows,
            self.sections
        )
    }
}

/// Imports a catalog file in one transaction. Files may be partial batches (PRD: content comes batch by batch), so
/// nothing absent from the file is deleted: relations are replaced only for the entities this file lists, class
/// tables only for the classes it lists, sections only for the keys it has.
pub async fn import(
    pool: &PgPool,
    target: &Target,
    catalog: &Value,
    author: &str,
    note: Option<&str>,
) -> anyhow::Result<ImportReport> {
    run(pool, target, catalog, author, note, true).await
}

/// The same import, rolled back at the end: the report says what would change, nothing is written (PRD: every
/// import runs as a dry run first).
pub async fn dry_run(
    pool: &PgPool,
    target: &Target,
    catalog: &Value,
    author: &str,
    note: Option<&str>,
) -> anyhow::Result<ImportReport> {
    run(pool, target, catalog, author, note, false).await
}

async fn run(
    pool: &PgPool,
    target: &Target,
    catalog: &Value,
    author: &str,
    note: Option<&str>,
    commit: bool,
) -> anyhow::Result<ImportReport> {
    let catalog = catalog
        .as_object()
        .context("the catalog must be a JSON object")?;
    let mut report = ImportReport::default();
    let mut tx = pool.begin().await?;

    let entities = array(catalog, ENTITIES)?;
    let mut entity_ids = BTreeSet::new();
    for entity in entities {
        let id = text(entity, "id").context("an entity has no id")?;
        let entity_type = text(entity, "type").with_context(|| format!("{id}: no type"))?;
        if !entity_ids.insert(id.to_owned()) {
            bail!("{id}: defined twice");
        }
        target.check_id(id)?;
        // A house rule names the official entity it replaces; that link is a column, not content the engine reads.
        let mut entity = entity.clone();
        let overrides = match entity.as_object_mut().and_then(|e| e.remove("overrides")) {
            None => None,
            Some(Value::String(official)) if target.ruleset_id().is_some() => Some(official),
            Some(_) => bail!("{id}: overrides is a ruleset entity's official id"),
        };
        let entity = &entity;
        let provenance = entity.get("provenance").and_then(Value::as_str);
        let source = entity.get("source").and_then(Value::as_str);

        let current: Option<Stored> = sqlx::query_as(
            "SELECT e.current_version AS version, v.content = $2 AS same, e.rpg, e.ruleset_id, e.overrides
             FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
             WHERE e.id = $1",
        )
        .bind(id)
        .bind(entity)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(stored) = &current
            && (stored.rpg != target.rpg() || stored.ruleset_id != target.ruleset_id())
        {
            bail!("{id}: already in the catalog of another RPG or ruleset");
        }
        let current =
            current.map(|stored| (stored.version, stored.same && stored.overrides == overrides));

        let version = match current {
            Some((_, true)) => {
                report.unchanged += 1;
                continue;
            }
            Some((version, false)) => {
                report.updated += 1;
                version + 1
            }
            None => {
                report.created += 1;
                1
            }
        };
        sqlx::query(
            "INSERT INTO entity (id, type, provenance, source, current_version, rpg, ruleset_id, overrides)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET type = $2, provenance = $3, source = $4, current_version = $5, overrides = $8",
        )
        .bind(id)
        .bind(entity_type)
        .bind(provenance)
        .bind(source)
        .bind(version)
        .bind(target.rpg())
        .bind(target.ruleset_id())
        .bind(&overrides)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO entity_version (entity_id, version, content, author, note) VALUES ($1, $2, $3, $4, $5)")
            .bind(id)
            .bind(version)
            .bind(entity)
            .bind(author)
            .bind(note)
            .execute(&mut *tx)
            .await?;
    }

    if catalog.contains_key(RELATIONS) {
        let relations = array(catalog, RELATIONS)?;
        let mut owners: Vec<String> = entity_ids.iter().cloned().collect();
        for relation in relations {
            owners.push(
                text(relation, "from")
                    .context("a relation has no from")?
                    .to_owned(),
            );
        }
        sqlx::query("DELETE FROM entity_relation WHERE from_id = ANY($1)")
            .bind(&owners)
            .execute(&mut *tx)
            .await?;
        for relation in relations {
            let from = text(relation, "from")?;
            target.check_id(from)?;
            let to =
                text(relation, "to").with_context(|| format!("relation from {from}: no to"))?;
            let kind = text(relation, "relation")
                .with_context(|| format!("relation {from} → {to}: no relation"))?;
            let mut extra = relation.as_object().cloned().unwrap_or_default();
            for key in ["from", "to", "relation"] {
                extra.remove(key);
            }
            sqlx::query("INSERT INTO entity_relation (from_id, to_id, relation, extra) VALUES ($1, $2, $3, $4)")
                .bind(from)
                .bind(to)
                .bind(kind)
                .bind(Value::Object(extra))
                .execute(&mut *tx)
                .await?;
            report.relations += 1;
        }
    }

    if catalog.contains_key(PROGRESSIONS) {
        let rows = array(catalog, PROGRESSIONS)?;
        let mut classes = BTreeSet::new();
        for row in rows {
            let class_id = text(row, "classId").context("a progression row has no classId")?;
            target.check_id(class_id)?;
            classes.insert(class_id.to_owned());
        }
        sqlx::query("DELETE FROM progression_row WHERE rpg = $2 AND class_id = ANY($1)")
            .bind(classes.into_iter().collect::<Vec<_>>())
            .bind(target.rpg())
            .execute(&mut *tx)
            .await?;
        for row in rows {
            let class_id = text(row, "classId")?;
            let level = row
                .get("level")
                .and_then(Value::as_i64)
                .and_then(|level| i32::try_from(level).ok())
                .with_context(|| format!("{class_id}: progression row without a whole level"))?;
            sqlx::query(
                "INSERT INTO progression_row (rpg, class_id, level, content) VALUES ($4, $1, $2, $3)",
            )
            .bind(class_id)
            .bind(level)
            .bind(row)
            .bind(target.rpg())
            .execute(&mut *tx)
            .await
            .with_context(|| format!("{class_id} level {level}"))?;
            report.progression_rows += 1;
        }
    }

    for (name, content) in catalog {
        if [ENTITIES, RELATIONS, PROGRESSIONS].contains(&name.as_str()) {
            continue;
        }
        if target.ruleset_id().is_some() {
            bail!(
                "{name}: a ruleset has no rule sections, only entities, relations and class tables"
            );
        }
        sqlx::query(
            "INSERT INTO catalog_section (rpg, name, content) VALUES ($3, $1, $2)
             ON CONFLICT (rpg, name) DO UPDATE SET content = $2",
        )
        .bind(name)
        .bind(content)
        .bind(target.rpg())
        .execute(&mut *tx)
        .await?;
        report.sections += 1;
    }

    if commit {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    Ok(report)
}

/// An entity already in the database, compared with the one being imported.
#[derive(sqlx::FromRow)]
struct Stored {
    version: i32,
    same: bool,
    rpg: String,
    ruleset_id: Option<i64>,
    overrides: Option<String>,
}

fn array<'a>(catalog: &'a Map<String, Value>, key: &str) -> anyhow::Result<&'a [Value]> {
    match catalog.get(key) {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => bail!("{key} must be a list"),
    }
}

fn text<'a>(value: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("missing text field {key}"))
}
