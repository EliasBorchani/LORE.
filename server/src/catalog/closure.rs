use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::PgPool;

use super::refs::collect_candidate_ids;
use super::stack::{HouseRule, Layers, bind_visible, bind_visible_scalar};
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
    /// The entities sent whose content is a house rule of the group (official id → the override).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub house_rules: BTreeMap<String, HouseRule>,
}

/// The closure of every entity a document (a character) mentions, plus every skill: a sheet lists all skills, not
/// only the class skills its classes point to. Id-shaped strings that are not entities (statistic keys, toggle ids)
/// are dropped first, so `missing` stays empty.
pub async fn closure_for(
    pool: &PgPool,
    layers: &Layers,
    document: &Value,
) -> Result<Closure, sqlx::Error> {
    let mut candidates = BTreeSet::new();
    collect_candidate_ids(document, &mut candidates);
    let stored: Vec<String> = candidates
        .iter()
        .map(|id| layers.stored(layers.canonical(id)).to_owned())
        .collect();
    let roots: Vec<String> = bind_visible_scalar(
        sqlx::query_scalar(&format!(
            "SELECT e.id FROM entity e WHERE (e.id = ANY($1) OR e.type = 'skill') AND {} ORDER BY e.id",
            Layers::visible("e", 2)
        ))
        .bind(stored),
        layers,
    )
    .fetch_all(pool)
    .await?;
    let roots: Vec<String> = roots
        .iter()
        .map(|id| layers.canonical(id).to_owned())
        .collect();
    closure(pool, layers, &roots).await
}

/// Every entity reachable from the roots: ids found in their content, their outgoing relations, and the class table
/// rows of the classes reached (with the entities those rows grant). Ids are the group's: an override is sent under
/// the official id it replaces, with the override's content, relations and class table.
pub async fn closure(
    pool: &PgPool,
    layers: &Layers,
    roots: &[String],
) -> Result<Closure, sqlx::Error> {
    let mut entities: BTreeMap<String, (i32, Value)> = BTreeMap::new();
    let mut rows: Vec<Value> = Vec::new();
    let mut tried: BTreeSet<String> = BTreeSet::new();
    let mut frontier: BTreeSet<String> = roots
        .iter()
        .map(|id| layers.canonical(id).to_owned())
        .collect();
    let mut missing = Vec::new();
    let mut first = true;
    let entity_query = format!(
        "SELECT e.id, e.current_version, v.content
         FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
         WHERE e.id = ANY($1) AND {}",
        Layers::visible("e", 2)
    );

    while !frontier.is_empty() {
        let ids: Vec<String> = frontier.iter().cloned().collect();
        tried.extend(ids.iter().cloned());
        let stored: Vec<String> = ids.iter().map(|id| layers.stored(id).to_owned()).collect();

        let found: Vec<(String, i32, Value)> =
            bind_visible(sqlx::query_as(&entity_query).bind(&stored), layers)
                .fetch_all(pool)
                .await?;
        let found: Vec<(String, i32, Value)> = found
            .into_iter()
            .map(|(id, version, mut content)| {
                let id = layers.canonical(&id).to_owned();
                if let Some(fields) = content.as_object_mut() {
                    fields.insert("id".into(), Value::String(id.clone()));
                }
                (id, version, content)
            })
            .collect();
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
        let found_stored: Vec<String> = found
            .iter()
            .map(|(id, _, _)| layers.stored(id).to_owned())
            .collect();
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
        .bind(&found_stored)
        .fetch_all(pool)
        .await?;
        next.extend(targets);

        let class_rows: Vec<Value> = sqlx::query_scalar(
            "SELECT content FROM progression_row WHERE rpg = $2 AND class_id = ANY($1) ORDER BY class_id, level",
        )
            .bind(&found_stored)
            .bind(&layers.rpg)
            .fetch_all(pool)
            .await?;
        for mut row in class_rows {
            if let Some(class_id) = row.get("classId").and_then(Value::as_str) {
                let class_id = layers.canonical(class_id).to_owned();
                row["classId"] = Value::String(class_id);
            }
            collect_candidate_ids(&row, &mut next);
            rows.push(row);
        }

        frontier = next
            .iter()
            .map(|id| layers.canonical(id).to_owned())
            .filter(|id| !tried.contains(id))
            .collect();
    }

    let stored: Vec<String> = entities
        .keys()
        .map(|id| layers.stored(id).to_owned())
        .collect();
    let relations: Vec<(String, String, String, Value)> = sqlx::query_as(
        "SELECT from_id, to_id, relation, extra FROM entity_relation
         WHERE from_id = ANY($1) ORDER BY from_id, relation, to_id",
    )
    .bind(&stored)
    .fetch_all(pool)
    .await?;
    let mut relations: Vec<(String, String, String, Value)> = relations
        .into_iter()
        .map(|(from, to, relation, extra)| {
            (
                layers.canonical(&from).to_owned(),
                layers.canonical(&to).to_owned(),
                relation,
                extra,
            )
        })
        .filter(|(_, to, _, _)| entities.contains_key(to))
        .collect();
    relations.sort_by(|a, b| (&a.0, &a.2, &a.1).cmp(&(&b.0, &b.2, &b.1)));
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

    let mut catalog = sections(pool, &layers.rpg).await?;
    let versions = entities
        .iter()
        .map(|(id, (version, _))| (id.clone(), *version))
        .collect();
    let house_rules = entities
        .keys()
        .filter_map(|id| Some((id.clone(), layers.house_rule(id)?.clone())))
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
        house_rules,
    })
}

/// The rule sections of an RPG (bonus types, statistics, rules...): small, and needed by every sheet.
pub async fn sections(pool: &PgPool, rpg: &str) -> Result<Map<String, Value>, sqlx::Error> {
    let sections: Vec<(String, Value)> =
        sqlx::query_as("SELECT name, content FROM catalog_section WHERE rpg = $1 ORDER BY name")
            .bind(rpg)
            .fetch_all(pool)
            .await?;
    Ok(sections.into_iter().collect())
}
