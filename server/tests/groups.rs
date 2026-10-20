mod common;

use axum::http::StatusCode;
use common::{send, user_token};
use serde_json::json;
use server::auth::Role;
use sqlx::PgPool;

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_moderator_manages_members_but_not_admins(pool: PgPool) {
    let state = common::test_state(&pool);
    let (admin_id, admin) = user_token(&state, "admin", Role::Member).await;
    let (moderator_id, moderator) = user_token(&state, "moderator", Role::Member).await;
    let (player_id, player) = user_token(&state, "player", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &admin, "Table").await;
    common::join(&pool, &group, moderator_id, &["moderator"]).await;
    common::join(&pool, &group, player_id, &[]).await;
    let set = |token: &str, user: i64, permissions: serde_json::Value| {
        let app = app.clone();
        let uri = format!("/groups/{group}/members/{user}");
        let token = token.to_owned();
        async move {
            send(
                &app,
                "PUT",
                &uri,
                Some(json!({ "permissions": permissions })),
                Some(&token),
            )
            .await
            .status
        }
    };

    assert_eq!(
        set(&moderator, player_id, json!(["see_characters", "invite"])).await,
        StatusCode::OK
    );
    assert_eq!(
        set(&moderator, player_id, json!(["admin"])).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        set(&moderator, admin_id, json!([])).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        set(&player, moderator_id, json!([])).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        set(&admin, player_id, json!(["nonsense"])).await,
        StatusCode::BAD_REQUEST
    );
    // The last admin keeps « admin » until there is another one.
    assert_eq!(
        set(&admin, admin_id, json!([])).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        set(&admin, moderator_id, json!(["admin"])).await,
        StatusCode::OK
    );
    assert_eq!(
        set(&admin, admin_id, json!(["see_characters"])).await,
        StatusCode::OK
    );

    let members = send(
        &app,
        "GET",
        &format!("/groups/{group}/members"),
        None,
        Some(&player),
    )
    .await
    .body;
    let permissions: Vec<(&str, &serde_json::Value)> = members
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (m["login"].as_str().unwrap(), &m["permissions"]))
        .collect();
    assert_eq!(
        permissions,
        [
            ("admin", &json!(["see_characters"])),
            ("moderator", &json!(["admin"])),
            ("player", &json!(["see_characters", "invite"]))
        ]
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn removing_a_member_archives_their_characters(pool: PgPool) {
    let state = common::test_state(&pool);
    let (_, admin) = user_token(&state, "admin", Role::Member).await;
    let (player_id, player) = user_token(&state, "player", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &admin, "Table").await;
    common::join(&pool, &group, player_id, &[]).await;
    let character = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "groupId": group, "character": { "name": "Bérénice", "baseAbilities": {} } })),
        Some(&player),
    )
    .await
    .body;

    let removed = send(
        &app,
        "DELETE",
        &format!("/groups/{group}/members/{player_id}"),
        None,
        Some(&admin),
    )
    .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
    let theirs = send(
        &app,
        "GET",
        &format!("/characters/{}", character["id"].as_str().unwrap()),
        None,
        Some(&player),
    )
    .await;
    assert_eq!(theirs.body["archived"], json!(true));
    let gone = send(
        &app,
        "GET",
        &format!("/groups/{group}"),
        None,
        Some(&player),
    )
    .await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
    // The last admin can't leave.
    let leave = send(
        &app,
        "POST",
        &format!("/groups/{group}/leave"),
        None,
        Some(&admin),
    )
    .await;
    assert_eq!(leave.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn creating_groups_and_rulesets_is_limited(pool: PgPool) {
    let state = common::test_state(&pool);
    let (id, token) = user_token(&state, "gm", Role::Member).await;
    let app = server::app(state);
    server::auth::users::set_limits(&pool, "gm", Some(1), Some(1), None)
        .await
        .unwrap();
    let group = common::group(&app, &token, "Table").await;
    let second = send(
        &app,
        "POST",
        "/groups",
        Some(json!({ "name": "Encore", "rpg": "dnd35" })),
        Some(&token),
    )
    .await;
    assert_eq!(second.status, StatusCode::FORBIDDEN);

    common::ruleset(&app, &token, &group, "maison", "private").await;
    let rulesets = [
        json!({ "slug": "autre", "name": "Autre", "rpg": "dnd35", "visibility": "private" }),
        json!({ "slug": "maison", "name": "Doublon", "rpg": "dnd35", "visibility": "private" }),
    ];
    for body in rulesets {
        let reply = send(&app, "POST", "/rulesets", Some(body), Some(&token)).await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{}", reply.body);
    }
    sqlx::query("UPDATE app_user SET max_rulesets = 5, max_groups = 5 WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let unknown_rpg = send(
        &app,
        "POST",
        "/groups",
        Some(json!({ "name": "Autre", "rpg": "dnd99" })),
        Some(&token),
    )
    .await;
    assert_eq!(unknown_rpg.status, StatusCode::BAD_REQUEST);
    for (body, status) in [
        (
            json!({ "slug": "maison", "name": "Doublon", "rpg": "dnd35", "visibility": "private" }),
            StatusCode::CONFLICT,
        ),
        (
            json!({ "slug": "x", "name": "Court", "rpg": "dnd35", "visibility": "private" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({ "slug": "ouvert", "name": "Ouvert", "rpg": "dnd35", "visibility": "secret" }),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let reply = send(&app, "POST", "/rulesets", Some(body), Some(&token)).await;
        assert_eq!(reply.status, status, "{}", reply.body);
    }
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_ruleset_owner_chooses_editors_among_people_they_play_with(pool: PgPool) {
    let state = common::test_state(&pool);
    let (_, owner) = user_token(&state, "owner", Role::Member).await;
    let (friend_id, friend) = user_token(&state, "friend", Role::Member).await;
    let (stranger_id, _) = user_token(&state, "stranger", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &owner, "Table").await;
    common::join(&pool, &group, friend_id, &[]).await;
    common::ruleset(&app, &owner, &group, "maison", "private").await;

    let refused = send(
        &app,
        "PUT",
        "/rulesets/maison/editors",
        Some(json!({ "editors": [stranger_id] })),
        Some(&owner),
    )
    .await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);
    // Without « Edit content », the friend only reads it.
    let write = |token: String| {
        let app = app.clone();
        async move {
            send(
                &app,
                "POST",
                "/entities",
                Some(json!({ "entity": { "id": "maison:feat.x", "type": "feat", "name": { "fr": "X" } }, "ruleset": "maison" })),
                Some(&token),
            )
            .await
            .status
        }
    };
    assert_eq!(write(friend.clone()).await, StatusCode::FORBIDDEN);
    let named = send(
        &app,
        "PUT",
        "/rulesets/maison/editors",
        Some(json!({ "editors": [friend_id] })),
        Some(&owner),
    )
    .await;
    assert_eq!(named.status, StatusCode::OK, "{}", named.body);
    assert_eq!(named.body["editors"][0]["login"], json!("friend"));
    assert_eq!(write(friend.clone()).await, StatusCode::OK);
    let mine = send(&app, "GET", "/rulesets", None, Some(&friend))
        .await
        .body;
    assert_eq!(mine[0]["access"], json!("edit"));

    // Archived: read-only for everyone.
    let archived = send(
        &app,
        "PATCH",
        "/rulesets/maison",
        Some(json!({ "archived": true })),
        Some(&owner),
    )
    .await;
    assert_eq!(archived.body["archived"], json!(true));
    let edit = send(
        &app,
        "PUT",
        "/entities/maison:feat.x",
        Some(json!({ "version": 1, "entity": { "id": "maison:feat.x", "type": "feat", "name": { "fr": "Y" } } })),
        Some(&friend),
    )
    .await;
    assert_eq!(edit.status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_archived_group_is_read_only_but_characters_can_move_out(pool: PgPool) {
    let state = common::test_state(&pool);
    let (_, admin) = user_token(&state, "admin", Role::Member).await;
    let (player_id, player) = user_token(&state, "player", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &admin, "Table").await;
    common::join(&pool, &group, player_id, &["edit_content"]).await;
    common::ruleset(&app, &admin, &group, "maison", "private").await;
    let character = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "groupId": group, "character": { "name": "Bérénice", "baseAbilities": {} } })),
        Some(&player),
    )
    .await
    .body;
    let id = character["id"].as_str().unwrap();
    let archived = send(
        &app,
        "PATCH",
        &format!("/groups/{group}"),
        Some(json!({ "archived": true })),
        Some(&admin),
    )
    .await;
    assert_eq!(archived.body["archived"], json!(true));

    let refused = [
        (
            "PUT",
            format!("/characters/{id}"),
            Some(
                json!({ "updatedAt": character["updatedAt"], "character": { "name": "X", "baseAbilities": {} } }),
            ),
        ),
        (
            "PUT",
            format!("/characters/{id}/play"),
            Some(json!({ "updatedAt": character["play"]["updatedAt"], "state": {} })),
        ),
        ("POST", format!("/characters/{id}/duplicate"), None),
        (
            "POST",
            "/characters".to_owned(),
            Some(json!({ "groupId": group, "character": { "name": "Y", "baseAbilities": {} } })),
        ),
        (
            "POST",
            "/entities".to_owned(),
            Some(
                json!({ "entity": { "id": "maison:feat.x", "type": "feat", "name": { "fr": "X" } }, "ruleset": "maison" }),
            ),
        ),
    ];
    for (method, uri, body) in refused {
        let reply = send(&app, method, &uri, body, Some(&player)).await;
        assert_eq!(
            reply.status,
            StatusCode::FORBIDDEN,
            "{method} {uri}: {}",
            reply.body
        );
    }
    for (method, uri, body) in [
        (
            "PUT",
            format!("/groups/{group}/rulesets"),
            Some(json!({ "rulesets": [] })),
        ),
        (
            "POST",
            format!("/groups/{group}/invitations"),
            Some(json!({ "email": "a@b.cd" })),
        ),
    ] {
        let reply = send(&app, method, &uri, body, Some(&admin)).await;
        assert_eq!(
            reply.status,
            StatusCode::FORBIDDEN,
            "{method} {uri}: {}",
            reply.body
        );
    }
    // Still readable, and its owner can take a character to a live group.
    let read = send(
        &app,
        "GET",
        &format!("/characters/{id}"),
        None,
        Some(&player),
    )
    .await;
    assert_eq!(read.status, StatusCode::OK);
    let other = common::group(&app, &player, "Nouvelle table").await;
    let moved = send(
        &app,
        "POST",
        &format!("/characters/{id}/move"),
        Some(json!({ "groupId": other })),
        Some(&player),
    )
    .await;
    assert_eq!(moved.status, StatusCode::OK, "{}", moved.body);
    // Not into an archived group.
    let back = send(
        &app,
        "POST",
        &format!("/characters/{id}/move"),
        Some(json!({ "groupId": group })),
        Some(&player),
    )
    .await;
    assert_eq!(back.status, StatusCode::FORBIDDEN);
}
