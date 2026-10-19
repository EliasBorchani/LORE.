mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use common::{send, user_token};
use serde_json::{Value, json};
use server::archive::export::export;
use server::archive::restore::restore;
use server::auth::{Role, users};
use server::catalog::export::export_catalog;
use server::catalog::import::import;
use sqlx::PgPool;

fn golden(file: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test-references/danalieth")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// A fresh folder under the system temp directory, removed when dropped.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("lore-archive-{}", uuid::Uuid::new_v4())))
    }
    fn join(&self, path: &str) -> PathBuf {
        self.0.join(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Every file of a folder, by relative path.
fn files(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(
                    path.strip_prefix(root).unwrap().display().to_string(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn sorted(list: &Value) -> Vec<String> {
    let mut items: Vec<String> = list
        .as_array()
        .unwrap()
        .iter()
        .map(Value::to_string)
        .collect();
    items.sort();
    items
}

async fn empty_database(pool: &PgPool) {
    sqlx::query(
        "TRUNCATE app_user, refresh_token, entity, entity_version, entity_relation, progression_row, catalog_section,
                  player_character, player_character_version, player_character_play RESTART IDENTITY CASCADE",
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Catalog with history, three accounts (one admin, one disabled), characters with versions, archive and play state.
async fn fill(pool: &PgPool) -> String {
    let catalog = golden("catalog.json");
    import(pool, &catalog, "import", None).await.unwrap();
    let mut changed = catalog.clone();
    changed["entities"][0]["description"]["en"] = json!("A new English text.");
    import(pool, &changed, "owner", Some("English text"))
        .await
        .unwrap();

    let state = common::test_state(pool);
    let (_, alice) = user_token(&state, "alice", Role::Member).await;
    user_token(&state, "gm", Role::Admin).await;
    user_token(&state, "old", Role::Member).await;
    users::disable(pool, "old").await.unwrap();

    let app = server::app(state);
    let created = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "character": golden("character.json") })),
        Some(&alice),
    )
    .await
    .body;
    let id = created["id"].as_str().unwrap().to_owned();
    let mut next = golden("character.json");
    next["xp"] = json!(1_770_000);
    send(
        &app,
        "PUT",
        &format!("/characters/{id}"),
        Some(json!({ "updatedAt": created["updatedAt"], "character": next })),
        Some(&alice),
    )
    .await;
    send(
        &app,
        "PUT",
        &format!("/characters/{id}/play"),
        Some(json!({ "updatedAt": created["play"]["updatedAt"], "state": { "damage": 57 } })),
        Some(&alice),
    )
    .await;
    let other = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "character": { "name": "Bérénice", "baseAbilities": {} } })),
        Some(&alice),
    )
    .await
    .body;
    send(
        &app,
        "POST",
        &format!("/characters/{}/archive", other["id"].as_str().unwrap()),
        None,
        Some(&alice),
    )
    .await;
    id
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn export_catalog_gives_back_what_was_imported(pool: PgPool) {
    let catalog = golden("catalog.json");
    import(&pool, &catalog, "import", None).await.unwrap();

    let exported = export_catalog(&pool).await.unwrap();
    for key in ["entities", "relations", "progressions"] {
        assert_eq!(sorted(&exported[key]), sorted(&catalog[key]), "{key}");
    }
    for (key, value) in catalog.as_object().unwrap() {
        if !["entities", "relations", "progressions"].contains(&key.as_str()) {
            assert_eq!(&exported[key], value, "section {key}");
        }
    }
    let again = import(&pool, &exported, "import", None).await.unwrap();
    assert_eq!((again.created, again.updated), (0, 0));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn export_restore_export_gives_the_same_files(pool: PgPool) {
    let character_id = fill(&pool).await;
    let (first, second) = (TempDir::new(), TempDir::new());

    let before = export(&pool, &first.0).await.unwrap();
    assert_eq!(
        (
            before.accounts,
            before.entities,
            before.entity_versions,
            before.characters,
            before.character_versions
        ),
        (3, 92, 93, 2, 3)
    );
    assert!(
        first
            .join(&format!("characters/{character_id}.json"))
            .exists()
    );
    assert!(
        first
            .join("catalog/entities/class/class.warblade.json")
            .exists()
    );

    empty_database(&pool).await;
    let restored = restore(&pool, &first.0).await.unwrap();
    assert_eq!(restored, before);
    export(&pool, &second.0).await.unwrap();

    let (a, b) = (files(&first.0), files(&second.0));
    assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
    for (path, bytes) in &a {
        assert!(bytes == &b[path], "{path} differs after the round trip");
    }
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_restored_database_keeps_logins_history_and_ids(pool: PgPool) {
    let character_id = fill(&pool).await;
    let archive = TempDir::new();
    export(&pool, &archive.0).await.unwrap();
    empty_database(&pool).await;
    restore(&pool, &archive.0).await.unwrap();

    let state = common::test_state(&pool);
    let app = server::app(state.clone());
    let login = send(
        &app,
        "POST",
        "/auth/login",
        Some(json!({ "login": "alice", "password": "correct horse battery" })),
        None,
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let disabled = send(
        &app,
        "POST",
        "/auth/login",
        Some(json!({ "login": "old", "password": "correct horse battery" })),
        None,
    )
    .await;
    assert_eq!(disabled.status, StatusCode::UNAUTHORIZED);

    let token = login.body["accessToken"].as_str().unwrap();
    let versions = send(
        &app,
        "GET",
        &format!("/characters/{character_id}/versions"),
        None,
        Some(token),
    )
    .await;
    assert_eq!(versions.body.as_array().unwrap().len(), 2);
    let character = send(
        &app,
        "GET",
        &format!("/characters/{character_id}"),
        None,
        Some(token),
    )
    .await;
    assert_eq!(character.body["play"]["state"], json!({ "damage": 57 }));
    let entity = send(
        &app,
        "GET",
        "/entities/class.warblade/versions",
        None,
        Some(token),
    )
    .await;
    assert_eq!(entity.status, StatusCode::OK);

    let (new_id, _) = user_token(&state, "newcomer", Role::Member).await;
    assert_eq!(new_id, 4);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn restore_refuses_a_filled_database_an_unknown_format_and_a_broken_file(pool: PgPool) {
    let character_id = fill(&pool).await;
    let archive = TempDir::new();
    export(&pool, &archive.0).await.unwrap();

    let filled = restore(&pool, &archive.0).await.unwrap_err();
    assert!(filled.to_string().contains("not empty"), "{filled:#}");

    empty_database(&pool).await;
    let manifest_path = archive.join("manifest.json");
    let manifest = fs::read_to_string(&manifest_path).unwrap();
    fs::write(
        &manifest_path,
        manifest.replace("\"format\": 2", "\"format\": 99"),
    )
    .unwrap();
    let format = restore(&pool, &archive.0).await.unwrap_err();
    assert!(format.to_string().contains("format 99"), "{format:#}");
    // Format 1 had no relations in entity versions: it still restores.
    fs::write(
        &manifest_path,
        manifest.replace("\"format\": 2", "\"format\": 1"),
    )
    .unwrap();
    restore(&pool, &archive.0).await.unwrap();
    empty_database(&pool).await;
    fs::write(&manifest_path, manifest).unwrap();

    let broken = archive.join(&format!("characters/{character_id}.json"));
    fs::write(&broken, "{ not json").unwrap();
    let error = restore(&pool, &archive.0).await.unwrap_err();
    assert!(
        format!("{error:#}").contains(&format!("{character_id}.json")),
        "{error:#}"
    );
    let entities: i64 = sqlx::query_scalar("SELECT count(*) FROM entity")
        .fetch_one(&pool)
        .await
        .unwrap();
    let accounts: i64 = sqlx::query_scalar("SELECT count(*) FROM app_user")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        (entities, accounts),
        (0, 0),
        "nothing is kept from a failed restore"
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn export_refuses_a_folder_that_is_not_empty(pool: PgPool) {
    let archive = TempDir::new();
    fs::create_dir_all(&archive.0).unwrap();
    fs::write(archive.join("keep.txt"), "mine").unwrap();
    assert!(export(&pool, &archive.0).await.is_err());
    assert_eq!(
        fs::read_to_string(archive.join("keep.txt")).unwrap(),
        "mine"
    );
}
