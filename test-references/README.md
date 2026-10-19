# Golden tests

Each folder is one test case, readable by any engine implementation (Kotlin today, maybe Wasm or Rust later).

| File | Contents |
| --- | --- |
| `catalog.json` | Bonus types, entities with their effects, class progressions, house rules, relations |
| `character.json` | Choices only: base abilities, race, ordered level-up records, items, active toggles (with metamagic variants) |
| `expected.json` | The values the engine must produce at `atLevel` |

## Rules for the runner

- Compare every value with `status: "verified"`. Values with `status: "pending"` are reported but do not fail the test.
- A dice statistic gives `dice` (`3d6`, `20d6 electricity`), `flat` and `averageFloor` (floor of the average): compare all three.
- `noValue: true`: the statistic must have no value (a cycle, a failed formula).
- `prerequisites` (optional): exactly these entities fail, with these parts as formula text. Parts that cannot be
  checked (unknown statistic) are ignored.
- `issues` (optional): each must be reported at least once, matched on `code`, and on `statistic` / `source` when given.
- Fields named `status`, `note`, `flag`, `assumptions` in the catalog and character are review metadata, not engine input.

The Kotlin runner is `engine/golden-runner` (`cd engine && ./gradlew :golden-runner:allTests`): it embeds every folder at build time and
runs the same checks on JVM, JS and iOS.

## Cases

| Case | What it proves |
| --- | --- |
| `stacking` | Non-stacking types keep the highest; untyped, dodge and penalties sum; a spell on two toggles counts once |
| `multipliers` | Additive then multiplicative (×6), exclusive group (×12), exclusive winner joins additive (×5), rounding once |
| `layers` | Animal form: two base sets (highest wins), bonuses on top, final set; floor and cap |
| `barbarian` | Worked examples 1, 3, 5: feat with prerequisite, two-handed Power Attack, Rage; the epic rule at level 21 |
| `level-60` | Worked example 2 (1d6 per 3 caster levels → 20d6 electricity), class table to level 60, level from XP |
| `errors` | Failing prerequisite names its parts, cycle reported, typo in a formula skipped; the rest still computes |
| `danalieth` | The stress case below |

Expected values in the small cases were derived by hand (see each `how`).

## danalieth/

Level 59 character from the group, used as the stress case. Every verified value was re-derived by hand from
the sheet's components; see `content/Danalieth_batch_1_v5.xlsx`, tabs "Danalieth abilities" and "Danalieth checks".

Known gaps, listed in `character.json > assumptions`: level order, feat placement and the level of each
high arcana pick are assumed, and skill ranks are not recorded. The caster level breakdown was confirmed by the
owner on 2026-10-15.

Effect values were normalized into the formula language on 2026-10-15 (units on statistics, quoted words,
multi damage types, `situation`, `{choice}` targets); see `CLAUDE.md`.
