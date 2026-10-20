# PRD: multi-RPG, groups and rulesets

Status: draft, written with the owner on 2026-10-20 (grill-me session). Extends the main PRD (Claude Doc
`1xMWUKLs3tuxQVTFqbbbH9`); when they disagree, this file wins for groups, rulesets and RPGs, and the rest of the main
PRD still holds.

## 1. Why

Today LORE. serves **one table** playing **D&D 3.5** on one VPS:

- one global catalog: `entity.id` is the primary key, and `provenance` says official or `team`;
- one global role per account (`app_user.role`: `member` or `admin`);
- characters belong to an account, with no group.

The goal is a **public, free service**: any table, several RPGs, each with its own house rules and content. For now
it stays a friends' circle: everything is built so that it could be public, but **sign-up stays closed**.

What does not change:

- The server never runs a rules engine; clients compute sheets (main PRD, section 6).
- Every save is kept (entity and character history).
- Ids never change, with one planned exception: the migration of today's team content (section 10).
- Never `docker compose down -v` on a server; export before any migration.

Out of this PRD: GDPR (account deletion, data export, privacy policy), billing, the mobile apps themselves.

## 2. Words

| Word | Meaning |
| --- | --- |
| Account | A person. Logs in with their email. Can be in many groups. |
| Platform admin | The owner of the service. Maintains official content, sets limits, can invite without a group. |
| RPG | A game system (`dnd35`, `dnd5e`). Has its own official content, core rules and engine. |
| Group | A table. Exactly one RPG, an ordered list of rulesets, members with permissions, characters. |
| Official content | The content of an RPG maintained by the platform admin (SRD and summaries). Read-only for groups. |
| Ruleset | A pack of homebrew for one RPG, owned by an account: new entities and overrides of official ones. |
| Override | A ruleset entity that replaces an official entity for the groups using that ruleset (a house rule). |
| Layer stack | What a group sees: official content of its RPG, then its rulesets in the group's order. |

There is no organization level: account → groups. The « shared world » need is covered by rulesets used by several
groups.

## 3. Stories

1. **A GM starts a table.** Alice creates the group « Les Ombres d'Eberron » (D&D 3.5), creates the ruleset
   « Eberron maison », adds it to the group, and invites three players by email. Each invite creates the account.
2. **A player joins.** Bob opens the invite link, sets a password, lands in the group and creates his character. He
   only sees the official content plus « Eberron maison ».
3. **Two tables, one world.** Alice runs a second table in the same world. She adds « Eberron maison » to the new
   group too: one edit to a custom class shows in both groups.
4. **A house rule.** The table wants Power Attack to work differently. An editor of « Eberron maison » overrides
   `feat.power_attack`. Every sheet in groups that use the ruleset computes with the new version, and the sheet marks
   it « règle maison ».
5. **A player leaves.** Bob leaves the group. His character stays in the group, archived and read-only; Bob still
   owns it and can move it to another D&D 3.5 group.
6. **Today's table.** The current Danalieth table becomes the first group; its team content becomes a ruleset owned
   by the owner (section 10).

## 4. Groups and permissions

A group has exactly one RPG, chosen at creation, never changed.

**Permissions, not fixed roles** (owner's choice). Each member has a set of these:

| Permission | Allows |
| --- | --- |
| See characters | Read other members' characters in the group. |
| Edit characters | Change other members' characters in the group. |
| Edit content | Edit the rulesets **this group owns** (section 5), as an editor. |
| Invite | Invite an email into the group (creates the account if needed). |
| Moderator | Change members' permissions and remove members, except the admin. |
| Admin | Everything above, plus group settings (name, rulesets and their order, deleting the group). A moderator can't change or remove an admin. |

Rules:

- A character belongs to the account that created it. Its owner always reads and edits it.
- The group's creator is its admin. A group always keeps at least one admin; an admin can name another admin.
- Without « See characters », a member only sees their own characters.
- **Leaving or removal:** the member's characters stay in the group, archived and read-only for the others; the
  owner keeps them and can move them to another group of the same RPG.
- **Moving a character** to another group of the same RPG: allowed for its owner if they are a member of both. The
  character may then point to entities the new group can't see; the sheet shows them as missing (as today's model
  checks do).
- **Invites:** a member with « Invite » invites an email into the group; the link creates the account if it doesn't
  exist, or adds the existing account to the group. The platform admin can invite without a group. A per-account cap
  on pending invites (set by the platform admin) limits abuse. Today's invite rules stay: 7 days, one use, token after
  `#`.
- **Creation:** any account creates groups and rulesets, within limits set by the platform admin (e.g. 10 groups,
  10 rulesets, a size cap per ruleset).

## 5. Rulesets

- **Owner:** the account that created it. The owner names **editors** (accounts). A group that « owns » a ruleset is
  one where the ruleset's owner is admin; there, members with « Edit content » are editors too.
- **One RPG:** a ruleset targets one RPG; only groups of that RPG can use it.
- **Visibility:**
  - *Private*: a group can add it only if the ruleset's owner or one of its editors may manage that group's
    rulesets (admin of the group).
  - *Public*: any group can add it. No public listing or search page in M1: the group admin adds it by its slug
    (`eberron`) or by pasting its page link (`/rulesets/eberron`), which leads to the same ruleset.
- **Content:** a ruleset adds new entities and **overrides** official ones. It can't remove official entities (a ban
  list is an open question, section 13).
- **Order and conflicts:** the group admin orders the group's rulesets. If two override the same entity, the last one
  wins; the group page lists each conflict.
- **Updates are live:** a group always uses the latest version of each ruleset. Every save is kept with author, date
  and note, as today. Pinning a version is an open question.
- **On the sheet:** an override shows a « règle maison » badge with the ruleset's name; the info panel shows the
  ruleset's version and links to the official one it replaces.
- **Deleting:** a ruleset used by a group other than the owner's can't be deleted, only archived (it keeps working,
  read-only). Same « archive, never delete » rule as characters.

## 6. Content and ids

**Layer stack.** For a group, the catalog is: official content of its RPG, then its rulesets in order. Every catalog
read the group's members do (closure, search, lists, entity pages, spell lists) goes through that stack.

**Ids.**

- Official ids don't change and are unique **within an RPG** (`feat.power_attack` in `dnd35` and in `dnd5e` are two
  entities).
- Homebrew ids carry their ruleset's slug: `eberron:feat.dragon_blood`. The slug is chosen at creation, unique on
  the platform, lowercase, never changed.
- An override has its own id in its ruleset (`eberron:feat.power_attack`) and names the official id it replaces
  (`overrides: "feat.power_attack"`). Inside the group, every reference to `feat.power_attack` resolves to the
  override. Characters keep the official id in their choices, so removing the ruleset brings the official rule back
  with no character change.
- A ruleset entity can reference official ids and its own ids; references to another ruleset are an open question.

**Separator: `:` (owner's choice, 2026-10-20).** Compared with `[eberron]feat.x` and `eberron/feat.x`:

- `:` has no meaning in the formula language, so the engine's stat key reader (`engine/core/.../formula/Lexer.kt`,
  `readStatKey`) can accept it safely. `[...]` would be cut at the first `]` (`@slots.base[[eberron]class.x:3]`),
  and `/` is division (`@eberron/skill.x.ranks`).
- The engine keys `slots.base[<class>:<level>]` and `spells_known.base[<class>:<level>]` (`resolve/CharacterState.kt`)
  still work: their regex `(.+):(\d+)` is greedy and takes the last `:`, the one before the level.
- `:` is allowed as is in addresses (`?info=eberron:feat.x`, `/entities/{id}`); `[ ]` must be encoded and `/` cuts
  the path.
- Export file names already encode unusual characters (`archive::file_name`).

Work needed in M1, with tests, before any homebrew id is written:

- the server's id finder (`server/src/catalog/refs.rs`, `collect_candidate_ids`) matches `[a-z][a-z0-9_]*\.[a-z0-9_]+`,
  so in `eberron:feat.dragon_blood` it would find `feat.dragon_blood` only: it must take the optional `<slug>:`;
- the engine's lexer: `:` inside stat keys (and in identifiers if needed);
- the web app's id handling (id shape checks in the editor, links).

## 7. RPGs

- An RPG is a unit with an id (`dnd35`, `dnd5e`), a name, its official content (entities, core sections, class
  tables) and **its own engine** (owner's choice: one engine per RPG, not one generic engine).
- **Engine contract**, the same for every RPG: input = the character's choices + the catalog the group sees
  (closure through the layer stack); output = the sheet the app shows (values, breakdowns, toggles, problems). The
  exact shape is fixed in M2 with D&D 5e; M1 only wraps today's engine behind it.
- What an RPG gives the web app: which sheet tabs exist, labels for its statistics (`statLabels`), its editor blocks,
  its search filters. D&D 3.5 keeps today's screens.
- The second RPG is **D&D 5e** (SRD 5.1, CC-BY), in M2.
- Content outside the SRD (Book of Nine Swords, Complete Arcane, Complete Mage) stays official D&D 3.5 content,
  visible to every D&D 3.5 group (owner's choice), as short summaries only. See risks.

## 8. Server and data

Direction, not a schema; the schema is in `server/migrations/0008_groups.sql` (M1). In M1 `entity.id` stays the
primary key (homebrew ids are unique through their slug); the key `(rpg, id)` comes with the second RPG in M2.

- **Per RPG:** `entity` (official ones), `catalog_section`, `progression_row` get an RPG column; their keys include
  it.
- **Rulesets:** a `ruleset` table (slug, RPG, owner, visibility, archived) and `ruleset_editor`. Homebrew entities
  live in `entity` with their ruleset; `provenance: "team"` is replaced by the ruleset link. Overrides store the id
  they replace.
- **Groups:** `group` (name, RPG, archived), `group_member` (account, permissions), `group_ruleset` (order).
- **Characters:** `player_character` gets its group.
- **Accounts:** `app_user.role` becomes « platform admin or not »; everything else moves to group permissions.
  Limits per account (groups, rulesets, pending invites).
- **Access module:** one Rust module answers « can this account read / write this group, character, ruleset,
  entity? ». Every handler goes through it. Anything not visible gives **404** (not 403), so a stranger can't tell it
  exists. Each endpoint gets a test where a stranger gets 404.
- **Catalog reads take a group:** closure, search, lists, entity pages and spell lists read through that group's
  layer stack. The search columns and indexes stay, filtered by RPG and by the group's rulesets.
- **Content editing:** the editor writes into a ruleset; only its owner and editors can. Official content: platform
  admin only (import and editor).
- **Import:** `server import` targets an RPG (official content) or a ruleset.
- **Export / restore:** cover the new tables; bump `archive::FORMAT` and teach `restore` the old format, as the data
  safety rules require.
- **Scale targets:** ~50 accounts, ~10 groups, ~20 rulesets, up to 50,000 entities per RPG in the first year; nothing
  in the design should need a redesign up to 10,000 accounts.

## 9. Web app

- A **group switcher** in the top bar and the group in the address (`/g/<group>/…`). An account with one group goes
  straight in.
- **Group settings:** members and their permissions, invites, rulesets (add, order, conflicts), archive.
- **Ruleset pages** (`/rulesets/<slug>`): its entities, editors, visibility, history.
- **Catalog and editor** scoped to the current group: search and lists show the stack; « Nouvelle entrée » asks which
  ruleset (among those the person edits and the group uses); « Créer une variante » becomes « Règle maison » (an
  override in a ruleset).
- **Sheet:** « règle maison » badge on overrides (info panel, breakdown sources).
- The UI stays French until English, which comes before public sign-up.

## 10. Migration of today's data

1. `server export` on the VPS (the rollback is `restore` of this export into an empty database).
2. Create RPG `dnd35`; all official entities, sections and class tables belong to it.
3. Create the first group (D&D 3.5) with every current account. Current admins → group admins; current members →
   « See characters » and « Edit content ». The owner becomes platform admin.
4. Create one private ruleset owned by the owner; every `provenance: "team"` entity moves into it and gets the
   prefixed id. `_team` variants become overrides of their original (`variant_of` gives the target).
5. Apply the old → new id map to every character's choices (as a new character version authored « migration ») and
   to every reference inside the moved entities. The map is kept in the export.
6. Checks: Danalieth's 20 verified values unchanged (golden runner on the migrated closure); every character loads
   with no new problem; counts match before and after; a second run changes nothing.

This step breaks « ids never change » **once**, for team content only, with a kept map; official ids don't move.

## 11. Milestones

- **M1: structure, on D&D 3.5 only.** Id separator `:` supported everywhere; RPG column; groups, permissions, rulesets,
  overrides, access module with stranger tests; group-scoped catalog; web app group switcher and settings;
  migration of today's data.
- **M2: a second RPG.** Engine contract fixed; D&D 5e engine and SRD 5.1 content; RPG plug-in for the web app.
- **Then:** mobile apps; English UI; public sign-up (with GDPR, abuse limits, public ruleset listing).

## 12. Limits and risks

- **Non-SRD summaries visible to all** once the service is public: a legal risk the owner accepted; to look at again
  before public sign-up.
- **Live updates** can change numbers on characters with no warning (a ruleset edit by someone else).
- **Isolation by application code:** one missed check leaks data; the stranger test per endpoint is the guard.
- **One-time id migration** of team content (section 10).
- **The id separator `:`** needs small changes in the engine, the server and the web app (section 6).
- **Moving characters** between groups can leave references the new group can't see.

## 13. Open questions (later)

- Pinning a ruleset version per group.
- A public listing of rulesets, with search and moderation.
- A ruleset that depends on another ruleset.
- Hiding (banning) official entities in a ruleset.
- The exact engine contract (decided with D&D 5e in M2).
- Play state on the server and sharing characters, inside groups.
