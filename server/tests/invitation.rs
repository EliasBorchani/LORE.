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
    let created = send(
        &app,
        "POST",
        "/characters",
        Some(json!({ "character": { "name": "Bérénice", "baseAbilities": {} } })),
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
