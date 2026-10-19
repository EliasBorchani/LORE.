mod common;

use std::collections::BTreeSet;
use std::path::Path;

use axum::http::StatusCode;
use serde_json::{Value, json};
use server::catalog::import::{ImportReport, import};
use server::catalog::refs::collect_candidate_ids;
use sqlx::PgPool;

fn golden(file: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test-references/danalieth")
        .join(file);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// Calls the API as a logged-in member.
async fn call(pool: &PgPool, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let state = common::test_state(pool);
    let token = common::member_token(&state);
    let reply = common::send(&server::app(state), method, uri, body, Some(&token)).await;
    (reply.status, reply.body)
}

fn ids_of(list: &Value) -> BTreeSet<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

fn sorted(list: &Value) -> Vec<String> {
    let mut items: Vec<String> = list
        .as_array()
        .unwrap()
        .iter()
        .map(Value::to_string)
        .collect();
    items.sort();
    items
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn closure_of_danalieth_matches_the_golden_catalog(pool: PgPool) {
    let catalog = golden("catalog.json");
    import(&pool, &catalog, "test", None).await.unwrap();

    let entity_ids = ids_of(&catalog["entities"]);
    let mut roots = BTreeSet::new();
    collect_candidate_ids(&golden("character.json"), &mut roots);
    let roots: Vec<&String> = roots.iter().filter(|id| entity_ids.contains(*id)).collect();

    let (status, closure) = call(
        &pool,
        "POST",
        "/catalog/closure",
        Some(json!({ "roots": roots })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(closure["missing"], json!([]));
    let sent = &closure["catalog"];

    for entity in sent["entities"].as_array().unwrap() {
        let id = entity["id"].as_str().unwrap();
        let original = catalog["entities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == id)
            .unwrap();
        assert_eq!(entity, original, "{id} changed on the way");
        assert_eq!(closure["versions"][id], json!(1));
    }
    let sent_ids = ids_of(&sent["entities"]);
    for root in &roots {
        assert!(sent_ids.contains(*root), "root {root} not sent");
    }

    let expected_relations: Vec<Value> = catalog["relations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| {
            sent_ids.contains(r["from"].as_str().unwrap())
                && sent_ids.contains(r["to"].as_str().unwrap())
        })
        .cloned()
        .collect();
    assert_eq!(
        sorted(&sent["relations"]),
        sorted(&Value::Array(expected_relations))
    );

    let expected_rows: Vec<Value> = catalog["progressions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| sent_ids.contains(row["classId"].as_str().unwrap()))
        .cloned()
        .collect();
    assert_eq!(
        sorted(&sent["progressions"]),
        sorted(&Value::Array(expected_rows))
    );

    for (key, value) in catalog.as_object().unwrap() {
        if !["entities", "relations", "progressions"].contains(&key.as_str()) {
            assert_eq!(&sent[key], value, "section {key}");
        }
    }
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn closure_of_one_feat_stays_small(pool: PgPool) {
    import(&pool, &golden("catalog.json"), "test", None)
        .await
        .unwrap();

    let (status, closure) = call(
        &pool,
        "POST",
        "/catalog/closure",
        Some(json!({ "roots": ["feat.power_attack", "feat.unknown"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        ids_of(&closure["catalog"]["entities"]),
        BTreeSet::from(["feat.power_attack".to_owned()])
    );
    assert_eq!(closure["catalog"]["progressions"], json!([]));
    assert_eq!(closure["missing"], json!(["feat.unknown"]));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn second_import_changes_nothing_and_paging_sees_every_entity(pool: PgPool) {
    let catalog = golden("catalog.json");
    let count = catalog["entities"].as_array().unwrap().len();
    import(&pool, &catalog, "test", None).await.unwrap();

    let report = import(&pool, &catalog, "test", None).await.unwrap();
    assert_eq!(
        (report.created, report.updated, report.unchanged),
        (0, 0, count)
    );

    let mut seen = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let uri = match &after {
            Some(id) => format!("/entities?limit=10&after={id}"),
            None => "/entities?limit=10".to_owned(),
        };
        let (status, page) = call(&pool, "GET", &uri, None).await;
        assert_eq!(status, StatusCode::OK);
        seen.extend(ids_of(&page["items"]));
        match page["next"].as_str() {
            Some(next) => after = Some(next.to_owned()),
            None => break,
        }
    }
    assert_eq!(seen.len(), count);
    assert_eq!(
        seen.iter().collect::<BTreeSet<_>>(),
        ids_of(&catalog["entities"]).iter().collect()
    );

    let (_, feats) = call(&pool, "GET", "/entities?type=feat&limit=200", None).await;
    assert!(
        feats["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["type"] == "feat")
    );
    assert!(feats["items"][0]["name"]["en"].is_string());
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_changed_entity_gets_a_new_version_and_a_batch_deletes_nothing(pool: PgPool) {
    let catalog = golden("catalog.json");
    import(&pool, &catalog, "test", None).await.unwrap();
    let relations_before: i64 = sqlx::query_scalar("SELECT count(*) FROM entity_relation")
        .fetch_one(&pool)
        .await
        .unwrap();

    let mut entity = catalog["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "feat.power_attack")
        .unwrap()
        .clone();
    entity["description"]["en"] = json!("Trade attack for damage.");
    let batch = json!({ "entities": [entity] });
    let report = import(&pool, &batch, "owner", Some("English text"))
        .await
        .unwrap();
    assert_eq!(
        report,
        ImportReport {
            updated: 1,
            ..Default::default()
        }
    );

    let (status, detail) = call(&pool, "GET", "/entities/feat.power_attack", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["version"], json!(2));
    assert_eq!(detail["content"], entity);

    let (_, versions) = call(&pool, "GET", "/entities/feat.power_attack/versions", None).await;
    let versions = versions.as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(
        (
            &versions[0]["version"],
            &versions[0]["author"],
            &versions[0]["note"]
        ),
        (&json!(2), &json!("owner"), &json!("English text"))
    );
    assert_eq!(
        (&versions[1]["version"], &versions[1]["note"]),
        (&json!(1), &Value::Null)
    );

    let relations_after: i64 = sqlx::query_scalar("SELECT count(*) FROM entity_relation")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(relations_after, relations_before);
    let (_, closure) = call(
        &pool,
        "POST",
        "/catalog/closure",
        Some(json!({ "roots": ["class.warblade"] })),
    )
    .await;
    assert!(
        !closure["catalog"]["progressions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn unknown_entities_are_404(pool: PgPool) {
    for uri in ["/entities/feat.unknown", "/entities/feat.unknown/versions"] {
        let (status, body) = call(&pool, "GET", uri, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(body["error"], json!("feat.unknown: unknown entity"));
    }
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn health_and_core(pool: PgPool) {
    import(&pool, &golden("catalog.json"), "test", None)
        .await
        .unwrap();
    let (status, _) = call(&pool, "GET", "/health", None).await;
    assert_eq!(status, StatusCode::OK);
    let (_, core) = call(&pool, "GET", "/catalog/core", None).await;
    assert!(core["bonusTypes"].is_array());
    assert!(core.get("entities").is_none());
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_dry_run_reports_and_writes_nothing(pool: PgPool) {
    let catalog = golden("catalog.json");
    let report = server::catalog::import::dry_run(&pool, &catalog, "test", None)
        .await
        .unwrap();
    assert_eq!(
        report.created,
        catalog["entities"].as_array().unwrap().len()
    );
    let entities: i64 = sqlx::query_scalar("SELECT count(*) FROM entity")
        .fetch_one(&pool)
        .await
        .unwrap();
    let sections: i64 = sqlx::query_scalar("SELECT count(*) FROM catalog_section")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((entities, sections), (0, 0));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_draft_character_gets_the_same_closure_as_a_saved_one(pool: PgPool) {
    import(&pool, &golden("catalog.json"), "test", None)
        .await
        .unwrap();
    let (status, closure) = call(
        &pool,
        "POST",
        "/catalog/closure",
        Some(json!({ "character": golden("character.json") })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(closure["catalog"]["entities"].as_array().unwrap().len(), 80);

    let (status, _) = call(
        &pool,
        "POST",
        "/catalog/closure",
        Some(json!({ "roots": ["class.warblade"], "character": {} })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn a_spell_list_gives_each_spell_with_its_level(pool: PgPool) {
    import(&pool, &golden("catalog.json"), "test", None)
        .await
        .unwrap();
    let (status, list) = call(&pool, "GET", "/catalog/spell-list/class.wizard", None).await;
    assert_eq!(status, StatusCode::OK);
    let list = list.as_array().unwrap();
    assert!(!list.is_empty());
    assert!(
        list.iter()
            .all(|s| s["id"].as_str().unwrap().starts_with("spell.") && s["name"].is_object())
    );
    let (_, none) = call(&pool, "GET", "/catalog/spell-list/class.unknown", None).await;
    assert_eq!(none, json!([]));
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn search_ignores_accents_case_and_word_order(pool: PgPool) {
    let entity = |id: &str, r#type: &str, fr: &str, en: &str| json!({ "id": id, "type": r#type, "name": { "fr": fr, "en": en } });
    let catalog = json!({
        "version": "test",
        "entities": [
            entity("item.longsword", "item", "Épée longue", "Longsword"),
            entity("item.bastard_sword", "item", "Épée bâtarde", "Bastard sword"),
            entity("feat.weapon_focus", "feat", "Arme de prédilection", "Weapon Focus"),
            entity("spell.fireball", "spell", "Boule de feu", "Fireball"),
            entity("spell.delayed_blast_fireball", "spell", "Boule de feu à retardement", "Delayed Blast Fireball"),
            entity("feat.cœur", "feat", "Cœur 100%", "Heart"),
        ]
    });
    import(&pool, &catalog, "test", None).await.unwrap();
    let found = |uri: &'static str| {
        let pool = pool.clone();
        async move {
            let (status, page) = call(&pool, "GET", uri, None).await;
            assert_eq!(status, StatusCode::OK, "{uri}: {page}");
            let ids: Vec<String> = page["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap().to_owned())
                .collect();
            (ids, page["next"].clone())
        }
    };

    assert_eq!(
        found("/search?q=EPEE").await.0,
        ["item.bastard_sword", "item.longsword"]
    );
    assert_eq!(found("/search?q=longue%20epee").await.0, ["item.longsword"]);
    // English names and ids are searched too.
    assert_eq!(
        found("/search?q=sword").await.0,
        ["item.bastard_sword", "item.longsword"]
    );
    assert_eq!(
        found("/search?q=feat.weapon_focus").await.0,
        ["feat.weapon_focus"]
    );
    // A name that starts with the query comes before one that only contains it.
    assert_eq!(
        found("/search?q=boule%20de%20feu").await.0,
        ["spell.fireball", "spell.delayed_blast_fireball"]
    );
    assert_eq!(
        found("/search?q=feu&type=item").await.0,
        Vec::<String>::new()
    );
    assert_eq!(found("/search?q=coeur").await.0, ["feat.cœur"]);
    // `%` is a plain character, not a wildcard.
    assert_eq!(found("/search?q=100%25").await.0, ["feat.cœur"]);
    assert_eq!(found("/search?q=e%25e").await.0, Vec::<String>::new());

    let (first, next) = found("/search?q=e&limit=2").await;
    assert_eq!((first.len(), next), (2, json!(2)));
    let (_, last) = found("/search?q=e&limit=2&offset=4").await;
    assert_eq!(last, Value::Null);

    assert_eq!(
        call(&pool, "GET", "/search?q=%20", None).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_entity_comes_with_its_relations_and_their_names(pool: PgPool) {
    let catalog = json!({
        "version": "test",
        "entities": [
            { "id": "spell.fireball", "type": "spell", "name": { "fr": "Boule de feu" } },
            { "id": "class.wizard", "type": "class", "name": { "fr": "Magicien" }, "hitDie": 4 }
        ],
        "relations": [
            { "from": "spell.fireball", "relation": "on_spell_list", "to": "class.wizard", "level": 3 },
            { "from": "spell.fireball", "relation": "on_spell_list", "to": "domain.unknown", "level": 3 }
        ]
    });
    import(&pool, &catalog, "test", None).await.unwrap();
    let (_, detail) = call(&pool, "GET", "/entities/spell.fireball", None).await;
    assert_eq!(
        detail["relations"],
        json!([
            { "relation": "on_spell_list", "to": "class.wizard", "extra": { "level": 3 }, "name": { "fr": "Magicien" } },
            { "relation": "on_spell_list", "to": "domain.unknown", "extra": { "level": 3 }, "name": null }
        ])
    );
}
