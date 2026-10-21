# Content (`content/`)

The official catalog as batch files, imported once into the server, and the scripts that built them.

- `srd/`: the curated batches (catalog format), the source of truth for official content.
- `tools/`: the one-off scraper and the prepare / check scripts used to write the batches.
- `sources/`: Danalieth's spreadsheet (`Danalieth_batch_1_v5.xlsx`, French texts; its status column marks what is
  assumed), the source of her reference case.

Team content is not here: it lives in the database, written with the app's content editor.

## Pipeline and conventions

- Source site: regles-donjons-dragons.com (French). Its pages show no OGL notice, only the site's copyright, so its
  wording is not copied (the pages also block copying with a script): entities carry the rules as effects and a short
  French summary in our own words, with no source URL (owner's choice). For full rules text, the open source is the
  English SRD 3.5 (OGL 1.0a), translated by us, with the license notice.
- Content is imported once and does not change: no machinery for re-running imports beyond `--dry-run`.
- `content/tools/scrape.mjs <section>`: one-off, throttled (2 s, named user agent), cached crawler. Its extracted text
  stays in `content/tools/out/` and `content/tools/cache/` (git-ignored), only for curation.
- Curated batches live in `content/srd/<section>.json` (catalog format; `note` = review metadata). Check a batch with
  the engine (strict decoding, values on a test sheet), then `server import <file> --author srd-import --dry-run`,
  then the same without `--dry-run`. In Docker the server sees `./content` as `/content` (read-only).
- Conventions in batches: ability adjustments are `racial` bonuses; size, land speed (metres), darkvision (metres) and
  low-light vision are `set` effects on `size`, `speed.land`, `vision.darkvision`, `vision.low_light`; conditional
  bonuses carry a `situation` id (`situation.vs_poison`); build budgets are statistics too: `feat_slots.<slot type>`
  (the slot types of level records: `general`, `epic`, `warblade_bonus`…) and `skill_points.total` (Human: `add 1` and
  `add level() + 3`). The skill points base is built in (see Engine rules, Skills). Feat slots (core statistics):
  `feat_slots.general` = 1 + ⌊min(level, 20) / 3⌋, `feat_slots.epic` = one every 3 levels from 21 (as in Danalieth's
  records); SRD epic bonus feats are class effects on `feat_slots.epic_bonus` (one every N class levels past 20,
  `epicBonusFeatEvery` in the class `.py`). A feat record without a `slot` counts as `general`. The API lists
  `featSlots` (available, used). What the model cannot hold yet (languages,
  favored class, weapon familiarity, immunities) goes in the summary and in a `note`.
- Classes (`content/srd/classes/<class>.json`): the class (`hitDie`, description), its 1–20 table rows (base attack and
  saves as running totals, `grants` = features at that class level) and relations `class_skill` → `skill.*`,
  `proficiency` → `proficiency.*`, `alignment` → `alignment.*` (shared entities in `content/srd/rules.json`; skill
  entity ids are the skill statistic keys). Each feature is a `class_power` `power.<class>_<feature>`; scaling uses
  `level('class.<class>')` (`usesPerDay`, effect values); a feature switched on at the table reads
  `active('toggle.<class>_<feature>')`; when the player picks a number for it, the entity declares
  `"tableValue": {"max": <number or formula>}` and its effects read `@toggle.<id>.value` (Power Attack). An entity
  taken more than once declares `"repeatable": {}` (each take adds its effects again) or `{"choose": "skill" | "school" |
  "class"}` (each take picks one; targets read it as `{choice}`, `dc.school[{choice}]`, `caster_level.class[{choice}]`). Tiers that replace each other (rage, greater rage, mighty rage) are
  conditioned on `not has('<next tier>')`, since their bonuses are untyped and would otherwise add up.
- Descriptions: an original LORE-style paragraph, then « En jeu » with one rule per line.
- Spellcasting classes get `spellcasting` on the class, `spellsPerDay` / `spellsKnown` columns in their table rows
  (null = « — »; the site's « 21 » cells are « 2¹ », read as 2), and a `power.<class>_spells` feature that describes casting. Songs or features that help allies too are toggles on the
  caster's own sheet. Specific weapon proficiencies point to `item.*` weapon entities (in the equipment batches).
- Prestige classes: the 15 SRD prestige classes of the site (no Red Wizard) in `content/srd/prestige/<class>.json`,
  same shape as base classes with type `prestige_class`. Entry requirements are text plus a `note` (skill ranks and most
  feats are not in the model yet), except Archmage, which keeps the prerequisite formula, ids, effects and `choice`
  relations (High Arcana) of Danalieth's test catalog. Spellcasting advances are chosen in level records, nothing in
  the rows. Assassin and Blackguard have their own spells (`spellcasting`, table columns, entries in `lists.json`).
  Check with `node content/tools/prestige/check.mjs <file>` (same replace rules as the import, test sheet Fighter 10 +
  the class).
- Books and situations (`content/srd/sources.json`, `content/srd/situations.json`, written by
  `content/tools/catalog/sources.mjs` and `situations.mjs`): `source.*` entries with their English title only, and one
  `situation.*` entry per situation the official content names, with a short French and English name read after a bonus
  (« contre le poison »). The editor picks them from dropdowns and a ruleset adds its own from there. Entries still
  store their old `source` text (`SRD`, `Complete Arcane`…); the web app reads it as the book (`rpg/dnd35/sources.ts`).
  Check with `node content/tools/catalog/check.mjs` (it also fails on a situation id in the content with no entry).
- Skills (`content/srd/rules.json`, written by `content/tools/skills/add_skill_data.py`): each `skill.*` entity has a
  `skill` block (`ability`, `armorCheckPenalty` 1 or 2 for Swim, `trainedOnly`) and its SRD synergies as effects
  (`+2` when `@skill.<from>.ranks >= 5`, a `situation` when the bonus depends on the case). `skill.knowledge` (every
  field) and `skill.speak_language` have no `skill` block. Classes carry `skillPoints` (per level, before Int).
- Feats: the 132 feats of the site (general, metamagic, item creation, monster, 13 epic) in
  `content/srd/feats/srd-NN.json`, plus Spell Focus, Greater Spell Focus and Skill Focus generated per school / per
  skill by `content/tools/feats/gen_focus.py` (`focus.json`, ids `feat.spell_focus_<school>`, `feat.skill_focus_<skill>`).
  Labels: category (`general`, `metamagic`, `item_creation`, `monster`, `epic`), `fighter_bonus`, `wizard_bonus`, topic.
  `prerequisite` formulas hold only what the model checks (abilities, `@bab`, `has('feat.x')`, class levels,
  `level() >= 21` for epic feats); skill ranks, caster level, size are in the text and a `note`. `requires` relations
  feat → feat. Weapon feats are one entity each with `item`-scoped effects (the wielded weapon; the chosen weapon is
  not modelled). Danalieth's feats keep their ids, effects, statuses and notes. Ids were fixed before writing
  (`content/tools/feats/prepare.py`). Check with `node content/tools/feats/check.mjs <files>` (numbers of each feat alone on a
  Fighter 10 / Wizard 10).
- Equipment: the 256 items of the site's equipment pages (weapons, armor and shields, adventuring gear, special
  substances, tools and kits, clothing, food and lodging, mounts and tack, vehicles, services) in
  `content/srd/equipment/srd-NN.json`, type `item`. `content/tools/equipment/prepare.py` builds each item from the
  scraped tables (ids, names, labels, the `item` display block: slot, cost, weight, damage, critical, armor columns…,
  and the effects that hold numbers); the agents wrote only the texts and the few extra effects (kits: circumstance
  bonus on a skill, situational when it depends on the use). Weapons: `weapon.damage` (dice for size M),
  `weapon.threat_range` (how many d20 numbers threaten: 19–20 = 2) and `weapon.crit_multiplier`, all `set` on the base
  layer with `scope: item` (Small wielders get the Small column through the size steps); two-handed melee weapons multiply `damage.melee.ability` by 1.5 (`additive`). Armor:
  `ac.armor` / `ac.shield` `set` on the base layer (two armors do not add up), `ac.dex_bonus` capped with `max`,
  `armor.check_penalty` and `spell_failure.arcane` added (nothing reads these two yet). Masterwork is an item of its
  own (`item.masterwork_weapon`, `item.masterwork_armor`). Speed in armor, ranged damage (Strength), shield bash,
  reach, trip and disarm are text only. Check with `node content/tools/equipment/check.mjs <files>` (the table data must
  match `prepare.py`'s output; numbers of each item alone on a Fighter 10).
- Spells: all 605 SRD spells in `content/srd/spells/srd-NN.json` (entities only: `spell` block in French, LORE
  description, effects for numbers: `spell.damage` / `spell.healing` dice with `scope: spell`, buffs behind
  `active('toggle.<spell>')`, situational bonuses with a `situation`). Every relation starting from a spell (class lists
  and domain lists, `on_spell_list` with `level`) lives in `content/srd/spells/lists.json`: the import replaces all
  relations whose `from` is in the file, so a spell's relations must come from one file only. Cleric domains:
  `content/srd/domains.json` (`domain.<name>`, granted power, `class_skill` relations). Spells already in Danalieth's
  test catalog kept their effects. Check a batch with `node content/tools/spells/check.mjs <file>` (format, strict engine
  decoding, formulas); `content/tools/spells/prepare.py` split the scraped pages into the batches the agents wrote.
- Half casters (Paladin, Ranger): table spell columns start at level 1 (`null` at level 0); their class entity carries an
  effect on `caster_level.<class>` that brings it to half the class level from level 4. Cleric domain slots: one
  `slots.cleric[L]` effect per level, conditioned on `@slots.base[class.cleric:L] >= 0`.
- Shared statistics across classes (each class adds its part): `animal_companion.level`, `familiar.master_level`,
  `turn_undead.level`, `check.wild_empathy` (Charisma counted once). Class bonus feats are slot types
  `feat_slots.<class>_bonus` (`fighter_bonus`, `wizard_bonus`, `monk_bonus`, `rogue_special`). Knowledge fields are
  skills `skill.knowledge_<field>` (`arcana`, `nature`…), as in Danalieth's catalog; `skill.knowledge` means all of them.
  A class power that gives a feat has a `grants` relation to it, in the same file as the power (the import replaces
  every relation starting from the file's entities): Track, Endurance, Scribe Scroll, Improved Unarmed Strike,
  Toughness (Loremaster), Augment Summoning (Thaumaturgist), Deflect Arrows (Duelist). For generated classes, a
  power's `feat=` key in `content/tools/classes/<class>.py`. Choices between feats (combat style, monk) are text only.
- Done: races (7) and the 11 SRD base classes (`content/srd/classes/`; the 9 newest are generated by `python3 content/tools/classes/gen.py . <class>` from the
  scraped tables and the curated texts and effects in `content/tools/classes/<class>.py`). The SRD Wizard and Sorcerer replace the drafts of Danalieth's test catalog (her caster level effects
  live on other entities; her 20 verified values are unchanged with them).
