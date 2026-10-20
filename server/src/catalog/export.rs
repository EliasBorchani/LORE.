use serde_json::Value;
use sqlx::PgPool;

use super::closure::sections;
use super::import::Target;
use super::{ENTITIES, PROGRESSIONS, RELATIONS, relation_json};

/// The current content of a target in the format `import` reads: every entity at its current version (a house rule
/// with its `overrides`), their relations and class table rows, and for official content the RPG's sections.
/// Importing it again into the same target changes nothing. Relations and class tables of ids that are not entities
/// (a batch may point to entities of a later batch) go with official content.
pub async fn export_catalog(pool: &PgPool, target: &Target) -> Result<Value, sqlx::Error> {
    let rows: Vec<(Value, Option<String>)> = sqlx::query_as(
        "SELECT v.content, e.overrides FROM entity e
         JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.rpg = $1 AND e.ruleset_id IS NOT DISTINCT FROM $2
         ORDER BY e.id",
    )
    .bind(target.rpg())
    .bind(target.ruleset_id())
    .fetch_all(pool)
    .await?;
    let entities: Vec<Value> = rows
        .into_iter()
        .map(|(mut content, overrides)| {
            if let (Some(official), Some(fields)) = (overrides, content.as_object_mut()) {
                fields.insert("overrides".into(), Value::String(official));
            }
            content
        })
        .collect();
    let relations: Vec<(String, String, String, Value)> = sqlx::query_as(
        "SELECT r.from_id, r.to_id, r.relation, r.extra FROM entity_relation r
         LEFT JOIN entity e ON e.id = r.from_id
         WHERE (e.rpg = $1 AND e.ruleset_id IS NOT DISTINCT FROM $2) OR (e.id IS NULL AND $2::bigint IS NULL)
         ORDER BY r.from_id, r.relation, r.to_id, r.extra::text",
    )
    .bind(target.rpg())
    .bind(target.ruleset_id())
    .fetch_all(pool)
    .await?;
    let progressions: Vec<Value> = sqlx::query_scalar(
        "SELECT p.content FROM progression_row p
         WHERE p.rpg = $1 AND EXISTS (SELECT 1 FROM entity e WHERE e.id = p.class_id AND e.ruleset_id IS NOT DISTINCT FROM $2)
            OR p.rpg = $1 AND $2::bigint IS NULL AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = p.class_id)
         ORDER BY p.class_id, p.level",
    )
    .bind(target.rpg())
    .bind(target.ruleset_id())
    .fetch_all(pool)
    .await?;

    let mut catalog = match target {
        Target::Official { rpg } => sections(pool, rpg).await?,
        Target::Ruleset { .. } => Default::default(),
    };
    catalog.insert(ENTITIES.into(), entities.into());
    catalog.insert(
        RELATIONS.into(),
        relations
            .into_iter()
            .map(|(from, to, relation, extra)| relation_json(from, to, relation, extra))
            .collect(),
    );
    catalog.insert(PROGRESSIONS.into(), progressions.into());
    Ok(Value::Object(catalog))
}
