import { describe, expect, it } from 'vitest'
import type { KeyStore } from '../api/client'
import type { Character } from '../api/types'
import { characterForEngine, initialPlay, loadPlay, playReducer, savePlay, type PlayState } from './playState'

const character: Character = {
  id: 'c1',
  name: 'Danalieth',
  baseAbilities: { str: 18 },
  activeToggles: [{ toggle: 'toggle.bulls_strength', spell: 'spell.bulls_strength', metamagic: ['feat.superspell'] }],
}

const run = (state: PlayState, ...actions: Parameters<typeof playReducer>[1][]) => actions.reduce(playReducer, state)

describe('play state', () => {
  it('starts from the build toggles and replaces them for the engine', () => {
    const play = run(initialPlay(character), { type: 'toggleOff', toggle: 'toggle.bulls_strength' }, {
      type: 'toggleOn',
      choice: { toggle: 'toggle.power_attack', value: '5' },
    })
    expect(initialPlay(character).toggles).toEqual(character.activeToggles)
    expect(characterForEngine(character, play).activeToggles).toEqual([{ toggle: 'toggle.power_attack', value: '5' }])
    expect(characterForEngine(character, play).name).toBe('Danalieth')
  })

  it('changes a toggle value without touching the others', () => {
    const play = run(initialPlay(character), { type: 'toggleOn', choice: { toggle: 'toggle.power_attack', value: '1' } }, {
      type: 'toggleValue',
      toggle: 'toggle.power_attack',
      value: '6',
    })
    expect(play.toggles).toEqual([character.activeToggles![0], { toggle: 'toggle.power_attack', value: '6' }])
  })

  it('takes damage on temporary hit points first, heals, and undoes', () => {
    const hurt = run(initialPlay(character), { type: 'hurt', amount: 120, tempAvailable: 59 })
    expect([hurt.damage, hurt.tempHpLost]).toEqual([61, 59])
    expect(hurt.log.at(-1)?.text).toBe('120 dégâts (59 sur les PV temporaires)')

    const healed = run(hurt, { type: 'heal', amount: 500 })
    expect(healed.damage).toBe(0)
    expect(healed.tempHpLost).toBe(59)

    const undone = run(healed, { type: 'undo' }, { type: 'undo' })
    expect([undone.damage, undone.tempHpLost, undone.log]).toEqual([0, 0, []])
  })

  it('spends daily uses within bounds and gets them back on a new day', () => {
    const used = run(
      initialPlay(character),
      { type: 'setUsed', entity: 'power.sv_warding', name: 'Protection', used: 9, max: 4 },
    )
    expect(used.usesSpent).toEqual({ 'power.sv_warding': 4 })
    expect(run(used, { type: 'newDay' }).usesSpent).toEqual({})
    expect(run(used, { type: 'newDay' }, { type: 'undo' }).usesSpent).toEqual({ 'power.sv_warding': 4 })
  })

  it('spends slots up to the total, undoes, and gets them back on a new day', () => {
    const cast = { type: 'spendSlot' as const, classId: 'class.bard', level: 1, total: 2, label: 'Sommeil' }
    const twice = run(initialPlay(character), cast, cast, cast)
    expect(twice.slotsSpent).toEqual({ 'class.bard': { 1: 2 } })
    expect(twice.log).toHaveLength(2)
    expect(twice.log.at(-1)?.text).toBe('Sommeil (emplacement de niveau 1)')
    expect(run(twice, { type: 'undo' }).slotsSpent).toEqual({ 'class.bard': { 1: 1 } })
    expect(run(twice, { type: 'newDay' }).slotsSpent).toEqual({})
  })

  it('keeps the last 20 actions', () => {
    const actions = Array.from({ length: 25 }, () => ({ type: 'hurt' as const, amount: 1, tempAvailable: 0 }))
    expect(run(initialPlay(character), ...actions).log).toHaveLength(20)
  })

  it('survives a reload and ignores a damaged entry', () => {
    const data: Record<string, string> = {}
    const store: KeyStore = { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)) }
    const hurt = run(initialPlay(character), { type: 'hurt', amount: 10, tempAvailable: 0 })
    savePlay('c1', hurt, store)
    expect(loadPlay('c1', character, store)).toEqual(hurt)

    data['lore.play.v1.c1'] = '{not json'
    expect(loadPlay('c1', character, store)).toEqual(initialPlay(character))
  })
})
