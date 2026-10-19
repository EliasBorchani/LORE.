//! The catalog as the engine reads it: top-level `entities`, `relations` and `progressions` live in their own tables;
//! every other top-level key is a section stored as is.

pub mod closure;
pub mod edit;
pub mod export;
pub mod import;
pub mod refs;

use serde_json::{Map, Value};

pub const ENTITIES: &str = "entities";
pub const RELATIONS: &str = "relations";
pub const PROGRESSIONS: &str = "progressions";

/// A stored relation back in the catalog format: `{from, relation, to}` plus its other fields (`level`, `note`…).
pub fn relation_json(from: String, to: String, relation: String, extra: Value) -> Value {
    let mut object = match extra {
        Value::Object(fields) => fields,
        _ => Map::new(),
    };
    object.insert("from".into(), from.into());
    object.insert("relation".into(), relation.into());
    object.insert("to".into(), to.into());
    Value::Object(object)
}
