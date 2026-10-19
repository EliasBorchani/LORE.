use anyhow::Context;
use sqlx::PgPool;

use super::{Role, password, tokens};

pub struct LoginRow {
    pub id: i64,
    pub password_hash: String,
    pub role: Role,
    pub disabled: bool,
}

/// Logins are case-insensitive: "Elias" and "elias" are the same account.
pub async fn find_by_login(pool: &PgPool, login: &str) -> Result<Option<LoginRow>, sqlx::Error> {
    let row: Option<(i64, String, String, bool)> = sqlx::query_as(
        "SELECT id, password_hash, role, disabled_at IS NOT NULL FROM app_user WHERE lower(login) = lower($1)",
    )
    .bind(login.trim())
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(id, password_hash, role, disabled)| {
        Some(LoginRow {
            id,
            password_hash,
            role: role.parse().ok()?,
            disabled,
        })
    }))
}

pub async fn create(
    pool: &PgPool,
    login: &str,
    new_password: &str,
    role: Role,
) -> anyhow::Result<i64> {
    let login = login.trim();
    if login.is_empty() || login.chars().any(char::is_whitespace) {
        anyhow::bail!("the login must be one word");
    }
    password::check_policy(new_password)?;
    let hash = password::hash_blocking(new_password.to_owned()).await?;
    let id = sqlx::query_scalar(
        "INSERT INTO app_user (login, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(login)
    .bind(hash)
    .bind(role.as_str())
    .fetch_one(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            anyhow::anyhow!("{login} already exists")
        }
        _ => error.into(),
    })?;
    Ok(id)
}

/// Also ends every session of the user.
pub async fn set_password(pool: &PgPool, login: &str, new_password: &str) -> anyhow::Result<()> {
    password::check_policy(new_password)?;
    let hash = password::hash_blocking(new_password.to_owned()).await?;
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "UPDATE app_user SET password_hash = $2 WHERE lower(login) = lower($1) RETURNING id",
    )
    .bind(login.trim())
    .bind(hash)
    .fetch_optional(&mut *tx)
    .await?
    .with_context(|| format!("{login}: unknown user"))?;
    tokens::revoke_user_sessions(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}

/// A disabled user cannot log in or refresh; an access token already issued stays valid until it expires (15 min).
pub async fn disable(pool: &PgPool, login: &str) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "UPDATE app_user SET disabled_at = coalesce(disabled_at, now()) WHERE lower(login) = lower($1) RETURNING id",
    )
    .bind(login.trim())
    .fetch_optional(&mut *tx)
    .await?
    .with_context(|| format!("{login}: unknown user"))?;
    tokens::revoke_user_sessions(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}
