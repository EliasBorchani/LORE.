mod common;

use axum::Router;
use axum::http::StatusCode;
use common::{Reply, send, user_token};
use serde_json::json;
use server::auth::{Role, invitations, users};
use sqlx::PgPool;

const PASSWORD: &str = "a long enough passphrase";

async fn check(app: &Router, token: &str) -> Reply {
    send(
        app,
        "POST",
        "/auth/invitation",
        Some(json!({ "token": token })),
        None,
    )
    .await
}

async fn accept(app: &Router, token: &str, password: &str) -> Reply {
    send(
        app,
        "POST",
        "/auth/invitation/accept",
        Some(json!({ "token": token, "password": password })),
        None,
    )
    .await
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_invitation_creates_the_account_with_the_email_as_login(pool: PgPool) {
    let app = server::app(common::test_state(&pool));
    let invited = invitations::create(&pool, " Bob@Mail.com ", Role::Admin)
        .await
        .unwrap();

    let found = check(&app, &invited.token).await;
    assert_eq!(found.status, StatusCode::OK);
    assert_eq!(
        (&found.body["email"], &found.body["role"]),
        (&json!("bob@mail.com"), &json!("admin"))
    );

    let tokens = accept(&app, &invited.token, PASSWORD).await;
    assert_eq!(tokens.status, StatusCode::OK);
    let me = send(
        &app,
        "GET",
        "/auth/me",
        None,
        tokens.body["accessToken"].as_str(),
    )
    .await;
    assert_eq!(
        (&me.body["login"], &me.body["role"]),
        (&json!("bob@mail.com"), &json!("admin"))
    );
    let login = send(
        &app,
        "POST",
        "/auth/login",
        Some(json!({ "login": "BOB@mail.com", "password": PASSWORD })),
        None,
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);

    // A link works once.
    assert_eq!(
        check(&app, &invited.token).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        accept(&app, &invited.token, PASSWORD).await.status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn unknown_expired_and_replaced_links_look_the_same(pool: PgPool) {
    let app = server::app(common::test_state(&pool));
    let first = invitations::create(&pool, "bob@mail.com", Role::Member)
        .await
        .unwrap();
    let second = invitations::create(&pool, "bob@mail.com", Role::Member)
        .await
        .unwrap();
    let other = invitations::create(&pool, "carol@mail.com", Role::Member)
        .await
        .unwrap();
    sqlx::query("UPDATE invitation SET expires_at = now() - interval '1 second' WHERE email = 'carol@mail.com'")
        .execute(&pool)
        .await
        .unwrap();

    for token in [first.token.as_str(), other.token.as_str(), "made-up"] {
        let reply = check(&app, token).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{token}");
        assert_eq!(
            reply.body,
            json!({ "error": "invitation invalid or expired" })
        );
        assert_eq!(
            accept(&app, token, PASSWORD).await.status,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(check(&app, &second.token).await.status, StatusCode::OK);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_short_password_keeps_the_invitation_usable(pool: PgPool) {
    let app = server::app(common::test_state(&pool));
    let invited = invitations::create(&pool, "bob@mail.com", Role::Member)
        .await
        .unwrap();
    assert_eq!(
        accept(&app, &invited.token, "short").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        accept(&app, &invited.token, PASSWORD).await.status,
        StatusCode::OK
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_existing_account_cannot_be_invited_again(pool: PgPool) {
    let state = common::test_state(&pool);
    let app = server::app(state.clone());
    let invited = invitations::create(&pool, "bob@mail.com", Role::Member)
        .await
        .unwrap();
    // Created by hand while the invitation was pending.
    user_token(&state, "Bob@mail.com", Role::Member).await;

    let reply = accept(&app, &invited.token, PASSWORD).await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    let Err(again) = invitations::create(&pool, "bob@mail.com", Role::Member).await else {
        panic!("an existing account was invited");
    };
    assert!(again.to_string().contains("already has an account"));
    assert!(
        invitations::create(&pool, "not an email", Role::Member)
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_renamed_account_keeps_its_characters(pool: PgPool) {
    let state = common::test_state(&pool);
    let app = server::app(state.clone());
    let (_, token) = user_token(&state, "elias", Role::Admin).await;
    let group = common::group(&app, &token, "Table").await;
    let created = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "groupId": group, "character": { "name": "Bérénice", "baseAbilities": {} } })),
        Some(&token),
    )
    .await;
    assert_eq!(created.status, StatusCode::CREATED);

    users::rename(&pool, "Elias", "elias@mail.com")
        .await
        .unwrap();
    let login = send(
        &app,
        "POST",
        "/auth/login",
        Some(json!({ "login": "elias@mail.com", "password": "correct horse battery" })),
        None,
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let characters = send(
        &app,
        "GET",
        "/characters",
        None,
        login.body["accessToken"].as_str(),
    )
    .await;
    assert_eq!(characters.body.as_array().unwrap().len(), 1);

    user_token(&state, "other", Role::Member).await;
    assert!(
        users::rename(&pool, "other", "ELIAS@mail.com")
            .await
            .is_err()
    );
    assert!(users::rename(&pool, "nobody", "x@y.z").await.is_err());
}

/// An app that prints links instead of mailing them (no SMTP), so tests read the token.
fn app_with_links(pool: &PgPool) -> (server::AppState, Router) {
    let state = common::test_state(pool).with_mailer(server::state::Mailer {
        app_url: "http://lore.test".into(),
        smtp: None,
    });
    (state.clone(), server::app(state))
}

fn token_of(reply: &Reply) -> String {
    let link = reply.body["link"].as_str().unwrap();
    link.split_once('#').unwrap().1.to_owned()
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_group_invitation_creates_the_account_inside_the_group(pool: PgPool) {
    let (state, app) = app_with_links(&pool);
    let (_, gm) = user_token(&state, "gm", Role::Member).await;
    let group = common::group(&app, &gm, "Table").await;

    let invited = send(
        &app,
        "POST",
        &format!("/groups/{group}/invitations"),
        Some(json!({ "email": "Zoe@Mail.com", "permissions": ["see_characters", "invite"] })),
        Some(&gm),
    )
    .await;
    assert_eq!(invited.status, StatusCode::CREATED, "{}", invited.body);
    assert_eq!(
        (&invited.body["email"], &invited.body["sent"]),
        (&json!("zoe@mail.com"), &json!(false))
    );
    let token = token_of(&invited);
    let seen = check(&app, &token).await.body;
    assert_eq!(
        (&seen["group"]["name"], &seen["account"]),
        (&json!("Table"), &json!(false))
    );

    let session = accept(&app, &token, PASSWORD).await;
    assert_eq!(session.status, StatusCode::OK);
    let zoe = session.body["accessToken"].as_str().unwrap();
    let groups = send(&app, "GET", "/groups", None, Some(zoe)).await.body;
    assert_eq!(
        (&groups[0]["id"], &groups[0]["permissions"]),
        (&json!(group), &json!(["see_characters", "invite"]))
    );
    // Zoe may invite, but not choose permissions (« Moderator »): the invited get « See characters ».
    let chosen = send(
        &app,
        "POST",
        &format!("/groups/{group}/invitations"),
        Some(json!({ "email": "yann@mail.com", "permissions": ["admin"] })),
        Some(zoe),
    )
    .await;
    assert_eq!(chosen.status, StatusCode::FORBIDDEN);
    let plain = send(
        &app,
        "POST",
        &format!("/groups/{group}/invitations"),
        Some(json!({ "email": "yann@mail.com" })),
        Some(zoe),
    )
    .await;
    assert_eq!(plain.status, StatusCode::CREATED);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_existing_account_joins_once_logged_in(pool: PgPool) {
    let (state, app) = app_with_links(&pool);
    let (_, gm) = user_token(&state, "gm", Role::Member).await;
    let (_, bob) = user_token(&state, "bob@mail.com", Role::Member).await;
    let (_, eve) = user_token(&state, "eve@mail.com", Role::Member).await;
    let group = common::group(&app, &gm, "Table").await;
    let invited = send(
        &app,
        "POST",
        &format!("/groups/{group}/invitations"),
        Some(json!({ "email": "bob@mail.com" })),
        Some(&gm),
    )
    .await;
    let token = token_of(&invited);
    assert_eq!(check(&app, &token).await.body["account"], json!(true));
    assert_eq!(
        accept(&app, &token, PASSWORD).await.status,
        StatusCode::CONFLICT
    );

    let join = |who: String| {
        let app = app.clone();
        let token = token.clone();
        async move {
            send(
                &app,
                "POST",
                "/groups/join",
                Some(json!({ "token": token })),
                Some(&who),
            )
            .await
        }
    };
    // Another account holding the link gets the same answer as a wrong link.
    assert_eq!(join(eve).await.status, StatusCode::NOT_FOUND);
    let joined = join(bob.clone()).await;
    assert_eq!(joined.status, StatusCode::OK, "{}", joined.body);
    assert_eq!(joined.body["permissions"], json!(["see_characters"]));
    assert_eq!(join(bob).await.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn inviting_needs_the_permission_and_stays_under_the_cap(pool: PgPool) {
    let (state, app) = app_with_links(&pool);
    let (gm_id, gm) = user_token(&state, "gm", Role::Member).await;
    let (player_id, player) = user_token(&state, "player", Role::Member).await;
    let (_, stranger) = user_token(&state, "stranger", Role::Member).await;
    let group = common::group(&app, &gm, "Table").await;
    common::join(&pool, &group, player_id, &["see_characters"]).await;
    let invite = |token: String, email: &'static str| {
        let app = app.clone();
        let uri = format!("/groups/{group}/invitations");
        async move {
            send(
                &app,
                "POST",
                &uri,
                Some(json!({ "email": email })),
                Some(&token),
            )
            .await
            .status
        }
    };
    assert_eq!(invite(stranger, "a@mail.com").await, StatusCode::NOT_FOUND);
    assert_eq!(invite(player, "a@mail.com").await, StatusCode::FORBIDDEN);

    sqlx::query("UPDATE app_user SET max_pending_invites = 1 WHERE id = $1")
        .bind(gm_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(invite(gm.clone(), "a@mail.com").await, StatusCode::CREATED);
    assert_eq!(invite(gm, "b@mail.com").await, StatusCode::FORBIDDEN);
}
