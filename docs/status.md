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
- Tome of Battle (engine, server, web, content), 2026-10-21: the 3 classes, 9 disciplines, Martial Lore and the 208
  maneuvers and stances from the owner's PDF (see `content/AGENTS.md`). Engine: `maneuver` block, `initiating`, table
  columns, `character.maneuvers`, built-in initiator statistics, `initiators` in the API (`InitiatingTest`). Server:
  `discipline` and `maneuver_level` search filters (`0010_maneuver_filters.sql`), `catalog/maneuvers/{class}`. Web:
  maneuver facts and filters in the catalog, guided forms, class table columns, « Manœuvres » on the Build screen, one
  stance at a time (two with Stance Mastery). Then: `@initiator_level` in formulas, `maneuvers.count[…]` for
  prerequisites, feats that give maneuvers, the book's 38 feats, an effects pass over the maneuvers, 9 new
  situations. Checked: engine allTests, server tests, web tests and build, content checks, an import into a
  throwaway database (before the feats). Not checked in a browser; not reviewed; not imported on the VPS.
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
2. Then, in PRD order: the rest of search (tags, glossary; names, ids, descriptions and filters are done,
   2026-10-20); later sharing characters inside the group (MVP+).
   Search (2026-10-20, owner's choices: filter values computed from the content, no facet tables yet): full text in
   descriptions (French and English), filters École, Registre, Liste de sorts + Niveau, Affecte, with counts. Tested
   in Chrome on the dev stack; 7–220 ms on the catalog copied 20 times (28,600 entities).
   Info panel (2026-10-20, owner's choices: a panel over the screen, not a page change; sheet, Build, level-up and
   catalog): a tap on a spell, power, feat, class or item name shows what it does without leaving the sheet;
   prerequisites read « Force ≥ 13 et Attaque en puissance ». Tested in Chrome on the dev stack (wide and 400 px).
   Heighten Spell (2026-10-20, owner's choice: Heighten only, Augmented Casting later): « Nouvelle variante » picks how
   many levels to raise the spell; the spell really is that level (slot and DC follow). `feat.heighten_spell` lost its
   fixed +1 cost (`content/srd/feats/srd-09.json`): **on the VPS, re-import that batch** (`server import
   /content/srd/feats/srd-09.json --author srd-import`, see `docs/deploy.md`). Tested in Chrome on the dev stack.
   Next, important for later (owner): effects shown in readable French (« +2 aux tests d'Art de la magie » instead
   of `skill.spellcraft add 2 (untyped)`), on catalog pages and in the info panel.
3. Deploy on an OVHcloud VPS with a DuckDNS address (owner's choice, 2026-10-19), following `docs/deploy.md`: `compose.prod.yaml`, Caddy
   (HTTPS, web app, `/api`), `deploy/import-content.sh`, `deploy/backup.sh`. Deployed and working on the owner's
   OVH VPS (2026-10-19). Still missing: core sections in a batch of their own.
   Login limit per address (2026-10-19): Caddy with the `caddy-ratelimit` plugin, 20 tries in 10 minutes per address
   on `/api/auth/login` and the invitation routes, 429 after that. Tested locally (20 pass, then 429); on the VPS the
   owner checks that Caddy sees real addresses (`docs/deploy.md`, step 6).
   Invitations by email (2026-10-19, owner's choices: Gmail SMTP with an app password, the email is the login):
   `server user invite <email>`, page `/invite#<token>`, `server user rename` for older logins. Tested in Chrome on the
   dev stack with `--no-email`; a real Gmail send still to be tried by the owner (needs the app password in `.env`).
4. Multi-RPG, groups and rulesets (owner, 2026-10-20): PRD draft in `docs/prd-multi.md`, from a grill-me session.
   M1 = groups, permissions, rulesets and overrides on D&D 3.5 only, plus the migration of today's data; M2 = D&D 5e.
   **M1 written (2026-10-20), not reviewed, not deployed.** Owner's choices: house rules resolved on the server (the
   closure sends the override under the official id), groups named by a random id (`/g/<id>/…`), data moved by an
   explicit command (`server migrate-groups`, dry run first, `docs/deploy.md` step 9), one review at the end.
   Checked: engine (JVM, JS; iOS needs Xcode here), server fmt / clippy / 74 tests (stranger 404 on every group,
   ruleset and character endpoint; migration of Danalieth's catalog gives her closure with renamed ids), web tests and
   build, and in Chrome on a scratch database (`lore_m1_check`) migrated from today's shape: Danalieth's verified
   values, a house rule made in the editor, group settings, an invitation creating an account in the group.
   Deployed on the VPS on 2026-10-20 (`migrate-groups` run). A second RPG is not a priority (owner, 2026-10-20): what
   mattered was that the structure scales. Left for later: the engine contract (M2), a public ruleset listing,
   editing a ruleset without a group. Done after the deploy (not reviewed, not deployed): an archived group is
   read-only, and a character moves to another group from the Build screen.
6. The guided CMS (`docs/prd-cms.md`), five phases each reviewed by the owner. **Phase 1 written (2026-10-20), not
   reviewed, not deployed:** Atelier tab, form schemas (feat, class power, generic), recipes and sentence builder,
   prerequisite and uses-per-day builders, live card, private drafts (server table, archive format 4), states and
   recent changes routes. Checked: server fmt / clippy / tests, web tsc / tests (every official effect round-trips
   through the recipes) / build. Reviewed by the owner on 2026-10-21. **Phase 2 written (2026-10-21), not reviewed,
   not deployed:** « dropdowns everywhere » (`docs/prd-cms.md`). Production needs `sources.json`, `situations.json`
   and `feats/srd-01.json` (Power Attack's `tableValue`) imported. **Phase 3 written (2026-10-22), not reviewed:**
   search cards (each result shows its type's facts; catalog home as type cards with counts). Next: phase 4, spell
   and item forms. Three server tests that count Danalieth's closure and archive (80 → 79 entities) fail since
   `test-references/danalieth/catalog.json` changed on 2026-10-21; to look at.
5. Agreed with the owner, for later: automatic backups (nightly `pg_dump` with rotation, a copy off the machine, a
   restore tested regularly) and content migrations as code (when the engine model first changes, a versioned script
   upgrades each entity's current content as a new version authored "migration").

## Decisions made with the owner (beyond the AGENTS.md files)

- No endpoint returns the whole catalog: core sections + the closure of a character's entities, then deltas.
- Import of partial batch files deletes nothing absent from the file.
- Multi-RPG (2026-10-20, details in `docs/prd-multi.md`): account → groups (no organization), a group = one RPG +
  ordered rulesets + characters; permissions per member, not fixed roles; one engine per RPG; official content edited
  by the platform admin only; non-SRD summaries stay visible to all; GDPR and English UI before public sign-up.
- Iconography (2026-10-21): every icon drawn in-house on a 24 grid with a fixed 1.5 px line, reviewed one by one by
  the owner (`docs/iconography.md`). Labels are curated by the RPG module (`apps/web/src/rpg/dnd35/labels.ts`), each
  with an icon and a family colour; old label names of the content read as their curated label, the data is unchanged.
- Repeatable entries (2026-10-21): `repeatable` on an entity, each take applies its effects again and carries its own
  `choice` in the level record (`FeatChoice.choice`), the one exception to « an entity counts once ». Official content
  keeps its one-entry-per-option feats (Skill Focus per skill) and its `count()` formulas (Toughness).
- Books, statistics and situations are catalog entries (types `source`, `statistic`, `situation`); D&D 3.5's own
  statistics stay in the RPG module (`targets.ts`), a ruleset adds its own from the dropdowns.
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

- Tome of Battle: past class level 20 the known / readied / stance counts stay at row 20 (no epic table in the book;
  owner: not decided yet). Readied and expended maneuvers are not tracked (play state). Discipline focus (Swordsage) and the Crusader's delayed
  damage pool are text; Furious Counterstrike is a toggle whose value the player picks (1 to 6). Most maneuver bonuses
  that depend on the fight or help allies are text only. The Warblade uses the book's rules (owner, 2026-10-21):
  Battle Cunning only against flat-footed or flanked foes, Battle Clarity capped by class level; Danalieth's test
  catalog keeps the group's house rules, so her real sheet on the VPS drops once the official Warblade is imported
  (Reflex 81 → 74, damage 138 → 111). Her placeholder stance (+10 attack) is removed: verified attack 145 → 135.
  Martial Study maneuvers use the character's highest initiator level, not the book's « half your level » when the
  character also has an initiator class (the same value or higher).

- Web: the home card shows name and level only (the numbers need each character's catalog). Search filters cover
  spells (school, descriptor, list, level) and effects (« Affecte », only as good as the modelled effects: about 60
  feats have effects). Descriptor data needs a clean-up: « voir description », « feu ou froid ». The level-up feat list still loads every
  feat into the page (`allOfType`); at tens of thousands of entities it should use `/search`. Content editor: no
  preview on a character, no going back to an old version (owner's choice), relations other than a spell's levels and class tables
  are not editable (batch files only; re-importing `lists.json` would overwrite levels edited in the app), the server trusts the client's engine check. The weapon line shows the engine's
  raw `weapon.threat_range` (10) and `weapon.crit_multiplier` (12); the mockup says « 13–20 ×8 »: these values are not
  hand-verified, check the data and the meaning of threat range. Readable prerequisites leave the statistics with no
  French name as written (`@feats.spell_focus.schools`, `@spellcasting.arcane.max_level`): add them to `statLabels`.
  Effects on a catalog page and in the info panel are still the raw formulas. The production bundle is one 843 KB file (231 KB
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
