# Status: LORE. PoC (server + web app)

For a new session. Read `AGENTS.md` (root) first, then the `AGENTS.md` of the folder you work in: they hold the
rules and are the source of truth. This file holds what they do not: status, decisions, open questions, and how the
owner works.

On 2026-10-19 the repository was reorganized before the first commit: `engine/` (its own Gradle build: `core`,
`golden-runner`, `bench`, formerly `engine`, `engine-golden`, `demo-web`), `apps/web/` (formerly `web/`),
`test-references/` (formerly `golden/`), `content/tools/` (formerly `tools/srd/`), `content/sources/`, and this file
(formerly `HANDOFF.md`). Older entries below may use the former names.

## Status

- Engine spike: done, decision **go** (Claude Doc "Engine spike report", `0b757acc-e09d-4259-a34f-fa540a16444a`).
  The owner judged the JS and simulator results enough; iOS/Android demos and real-phone timings move to the mobile
  milestone.
- Server catalog read slice: written and tested, **not reviewed by the owner yet**. Nothing is committed and the folder
  is still not a git repository (the owner said "not yet" on 2026-10-15).
- Login (password + access and refresh tokens + middleware): written and tested, not reviewed either. A disabled test
  account `demo` exists in the local Docker database.
- Characters (choices with history, play state, sync rule, owner/admin access, character catalog): written and
  tested, not reviewed either. A disabled `tester` account and one Danalieth copy exist in the local Docker database.
  Verified: a character stored by the server plus its `/catalog` gives the 20 verified values in the JVM runner.
- Web app `web/` (login, characters, Combat sheet with breakdowns and play state, Build, catalog, account, two
  themes): written, not reviewed. Verified in Chrome at desktop width: login, home, and the Combat tab showing the
  verified Danalieth values (+145, 3d6 + 138 ~148, saves 81/84/44, HP 2 480, SR 72, BAB 49). The clicks (toggles,
  damage, undo), the other screens, phone width and the dark theme were NOT checked in the browser: a password
  manager popup blocked the browser tools. The toggle flow was checked through the engine API in Node instead.
  A `webtester` account with one Danalieth exists in the local Docker database.
- Engine API additions for the app: `toggles` with `source`, `dailyUses`, `prerequisites`, `setToggleChoice`,
  structured breakdown fields. Tests: `engine` 59 and `engine-golden` 4 on JVM, Node, Chrome, iOS simulator.
- Content: scraper `tools/srd/scrape.mjs`, first batch `content/srd/races.json` (7 races, effects + own summaries +
  source URL), `server import --dry-run`. Imported in the local Docker database. Not reviewed. Open point: the site
  shows no OGL notice (see `content/AGENTS.md`); the owner believes 3.5 content is open: the English SRD is
  (OGL 1.0a), the site's French wording is not established.
- Spell system: engine (slots per class from the class table + bonus spells + ladder above the maximum, spells known,
  saved variants with slot level / DC / numbers, `previewVariant`), Bard spell columns and 42 spells (levels 0–1),
  Magic tab (slots, cast, undo, new day, variant builder). Checked in Chrome on a level 5 Human Bard (« Lyra », account
  `webtester`): slots 3/4/2, casting spends a slot, a saved variant appears. Not reviewed.
- Spells: Danalieth's highest Wizard slot is 22 (9 + 12 Improved Spell Capacity + 1 epic spell); her sheet said 24,
  the owner keeps 22. Shepherd's Hand (not SRD) stays. Her test catalog was migrated (`spellcasting` on Wizard / Sorcerer, `slots.above_max[{choice}]`,
  choices → Wizard); her 20 verified values are unchanged.
- Content: the 9 other SRD base classes (Druid, Sorcerer, Fighter, Wizard, Monk, Paladin, Cleric, Ranger, Rogue), with
  their spell columns, and 38 shared entities in `rules.json` (skills, Knowledge fields, heavy armor, tower shield,
  weapons). Checked with the engine on a Human of each class at levels 1, 4, 5, 11, 20; imported in the local Docker
  database. Danalieth now has slots: Wizard up to slot level 22 (9 + 12 Improved Spell Capacity + 1 Will of Death),
  Sorcerer up to 9; her sheet says 24. A test Paladin « Aldric » (level 8, account `webtester`) shows half-caster slots.
- Content: all 605 SRD spells (`content/srd/spells/srd-01…31.json`, written and reviewed by agents from the scraped
  pages: one writer and one reviewer per 20 spells), their class lists checked against the SRD (`lists.json`, ~40
  scraped link errors fixed) and the 22 cleric domains (`domains.json`). Imported in the local Docker database. The old
  `bard.json` is merged into these files. Not reviewed. Danalieth's local catalog lost 4 level-less Wizard list
  entries marked "to confirm" (Barkskin, Divine Favor, Divine Power, Spell Resistance): the SRD lists replaced them.
- Content: the 15 SRD prestige classes (`content/srd/prestige/`, one writer and one reviewer agent each), 4 more
  weapons in `rules.json`, the Assassin and Blackguard spell lists in `lists.json`, Corrupt Weapon in
  `srd-prestige-blackguard.json`. Imported in the local Docker database; Danalieth's 20 verified values unchanged
  (golden runner files and her stored copy through the server). Not reviewed.
- Content: SRD feats (`content/srd/feats/`): 132 from the site (one writer and one reviewer agent per 10 feats) and
  60 generated focus feats; class powers grant the feats they give (Track, Scribe Scroll…). Monk bonus feat options
  fixed (1: Improved Grapple or Stunning Fist; 2: Combat Reflexes or Deflect Arrows). Imported in the local Docker
  database (197 feats with Danalieth's 5 non-SRD ones); her 20 verified values unchanged (merged files and her
  stored copy through the server). Not reviewed.
- Content: SRD equipment (`content/srd/equipment/`, 256 items: tables turned into items by
  `tools/srd/equipment/prepare.py`, texts by one writer and one reviewer agent per chunk of ~15). The 29 weapons of
  `rules.json` moved there (same ids). Engine: new `Entity.item` display block (`ItemInfo`); core statistics: `ac.shield`
  (base 0) is now part of `ac.total` (golden catalog, and the `statistics` section re-imported alone in the local
  database). Imported locally; Danalieth's 20 verified values unchanged. Not reviewed. The web app does not show the
  `item` block (nor the `spell` block) yet.
- Engine: weapon dice scale with the wielder's size (`StatisticDef.diceSteps`, catalog section `diceSteps`, new
  breakdown step `size`, `SizeDiceTest`). Core statistics gained `size` (default `'medium'`), `size.steps`,
  `weapon.size_steps`, `weapon.damage` and `unarmed.damage` definitions (golden catalog; re-imported as sections in the
  local database). The monk's unarmed damage is now a base `set`, so it scales too. Checked: all 67 weapons with dice
  give the site's Small column for a Halfling; monk Small 1d4 … 2d8. Danalieth unchanged. Not reviewed.
  Danalieth's Force of the Colossus now adds 1 to `weapon.size_steps` instead of setting 3d6 (owner's choice; same
  3d6). The ladder stops at 12d6 / 12d8 (owner: keep it so for now; a die past the end stays and is reported).
- Skills (engine, data, web): `skill` blocks and synergies on the 44 skills, `skillPoints` on every class, built-in
  skill statistics, ranks as one map per character (`skillRanks`, owner's rule), skill points budget, the Skills tab
  and the Build screen editor. Core statistics: `initiative` (Dex), `attack.ranged` = BAB + Dex + `weapon.attack`
  (damage keeps Strength, owner's choice), `weapon.attack` base 0. Server: a character's catalog holds every skill.
  Danalieth's stored copy got the golden choices (Wizard for Improved Spell Capacity and the epic spell). Tests:
  engine `SkillsTest`, server closure test. Not checked in a browser; not reviewed.
- Character editor (web, engine, server): see `apps/web/AGENTS.md` « Character editor ». Engine: `Character.alignment`,
  `featSlots` in the API (`FeatSlotsTest`); core statistics `feat_slots.general` / `feat_slots.epic`, `ac.armor` and
  `ac.natural` base 0 (a character without armor had no AC); SRD epic bonus feats on the 11 base classes. Server: draft
  closure, spell list endpoint, labels in entity lists. Web: threat range shown as « 19–20 » (width stored). Checked in
  Chrome on a new Human « Brann » (account `webtester`): creation, levels 1–4 (Fighter / Wizard), feats per slot
  with prerequisites, spellbook, items, removing the last level; Combat tab numbers right (AC 14 with a chain shirt,
  longsword +6 / 1d8 + 3, 19–20 ×2). Checked at phone width (390 px, in a frame: Chrome would not resize its window):
  Combat, level-up and Build screens fit, no sideways scroll, the tab bar scrolls. Not reviewed.
- Auth: refresh retry grace (30 s). A page reload during a token refresh used to log the session out; now a used
  token presented again within 30 s, when no newer token of the session was used, gets a new pair and the token the
  client never received is revoked. Past 30 s, or after a newer token was used, it is theft as before (whole session
  revoked); a revoked token presented also ends the session. Tests in `server/tests/auth.rs`.
- To do (owner): prestige class entry requirements as formulas (skill ranks can now be checked:
  `@skill.x.ranks >= 8`), and the feats' skill-rank prerequisites the same way.
- Export / restore (`server export`, `server restore`, `server export-catalog`): written and tested, not reviewed.
  Rehearsed in Docker: export, restore into a scratch database, export again, `diff -r` identical (109 files).
- Tests: `server` 5 unit + 26 integration; `web` 14 unit (format, API client refresh, play state). Clippy, rustfmt and
  `tsc` clean.
- Verified end to end: Docker stack up, golden catalog imported (92 entities, 38 relations, 67 class rows, 7 sections;
  a second import changes nothing), Danalieth's closure fed to the JVM golden runner gives the same 20 verified values.

## Next steps

1. Owner tries the web app, then reviews everything (`server/`, `apps/web/`, `engine/`, `content/`, `compose.yaml`) and
   makes the first commit (the owner commits once the whole PoC works).
2. Then, in PRD order: the rest of search (facets, tags, glossary, full text in descriptions, Catalog model
   "Search"; names and ids are done); later sharing characters inside the group (MVP+).
3. Deploy on a Hetzner VPS (owner's choice, 2026-10-19), following `docs/deploy.md`: `compose.prod.yaml`, Caddy
   (HTTPS, web app, `/api`), `deploy/import-content.sh`, `deploy/backup.sh`. Tested locally as a full stack with
   `localhost`; not deployed yet. Still missing: login limits per address, core sections in a batch of their own.
4. Agreed with the owner, for later: automatic backups (nightly `pg_dump` with rotation, a copy off the machine, a
   restore tested regularly) and content migrations as code (when the engine model first changes, a versioned script
   upgrades each entity's current content as a new version authored "migration").

## Decisions made with the owner (beyond the AGENTS.md files)

- No endpoint returns the whole catalog: core sections + the closure of a character's entities, then deltas.
- Import of partial batch files deletes nothing absent from the file.
- Earlier engine decisions: see the spike report and `engine/AGENTS.md`.

## Not confirmed by the owner (review these)

- Bonus types and statistics stay top-level catalog sections (`catalog_section`), although the Catalog model lists
  them as entity types. Same split as the planned shared core catalog.
- The closure scans content for any string shaped like an id. A prerequisite such as `has('feat.x')` therefore pulls
  `feat.x` even when the character does not have it (cheap, never wrong for the engine).
- `bonus_type.*` entities (descriptions only) are not reached from Danalieth's choices; the engine reads the
  `bonusTypes` section, which is always sent.
- The engine-side items from the spike: see "To review" in the spike report.

## Known limits

- Web: the home card shows name and level only (the numbers need each character's catalog). Catalog search covers
  names (every language) and ids only: no filters, no search in descriptions. The level-up feat list still loads every
  feat into the page (`allOfType`); at tens of thousands of entities it should use `/search`. Content editor: no
  preview on a character, no going back to an old version (owner's choice), relations other than a spell's levels and class tables
  are not editable (batch files only; re-importing `lists.json` would overwrite levels edited in the app), the server trusts the client's engine check. The weapon line shows the engine's
  raw `weapon.threat_range` (10) and `weapon.crit_multiplier` (12); the mockup says « 13–20 ×8 »: these values are not
  hand-verified, check the data and the meaning of threat range. The production bundle is one 843 KB file (231 KB
  gzipped); split the engine out with a dynamic import if it matters.

- Characters: the sync delta (`updatedSince`) compares server times set at the start of each transaction, so a write
  that commits just after a pull can carry an older `updatedAt` and be missed by the next delta. Rare with a few
  users; fix if needed by pulling with a small margin (for example 2 s before the last `updatedAt`).
- Toggles: the engine reads `activeToggles` from the character, while the Character model puts toggles in play state.
  The server stores whatever the client sends; decide before the mobile play mode.
- The golden runner checks that `expected.json` names the character's id: a character stored by the server has a
  UUID id, so a golden case made from it needs that id.

- Auth: an access token stays valid up to 15 minutes after logout, a new password or disabling (no server-side
  check per request). A lost refresh response can be retried within 30 s (see Status); later, it counts as reuse
  and the user must log in again. The login limiter is in memory: a restart clears it.
- Where the web app keeps the refresh token (httpOnly cookie or memory) is not decided; today it comes in the JSON body.

- `rule.hit_points` and `rule.experience` are still defined twice in the golden catalog (stored as is in the `rules`
  section).
- Relations and class tables have no history (only entities are versioned, as in the Catalog model).

## How the owner works

- Simple vocabulary in English and French; in French keep technical terms in English ("commit", "cache", "buffer").
  Explain the reasoning, not only the conclusion. Prefers short answers.
- Comments in code only for non-obvious logic or deliberate workarounds, briefly saying why.
- Always let the owner review code before committing. Never commit on your own.
- Prefers a plain yes / no question with a proposal over open questions; corrects a wrong rule directly, so state
  rules explicitly before encoding them.
- Pushes back on designs that do not scale (the whole-catalog endpoint): check the data size targets in the docs.
