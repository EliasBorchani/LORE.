# PRD: the LORE. CMS — easy, beautiful, guided content creation

Written 2026-10-20 with the owner. Without a content editor any player enjoys, the project has no future: the goal is
the best RPG CMS. Any player who knows D&D, but has never seen a formula, creates an entry alone.

## Owner's choices (2026-10-20)

- **Who it's for:** any player. Engine fields (target, op, formulas, JSON) live behind « Avancé ».
- **Starting:** illustrated type cards in the group's « Atelier » tab, or « Partir d'une entrée existante » (a copy
  in the person's ruleset). Inside a form, effects come from **recipes**.
- **Forms:** one per type where it matters (feat and class power first; spell, item, class + class table next). Any
  other type gets the generic guided form. Optional fields hide behind « + Ajouter … » chips with a description, and
  « Retirer » hides them again.
- **Languages:** one is enough; the other is an optional « Traduction ».
- **Layout:** one page, folding sections (Essentiel, Règles, Avancé); the live card (exactly the catalog's
  component) sticky on the right, below on phones.
- **Drafts:** private to their author, savable with problems left; « Publier » needs every engine check green.
- **Iconography, no pictures** (owner, 2026-10-21): each type has its mark and colour (`cms/TypeBanner.tsx`); no
  image upload, no Gemini prompt. All marks are drawn in-house, one style: `docs/iconography.md`. **Search:** cards per type instead of label lists.
- **Later:** a free Gemini API key to help write content.

### Review of phase 1 (owner, 2026-10-21)

The Atelier page, its categories and iconography, and the « Essentiel » card are right as they are. The direction
from here: **no raw text to type anywhere — every choice is a dropdown**, as the « Quand… » picker does.

- **No CodeMirror.** No formula box in the form.
- **JSON in one place:** « Avancé » becomes a button opening a modal with the **whole** entry as JSON (not only the
  keys the form doesn't know). An edit there updates the form when the modal closes: effect cards, builders, live
  card. The form and the JSON are two views of one entry; nobody needs the JSON day to day. A value or condition no
  builder can say shows read-only, in French, and stays untouched.
- **Value builder** (a dropdown per value): a number; by level (« +[1] tous les [3] niveaux de [Barde], au plus [5] »,
  or « +[1] par niveau ») ; an ability modifier; the caster level; the value chosen at the table × [n].
- **Value chosen at the table** is set on the entry: in « Quand on l'active », a switch « Le joueur choisit une valeur »
  with its maximum (the BAB, a number…). Effects then offer « la valeur choisie × [n] », negative or not (Attaque en
  puissance: −1× to attack, +2× to damage).
- **Labels:** curated by the RPG module, each with an icon and a colour, shown as chips filtered by type.
- **Sources:** a book is a catalog entry of type `source` with only its English name; the official books ship with
  the RPG, and « Nouveau livre » in the dropdown creates one in the ruleset. An entry stores the book's id, no page.
- **Statistics and situations** are catalog entries too (`statistic`, `situation`), with French and English names.
  The dropdowns group them: D&D 3.5 first (by family), then one group per ruleset of the group, named after it
  (« Maison — statistiques »), ending with « + Ajouter une statistique à Maison ». No more typed keys or words.
- **No « Quel genre de don ? » question:** each effect's « Quand… » already says it. Metamagic is two recipes
  (« Augmente le niveau du sort de [1] » = `spell.slot_cost`, « Multiplie les effets numériques » = `spell.numeric`).
- **« + Peut être pris plusieurs fois »** (optional chip): « à chaque fois, choisir : [une école / une arme / une
  compétence] », with the engine's `{choice}`.
- **Small fixes:** the ruleset as a banner at the top (« Rangé dans : Maison », « Changer » when there is a choice,
  « visible dans les groupes qui utilisent Maison »); the id shown under the name as it is built; « Quand on
  l'active à la table » always listed, with « Donnez d'abord un nom » until the entry has one.

### Order (each phase reviewed before the next)

1. Foundations + feat and class power — **done, reviewed**.
2. **Dropdowns everywhere:** the JSON modal, the value builder, the table value, curated labels, books, statistics
   and situations as entries, metamagic recipes, repeatable feats, the small fixes. A real skill form (key ability,
   trained only, armor check penalty, synergies).
   **Written (2026-10-21), waiting for review:** curated labels with icons, the JSON modal, the value builder, the
   table value (engine field `tableValue.max`, the sheet's stepper stops there), the ruleset banner, the id under the
   name, « Quand on l'active » always listed; books, statistics and situations as entries (official batches
   `content/srd/sources.json` and `situations.json`; `EntrySelect` groups them by ruleset and creates one in place); no
   typed key or word left (target, prerequisite statistic, situation); metamagic recipes (slot cost, numeric
   multiplier, duration / range / area); repeatable entries (`repeatable`, a choice per take in the level-up); the skill
   form (ability, trained only, armor check penalty, synergies, which may also hold only in a situation); an effect
   with no statistic blocks « Publier ».
3. Search cards.
4. Spell and item forms.
5. Class and class table.

## Contract

- **The RPG module** (`apps/web/src/rpg/dnd35/`, the M2 « web app RPG module »): form schemas (`forms.ts`), recipes
  (`recipes.ts`), plain-French sentences (`describe.ts`), targets (`targets.ts`), formula builders (`formulas.ts`). It
  carries its own French text: another RPG brings its own. The engine and field kit (`src/cms/`) know no RPG.
- **A form is data:** sections of fields, each with the entity key it writes, a kind, a label, a description, and
  `optional`. Keys no field claims stay untouched and show as JSON in « Avancé »: nothing is ever dropped.
- **A recipe** is an `add` to targets of one family with one bonus (`value`, `bonusType`, « Quand… »). `blocksOf` reads
  existing effects into recipe blocks (a run of the same bonus to several targets is one block) or free blocks;
  `effectsOf` writes them back. Every official effect comes back exactly (`recipes.test.ts`).
- **« Quand… »:** always; when the entry is switched on at the table (`active('<slug:>toggle.<name>')`, named after
  the entry, as the sheet names states); when another state is on; a synergy (`@skill.x.ranks >= 5`); a situation
  (`situation.x`, shown apart, typed in French words); or a raw formula.
- **Saving** writes `untyped` for an `add` without a bonus type and `base` for a `set` without a step (the engine reads
  them so already; ContentCheck wants them written).
- **New types** (phase 2): `source`, `statistic`, `situation`, in rulesets like any entry (ids `source.x`,
  `<slug>:statistic.x`, `situation.x`; a ruleset statistic's key is its id). D&D 3.5's own statistics stay in the RPG
  module; the dropdowns list them first, then the entries by ruleset, then « + Ajouter … à <ruleset> », which publishes
  the new entry at once. The sheet and breakdowns show a statistic or situation by its entry's name, else by its id's
  words. Old `source` texts (`SRD`) read as their book, the data is unchanged.
- **Repeatable** (phase 2): `repeatable: {}` (each take adds the effects again) or `{choose: skill | school | class}`
  (each take picks one, stored on the level record's feat; targets `{choice}`, `dc.school[{choice}]`,
  `caster_level.class[{choice}]`).
- **Server:** `entity_draft` (opaque payload, author only, archive format 4), `GET /groups/{g}/changes`,
  `GET /groups/{g}/catalog/states` (from the stored column `facet_states`).
