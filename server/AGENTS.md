# Server (`server/`)

The Rust backend. It **never runs the engine** (PRD section 6): it stores choices and catalog data, and clients
compute sheets. No endpoint returns the whole catalog (target: tens of thousands of entities): a client gets the core
rule sections plus the closure of its character's entities, and later only what changed (PRD 5.5, Catalog model
"Mobile cache").

## Build and test

- Rust comes from Homebrew's `rustup`; its shims are in `$(brew --prefix rustup)/bin`, which is not on the default
  PATH. Copy `../.env.example` to `../.env`, then `docker compose up -d postgres` (host port 5433) and, here with
  `.env` loaded: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (each test gets its own
  temporary database).
- Debug builds keep full debug info for our code only (`[profile.dev.package."*"]` in `Cargo.toml`): the libraries'
  made `target/` several GB. `cargo clean` empties it when needed.
- Full stack, from the repository root: `docker compose up -d --build`, then
  `docker compose exec server server import /test-references/danalieth/catalog.json --author import`. In Docker the
  server sees `./content` as `/content`, `./test-references` as `/test-references` (both read-only) and `./exports` as
  `/exports`.

## How it works

- Stack: axum, sqlx (runtime queries, no compile-time macros), PostgreSQL 17, `serde_json` with
  `arbitrary_precision` (numbers pass through as text, never f64).
- Tables (`server/migrations/`): `entity` + `entity_version` (full JSON per version, author, date, note),
  `entity_relation`, `progression_row` (class tables), `catalog_section` (every other top-level catalog key, as is).
- Import (`server import <file> --author <name> [--note <text>]`): one transaction; an entity gets a new version only
  when its JSON changed. Files may be partial batches, so nothing absent from the file is deleted.
- Closure (`POST /catalog/closure {roots}`): entities reached through ids found in content (any string shaped like an
  id, including inside formulas), outgoing relations except `on_spell_list`, and class table rows. Danalieth's closure
  (80 of 92 entities) gives the same 20 verified values in the reference runner. `{character}` instead of `{roots}`
  gives a draft character's closure (as `GET /characters/{id}/catalog`, every skill included), for the level-up preview.
- Search (`migrations/0004_search.sql`): every word of `q` must appear in the names (every language) or the id (`.` and
  `_` read as spaces), accents and case ignored (`unaccent`, `lore_fold`). A trigram GIN index on
  `lore_search_text(content)` of `entity_version` serves it, so import and restore need no extra step. Order: names
  starting with the query, then names with a word starting with it, then the rest, by name; paged by `offset` (max
  10 000).
- Content editing (`server/src/catalog/edit.rs`, PRD 5): `POST /entities {entity, note, variantOf?}` and
  `PUT /entities/{id} {version, entity, note}`, each save a new `entity_version` with the user's login as author.
  Owner's rule: every member creates and edits team content (`provenance: "team"`, forced for members); official
  content (any other provenance) only admins (403). Id and type never change; a stale `version` gives 409 with
  `current`, a taken id on create too. The server checks only the shape (id `prefix.lowercase_words`, a type, a
  name); the client checks the rest with the engine. A variant gets a `variant_of` relation to its original
  (`GET /entities/{id}` returns `variantOf`; closures do not follow it). `GET /entities/{id}` also lists the
  entity's outgoing `relations` with each target's name: a spell page shows its levels (`on_spell_list`) and its
  `spell` block; a class or domain page lists its spells by level (`/catalog/spell-list/{id}`).
- A spell's levels are edited with it (owner's choice): `spellLists: [{to, level}]` in the create / update body
  replaces its `on_spell_list` relations (a class, prestige class or domain of the catalog, once each, level 0–30;
  other fields an import put on a kept relation stay). Same permissions as the spell. Each app-written spell version
  stores the levels it had in `entity_version.relations` (`migrations/0005_version_relations.sql`), so the history
  shows who changed a level and when; versions from an import have none. A change of levels alone is a new version.
  Re-importing `lists.json` would overwrite levels edited in the app.
- `GET /catalog/spell-list/{classId}`: the spells on a class's list with their level and name (for picking spells
  known; the closure leaves `on_spell_list` out).
- Endpoints: `GET /health`, `GET /catalog/core`, `POST /catalog/closure`, `GET /entities?type=&after=&limit=` (paged by
  id, max 200; each item has `id`, `type`, `name`, `labels`), `GET /search?q=&type=&offset=&limit=` (same items), `GET /entities/{id}`, `GET /entities/{id}/versions`.
- Auth (`server/src/auth/`, PRD 5.6): everything except `/health`, `/auth/login|refresh|logout` and `/auth/invitation[/accept]` goes through the
  `require_user` middleware (`Authorization: Bearer <access token>`); handlers take `CurrentUser` to know who calls.
  - Passwords: Argon2id, at least 12 characters; logins are case-insensitive. Unknown login and wrong password give
    the same answer and take the same time.
  - Access token: JWT HS256 (`JWT_SECRET`, at least 32 bytes), 15 minutes, holds the user id and role.
  - Refresh token: random, 30 days, only its SHA-256 hash is stored. Each refresh replaces it (same family = same
    session); reusing a used token revokes the whole family, except a retry within 30 s while no
    newer token of the family was used (a lost answer): it gets a new pair, and the token never received is revoked. Logout revokes the family.
  - Login rate limit: 5 failures per login in 15 minutes, in memory (per-address limits belong to the reverse proxy).
  - Accounts: no sign-up; `server user add <login> [--role admin]`, `server user password <login>`,
    `server user disable <login>`, `server user rename <login> <new login>` (password read from the terminal or stdin).
    A new password or disabling ends every session. Owner's rule: the login is the person's email.
  - Invitations (`server/src/auth/invitations.rs`, `migrations/0006_invitation.sql`): `server user invite <email>
    [--role admin] [--no-email]` stores the SHA-256 of a random token (7 days, one use; a new one for the same email
    replaces the pending one) and mails `<APP_URL>/invite#<token>` (`server/src/mail.rs`: lettre, SMTP on 465 with
    rustls, `SMTP_HOST` default Gmail, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`). The token sits after `#` so it
    stays out of server logs. `POST /auth/invitation {token}` gives `{email, role, expiresAt}`;
    `POST /auth/invitation/accept {token, password}` creates the account (login = email) and returns a token pair.
    Unknown, used and expired tokens give the same 404; a short password 400 (the link stays usable); an account
    made meanwhile 409. Invitations are not exported (temporary, like refresh tokens).
- Characters (`server/src/characters/`): build choices (the engine's character JSON, every saved version kept in
  `player_character_version`) and play state (`player_character_play`, an opaque JSON object owned by the clients,
  no history), each with its own `updatedAt`. The server sets `content.id` to the character's UUID and checks only
  `name` and `baseAbilities`. Owner reads and writes, admins read, anyone else gets 404. Archive, never delete.
  - **Sync rule (owner):** a push carries the `updatedAt` it was based on; if the server copy is newer, 409 with
    `current`, and the client takes it (the server wins). `updatedAt` always increases (at least +1 µs per write).
  - Endpoints: `GET|POST /characters` (`updatedSince`, `archived`, `all` for admins), `GET|PUT /characters/{id}`,
    `PUT /characters/{id}/play`, `POST /characters/{id}/archive|restore|duplicate`,
    `GET /characters/{id}/versions[/{n}]`, `GET /characters/{id}/catalog` (closure of the ids in the character).
- Development (`compose.yaml`) publishes the server on 127.0.0.1:8080 only. Production (`compose.prod.yaml`, `docs/deploy.md`)
  publishes nothing but Caddy (80, 443), which serves the web app and forwards `/api/*` to the server over HTTPS.

## Data safety (owner's rules)

- Sources of truth: official content = batch files in git (re-importable); team content, characters, accounts and
  history = the database. Never `docker compose down -v` on a server; entity ids never change.
- `server export <dir>` (`server/src/archive/`): the whole database, history included, one JSON file per entity
  (`catalog/entities/<type>/<id>.json`) and per character (`characters/<uuid>.json`), plus sections, relations, class
  tables, `accounts.json` (Argon2 hashes: folder 0700, file 0600) and `manifest.json` (`format`, `schema`, counts).
  Deterministic: the same database always gives the same bytes. Refresh tokens are not exported.
- `server restore <dir>`: into an empty database only, one transaction, ids and `updatedAt` kept (clients' sync
  tokens stay valid), identity sequences moved past the highest id. Refuses an unknown `format`, a newer schema, a
  file whose name does not match its id, counts that differ from the manifest.
- `server export-catalog <file>`: the current catalog in the `import` format.
- Moving the infrastructure: stop writes, `export` on the old machine, `restore` on the new one, `export` there, and
  `diff -r` the two folders: no output means nothing was lost. In Docker the server sees `./exports` as `/exports`
  (`docker compose exec server server export /exports/<date>`).
- Changing the archive layout or a record means bumping `archive::FORMAT` and teaching `restore` the old format.
  Format 2 added `relations` to entity versions; restore reads formats 1 and 2 (`READABLE_FORMATS`).
