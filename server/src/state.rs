use std::sync::Arc;

use axum::extract::FromRef;
use sqlx::PgPool;

use crate::auth::AuthConfig;
use crate::auth::rate_limit::LoginLimiter;
use crate::mail::SmtpConfig;

/// Invitations sent from the app: the web app's address starts the link; without SMTP the inviter gets the link.
pub struct Mailer {
    pub app_url: String,
    pub smtp: Option<SmtpConfig>,
}

impl Mailer {
    pub fn link(&self, token: &str) -> String {
        format!("{}/invite#{token}", self.app_url.trim_end_matches('/'))
    }
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub auth: Arc<AuthConfig>,
    pub login_limiter: Arc<LoginLimiter>,
    pub mailer: Option<Arc<Mailer>>,
}

impl AppState {
    pub fn new(pool: PgPool, auth: AuthConfig) -> Self {
        AppState {
            pool,
            auth: Arc::new(auth),
            login_limiter: Arc::default(),
            mailer: None,
        }
    }

    pub fn with_mailer(mut self, mailer: Mailer) -> Self {
        self.mailer = Some(Arc::new(mailer));
        self
    }
}

impl FromRef<AppState> for PgPool {
    fn from_ref(state: &AppState) -> Self {
        state.pool.clone()
    }
}

impl FromRef<AppState> for Arc<AuthConfig> {
    fn from_ref(state: &AppState) -> Self {
        state.auth.clone()
    }
}
