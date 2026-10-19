mod common;

use std::path::Path;

use axum::Router;
use axum::http::StatusCode;
use common::{Reply, send, user_token};
use serde_json::{Value, json};
use server::auth::Role;
use server::catalog::import::import;
use sqlx::PgPool;

fn golden(file: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test-references/danalieth")
        .join(file);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

struct World {
    app: Router,
    alice: String,
    alice_id: i64,
    bob: String,
    gm: String,
}

async fn world(pool: &PgPool) -> World {
    let state = common::test_state(pool);
    let (alice_id, alice) = user_token(&state, "alice", Role::Member).await;
    let (_, bob) = user_token(&state, "bob", Role::Member).await;
    let (_, gm) = user_token(&state, "gm", Role::Admin).await;
    World {
        app: server::app(state),
        alice,
        alice_id,
        bob,
        gm,
    }
}

async fn create(world: &World, character: Value) -> Value {
    let reply = send(
        &world.app,
        "POST",
        "/characters",
        Some(json!({ "character": character })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
    reply.body
}

async fn put(
    world: &World,
    token: &str,
    record: &Value,
    updated_at: &Value,
    character: Value,
) -> Reply {
    let uri = format!("/characters/{}", record["id"].as_str().unwrap());
    send(
        &world.app,
        "PUT",
        &uri,
        Some(json!({ "updatedAt": updated_at, "character": character })),
        Some(token),
    )
    .await
}

fn path(record: &Value, rest: &str) -> String {
    format!("/characters/{}{rest}", record["id"].as_str().unwrap())
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_created_character_keeps_its_choices(pool: PgPool) {
    let world = world(&pool).await;
    let danalieth = golden("character.json");

    let record = create(&world, danalieth.clone()).await;
    let id = record["id"].as_str().unwrap();
    assert_eq!(record["ownerId"], json!(world.alice_id));
    assert_eq!(record["version"], json!(1));
    assert_eq!(record["archived"], json!(false));
    assert_eq!(record["play"]["state"], json!({}));

    let mut expected = danalieth;
    expected["id"] = json!(id);
    let got = send(
        &world.app,
        "GET",
        &path(&record, ""),
        None,
        Some(&world.alice),
    )
    .await;
    assert_eq!(got.status, StatusCode::OK);
    assert_eq!(got.body["character"], expected);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_stale_push_gets_the_current_record_and_history_keeps_versions(pool: PgPool) {
    let world = world(&pool).await;
    let original = golden("character.json");
    let first = create(&world, original.clone()).await;

    let mut changed = original.clone();
    changed["xp"] = json!(1_770_000);
    let second = put(
        &world,
        &world.alice,
        &first,
        &first["updatedAt"],
        changed.clone(),
    )
    .await;
    assert_eq!(second.status, StatusCode::OK);
    assert_eq!(second.body["version"], json!(2));
    assert_ne!(second.body["updatedAt"], first["updatedAt"]);

    let mut other_device = original.clone();
    other_device["xp"] = json!(1);
    let stale = put(
        &world,
        &world.alice,
        &first,
        &first["updatedAt"],
        other_device,
    )
    .await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    assert_eq!(stale.body["current"], second.body);

    let versions = send(
        &world.app,
        "GET",
        &path(&first, "/versions"),
        None,
        Some(&world.alice),
    )
    .await;
    let numbers: Vec<&Value> = versions
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|v| &v["version"])
        .collect();
    assert_eq!(numbers, [&json!(2), &json!(1)]);
    let old = send(
        &world.app,
        "GET",
        &path(&first, "/versions/1"),
        None,
        Some(&world.alice),
    )
    .await;
    assert_eq!(old.body["xp"], original["xp"]);
    assert_eq!(
        send(
            &world.app,
            "GET",
            &path(&first, "/versions/9"),
            None,
            Some(&world.alice)
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn play_state_has_its_own_sync_token(pool: PgPool) {
    let world = world(&pool).await;
    let record = create(&world, golden("character.json")).await;
    let base = record["play"]["updatedAt"].clone();

    let state = json!({ "damage": 57, "log": ["57 damage"] });
    let first = send(
        &world.app,
        "PUT",
        &path(&record, "/play"),
        Some(json!({ "updatedAt": base, "state": state })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(first.body["play"]["state"], state);
    assert_eq!(first.body["version"], json!(1));
    assert_eq!(first.body["updatedAt"], record["updatedAt"]);

    let stale = send(
        &world.app,
        "PUT",
        &path(&record, "/play"),
        Some(json!({ "updatedAt": base, "state": {} })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    assert_eq!(stale.body["current"]["play"]["state"], state);

    let not_object = send(
        &world.app,
        "PUT",
        &path(&record, "/play"),
        Some(json!({ "updatedAt": first.body["play"]["updatedAt"], "state": [1] })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(not_object.status, StatusCode::BAD_REQUEST);

    // Build changes keep working from their own token.
    let build = put(
        &world,
        &world.alice,
        &record,
        &record["updatedAt"],
        golden("character.json"),
    )
    .await;
    assert_eq!(build.status, StatusCode::OK);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn only_the_owner_writes_and_admins_read(pool: PgPool) {
    let world = world(&pool).await;
    let record = create(&world, golden("character.json")).await;

    for uri in [
        path(&record, ""),
        path(&record, "/catalog"),
        path(&record, "/versions"),
    ] {
        assert_eq!(
            send(&world.app, "GET", &uri, None, Some(&world.bob))
                .await
                .status,
            StatusCode::NOT_FOUND,
            "{uri}"
        );
        assert_eq!(
            send(&world.app, "GET", &uri, None, Some(&world.gm))
                .await
                .status,
            StatusCode::OK,
            "{uri}"
        );
    }
    for token in [&world.bob, &world.gm] {
        let write = put(
            &world,
            token,
            &record,
            &record["updatedAt"],
            golden("character.json"),
        )
        .await;
        assert_eq!(write.status, StatusCode::NOT_FOUND);
        let archive = send(
            &world.app,
            "POST",
            &path(&record, "/archive"),
            None,
            Some(token),
        )
        .await;
        assert_eq!(archive.status, StatusCode::NOT_FOUND);
    }
    assert_eq!(
        send(
            &world.app,
            "POST",
            &path(&record, "/duplicate"),
            None,
            Some(&world.bob)
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );

    let copy = send(
        &world.app,
        "POST",
        &path(&record, "/duplicate"),
        None,
        Some(&world.gm),
    )
    .await;
    assert_eq!(copy.status, StatusCode::CREATED);
    assert_ne!(copy.body["id"], record["id"]);
    assert_ne!(copy.body["ownerId"], json!(world.alice_id));
    assert_eq!(copy.body["character"]["name"], json!("Danalieth (copy)"));
    assert_eq!(copy.body["character"]["id"], copy.body["id"]);
    assert_eq!(copy.body["version"], json!(1));

    let unknown = send(
        &world.app,
        "GET",
        "/characters/00000000-0000-0000-0000-000000000000",
        None,
        Some(&world.gm),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_list_gives_my_characters_and_the_sync_delta(pool: PgPool) {
    let world = world(&pool).await;
    let first = create(&world, golden("character.json")).await;
    let mut other = golden("character.json");
    other["name"] = json!("Bérénice");
    other["levels"] = json!([]);
    let second = create(&world, other).await;
    send(
        &world.app,
        "POST",
        "/characters",
        Some(json!({ "character": golden("character.json") })),
        Some(&world.bob),
    )
    .await;

    let mine = send(&world.app, "GET", "/characters", None, Some(&world.alice))
        .await
        .body;
    let names: Vec<&Value> = mine
        .as_array()
        .unwrap()
        .iter()
        .map(|c| &c["name"])
        .collect();
    assert_eq!(names, [&json!("Bérénice"), &json!("Danalieth")]);
    assert_eq!(
        (&mine[0]["level"], &mine[1]["level"]),
        (&json!(0), &json!(59))
    );

    let since = first["updatedAt"].as_str().unwrap();
    let delta = send(
        &world.app,
        "GET",
        &format!("/characters?updatedSince={since}"),
        None,
        Some(&world.alice),
    )
    .await
    .body;
    let ids: Vec<&Value> = delta.as_array().unwrap().iter().map(|c| &c["id"]).collect();
    assert_eq!(ids, [&second["id"]]);

    let archived = send(
        &world.app,
        "POST",
        &path(&first, "/archive"),
        None,
        Some(&world.alice),
    )
    .await
    .body;
    assert_eq!(archived["archived"], json!(true));
    assert_eq!(archived["version"], json!(1));
    let mine = send(&world.app, "GET", "/characters", None, Some(&world.alice))
        .await
        .body;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    let with_archived = send(
        &world.app,
        "GET",
        "/characters?archived=true",
        None,
        Some(&world.alice),
    )
    .await
    .body;
    assert_eq!(with_archived.as_array().unwrap().len(), 2);
    let since = second["updatedAt"].as_str().unwrap();
    let delta = send(
        &world.app,
        "GET",
        &format!("/characters?updatedSince={since}"),
        None,
        Some(&world.alice),
    )
    .await
    .body;
    assert_eq!(delta[0]["id"], first["id"]);
    assert_eq!(delta[0]["archived"], json!(true));

    let restored = send(
        &world.app,
        "POST",
        &path(&first, "/restore"),
        None,
        Some(&world.alice),
    )
    .await
    .body;
    assert_eq!(restored["archived"], json!(false));

    let everyone = send(
        &world.app,
        "GET",
        "/characters?all=true",
        None,
        Some(&world.gm),
    )
    .await
    .body;
    assert_eq!(everyone.as_array().unwrap().len(), 3);
    let not_admin = send(
        &world.app,
        "GET",
        "/characters?all=true",
        None,
        Some(&world.alice),
    )
    .await
    .body;
    assert_eq!(not_admin.as_array().unwrap().len(), 2);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_character_catalog_is_its_closure(pool: PgPool) {
    let world = world(&pool).await;
    import(&pool, &golden("catalog.json"), "test", None)
        .await
        .unwrap();
    let record = create(&world, golden("character.json")).await;

    let catalog = send(
        &world.app,
        "GET",
        &path(&record, "/catalog"),
        None,
        Some(&world.alice),
    )
    .await;
    assert_eq!(catalog.status, StatusCode::OK);
    assert_eq!(catalog.body["missing"], json!([]));
    let entities = catalog.body["catalog"]["entities"].as_array().unwrap();
    assert_eq!(entities.len(), 80);
    assert!(entities.iter().any(|e| e["id"] == "class.warblade"));

    // Every skill comes along, even one no class of the character points to.
    let skill =
        json!({ "entities": [{ "id": "skill.swim", "type": "skill", "name": { "en": "Swim" } }] });
    import(&pool, &skill, "test", None).await.unwrap();
    let catalog = send(
        &world.app,
        "GET",
        &path(&record, "/catalog"),
        None,
        Some(&world.alice),
    )
    .await;
    let entities = catalog.body["catalog"]["entities"].as_array().unwrap();
    assert_eq!(entities.len(), 81);
    assert!(entities.iter().any(|e| e["id"] == "skill.swim"));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn characters_need_a_name_and_base_abilities(pool: PgPool) {
    let world = world(&pool).await;
    for character in [
        json!([1]),
        json!({ "baseAbilities": {} }),
        json!({ "name": " ", "baseAbilities": {} }),
        json!({ "name": "X" }),
    ] {
        let reply = send(
            &world.app,
            "POST",
            "/characters",
            Some(json!({ "character": character })),
            Some(&world.alice),
        )
        .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{character}");
    }
    let ok = send(
        &world.app,
        "POST",
        "/characters",
        Some(json!({ "character": { "name": "X", "baseAbilities": {} } })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(ok.status, StatusCode::CREATED);
    assert_eq!(
        send(&world.app, "GET", "/characters", None, None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
}
