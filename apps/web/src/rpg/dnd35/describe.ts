import type { Effect } from '../../api/types'
import { formatModifier, formatNumber } from '../../format'
import { abilities, bonusTypes, fr } from '../../i18n/fr'
import { parseValue, parseWhen, situationName, type LevelSource, type ValueModel, type When } from './formulas'
import { metamagicRecipe } from './recipes'
import { targetLabel } from './targets'

/** Names the sentences can use: catalog entities by id (skills, classes, feats). */
export type Names = ReadonlyMap<string, string>

export const DAMAGE_TYPES: Record<string, string> = {
  fire: 'feu', cold: 'froid', acid: 'acide', electricity: 'électricité', sonic: 'son', force: 'force',
  bludgeoning: 'contondant', piercing: 'perforant', slashing: 'tranchant',
}

const TABLE_VALUE = /@((?:[a-z][a-z0-9_]*:)?toggle\.[a-z0-9_]+)\.value/

function model(value: string | number): ValueModel {
  return parseValue(value, TABLE_VALUE.exec(String(value))?.[1] ?? '')
}

function levelWords(source: LevelSource, plural: boolean, names: Names): string {
  const levels = plural ? 'niveaux' : 'niveau'
  switch (source.kind) {
    case 'class': return `${levels} de ${names.get(source.classId) ?? source.classId.replace(/^.*\./, '')}`
    case 'character': return `${levels} de personnage`
    case 'caster': return `${levels} de lanceur`
  }
}

/** A value without its sign: « 1 tous les 3 niveaux de Barde, au plus 5 », « la valeur choisie ». */
export function valueWords(value: ValueModel, names: Names = new Map()): string {
  switch (value.kind) {
    case 'number': return formatNumber(String(Math.abs(value.n)))
    case 'perLevel': {
      const per = value.every > 1 ? `tous les ${value.every} ${levelWords(value.source, true, names)}` : `par ${levelWords(value.source, false, names)}`
      const after = value.after != null ? ` au-delà du niveau ${formatNumber(String(value.after))}` : ''
      return `${formatNumber(String(Math.abs(value.n)))} ${per}${after}${value.max != null ? ` (au plus ${formatNumber(String(value.max))})` : ''}`
    }
    case 'ability': return `le modificateur de ${abilities.find((a) => a.id === value.ability)?.name ?? value.ability}`
    case 'table': return Math.abs(value.times) === 1 ? 'la valeur choisie' : `${formatNumber(String(Math.abs(value.times)))} × la valeur choisie`
    case 'dice': return `${value.count}d${value.sides}${value.damage ? ` de ${DAMAGE_TYPES[value.damage] ?? value.damage}` : ''}`
    case 'other': return value.text
  }
}

function negative(value: ValueModel): boolean {
  return (value.kind === 'number' && value.n < 0) || (value.kind === 'perLevel' && value.n < 0) || (value.kind === 'table' && value.times < 0)
}

function signed(value: string | number, names: Names): string {
  const m = model(value)
  if (m.kind === 'number') return formatModifier(String(m.n))
  if (m.kind === 'other') return `+ (${m.text})`
  return `${negative(m) ? '−' : '+'} ${valueWords(m, names)}`
}

function plain(value: string | number, names: Names): string {
  const m = model(value)
  return m.kind === 'number' ? formatNumber(String(m.n)) : `${negative(m) ? '−' : ''}${valueWords(m, names)}`
}

/** « Détection, Perception auditive et Fouille ». */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} et ${words.at(-1)}`
}

/**
 * A state's name: the entity it is named after (`toggle.barbarian_rage` ← Rage de berserker), else its words. The
 * sheet names a state by the entity that defines it, the same way.
 */
export function stateName(id: string, names: Names): string {
  const m = /^((?:[a-z][a-z0-9_]*:)?)toggle\.(.+)$/.exec(id)
  if (!m) return id
  for (const [entity, name] of names) {
    const e = /^((?:[a-z][a-z0-9_]*:)?)[a-z][a-z0-9_]*\.(.+)$/.exec(entity)
    if (e && e[1] === m[1] && e[2] === m[2]) return name
  }
  return m[2].replaceAll('_', ' ')
}

export function whenText(when: When, names: Names): string {
  switch (when.kind) {
    case 'always': return ''
    case 'toggle': return [`quand « ${stateName(when.id, names)} » est actif`, when.situation && situationText(when.situation, names)].filter(Boolean).join(', ')
    case 'situation': return situationText(when.id, names)
    case 'ranks': return [`avec ${when.min} rangs en ${targetLabel(when.skill, names)}`, when.situation && situationText(when.situation, names)].filter(Boolean).join(', ')
    case 'formula': return [`si ${when.condition}`, when.situation && situationText(when.situation, names)].filter(Boolean).join(', ')
  }
}

/** A situation by its entry's name (« contre le poison »), else by its id's words. */
export function situationText(id: string, names: Names): string {
  if (!id) return ''
  return names.get(id) ?? `seulement ${situationName(id)}`
}

/** « Le sort prend un emplacement de 2 niveaux plus haut ». */
export function metamagicText(effect: Effect): string | undefined {
  const t = fr.cms.metamagic.sentence
  const n = formatNumber(String(effect.value))
  switch (metamagicRecipe(effect)) {
    case 'slotCost': return t.slotCost(n)
    case 'numeric': return t.numeric(n)
    case 'double': return t.double(fr.cms.metamagic.doubleTargets[effect.target], n)
    default: return undefined
  }
}

/** « +2 à Détection et Perception auditive (moral), quand « Rage » est actif ». */
export function bonusText(targets: string[], value: string | number, bonusType: string | undefined, when: When, names: Names): string {
  const type = bonusType && bonusType !== 'untyped' ? ` (${bonusTypes[bonusType] ?? bonusType})` : ''
  const to = targets.length ? ` à ${listWords(targets.map((t) => targetLabel(t, names)))}` : ''
  const condition = whenText(when, names)
  return `${signed(value, names)}${to}${type}${condition ? `, ${condition}` : ''}`
}

const SCOPES: Record<string, string> = { item: ' (l’arme maniée)', spell: ' (le sort)' }

/** One effect in plain French; the catalog, the info panel and the editor all show it. */
export function effectText(effect: Effect, names: Names): string {
  const metamagic = metamagicText(effect)
  if (metamagic) return metamagic
  const when = parseWhen(effect.condition, effect.situation)
  const target = targetLabel(effect.target, names)
  const scope = effect.scope ? (SCOPES[effect.scope] ?? '') : ''
  const condition = whenText(when, names)
  const tail = `${scope}${condition ? `, ${condition}` : ''}`
  switch (effect.op) {
    case 'add': return bonusText([effect.target], effect.value, effect.bonusType, when, names).replace(/^([^,]*)/, `$1${scope}`)
    case 'multiply': return `${target} × ${plain(effect.value, names)}${tail}`
    case 'set': return `${target} : ${plain(effect.value, names)}${tail}`
    case 'min': return `${target} : au moins ${plain(effect.value, names)}${tail}`
    case 'max': return `${target} : au plus ${plain(effect.value, names)}${tail}`
    case 'dice': return `${target} : ${plain(effect.value, names)}${tail}`
    case 'grant': return `Donne ${names.get(String(effect.value)) ?? plain(effect.value, names)}${tail}`
    default: return `${target} ${effect.op} ${plain(effect.value, names)}${tail}`
  }
}
