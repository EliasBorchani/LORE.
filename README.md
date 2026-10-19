# LORE.

A companion app for a private group playing Dungeons & Dragons 3.5 far past level 20. LORE. computes every character
sheet from the player's choices (classes, feats, items, spells), explains where each number comes from, and holds the
group's own rules content next to the official one, with an editor and a search.

Status: proof of concept (server and web app). The Android and iOS apps come later.

## How it fits together

```
apps/web (React)  ──┐                       ┌── PostgreSQL
apps/android, ios ──┼── HTTPS ── server ────┤
   (later)          │          (Rust)        └── content/ batches, imported once
                    │
     each client runs the engine (Kotlin Multiplatform) itself: the server only stores choices and content
```

| Folder | What |
| --- | --- |
| `engine/` | The rules engine (Kotlin Multiplatform, one code base for JVM, JavaScript and iOS), its reference test runner and a benchmark |
| `server/` | The backend (Rust, axum, PostgreSQL): catalog, characters, accounts, content editing, export and restore |
| `apps/web/` | The web app (React, TypeScript, Vite), in French |
| `content/` | The official catalog as JSON batches, the scripts that built them, and source files |
| `test-references/` | Hand-checked character sheets the engine must keep giving (a level 59 character and six small cases) |
| `docs/` | Project status, decisions and known limits |

## Quick start

Needs Docker, JDK 21, Node 22+ and Rust (through `rustup`).

```sh
cp .env.example .env                      # then set POSTGRES_PASSWORD and JWT_SECRET
docker compose up -d --build              # PostgreSQL + the server on 127.0.0.1:8080
docker compose exec server server import /test-references/danalieth/catalog.json --author import
docker compose exec server server user add <login> --role admin

cd engine && ./gradlew :core:jsBrowserProductionLibraryDistribution && cd ..
cd apps/web && npm install && npm run dev  # http://localhost:5173
```

The official SRD batches are imported the same way, one file at a time from `/content/srd/` (with `--dry-run` first).

Production (a small VPS, Caddy with automatic HTTPS, nightly backups): see `docs/deploy.md`.

## Tests

| Part | Command |
| --- | --- |
| Engine (JVM, JavaScript, iOS simulator) | `cd engine && ./gradlew allTests` |
| Server | `cd server && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (needs `docker compose up -d postgres`) |
| Web app | `cd apps/web && npm test && npm run build` |
| A content batch | `node content/tools/<kind>/check.mjs <file>` |

## Content and licence

Rules content comes from the D&D 3.5 System Reference Document. Entities carry the rules as data and short summaries
written for LORE.; texts from French rules websites are never copied. Team content lives in the database, not in this
repository.

## For coding agents

Start with `AGENTS.md`, then the `AGENTS.md` of the folder you work in. `CLAUDE.md` files import them.
