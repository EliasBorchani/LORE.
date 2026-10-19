use axum::Json;
use axum::http::header::{RETRY_AFTER, WWW_AUTHENTICATE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
    /// Logged in, but this account may not do it.
    Forbidden(String),
    /// The record changed on the server since the client's copy; holds the server's current record.
    Conflict(Value),
    /// Something with that name exists already (an account for an invited email).
    AlreadyExists(String),
    /// Seconds to wait before trying again.
    TooManyRequests(u64),
    Database(sqlx::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        AppError::Database(error)
    }
}

fn error_body(message: &str) -> Json<Value> {
    Json(json!({ "error": message }))
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::NotFound(message) => (StatusCode::NOT_FOUND, error_body(&message)).into_response(),
            AppError::BadRequest(message) => (StatusCode::BAD_REQUEST, error_body(&message)).into_response(),
            AppError::Unauthorized(message) => (
                StatusCode::UNAUTHORIZED,
                [(WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"))],
                error_body(&message),
            )
                .into_response(),
            AppError::Forbidden(message) => (StatusCode::FORBIDDEN, error_body(&message)).into_response(),
            AppError::Conflict(current) => (
                StatusCode::CONFLICT,
                Json(json!({ "error": "changed on the server: take the current record", "current": current })),
            )
                .into_response(),
            AppError::AlreadyExists(message) => (StatusCode::CONFLICT, error_body(&message)).into_response(),
            AppError::TooManyRequests(seconds) => (
                StatusCode::TOO_MANY_REQUESTS,
                [(RETRY_AFTER, HeaderValue::from(seconds))],
                error_body("too many failed logins, try again later"),
            )
                .into_response(),
            AppError::Database(error) => {
                tracing::error!(%error, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, error_body("internal error")).into_response()
            }
        }
    }
}
