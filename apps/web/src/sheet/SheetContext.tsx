import { CharacterSheet, SheetEngine } from 'dnd-engine'
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Character, CharacterRecord, Closure, Entity, ToggleChoice } from '../api/types'
import { toInteger } from '../format'
import { characterForEngine, loadPlay, playReducer, savePlay, type PlayAction, type PlayState } from '../play/playState'
import { entityName } from './names'

export interface ToggleView {
  id: string
  active: boolean
  /** The full choice used to switch it on: a build default keeps its spell, metamagic and caster class. */
  choice: ToggleChoice
  /** The entity the toggle belongs to (its spell, or the feat reading it). */
  source: string | null
  /** True when the source declares a value picked at the table, or an effect reads `@toggle.<id>.value`. */
  takesValue: boolean
  /** The highest value allowed, from the source's `tableValue`; null = the base attack bonus (older content). */
  maxValue: number | null
}

export interface DailyUseView {
  entity: string
  max: number
}

interface SheetData {
  record: CharacterRecord
  closure: Closure
  sheet: CharacterSheet
  play: PlayState
  /** Display name of a catalog id, in French when there is one. */
  name: (id: string) => string
  entity: (id: string) => Entity | undefined
  stat: (key: string) => string | null
  toggles: ToggleView[]
  dailyUses: DailyUseView[]
  setToggle: (toggle: ToggleView, on: boolean) => void
  setToggleValue: (id: string, value: string) => void
  dispatch: (action: Exclude<PlayAction, { type: 'toggleOn' | 'toggleOff' | 'toggleValue' }>) => void
  saveCharacter: (next: Character) => Promise<'saved' | 'conflict'>
  /** Loads the character and its catalog again: after a save that brings new entities (a class, a feat, a spell). */
  reload: () => void
}

const Context = createContext<SheetData | null>(null)

export function useSheet(): SheetData {
  const data = useContext(Context)
  if (!data) throw new Error('useSheet outside of a SheetProvider')
  return data
}

export function SheetProvider(props: { record: CharacterRecord; closure: Closure; reload: () => void; children: ReactNode }) {
  const { closure } = props
  const [record, setRecord] = useState(props.record)
  const id = record.id
  const [play, dispatchPlay] = useReducer(playReducer, null, () => loadPlay(id, props.record.character))
  // The engine sheet is a live object updated in place; this counter tells React to read it again.
  const [revision, bump] = useReducer((n: number) => n + 1, 0)

  const engine = useMemo(() => new SheetEngine(JSON.stringify(closure.catalog)), [closure])
  const entities = useMemo(() => new Map(closure.catalog.entities.map((e) => [e.id, e])), [closure])

  // Reopened only when the build changes; toggles are then applied one by one, which recomputes only what they touch.
  const playRef = useRef(play)
  playRef.current = play
  const sheet = useMemo(
    () => engine.open(JSON.stringify(characterForEngine(record.character, playRef.current)), 0),
    [engine, record],
  )

  useEffect(() => savePlay(id, play), [id, play])

  const value = useMemo<SheetData>(() => {
    const name = (entityId: string) => entityName(entities.get(entityId), entityId)
    const engineToggles = sheet.toggles.asJsReadonlyArrayView()
    const defaults = record.character.activeToggles ?? []
    const ids = [
      ...defaults.map((t) => t.toggle),
      ...play.toggles.map((t) => t.toggle),
      ...engineToggles.map((t) => t.id),
    ].filter((t, i, all) => all.indexOf(t) === i)

    const toggles = ids.map((toggleId): ToggleView => {
      const playing = play.toggles.find((t) => t.toggle === toggleId)
      const choice = playing ?? defaults.find((t) => t.toggle === toggleId) ?? { toggle: toggleId }
      const line = engineToggles.find((t) => t.id === toggleId)
      const source = line?.source ?? choice.spell ?? choice.entity ?? null
      const sourceEntity = source ? entities.get(source) : undefined
      const maxValue = toInteger(line?.maxValue ?? null)
      const takesValue = maxValue != null || JSON.stringify(sourceEntity?.effects ?? []).includes(`@${toggleId}.value`)
      return { id: toggleId, active: playing != null, choice, source, takesValue, maxValue }
    })

    const dailyUses = sheet.dailyUses
      .asJsReadonlyArrayView()
      .map((u) => ({ entity: u.entity, max: toInteger(u.uses) ?? 0 }))
      .filter((u) => u.max > 0)

    return {
      record,
      closure,
      sheet,
      play,
      name,
      entity: (entityId) => entities.get(entityId),
      stat: (key) => sheet.statistic(key)?.text ?? null,
      toggles,
      dailyUses,
      setToggle(toggle, on) {
        if (on) {
          // One stance at a time, two with Stance Mastery (Tome of Battle, `stances.active_max`): taking one more leaves
          // the stance taken first.
          const isStance = (t: ToggleView) => entities.get(t.source ?? '')?.type === 'stance'
          if (isStance(toggle)) {
            const max = Number(sheet.statistic('stances.active_max')?.text ?? 1)
            const others = toggles.filter((t) => t.active && t.id !== toggle.id && isStance(t))
            for (const other of others.slice(0, Math.max(0, others.length - max + 1))) {
              sheet.setToggle(other.id, false)
              dispatchPlay({ type: 'toggleOff', toggle: other.id })
            }
          }
          sheet.setToggleChoice(JSON.stringify(toggle.choice))
          dispatchPlay({ type: 'toggleOn', choice: toggle.choice })
        } else {
          sheet.setToggle(toggle.id, false)
          dispatchPlay({ type: 'toggleOff', toggle: toggle.id })
        }
        bump()
      },
      setToggleValue(toggleId, next) {
        sheet.setToggleValue(toggleId, next)
        dispatchPlay({ type: 'toggleValue', toggle: toggleId, value: next })
        bump()
      },
      dispatch: dispatchPlay,
      reload: props.reload,
      async saveCharacter(next) {
        try {
          setRecord(await api.saveCharacter(id, record.updatedAt, next))
          return 'saved'
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            setRecord((error.body as { current: CharacterRecord }).current)
            return 'conflict'
          }
          throw error
        }
      },
    }
    // `revision` is read so the value is rebuilt after the live sheet changed in place.
  }, [record, closure, sheet, play, entities, id, revision, props.reload])

  return <Context.Provider value={value}>{props.children}</Context.Provider>
}
