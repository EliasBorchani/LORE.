# LORE. iconography

Every icon of LORE. is drawn in-house, in one style: fine, minimal line drawings that sit next to the Grimoire text
without shouting. No pictures in the app, only these marks (owner's choice, 2026-10-21). The drawings live in
`apps/web/src/rpg/dnd35/icons.ts`; `src/components/Mark.tsx` renders them.

## The rules

- **Grid:** a 24 × 24 viewBox. The drawing stays inside 1.5 → 22.5, centred by eye (its visual weight, not its box).
- **Line:** a fixed 1.5 px stroke at every size, with `vector-effect: non-scaling-stroke` — a 72 px banner mark has
  the same line as a 16 px chip. Round caps, round joins.
- **Outlines:** shapes are lines, never filled. Fill only small parts that would vanish as lines: dots (an eye, a
  nostril, a pommel), laurel leaves.
- **Colour:** always `currentColor`. The colour comes from where the mark sits (a label's family, a type's banner).
- **Simple first:** one idea per icon, read at 16 px. Fewer lines beat details; when the full drawing gets crowded
  at 16 px, give it an `s` drawing (used at 16 px and below).
- **Straight and calm:** static shapes, no motion lines; angles only where the object has them (a blade, a horn).
- **Our own drawings:** an outside SVG can be the starting point (the dragon comes from a free SVG Repo drawing), but
  it is redrawn on our grid and line, never pasted as it is.

## Shared motifs

| Motif | Helper | Used for |
| --- | --- | --- |
| Magic | `LENS(cx, cy, r, w)`: four pointed petals | Magie, Chevalier occulte, magic in general |
| Prestige | base class mark + `STAR4` (a small four-point star) | every prestige class: Archimage = Magicien's staff + star |
| Same thing, same drawing | one constant | Mort-vivant = Nécromancie (skull), Dragon = Disciple draconien without its star |
| Size | `RULER` + `STICK` | Taille P / M / G: the figure reaches the 1st, 2nd or 3rd mark |

Base drawings (`STAFF`, `FIGHTER`, `HELM`, `SUN_STAFF`, `KEY`, `DRAGON`…) are constants, so a class and its bonus
label (Guerrier, Bonus de guerrier) can never drift apart.

## Labels

Labels are curated by the RPG module (`rpg/dnd35/labels.ts`): an id, French and English names, an icon, a colour and
the types that offer it. The colour is the family's:

| Family | Token | Labels |
| --- | --- | --- |
| Combat | `--garnet` | melee and ranged feats, weapon and armor kinds |
| Magic | `--focus` | magic feats, schools, spell effects |
| Gear | `--seal` | item kinds |
| Classes | `--gilt` | base and prestige classes, class traits |
| Other | `--ink-muted` | general, epic, races, sizes, creatures |

The icon carries the colour; the name stays in ink so it reads well. A label that only repeats the entry's type
(`spell` on a spell) is not shown, and the old names of today's content (`évocation`, `DC`…) read as their curated
label, so stored data does not change.

## Adding an icon

1. Draw it on the 24 grid with the helpers in `icons.ts`, reusing a motif when the meaning is shared.
2. Check it at 96, 24 and 16 px, in light and dark.
3. Show it to the owner on the review page (each icon at two sizes with its name) before it enters the app.
4. Add it to `LABEL_ICONS` or `TYPE_ICONS`, and the label to `labels.ts`; `labels.test.ts` fails on a label without
   an icon or an icon without a label.
