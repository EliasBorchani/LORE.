use axum::extract::{Path, State};
use axum::middleware;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use sqlx::PgPool;

use crate::auth::CurrentUser;
use crate::auth::routes as auth;
use crate::catalog::edit::{self, EntityUpdate, NewEntity, Saved};
use crate::catalog::routes as catalog;
use crate::characters::routes as characters;
use crate::error::AppError;
use crate::state::AppState;
use crate::{atelier, groups, rulesets};

pub fn app(state: AppState) -> Router {
    // All content requires a logged-in user (PRD 5.6); only health, getting tokens and invitation links are open.
    // Catalog reads go through a group: what a member sees depends on the group's RPG and rulesets.
    let protected = Router::new()
        .route("/auth/me", get(auth::me))
        .route("/groups", get(groups::list).post(groups::create))
        .route("/groups/join", post(groups::join))
        .route("/groups/{group}", get(groups::get).patch(groups::update))
        .route("/groups/{group}/members", get(groups::members))
        .route(
            "/groups/{group}/members/{user}",
            put(groups::set_permissions).delete(groups::remove_member),
        )
        .route("/groups/{group}/leave", post(groups::leave))
        .route("/groups/{group}/rulesets", put(groups::set_rulesets))
        .route("/groups/{group}/invitations", post(groups::invite))
        .route(
            "/groups/{group}/drafts",
            get(atelier::list_drafts).post(atelier::create_draft),
        )
        .route(
            "/groups/{group}/drafts/{id}",
            get(atelier::get_draft)
                .put(atelier::update_draft)
                .delete(atelier::delete_draft),
        )
        .route("/groups/{group}/changes", get(atelier::changes))
        .route("/groups/{group}/catalog/core", get(catalog::core))
        .route("/groups/{group}/catalog/states", get(catalog::states))
        .route(
            "/groups/{group}/catalog/closure",
            post(catalog::catalog_closure),
        )
        .route(
            "/groups/{group}/catalog/spell-list/{class_id}",
            get(catalog::spell_list),
        )
        .route(
            "/groups/{group}/catalog/maneuvers/{class_id}",
            get(catalog::maneuver_list),
        )
        .route("/groups/{group}/entities", get(catalog::list_entities))
        .route("/groups/{group}/search", get(catalog::catalog_search))
        .route("/groups/{group}/entities/{id}", get(catalog::entity))
        .route(
            "/groups/{group}/entities/{id}/versions",
            get(catalog::versions),
        )
        .route("/rulesets", get(rulesets::list).post(rulesets::create))
        .route(
            "/rulesets/{slug}",
            get(rulesets::get).patch(rulesets::update),
        )
        .route("/rulesets/{slug}/editors", put(rulesets::set_editors))
        .route("/rulesets/{slug}/entities", get(rulesets::entities))
        .route("/entities", post(create_entity))
        .route("/entities/{id}", put(update_entity))
        .route(
            "/characters",
            get(characters::list).post(characters::create),
        )
        .route(
            "/characters/{id}",
            get(characters::get).put(characters::update),
        )
        .route("/characters/{id}/play", put(characters::update_play))
        .route("/characters/{id}/archive", post(characters::archive))
        .route("/characters/{id}/restore", post(characters::restore))
        .route("/characters/{id}/duplicate", post(characters::duplicate))
        .route("/characters/{id}/move", post(characters::move_to))
        .route("/characters/{id}/versions", get(characters::versions))
        .route(
            "/characters/{id}/versions/{version}",
            get(characters::version),
        )
        .route("/characters/{id}/catalog", get(characters::catalog))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_user,
        ));
    Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(auth::login))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/invitation", post(auth::invitation))
        .route("/auth/invitation/accept", post(auth::accept_invitation))
        .merge(protected)
        .with_state(state)
}

async fn health(State(pool): State<PgPool>) -> Result<&'static str, AppError> {
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok("ok")
}

/// Into a ruleset the caller edits, or official content (platform admin).
async fn create_entity(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Json(request): Json<NewEntity>,
) -> Result<Json<Saved>, AppError> {
    Ok(Json(edit::create(&pool, user, request).await?))
}

async fn update_entity(
    State(pool): State<PgPool>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(request): Json<EntityUpdate>,
) -> Result<Json<Saved>, AppError> {
    Ok(Json(edit::update(&pool, user, &id, request).await?))
}
