//! Isolation between groups (docs/prd-multi.md, section 8): someone outside a group, a private ruleset or a
//! character gets 404 on every endpoint that names it, as if it did not exist. A new endpoint goes into this list.

mod common;

use axum::http::StatusCode;
use common::{official, send, user_token};
use serde_json::{Value, json};
use server::auth::Role;
use server::catalog::import::import;
use sqlx::PgPool;

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_stranger_gets_404_everywhere(pool: PgPool) {
    let catalog = json!({
        "entities": [
            { "id": "feat.power_attack", "type": "feat", "name": { "en": "Power Attack" } },
            { "id": "class.wizard", "type": "class", "name": { "en": "Wizard" }, "hitDie": 4 }
        ]
    });
    import(&pool, &official(), &catalog, "test", None)
        .await
        .unwrap();
    let state = common::test_state(&pool);
    let (gm_id, gm) = user_token(&state, "gm", Role::Member).await;
    let (_, stranger) = user_token(&state, "stranger", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &gm, "Table").await;
    common::ruleset(&app, &gm, &group, "maison", "private").await;
    let saved = send(
        &app,
        "POST",
        "/entities",
        Some(json!({ "entity": { "id": "maison:feat.secret", "type": "feat", "name": { "fr": "Secret" } }, "ruleset": "maison" })),
        Some(&gm),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK);
    let character = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "groupId": group, "character": { "name": "Bérénice", "baseAbilities": {} } })),
        Some(&gm),
    )
    .await
    .body;
    let c = character["id"].as_str().unwrap();
    let at = &character["updatedAt"];
    let play_at = &character["play"]["updatedAt"];
    let other = common::group(&app, &stranger, "Ailleurs").await;

    let g = &group;
    let calls: Vec<(&str, String, Option<Value>)> = vec![
        ("GET", format!("/groups/{g}"), None),
        (
            "PATCH",
            format!("/groups/{g}"),
            Some(json!({ "name": "x" })),
        ),
        ("GET", format!("/groups/{g}/members"), None),
        (
            "PUT",
            format!("/groups/{g}/members/{gm_id}"),
            Some(json!({ "permissions": [] })),
        ),
        ("DELETE", format!("/groups/{g}/members/{gm_id}"), None),
        ("POST", format!("/groups/{g}/leave"), None),
        (
            "PUT",
            format!("/groups/{g}/rulesets"),
            Some(json!({ "rulesets": [] })),
        ),
        (
            "POST",
            format!("/groups/{g}/invitations"),
            Some(json!({ "email": "a@b.cd" })),
        ),
        ("GET", format!("/groups/{g}/drafts"), None),
        (
            "POST",
            format!("/groups/{g}/drafts"),
            Some(json!({ "payload": {} })),
        ),
        ("GET", format!("/groups/{g}/changes"), None),
        ("GET", format!("/groups/{g}/catalog/states"), None),
        ("GET", format!("/groups/{g}/catalog/counts"), None),
        ("GET", format!("/groups/{g}/catalog/core"), None),
        (
            "POST",
            format!("/groups/{g}/catalog/closure"),
            Some(json!({ "roots": ["feat.power_attack"] })),
        ),
        (
            "GET",
            format!("/groups/{g}/catalog/spell-list/class.wizard"),
            None,
        ),
        (
            "GET",
            format!("/groups/{g}/catalog/maneuvers/class.warblade"),
            None,
        ),
        ("GET", format!("/groups/{g}/entities"), None),
        ("GET", format!("/groups/{g}/search?q=power"), None),
        (
            "GET",
            format!("/groups/{g}/entities/feat.power_attack"),
            None,
        ),
        (
            "GET",
            format!("/groups/{g}/entities/feat.power_attack/versions"),
            None,
        ),
        ("GET", "/rulesets/maison".into(), None),
        (
            "PATCH",
            "/rulesets/maison".into(),
            Some(json!({ "name": "x" })),
        ),
        (
            "PUT",
            "/rulesets/maison/editors".into(),
            Some(json!({ "editors": [] })),
        ),
        ("GET", "/rulesets/maison/entities".into(), None),
        (
            "POST",
            "/entities".into(),
            Some(
                json!({ "entity": { "id": "maison:feat.x", "type": "feat", "name": { "fr": "X" } }, "ruleset": "maison" }),
            ),
        ),
        (
            "PUT",
            "/entities/maison:feat.secret".into(),
            Some(
                json!({ "version": 1, "entity": { "id": "maison:feat.secret", "type": "feat", "name": { "fr": "X" } } }),
            ),
        ),
        ("GET", format!("/characters?group={g}"), None),
        ("GET", format!("/characters/{c}"), None),
        (
            "PUT",
            format!("/characters/{c}"),
            Some(json!({ "updatedAt": at, "character": { "name": "X", "baseAbilities": {} } })),
        ),
        (
            "PUT",
            format!("/characters/{c}/play"),
            Some(json!({ "updatedAt": play_at, "state": {} })),
        ),
        ("POST", format!("/characters/{c}/archive"), None),
        ("POST", format!("/characters/{c}/restore"), None),
        ("POST", format!("/characters/{c}/duplicate"), None),
        (
            "POST",
            format!("/characters/{c}/move"),
            Some(json!({ "groupId": other })),
        ),
        ("GET", format!("/characters/{c}/versions"), None),
        ("GET", format!("/characters/{c}/versions/1"), None),
        ("GET", format!("/characters/{c}/catalog"), None),
        (
            "POST",
            "/characters".into(),
            Some(json!({ "groupId": g, "character": { "name": "X", "baseAbilities": {} } })),
        ),
    ];
    for (method, uri, body) in calls {
        let reply = send(&app, method, &uri, body, Some(&stranger)).await;
        assert_eq!(
            reply.status,
            StatusCode::NOT_FOUND,
            "{method} {uri}: {}",
            reply.body
        );
    }
    // The stranger's own group does not see the private ruleset's entities either.
    let reply = send(
        &app,
        "GET",
        &format!("/groups/{other}/entities/maison:feat.secret"),
        None,
        Some(&stranger),
    )
    .await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    // Nor add the private ruleset to it.
    let reply = send(
        &app,
        "PUT",
        &format!("/groups/{other}/rulesets"),
        Some(json!({ "rulesets": ["maison"] })),
        Some(&stranger),
    )
    .await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    // Everything above still works for the group's admin (the 404s were not for everyone).
    let reply = send(&app, "GET", &format!("/characters/{c}"), None, Some(&gm)).await;
    assert_eq!(reply.status, StatusCode::OK);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_public_ruleset_is_read_and_added_by_anyone_but_edited_by_its_editors(pool: PgPool) {
    let state = common::test_state(&pool);
    let (_, owner) = user_token(&state, "owner", Role::Member).await;
    let (_, other) = user_token(&state, "other", Role::Member).await;
    let app = server::app(state);
    let mine = common::group(&app, &owner, "Ma table").await;
    common::ruleset(&app, &owner, &mine, "monde", "public").await;
    let theirs = common::group(&app, &other, "Leur table").await;

    let seen = send(&app, "GET", "/rulesets/monde", None, Some(&other)).await;
    assert_eq!(
        (seen.status, &seen.body["access"]),
        (StatusCode::OK, &json!("read"))
    );
    assert_eq!(seen.body.get("editors"), None);
    let added = send(
        &app,
        "PUT",
        &format!("/groups/{theirs}/rulesets"),
        Some(json!({ "rulesets": ["monde"] })),
        Some(&other),
    )
    .await;
    assert_eq!(added.status, StatusCode::OK, "{}", added.body);
    let write = send(
        &app,
        "POST",
        "/entities",
        Some(json!({ "entity": { "id": "monde:feat.x", "type": "feat", "name": { "fr": "X" } }, "ruleset": "monde" })),
        Some(&other),
    )
    .await;
    assert_eq!(write.status, StatusCode::FORBIDDEN);
}
