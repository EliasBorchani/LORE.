use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::PgPool;

use super::refs::collect_candidate_ids;
use super::{ENTITIES, PROGRESSIONS, RELATIONS, relation_json};

/// The part of the catalog a set of roots (a character's choices) needs, in the engine's catalog format.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Closure {
    pub catalog: Value,
    /// Current version of each entity sent, for the client cache and the later "only what changed" sync.
    pub versions: BTreeMap<String, i32>,
    /// Roots that are not in the catalog.
    pub missing: Vec<String>,
}

/// The closure of every entity a document (a character) mentions, plus every skill: a sheet lists all skills, not
/// only the class skills its classes point to. Id-shaped strings that are not entities (statistic keys, toggle ids)
/// are dropped first, so `missing` stays empty.
pub async fn closure_for(pool: &PgPool, document: &Value) -> Result<Closure, sqlx::Error> {
    let mut candidates = BTreeSet::new();
    collect_candidate_ids(document, &mut candidates);
    let roots: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM entity WHERE id = ANY($1) OR type = 'skill' ORDER BY id",
    )
    .bind(candidates.into_iter().collect::<Vec<_>>())
    .fetch_all(pool)
    .await?;
    closure(pool, &roots).await
}

/// Every entity reachable from the roots: ids found in their content, their outgoing relations, and the class table
/// rows of the classes reached (with the entities those rows grant).
pub async fn closure(pool: &PgPool, roots: &[String]) -> Result<Closure, sqlx::Error> {
    let mut entities: BTreeMap<String, (i32, Value)> = BTreeMap::new();
    let mut rows: Vec<Value> = Vec::new();
    let mut tried: BTreeSet<String> = BTreeSet::new();
    let mut frontier: BTreeSet<String> = roots.iter().cloned().collect();
    let mut missing = Vec::new();
    let mut first = true;

    while !frontier.is_empty() {
        let ids: Vec<String> = frontier.iter().cloned().collect();
        tried.extend(ids.iter().cloned());

        let found: Vec<(String, i32, Value)> = sqlx::query_as(
            "SELECT e.id, e.current_version, v.content
             FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
             WHERE e.id = ANY($1)",
        )
        .bind(&ids)
        .fetch_all(pool)
        .await?;
        if first {
            let found_ids: BTreeSet<&str> = found.iter().map(|(id, _, _)| id.as_str()).collect();
            missing = ids
                .iter()
                .filter(|id| !found_ids.contains(id.as_str()))
                .cloned()
                .collect();
            first = false;
        }

        let mut next = BTreeSet::new();
        let found_ids: Vec<String> = found.iter().map(|(id, _, _)| id.clone()).collect();
        for (id, version, content) in found {
            collect_candidate_ids(&content, &mut next);
            entities.insert(id, (version, content));
        }

        // `on_spell_list` points from a spell to a class: following it would pull a whole class into the sheet of
        // anyone holding one of its spells. `variant_of` (a team copy → its original) is for people, not the engine.
        let targets: Vec<String> = sqlx::query_scalar(
            "SELECT to_id FROM entity_relation
             WHERE from_id = ANY($1) AND relation NOT IN ('on_spell_list', 'variant_of')",
        )
        .bind(&found_ids)
        .fetch_all(pool)
        .await?;
        next.extend(targets);

        let class_rows: Vec<Value> = sqlx::query_scalar(
            "SELECT content FROM progression_row WHERE class_id = ANY($1) ORDER BY class_id, level",
        )
        .bind(&found_ids)
        .fetch_all(pool)
        .await?;
        for row in class_rows {
            collect_candidate_ids(&row, &mut next);
            rows.push(row);
        }

        frontier = next.into_iter().filter(|id| !tried.contains(id)).collect();
    }

    let ids: Vec<String> = entities.keys().cloned().collect();
    let relations: Vec<(String, String, String, Value)> = sqlx::query_as(
        "SELECT from_id, to_id, relation, extra FROM entity_relation
         WHERE from_id = ANY($1) AND to_id = ANY($1) ORDER BY from_id, relation, to_id",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    let relations = relations
        .into_iter()
        .map(|(from, to, relation, extra)| relation_json(from, to, relation, extra))
        .collect::<Vec<_>>();

    rows.sort_by_key(|row| {
        (
            row["classId"].as_str().unwrap_or_default().to_owned(),
            row["level"].as_i64(),
        )
    });

    let mut catalog = sections(pool).await?;
    let versions = entities
        .iter()
        .map(|(id, (version, _))| (id.clone(), *version))
        .collect();
    catalog.insert(
        ENTITIES.into(),
        entities.into_values().map(|(_, content)| content).collect(),
    );
    catalog.insert(RELATIONS.into(), relations.into());
    catalog.insert(PROGRESSIONS.into(), rows.into());

    Ok(Closure {
        catalog: Value::Object(catalog),
        versions,
        missing,
    })
}

/// The rule sections (bonus types, statistics, rules...): small, and needed by every sheet.
pub async fn sections(pool: &PgPool) -> Result<Map<String, Value>, sqlx::Error> {
    let sections: Vec<(String, Value)> =
        sqlx::query_as("SELECT name, content FROM catalog_section ORDER BY name")
            .fetch_all(pool)
            .await?;
    Ok(sections.into_iter().collect())
}
