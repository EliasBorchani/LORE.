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
