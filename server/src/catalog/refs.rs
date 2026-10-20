use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// Shape of an entity id (`feat.power_attack`), with the ruleset slug of homebrew (`eberron:feat.dragon_blood`).
/// Statistic keys match too (`ability.str`): callers keep only the candidates that are real entities.
static ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:[a-z][a-z0-9_]*:)?[a-z][a-z0-9_]*\.[a-z0-9_]+\b").unwrap());

/// Collects every string that looks like an entity id, in values, object keys and inside formulas
/// (`active('toggle.bulls_strength')`), so a new reference field needs no code here.
pub fn collect_candidate_ids(value: &Value, out: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => scan(text, out),
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_candidate_ids(item, out)),
        Value::Object(fields) => {
            for (key, field) in fields {
                scan(key, out);
                collect_candidate_ids(field, out);
            }
        }
        _ => {}
    }
}

fn scan(text: &str, out: &mut BTreeSet<String>) {
    out.extend(ID.find_iter(text).map(|m| m.as_str().to_owned()));
}

/// Replaces every id of [map] wherever `collect_candidate_ids` would find it (values, keys, formulas), so a
/// renamed entity keeps every reference to it.
pub fn rewrite_ids(value: &Value, map: &BTreeMap<String, String>) -> Value {
    match value {
        Value::String(text) => Value::String(rewrite(text, map)),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| rewrite_ids(item, map)).collect())
        }
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, field)| (rewrite(key, map), rewrite_ids(field, map)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn rewrite(text: &str, map: &BTreeMap<String, String>) -> String {
    ID.replace_all(text, |found: &regex::Captures| {
        let id = &found[0];
        map.get(id).cloned().unwrap_or_else(|| id.to_owned())
    })
    .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_ids_in_values_keys_and_formulas() {
        let value = json!({
            "class.wizard": {"mode": "free_slots"},
            "condition": "active('toggle.bulls_strength') and has('feat.power_attack')",
            "target": "variant[spell.divine_favor].spell.numeric",
            "levels": [{"classId": "class.warblade", "level": 1}]
        });
        let mut ids = BTreeSet::new();
        collect_candidate_ids(&value, &mut ids);
        for id in [
            "class.wizard",
            "toggle.bulls_strength",
            "feat.power_attack",
            "spell.divine_favor",
            "class.warblade",
        ] {
            assert!(ids.contains(id), "{id} not found in {ids:?}");
        }
    }

    #[test]
    fn rewrites_ids_everywhere_but_inside_longer_ids() {
        let map = BTreeMap::from([
            (
                "feat.dragon_blood".to_owned(),
                "eberron:feat.dragon_blood".to_owned(),
            ),
            (
                "class.artificer".to_owned(),
                "eberron:class.artificer".to_owned(),
            ),
        ]);
        let value = json!({
            "class.artificer": {"x": "has('feat.dragon_blood') and has('feat.dragon_blood_plus')"},
            "target": "slots.base[class.artificer:3]",
            "kept": "other:feat.dragon_blood"
        });
        assert_eq!(
            rewrite_ids(&value, &map),
            json!({
                "eberron:class.artificer": {"x": "has('eberron:feat.dragon_blood') and has('feat.dragon_blood_plus')"},
                "target": "slots.base[eberron:class.artificer:3]",
                "kept": "other:feat.dragon_blood"
            })
        );
    }

    #[test]
    fn keeps_the_ruleset_slug_of_homebrew_ids() {
        let value = json!({
            "eberron:class.artificer": {"mode": "free_slots"},
            "condition": "has('eberron:feat.dragon_blood') and @eberron:skill.airship_piloting.ranks >= 5",
            "target": "slots.base[eberron:class.artificer:3]"
        });
        let mut ids = BTreeSet::new();
        collect_candidate_ids(&value, &mut ids);
        for id in [
            "eberron:class.artificer",
            "eberron:feat.dragon_blood",
            "eberron:skill.airship_piloting",
            "slots.base",
        ] {
            assert!(ids.contains(id), "{id} not found in {ids:?}");
        }
        for id in [
            "feat.dragon_blood",
            "class.artificer",
            "skill.airship_piloting",
        ] {
            assert!(!ids.contains(id), "{id} found alone in {ids:?}");
        }
    }
}
