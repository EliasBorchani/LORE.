# Web app (`apps/web/`)

The LORE. web app: character sheets, the catalog and the content editor, in French. It runs the engine in the page.

## Build and test

Build the engine library first (`cd ../../engine && ./gradlew :core:jsBrowserProductionLibraryDistribution`), then
here: `npm install`, `npm run dev` (port 5173), `npm test`, `npm run build`. A fresh database needs an account
(`server user add`) and a character: `LORE_LOGIN=… LORE_PASSWORD=… npm run seed` posts Danalieth.

## How it works

- React 19, React Router 8, Vite 8, TypeScript 6, Vitest. Mobile-first; from 1024 px the sheet uses two columns and
  navigation moves to a top bar. Screens follow the owner's v1 mockups (Claude design canvas `Vo3D8PWBdQ96ig4rPcSXP4`).
- Design system **Grimoire** (Claude design system `1NjhDKFEebfSVM9JpCSjDZ`): `src/theme/tokens.json` is a copy of its
  `tokens.json`; `npm run tokens` generates `tokens.css` (Parchemin light, Veillée dark). Its components live in
  `src/components/grimoire.tsx`; its README rules (number formats, garnet for actions only, 44 px targets) apply.
- French text only in `src/i18n/fr.ts`; number formats in `src/format.ts` (signed modifiers with a true minus, narrow
  space for thousands, dice average apart).
- Dev: Vite proxies `/api/*` to the server on `localhost:8080`, so the browser sees one origin (no CORS). The access
  token stays in memory, the refresh token in `localStorage` (PoC trade-off, httpOnly cookie later); a 401 refreshes
  once and retries.
- Invitations (`src/screens/InviteScreen.tsx`, outside the login guard): `/invite#<token>` shows the invited email,
  asks for the password twice and opens the session; the login is the email. A group invitation for an email that
  has an account asks to log in, then joins.
- Groups (`docs/prd-multi.md`): `/` lists the account's groups and opens the only one or the last used
  (`?all` shows the list). A group's pages live under `/g/<group>/…` (`src/group/GroupContext.tsx`): `useGroup()`
  gives the group, its permissions, `catalog` (the group-scoped API: every catalog read goes through it) and
  `path('/catalog/…')` for links. Settings (`GroupSettingsScreen`): members and permissions, invite, rulesets in
  order (added by slug or pasted page link), new ruleset, leave, archive. Ruleset pages: `/rulesets/<slug>`. Its owner
  moves a character to another group of the same RPG at the bottom of Build (two taps).
- The sheet (`src/sheet/SheetContext.tsx`) loads `/characters/{id}` and `/characters/{id}/catalog`, runs `SheetEngine`
  in the page and applies toggles one by one (`setToggleChoice`, `setToggle`, `setToggleValue`).
- **Play state rule (owner):** the build stores the default toggles (`activeToggles`); at the table, toggles, damage,
  temporary HP lost, uses spent and the undo log are play state, kept in this browser only (`src/play/`,
  `localStorage`). `PUT /characters/{id}/play` is for the later multi-device step.
- Character editor (owner's choices: scores typed by hand, SRD feat slots, add / remove the last level only, rule
  breaks allowed and flagged): « Nouveau personnage » (`src/screens/NewCharacterScreen.tsx`: name, race, alignment,
  six scores; the character starts with no level), « Ajouter un niveau » (`src/screens/sheet/LevelUpScreen.tsx`:
  class or prestige class, +1 ability every 4 levels, a feat per free slot from a searchable list (a class bonus slot
  lists the feats labelled for it), the class of a feat's `{choice}`, the casting classes a prestige level advances;
  live preview from the draft's closure with failed prerequisites), and on the Build screen « Retirer le dernier
  niveau » (two taps), spells known / spellbook per casting class (from the class list), maneuvers and stances per
  initiator class (« Manœuvres », counts and problems from the engine's `initiators`, the picker lists what the class
  may learn now: its disciplines, the highest level, the prerequisite count; a feat such as Martial Study gets its own
  block) and adding or removing items. Taking one stance too many in « Effets » leaves the one taken first
  (`SheetContext`; one at a time, `stances.active_max` from the engine: two with Stance Mastery).
  Lists come from `GET /entities` (all pages, cached in `src/sheet/catalogLists.ts`); the shared `Picker` ignores
  accents and case. A save that brings new entities calls `reload()` (sheet context) to fetch the catalog again.
- Content editor, the guided CMS (`docs/prd-cms.md`): the group's « Atelier » tab (`src/screens/AtelierScreen.tsx`:
  type cards, « Partir d'une entrée existante » = `catalog/new?copy=<id>`, my drafts, recent changes) and
  `src/screens/EntityEditorScreen.tsx` (new, `?type=`; edit; house rule `?from=`; draft `atelier/draft/<id>`). The
  form comes from the type's schema (`src/rpg/dnd35/forms.ts`, rendered by `src/cms/FormEngine.tsx`): optional fields
  behind « + Ajouter » chips, effects as recipe cards or a sentence builder (`src/cms/EffectsField.tsx`, recipes in
  `src/rpg/dnd35/recipes.ts`), values from dropdowns (`src/cms/ValueField.tsx`: a number, per level, an ability
  modifier, the value picked at the table, dice; model in `formulas.ts`), prerequisite and uses-per-day builders
  (`src/cms/RulesFields.tsx`). No formula box and no typed key anywhere: a formula no builder can say shows as
  written and stays untouched. Books, statistics and situations come from `EntrySelect` (`src/cms/EntrySelect.tsx`):
  the module's built-in choices, then the catalog's `source` / `statistic` / `situation` entries by ruleset, then
  « + Ajouter … à <ruleset> », which publishes a new one in the ruleset of the entry being edited. Metamagic recipes
  (feats) and « Synergie » (skills) open in the effect gallery; « Peut être pris plusieurs fois » (`repeatable`) adds
  « la compétence choisie » (`{choice}`) to the targets, and the level-up asks each take's choice. « Avancé » is a dialog with the whole entry as JSON; « Appliquer » replaces the entry, the form follows.
  The id shows under the name as it is built. The live card beside the form is `EntitySummary`.
  The engine's `ContentCheck` runs as you type and its issues show under the field they come from; « Publier » needs
  none left, « Enregistrer le brouillon » doesn't (then the draft autosaves). Labels are the curated list of
  `src/rpg/dnd35/labels.ts` (chips per type, with their icon; `src/cms/Labels.tsx`); icons are `src/rpg/dnd35/icons.ts`,
  drawn by `Mark` (`docs/iconography.md`). The D&D 3.5 module (`src/rpg/dnd35/`) carries its own French text, so
  another RPG brings its own. Effects read as French sentences everywhere (`describe.ts`). A spell keeps its « Niveaux »
  block.
- Info panel (`src/components/EntityPanel.tsx`, owner's choice): tapping an entity's name anywhere (sheet tabs,
  breakdown sources, Build, level-up, prerequisites) opens a panel over the screen, at the bottom on phones and on the
  right from 1024 px. It's a native `<dialog>`, and `?info=<id>` is pushed to the address, so back closes it. It loads
  `GET /entities/{id}` (kept in memory; the editor forgets an entity it saves) and shows `EntitySummary`
  (`src/screens/EntitySummary.tsx`), the same facts, description and effects as the catalog page. A name is an
  `EntityName` button. On a row that is already a toggle or a pick button, an `InfoButton` (ⓘ) goes after the
  checkbox: a button placed before it would become the label's control. Every `Picker` row has one.
- Catalog (`src/screens/CatalogScreens.tsx`): a search field on the catalog home (every type) and on each type's list
  (that type), sent to `/search` once typing pauses (250 ms). It finds names, ids and descriptions; a result found
  only in its description says so. Results and type lists are one column of cards (`src/cms/EntityCard.tsx`, owner's
  choice: never a grid); what a card shows is the RPG module's (`src/rpg/dnd35/cards.ts`, `cardOf`: per type a
  colour and mark, a kicker, a large badge, fact chips, the effects in words, the description's first paragraph),
  from the server's `card` and the page's `references`. The catalog home is the Atelier's type cards with counts
  (`/catalog/counts`). The editor's preview shows the same card above the full one. On a type's list, « Filtres » opens chips per filter the server returns (École,
  Registre, Liste de sorts, Niveau de sort, Affecte), each with its count; a tap toggles it. Text and filters are
  copied to the address (`?q=…&level=8`), so back keeps the results. « Affecte » names: `affectsNames` in `fr.ts`.
  Prerequisites are readable (`src/content/prerequisite.ts`: `has('feat.x')` becomes the name from the server's
  `references`, `@stat` the `statLabels` name, `>=` ≥, `and` « et »); anything unknown stays as written.
- Skills tab (`src/screens/sheet/SkillsTab.tsx`): every skill with its total, ranks / max, class skill. Build screen:
  a « Compétences » block edits a draft of `skillRanks` (+ / −, points left, cross-class ranks cost 2) and saves it in
  one go. Combat tab: an Initiative row and both attacks (melee with Strength, ranged with Dexterity; damage keeps
  Strength for both, owner's choice for now).
- Magic tab (`src/screens/sheet/MagicTab.tsx`): per casting class, slots left / total (tap to spend), saved variants
  with « Lancer » (spends a slot of the variant's slot level), spells known, and « Nouvelle variante » (spell +
  metamagic feats the character has, previewed live with `previewVariant`, saved into `character.variants`). A
  character with Heighten Spell gets an « Augmentation d'intensité » stepper (+0 up to the class's highest slot level
  minus the spell's level, no 9th-level cap): it sets the variant's `heighten`, and the id gets `.h<N>`.
