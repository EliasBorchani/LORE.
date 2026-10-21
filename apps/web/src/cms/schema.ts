// A guided form is data: sections of fields, each saying where it writes in the entity JSON, what it is for, and
// whether it hides behind a « + Ajouter » chip until wanted. The engine (FormEngine) and the field kit are the same
// for every type and every RPG; what a D&D 3.5 feat asks for lives in `rpg/dnd35/forms.ts`.

export type FieldKind =
  /** French name, with the English one as an optional translation. */
  | 'name'
  | 'description'
  | 'labels'
  | 'text'
  | 'prerequisite'
  | 'usesPerDay'
  /** The value the player picks at the table when switching the entry on, and its maximum. */
  | 'tableValue'
  /** Taken more than once, and what each take chooses. */
  | 'repeatable'
  | 'effects'
  /** The book it comes from: a `source` entry. */
  | 'source'
  /** One of `options`. */
  | 'choice'
  /** Yes or no; no is not written. */
  | 'flag'

export interface FieldSpec {
  /** Top-level key of the entity it writes (`prerequisite`), or a path (`spell.range`). */
  key: string
  kind: FieldKind
  label: string
  /** What it is for, in plain words: shown under the label and on its « + Ajouter » chip. */
  description: string
  /** Hidden while empty, behind a chip. */
  optional?: boolean
  /** For `choice`: the values offered; the first one, when it is `''`, writes nothing. */
  options?: { value: string | number; label: string }[]
  /** For `name`: English only (a book's title). */
  english?: boolean
}

export interface SectionSpec {
  id: 'essentials' | 'rules'
  title: string
  fields: FieldSpec[]
}

export interface FormSchema {
  type: string
  /** One sentence above the form: what this kind of entry is. */
  intro: string
  sections: SectionSpec[]
}

/** The keys a form writes; any other key of the entity is kept untouched and shown in « Avancé ». */
export function isEmpty(value: unknown): boolean {
  if (value == null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.values(value).every(isEmpty)
  return false
}

export function getAt(entity: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), entity)
}

/** A copy with `path` set; `undefined` removes the key (and an object left empty). */
export function setAt<T extends Record<string, unknown>>(entity: T, path: string, value: unknown): T {
  const [key, ...rest] = path.split('.')
  const next: Record<string, unknown> = { ...entity }
  const inner = rest.length ? setAt((next[key] as Record<string, unknown>) ?? {}, rest.join('.'), value) : value
  if (inner === undefined || (rest.length && Object.keys(inner as object).length === 0)) delete next[key]
  else next[key] = inner
  return next as T
}
