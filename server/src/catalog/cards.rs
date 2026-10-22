//! What a search result or list row shows on its card: the entity's content without its long text, the description's
//! first paragraph, a spell's levels, and the names of the entities it refers to, looked up once per page.

use std::collections::BTreeSet;

use serde_json::{Map, Value};
use sqlx::PgPool;

use super::refs::collect_candidate_ids;
use super::routes::{Reference, names};
use super::stack::Layers;
use crate::error::AppError;

const BLURB_CHARS: usize = 180;
/// Already on the result itself, or too long for a card.
const LEFT_OUT: [&str; 6] = ["id", "type", "name", "labels", "description", "note"];
/// Where a card's ids are: prerequisites and effects name feats, skills, states.
const WITH_IDS: [&str; 3] = ["prerequisite", "effects", "maneuver"];

/// The cards of a page, in order, from each entity's stored id and content, with the names they need.
pub async fn cards(
    pool: &PgPool,
    layers: &Layers,
    rows: Vec<(String, Value)>,
) -> Result<(Vec<Value>, Vec<Reference>), AppError> {
    let stored: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();
    let levels: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT from_id, to_id, coalesce(extra -> 'level', 'null') FROM entity_relation
         WHERE from_id = ANY($1) AND relation = 'on_spell_list' ORDER BY from_id, to_id",
    )
    .bind(&stored)
    .fetch_all(pool)
    .await?;

    let mut ids = BTreeSet::new();
    let mut cards = Vec::with_capacity(rows.len());
    for (id, content) in rows {
        let mut card = Map::new();
        if let Value::Object(fields) = content {
            for (key, value) in fields {
                if key == "description" {
                    if let Some(blurb) = blurb(&value) {
                        card.insert("blurb".into(), blurb);
                    }
                } else if !LEFT_OUT.contains(&key.as_str()) {
                    if WITH_IDS.contains(&key.as_str()) {
                        collect_candidate_ids(&value, &mut ids);
                    }
                    card.insert(key, value);
                }
            }
        }
        let spell_levels: Vec<Value> = levels
            .iter()
            .filter(|(from, _, _)| *from == id)
            .map(|(_, to, level)| {
                let list = layers.canonical(to).to_owned();
                ids.insert(list.clone());
                serde_json::json!({ "list": list, "level": level })
            })
            .collect();
        if !spell_levels.is_empty() {
            card.insert("spellLevels".into(), Value::Array(spell_levels));
        }
        cards.push(Value::Object(card));
    }
    let ids: Vec<String> = ids
        .iter()
        .map(|id| layers.stored(layers.canonical(id)).to_owned())
        .collect();
    // Statistic keys (`ability.str`) look like ids too: the query keeps only real entities.
    Ok((cards, names(pool, layers, &ids).await?))
}

/// Per language, the description's first paragraph, cut at a word near [BLURB_CHARS] with « … ».
fn blurb(description: &Value) -> Option<Value> {
    let Value::Object(texts) = description else {
        return None;
    };
    let blurbs: Map<String, Value> = texts
        .iter()
        .filter_map(|(lang, text)| {
            let paragraph = text
                .as_str()?
                .split("\n\n")
                .map(str::trim)
                .find(|p| !p.is_empty())?;
            Some((lang.clone(), Value::String(shorten(paragraph))))
        })
        .collect();
    (!blurbs.is_empty()).then_some(Value::Object(blurbs))
}

fn shorten(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= BLURB_CHARS {
        return text;
    }
    let cut: String = text.chars().take(BLURB_CHARS).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head);
    format!("{}…", cut.trim_end_matches([',', ';', ':', '.', ' ']))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn keeps_the_first_paragraph_of_each_language() {
        let blurb = blurb(
            &json!({"fr": "\n\nUne sphère de feu.\n\nEn jeu\n• 1d6 par niveau", "en": "A ball of fire."}),
        );
        assert_eq!(
            blurb,
            Some(json!({"fr": "Une sphère de feu.", "en": "A ball of fire."}))
        );
    }

    #[test]
    fn cuts_a_long_paragraph_at_a_word() {
        let long = "mot ".repeat(100);
        let text = shorten(&long);
        assert!(text.ends_with("mot…"), "{text}");
        assert!(text.chars().count() <= BLURB_CHARS + 1);
    }

    #[test]
    fn an_empty_description_has_no_blurb() {
        assert_eq!(blurb(&json!({"fr": "  "})), None);
        assert_eq!(blurb(&Value::Null), None);
    }
}
