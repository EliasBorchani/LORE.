pub mod archive;
pub mod auth;
pub mod catalog;
pub mod characters;
pub mod error;
pub mod routes;
pub mod state;

pub use routes::app;
pub use state::AppState;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();
