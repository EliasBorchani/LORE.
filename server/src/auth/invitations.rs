//! Invitations by email. The platform admin invites without a group (`server user invite`); a member with « Invite »
//! invites into their group. The link lets a new person choose a password (the email becomes the login), or adds an
//! existing account to the group once it logs in.

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;

use super::tokens::{self, TokenPair};
use super::{AuthConfig, CurrentUser, Role, password};
use crate::access::{Permissions, permission_texts};
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
    /// The group the link leads into.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<InvitedGroup>,
    /// The email has an account already: its owner logs in, then joins.
    pub account: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InvitedGroup {
    pub id: String,
    pub name: String,
}

pub struct Created {
    pub email: String,
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
    Ok(Created {
        email,
        token,
        expires_at,
    })
}

/// An invitation into a group, for a new or an existing account (the inviter can't tell which). A new link
/// replaces a pending one for the same email and group.
pub async fn create_for_group(
    pool: &PgPool,
    email: &str,
    group_id: &str,
    permissions: &Permissions,
    invited_by: i64,
) -> Result<Created, AppError> {
    let email = normalize_email(email).map_err(|error| AppError::BadRequest(error.to_string()))?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "DELETE FROM invitation WHERE lower(email) = $1 AND group_id = $2 AND used_at IS NULL",
    )
    .bind(&email)
    .bind(group_id)
    .execute(&mut *tx)
    .await?;
    let token = tokens::random_text(32);
    let expires_at = OffsetDateTime::now_utc() + INVITATION_TTL;
    sqlx::query(
        "INSERT INTO invitation (email, role, token_hash, expires_at, group_id, permissions, invited_by)
         VALUES ($1, 'member', $2, $3, $4, $5, $6)",
    )
    .bind(&email)
    .bind(tokens::hash_token(&token))
    .bind(expires_at)
    .bind(group_id)
    .bind(permission_texts(permissions))
    .bind(invited_by)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Created {
        email,
        token,
        expires_at,
    })
}

#[derive(sqlx::FromRow)]
struct Pending {
    id: i64,
    email: String,
    role: String,
    expires_at: OffsetDateTime,
    group_id: Option<String>,
    permissions: Vec<String>,
}

const SELECT_PENDING: &str =
    "SELECT id, email, role, expires_at, group_id, permissions FROM invitation
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()";

pub async fn find(pool: &PgPool, token: &str) -> Result<Invitation, AppError> {
    let pending: Pending = sqlx::query_as(SELECT_PENDING)
        .bind(tokens::hash_token(token))
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(INVALID.into()))?;
    let group = match &pending.group_id {
        Some(id) => {
            sqlx::query_as("SELECT id, name FROM lore_group WHERE id = $1")
                .bind(id)
                .fetch_optional(pool)
                .await?
        }
        None => None,
    };
    let account: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM app_user WHERE lower(login) = $1)")
            .bind(&pending.email)
            .fetch_one(pool)
            .await?;
    Ok(Invitation {
        email: pending.email,
        role: pending
            .role
            .parse()
            .map_err(|_| AppError::NotFound(INVALID.into()))?,
        expires_at: pending.expires_at,
        group,
        account,
    })
}

/// The logged-in account whose login is the invited email joins the group. Any other account gets the same 404 as
/// an unknown link.
pub async fn join(pool: &PgPool, user: CurrentUser, token: &str) -> Result<String, AppError> {
    let mut tx = pool.begin().await?;
    let pending: Pending = sqlx::query_as(&format!("{SELECT_PENDING} FOR UPDATE"))
        .bind(tokens::hash_token(token))
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(INVALID.into()))?;
    let login: String = sqlx::query_scalar("SELECT lower(login) FROM app_user WHERE id = $1")
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
    let Some(group_id) = pending.group_id.filter(|_| login == pending.email) else {
        return Err(AppError::NotFound(INVALID.into()));
    };
    let permissions = crate::access::parse_permissions(&pending.permissions)?;
    crate::groups::add_member(&mut tx, &group_id, user.id, &permissions).await?;
    sqlx::query("UPDATE invitation SET used_at = now() WHERE id = $1")
        .bind(pending.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(group_id)
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
    let pending: Pending = sqlx::query_as(&format!("{SELECT_PENDING} FOR UPDATE"))
        .bind(tokens::hash_token(token))
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(INVALID.into()))?;
    let (invitation_id, email) = (pending.id, pending.email);
    let role: Role = pending
        .role
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
    if let Some(group_id) = &pending.group_id {
        let permissions = crate::access::parse_permissions(&pending.permissions)?;
        crate::groups::add_member(&mut tx, group_id, id, &permissions).await?;
    }
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
