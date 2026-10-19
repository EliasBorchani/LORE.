use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// Shape of an entity id (`feat.power_attack`). Statistic keys match too (`ability.str`): callers keep only the
/// candidates that are real entities.
static ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[a-z][a-z0-9_]*\.[a-z0-9_]+\b").unwrap());

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
}
