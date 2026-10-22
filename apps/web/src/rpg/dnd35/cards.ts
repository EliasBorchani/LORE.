import type { CardContent, Effect } from '../../api/types'
import { prerequisiteParts } from '../../content/prerequisite'
import { abilities, fr, statLabels } from '../../i18n/fr'
import { effectText, type Names } from './describe'
import { DISCIPLINES } from './forms'
import { parseUses } from './formulas'
import { TYPE_ICONS, type IconDrawing } from './icons'
import { LABELS, shownLabels, type Label, type LabelColour } from './labels'

/** One short fact on a card: « Portée » « Longue ». */
export interface CardFact {
  label: string
  value: string
}

/** What a result card shows, decided per type; the card itself (`cms/EntityCard.tsx`) knows no RPG. */
export interface CardModel {
  accent: LabelColour
  mark: IconDrawing
  /** The line above the name: school, discipline, labels. */
  kicker?: string
  /** A large badge beside the name: a hit die, a key ability, a level. */
  big?: { value: string; label: string }
  facts: CardFact[]
  /** What it does, in words. */
  effects?: string
  blurb?: string
}

export interface CardItem {
  type: string
  labels?: string[] | null
  card?: CardContent
}

/** The short labels of the facts. */
const t = {
  levels: 'Niveaux', castingTime: 'Incantation', range: 'Portée', duration: 'Durée', save: 'Jet de sauvegarde',
  resistance: 'Résistance à la magie', components: 'Composantes', prerequisite: 'Conditions', repeatable: 'Plusieurs fois',
  perDay: 'Par jour', tableValue: 'Valeur max.', damage: 'Dégâts', critical: 'Critique', damageType: 'Type',
  rangeIncrement: 'Facteur de portée', armorBonus: 'Bonus d’armure', maxDex: 'Dex max.', checkPenalty: 'Malus d’armure',
  spellFailure: 'Échec des sorts', cost: 'Prix', weight: 'Poids', trainedOnly: 'Formation requise', armorCheck: 'Malus d’armure',
  synergies: 'Synergies', hitDie: 'Dé de vie', skillPoints: 'Points de compétence', spellcasting: 'Sorts',
  initiating: 'Manœuvres', action: 'Action', abilities: 'Caractéristiques', speed: 'Vitesse', yes: 'oui',
  kinds: { arcane: 'profanes', divine: 'divins' } as Record<string, string>,
  modes: { prepared: 'préparés', spontaneous: 'spontanés' } as Record<string, string>,
  perLevels: (every: number, className: string) => (every <= 1 ? `niveau de ${className}` : `1 tous les ${every} niveaux de ${className}`),
}

const TYPE_ACCENT: Record<string, LabelColour> = {
  feat: 'gilt', class_power: 'garnet', prestige_class: 'garnet', maneuver: 'garnet', stance: 'garnet', discipline: 'garnet',
  spell: 'focus', domain: 'focus', item: 'seal', class: 'seal',
}

const BUILDERS: Record<string, (card: CardContent, names: Names, labels: string[]) => Partial<CardModel>> = {
  spell: spellCard,
  feat: featCard,
  class_power: powerCard,
  item: itemCard,
  skill: skillCard,
  class: classCard,
  prestige_class: classCard,
  maneuver: maneuverCard,
  stance: maneuverCard,
  race: raceCard,
  domain: domainCard,
}

export function cardOf(item: CardItem, names: Names, blurb?: string): CardModel {
  const card = item.card ?? {}
  const labels = item.labels ?? []
  const base: CardModel = {
    accent: TYPE_ACCENT[item.type] ?? 'muted',
    mark: TYPE_ICONS[item.type] ?? TYPE_ICONS.source,
    facts: [],
    blurb,
  }
  const own = BUILDERS[item.type]?.(card, names, labels) ?? {}
  return { ...base, ...own, facts: (own.facts ?? []).filter((f) => f.value) }
}

function spellCard(card: CardContent, names: Names): Partial<CardModel> {
  const spell = (card.spell ?? {}) as Record<string, unknown>
  const school = text(spell.school)
  const label = LABELS.find((l) => l.types.includes('spell') && l.fr.toLowerCase() === school.toLowerCase())
  const descriptors = Array.isArray(spell.descriptors) ? spell.descriptors.map(String) : []
  return {
    accent: 'focus',
    mark: label?.icon ?? TYPE_ICONS.spell,
    kicker: [school, text(spell.subschool) && `(${text(spell.subschool)})`, descriptors.length ? `[${descriptors.join(', ')}]` : ''].filter(Boolean).join(' '),
    facts: [
      { label: t.levels, value: spellLevels(card, names) },
      { label: t.castingTime, value: short(spell.castingTime) },
      { label: t.range, value: capital(short(spell.range)) },
      { label: t.duration, value: capital(short(spell.duration)) },
      { label: t.save, value: capital(short(spell.savingThrow)) },
      { label: t.resistance, value: capital(short(spell.spellResistance)) },
      { label: t.components, value: text(spell.components) },
    ],
  }
}

/** « Ensorceleur/Magicien 3 · Prêtre 4 »: lists at the same level together, lowest level first. */
function spellLevels(card: CardContent, names: Names): string {
  const byLevel = new Map<number, string[]>()
  for (const { list, level } of card.spellLevels ?? []) {
    if (level == null) continue
    byLevel.set(level, [...(byLevel.get(level) ?? []), names.get(list) ?? list])
  }
  return [...byLevel]
    .sort(([a], [b]) => a - b)
    .map(([level, lists]) => `${lists.sort((a, b) => a.localeCompare(b, 'fr')).join('/')} ${level}`)
    .join(' · ')
}

function featCard(card: CardContent, names: Names, labels: string[]): Partial<CardModel> {
  const curated = shownLabels('feat', labels).filter((l): l is Label => typeof l !== 'string')
  return {
    ...(curated[0] && { accent: curated[0].colour === 'muted' ? 'gilt' : curated[0].colour, mark: curated[0].icon }),
    kicker: curated.slice(0, 3).map((l) => l.fr).join(' · '),
    facts: [
      { label: t.prerequisite, value: prerequisiteText(card.prerequisite, names) },
      { label: t.repeatable, value: card.repeatable ? t.yes : '' },
      { label: t.perDay, value: usesText(card.usesPerDay, names) },
    ],
    effects: effectsText(card.effects, names),
  }
}

function powerCard(card: CardContent, names: Names): Partial<CardModel> {
  const table = card.tableValue as { max?: string | number } | undefined
  return {
    facts: [
      { label: t.perDay, value: usesText(card.usesPerDay, names) },
      { label: t.tableValue, value: table?.max != null ? valueText(table.max) : '' },
    ],
    effects: effectsText(card.effects, names),
  }
}

function itemCard(card: CardContent, _names: Names, labels: string[]): Partial<CardModel> {
  const item = (card.item ?? {}) as Record<string, unknown>
  const curated = shownLabels('item', labels).filter((l): l is Label => typeof l !== 'string')
  const damage = text(item.damage)
  return {
    ...(curated[0] && { mark: curated[0].icon }),
    kicker: curated.slice(0, 3).map((l) => l.fr).join(' · '),
    facts: [
      { label: t.damage, value: damage && (item.damageSmall ? `${damage} (${text(item.damageSmall)} P)` : damage) },
      { label: t.critical, value: text(item.critical) },
      { label: t.damageType, value: text(item.damageType) },
      { label: t.rangeIncrement, value: text(item.range) },
      { label: t.armorBonus, value: text(item.armorBonus) },
      { label: t.maxDex, value: text(item.maxDex) },
      { label: t.checkPenalty, value: text(item.checkPenalty) },
      { label: t.spellFailure, value: text(item.spellFailure) },
      { label: t.cost, value: text(item.cost) },
      { label: t.weight, value: text(item.weight) },
    ],
  }
}

function skillCard(card: CardContent): Partial<CardModel> {
  const skill = (card.skill ?? {}) as { ability?: string; trainedOnly?: boolean; armorCheckPenalty?: number }
  const ability = abilities.find((a) => a.id === skill.ability)
  const synergies = (card.effects ?? []).filter((e) => e.target.startsWith('skill.')).length
  return {
    big: ability && { value: ability.short.toUpperCase(), label: ability.name },
    facts: [
      { label: t.trainedOnly, value: skill.trainedOnly ? t.yes : '' },
      { label: t.armorCheck, value: skill.armorCheckPenalty ? (skill.armorCheckPenalty > 1 ? `×${skill.armorCheckPenalty}` : t.yes) : '' },
      { label: t.synergies, value: synergies ? String(synergies) : '' },
    ],
  }
}

function classCard(card: CardContent, names: Names): Partial<CardModel> {
  const casting = card.spellcasting as { ability?: string; kind?: string; mode?: string } | undefined
  const initiating = card.initiating as { ability?: string } | undefined
  const abilityShort = (id?: string) => abilities.find((a) => a.id === id)?.short ?? ''
  return {
    big: card.hitDie != null ? { value: `d${String(card.hitDie)}`, label: t.hitDie } : undefined,
    facts: [
      { label: t.skillPoints, value: card.skillPoints != null ? `${String(card.skillPoints)} + Int` : '' },
      {
        label: t.spellcasting,
        value: casting ? [t.kinds[casting.kind ?? ''], t.modes[casting.mode ?? ''], casting.ability && `(${abilityShort(casting.ability)})`].filter(Boolean).join(' ') : '',
      },
      { label: t.initiating, value: initiating?.ability ? abilityShort(initiating.ability) : '' },
      { label: t.prerequisite, value: prerequisiteText(card.prerequisite, names) },
    ],
  }
}

function maneuverCard(card: CardContent, names: Names): Partial<CardModel> {
  const maneuver = (card.maneuver ?? {}) as Record<string, unknown>
  const id = text(maneuver.discipline)
  const discipline = names.get(id) ?? DISCIPLINES.find(([d]) => `discipline.${d}` === id)?.[1] ?? id
  const kind = fr.catalog.maneuverKinds[text(maneuver.kind)] ?? text(maneuver.kind)
  return {
    kicker: [discipline, kind].filter(Boolean).join(' · '),
    big: maneuver.level != null ? { value: String(maneuver.level), label: fr.catalog.maneuverLevel } : undefined,
    facts: [
      { label: t.action, value: capital(short(maneuver.initiationAction)) },
      { label: t.range, value: capital(short(maneuver.range)) },
      { label: t.duration, value: capital(short(maneuver.duration)) },
      { label: t.save, value: capital(short(maneuver.savingThrow)) },
    ],
  }
}

function raceCard(card: CardContent, names: Names): Partial<CardModel> {
  const effects = card.effects ?? []
  const scores = abilities.flatMap((a) => {
    const total = effects
      .filter((e) => e.target === `ability.${a.id}.score` && e.op === 'add' && typeof e.value === 'number' && !e.condition && !e.situation)
      .reduce((sum, e) => sum + (e.value as number), 0)
    return total ? [`${a.short} ${signed(total)}`] : []
  })
  const speed = effects.find((e) => e.target === 'speed.land' && e.op === 'set')
  return {
    facts: [
      { label: t.abilities, value: scores.join(', ') },
      { label: t.speed, value: speed ? `${String(speed.value)} m` : '' },
    ],
    effects: effectsText(effects.filter((e) => !e.target.startsWith('ability.') && e.target !== 'speed.land'), names),
  }
}

function domainCard(card: CardContent, names: Names): Partial<CardModel> {
  return {
    facts: [{ label: t.perDay, value: usesText(card.usesPerDay, names) }],
    effects: effectsText(card.effects, names),
  }
}

const BLURB_CHARS = 180

/** The description's first paragraph, cut as the server cuts it (`server/src/catalog/cards.rs`), for the editor's preview. */
export function blurbOf(description: string | undefined): string | undefined {
  const paragraph = description?.split('\n\n').map((p) => p.trim()).find(Boolean)
  if (!paragraph) return undefined
  const text = paragraph.split(/\s+/).join(' ')
  if ([...text].length <= BLURB_CHARS) return text
  const cut = [...text].slice(0, BLURB_CHARS).join('')
  const head = cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut
  return `${head.replace(/[,;:. ]+$/, '')}…`
}

function prerequisiteText(formula: unknown, names: Names): string {
  if (typeof formula !== 'string' || !formula) return ''
  const parts = prerequisiteParts(formula, new Map(names), { ...fr.panel, stats: statLabels })
  return parts.map((p) => ('id' in p ? p.name : p.text)).join('')
}

/** « 3 + Cha + 1 tous les 4 niveaux de Barde »; a formula no builder reads stays as written. */
function usesText(value: string | number | undefined, names: Names): string {
  if (value == null || value === '') return ''
  const uses = parseUses(value)
  if (!uses) return String(value)
  const terms = [
    uses.base ? String(uses.base) : '',
    uses.ability ? abilities.find((a) => a.id === uses.ability)!.short : '',
    uses.perLevels ? t.perLevels(uses.perLevels.every, names.get(uses.perLevels.classId) ?? uses.perLevels.classId) : '',
  ]
  return terms.filter(Boolean).join(' + ')
}

/** The effects on the character, in sentences; those of the spell or item itself are its facts already. */
function effectsText(effects: Effect[] | undefined, names: Names): string | undefined {
  const own = (effects ?? []).filter((e) => !e.scope)
  if (own.length === 0) return undefined
  return own.map((e) => effectText(e, names)).join(' ; ')
}

function valueText(value: string | number): string {
  return String(value).replace(/@bab\b/, 'BBA')
}

function text(value: unknown): string {
  if (value == null) return ''
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/** The value without its explanation: « longue (120 m + 12 m/niveau) » → « longue ». */
function short(value: unknown): string {
  return text(value).split(/\s+\(|\s*;\s*/)[0].trim()
}

function capital(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `−${-n}`
}
