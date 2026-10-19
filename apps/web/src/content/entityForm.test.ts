import { describe, expect, it } from 'vitest'
import type { Entity } from '../api/types'
import { fromDraft, idFrom, toDraft } from './entityForm'

describe('idFrom', () => {
  it('turns a name into an id with the type prefix', () => {
    expect(idFrom('feat', 'Power Attack')).toBe('feat.power_attack')
    expect(idFrom('class_power', 'Cœur de l’Épée !')).toBe('power.coeur_de_l_epee')
    expect(idFrom('prestige_class', 'Archmage')).toBe('class.archmage')
    expect(idFrom('feat', ' ? ')).toBe('')
  })
})

describe('the entity form', () => {
  const entity = {
    id: 'item.longsword',
    type: 'item',
    name: { fr: 'Épée longue', en: 'Longsword' },
    provenance: 'official',
    labels: ['weapon', 'martial'],
    item: { slot: 'weapon', cost: 15 },
    effects: [
      { target: 'weapon.damage', op: 'set', value: '1d8', layer: 'base', scope: 'item', note: 'checked' },
      { target: 'weapon.threat_range', op: 'set', value: 2, layer: 'base', scope: 'item' },
      { target: 'damage.melee.ability', op: 'multiply', value: 1.5, multMode: 'additive' },
    ],
  } as unknown as Entity

  it('gives back the same entity when nothing is edited', () => {
    expect(fromDraft(toDraft(entity))).toEqual({ entity })
  })

  it('keeps numbers as numbers, drops empty fields and reads the JSON part', () => {
    const draft = toDraft(entity)
    draft.effects[1].value = ' 3 '
    draft.descriptionFr = '  '
    draft.labels = 'weapon, , exotic'
    draft.other = '{"provenance": "team"}'
    const result = fromDraft(draft)
    if (!('entity' in result)) throw new Error(result.error)
    expect(result.entity.effects?.[1].value).toBe(3)
    expect(result.entity.description).toBeUndefined()
    expect(result.entity.labels).toEqual(['weapon', 'exotic'])
    expect(result.entity).toMatchObject({ provenance: 'team' })
    expect(result.entity.item).toBeUndefined()
  })

  it('says when the JSON part is not an object', () => {
    expect('error' in fromDraft({ ...toDraft(entity), other: '[1]' })).toBe(true)
    expect('error' in fromDraft({ ...toDraft(entity), other: '{oops' })).toBe(true)
  })
})
