# Engine (`engine/`)

The rules engine, in pure Kotlin Multiplatform: one code base for Android, iOS (Swift) and the web (JavaScript). It
turns a character's choices and the catalog into a sheet. It has its own Gradle build (run every command from
`engine/`); the mobile apps will include it with `includeBuild`.

- `core/`: the engine. Code in `core/src/commonMain/kotlin/dndtools/engine/` (`math`, `model`, `json`, `formula`,
  `resolve`, `api`). Entry point: `Engine(catalog).session(character)` → `sheet`, `explain(key)`, `update(character)`.
- `golden-runner/`: runs the reference cases of `../test-references/` on every platform (embedded at build time).
- `bench/`: the spike's size and speed benchmark (a small web page and Node scripts on Danalieth).

## Build and test

- `./gradlew allTests`: tests of `core` and `golden-runner` on JVM, JS (Node and browser) and the iOS simulator. iOS
  needs full Xcode selected (`xcode-select`), or `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for one
  run.
- `./gradlew :core:jsBrowserProductionLibraryDistribution`: the JavaScript library (`dnd-engine`, with TypeScript
  types) in `core/build/dist/js/productionLibrary`, used by `apps/web`, `bench` and the content checks.
- Bench: build the library, then in `bench/`: `npm install`, `npm run dev`, `npm run build`, `npm run size`,
  `npm run bench`.

## App API

- `api/SheetEngine.kt`, exported to JS with generated TypeScript types, and to Swift: JSON in, plain objects out,
  numbers as exact text (`25.5`, `3d6 + 138 (~148)`). Lists are `KtList` in TypeScript (`.asJsReadonlyArrayView()`),
  so Swift gets native arrays. A sheet also lists `toggles` (the character's and those its entities' effects read,
  with their `source`), `dailyUses` (evaluated `usesPerDay`), `prerequisites` (failed parts) and breakdown rows with
  `suppressedBy`, `situation`, `modifiers`.
- `api/ContentCheck.kt`: `ContentCheck.entity(entityJson, catalogJson)` lists an entity's problems: strict decoding
  first (code `format`), then `ModelCheck` on it alone (formulas, bonus types, layers, multiplier modes); the core
  sections are enough as catalog. The content editor runs it as you type.

## Engine rules (do not simplify these)

- **Only choices are stored.** The sheet is always recomputed from the character's choices and the catalog.
- **API:** `compute(character, catalog) -> sheet`, `explain(statistic) -> breakdown`. Plain serializable data in and out (kotlinx.serialization only).
- **Numbers:** exact fractions (64-bit numerator/denominator). No floating point. Round down only where a formula says so and once at the end of each statistic.
- **Statistics** have hierarchical keys (`ability.str.score`, `save.ref`, `attack.melee`), may be derived by formula, may have named components (`damage.melee.ability`), may be families with a parameter (`dc.school[abjuration]`, spell slots per level up to 24), and may be scoped to an item (weapon attack, threat range, critical multiplier).
- **Effect** = target + op + value (number, formula or dice) + optional bonus type, condition, situation, layer, multiplier mode.
- **Units:** each statistic has one unit (distances in metres, durations in rounds); values are plain numbers (`180`, `14400`), and a display formatter converts them (14400 rounds → 24 h). Words are quoted text (`'swift'`, `'none'`).
- **Ops:** `add`, `multiply`, `set`, `min`, `max`, `dice`, `grant`.
- **Order of operations per statistic:** base → `set` (base layer) → `add` with stacking → `multiply` → `set` (final layer) → `min`/`max` → round down.
- **Stacking:** bonus types are data with a `stacks` flag. Non-stacking types keep the highest bonus; stacking types (untyped, dodge, template) sum. Penalties sum. Same-source rule: an entity counts once (the same spell cast twice gives its bonus once); the different effects of one entity follow the normal type rules.
- **Two `set` on one layer:** the highest wins. **Floor and cap:** floors (`min`) apply first, then caps (`max`), so a cap always holds.
- **Multiplier modes (explicit on every multiplier):**
  - `exclusive: <group>`: only the highest of the group applies (Empower ×1.5, Intensify ×2, Superspell ×4).
  - `additive`: extra parts add (×2 and ×2 give ×3).
  - `multiplicative`: multiply (Primum incantatum ×3).
  - Resolution: exclusive groups first, then their winners join the additive ones (Superspell ×4 and an additive ×2 give ×5), then each multiplicative.
- **Formula language:** `+ - * /`, `@stat.key`, `level()`, `level('class.x')`, `floor`, `ceil`, `min`, `max`, `has('id')`, `count('id')` (times taken: `4 * count('feat.spell_improvement')`), `isqrt` (whole square root, to invert the XP formula), `active('toggle.id')`, comparisons, `and`/`or`/`not`, `if(test, a, b)`, dice `<count>d<size>` where count may be a formula. Hand-written recursive-descent parser. No loops, no side effects.
- **Dice are described, not rolled:** show `20d6 electricity (~70)`. Dice can be multiplied (`3 × 20d6`, never turned into `60d6`).
- **Damage types are data** (`damageTypes` in the catalog), like bonus types. A multi type lists its parts (`bludgeoning_fire` = bludgeoning + fire) and splits its dice evenly, so averages can be shown per type.
- **Dependency graph:** recompute only what changed; detect cycles and report them, never crash.
- **Conditions:** always-on, toggle (player switch, may carry a chosen value such as Power Attack's `@toggle.power_attack.value`), situational (the effect's `situation` field, an id such as `situation.vs_evil`: shown as a conditional line, never in the total), or formula.
- **Spell variants:** a base spell plus metamagic/modifiers = a computed spell. Metamagic effects target the spell's own stats (`spell.damage`, `spell.duration`, `spell.area.radius`, `spell.slot_cost`...). Improved Metamagic: -1 cost per modifier, minimum +1. A buff toggle may point to a variant (Bull's Strength + Superspell = +16).
- **Spell statistics:** `@spell.caster_level` is the caster level of the class casting the spell (a buff toggle names it in `casterClass`). `spell.range` is a distance in metres; `spell.range_kind` is the kind (`'touch'`, `'personal'`...).
- **Class tables:** rows hold running totals (Warblade level 5: BAB 5); past the last written row the last value holds. Rows list the entities the class grants at that level; `relations` of type `grants` add more (from a class at `level`, default 1; from any other entity while it is active). The epic rule is data (`progressionRules`): it replaces BAB and saves only, class features still come at their class level.
- **Inputs from the choices** are read as statistics: `ability.<a>.base`, `toggle.<id>.value`, `progression.<bab|fort|ref|will>`, `hit_dice.total`, `xp`, `spellcasting.advances[<class>]`.
- **Choices:** `character.choices` maps an entity to the option the player picked; an effect target with `{choice}` uses it (Spell Improvement: `caster_level.class[{choice}]`, one class). One choice per entity for the spike.
- **Skills:** for every entity with a `skill` block the engine defines `skill.<x>` = `@skill.<x>.ranks` + ability
  modifier + `armorCheckPenalty` × `@armor.check_penalty`, and `skill.<x>.max_ranks` (level + 3 for a class skill,
  half rounded down otherwise), unless the catalog defines them. Inputs: `skill.<x>.ranks` (the character's
  `skillRanks` plus any in level records), `skill.<x>.class_skill` (1 when an entity the character has, a class or a
  domain, has a `class_skill` relation to it; `skill.knowledge` covers every field), `skill_points.classes` (class
  `skillPoints` per level, ×4 at character level 1). Built in: `skill_points.total` = max(level, classes + Int
  modifier × (level + 3)) (today's Int modifier, a simplification), `armor.check_penalty` = 0. A skill with ranks is
  had (`has('skill.x')`), so its synergy effects apply. The API lists `skills` (ranks, max, class skill, total) and
  `skillPoints` (total, spent: 1 point per rank in a class skill, 2 otherwise, by today's class skills).
- **Item scope:** effects scoped to `item` apply to the wielded weapon (`weapon.attack`, `weapon.damage`...). One wielded weapon for the spike.
- **Size and dice:** weapon dice are written for a size M wielder. A statistic with `diceSteps` (a formula) moves its
  base dice that many size categories, right after the base-layer `set` and before bonuses (a +2 does not grow), one
  category at a time along the catalog's `diceSteps` section (`up` / `down` maps, the SRD ladders: 1d8 → 2d6 → 3d6…;
  1d2 down is 1). `weapon.damage` uses `@weapon.size_steps` (= `@size.steps`, the `size` word as a number, M = 0;
  `size` defaults to `'medium'`), `unarmed.damage` uses `@size.steps`. A die with no next step stops there and is
  reported. The breakdown shows a `size` line.
- **Spell variants:** effects scoped to `spell` target `variant[<variant id>].<stat>`. A variant is a saved one
  (`character.variants`: id, spell, casterClass, metamagic) or a toggle naming `spell` + `metamagic` (its id is then
  the spell id). It takes spell-scoped effects from its spell, its chosen modifiers, and what the character has that
  changes every spell (Improved Metamagic, Arcane Reach); per-variant modifiers are entities with a spell-scoped
  `spell.slot_cost` effect or the label `spell modifier`. A buff's numeric bonus is multiplied by
  `variant[...].spell.numeric`; `@spell.caster_level` reads `caster_level.<class>` of the casting class. Built in:
  `spell.level` (relation `on_spell_list` with `level`, plus the variant's `heighten`), `spell.slot_level` (level +
  metamagic, each modifier at least +1), `spell.dc` (10 + level + casting ability modifier), `spell.metamagic_count`.
  Heighten Spell is the saved variant's `heighten` (levels added), not a modifier in `metamagic`: the spell really is
  that level, so the slot and the DC follow, and the « at least +1 » rule and Improved Metamagic leave it alone.
- **Spell slots:** a class with `spellcasting` (`ability`, `kind`, default `mode`) gets built-in `caster_level.<class>`
  (unless the catalog defines it) and `slots.<class>[L]` for L = 0…30 = its table's `spellsPerDay` at the casting
  level (class levels + `spellcasting.advances`; past the last row the last one holds) + SRD bonus spells
  (⌊(mod − L) / 4⌋ + 1 when mod ≥ L, at every castable level) + effects. Slots above the table's maximum come only from
  `slots.above_max[<class>]` (Improved Spell Capacity, Will of Death's epic spell, via `{choice}`) as a ladder: one
  slot at each level max+1, max+2… Table cells are inputs `slots.base[class.x:L]`, `spells_known.base[class.x:L]`.
- **Prerequisites** are formulas; on failure, report which part failed. A choice that becomes invalid is kept and flagged, never deleted.
- **Breakdown:** every number lists its sources and the suppressed bonuses.
- **Content checks:** JSON decoding is strict (unknown field = error); review metadata (`status`, `note`, `flag`, `assumptions`) is stripped first. `ModelCheck` reports data problems (unknown references and types, formulas that do not parse) without throwing.

## Character model

- Race and alignment (`alignment.*` id) are character fields; the alignment is not checked against the classes yet.
- Ordered **level-up records**: class taken, feats, ability increase, skill ranks, class choices (which class a prestige level advances), entities gained (templates). The engine replays records 1..N to get the sheet at any level.
- Skills: 3.5 rules (class/cross-class, max ranks, synergies as conditional effects). Owner's rule: ranks are one
  map for the whole character (`skillRanks`: skill → ranks), grown where the player wants, not spent level by level.
- Items: simple list, informative slot, on/off switch.
- Spellcasting modes per class: `prepared`, `spontaneous`, `free_slots` (campaign rule: any spell of the class list at that slot level).
  `character.spellcasting[<class>].known` = spells known or spellbook; daily preparation is not tracked.
- Play state (damage, temporary HP lost, uses and slots spent, toggles, undo log) is kept apart from the build, in the
  web app's browser storage for now (see Web app).

## House rules (encode as data)

- Epic progression: every class level gained at character level > 20 gives +½ BAB and +½ to each save, whatever the class table says. Fractions summed across classes, rounded once.
- Hit points per level: ¾ of the hit die (d12 → 9, d4 → 3).
- XP for level n: n × (n − 1) / 2 × 1000.
- Divine Power: BAB = character level up to 20, then +0.75 per level beyond (49 at level 59).
- Ioun stones: their own `ioun` bonus type (stacks with enhancement).
- Force of Nature: its own `nature` bonus type (stacks with enhancement, not with itself).

## Reference tests (`test-references/`)

`test-references/danalieth/`: catalog, character (level 59) and expected sheet. 20 values are verified by hand
(abilities, BAB 39 / 49, saves 81 / 84 / 44, HP 297 / 2480, attack 145, damage 3d6 + 138 ≈ 148, level,
caster levels Wizard 60 / Sorcerer 29, spell resistance 72). Spellcraft is pending (her skill ranks are not entered yet).
Six small cases cover the rules one by one (stacking, multipliers, layers, worked examples, level 60, errors).
See `test-references/README.md`. All pass on JVM, JS and iOS through `golden-runner`, which embeds the folders at build time.
The source spreadsheet is `content/sources/Danalieth_batch_1_v5.xlsx` (French texts; status column marks what is assumed).
