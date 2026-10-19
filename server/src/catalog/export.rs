use serde_json::Value;
use sqlx::PgPool;

use super::closure::sections;
use super::{ENTITIES, PROGRESSIONS, RELATIONS, relation_json};

/// The whole current catalog in the format `import` reads: every entity at its current version, every relation,
/// every class table row and every section. Importing it again changes nothing.
pub async fn export_catalog(pool: &PgPool) -> Result<Value, sqlx::Error> {
    let entities: Vec<Value> = sqlx::query_scalar(
        "SELECT v.content FROM entity e
         JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         ORDER BY e.id",
    )
    .fetch_all(pool)
    .await?;
    let relations: Vec<(String, String, String, Value)> = sqlx::query_as(
        "SELECT from_id, to_id, relation, extra FROM entity_relation ORDER BY from_id, relation, to_id, extra::text",
    )
    .fetch_all(pool)
    .await?;
    let progressions: Vec<Value> =
        sqlx::query_scalar("SELECT content FROM progression_row ORDER BY class_id, level")
            .fetch_all(pool)
            .await?;

    let mut catalog = sections(pool).await?;
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
