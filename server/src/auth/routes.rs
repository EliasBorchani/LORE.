use std::sync::Arc;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use super::tokens::{self, TokenPair};
use super::{AuthConfig, CurrentUser, Role, password, users};
use crate::error::AppError;
use crate::state::AppState;

/// Every route behind this middleware needs a valid access token (`Authorization: Bearer <token>`).
pub async fn require_user(
    State(config): State<Arc<AuthConfig>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let user = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .and_then(|token| tokens::verify_access(&config, token))
        .ok_or_else(|| AppError::Unauthorized("invalid or expired access token".into()))?;
    request.extensions_mut().insert(user);
    Ok(next.run(request).await)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    login: String,
    password: String,
}

/// One message for every failure, so a caller cannot tell an unknown login from a wrong password.
const LOGIN_FAILED: &str = "invalid login or password";

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<TokenPair>, AppError> {
    if let Err(wait) = state.login_limiter.check(&body.login) {
        return Err(AppError::TooManyRequests(wait.as_secs().max(1)));
    }
    let user = users::find_by_login(&state.pool, &body.login).await?;
    let hash = user.as_ref().map(|user| user.password_hash.clone());
    let password_ok = password::verify_blocking(body.password, hash).await;
    match user {
        Some(user) if password_ok && !user.disabled => {
            state.login_limiter.success(&body.login);
            let pair = tokens::start_session(
                &state.pool,
                &state.auth,
                CurrentUser {
                    id: user.id,
                    role: user.role,
                },
            )
            .await?;
            Ok(Json(pair))
        }
        _ => {
            state.login_limiter.failure(&body.login);
            Err(AppError::Unauthorized(LOGIN_FAILED.into()))
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RefreshRequest {
    refresh_token: String,
}

pub async fn refresh(
    State(pool): State<PgPool>,
    State(config): State<Arc<AuthConfig>>,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<TokenPair>, AppError> {
    Ok(Json(
        tokens::refresh(&pool, &config, &body.refresh_token).await?,
    ))
}

pub async fn logout(
    State(pool): State<PgPool>,
    Json(body): Json<RefreshRequest>,
) -> Result<StatusCode, AppError> {
    tokens::logout(&pool, &body.refresh_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct Me {
    id: i64,
    login: String,
    role: Role,
}

pub async fn me(State(pool): State<PgPool>, user: CurrentUser) -> Result<Json<Me>, AppError> {
    let login: String = sqlx::query_scalar("SELECT login FROM app_user WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("unknown user".into()))?;
    Ok(Json(Me {
        id: user.id,
        login,
        role: user.role,
    }))
}
