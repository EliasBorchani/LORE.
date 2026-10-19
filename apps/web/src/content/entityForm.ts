import type { Effect, Entity } from '../api/types'

/** One effect as the form edits it: every field as text, '' = absent. Fields the form does not show stay in `extra`. */
export interface EffectDraft {
  target: string
  op: string
  value: string
  bonusType: string
  condition: string
  situation: string
  layer: string
  multMode: string
  scope: string
  extra: Record<string, unknown>
}

/** The fields every entity has; everything else (item, spell, skill blocks, provenance…) is edited as JSON in `other`. */
export interface EntityDraft {
  id: string
  type: string
  nameFr: string
  nameEn: string
  descriptionFr: string
  descriptionEn: string
  labels: string
  prerequisite: string
  usesPerDay: string
  effects: EffectDraft[]
  other: string
}

const EFFECT_FIELDS = ['target', 'op', 'value', 'bonusType', 'condition', 'situation', 'layer', 'multMode', 'scope'] as const
const FORM_FIELDS = new Set(['id', 'type', 'name', 'description', 'labels', 'prerequisite', 'usesPerDay', 'effects'])
const NUMBER = /^-?\d+(\.\d+)?$/

/** The id prefix of a type, when it is not the type itself. */
const ID_PREFIX: Record<string, string> = { class_power: 'power', prestige_class: 'class' }

/** `feat` + « Volonté de fer » → `feat.volonte_de_fer`. Ids are English by convention: the English name goes first. */
export function idFrom(type: string, name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return words ? `${ID_PREFIX[type] ?? type}.${words}` : ''
}

export function emptyEffect(): EffectDraft {
  return { target: '', op: 'add', value: '', bonusType: '', condition: '', situation: '', layer: '', multMode: '', scope: '', extra: {} }
}

export function toDraft(entity: Entity): EntityDraft {
  const other = Object.fromEntries(Object.entries(entity).filter(([key]) => !FORM_FIELDS.has(key)))
  return {
    id: entity.id,
    type: entity.type,
    nameFr: entity.name?.fr ?? '',
    nameEn: entity.name?.en ?? '',
    descriptionFr: entity.description?.fr ?? '',
    descriptionEn: entity.description?.en ?? '',
    labels: (entity.labels ?? []).join(', '),
    prerequisite: entity.prerequisite ?? '',
    usesPerDay: entity.usesPerDay == null ? '' : String(entity.usesPerDay),
    effects: (entity.effects ?? []).map(effectDraft),
    other: Object.keys(other).length ? JSON.stringify(other, null, 2) : '',
  }
}

function effectDraft(effect: Effect): EffectDraft {
  const fields = effect as unknown as Record<string, unknown>
  const draft = emptyEffect()
  for (const field of EFFECT_FIELDS) draft[field] = fields[field] == null ? '' : String(fields[field])
  draft.extra = Object.fromEntries(Object.entries(fields).filter(([key]) => !(EFFECT_FIELDS as readonly string[]).includes(key)))
  return draft
}

/** The entity the form describes, or why the « JSON » field cannot be read. */
export function fromDraft(draft: EntityDraft): { entity: Entity } | { error: string } {
  let other: Record<string, unknown> = {}
  if (draft.other.trim()) {
    try {
      const parsed: unknown = JSON.parse(draft.other)
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'object' }
      other = parsed as Record<string, unknown>
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }
  const text = (value: string) => value.trim() || undefined
  const localized = (fr: string, en: string) => {
    const result = { ...(text(fr) ? { fr: fr.trim() } : {}), ...(text(en) ? { en: en.trim() } : {}) }
    return Object.keys(result).length ? result : undefined
  }
  const labels = draft.labels.split(',').map((l) => l.trim()).filter(Boolean)
  const entity: Record<string, unknown> = {
    ...other,
    id: draft.id.trim(),
    type: draft.type,
    name: localized(draft.nameFr, draft.nameEn) ?? {},
    description: localized(draft.descriptionFr, draft.descriptionEn),
    labels: labels.length ? labels : undefined,
    prerequisite: text(draft.prerequisite),
    usesPerDay: numberOrText(draft.usesPerDay),
    effects: draft.effects.length ? draft.effects.map(effectFrom) : undefined,
  }
  for (const key of Object.keys(entity)) if (entity[key] === undefined) delete entity[key]
  return { entity: entity as Entity }
}

function effectFrom(draft: EffectDraft): Effect {
  const effect: Record<string, unknown> = { ...draft.extra }
  for (const field of EFFECT_FIELDS) {
    const value = field === 'value' ? numberOrText(draft.value) ?? '' : draft[field].trim()
    if (value !== '') effect[field] = value
  }
  if (effect.value === undefined) effect.value = ''
  return effect as unknown as Effect
}

/** `2` and `1.5` are numbers; anything else is a formula, dice or a word, kept as text. */
function numberOrText(value: string): string | number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return NUMBER.test(trimmed) ? Number(trimmed) : trimmed
}
