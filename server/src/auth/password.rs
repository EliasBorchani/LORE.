use std::sync::LazyLock;

use argon2::Argon2;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};

pub const MIN_LENGTH: usize = 12;

/// Checked when the login is unknown, so an unknown login takes as long as a wrong password and cannot be guessed
/// from the response time.
static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| hash("not a real password").unwrap());

pub fn check_policy(password: &str) -> anyhow::Result<()> {
    if password.chars().count() < MIN_LENGTH {
        anyhow::bail!("the password must have at least {MIN_LENGTH} characters");
    }
    Ok(())
}

pub fn hash(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow::anyhow!("cannot hash the password: {error}"))
}

pub fn verify(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}

/// Argon2 is deliberately slow (tens of milliseconds): it runs off the async threads.
pub async fn verify_blocking(password: String, hash: Option<String>) -> bool {
    tokio::task::spawn_blocking(move || {
        let found = hash.is_some();
        let hash = hash.unwrap_or_else(|| DUMMY_HASH.clone());
        verify(&password, &hash) && found
    })
    .await
    .unwrap_or(false)
}

pub async fn hash_blocking(password: String) -> anyhow::Result<String> {
    tokio::task::spawn_blocking(move || hash(&password)).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify() {
        let hashed = hash("correct horse battery").unwrap();
        assert!(hashed.starts_with("$argon2id$"));
        assert!(verify("correct horse battery", &hashed));
        assert!(!verify("wrong horse battery", &hashed));
        assert!(!verify("correct horse battery", "not a hash"));
    }

    #[test]
    fn short_passwords_are_refused() {
        assert!(check_policy("short").is_err());
        assert!(check_policy("long enough pass").is_ok());
    }
}
