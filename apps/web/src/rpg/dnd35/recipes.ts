import type { Effect } from '../../api/types'
import { parseWhen, whenFields, type When } from './formulas'
import { ABILITY_SCORES, ATTACKS, CHOICE_TARGETS, DAMAGE, FEAT_SLOTS, SAVES, SCHOOL_DCS, type TargetOption } from './targets'

/**
 * A recipe: a common kind of effect, said in D&D words (« Bonus à des compétences »), so nobody writes target / op /
 * value by hand. Each one is an `add` to targets of one family; one block can hold several targets with the same
 * bonus (Alertness: Detection and Listen), saved as one effect per target.
 */
export interface Recipe {
  id: string
  label: string
  description: string
  /** Fixed choices; `null` for the catalog's skills. */
  options: TargetOption[] | null
  accepts: (target: string) => boolean
  /** What a new block starts with. */
  start: { targets: string[]; value: string | number }
}

const SKILL = /^(?:[a-z][a-z0-9_]*:)?skill\.[a-z0-9_]+$/
const among = (options: TargetOption[]) => (target: string) => options.some((o) => o.key === target)

export const RECIPES: Recipe[] = [
  {
    id: 'skills',
    label: 'Bonus à des compétences',
    description: '+2 en Discrétion et Déplacement silencieux ; une synergie (avec 5 rangs en Saut, +2 en Acrobaties).',
    options: null,
    accepts: (t) => SKILL.test(t) || t === CHOICE_TARGETS.skill.key,
    start: { targets: [], value: 2 },
  },
  {
    id: 'abilities',
    label: 'Bonus de caractéristique',
    description: '+4 en Force pendant une rage, +2 en Dextérité pour une race…',
    options: ABILITY_SCORES,
    accepts: among(ABILITY_SCORES),
    start: { targets: [], value: 2 },
  },
  {
    id: 'saves',
    label: 'Bonus aux jets de sauvegarde',
    description: '+2 en Volonté (Volonté de fer), +1 à tous les jets…',
    options: SAVES,
    accepts: among(SAVES),
    start: { targets: [], value: 2 },
  },
  {
    id: 'ac',
    label: 'Bonus à la classe d’armure',
    description: '+1 d’esquive, une armure naturelle…',
    options: [{ key: 'ac.total', label: 'Classe d’armure' }, { key: 'ac.natural', label: 'Armure naturelle' }],
    accepts: (t) => t === 'ac.total' || t === 'ac.natural',
    start: { targets: ['ac.total'], value: 1 },
  },
  {
    id: 'attack',
    label: 'Bonus à l’attaque',
    description: '+1 aux jets d’attaque au corps à corps, à distance ou tous.',
    options: ATTACKS,
    accepts: among(ATTACKS),
    start: { targets: ['attack.all'], value: 1 },
  },
  {
    id: 'damage',
    label: 'Bonus aux dégâts',
    description: '+2 aux dégâts au corps à corps…',
    options: DAMAGE,
    accepts: among(DAMAGE),
    start: { targets: ['damage.all'], value: 1 },
  },
  {
    id: 'school',
    label: 'DD d’une école de magie',
    description: '+1 au DD des sorts d’une école (Spécialisation d’école).',
    options: SCHOOL_DCS,
    accepts: (t) => among(SCHOOL_DCS)(t) || t === CHOICE_TARGETS.school.key,
    start: { targets: [], value: 1 },
  },
  {
    id: 'feat_slots',
    label: 'Dons supplémentaires',
    description: 'Des dons en bonus : épiques, de guerrier, de magicien…',
    options: FEAT_SLOTS,
    accepts: among(FEAT_SLOTS),
    start: { targets: [], value: 1 },
  },
]

export const recipe = (id: string) => RECIPES.find((r) => r.id === id)

/** A recipe's settings: the same bonus to each target. `bonusType` '' = none written (the engine reads untyped). */
export interface BonusBlock {
  kind: 'bonus'
  recipe: string
  targets: string[]
  value: string | number
  bonusType: string
  when: When
  /** Each effect's other keys (review notes…), kept as they were. */
  extras: Record<string, unknown>[]
}

/** Any other effect, edited as a sentence with pickers (or raw in « Avancé »). */
export interface FreeBlock {
  kind: 'free'
  effect: Effect
}

export type MetamagicRecipe = 'slotCost' | 'numeric' | 'double'

/**
 * A metamagic effect on the spell it is applied to: its slot level goes up (`spell.slot_cost`), its numbers are
 * multiplied (`spell.numeric`), or its duration, range or area. The card changes only the number (and what doubles);
 * the rest of the effect stays as written.
 */
export interface MetamagicBlock {
  kind: 'metamagic'
  recipe: MetamagicRecipe
  effect: Effect
}

export type Block = BonusBlock | FreeBlock | MetamagicBlock

export const DOUBLED = ['spell.duration', 'spell.range', 'spell.area.radius']
const METAMAGIC_KEYS = new Set(['target', 'op', 'value', 'bonusType', 'scope', 'multMode', 'note', 'status'])

export function metamagicRecipe(e: Effect): MetamagicRecipe | undefined {
  if (e.scope !== 'spell' || typeof e.value !== 'number' || Object.keys(e).some((k) => !METAMAGIC_KEYS.has(k))) return undefined
  if (e.target === 'spell.slot_cost' && e.op === 'add' && (e.bonusType ?? 'untyped') === 'untyped') return 'slotCost'
  if (e.target === 'spell.numeric' && e.op === 'multiply') return 'numeric'
  if (DOUBLED.includes(e.target) && e.op === 'multiply' && e.multMode === 'multiplicative') return 'double'
  return undefined
}

export function newMetamagic(recipe: MetamagicRecipe): MetamagicBlock {
  const effect: Effect = {
    slotCost: { target: 'spell.slot_cost', op: 'add', value: 1, bonusType: 'untyped', scope: 'spell' } as Effect,
    numeric: { target: 'spell.numeric', op: 'multiply', value: 1.5, scope: 'spell', multMode: 'exclusive: metamagic_amplify' } as Effect,
    double: { target: 'spell.duration', op: 'multiply', value: 2, scope: 'spell', multMode: 'multiplicative' } as Effect,
  }[recipe]
  return { kind: 'metamagic', recipe, effect }
}

const BONUS_KEYS = new Set(['target', 'op', 'value', 'bonusType', 'condition', 'situation'])
const KEPT_KEYS = new Set(['note', 'status'])

function bonusRecipe(effect: Effect): Recipe | undefined {
  if (effect.op !== 'add') return undefined
  const keys = Object.keys(effect)
  if (keys.some((k) => !BONUS_KEYS.has(k) && !KEPT_KEYS.has(k))) return undefined
  return RECIPES.find((r) => r.accepts(effect.target))
}

function extrasOf(effect: Effect): Record<string, unknown> {
  return Object.fromEntries(Object.entries(effect).filter(([k]) => KEPT_KEYS.has(k)))
}

const sameBonus = (a: Effect, b: Effect) =>
  a.value === b.value && (a.bonusType ?? '') === (b.bonusType ?? '') && (a.condition ?? '') === (b.condition ?? '') && (a.situation ?? '') === (b.situation ?? '')

/** The effects as blocks: a run of effects giving the same bonus with one recipe becomes one block. */
export function blocksOf(effects: Effect[]): Block[] {
  const blocks: Block[] = []
  for (const effect of effects) {
    const metamagic = metamagicRecipe(effect)
    if (metamagic) {
      blocks.push({ kind: 'metamagic', recipe: metamagic, effect })
      continue
    }
    const found = bonusRecipe(effect)
    if (!found) {
      blocks.push({ kind: 'free', effect })
      continue
    }
    const last = blocks.at(-1)
    const first = last?.kind === 'bonus' ? effectsOf([last])[0] : undefined
    if (last?.kind === 'bonus' && last.recipe === found.id && first && sameBonus(first, effect) && !last.targets.includes(effect.target)) {
      last.targets.push(effect.target)
      last.extras.push(extrasOf(effect))
      continue
    }
    blocks.push({
      kind: 'bonus',
      recipe: found.id,
      targets: [effect.target],
      value: effect.value,
      bonusType: effect.bonusType ?? '',
      when: parseWhen(effect.condition, effect.situation),
      extras: [extrasOf(effect)],
    })
  }
  return blocks
}

export function effectsOf(blocks: Block[]): Effect[] {
  return blocks.flatMap((block) => {
    if (block.kind !== 'bonus') return [block.effect]
    const when = whenFields(block.when)
    return block.targets.map((target, i) => {
      const effect: Record<string, unknown> = { ...(block.extras[i] ?? {}), target, op: 'add', value: block.value }
      if (block.bonusType) effect.bonusType = block.bonusType
      if (when.condition) effect.condition = when.condition
      if (when.situation) effect.situation = when.situation
      return effect as unknown as Effect
    })
  })
}

export function newBonus(recipeId: string, when: When = { kind: 'always' }): BonusBlock {
  const r = recipe(recipeId)!
  return { kind: 'bonus', recipe: r.id, targets: [...r.start.targets], value: r.start.value, bonusType: 'untyped', when, extras: [] }
}

/** A skill's synergy: with 5 ranks in it, +2 in another skill. */
export function newSynergy(skillId: string): BonusBlock {
  return newBonus('skills', { kind: 'ranks', skill: skillId, min: 5 })
}

export function newFree(): FreeBlock {
  return { kind: 'free', effect: { target: '', op: 'add', value: 1, bonusType: 'untyped' } }
}
