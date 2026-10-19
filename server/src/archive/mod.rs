//! A full copy of the database as a folder of JSON files, one per entity and per character, history included.
//!
//! Exporting the same database always gives the same bytes (sorted keys and lists, fixed formats), so a move to
//! another machine is checked by exporting before and after and comparing the two folders.

pub mod export;
pub mod restore;

use std::fs;
use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

/// Bumped when the layout or a record changes; restore refuses formats it does not know.
pub const FORMAT: u32 = 2;
/// Formats restore still reads. 1: entity versions had no `relations`.
pub const READABLE_FORMATS: [u32; 2] = [1, 2];

pub const MANIFEST: &str = "manifest.json";
pub const ACCOUNTS: &str = "accounts.json";
pub const SECTIONS: &str = "catalog/sections";
pub const ENTITIES: &str = "catalog/entities";
pub const RELATIONS: &str = "catalog/relations.json";
pub const PROGRESSIONS: &str = "catalog/progressions";
pub const CHARACTERS: &str = "characters";

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: u32,
    /// Last database migration applied where the archive was made.
    pub schema: i64,
    pub counts: Counts,
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Counts {
    pub accounts: usize,
    pub sections: usize,
    pub entities: usize,
    pub entity_versions: usize,
    pub relations: usize,
    pub progression_rows: usize,
    pub characters: usize,
    pub character_versions: usize,
}

impl std::fmt::Display for Counts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} accounts, {} sections, {} entities ({} versions), {} relations, {} progression rows, {} characters ({} versions)",
            self.accounts,
            self.sections,
            self.entities,
            self.entity_versions,
            self.relations,
            self.progression_rows,
            self.characters,
            self.character_versions
        )
    }
}

/// `passwordHash` is an Argon2 hash: logins keep working after a move, and the file must be kept private.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: i64,
    pub login: String,
    pub password_hash: String,
    pub role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub disabled_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    pub name: String,
    pub content: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityFile {
    pub id: String,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub provenance: Option<String>,
    pub source: Option<String>,
    pub current_version: i32,
    pub versions: Vec<EntityVersion>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityVersion {
    pub version: i32,
    pub author: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub note: Option<String>,
    pub content: Value,
    /// The relations edited in the app, as they were at this version (format 2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relations: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterFile {
    pub id: Uuid,
    pub owner_id: i64,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// Kept exactly: it is the clients' sync token, so devices do not see every character as changed after a move.
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    pub version: i32,
    pub versions: Vec<CharacterVersion>,
    pub play: Play,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterVersion {
    pub version: i32,
    pub author_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub saved_at: OffsetDateTime,
    pub content: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Play {
    pub state: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

/// File name for an id: lowercase letters, digits, `_`, `-` and inner dots stay; every other byte is written `%XX`.
/// Uppercase is encoded too, so two ids differing only by case never meet on a case-insensitive disk (macOS).
pub fn file_name(id: &str) -> String {
    let mut name = String::new();
    for (i, byte) in id.bytes().enumerate() {
        let plain = byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || byte == b'_'
            || byte == b'-'
            || (byte == b'.' && i > 0);
        if plain {
            name.push(byte as char);
        } else {
            name.push_str(&format!("%{byte:02X}"));
        }
    }
    name
}

/// Pretty JSON with a final newline. serde_json keeps object keys sorted (no `preserve_order` feature), so the same
/// data always gives the same bytes.
pub fn write_json(path: &Path, value: &impl Serialize) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("cannot create {}", parent.display()))?;
    }
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    fs::write(path, text).with_context(|| format!("cannot write {}", path.display()))
}

pub fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> anyhow::Result<T> {
    let text =
        fs::read_to_string(path).with_context(|| format!("cannot read {}", path.display()))?;
    serde_json::from_str(&text)
        .with_context(|| format!("{} is not a valid archive file", path.display()))
}

#[cfg(test)]
mod tests {
    use super::file_name;

    #[test]
    fn file_names_are_safe_and_case_proof() {
        assert_eq!(file_name("feat.power_attack"), "feat.power_attack");
        assert_eq!(file_name("Feat.X"), "%46eat.%58");
        assert_eq!(file_name("../etc"), "%2E.%2Fetc");
        assert_eq!(file_name("épée"), "%C3%A9p%C3%A9e");
    }
}
