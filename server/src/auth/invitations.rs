//! An admin invites someone by email (`server user invite`); the link lets them choose a password. The email becomes
//! the account's login.

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;

use super::tokens::{self, TokenPair};
use super::{AuthConfig, CurrentUser, Role, password};
use crate::error::AppError;

pub const INVITATION_TTL: time::Duration = time::Duration::days(7);

/// One message for unknown, used and expired links, so a caller learns nothing from the difference.
const INVALID: &str = "invitation invalid or expired";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub email: String,
    pub role: Role,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

pub struct Created {
    pub token: String,
    pub expires_at: OffsetDateTime,
}

/// Trimmed and lowercased: logins are case-insensitive, and one spelling keeps the list of accounts readable.
pub fn normalize_email(email: &str) -> anyhow::Result<String> {
    let email = email.trim().to_lowercase();
    let valid = match email.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty()
                && !domain.contains('@')
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
                && !email.chars().any(char::is_whitespace)
        }
        None => false,
    };
    if !valid {
        anyhow::bail!("{email}: not an email address");
    }
    Ok(email)
}

/// A new link replaces any pending one for the same email: only the newest works.
pub async fn create(pool: &PgPool, email: &str, role: Role) -> anyhow::Result<Created> {
    let email = normalize_email(email)?;
    let mut tx = pool.begin().await?;
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM app_user WHERE lower(login) = $1)")
            .bind(&email)
            .fetch_one(&mut *tx)
            .await?;
    if taken {
        anyhow::bail!("{email} already has an account");
    }
    sqlx::query("DELETE FROM invitation WHERE lower(email) = $1 AND used_at IS NULL")
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    let token = tokens::random_text(32);
    let expires_at = OffsetDateTime::now_utc() + INVITATION_TTL;
    sqlx::query(
        "INSERT INTO invitation (email, role, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(&email)
    .bind(role.as_str())
    .bind(tokens::hash_token(&token))
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Created { token, expires_at })
}

pub async fn find(pool: &PgPool, token: &str) -> Result<Invitation, AppError> {
    let row: Option<(String, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT email, role, expires_at FROM invitation
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
    )
    .bind(tokens::hash_token(token))
    .fetch_optional(pool)
    .await?;
    row.and_then(|(email, role, expires_at)| {
        Some(Invitation {
            email,
            role: role.parse().ok()?,
            expires_at,
        })
    })
    .ok_or_else(|| AppError::NotFound(INVALID.into()))
}

/// Creates the account and opens a session. A refused password leaves the invitation usable.
pub async fn accept(
    pool: &PgPool,
    config: &AuthConfig,
    token: &str,
    new_password: &str,
) -> Result<TokenPair, AppError> {
    password::check_policy(new_password)
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    // Checked before hashing: Argon2 is slow on purpose, and this route is open to anyone.
    find(pool, token).await?;
    let hash = password::hash_blocking(new_password.to_owned())
        .await
        .map_err(|error| {
            tracing::error!(%error, "cannot hash a password");
            AppError::BadRequest("cannot use this password".into())
        })?;

    let mut tx = pool.begin().await?;
    // FOR UPDATE: two clicks on the same link cannot both create the account.
    let (invitation_id, email, role): (i64, String, String) = sqlx::query_as(
        "SELECT id, email, role FROM invitation
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE",
    )
    .bind(tokens::hash_token(token))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(INVALID.into()))?;
    let role: Role = role
        .parse()
        .map_err(|_| AppError::NotFound(INVALID.into()))?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO app_user (login, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&email)
    .bind(hash)
    .bind(role.as_str())
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::AlreadyExists(format!("{email} already has an account"))
        }
        _ => error.into(),
    })?;
    sqlx::query("UPDATE invitation SET used_at = now() WHERE id = $1")
        .bind(invitation_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tokens::start_session(pool, config, CurrentUser { id, role }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails_are_trimmed_lowercased_and_checked() {
        assert_eq!(normalize_email("  Bob@Mail.COM ").unwrap(), "bob@mail.com");
        for wrong in [
            "bob",
            "@mail.com",
            "bob@mail",
            "bob@.com",
            "bob@mail.",
            "b ob@mail.com",
            "a@b@c.d",
        ] {
            assert!(normalize_email(wrong).is_err(), "{wrong}");
        }
    }
}
