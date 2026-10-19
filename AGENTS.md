# LORE.

**LORE.** (capitals, final dot) is a companion app for a private group playing D&D 3.5 far past level 20 (characters
at level 59+), with a lot of team-created content: character sheets computed from choices, a searchable catalog, and
an editor for the group's own content. Clients: Android and iOS (Kotlin Multiplatform, Compose, SwiftUI) and a React
web app. Backend: Rust. Deployment: Docker Compose on a home server, reachable over HTTPS.

Design documents (owner's Claude Docs, readable with the Claude Docs tools): PRD `1xMWUKLs3tuxQVTFqbbbH9`, Rules
engine model `97nW4QWw5NosBZHyGF6ZVj`, Catalog model `TB3H5i5iQz8rz1jXYTZS38`, Character model
`Hqu9NdiJGXKPGjhzUrAS1x`, Engine spike plan `McC2yiPPmYDxN728NcC5S5`, Engine spike report
`0b757acc-e09d-4259-a34f-fa540a16444a`. The essentials are summarized in the `AGENTS.md` of each folder; when they and
a document disagree, ask.

## Layout

| Folder | What | Rules |
| --- | --- | --- |
| `engine/` | Kotlin Multiplatform rules engine, its own Gradle build (`core`, `golden-runner`, `bench`) | `engine/AGENTS.md` |
| `server/` | Rust backend: catalog, characters, accounts, content editing | `server/AGENTS.md` |
| `apps/web/` | React web app | `apps/web/AGENTS.md` |
| `apps/android/`, `apps/ios/` | later (mobile milestone) | |
| `content/` | official catalog batches, the scripts that built them, Danalieth's spreadsheet | `content/AGENTS.md` |
| `test-references/` | hand-checked sheets the engine must keep giving (Danalieth level 59 + six small cases) | `test-references/README.md` |
| `deploy/` | production: `Caddyfile`, `import-content.sh` (first import), `backup.sh` (nightly export) | `docs/deploy.md` |
| `docs/` | `status.md`: where the project stands, next steps, decisions, known limits; `deploy.md`: the VPS guide | |

## Current phase: PoC (server + web app), before the first commit

The engine spike is done: one Kotlin Multiplatform engine (see the spike report). The SwiftUI integration, an
Android demo and real-phone timings move to the mobile milestone. The owner commits once the whole PoC works, and
reviews the code before any commit.

Not done yet: magic items, search facets, tags, glossary and descriptions, editing a past level, editing relations
other than spell levels and class tables in the app, play state on the server, sharing characters,
English, import pipeline. Production (`compose.prod.yaml`, Caddy with HTTPS, nightly backups) runs on an OVH VPS
(`docs/deploy.md`).

## Before saying something works

Each part has its own checks (see its `AGENTS.md`): `engine/` `./gradlew allTests`; `server/` fmt, clippy, tests;
`apps/web/` `npm test` and `npm run build`; content batches their `content/tools/*/check.mjs`. Data rules that hold
everywhere: never `docker compose down -v` on a server, entity ids never change, team content and characters live
only in the database (see `server/AGENTS.md`, Data safety).

## Conventions

- Entity ids: type prefix + lowercase English name, never changed (`feat.power_attack`).
- User-facing text: French and English, keywords referenced by id so they stay bold and translated.
- Content outside the SRD (Book of Nine Swords, Complete Arcane, Complete Mage): short summaries, never book text.
