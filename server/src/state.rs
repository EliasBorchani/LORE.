use std::sync::Arc;

use axum::extract::FromRef;
use sqlx::PgPool;

use crate::auth::AuthConfig;
use crate::auth::rate_limit::LoginLimiter;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub auth: Arc<AuthConfig>,
    pub login_limiter: Arc<LoginLimiter>,
}

impl AppState {
    pub fn new(pool: PgPool, auth: AuthConfig) -> Self {
        AppState {
            pool,
            auth: Arc::new(auth),
            login_limiter: Arc::default(),
        }
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
