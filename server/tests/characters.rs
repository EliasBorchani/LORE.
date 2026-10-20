mod common;

use std::path::Path;

use axum::Router;
use axum::http::StatusCode;
use common::{Reply, official, send, user_token};
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

/// The group « Table »: the GM is its admin, Alice plays (no permission on others' characters), Carol may see
/// them, Dan may edit them. Bob is in no group.
struct World {
    app: Router,
    group: String,
    alice: String,
    alice_id: i64,
    bob: String,
    carol: String,
    dan: String,
    gm: String,
}

async fn world(pool: &PgPool) -> World {
    let state = common::test_state(pool);
    let (alice_id, alice) = user_token(&state, "alice", Role::Member).await;
    let (_, bob) = user_token(&state, "bob", Role::Member).await;
    let (carol_id, carol) = user_token(&state, "carol", Role::Member).await;
    let (dan_id, dan) = user_token(&state, "dan", Role::Member).await;
    let (_, gm) = user_token(&state, "gm", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &gm, "Table").await;
    common::join(pool, &group, alice_id, &[]).await;
    common::join(pool, &group, carol_id, &["see_characters"]).await;
    common::join(pool, &group, dan_id, &["edit_characters"]).await;
    World {
        app,
        group,
        alice,
        alice_id,
        bob,
        carol,
        dan,
        gm,
    }
}

async fn create(world: &World, character: Value) -> Value {
    create_as(world, &world.alice, character).await
}

async fn create_as(world: &World, token: &str, character: Value) -> Value {
    let reply = send(
        &world.app,
        "POST",
        "/characters",
        Some(json!({ "groupId": world.group, "character": character })),
        Some(token),
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
async fn group_permissions_decide_who_reads_and_writes(pool: PgPool) {
    let world = world(&pool).await;
    let record = create(&world, golden("character.json")).await;
    assert_eq!(record["groupId"], json!(world.group));
    let bob = create_as(
        &world,
        &world.gm,
        json!({ "name": "PNJ", "baseAbilities": {} }),
    )
    .await;

    for uri in [
        path(&record, ""),
        path(&record, "/catalog"),
        path(&record, "/versions"),
    ] {
        let status = |token: &String| {
            let uri = uri.clone();
            let app = world.app.clone();
            let token = token.clone();
            async move { send(&app, "GET", &uri, None, Some(&token)).await.status }
        };
        assert_eq!(status(&world.bob).await, StatusCode::NOT_FOUND, "{uri}");
        for token in [&world.carol, &world.dan, &world.gm] {
            assert_eq!(status(token).await, StatusCode::OK, "{uri}");
        }
    }
    // Alice has no permission on the others' characters.
    let gm_character = send(&world.app, "GET", &path(&bob, ""), None, Some(&world.alice)).await;
    assert_eq!(gm_character.status, StatusCode::NOT_FOUND);

    let write = |token: &String| {
        let token = token.clone();
        let world = &world;
        let record = record.clone();
        async move {
            let current = send(
                &world.app,
                "GET",
                &path(&record, ""),
                None,
                Some(&world.alice),
            )
            .await;
            put(
                world,
                &token,
                &record,
                &current.body["updatedAt"],
                golden("character.json"),
            )
            .await
            .status
        }
    };
    assert_eq!(write(&world.bob).await, StatusCode::NOT_FOUND);
    assert_eq!(write(&world.carol).await, StatusCode::FORBIDDEN);
    assert_eq!(write(&world.dan).await, StatusCode::OK);
    assert_eq!(write(&world.gm).await, StatusCode::OK);
    let archive = send(
        &world.app,
        "POST",
        &path(&record, "/archive"),
        None,
        Some(&world.carol),
    )
    .await;
    assert_eq!(archive.status, StatusCode::FORBIDDEN);
    let archive = send(
        &world.app,
        "POST",
        &path(&record, "/archive"),
        None,
        Some(&world.bob),
    )
    .await;
    assert_eq!(archive.status, StatusCode::NOT_FOUND);
    let duplicate = send(
        &world.app,
        "POST",
        &path(&record, "/duplicate"),
        None,
        Some(&world.bob),
    )
    .await;
    assert_eq!(duplicate.status, StatusCode::NOT_FOUND);

    let copy = send(
        &world.app,
        "POST",
        &path(&record, "/duplicate"),
        None,
        Some(&world.carol),
    )
    .await;
    assert_eq!(copy.status, StatusCode::CREATED);
    assert_ne!(copy.body["id"], record["id"]);
    assert_ne!(copy.body["ownerId"], json!(world.alice_id));
    assert_eq!(copy.body["groupId"], json!(world.group));
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
    // A character is created only in a group of the caller.
    let outside = send(
        &world.app,
        "POST",
        "/characters",
        Some(json!({ "groupId": world.group, "character": golden("character.json") })),
        Some(&world.bob),
    )
    .await;
    assert_eq!(outside.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_member_who_leaves_keeps_their_characters_archived_and_can_move_them(pool: PgPool) {
    let world = world(&pool).await;
    let record = create(&world, golden("character.json")).await;
    let left = send(
        &world.app,
        "POST",
        &format!("/groups/{}/leave", world.group),
        None,
        Some(&world.alice),
    )
    .await;
    assert_eq!(left.status, StatusCode::NO_CONTENT);

    let mine = send(
        &world.app,
        "GET",
        &path(&record, ""),
        None,
        Some(&world.alice),
    )
    .await;
    assert_eq!(
        (mine.status, &mine.body["archived"]),
        (StatusCode::OK, &json!(true))
    );
    // Read-only for the others, even with « Edit characters ».
    let seen = send(
        &world.app,
        "GET",
        &path(&record, ""),
        None,
        Some(&world.dan),
    )
    .await;
    assert_eq!(seen.status, StatusCode::OK);
    let write = put(
        &world,
        &world.dan,
        &record,
        &mine.body["updatedAt"],
        golden("character.json"),
    )
    .await;
    assert_eq!(write.status, StatusCode::FORBIDDEN);

    let other = common::group(&world.app, &world.alice, "Nouvelle table").await;
    let moved = send(
        &world.app,
        "POST",
        &path(&record, "/move"),
        Some(json!({ "groupId": other })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(moved.status, StatusCode::OK, "{}", moved.body);
    assert_eq!(moved.body["groupId"], json!(other));
    let gone = send(
        &world.app,
        "GET",
        &path(&record, ""),
        None,
        Some(&world.dan),
    )
    .await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
    // Only into a group the owner is in.
    let refused = send(
        &world.app,
        "POST",
        &path(&record, "/move"),
        Some(json!({ "groupId": world.group })),
        Some(&world.alice),
    )
    .await;
    assert_eq!(refused.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_list_gives_my_characters_and_the_sync_delta(pool: PgPool) {
    let world = world(&pool).await;
    let first = create(&world, golden("character.json")).await;
    let mut other = golden("character.json");
    other["name"] = json!("Bérénice");
    other["levels"] = json!([]);
    let second = create(&world, other).await;
    create_as(&world, &world.gm, golden("character.json")).await;

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

    let in_group = format!("/characters?group={}", world.group);
    let everyone = send(&world.app, "GET", &in_group, None, Some(&world.gm))
        .await
        .body;
    assert_eq!(everyone.as_array().unwrap().len(), 3);
    let without_permission = send(&world.app, "GET", &in_group, None, Some(&world.alice))
        .await
        .body;
    assert_eq!(without_permission.as_array().unwrap().len(), 2);
    let stranger = send(&world.app, "GET", &in_group, None, Some(&world.bob)).await;
    assert_eq!(stranger.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_character_catalog_is_its_closure(pool: PgPool) {
    let world = world(&pool).await;
    import(&pool, &official(), &golden("catalog.json"), "test", None)
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
    import(&pool, &official(), &skill, "test", None)
        .await
        .unwrap();
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
            Some(json!({ "groupId": world.group, "character": character })),
            Some(&world.alice),
        )
        .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{character}");
    }
    let ok = send(
        &world.app,
        "POST",
        "/characters",
        Some(json!({ "groupId": world.group, "character": { "name": "X", "baseAbilities": {} } })),
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
