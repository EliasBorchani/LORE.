//! `server migrate-groups` on today's shape: Danalieth's catalog (official and team content), a team variant of an
//! official feat, accounts with the old global roles, and characters without a group.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use common::official;
use serde_json::{Value, json};
use server::auth::{Role, users};
use server::catalog::closure::{Closure, closure_for};
use server::catalog::import::import;
use server::catalog::refs::rewrite_ids;
use server::catalog::stack::Layers;
use server::migrate::{Options, migrate_groups};
use sqlx::PgPool;
use uuid::Uuid;

fn golden(file: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test-references/danalieth")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn options() -> Options {
    Options {
        owner: "Elias@mail.com".into(),
        group_name: "La table".into(),
        ruleset_slug: "table".into(),
        ruleset_name: "Règles de la table".into(),
    }
}

/// A character as the app stored it before groups: no group.
async fn old_character(pool: &PgPool, owner: i64, content: &Value) -> Uuid {
    let id = Uuid::new_v4();
    let mut content = content.clone();
    content["id"] = json!(id.to_string());
    sqlx::query("INSERT INTO player_character (id, owner_id, name, content, version) VALUES ($1, $2, $3, $4, 1)")
        .bind(id)
        .bind(owner)
        .bind(content["name"].as_str().unwrap())
        .bind(&content)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO player_character_version (character_id, version, content, author_id) VALUES ($1, 1, $2, $3)")
        .bind(id)
        .bind(&content)
        .bind(owner)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO player_character_play (character_id, state) VALUES ($1, $2)")
        .bind(id)
        .bind(
            json!({ "used": { "power.vt_epic_spell": 1 }, "toggles": ["toggle.vt_grip_of_death"] }),
        )
        .execute(pool)
        .await
        .unwrap();
    id
}

struct Today {
    owner: i64,
    gm: i64,
    mira: i64,
    danalieth: Uuid,
    brute: Uuid,
}

async fn today(pool: &PgPool) -> Today {
    import(pool, &official(), &golden("catalog.json"), "import", None)
        .await
        .unwrap();
    // Danalieth does not have Cleave: her sheet must not change.
    let variant = json!({ "entities": [
        { "id": "feat.cleave", "type": "feat", "provenance": "official", "name": { "fr": "Enchaînement" } },
        { "id": "feat.cleave_team", "type": "feat", "provenance": "team", "name": { "fr": "Enchaînement (maison)" } }
    ], "relations": [
        { "from": "feat.cleave_team", "relation": "variant_of", "to": "feat.cleave" }
    ] });
    import(pool, &official(), &variant, "mira", None)
        .await
        .unwrap();
    let owner = users::create(pool, "elias@mail.com", "correct horse battery", Role::Admin)
        .await
        .unwrap();
    let gm = users::create(pool, "gm@mail.com", "correct horse battery", Role::Admin)
        .await
        .unwrap();
    let mira = users::create(pool, "mira@mail.com", "correct horse battery", Role::Member)
        .await
        .unwrap();
    let danalieth = old_character(pool, mira, &golden("character.json")).await;
    let brute = old_character(
        pool,
        gm,
        &json!({ "name": "Brute", "baseAbilities": {}, "choices": { "feats": ["feat.cleave_team"] } }),
    )
    .await;
    Today {
        owner,
        gm,
        mira,
        danalieth,
        brute,
    }
}

async fn character(pool: &PgPool, id: Uuid) -> (Value, i32, Option<String>) {
    sqlx::query_as("SELECT content, version, group_id FROM player_character WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Entities, relations and class table rows of a closure, each list sorted, so two closures compare whatever the
/// order their ids sort in.
fn normalized(closure: &Closure) -> Value {
    let mut out = closure.catalog.clone();
    for key in ["entities", "relations", "progressions"] {
        let mut items: Vec<String> = out[key]
            .as_array()
            .unwrap()
            .iter()
            .map(Value::to_string)
            .collect();
        items.sort();
        out[key] = json!(items);
    }
    out
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn todays_table_becomes_the_first_group_with_the_same_sheets(pool: PgPool) {
    let t = today(&pool).await;
    let before = closure_for(
        &pool,
        &Layers::official("dnd35"),
        &character(&pool, t.danalieth).await.0,
    )
    .await
    .unwrap();

    let dry = migrate_groups(&pool, &options(), false).await.unwrap();
    assert_eq!(dry.moved.len(), 31);
    let still_team: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM entity WHERE provenance = 'team' AND ruleset_id IS NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(still_team, 31, "a dry run writes nothing");

    let entities_before: i64 = sqlx::query_scalar("SELECT count(*) FROM entity")
        .fetch_one(&pool)
        .await
        .unwrap();
    let report = migrate_groups(&pool, &options(), true).await.unwrap();
    let group = report.group_id.clone().unwrap();
    assert_eq!(
        (
            report.members,
            report.characters,
            report.characters_rewritten
        ),
        (3, 2, 2)
    );
    assert_eq!(
        report.moved["class.vt_will_of_death"],
        "table:class.vt_will_of_death"
    );
    assert_eq!(report.moved["feat.cleave_team"], "table:feat.cleave");
    assert_eq!(
        report.overrides,
        BTreeMap::from([("table:feat.cleave".into(), "feat.cleave".into())])
    );
    let entities_after: i64 = sqlx::query_scalar("SELECT count(*) FROM entity")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(entities_after, entities_before);
    let kept: i64 = sqlx::query_scalar("SELECT count(*) FROM id_migration")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(kept, 31);

    // Roles: the owner is the platform admin; the other admin keeps their power in the group only.
    let roles: Vec<(i64, String, Vec<String>)> = sqlx::query_as(
        "SELECT u.id, u.role, m.permissions FROM app_user u JOIN group_member m ON m.user_id = u.id ORDER BY u.id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        roles,
        [
            (t.owner, "admin".into(), vec!["admin".into()]),
            (t.gm, "member".into(), vec!["admin".into()]),
            (
                t.mira,
                "member".into(),
                vec!["see_characters".into(), "edit_content".into()]
            ),
        ]
    );

    // Danalieth: a new version with the new ids, in the group, and the same closure once renamed.
    let (content, version, group_id) = character(&pool, t.danalieth).await;
    assert_eq!((version, group_id.as_deref()), (2, Some(group.as_str())));
    assert!(content.to_string().contains("table:class.vt_will_of_death"));
    let layers = Layers::for_group(&pool, &group).await.unwrap();
    let after = closure_for(&pool, &layers, &content).await.unwrap();
    assert_eq!(after.missing, Vec::<String>::new());
    let renamed = Closure {
        catalog: rewrite_ids(&before.catalog, &report.moved),
        versions: BTreeMap::new(),
        missing: Vec::new(),
        house_rules: BTreeMap::new(),
    };
    let (after, renamed) = (normalized(&after), normalized(&renamed));
    for (key, value) in after.as_object().unwrap() {
        if let (Some(items), Some(expected)) = (value.as_array(), renamed[key].as_array()) {
            let extra: Vec<&Value> = items.iter().filter(|i| !expected.contains(i)).collect();
            let lacking: Vec<&Value> = expected.iter().filter(|i| !items.contains(i)).collect();
            assert!(
                extra.is_empty() && lacking.is_empty(),
                "{key}: extra {extra:?}, lacking {lacking:?}"
            );
        } else {
            assert_eq!(value, &renamed[key], "{key}");
        }
    }
    let play: Value =
        sqlx::query_scalar("SELECT state FROM player_character_play WHERE character_id = $1")
            .bind(t.danalieth)
            .fetch_one(&pool)
            .await
            .unwrap();
    // Toggle ids are not entity ids: they stay.
    assert_eq!(
        play,
        json!({ "used": { "table:power.vt_epic_spell": 1 }, "toggles": ["toggle.vt_grip_of_death"] })
    );

    // The variant became a house rule: the character names the official id, and the group sends the house rule.
    let (brute, _, _) = character(&pool, t.brute).await;
    assert_eq!(brute["choices"]["feats"], json!(["feat.cleave"]));
    let closure = closure_for(&pool, &layers, &brute).await.unwrap();
    let feat = closure.catalog["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "feat.cleave")
        .unwrap();
    assert_eq!(feat["name"]["fr"], json!("Enchaînement (maison)"));
    assert_eq!(closure.house_rules["feat.cleave"].id, "table:feat.cleave");

    // Nothing left to do.
    let again = migrate_groups(&pool, &options(), true).await.unwrap();
    assert!(again.group_id.is_none());
}

/// A fresh folder under the system temp directory, removed when dropped.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn temp_dir() -> TempDir {
    TempDir(std::env::temp_dir().join(format!("lore-migration-{}", Uuid::new_v4())))
}

/// Turns a format 3 export of a database without groups into the format 2 layout today's server writes.
fn to_format_2(dir: &Path) {
    for folder in ["catalog/sections", "catalog/progressions"] {
        let rpg = dir.join(folder).join("dnd35");
        for entry in fs::read_dir(&rpg).unwrap() {
            let path = entry.unwrap().path();
            fs::rename(&path, dir.join(folder).join(path.file_name().unwrap())).unwrap();
        }
        fs::remove_dir(rpg).unwrap();
    }
    for file in ["rpgs.json", "rulesets.json", "groups.json"] {
        fs::remove_file(dir.join(file)).unwrap();
    }
    let mut manifest: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
    manifest["format"] = json!(2);
    manifest["counts"].as_object_mut().unwrap().remove("rpgs");
    fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_old_backup_restores_then_migrates(pool: PgPool) {
    let t = today(&pool).await;
    let old = temp_dir();
    server::archive::export::export(&pool, &old.0)
        .await
        .unwrap();
    to_format_2(&old.0);
    sqlx::query(
        "TRUNCATE app_user, refresh_token, entity, entity_version, entity_relation, progression_row, catalog_section,
                  player_character, player_character_version, player_character_play RESTART IDENTITY CASCADE",
    )
    .execute(&pool)
    .await
    .unwrap();

    server::archive::restore::restore(&pool, &old.0)
        .await
        .unwrap();
    let report = migrate_groups(&pool, &options(), true).await.unwrap();
    assert_eq!(report.moved.len(), 31);
    let (_, version, group) = character(&pool, t.danalieth).await;
    assert_eq!((version, group), (2, report.group_id));

    // The migrated database goes through export and restore with its id map.
    let new = temp_dir();
    let counts = server::archive::export::export(&pool, &new.0)
        .await
        .unwrap();
    assert_eq!(
        (counts.groups, counts.rulesets, counts.id_migrations),
        (1, 1, 31)
    );
    assert!(new.0.join("migration/id-map.json").exists());
}
