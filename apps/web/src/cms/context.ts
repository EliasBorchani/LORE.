import { createContext, useContext } from 'react'
import type { GroupApi } from '../api/client'
import type { ChoiceKind, Localized, StateUse } from '../api/types'
import type { TargetOption } from '../rpg/dnd35/targets'
import type { EntryType } from './entries'

/** What every field of the editor may need: names to show, lists to pick from, the engine's issues. */
export interface CmsData {
  groupApi: GroupApi
  /** Entity id → its name, for everything the form shows by name. */
  names: ReadonlyMap<string, string>
  /** A picker found a new entity: remember its name. */
  addName: (id: string, name: string) => void
  skills: TargetOption[]
  classes: TargetOption[]
  states: StateUse[]
  bonusTypes: TargetOption[]
  /** The entry being edited, for « quand on l’active » (its own state). */
  selfId: string
  /** Its type: some recipes belong to one type (metamagic for feats, synergy for skills). */
  type: string
  /** Books, statistics and situations of the catalog, for their dropdowns. */
  entries: Record<EntryType, TargetOption[]>
  /** The group's rulesets in order: an entry's dropdown group is named after its ruleset. */
  rulesets: { slug: string; name: string }[]
  /** Where « + Ajouter … » creates an entry: the ruleset of the entry being edited (null: nowhere). */
  createIn: { slug: string; name: string } | null
  /** Publishes a new book, statistic or situation there; gives its id. */
  createEntry: (type: EntryType, name: Localized) => Promise<string>
  /** The entry can be taken more than once: what each take chooses ('' = nothing), or null. */
  repeatable: ChoiceKind | '' | null
  /** The entry declares a value picked at the table: effects may use it. */
  tableValue: boolean
  /** ContentCheck's issues by path (`effects[0].value`), in French. */
  issues: { at: string; text: string }[]
}

export const CmsContext = createContext<CmsData | null>(null)

export function useCms(): CmsData {
  const data = useContext(CmsContext)
  if (!data) throw new Error('useCms outside the editor')
  return data
}

/** Issues whose path starts with `prefix` (`prerequisite`, `effects[2]`). */
export function issuesAt(issues: CmsData['issues'], prefix: string): string[] {
  return issues.filter((i) => i.at === prefix || i.at.startsWith(`${prefix}.`) || i.at.startsWith(`${prefix}[`)).map((i) => i.text)
}
