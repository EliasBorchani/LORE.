#![allow(dead_code)] // Each test file uses a different part of these helpers.

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use server::AppState;
use server::auth::tokens::issue_access;
use server::auth::{AuthConfig, CurrentUser, Role};
use sqlx::PgPool;
use tower::ServiceExt;

pub const TEST_SECRET: &[u8] = b"test secret, at least thirty-two bytes long";

pub fn test_state(pool: &PgPool) -> AppState {
    AppState::new(pool.clone(), AuthConfig::new(TEST_SECRET).unwrap())
}

/// A valid access token without a stored user: the middleware only checks the signature and expiry.
pub fn member_token(state: &AppState) -> String {
    issue_access(
        &state.auth,
        CurrentUser {
            id: 1,
            role: Role::Member,
        },
    )
}

/// A stored user and an access token for it (no login round trip).
pub async fn user_token(state: &AppState, login: &str, role: Role) -> (i64, String) {
    let id = server::auth::users::create(&state.pool, login, "correct horse battery", role)
        .await
        .unwrap();
    (id, issue_access(&state.auth, CurrentUser { id, role }))
}

pub struct Reply {
    pub status: StatusCode,
    pub body: Value,
    pub headers: HeaderMap,
}

pub async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Reply {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let request = request
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        headers,
    }
}

/// Official D&D 3.5 content, the target of most test imports.
pub fn official() -> server::catalog::import::Target {
    server::catalog::import::Target::Official {
        rpg: "dnd35".into(),
    }
}

/// A D&D 3.5 group whose admin is `admin`; returns its id.
pub async fn group(app: &Router, admin_token: &str, name: &str) -> String {
    let reply = send(
        app,
        "POST",
        "/groups",
        Some(serde_json::json!({"name": name, "rpg": "dnd35"})),
        Some(admin_token),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
    reply.body["id"].as_str().unwrap().to_owned()
}

/// Puts an account into a group with these permissions, straight in the database (no invitation round trip).
pub async fn join(pool: &PgPool, group_id: &str, user_id: i64, permissions: &[&str]) {
    sqlx::query("INSERT INTO group_member (group_id, user_id, permissions) VALUES ($1, $2, $3)")
        .bind(group_id)
        .bind(user_id)
        .bind(
            permissions
                .iter()
                .map(|p| p.to_string())
                .collect::<Vec<_>>(),
        )
        .execute(pool)
        .await
        .unwrap();
}

/// A ruleset owned by the token's account, added to the group (whose admin that account must be).
pub async fn ruleset(app: &Router, token: &str, group_id: &str, slug: &str, visibility: &str) {
    let reply = send(
        app,
        "POST",
        "/rulesets",
        Some(serde_json::json!({"slug": slug, "name": slug, "rpg": "dnd35", "visibility": visibility})),
        Some(token),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
    let current = send(
        app,
        "GET",
        &format!("/groups/{group_id}"),
        None,
        Some(token),
    )
    .await;
    let mut slugs: Vec<Value> = current.body["rulesets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["slug"].clone())
        .collect();
    slugs.push(Value::String(slug.into()));
    let reply = send(
        app,
        "PUT",
        &format!("/groups/{group_id}/rulesets"),
        Some(serde_json::json!({ "rulesets": slugs })),
        Some(token),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.body);
}
