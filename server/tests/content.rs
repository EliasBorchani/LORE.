mod common;

use axum::http::StatusCode;
use common::{Reply, send, user_token};
use serde_json::{Value, json};
use server::auth::Role;
use server::catalog::import::import;
use sqlx::PgPool;

struct Setup {
    app: axum::Router,
    member: String,
    admin: String,
}

async fn setup(pool: &PgPool) -> Setup {
    let catalog = json!({
        "version": "test",
        "entities": [
            { "id": "feat.power_attack", "type": "feat", "name": { "en": "Power Attack" }, "provenance": "official" },
            { "id": "feat.house_rule", "type": "feat", "name": { "fr": "Règle maison" }, "provenance": "team" },
            { "id": "class.wizard", "type": "class", "name": { "fr": "Magicien" }, "hitDie": 4, "provenance": "official" },
            { "id": "domain.fire", "type": "domain", "name": { "fr": "Feu" }, "provenance": "official" },
            { "id": "spell.fireball", "type": "spell", "name": { "fr": "Boule de feu" }, "provenance": "official" }
        ],
        "relations": [
            { "from": "spell.fireball", "relation": "on_spell_list", "to": "class.wizard", "level": 3, "note": "SRD" }
        ]
    });
    import(pool, &catalog, "srd-import", None).await.unwrap();
    let state = common::test_state(pool);
    let (_, member) = user_token(&state, "mira", Role::Member).await;
    let (_, admin) = user_token(&state, "elias", Role::Admin).await;
    Setup {
        app: server::app(state),
        member,
        admin,
    }
}

impl Setup {
    async fn call(&self, method: &str, uri: &str, body: Option<Value>, token: &str) -> Reply {
        send(&self.app, method, uri, body, Some(token)).await
    }
}

fn feat(id: &str, name: &str) -> Value {
    json!({ "id": id, "type": "feat", "name": { "fr": name } })
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_member_creates_team_content_and_every_edit_is_kept(pool: PgPool) {
    let s = setup(&pool).await;

    let created = s
        .call("POST", "/entities", Some(json!({ "entity": feat("feat.iron_will_plus", "Volonté de fer +"), "note": "first try" })), &s.member)
        .await;
    assert_eq!(created.status, StatusCode::OK, "{}", created.body);
    assert_eq!(
        (
            &created.body["version"],
            &created.body["content"]["provenance"]
        ),
        (&json!(1), &json!("team"))
    );

    let mut edited = feat("feat.iron_will_plus", "Volonté de fer améliorée");
    edited["provenance"] = "team".into();
    let saved = s
        .call(
            "PUT",
            "/entities/feat.iron_will_plus",
            Some(json!({ "version": 1, "entity": edited, "note": "better name" })),
            &s.member,
        )
        .await;
    assert_eq!(saved.body["version"], json!(2), "{}", saved.body);
    // The same content again writes nothing.
    let same = s
        .call(
            "PUT",
            "/entities/feat.iron_will_plus",
            Some(json!({ "version": 2, "entity": edited })),
            &s.member,
        )
        .await;
    assert_eq!(same.body["version"], json!(2));

    let versions = s
        .call(
            "GET",
            "/entities/feat.iron_will_plus/versions",
            None,
            &s.member,
        )
        .await
        .body;
    assert_eq!(
        versions,
        json!([
            { "version": 2, "author": "mira", "createdAt": versions[0]["createdAt"], "note": "better name" },
            { "version": 1, "author": "mira", "createdAt": versions[1]["createdAt"], "note": "first try" }
        ])
    );
    let found = s
        .call("GET", "/search?q=amelioree", None, &s.member)
        .await
        .body;
    assert_eq!(found["items"][0]["id"], json!("feat.iron_will_plus"));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_stale_save_gets_the_current_version(pool: PgPool) {
    let s = setup(&pool).await;
    let mut entity = feat("feat.house_rule", "Règle maison v2");
    entity["provenance"] = "team".into();
    let first = s
        .call(
            "PUT",
            "/entities/feat.house_rule",
            Some(json!({ "version": 1, "entity": entity })),
            &s.member,
        )
        .await;
    assert_eq!(first.status, StatusCode::OK);

    entity["name"]["fr"] = "Autre version".into();
    let stale = s
        .call(
            "PUT",
            "/entities/feat.house_rule",
            Some(json!({ "version": 1, "entity": entity })),
            &s.admin,
        )
        .await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    assert_eq!(stale.body["current"]["version"], json!(2));
    assert_eq!(
        stale.body["current"]["content"]["name"]["fr"],
        json!("Règle maison v2")
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn official_content_is_for_admins(pool: PgPool) {
    let s = setup(&pool).await;
    let mut official = json!({ "id": "feat.power_attack", "type": "feat", "name": { "en": "Power Attack", "fr": "Attaque en puissance" }, "provenance": "official" });

    let refused = s
        .call(
            "PUT",
            "/entities/feat.power_attack",
            Some(json!({ "version": 1, "entity": official })),
            &s.member,
        )
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    // A member cannot turn team content into official content either.
    let mut promoted = feat("feat.house_rule", "Règle maison");
    promoted["provenance"] = "official".into();
    let refused = s
        .call(
            "PUT",
            "/entities/feat.house_rule",
            Some(json!({ "version": 1, "entity": promoted })),
            &s.member,
        )
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);

    let saved = s
        .call(
            "PUT",
            "/entities/feat.power_attack",
            Some(json!({ "version": 1, "entity": official })),
            &s.admin,
        )
        .await;
    assert_eq!(
        (saved.status, &saved.body["version"]),
        (StatusCode::OK, &json!(2))
    );
    official["id"] = "feat.other".into();
    let renamed = s
        .call(
            "PUT",
            "/entities/feat.power_attack",
            Some(json!({ "version": 2, "entity": official })),
            &s.admin,
        )
        .await;
    assert_eq!(renamed.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_variant_links_to_its_original_and_stays_out_of_closures(pool: PgPool) {
    let s = setup(&pool).await;
    let variant = json!({ "entity": feat("feat.power_attack_team", "Attaque en puissance (maison)"), "variantOf": "feat.power_attack" });
    assert_eq!(
        s.call("POST", "/entities", Some(variant.clone()), &s.member)
            .await
            .status,
        StatusCode::OK
    );

    let detail = s
        .call("GET", "/entities/feat.power_attack_team", None, &s.member)
        .await
        .body;
    assert_eq!(detail["variantOf"], json!("feat.power_attack"));
    let closure = s
        .call(
            "POST",
            "/catalog/closure",
            Some(json!({ "roots": ["feat.power_attack_team"] })),
            &s.member,
        )
        .await
        .body;
    assert_eq!(closure["catalog"]["entities"].as_array().unwrap().len(), 1);

    // The id is taken now.
    let again = s.call("POST", "/entities", Some(variant), &s.member).await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.body["current"]["id"], json!("feat.power_attack_team"));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_server_checks_the_shape(pool: PgPool) {
    let s = setup(&pool).await;
    for entity in [
        json!("text"),
        feat("Feat.Bad", "X"),
        feat("feat.", "X"),
        feat("feat.été", "X"),
        json!({ "id": "feat.ok", "type": "feat", "name": { "fr": " " } }),
        json!({ "id": "feat.ok", "name": { "fr": "Ok" } }),
    ] {
        let reply = s
            .call(
                "POST",
                "/entities",
                Some(json!({ "entity": entity })),
                &s.member,
            )
            .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{entity}");
    }
    let unknown = json!({ "entity": feat("feat.copy", "Copie"), "variantOf": "feat.nothing" });
    assert_eq!(
        s.call("POST", "/entities", Some(unknown), &s.member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_spell_saves_its_levels_and_each_version_keeps_them(pool: PgPool) {
    let s = setup(&pool).await;
    let spell = json!({ "id": "spell.fireball", "type": "spell", "name": { "fr": "Boule de feu" }, "provenance": "official" });
    let lists = |pairs: &[(&str, i32)]| -> Value {
        pairs
            .iter()
            .map(|(to, level)| json!({ "to": to, "level": level }))
            .collect()
    };

    let saved = s
        .call("PUT", "/entities/spell.fireball", Some(json!({ "version": 1, "entity": spell, "spellLists": lists(&[("domain.fire", 3), ("class.wizard", 4)]) })), &s.admin)
        .await;
    assert_eq!(saved.body["version"], json!(2), "{}", saved.body);
    // Same content and same levels in another order: nothing to save.
    let same = s
        .call("PUT", "/entities/spell.fireball", Some(json!({ "version": 2, "entity": spell, "spellLists": lists(&[("class.wizard", 4), ("domain.fire", 3)]) })), &s.admin)
        .await;
    assert_eq!(same.body["version"], json!(2));

    let detail = s
        .call("GET", "/entities/spell.fireball", None, &s.member)
        .await
        .body;
    let levels: Vec<(Value, Value, Value)> = detail["relations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["to"].clone(),
                r["extra"]["level"].clone(),
                r["extra"]["note"].clone(),
            )
        })
        .collect();
    // The import's note stays on the list that stays.
    assert_eq!(
        levels,
        [
            (json!("class.wizard"), json!(4), json!("SRD")),
            (json!("domain.fire"), json!(3), Value::Null)
        ]
    );

    let versions = s
        .call("GET", "/entities/spell.fireball/versions", None, &s.member)
        .await
        .body;
    assert_eq!(
        versions[0]["relations"],
        json!({ "on_spell_list": lists(&[("class.wizard", 4), ("domain.fire", 3)]) })
    );
    assert_eq!(versions[1].get("relations"), None);

    // Saving without spellLists keeps the levels, and the new version still records them.
    let mut renamed = spell.clone();
    renamed["name"]["en"] = "Fireball".into();
    s.call(
        "PUT",
        "/entities/spell.fireball",
        Some(json!({ "version": 2, "entity": renamed })),
        &s.admin,
    )
    .await;
    let versions = s
        .call("GET", "/entities/spell.fireball/versions", None, &s.member)
        .await
        .body;
    assert_eq!(versions[0]["relations"], versions[1]["relations"]);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn spell_levels_are_checked(pool: PgPool) {
    let s = setup(&pool).await;
    let spell = json!({ "id": "spell.fireball", "type": "spell", "name": { "fr": "Boule de feu" }, "provenance": "official" });
    for bad in [
        json!([{ "to": "feat.house_rule", "level": 1 }]),
        json!([{ "to": "class.nothing", "level": 1 }]),
        json!([{ "to": "class.wizard", "level": -1 }]),
        json!([{ "to": "class.wizard", "level": 1 }, { "to": "class.wizard", "level": 2 }]),
    ] {
        let reply = s
            .call(
                "PUT",
                "/entities/spell.fireball",
                Some(json!({ "version": 1, "entity": spell, "spellLists": bad })),
                &s.admin,
            )
            .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let feat = json!({ "entity": feat("feat.new", "Nouveau"), "spellLists": [{ "to": "class.wizard", "level": 1 }] });
    assert_eq!(
        s.call("POST", "/entities", Some(feat), &s.member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    // A member edits the levels of team spells only.
    let official = s
        .call(
            "PUT",
            "/entities/spell.fireball",
            Some(json!({ "version": 1, "entity": spell, "spellLists": [] })),
            &s.member,
        )
        .await;
    assert_eq!(official.status, StatusCode::FORBIDDEN);
    let team = json!({ "entity": { "id": "spell.spark", "type": "spell", "name": { "fr": "Étincelle" } }, "spellLists": [{ "to": "domain.fire", "level": 0 }] });
    assert_eq!(
        s.call("POST", "/entities", Some(team), &s.member)
            .await
            .status,
        StatusCode::OK
    );
    let versions = s
        .call("GET", "/entities/spell.spark/versions", None, &s.member)
        .await
        .body;
    assert_eq!(
        versions[0]["relations"],
        json!({ "on_spell_list": [{ "to": "domain.fire", "level": 0 }] })
    );
}
