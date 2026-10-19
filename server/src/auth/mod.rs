//! Login and password, short-lived access tokens (JWT) and rotating refresh tokens (PRD 5.6).

pub mod password;
pub mod rate_limit;
pub mod routes;
pub mod tokens;
pub mod users;

use std::str::FromStr;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use jsonwebtoken::{DecodingKey, EncodingKey};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const ACCESS_TTL: time::Duration = time::Duration::minutes(15);
pub const REFRESH_TTL: time::Duration = time::Duration::days(30);
const MIN_SECRET_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Member,
    Admin,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Member => "member",
            Role::Admin => "admin",
        }
    }
}

impl FromStr for Role {
    type Err = anyhow::Error;

    fn from_str(text: &str) -> anyhow::Result<Self> {
        match text {
            "member" => Ok(Role::Member),
            "admin" => Ok(Role::Admin),
            other => anyhow::bail!("unknown role {other}"),
        }
    }
}

pub struct AuthConfig {
    pub encoding_key: EncodingKey,
    pub decoding_key: DecodingKey,
    pub access_ttl: time::Duration,
    pub refresh_ttl: time::Duration,
}

impl AuthConfig {
    pub fn new(secret: &[u8]) -> anyhow::Result<Self> {
        if secret.len() < MIN_SECRET_BYTES {
            anyhow::bail!("JWT_SECRET must be at least {MIN_SECRET_BYTES} bytes");
        }
        Ok(AuthConfig {
            encoding_key: EncodingKey::from_secret(secret),
            decoding_key: DecodingKey::from_secret(secret),
            access_ttl: ACCESS_TTL,
            refresh_ttl: REFRESH_TTL,
        })
    }
}

/// The logged-in user, set by the `require_user` middleware from the access token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentUser {
    pub id: i64,
    pub role: Role,
}

impl<S: Send + Sync> FromRequestParts<S> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, AppError> {
        parts
            .extensions
            .get::<CurrentUser>()
            .copied()
            .ok_or_else(|| AppError::Unauthorized("login required".into()))
    }
}
