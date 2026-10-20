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

/// Spells, a feat and a class power with school, descriptors, spell lists and effects, for the search filters.
fn search_catalog() -> Value {
    let spell = |id: &str, fr: &str, school: &str, descriptors: Value, description: &str| {
        json!({
            "id": id, "type": "spell", "name": { "fr": fr },
            "spell": { "school": school, "descriptors": descriptors },
            "description": { "fr": description }
        })
    };
    let mut cone = spell(
        "spell.cone_of_cold",
        "Cône de froid",
        "Évocation",
        json!(["Froid"]),
        "Un cône de glace.",
    );
    // Scoped to the spell: it says nothing about the character.
    cone["effects"] = json!([{ "op": "add", "scope": "spell", "target": "ac.total", "value": 1 }]);
    json!({
        "version": "test",
        "entities": [
            spell("spell.fireball", "Boule de feu", "Évocation", json!(["feu"]), "Une explosion de flammes."),
            cone,
            spell("spell.fear", "Terreur", "Nécromancie", json!(["mental", "terreur"]), "Les créatures sont aveuglées par la peur."),
            spell("spell.blindness", "Cécité", "Nécromancie", json!([]), "La cible devient aveugle."),
            {
                "id": "spell.shield_of_faith", "type": "spell", "name": { "fr": "Bouclier de la foi" },
                "spell": { "school": "Abjuration" },
                "effects": [{ "op": "add", "target": "ac.total", "value": 2 }]
            },
            {
                "id": "feat.blind_fight", "type": "feat", "name": { "fr": "Combat en aveugle" },
                "description": { "fr": "Se battre sans voir." }
            },
            {
                "id": "feat.dodge", "type": "feat", "name": { "fr": "Esquive", "en": "Dodge" },
                "description": { "en": "You are harder to hit." },
                "effects": [{ "op": "add", "target": "ac.total", "value": 1 }]
            },
            {
                "id": "class_power.inner_strength", "type": "class_power", "name": { "fr": "Force intérieure" },
                "effects": [{ "op": "add", "target": "ability.all.score", "value": 2 }]
            },
            { "id": "class.wizard", "type": "class", "name": { "fr": "Magicien" } },
            { "id": "class.cleric", "type": "class", "name": { "fr": "Prêtre" } }
        ],
        "relations": [
            { "from": "spell.fireball", "relation": "on_spell_list", "to": "class.wizard", "level": 3 },
            { "from": "spell.fireball", "relation": "on_spell_list", "to": "class.cleric", "level": 8 },
            { "from": "spell.cone_of_cold", "relation": "on_spell_list", "to": "class.wizard", "level": 5 },
            { "from": "spell.fear", "relation": "on_spell_list", "to": "class.wizard", "level": 4 }
        ]
    })
}

async fn search_page(pool: &PgPool, uri: &str) -> Value {
    let (status, page) = call(pool, "GET", uri, None).await;
    assert_eq!(status, StatusCode::OK, "{uri}: {page}");
    page
}

fn item_ids(page: &Value) -> Vec<&str> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect()
}

/// `[(value, count)]` of one facet.
fn counts(page: &Value, facet: &str) -> Vec<(String, u64)> {
    page["facets"][facet]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            (
                v["value"].to_string().replace('"', ""),
                v["count"].as_u64().unwrap(),
            )
        })
        .collect()
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn search_finds_words_in_descriptions_after_names(pool: PgPool) {
    import(&pool, &search_catalog(), "test", None)
        .await
        .unwrap();

    let page = search_page(&pool, "/search?q=aveugle").await;
    let ids = item_ids(&page);
    // The name first; then the descriptions, where « aveuglées » and « aveugle » share their root.
    assert_eq!(ids[0], "feat.blind_fight");
    assert_eq!(
        ids[1..].iter().copied().collect::<BTreeSet<_>>(),
        BTreeSet::from(["spell.blindness", "spell.fear"])
    );
    assert!(page["items"][0].get("matchedIn").is_none());
    assert_eq!(page["items"][1]["matchedIn"], "description");

    // An unfinished last word is a prefix, accents are ignored, English descriptions are searched in English.
    assert_eq!(
        item_ids(&search_page(&pool, "/search?q=AVEUG").await).len(),
        3
    );
    assert_eq!(
        item_ids(&search_page(&pool, "/search?q=harder%20hit").await),
        ["feat.dodge"]
    );
    assert_eq!(
        item_ids(&search_page(&pool, "/search?q=glace&type=feat").await),
        Vec::<&str>::new()
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn search_filters_spells_by_school_descriptor_and_list(pool: PgPool) {
    import(&pool, &search_catalog(), "test", None)
        .await
        .unwrap();
    let ids = |uri: &'static str| {
        let pool = pool.clone();
        async move {
            let page = search_page(&pool, uri).await;
            item_ids(&page)
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        }
    };

    // No text: sorted by name.
    assert_eq!(
        ids("/search?type=spell&school=N%C3%A9cromancie").await,
        ["spell.blindness", "spell.fear"]
    );
    // Case and accents merged; OR inside a filter, AND between filters.
    assert_eq!(
        ids("/search?descriptor=FROID,Feu").await,
        ["spell.fireball", "spell.cone_of_cold"]
    );
    assert_eq!(
        ids("/search?descriptor=froid,feu&school=Évocation&q=boule").await,
        ["spell.fireball"]
    );
    // List and level hold on the same entry: Fireball is Wizard 3 and Cleric 8, not Wizard 8.
    assert_eq!(
        ids("/search?list=class.wizard&level=8").await,
        Vec::<String>::new()
    );
    assert_eq!(ids("/search?level=8").await, ["spell.fireball"]);
    assert_eq!(
        ids("/search?list=class.wizard&level=3,4").await,
        ["spell.fireball", "spell.fear"]
    );

    // Effects on the character, `ability.all` counting for each ability; the cone's spell-scoped effect is left out.
    assert_eq!(
        ids("/search?affects=ac").await,
        ["spell.shield_of_faith", "feat.dodge"]
    );
    assert_eq!(
        ids("/search?affects=ability.wis").await,
        ["class_power.inner_strength"]
    );

    assert_eq!(
        call(&pool, "GET", "/search?level=high", None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&pool, "GET", "/search", None).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn each_facet_is_counted_without_its_own_filter(pool: PgPool) {
    import(&pool, &search_catalog(), "test", None)
        .await
        .unwrap();

    let page = search_page(&pool, "/search?type=spell&descriptor=feu&facets=true").await;
    assert_eq!(item_ids(&page), ["spell.fireball"]);
    // Choosing fire still shows the other descriptors; the other facets only count fire spells.
    assert_eq!(
        counts(&page, "descriptor"),
        [
            ("feu".into(), 1),
            ("froid".into(), 1),
            ("mental".into(), 1),
            ("terreur".into(), 1)
        ]
    );
    assert_eq!(counts(&page, "school"), [("évocation".into(), 1)]);
    assert_eq!(counts(&page, "level"), [("3".into(), 1), ("8".into(), 1)]);
    assert_eq!(page["facets"]["list"][0]["name"], json!({ "fr": "Prêtre" }));

    let page = search_page(&pool, "/search?list=class.wizard&level=3&facets=true").await;
    // Levels on the wizard list; lists that have a level 3 spell.
    assert_eq!(
        counts(&page, "level"),
        [("3".into(), 1), ("4".into(), 1), ("5".into(), 1)]
    );
    assert_eq!(counts(&page, "list"), [("class.wizard".into(), 1)]);

    let page = search_page(&pool, "/search?q=e&facets=true").await;
    // Most results first, then by value.
    assert_eq!(
        counts(&page, "affects")[..3],
        [
            ("ac".into(), 2),
            ("ability.cha".into(), 1),
            ("ability.con".into(), 1)
        ]
    );
    assert!(page["facets"]["affects"][0].get("name").is_none());
    assert!(
        search_page(&pool, "/search?q=e")
            .await
            .get("facets")
            .is_none()
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

#[sqlx::test(migrator = "server::MIGRATOR")]
async fn an_entity_names_the_entities_its_content_refers_to(pool: PgPool) {
    let catalog = json!({
        "version": "test",
        "entities": [
            { "id": "feat.cleave", "type": "feat", "name": { "fr": "Enchaînement" },
              "prerequisite": "@ability.str.score >= 13 and has('feat.power_attack') and @skill.jump.ranks >= 2" },
            { "id": "feat.power_attack", "type": "feat", "name": { "fr": "Attaque en puissance" } },
            { "id": "skill.jump", "type": "skill", "name": { "fr": "Saut" } }
        ]
    });
    import(&pool, &catalog, "test", None).await.unwrap();
    let (_, detail) = call(&pool, "GET", "/entities/feat.cleave", None).await;
    assert_eq!(
        detail["references"],
        json!([
            { "id": "feat.power_attack", "type": "feat", "name": { "fr": "Attaque en puissance" } },
            { "id": "skill.jump", "type": "skill", "name": { "fr": "Saut" } }
        ])
    );
}
