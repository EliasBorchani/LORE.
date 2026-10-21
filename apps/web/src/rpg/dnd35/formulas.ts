// The formulas a guided form writes for the person, and reads back. A formula the builders don't recognize stays
// as written, editable in « Avancé »: nothing is lost.

export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type AbilityId = (typeof ABILITY_IDS)[number]

/** One condition of a prerequisite; every row must hold (« et »). */
export type PrerequisiteRow =
  | { kind: 'entity'; id: string }
  | { kind: 'ability'; ability: AbilityId; min: number }
  | { kind: 'bab'; min: number }
  | { kind: 'skill'; skill: string; min: number }
  | { kind: 'classLevel'; classId: string; min: number }
  | { kind: 'level'; min: number }
  | { kind: 'stat'; key: string; min: number }

const ID = String.raw`(?:[a-z][a-z0-9_]*:)?[a-z][a-z0-9_]*\.[a-z0-9_]+`
const TERMS: [RegExp, (m: RegExpExecArray) => PrerequisiteRow][] = [
  [new RegExp(String.raw`^has\('(${ID})'\)$`), (m) => ({ kind: 'entity', id: m[1] })],
  [/^@ability\.(str|dex|con|int|wis|cha)\.score >= (\d+)$/, (m) => ({ kind: 'ability', ability: m[1] as AbilityId, min: Number(m[2]) })],
  [/^@bab >= (\d+)$/, (m) => ({ kind: 'bab', min: Number(m[1]) })],
  [new RegExp(String.raw`^@(${ID})\.ranks >= (\d+)$`), (m) => ({ kind: 'skill', skill: m[1], min: Number(m[2]) })],
  [new RegExp(String.raw`^level\('(${ID})'\) >= (\d+)$`), (m) => ({ kind: 'classLevel', classId: m[1], min: Number(m[2]) })],
  [/^level\(\) >= (\d+)$/, (m) => ({ kind: 'level', min: Number(m[1]) })],
  [/^@([a-z0-9_.:[\]]+) >= (\d+)$/, (m) => ({ kind: 'stat', key: m[1], min: Number(m[2]) })],
]

/** The rows of `a and b and c`, or null when the formula is more than that (« ou », parentheses, « non »…). */
export function parsePrerequisite(formula: string): PrerequisiteRow[] | null {
  const text = formula.trim()
  if (!text) return []
  const rows: PrerequisiteRow[] = []
  for (const term of text.split(/\s+and\s+/)) {
    const row = TERMS.map(([re, make]) => {
      const m = re.exec(term.trim())
      return m && make(m)
    }).find(Boolean)
    if (!row) return null
    rows.push(row)
  }
  return rows
}

/** Rows not filled in yet are left out. */
export function prerequisiteFormula(rows: PrerequisiteRow[]): string {
  return rows
    .map((row) => {
      switch (row.kind) {
        case 'entity': return row.id && `has('${row.id}')`
        case 'ability': return `@ability.${row.ability}.score >= ${row.min}`
        case 'bab': return `@bab >= ${row.min}`
        case 'skill': return row.skill && `@${row.skill}.ranks >= ${row.min}`
        case 'classLevel': return row.classId && `level('${row.classId}') >= ${row.min}`
        case 'level': return `level() >= ${row.min}`
        case 'stat': return row.key && `@${row.key} >= ${row.min}`
      }
    })
    .filter(Boolean)
    .join(' and ')
}

/** « 3 + Charisme + 1 every 4 levels of bard ». */
export interface UsesPerDay {
  base: number
  ability?: AbilityId
  perLevels?: { classId: string; every: number }
}

export function parseUses(value: string | number | undefined): UsesPerDay | null {
  if (value == null || value === '') return { base: 0 }
  if (typeof value === 'number') return Number.isInteger(value) ? { base: value } : null
  const uses: UsesPerDay = { base: 0 }
  for (const term of value.trim().split(/\s+\+\s+/)) {
    let m: RegExpExecArray | null
    if (/^\d+$/.test(term) && uses.base === 0) uses.base = Number(term)
    else if ((m = /^@ability\.(str|dex|con|int|wis|cha)\.mod$/.exec(term)) && !uses.ability) uses.ability = m[1] as AbilityId
    else if ((m = new RegExp(String.raw`^floor\(level\('(${ID})'\) / (\d+)\)$`).exec(term)) && !uses.perLevels) {
      uses.perLevels = { classId: m[1], every: Number(m[2]) }
    } else if ((m = new RegExp(String.raw`^level\('(${ID})'\)$`).exec(term)) && !uses.perLevels) {
      uses.perLevels = { classId: m[1], every: 1 }
    } else return null
  }
  return uses
}

/** A plain number when that is all; `undefined` for « none ». */
export function usesValue(uses: UsesPerDay): string | number | undefined {
  const terms: string[] = []
  if (uses.ability) terms.push(`@ability.${uses.ability}.mod`)
  if (uses.perLevels?.classId) {
    const { classId, every } = uses.perLevels
    terms.push(every <= 1 ? `level('${classId}')` : `floor(level('${classId}') / ${every})`)
  }
  if (terms.length === 0) return uses.base > 0 ? uses.base : undefined
  return [...(uses.base > 0 ? [String(uses.base)] : []), ...terms].join(' + ')
}

/** When an effect counts. */
export type When =
  | { kind: 'always' }
  /** Switched on at the table: `active('toggle.x')`; it may also hold only in a situation. */
  | { kind: 'toggle'; id: string; situation?: string }
  /** Shown apart, never added: « +2 contre le poison ». */
  | { kind: 'situation'; id: string }
  /** A synergy: « avec 5 rangs en Saut », maybe only in a situation (« pour jouer un rôle »). */
  | { kind: 'ranks'; skill: string; min: number; situation?: string }
  | { kind: 'formula'; condition: string; situation?: string }

const ACTIVE = new RegExp(String.raw`^active\('(${ID})'\)$`)
const RANKS = new RegExp(String.raw`^@(${ID})\.ranks >= (\d+)$`)

export function parseWhen(condition?: string, situation?: string): When {
  const c = condition?.trim()
  const s = situation?.trim()
  if (!c && !s) return { kind: 'always' }
  if (!c && s) return { kind: 'situation', id: s }
  const also = s ? { situation: s } : {}
  const active = c ? ACTIVE.exec(c) : null
  if (active) return { kind: 'toggle', id: active[1], ...also }
  const ranks = c ? RANKS.exec(c) : null
  if (ranks) return { kind: 'ranks', skill: ranks[1], min: Number(ranks[2]), ...also }
  return { kind: 'formula', condition: c ?? '', ...(s ? { situation: s } : {}) }
}

export function whenFields(when: When): { condition?: string; situation?: string } {
  switch (when.kind) {
    case 'always': return {}
    case 'toggle': return { ...(when.id ? { condition: `active('${when.id}')` } : {}), ...(when.situation ? { situation: when.situation } : {}) }
    case 'situation': return when.id ? { situation: when.id } : {}
    case 'ranks': return { ...(when.skill ? { condition: `@${when.skill}.ranks >= ${when.min}` } : {}), ...(when.situation ? { situation: when.situation } : {}) }
    case 'formula': return { ...(when.condition.trim() ? { condition: when.condition.trim() } : {}), ...(when.situation ? { situation: when.situation } : {}) }
  }
}

/** The state an entry switches on at the table, named after it: `feat.power_attack` → `toggle.power_attack`. */
export function selfToggle(entityId: string): string {
  const m = /^((?:[a-z][a-z0-9_]*:)?)[a-z][a-z0-9_]*\.(.+)$/.exec(entityId)
  return m ? `${m[1]}toggle.${m[2]}` : ''
}

/** « contre le poison » → `situation.contre_le_poison`, shown back as « contre le poison ». */
export function situationId(words: string): string {
  const slug = words
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `situation.${slug}` : ''
}

/** `situation.vs_evil` → « vs evil »: situations are ids, not catalog entities. */
export function situationName(id: string): string {
  return id.replace(/^(?:[a-z][a-z0-9_]*:)?situation\./, '').replaceAll('_', ' ')
}

/** A number typed as text stays a JSON number; anything else is a formula. */
export function valueOf(text: string): string | number {
  const t = text.trim()
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t
}

/** What « by level » counts: a class's levels, the character's level, or the spell's caster level. */
export type LevelSource = { kind: 'class'; classId: string } | { kind: 'character' } | { kind: 'caster' }

/** An effect's value, as the value builder shows it. `other` is anything else, kept as written. */
export type ValueModel =
  | { kind: 'number'; n: number }
  /** `n` every `every` levels (counted past level `after`, when set), at most `max`. */
  | { kind: 'perLevel'; n: number; every: number; source: LevelSource; max?: number; after?: number }
  | { kind: 'ability'; ability: AbilityId }
  /** The value picked at the table, times `times` (−1 for a malus). */
  | { kind: 'table'; times: number }
  | { kind: 'dice'; count: number; sides: number; damage?: string }
  | { kind: 'other'; text: string }

const SOURCE_TERMS: [RegExp, (m: RegExpExecArray) => LevelSource][] = [
  [new RegExp(String.raw`^level\('(${ID})'\)$`), (m) => ({ kind: 'class', classId: m[1] })],
  [/^level\(\)$/, () => ({ kind: 'character' })],
  [/^@spell\.caster_level$/, () => ({ kind: 'caster' })],
]

function sourceOf(text: string): LevelSource | null {
  for (const [re, make] of SOURCE_TERMS) {
    const m = re.exec(text.trim())
    if (m) return make(m)
  }
  return null
}

function sourceTerm(source: LevelSource): string {
  switch (source.kind) {
    case 'class': return `level('${source.classId}')`
    case 'character': return 'level()'
    case 'caster': return '@spell.caster_level'
  }
}

const INT = String.raw`(-?\d+)`

/** `L`, `floor(L / k)`, with an optional `n * ` in front. */
function perLevelOf(text: string): { n: number; every: number; source: LevelSource } | null {
  let m = new RegExp(String.raw`^${INT} \* (.+)$`).exec(text)
  const n = m ? Number(m[1]) : 1
  const rest = m ? m[2] : text
  m = /^floor\((.+) \/ (\d+)\)$/.exec(rest)
  const source = sourceOf(m ? m[1] : rest)
  return source ? { n, every: m ? Number(m[2]) : 1, source } : null
}

const PAST_LEVELS = new RegExp(String.raw`^max\(0, (?:${INT} \* )?(?:floor\(\((.+) - (\d+)\) / (\d+)\)|\((.+) - (\d+)\))\)$`)

/** `max(0, floor((L - a) / k))`, `max(0, (L - a))`, with an optional `n * ` inside: levels past `a` only. */
function pastLevelsOf(text: string): { n: number; every: number; source: LevelSource; after: number } | null {
  const m = PAST_LEVELS.exec(text)
  const source = m && sourceOf(m[2] ?? m[5])
  if (!m || !source) return null
  return { n: m[1] ? Number(m[1]) : 1, every: m[4] ? Number(m[4]) : 1, source, after: Number(m[3] ?? m[6]) }
}

export function parseValue(value: string | number, toggle: string): ValueModel {
  if (typeof value === 'number') return { kind: 'number', n: value }
  const text = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: 'number', n: Number(text) }
  let m: RegExpExecArray | null
  if ((m = /^@ability\.(str|dex|con|int|wis|cha)\.mod$/.exec(text))) return { kind: 'ability', ability: m[1] as AbilityId }
  if ((m = /^(\d+)d(\d+)(?: ([a-z]+))?$/.exec(text))) return { kind: 'dice', count: Number(m[1]), sides: Number(m[2]), ...(m[3] ? { damage: m[3] } : {}) }
  if (toggle) {
    const t = `@${toggle}.value`
    if (text === t) return { kind: 'table', times: 1 }
    if (text === `-${t}`) return { kind: 'table', times: -1 }
    if ((m = new RegExp(String.raw`^${t.replaceAll('.', '\\.')} \* ${INT}$`).exec(text))) return { kind: 'table', times: Number(m[1]) }
    if ((m = new RegExp(String.raw`^${INT} \* ${t.replaceAll('.', '\\.')}$`).exec(text))) return { kind: 'table', times: Number(m[1]) }
  }
  const capped = new RegExp(String.raw`^min\((.+), (\d+)\)$`).exec(text)
  const body = capped ? capped[1] : text
  const per = pastLevelsOf(body) ?? perLevelOf(body)
  if (per) return { kind: 'perLevel', ...per, ...(capped ? { max: Number(capped[2]) } : {}) }
  return { kind: 'other', text }
}

/** The value to save: a JSON number when it is one. */
export function valueFormula(model: ValueModel, toggle: string): string | number {
  switch (model.kind) {
    case 'number': return model.n
    case 'ability': return `@ability.${model.ability}.mod`
    case 'dice': return `${model.count}d${model.sides}${model.damage ? ` ${model.damage}` : ''}`
    case 'table': {
      const t = `@${toggle}.value`
      return model.times === 1 ? t : model.times === -1 ? `-${t}` : `${t} * ${model.times}`
    }
    case 'perLevel': {
      const term = sourceTerm(model.source)
      const level = model.after != null ? `(${term} - ${model.after})` : term
      const steps = model.every > 1 ? `floor(${level} / ${model.every})` : level
      const scaled = model.n === 1 ? steps : `${model.n} * ${steps}`
      const counted = model.after != null ? `max(0, ${scaled})` : scaled
      return model.max != null ? `min(${counted}, ${model.max})` : counted
    }
    case 'other': return model.text
  }
}
