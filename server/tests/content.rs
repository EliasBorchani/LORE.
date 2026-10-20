mod common;

use axum::http::StatusCode;
use common::{Reply, official, send, user_token};
use serde_json::{Value, json};
use server::auth::Role;
use server::catalog::import::import;
use sqlx::PgPool;

/// Elias (platform admin) runs the group « Table » and owns its private ruleset « maison »; Mira plays there with
/// « Edit content », so she edits « maison » too. Nadia is in no group.
struct Setup {
    app: axum::Router,
    member: String,
    admin: String,
    stranger: String,
    group: String,
}

async fn setup(pool: &PgPool) -> Setup {
    let catalog = json!({
        "version": "test",
        "entities": [
            { "id": "feat.power_attack", "type": "feat", "name": { "en": "Power Attack" }, "provenance": "official" },
            { "id": "class.wizard", "type": "class", "name": { "fr": "Magicien" }, "hitDie": 4, "provenance": "official" },
            { "id": "domain.fire", "type": "domain", "name": { "fr": "Feu" }, "provenance": "official" },
            { "id": "spell.fireball", "type": "spell", "name": { "fr": "Boule de feu" }, "provenance": "official" }
        ],
        "relations": [
            { "from": "spell.fireball", "relation": "on_spell_list", "to": "class.wizard", "level": 3, "note": "SRD" }
        ]
    });
    import(pool, &official(), &catalog, "srd-import", None)
        .await
        .unwrap();
    let state = common::test_state(pool);
    let (member_id, member) = user_token(&state, "mira", Role::Member).await;
    let (_, admin) = user_token(&state, "elias", Role::Admin).await;
    let (_, stranger) = user_token(&state, "nadia", Role::Member).await;
    let app = server::app(state);
    let group = common::group(&app, &admin, "Table").await;
    common::join(pool, &group, member_id, &["see_characters", "edit_content"]).await;
    common::ruleset(&app, &admin, &group, "maison", "private").await;
    let s = Setup {
        app,
        member,
        admin,
        stranger,
        group,
    };
    let house_rule =
        json!({ "entity": feat("maison:feat.house_rule", "Règle maison"), "ruleset": "maison" });
    assert_eq!(
        s.call("POST", "/entities", Some(house_rule), &s.member)
            .await
            .status,
        StatusCode::OK
    );
    s
}

impl Setup {
    async fn call(&self, method: &str, uri: &str, body: Option<Value>, token: &str) -> Reply {
        send(&self.app, method, uri, body, Some(token)).await
    }

    /// A catalog read through the group.
    async fn read(&self, uri: &str, token: &str) -> Reply {
        self.call("GET", &format!("/groups/{}{uri}", self.group), None, token)
            .await
    }
}

fn feat(id: &str, name: &str) -> Value {
    json!({ "id": id, "type": "feat", "name": { "fr": name } })
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_member_writes_into_a_ruleset_and_every_edit_is_kept(pool: PgPool) {
    let s = setup(&pool).await;

    let created = s
        .call("POST", "/entities", Some(json!({ "entity": feat("maison:feat.iron_will_plus", "Volonté de fer +"), "ruleset": "maison", "note": "first try" })), &s.member)
        .await;
    assert_eq!(created.status, StatusCode::OK, "{}", created.body);
    assert_eq!(created.body["version"], json!(1));

    let edited = feat("maison:feat.iron_will_plus", "Volonté de fer améliorée");
    let saved = s
        .call(
            "PUT",
            "/entities/maison:feat.iron_will_plus",
            Some(json!({ "version": 1, "entity": edited, "note": "better name" })),
            &s.member,
        )
        .await;
    assert_eq!(saved.body["version"], json!(2), "{}", saved.body);
    // The same content again writes nothing.
    let same = s
        .call(
            "PUT",
            "/entities/maison:feat.iron_will_plus",
            Some(json!({ "version": 2, "entity": edited })),
            &s.member,
        )
        .await;
    assert_eq!(same.body["version"], json!(2));

    let versions = s
        .read("/entities/maison:feat.iron_will_plus/versions", &s.member)
        .await
        .body;
    assert_eq!(
        versions,
        json!([
            { "version": 2, "author": "mira", "createdAt": versions[0]["createdAt"], "note": "better name" },
            { "version": 1, "author": "mira", "createdAt": versions[1]["createdAt"], "note": "first try" }
        ])
    );
    let found = s.read("/search?q=amelioree", &s.member).await.body;
    assert_eq!(found["items"][0]["id"], json!("maison:feat.iron_will_plus"));
    let detail = s
        .read("/entities/maison:feat.iron_will_plus", &s.member)
        .await
        .body;
    assert_eq!(
        (&detail["ruleset"]["slug"], &detail["editable"]),
        (&json!("maison"), &json!(true))
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_stale_save_gets_the_current_version(pool: PgPool) {
    let s = setup(&pool).await;
    let mut entity = feat("maison:feat.house_rule", "Règle maison v2");
    let first = s
        .call(
            "PUT",
            "/entities/maison:feat.house_rule",
            Some(json!({ "version": 1, "entity": entity })),
            &s.member,
        )
        .await;
    assert_eq!(first.status, StatusCode::OK);

    entity["name"]["fr"] = "Autre version".into();
    let stale = s
        .call(
            "PUT",
            "/entities/maison:feat.house_rule",
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
async fn official_content_is_for_the_platform_admin(pool: PgPool) {
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
    let refused = s
        .call(
            "POST",
            "/entities",
            Some(json!({ "entity": feat("feat.new", "Nouveau") })),
            &s.member,
        )
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    // Ruleset content carries the ruleset's slug.
    let refused = s
        .call(
            "POST",
            "/entities",
            Some(json!({ "entity": feat("feat.new", "Nouveau"), "ruleset": "maison" })),
            &s.member,
        )
        .await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);

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
async fn a_stranger_neither_sees_nor_edits_a_private_ruleset(pool: PgPool) {
    let s = setup(&pool).await;
    let edit = s
        .call(
            "PUT",
            "/entities/maison:feat.house_rule",
            Some(json!({ "version": 1, "entity": feat("maison:feat.house_rule", "Piraté") })),
            &s.stranger,
        )
        .await;
    assert_eq!(edit.status, StatusCode::NOT_FOUND);
    let create = s
        .call(
            "POST",
            "/entities",
            Some(json!({ "entity": feat("maison:feat.x", "X"), "ruleset": "maison" })),
            &s.stranger,
        )
        .await;
    assert_eq!(create.status, StatusCode::NOT_FOUND);
    for uri in ["/rulesets/maison", "/rulesets/maison/entities"] {
        let reply = s.call("GET", uri, None, &s.stranger).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{uri}");
    }
    let read = s
        .read("/entities/maison:feat.house_rule", &s.stranger)
        .await;
    assert_eq!(read.status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_house_rule_replaces_the_official_entity_in_the_group(pool: PgPool) {
    let s = setup(&pool).await;
    let rule = json!({
        "entity": feat("maison:feat.power_attack", "Attaque en puissance (maison)"),
        "ruleset": "maison",
        "overrides": "feat.power_attack"
    });
    let created = s
        .call("POST", "/entities", Some(rule.clone()), &s.member)
        .await;
    assert_eq!(created.status, StatusCode::OK, "{}", created.body);

    let closure = s
        .call(
            "POST",
            &format!("/groups/{}/catalog/closure", s.group),
            Some(json!({ "roots": ["feat.power_attack"] })),
            &s.member,
        )
        .await
        .body;
    let entities = closure["catalog"]["entities"].as_array().unwrap();
    assert_eq!(entities.len(), 1);
    assert_eq!(
        (&entities[0]["id"], &entities[0]["name"]["fr"]),
        (
            &json!("feat.power_attack"),
            &json!("Attaque en puissance (maison)")
        )
    );
    assert_eq!(
        closure["houseRules"]["feat.power_attack"]["id"],
        json!("maison:feat.power_attack")
    );

    let detail = s.read("/entities/feat.power_attack", &s.member).await.body;
    assert_eq!(
        (&detail["id"], &detail["overrides"]),
        (
            &json!("maison:feat.power_attack"),
            &json!("feat.power_attack")
        )
    );
    let found = s.read("/search?q=puissance", &s.member).await.body;
    assert_eq!(found["items"].as_array().unwrap().len(), 1, "{found}");
    assert_eq!(
        (
            &found["items"][0]["id"],
            &found["items"][0]["houseRule"]["ruleset"]
        ),
        (&json!("feat.power_attack"), &json!("maison"))
    );

    // Another group, without the ruleset, keeps the official rule.
    let other = common::group(&s.app, &s.admin, "Autre table").await;
    let detail = s
        .call(
            "GET",
            &format!("/groups/{other}/entities/feat.power_attack"),
            None,
            &s.admin,
        )
        .await
        .body;
    assert_eq!(detail["id"], json!("feat.power_attack"));

    // One house rule per official entity and ruleset.
    let mut twice = rule;
    twice["entity"]["id"] = "maison:feat.power_attack_2".into();
    let refused = s.call("POST", "/entities", Some(twice), &s.member).await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);
}

async fn power_attack_name(s: &Setup) -> Value {
    s.read("/entities/feat.power_attack", &s.member).await.body["content"]["name"]["fr"].clone()
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_last_ruleset_wins_and_the_group_lists_the_conflict(pool: PgPool) {
    let s = setup(&pool).await;
    common::ruleset(&s.app, &s.admin, &s.group, "monde", "public").await;
    for slug in ["maison", "monde"] {
        let rule = json!({
            "entity": feat(&format!("{slug}:feat.power_attack"), &format!("Attaque ({slug})")),
            "ruleset": slug,
            "overrides": "feat.power_attack"
        });
        let created = s.call("POST", "/entities", Some(rule), &s.admin).await;
        assert_eq!(created.status, StatusCode::OK, "{}", created.body);
    }
    assert_eq!(power_attack_name(&s).await, json!("Attaque (monde)"));
    let group = s
        .call("GET", &format!("/groups/{}", s.group), None, &s.member)
        .await
        .body;
    assert_eq!(
        group["conflicts"],
        json!([{ "id": "feat.power_attack", "rulesets": ["maison", "monde"], "winner": "monde" }])
    );

    let reordered = s
        .call(
            "PUT",
            &format!("/groups/{}/rulesets", s.group),
            Some(json!({ "rulesets": ["monde", "maison"] })),
            &s.admin,
        )
        .await;
    assert_eq!(reordered.status, StatusCode::OK);
    assert_eq!(power_attack_name(&s).await, json!("Attaque (maison)"));
    // Only an admin orders the rulesets.
    let refused = s
        .call(
            "PUT",
            &format!("/groups/{}/rulesets", s.group),
            Some(json!({ "rulesets": ["maison"] })),
            &s.member,
        )
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn the_server_checks_the_shape(pool: PgPool) {
    let s = setup(&pool).await;
    for entity in [
        json!("text"),
        feat("Maison:feat.bad", "X"),
        feat("maison:feat.", "X"),
        feat("maison:feat.été", "X"),
        json!({ "id": "maison:feat.ok", "type": "feat", "name": { "fr": " " } }),
        json!({ "id": "maison:feat.ok", "name": { "fr": "Ok" } }),
    ] {
        let reply = s
            .call(
                "POST",
                "/entities",
                Some(json!({ "entity": entity, "ruleset": "maison" })),
                &s.member,
            )
            .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{entity}");
    }
    let unknown = json!({ "entity": feat("maison:feat.copy", "Copie"), "ruleset": "maison", "overrides": "feat.nothing" });
    assert_eq!(
        s.call("POST", "/entities", Some(unknown), &s.member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let wrong_type = json!({ "entity": feat("maison:feat.wizard", "Mage"), "ruleset": "maison", "overrides": "class.wizard" });
    assert_eq!(
        s.call("POST", "/entities", Some(wrong_type), &s.member)
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

    let detail = s.read("/entities/spell.fireball", &s.member).await.body;
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
        .read("/entities/spell.fireball/versions", &s.member)
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
        .read("/entities/spell.fireball/versions", &s.member)
        .await
        .body;
    assert_eq!(versions[0]["relations"], versions[1]["relations"]);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_house_rule_starts_with_the_official_spell_levels(pool: PgPool) {
    let s = setup(&pool).await;
    let rule = json!({
        "entity": { "id": "maison:spell.fireball", "type": "spell", "name": { "fr": "Boule de feu (maison)" } },
        "ruleset": "maison",
        "overrides": "spell.fireball"
    });
    assert_eq!(
        s.call("POST", "/entities", Some(rule), &s.member)
            .await
            .status,
        StatusCode::OK
    );
    let list = s
        .read("/catalog/spell-list/class.wizard", &s.member)
        .await
        .body;
    assert_eq!(
        list,
        json!([{ "id": "spell.fireball", "level": 3, "name": { "fr": "Boule de feu (maison)" } }])
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn spell_levels_are_checked(pool: PgPool) {
    let s = setup(&pool).await;
    let spell = json!({ "id": "spell.fireball", "type": "spell", "name": { "fr": "Boule de feu" }, "provenance": "official" });
    for bad in [
        json!([{ "to": "maison:feat.house_rule", "level": 1 }]),
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
    let feat = json!({ "entity": feat("maison:feat.new", "Nouveau"), "ruleset": "maison", "spellLists": [{ "to": "class.wizard", "level": 1 }] });
    assert_eq!(
        s.call("POST", "/entities", Some(feat), &s.member)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    // A member edits the levels of the ruleset's spells only.
    let official = s
        .call(
            "PUT",
            "/entities/spell.fireball",
            Some(json!({ "version": 1, "entity": spell, "spellLists": [] })),
            &s.member,
        )
        .await;
    assert_eq!(official.status, StatusCode::FORBIDDEN);
    let homebrew = json!({ "entity": { "id": "maison:spell.spark", "type": "spell", "name": { "fr": "Étincelle" } }, "ruleset": "maison", "spellLists": [{ "to": "domain.fire", "level": 0 }] });
    assert_eq!(
        s.call("POST", "/entities", Some(homebrew), &s.member)
            .await
            .status,
        StatusCode::OK
    );
    let versions = s
        .read("/entities/maison:spell.spark/versions", &s.member)
        .await
        .body;
    assert_eq!(
        versions[0]["relations"],
        json!({ "on_spell_list": [{ "to": "domain.fire", "level": 0 }] })
    );
}
