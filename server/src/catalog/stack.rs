//! What a group sees of the catalog (docs/prd-multi.md, section 6): the official content of its RPG, then its rulesets
//! in the group's order. A ruleset entity that `overrides` an official one replaces it everywhere in the group, under
//! the official id, so characters keep official ids; when two rulesets override the same entity, the last one wins.

use std::collections::BTreeMap;

use serde::Serialize;
use sqlx::PgPool;

/// A ruleset entity that replaces an official one in this group (« règle maison »).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HouseRule {
    /// The override's own id (`eberron:feat.power_attack`), the one to edit.
    pub id: String,
    pub ruleset: String,
    pub ruleset_name: String,
    pub version: i32,
}

/// Two rulesets of the group override the same official entity: `winner` (the last in order) applies.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub id: String,
    pub rulesets: Vec<String>,
    pub winner: String,
}

#[derive(Debug, Clone, Default)]
pub struct Layers {
    pub rpg: String,
    /// The group's rulesets, in order.
    pub rulesets: Vec<i64>,
    /// Official id → the override that applies.
    pub house_rules: BTreeMap<String, HouseRule>,
    /// Override id → the official id it is shown as.
    canonical: BTreeMap<String, String>,
    /// Never shown: official entities replaced by an override, and overrides that lost to a later ruleset.
    pub hidden: Vec<String>,
    pub conflicts: Vec<Conflict>,
}

#[derive(sqlx::FromRow)]
struct OverrideRow {
    id: String,
    overrides: String,
    current_version: i32,
    slug: String,
    name: String,
}

impl Layers {
    /// Official content only, for characters made before groups existed.
    pub fn official(rpg: &str) -> Self {
        Layers {
            rpg: rpg.to_owned(),
            ..Layers::default()
        }
    }

    pub async fn for_group(pool: &PgPool, group_id: &str) -> Result<Self, sqlx::Error> {
        let rpg: String = sqlx::query_scalar("SELECT rpg FROM lore_group WHERE id = $1")
            .bind(group_id)
            .fetch_one(pool)
            .await?;
        let rulesets: Vec<i64> = sqlx::query_scalar(
            "SELECT ruleset_id FROM group_ruleset WHERE group_id = $1 ORDER BY position, ruleset_id",
        )
        .bind(group_id)
        .fetch_all(pool)
        .await?;
        let overrides: Vec<OverrideRow> = sqlx::query_as(
            "SELECT e.id, e.overrides, e.current_version, r.slug, r.name
             FROM entity e JOIN ruleset r ON r.id = e.ruleset_id
             JOIN group_ruleset gr ON gr.ruleset_id = r.id AND gr.group_id = $1
             WHERE e.overrides IS NOT NULL
             ORDER BY gr.position, r.id",
        )
        .bind(group_id)
        .fetch_all(pool)
        .await?;

        let mut layers = Layers {
            rpg,
            rulesets,
            ..Layers::default()
        };
        let mut contenders: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for row in overrides {
            contenders
                .entry(row.overrides.clone())
                .or_default()
                .push(row.slug.clone());
            let rule = HouseRule {
                id: row.id,
                ruleset: row.slug,
                ruleset_name: row.name,
                version: row.current_version,
            };
            if let Some(lost) = layers.house_rules.insert(row.overrides, rule) {
                layers.hidden.push(lost.id);
            }
        }
        for (official, rule) in &layers.house_rules {
            layers.hidden.push(official.clone());
            layers.canonical.insert(rule.id.clone(), official.clone());
        }
        layers.conflicts = contenders
            .into_iter()
            .filter(|(_, rulesets)| rulesets.len() > 1)
            .map(|(id, rulesets)| Conflict {
                winner: rulesets.last().cloned().unwrap_or_default(),
                id,
                rulesets,
            })
            .collect();
        Ok(layers)
    }

    /// The id the group knows an entity by: an override is shown as the official entity it replaces.
    pub fn canonical<'a>(&'a self, id: &'a str) -> &'a str {
        self.canonical.get(id).map_or(id, String::as_str)
    }

    /// The row that holds what the group sees for this id: the override when there is one.
    pub fn stored<'a>(&'a self, id: &'a str) -> &'a str {
        self.house_rules.get(id).map_or(id, |rule| rule.id.as_str())
    }

    /// The house rule behind an id as the group knows it.
    pub fn house_rule(&self, canonical_id: &str) -> Option<&HouseRule> {
        self.house_rules.get(canonical_id)
    }

    /// SQL condition: the entity row `alias` is part of this group's catalog. Takes three binds, numbered from
    /// `first`: the RPG, the rulesets and the hidden ids (see [Layers::binds]).
    pub fn visible(alias: &str, first: usize) -> String {
        format!(
            "({alias}.rpg = ${} AND ({alias}.ruleset_id IS NULL OR {alias}.ruleset_id = ANY(${})) AND NOT {alias}.id = ANY(${}))",
            first,
            first + 1,
            first + 2
        )
    }
}

/// Binds the three values [Layers::visible] reads, in its order.
pub fn bind_visible<'q, O>(
    query: sqlx::query::QueryAs<'q, sqlx::Postgres, O, sqlx::postgres::PgArguments>,
    layers: &'q Layers,
) -> sqlx::query::QueryAs<'q, sqlx::Postgres, O, sqlx::postgres::PgArguments> {
    query
        .bind(&layers.rpg)
        .bind(&layers.rulesets)
        .bind(&layers.hidden)
}

pub fn bind_visible_scalar<'q, O>(
    query: sqlx::query::QueryScalar<'q, sqlx::Postgres, O, sqlx::postgres::PgArguments>,
    layers: &'q Layers,
) -> sqlx::query::QueryScalar<'q, sqlx::Postgres, O, sqlx::postgres::PgArguments> {
    query
        .bind(&layers.rpg)
        .bind(&layers.rulesets)
        .bind(&layers.hidden)
}
