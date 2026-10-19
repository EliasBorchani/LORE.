// Play state: what changes at the table (toggles, damage, uses spent), apart from the build choices.
// Kept in this browser only for now; the server's PUT /characters/{id}/play is for the later multi-device step.
import { browserStore, type KeyStore } from '../api/client'
import type { Character, ToggleChoice } from '../api/types'
import { fr } from '../i18n/fr'

export interface Snapshot {
  damage: number
  tempHpLost: number
  usesSpent: Record<string, number>
  /** Class id to spell level to slots spent today. */
  slotsSpent: Record<string, Record<number, number>>
}

export interface LogEntry {
  text: string
  before: Snapshot
}

export interface PlayState extends Snapshot {
  toggles: ToggleChoice[]
  log: LogEntry[]
}

export type PlayAction =
  | { type: 'toggleOn'; choice: ToggleChoice }
  | { type: 'toggleOff'; toggle: string }
  | { type: 'toggleValue'; toggle: string; value: string }
  | { type: 'hurt'; amount: number; tempAvailable: number }
  | { type: 'heal'; amount: number }
  | { type: 'setUsed'; entity: string; name: string; used: number; max: number }
  /** Casting spends one slot of [level]; [label] names what was cast, for the log. */
  | { type: 'spendSlot'; classId: string; level: number; total: number; label: string }
  | { type: 'newDay' }
  | { type: 'undo' }

const LOG_LIMIT = 20

/** The first time a character is opened, the build's default toggles are on. */
export function initialPlay(character: Character): PlayState {
  return { toggles: character.activeToggles ?? [], damage: 0, tempHpLost: 0, usesSpent: {}, slotsSpent: {}, log: [] }
}

/** Slots of [level] already spent today for [classId]. */
export function slotsSpentAt(state: PlayState, classId: string, level: number): number {
  return state.slotsSpent[classId]?.[level] ?? 0
}

/** The character the engine computes: the build, with the toggles of the table. */
export function characterForEngine(character: Character, play: PlayState): Character {
  return { ...character, activeToggles: play.toggles }
}

export function playReducer(state: PlayState, action: PlayAction): PlayState {
  const snapshot: Snapshot = {
    damage: state.damage,
    tempHpLost: state.tempHpLost,
    usesSpent: state.usesSpent,
    slotsSpent: state.slotsSpent,
  }
  const logged = (next: Partial<PlayState>, text: string): PlayState => ({
    ...state,
    ...next,
    log: [...state.log, { text, before: snapshot }].slice(-LOG_LIMIT),
  })

  switch (action.type) {
    case 'toggleOn':
      return {
        ...state,
        toggles: [...state.toggles.filter((t) => t.toggle !== action.choice.toggle), action.choice],
      }
    case 'toggleOff':
      return { ...state, toggles: state.toggles.filter((t) => t.toggle !== action.toggle) }
    case 'toggleValue':
      return {
        ...state,
        toggles: state.toggles.map((t) => (t.toggle === action.toggle ? { ...t, value: action.value } : t)),
      }
    case 'hurt': {
      if (action.amount <= 0) return state
      const absorbed = Math.min(action.amount, Math.max(action.tempAvailable, 0))
      return logged(
        { tempHpLost: state.tempHpLost + absorbed, damage: state.damage + action.amount - absorbed },
        fr.log.hurt(action.amount, absorbed),
      )
    }
    case 'heal': {
      const healed = Math.min(action.amount, state.damage)
      if (healed <= 0) return state
      return logged({ damage: state.damage - healed }, fr.log.heal(healed))
    }
    case 'setUsed': {
      const used = Math.min(Math.max(action.used, 0), action.max)
      return logged(
        { usesSpent: { ...state.usesSpent, [action.entity]: used } },
        fr.log.use(action.name, action.max - used),
      )
    }
    case 'spendSlot': {
      const spent = slotsSpentAt(state, action.classId, action.level)
      if (spent >= action.total) return state
      const byLevel = { ...state.slotsSpent[action.classId], [action.level]: spent + 1 }
      return logged({ slotsSpent: { ...state.slotsSpent, [action.classId]: byLevel } }, fr.log.cast(action.label, action.level))
    }
    case 'newDay':
      return logged({ usesSpent: {}, slotsSpent: {} }, fr.log.newDay)
    case 'undo': {
      const last = state.log[state.log.length - 1]
      if (!last) return state
      return { ...state, ...last.before, log: state.log.slice(0, -1) }
    }
  }
}

const key = (characterId: string) => `lore.play.v1.${characterId}`

export function loadPlay(characterId: string, character: Character, store: KeyStore = browserStore): PlayState {
  try {
    const saved = JSON.parse(store.get(key(characterId)) ?? 'null')
    if (saved && Array.isArray(saved.toggles) && Array.isArray(saved.log) && typeof saved.damage === 'number') {
      return { ...initialPlay(character), ...saved }
    }
  } catch {
    // A damaged entry is replaced by a fresh state.
  }
  return initialPlay(character)
}

export function savePlay(characterId: string, state: PlayState, store: KeyStore = browserStore) {
  store.set(key(characterId), JSON.stringify(state))
}
