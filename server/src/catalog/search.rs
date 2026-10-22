//! Catalog search (`GET /search`): words in names, ids and descriptions, plus filters whose values are computed from
//! the content (`migrations/0007_search_filters.sql`), each value with the number of results it would give.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgPool, Postgres, QueryBuilder};

use super::cards;
use super::routes::Reference;
use super::stack::{HouseRule, Layers};
use crate::error::AppError;

const DEFAULT_PAGE: i64 = 50;
const MAX_PAGE: i64 = 200;
const MAX_SEARCH_WORDS: usize = 8;
const MAX_SEARCH_OFFSET: i64 = 10_000;
const MAX_FILTER_VALUES: usize = 50;

#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
    r#type: Option<String>,
    /// Each filter takes values separated by commas: any of them (OR); different filters all apply (AND).
    school: Option<String>,
    descriptor: Option<String>,
    /// A class, prestige class or domain id: spells on its list.
    list: Option<String>,
    /// Spell levels; with `list`, both on the same spell list entry.
    level: Option<String>,
    affects: Option<String>,
    /// Discipline ids of maneuvers and stances.
    discipline: Option<String>,
    /// Maneuver levels (1 to 9).
    maneuver_level: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
    /// Adds the count of each filter value (the app asks for it with the first page).
    #[serde(default)]
    facets: bool,
}

#[derive(Serialize)]
pub struct SearchPage {
    items: Vec<SearchItem>,
    /// Pass as `offset` to get the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    next: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    facets: Option<Value>,
    /// The entities the cards name.
    references: Vec<Reference>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchItem {
    id: String,
    r#type: String,
    name: Option<Value>,
    labels: Option<Value>,
    /// `"description"` when the words are not in the name: the list shows why the entity came up.
    #[serde(skip_serializing_if = "Option::is_none")]
    matched_in: Option<&'static str>,
    /// The group's house rule shown in place of the official entity.
    #[serde(skip_serializing_if = "Option::is_none")]
    house_rule: Option<HouseRule>,
    /// What its result card shows (`cards.rs`).
    card: Value,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: String,
    r#type: String,
    name: Option<Value>,
    labels: Option<Value>,
    content: Value,
    tier: i32,
}

/// Results matching only on their description.
const DESCRIPTION_TIER: i32 = 3;

#[derive(Clone, Copy, PartialEq)]
enum Facet {
    School,
    Descriptor,
    List,
    Level,
    Affects,
    Discipline,
    ManeuverLevel,
}

struct Filters {
    school: Vec<String>,
    descriptor: Vec<String>,
    list: Vec<String>,
    /// Kept as text: compared with the relation's `level` read as text, so a malformed stored level never errors.
    level: Vec<String>,
    affects: Vec<String>,
    discipline: Vec<String>,
    maneuver_level: Vec<i32>,
}

impl Filters {
    fn parse(query: &SearchQuery) -> Result<Self, AppError> {
        let level = values(&query.level)
            .into_iter()
            .map(|level| {
                level
                    .parse::<u16>()
                    .map(|n| n.to_string())
                    .map_err(|_| AppError::BadRequest(format!("level: {level} is not a number")))
            })
            .collect::<Result<_, _>>()?;
        let maneuver_level = values(&query.maneuver_level)
            .into_iter()
            .map(|level| {
                level.parse::<i32>().map_err(|_| {
                    AppError::BadRequest(format!("maneuver_level: {level} is not a number"))
                })
            })
            .collect::<Result<_, _>>()?;
        Ok(Self {
            school: values(&query.school),
            descriptor: values(&query.descriptor),
            list: values(&query.list),
            level,
            affects: values(&query.affects),
            discipline: values(&query.discipline),
            maneuver_level,
        })
    }

    fn is_empty(&self) -> bool {
        self.school.is_empty()
            && self.descriptor.is_empty()
            && self.list.is_empty()
            && self.level.is_empty()
            && self.affects.is_empty()
            && self.discipline.is_empty()
            && self.maneuver_level.is_empty()
    }

    /// The filters on the rows of `base b`, except `skip`. List and level live on one relation row, so a facet
    /// counted on that row (`skip` = List or Level) gets neither here and applies the other on the row itself.
    fn push(&self, sql: &mut QueryBuilder<'_, Postgres>, skip: Option<Facet>) {
        if skip != Some(Facet::School) && !self.school.is_empty() {
            sql.push(" AND b.facet_school = ANY(ARRAY(SELECT lower(trim(x)) FROM unnest(")
                .push_bind(self.school.clone())
                .push("::text[]) x))");
        }
        if skip != Some(Facet::Descriptor) && !self.descriptor.is_empty() {
            sql.push(" AND b.facet_descriptors && ARRAY(SELECT lower(trim(x)) FROM unnest(")
                .push_bind(self.descriptor.clone())
                .push("::text[]) x)");
        }
        if skip != Some(Facet::Affects) && !self.affects.is_empty() {
            sql.push(" AND b.facet_affects && ")
                .push_bind(self.affects.clone())
                .push("::text[]");
        }
        if skip != Some(Facet::Discipline) && !self.discipline.is_empty() {
            sql.push(" AND b.facet_discipline = ANY(")
                .push_bind(self.discipline.clone())
                .push("::text[])");
        }
        if skip != Some(Facet::ManeuverLevel) && !self.maneuver_level.is_empty() {
            sql.push(" AND b.facet_maneuver_level = ANY(")
                .push_bind(self.maneuver_level.clone())
                .push("::integer[])");
        }
        let on_list = !matches!(skip, Some(Facet::List | Facet::Level));
        if on_list && (!self.list.is_empty() || !self.level.is_empty()) {
            sql.push(
                " AND EXISTS (SELECT 1 FROM entity_relation r WHERE r.from_id = b.id AND r.relation = 'on_spell_list'",
            );
            self.push_list_entry(sql, None);
            sql.push(")");
        }
    }

    /// The list and level conditions on the relation row `r`, except `skip`.
    fn push_list_entry(&self, sql: &mut QueryBuilder<'_, Postgres>, skip: Option<Facet>) {
        if skip != Some(Facet::List) && !self.list.is_empty() {
            sql.push(" AND r.to_id = ANY(")
                .push_bind(self.list.clone())
                .push("::text[])");
        }
        if skip != Some(Facet::Level) && !self.level.is_empty() {
            sql.push(" AND r.extra ->> 'level' = ANY(")
                .push_bind(self.level.clone())
                .push("::text[])");
        }
    }
}

fn values(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .take(MAX_FILTER_VALUES)
        .map(str::to_owned)
        .collect()
}

/// What the words of `q` become: LIKE patterns on the names and the id, and a full-text query on the descriptions.
struct Text {
    words: Vec<String>,
    phrase: String,
    /// `None` when `q` has no letter or digit: descriptions are then not searched.
    ts_query: Option<String>,
}

impl Text {
    fn parse(q: &str) -> Option<Self> {
        // Ids are searched with `.` and `_` as spaces, so `feat.power_attack` finds Power Attack too.
        let words: Vec<String> = q
            .replace(['.', '_'], " ")
            .split_whitespace()
            .take(MAX_SEARCH_WORDS)
            .map(escape_like)
            .collect();
        if words.is_empty() {
            return None;
        }
        // Only letters and digits reach to_tsquery, so nothing typed can be read as its operators. The last word is
        // a prefix, so results come while typing (« aveug » finds « aveuglé »), but only from 3 letters: « a:* »
        // matches nearly every word of every description and took 0.4 s at 28,000 entities.
        let terms: Vec<&str> = q
            .split(|c: char| !c.is_alphanumeric())
            .filter(|term| !term.is_empty())
            .take(MAX_SEARCH_WORDS)
            .collect();
        let ts_query = terms.last().map(|last| {
            let prefix = if last.chars().count() >= 3 { ":*" } else { "" };
            format!("{}{prefix}", terms.join(" & "))
        });
        Some(Self {
            phrase: words.join(" "),
            words,
            ts_query,
        })
    }

    /// Every word in the names or the id (one LIKE per word: any order, and the trigram index serves each).
    fn push_name_match(&self, sql: &mut QueryBuilder<'_, Postgres>) {
        sql.push("(TRUE");
        for word in &self.words {
            sql.push(" AND v.search_text LIKE '%' || lore_fold(")
                .push_bind(word.clone())
                .push(") || '%'");
        }
        sql.push(")");
    }

    fn push_description_match(&self, sql: &mut QueryBuilder<'_, Postgres>) {
        match &self.ts_query {
            Some(ts_query) => {
                sql.push("(v.search_fr @@ to_tsquery('public.lore_fr', ")
                    .push_bind(ts_query.clone())
                    .push(") OR v.search_en @@ to_tsquery('public.lore_en', ")
                    .push_bind(ts_query.clone())
                    .push("))");
            }
            None => {
                sql.push("FALSE");
            }
        }
    }

    fn push_rank(&self, sql: &mut QueryBuilder<'_, Postgres>) {
        match &self.ts_query {
            Some(ts_query) => {
                sql.push("greatest(ts_rank(v.search_fr, to_tsquery('public.lore_fr', ")
                    .push_bind(ts_query.clone())
                    .push(")), ts_rank(v.search_en, to_tsquery('public.lore_en', ")
                    .push_bind(ts_query.clone())
                    .push(")))");
            }
            None => {
                sql.push("0");
            }
        }
    }
}

/// `%` and `\` typed by the user are plain characters, not LIKE wildcards (`_` became a space before).
fn escape_like(word: &str) -> String {
    word.replace('\\', "\\\\").replace('%', "\\%")
}

/// `WITH base AS (…)`: current versions of the type, matching the text. For a page of results (`ranked`), also what
/// they are shown and sorted by: the tier (0 the name starts with the query, 1 a word of the name does, 2 the words
/// are elsewhere in the name or id, 3 only in the description) and, for descriptions, the full-text rank. For counting,
/// only the id and the facet values, so the rows kept for the five counts stay small.
fn push_base(
    sql: &mut QueryBuilder<'_, Postgres>,
    layers: &Layers,
    r#type: &Option<String>,
    text: &Option<Text>,
    ranked: bool,
) {
    sql.push(
        "WITH base AS (SELECT e.id, v.facet_school, v.facet_descriptors, v.facet_affects, \
         v.facet_discipline, v.facet_maneuver_level",
    );
    if ranked {
        sql.push(", e.type, v.content -> 'name' AS name, v.content -> 'labels' AS labels, v.content, v.search_sort, ");
        match text {
            Some(text) => {
                sql.push("CASE WHEN NOT ");
                text.push_name_match(sql);
                sql.push(" THEN 3 WHEN v.search_sort LIKE lore_fold(")
                    .push_bind(text.phrase.clone())
                    .push(") || '%' THEN 0 WHEN v.search_sort LIKE '% ' || lore_fold(")
                    .push_bind(text.phrase.clone())
                    .push(") || '%' THEN 1 ELSE 2 END AS tier, CASE WHEN ");
                text.push_name_match(sql);
                sql.push(" THEN 0 ELSE ");
                text.push_rank(sql);
                sql.push(" END AS rank");
            }
            None => {
                sql.push("0 AS tier, 0 AS rank");
            }
        }
    }
    sql.push(
        " FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version WHERE e.rpg = ",
    );
    sql.push_bind(layers.rpg.clone())
        .push(" AND (e.ruleset_id IS NULL OR e.ruleset_id = ANY(")
        .push_bind(layers.rulesets.clone())
        .push(")) AND NOT e.id = ANY(")
        .push_bind(layers.hidden.clone())
        .push(")");
    if let Some(r#type) = r#type {
        sql.push(" AND e.type = ").push_bind(r#type.clone());
    }
    if let Some(text) = text {
        sql.push(" AND (");
        text.push_name_match(sql);
        sql.push(" OR ");
        text.push_description_match(sql);
        sql.push(")");
    }
    sql.push(")");
}

pub async fn search(
    pool: &PgPool,
    layers: &Layers,
    query: SearchQuery,
) -> Result<SearchPage, AppError> {
    let filters = Filters::parse(&query)?;
    let text = Text::parse(query.q.as_deref().unwrap_or(""));
    if text.is_none() && query.r#type.is_none() && filters.is_empty() {
        return Err(AppError::BadRequest(
            "q: type at least one word, or choose a type or a filter".into(),
        ));
    }
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let offset = query.offset.unwrap_or(0).clamp(0, MAX_SEARCH_OFFSET);

    let mut sql = QueryBuilder::new("");
    push_base(&mut sql, layers, &query.r#type, &text, true);
    sql.push(" SELECT b.id, b.type, b.name, b.labels, b.content, b.tier FROM base b WHERE TRUE");
    filters.push(&mut sql, None);
    sql.push(" ORDER BY b.tier, CASE WHEN b.tier = ")
        .push_bind(DESCRIPTION_TIER)
        .push(" THEN -b.rank ELSE 0 END, b.search_sort, b.id LIMIT ")
        .push_bind(limit + 1)
        .push(" OFFSET ")
        .push_bind(offset);
    let mut rows: Vec<Row> = sql.build_query_as().fetch_all(pool).await?;
    let next = if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        Some(offset + limit).filter(|next| *next <= MAX_SEARCH_OFFSET)
    } else {
        None
    };
    let contents = rows
        .iter_mut()
        .map(|row| (row.id.clone(), row.content.take()))
        .collect();
    let (cards, references) = cards::cards(pool, layers, contents).await?;
    let items = rows
        .into_iter()
        .zip(cards)
        .map(|(row, card)| SearchItem {
            matched_in: (row.tier == DESCRIPTION_TIER).then_some("description"),
            house_rule: layers.house_rule(layers.canonical(&row.id)).cloned(),
            id: layers.canonical(&row.id).to_owned(),
            r#type: row.r#type,
            name: row.name,
            labels: row.labels,
            card,
        })
        .collect();
    let facets = if query.facets {
        Some(facets(pool, layers, &query.r#type, &text, &filters).await?)
    } else {
        None
    };
    Ok(SearchPage {
        items,
        next,
        facets,
        references,
    })
}

/// `{school, descriptor, list, level, affects, discipline, maneuver_level}`: each a list of `{value, count}` (with
/// `name` when the value is an entity id), most results first. A facet is counted without its own filter, so choosing
/// Fire still shows how many Cold spells there are; values with no result are absent.
async fn facets(
    pool: &PgPool,
    layers: &Layers,
    r#type: &Option<String>,
    text: &Option<Text>,
    filters: &Filters,
) -> Result<Value, AppError> {
    let mut sql = QueryBuilder::new("");
    push_base(&mut sql, layers, r#type, text, false);
    sql.push(" SELECT jsonb_build_object(");

    let counted = |sql: &mut QueryBuilder<'_, Postgres>,
                   key: &str,
                   facet: Facet,
                   value: &str,
                   from: &str| {
        sql.push(format!(
            "'{key}', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n, \
             'name', (SELECT tv.content -> 'name' FROM entity t JOIN entity_version tv \
                      ON tv.entity_id = t.id AND tv.version = t.current_version WHERE t.id = value #>> '{{}}')) \
             ORDER BY n DESC, value), '[]') \
             FROM (SELECT value, count(*) AS n FROM (SELECT DISTINCT {value} AS value, b.id FROM base b{from} WHERE TRUE"
        ));
        filters.push(sql, Some(facet));
        if matches!(facet, Facet::List | Facet::Level) {
            filters.push_list_entry(sql, Some(facet));
        }
        // An entity counts once per value, even on two lists at the same level.
        sql.push(") u WHERE value IS NOT NULL GROUP BY value) f)");
    };
    counted(
        &mut sql,
        "school",
        Facet::School,
        "to_jsonb(b.facet_school)",
        "",
    );
    sql.push(", ");
    counted(
        &mut sql,
        "descriptor",
        Facet::Descriptor,
        "to_jsonb(d)",
        ", unnest(b.facet_descriptors) d",
    );
    sql.push(", ");
    counted(
        &mut sql,
        "affects",
        Facet::Affects,
        "to_jsonb(a)",
        ", unnest(b.facet_affects) a",
    );
    sql.push(", ");
    counted(
        &mut sql,
        "discipline",
        Facet::Discipline,
        "to_jsonb(b.facet_discipline)",
        "",
    );
    sql.push(", ");
    counted(
        &mut sql,
        "maneuver_level",
        Facet::ManeuverLevel,
        "to_jsonb(b.facet_maneuver_level)",
        "",
    );
    sql.push(", ");
    let spell_lists =
        " JOIN entity_relation r ON r.from_id = b.id AND r.relation = 'on_spell_list'";
    counted(
        &mut sql,
        "list",
        Facet::List,
        "to_jsonb(r.to_id)",
        spell_lists,
    );
    sql.push(", ");
    counted(
        &mut sql,
        "level",
        Facet::Level,
        "CASE WHEN jsonb_typeof(r.extra -> 'level') = 'number' THEN r.extra -> 'level' END",
        spell_lists,
    );
    sql.push(")");
    let (facets,): (Value,) = sql.build_query_as().fetch_one(pool).await?;
    Ok(strip_null_names(facets))
}

/// Only entity ids (spell lists, skills) have a name; the other values drop the key instead of carrying `null`.
fn strip_null_names(mut facets: Value) -> Value {
    if let Some(groups) = facets.as_object_mut() {
        for values in groups.values_mut().filter_map(Value::as_array_mut) {
            for value in values.iter_mut().filter_map(Value::as_object_mut) {
                if value.get("name").is_some_and(Value::is_null) {
                    value.remove("name");
                }
            }
        }
    }
    facets
}
