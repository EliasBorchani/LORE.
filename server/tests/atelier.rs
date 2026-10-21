mod common;

use axum::http::StatusCode;
use common::{official, send, user_token};
use serde_json::json;
use server::auth::Role;
use server::catalog::import::import;
use sqlx::PgPool;

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_draft_is_its_authors_alone(pool: PgPool) {
    let state = common::test_state(&pool);
    let (_, gm) = user_token(&state, "gm", Role::Member).await;
    let (player_id, player) = user_token(&state, "player", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &gm, "Table").await;
    common::join(&pool, &group, player_id, &["admin"]).await;

    let payload = json!({ "entity": { "id": "", "type": "feat", "name": { "fr": "Volonté de fer" } }, "ruleset": "maison" });
    let created = send(
        &app,
        "POST",
        &format!("/groups/{group}/drafts"),
        Some(json!({ "payload": payload })),
        Some(&gm),
    )
    .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.body);
    let id = created.body["id"].as_str().unwrap();
    let uri = format!("/groups/{group}/drafts/{id}");

    let list = send(
        &app,
        "GET",
        &format!("/groups/{group}/drafts"),
        None,
        Some(&gm),
    )
    .await;
    assert_eq!(list.body[0]["type"], "feat");
    assert_eq!(list.body[0]["name"]["fr"], "Volonté de fer");
    // Another member, even an admin of the group, sees nothing.
    let theirs = send(
        &app,
        "GET",
        &format!("/groups/{group}/drafts"),
        None,
        Some(&player),
    )
    .await;
    assert_eq!(theirs.body, json!([]));
    for (method, body) in [
        ("GET", None),
        ("PUT", Some(json!({ "payload": {} }))),
        ("DELETE", None),
    ] {
        let reply = send(&app, method, &uri, body, Some(&player)).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{method}");
    }

    let updated = send(
        &app,
        "PUT",
        &uri,
        Some(json!({ "payload": { "entity": { "type": "feat", "name": { "fr": "Volonté d'acier" } } } })),
        Some(&gm),
    )
    .await;
    assert_eq!(updated.status, StatusCode::OK);
    assert!(updated.body["updatedAt"].as_str() > created.body["updatedAt"].as_str());
    let bad = send(
        &app,
        "PUT",
        &uri,
        Some(json!({ "payload": [1] })),
        Some(&gm),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);

    sqlx::query("UPDATE lore_group SET archived_at = now() WHERE id = $1")
        .bind(&group)
        .execute(&pool)
        .await
        .unwrap();
    let frozen = send(&app, "PUT", &uri, Some(json!({ "payload": {} })), Some(&gm)).await;
    assert_eq!(frozen.status, StatusCode::FORBIDDEN);
    let deleted = send(&app, "DELETE", &uri, None, Some(&gm)).await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);
    let gone = send(&app, "GET", &uri, None, Some(&gm)).await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn states_and_changes_follow_the_groups_layers(pool: PgPool) {
    let catalog = json!({
        "entities": [
            { "id": "power.rage", "type": "class_power", "name": { "fr": "Rage" },
              "effects": [{ "target": "ability.str.score", "op": "add", "value": 4, "bonusType": "morale",
                            "condition": "active('toggle.rage')" }] },
            { "id": "feat.iron_will", "type": "feat", "name": { "fr": "Volonté de fer" },
              "effects": [{ "target": "save.will", "op": "add", "value": 2, "bonusType": "untyped",
                            "situation": "situation.vs_poison" }] }
        ]
    });
    import(&pool, &official(), &catalog, "import", None)
        .await
        .unwrap();
    let state = common::test_state(&pool);
    let (_, gm) = user_token(&state, "gm", Role::Member).await;
    let (_, other) = user_token(&state, "other", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &gm, "Table").await;
    let elsewhere = common::group(&app, &other, "Ailleurs").await;
    common::ruleset(&app, &gm, &group, "maison", "private").await;
    let saved = send(
        &app,
        "POST",
        "/entities",
        Some(json!({ "entity": { "id": "maison:feat.fury", "type": "feat", "name": { "fr": "Furie" },
            "effects": [{ "target": "attack.all", "op": "add", "value": 1, "bonusType": "morale",
                          "condition": "active('maison:toggle.fury') and active('toggle.rage')" }] },
            "ruleset": "maison", "note": "première version" })),
        Some(&gm),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.body);

    let states = send(
        &app,
        "GET",
        &format!("/groups/{group}/catalog/states"),
        None,
        Some(&gm),
    )
    .await;
    assert_eq!(states.status, StatusCode::OK);
    let ids: Vec<(&str, &str, u64)> = states
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["id"].as_str().unwrap(),
                s["kind"].as_str().unwrap(),
                s["count"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        ids,
        [
            ("maison:toggle.fury", "toggle", 1),
            ("situation.vs_poison", "situation", 1),
            ("toggle.rage", "toggle", 2),
        ]
    );
    assert_eq!(states.body[2]["usedBy"][0]["id"], "maison:feat.fury");
    // Another group doesn't use the ruleset: its state is not there.
    let theirs = send(
        &app,
        "GET",
        &format!("/groups/{elsewhere}/catalog/states"),
        None,
        Some(&other),
    )
    .await;
    assert_eq!(theirs.body.as_array().unwrap().len(), 2);

    let changes = send(
        &app,
        "GET",
        &format!("/groups/{group}/changes"),
        None,
        Some(&gm),
    )
    .await;
    assert_eq!(changes.status, StatusCode::OK);
    assert_eq!(changes.body[0]["id"], "maison:feat.fury");
    assert_eq!(changes.body[0]["author"], "gm");
    assert_eq!(changes.body[0]["note"], "première version");
    assert_eq!(changes.body[0]["ruleset"], "maison");
    let none = send(
        &app,
        "GET",
        &format!("/groups/{elsewhere}/changes"),
        None,
        Some(&other),
    )
    .await;
    assert_eq!(none.body, json!([]));
}
