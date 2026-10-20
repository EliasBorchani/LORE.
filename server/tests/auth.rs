mod common;

use axum::Router;
use axum::http::StatusCode;
use common::{Reply, TEST_SECRET, send};
use jsonwebtoken::{EncodingKey, Header};
use serde_json::{Value, json};
use server::auth::tokens::Claims;
use server::auth::{Role, users};
use sqlx::PgPool;
use time::OffsetDateTime;

const PASSWORD: &str = "correct horse battery";

async fn setup(pool: &PgPool) -> Router {
    users::create(pool, "Elias", PASSWORD, Role::Admin)
        .await
        .unwrap();
    server::app(common::test_state(pool))
}

async fn login(app: &Router, login: &str, password: &str) -> Reply {
    send(
        app,
        "POST",
        "/auth/login",
        Some(json!({ "login": login, "password": password })),
        None,
    )
    .await
}

async fn refresh(app: &Router, token: &Value) -> Reply {
    send(
        app,
        "POST",
        "/auth/refresh",
        Some(json!({ "refreshToken": token })),
        None,
    )
    .await
}

fn signed(secret: &[u8], exp_from_now: i64) -> String {
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let claims = Claims {
        sub: "1".into(),
        role: Role::Member,
        iat: now,
        exp: now + exp_from_now,
    };
    jsonwebtoken::encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .unwrap()
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn login_gives_tokens_that_open_the_api(pool: PgPool) {
    let app = setup(&pool).await;

    let reply = login(&app, " elias ", PASSWORD).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["tokenType"], json!("Bearer"));
    assert_eq!(reply.body["expiresIn"], json!(900));
    let access = reply.body["accessToken"].as_str().unwrap();

    let me = send(&app, "GET", "/auth/me", None, Some(access)).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(
        (&me.body["login"], &me.body["role"]),
        (&json!("Elias"), &json!("admin"))
    );
    let core = send(&app, "GET", "/groups", None, Some(access)).await;
    assert_eq!(core.status, StatusCode::OK);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn wrong_password_and_unknown_login_look_the_same(pool: PgPool) {
    let app = setup(&pool).await;

    let wrong = login(&app, "elias", "wrong horse battery").await;
    let unknown = login(&app, "nobody", PASSWORD).await;
    for reply in [&wrong, &unknown] {
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
        assert_eq!(reply.body, json!({ "error": "invalid login or password" }));
        assert_eq!(reply.headers["www-authenticate"], "Bearer");
    }
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn content_needs_a_valid_access_token(pool: PgPool) {
    let app = setup(&pool).await;

    let other_secret = signed(b"another secret, also thirty-two bytes long", 600);
    let expired = signed(TEST_SECRET, -60);
    for token in [
        None,
        Some("garbage"),
        Some(other_secret.as_str()),
        Some(expired.as_str()),
    ] {
        let reply = send(&app, "GET", "/groups", None, token).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{token:?}");
        assert_eq!(reply.headers["www-authenticate"], "Bearer");
    }
    let valid = signed(TEST_SECRET, 600);
    assert_eq!(
        send(&app, "GET", "/groups", None, Some(&valid))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(&app, "GET", "/health", None, None).await.status,
        StatusCode::OK
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn refresh_rotates_and_a_reused_token_ends_the_session(pool: PgPool) {
    let app = setup(&pool).await;
    let first = login(&app, "elias", PASSWORD).await.body;

    let second = refresh(&app, &first["refreshToken"]).await;
    assert_eq!(second.status, StatusCode::OK);
    assert_ne!(second.body["refreshToken"], first["refreshToken"]);
    let access = second.body["accessToken"].as_str().unwrap();
    assert_eq!(
        send(&app, "GET", "/auth/me", None, Some(access))
            .await
            .status,
        StatusCode::OK
    );

    // Past the retry grace, presenting a used token again is theft: the whole session ends.
    sqlx::query(
        "UPDATE refresh_token SET used_at = now() - interval '1 minute' WHERE used_at IS NOT NULL",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        refresh(&app, &first["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        refresh(&app, &second.body["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );

    let other_session = login(&app, "elias", PASSWORD).await.body;
    assert_eq!(
        refresh(&app, &other_session["refreshToken"]).await.status,
        StatusCode::OK
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_lost_refresh_answer_can_be_retried_moments_later(pool: PgPool) {
    let app = setup(&pool).await;
    let first = login(&app, "elias", PASSWORD).await.body;
    // The answer to this refresh never reaches the client (a page reloaded mid-request).
    let lost = refresh(&app, &first["refreshToken"]).await.body;

    let retry = refresh(&app, &first["refreshToken"]).await;
    assert_eq!(retry.status, StatusCode::OK);
    // The session goes on with the retry's token.
    assert_eq!(
        refresh(&app, &retry.body["refreshToken"]).await.status,
        StatusCode::OK
    );
    // The token the client never received was revoked: only a copy could present it, so the session ends.
    assert_eq!(
        refresh(&app, &lost["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_retry_after_a_newer_token_was_used_is_theft(pool: PgPool) {
    let app = setup(&pool).await;
    let first = login(&app, "elias", PASSWORD).await.body;
    let second = refresh(&app, &first["refreshToken"]).await.body;
    let third = refresh(&app, &second["refreshToken"]).await.body;

    assert_eq!(
        refresh(&app, &first["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        refresh(&app, &third["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn logout_and_expiry_end_the_session(pool: PgPool) {
    let app = setup(&pool).await;
    let tokens = login(&app, "elias", PASSWORD).await.body;

    let logout = send(
        &app,
        "POST",
        "/auth/logout",
        Some(json!({ "refreshToken": tokens["refreshToken"] })),
        None,
    )
    .await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
    assert_eq!(
        refresh(&app, &tokens["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
    let unknown = send(
        &app,
        "POST",
        "/auth/logout",
        Some(json!({ "refreshToken": "unknown" })),
        None,
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NO_CONTENT);

    let tokens = login(&app, "elias", PASSWORD).await.body;
    sqlx::query("UPDATE refresh_token SET expires_at = now() - interval '1 second' WHERE revoked_at IS NULL")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        refresh(&app, &tokens["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn new_password_and_disabling_end_sessions(pool: PgPool) {
    let app = setup(&pool).await;

    let tokens = login(&app, "elias", PASSWORD).await.body;
    users::set_password(&pool, "ELIAS", "a brand new passphrase")
        .await
        .unwrap();
    assert_eq!(
        refresh(&app, &tokens["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, "elias", PASSWORD).await.status,
        StatusCode::UNAUTHORIZED
    );

    let tokens = login(&app, "elias", "a brand new passphrase").await.body;
    users::disable(&pool, "elias").await.unwrap();
    assert_eq!(
        refresh(&app, &tokens["refreshToken"]).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, "elias", "a brand new passphrase").await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn five_failed_logins_block_that_login(pool: PgPool) {
    let app = setup(&pool).await;
    users::create(&pool, "other", PASSWORD, Role::Member)
        .await
        .unwrap();

    for _ in 0..5 {
        assert_eq!(
            login(&app, "elias", "wrong horse battery").await.status,
            StatusCode::UNAUTHORIZED
        );
    }
    let blocked = login(&app, "Elias", PASSWORD).await;
    assert_eq!(blocked.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(
        blocked.headers["retry-after"]
            .to_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            > 0
    );
    assert_eq!(login(&app, "other", PASSWORD).await.status, StatusCode::OK);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn accounts_need_a_long_password_and_a_unique_login(pool: PgPool) {
    assert!(
        users::create(&pool, "elias", "short", Role::Member)
            .await
            .is_err()
    );
    assert!(
        users::create(&pool, "two words", PASSWORD, Role::Member)
            .await
            .is_err()
    );
    users::create(&pool, "elias", PASSWORD, Role::Member)
        .await
        .unwrap();
    let duplicate = users::create(&pool, "ELIAS", PASSWORD, Role::Member)
        .await
        .unwrap_err();
    assert_eq!(duplicate.to_string(), "ELIAS already exists");
}
