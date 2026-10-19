use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::{Algorithm, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;

use super::{AuthConfig, CurrentUser, Role};
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// User id, as text (JWT convention).
    pub sub: String,
    pub role: Role,
    pub iat: i64,
    pub exp: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    /// Access token lifetime in seconds.
    pub expires_in: i64,
}

pub fn issue_access(config: &AuthConfig, user: CurrentUser) -> String {
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let claims = Claims {
        sub: user.id.to_string(),
        role: user.role,
        iat: now,
        exp: now + config.access_ttl.whole_seconds(),
    };
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &config.encoding_key,
    )
    .expect("HS256 encoding cannot fail")
}

pub fn verify_access(config: &AuthConfig, token: &str) -> Option<CurrentUser> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 5;
    let claims = jsonwebtoken::decode::<Claims>(token, &config.decoding_key, &validation)
        .ok()?
        .claims;
    Some(CurrentUser {
        id: claims.sub.parse().ok()?,
        role: claims.role,
    })
}

/// A new login session: a new refresh token family.
pub async fn start_session(
    pool: &PgPool,
    config: &AuthConfig,
    user: CurrentUser,
) -> Result<TokenPair, AppError> {
    let mut conn = pool.acquire().await?;
    issue_pair(&mut conn, config, user, &random_text(16)).await
}

/// How long a used refresh token may come back as a retry: the client sent it, the server rotated it, but the answer
/// was lost (a page reloaded mid-request). Past this, or once a newer token of the session was used, it is theft.
const RETRY_GRACE: time::Duration = time::Duration::seconds(30);

/// Swaps a refresh token for a new pair. A token can be used once: presenting it again means it was copied, so the
/// whole family (the session) is revoked, and both the thief and the user must log in again. Within [RETRY_GRACE],
/// a retry of the last used token gets a new pair instead, and the token the client never received is revoked.
pub async fn refresh(
    pool: &PgPool,
    config: &AuthConfig,
    token: &str,
) -> Result<TokenPair, AppError> {
    let invalid = || AppError::Unauthorized("invalid or expired refresh token".into());
    let mut tx = pool.begin().await?;
    let row: Option<(
        i64,
        i64,
        String,
        OffsetDateTime,
        Option<OffsetDateTime>,
        bool,
    )> = sqlx::query_as(
        "SELECT id, user_id, family, expires_at, used_at, revoked_at IS NOT NULL
         FROM refresh_token WHERE token_hash = $1 FOR UPDATE",
    )
    .bind(hash_token(token))
    .fetch_optional(&mut *tx)
    .await?;
    let Some((id, user_id, family, expires_at, used_at, revoked)) = row else {
        return Err(invalid());
    };
    if let Some(used_at) = used_at.filter(|_| !revoked) {
        if is_retry(&mut tx, &family, used_at).await? {
            sqlx::query(
                "UPDATE refresh_token SET revoked_at = now()
                 WHERE family = $1 AND used_at IS NULL AND revoked_at IS NULL AND created_at >= $2",
            )
            .bind(&family)
            .bind(used_at)
            .execute(&mut *tx)
            .await?;
        } else {
            tracing::warn!(user_id, "refresh token reused: session revoked");
            revoke_family(&mut tx, &family).await?;
            tx.commit().await?;
            return Err(invalid());
        }
    } else if revoked {
        tracing::warn!(user_id, "revoked refresh token used: session revoked");
        revoke_family(&mut tx, &family).await?;
        tx.commit().await?;
        return Err(invalid());
    }
    if expires_at <= OffsetDateTime::now_utc() {
        return Err(invalid());
    }
    let user: Option<(String, bool)> =
        sqlx::query_as("SELECT role, disabled_at IS NOT NULL FROM app_user WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let role = match user {
        Some((role, false)) => role.parse().map_err(|_| invalid())?,
        _ => {
            revoke_family(&mut tx, &family).await?;
            tx.commit().await?;
            return Err(invalid());
        }
    };
    sqlx::query("UPDATE refresh_token SET used_at = coalesce(used_at, now()) WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let pair = issue_pair(&mut tx, config, CurrentUser { id: user_id, role }, &family).await?;
    tx.commit().await?;
    Ok(pair)
}

/// A used token is a retry when it was used moments ago and no token of the session was used after it.
async fn is_retry(
    conn: &mut PgConnection,
    family: &str,
    used_at: OffsetDateTime,
) -> Result<bool, sqlx::Error> {
    if OffsetDateTime::now_utc() - used_at > RETRY_GRACE {
        return Ok(false);
    }
    let later: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM refresh_token WHERE family = $1 AND used_at > $2)",
    )
    .bind(family)
    .bind(used_at)
    .fetch_one(conn)
    .await?;
    Ok(!later)
}

/// Ends the session the token belongs to. Unknown tokens are ignored: logging out never fails.
pub async fn logout(pool: &PgPool, token: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE refresh_token SET revoked_at = now()
         WHERE revoked_at IS NULL AND family = (SELECT family FROM refresh_token WHERE token_hash = $1)",
    )
    .bind(hash_token(token))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn revoke_user_sessions(
    conn: &mut PgConnection,
    user_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(conn)
    .await?;
    Ok(())
}

async fn revoke_family(conn: &mut PgConnection, family: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE refresh_token SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL",
    )
    .bind(family)
    .execute(conn)
    .await?;
    Ok(())
}

async fn issue_pair(
    conn: &mut PgConnection,
    config: &AuthConfig,
    user: CurrentUser,
    family: &str,
) -> Result<TokenPair, AppError> {
    let refresh_token = random_text(32);
    sqlx::query("INSERT INTO refresh_token (user_id, family, token_hash, expires_at) VALUES ($1, $2, $3, $4)")
        .bind(user.id)
        .bind(family)
        .bind(hash_token(&refresh_token))
        .bind(OffsetDateTime::now_utc() + config.refresh_ttl)
        .execute(conn)
        .await?;
    Ok(TokenPair {
        access_token: issue_access(config, user),
        refresh_token,
        token_type: "Bearer",
        expires_in: config.access_ttl.whole_seconds(),
    })
}

pub(crate) fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub(crate) fn random_text(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the system random source is available");
    URL_SAFE_NO_PAD.encode(buffer)
}
