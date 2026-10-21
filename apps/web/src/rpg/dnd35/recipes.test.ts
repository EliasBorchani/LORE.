import { describe, expect, it } from 'vitest'
import type { Effect, Entity } from '../../api/types'
import { effectText } from './describe'
import { blocksOf, effectsOf, newBonus, newMetamagic, newSynergy } from './recipes'

const batches = import.meta.glob('../../../../../content/srd/**/*.json', { eager: true, import: 'default' }) as Record<string, { entities?: Entity[] }>
const official = Object.values(batches).flatMap((b) => b.entities ?? [])

describe('recipes', () => {
  it('give back every official effect exactly', () => {
    expect(official.length).toBeGreaterThan(1000)
    for (const entity of official) {
      const effects = entity.effects ?? []
      expect(effectsOf(blocksOf(effects)), entity.id).toEqual(effects)
    }
  })

  it('cover most feat and class power effects', () => {
    const effects = official.filter((e) => e.type === 'feat' || e.type === 'class_power').flatMap((e) => e.effects ?? [])
    const inRecipes = blocksOf(effects).filter((b) => b.kind === 'bonus').reduce((n, b) => n + (b.kind === 'bonus' ? b.targets.length : 0), 0)
    expect(inRecipes / effects.length).toBeGreaterThan(0.5)
  })

  it('group the same bonus to several targets', () => {
    const alertness: Effect[] = [
      { target: 'skill.spot', op: 'add', value: 2, bonusType: 'untyped' },
      { target: 'skill.listen', op: 'add', value: 2, bonusType: 'untyped' },
    ]
    const blocks = blocksOf(alertness)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'bonus', recipe: 'skills', targets: ['skill.spot', 'skill.listen'] })
  })

  it('read metamagic as its own cards', () => {
    const empower: Effect[] = [
      { target: 'spell.numeric', op: 'multiply', value: 1.5, scope: 'spell', multMode: 'exclusive: metamagic_amplify' },
      { target: 'spell.slot_cost', op: 'add', value: 2, bonusType: 'untyped', scope: 'spell' },
    ]
    expect(blocksOf(empower).map((b) => (b.kind === 'metamagic' ? b.recipe : b.kind))).toEqual(['numeric', 'slotCost'])
    expect(effectsOf([newMetamagic('double')])).toEqual([{ target: 'spell.duration', op: 'multiply', value: 2, scope: 'spell', multMode: 'multiplicative' }])
  })

  it('take each take’s choice in the skill recipe, and start a synergy', () => {
    expect(blocksOf([{ target: '{choice}', op: 'add', value: 3, bonusType: 'untyped' }])[0]).toMatchObject({ kind: 'bonus', recipe: 'skills' })
    expect(effectsOf([{ ...newSynergy('skill.bluff'), targets: ['skill.diplomacy'] }]))
      .toEqual([{ target: 'skill.diplomacy', op: 'add', value: 2, bonusType: 'untyped', condition: '@skill.bluff.ranks >= 5' }])
  })

  it('start a new block ready to fill', () => {
    expect(effectsOf([{ ...newBonus('skills'), targets: ['skill.hide'] }])).toEqual([{ target: 'skill.hide', op: 'add', value: 2, bonusType: 'untyped' }])
  })
})

describe('sentences', () => {
  const names = new Map([['skill.spot', 'Détection'], ['power.barbarian_rage', 'Rage de berserker'], ['skill.jump', 'Saut']])

  it('say an effect in French', () => {
    expect(effectText({ target: 'skill.spot', op: 'add', value: 2, bonusType: 'competence' }, names)).toBe('+2 à Détection (aptitude)')
    expect(effectText({ target: 'ability.str.score', op: 'add', value: 4, bonusType: 'morale', condition: "active('toggle.barbarian_rage')" }, names))
      .toBe('+4 à Force (moral), quand « Rage de berserker » est actif')
    expect(effectText({ target: 'skill.spot', op: 'add', value: 2, condition: '@skill.jump.ranks >= 5' }, names)).toBe('+2 à Détection, avec 5 rangs en Saut')
    expect(effectText({ target: 'save.will', op: 'add', value: 2, situation: 'situation.vs_poison' }, names)).toBe('+2 à Volonté, seulement vs poison')
    expect(effectText({ target: 'ac.dex_bonus', op: 'max', value: 4, scope: 'item' }, names)).toBe('Dextérité : au plus 4 (l’arme maniée)')
    const withSituation = new Map([...names, ['situation.vs_poison', 'contre le poison']])
    expect(effectText({ target: 'save.will', op: 'add', value: 2, situation: 'situation.vs_poison' }, withSituation)).toBe('+2 à Volonté, contre le poison')
    expect(effectText({ target: '{choice}', op: 'add', value: 3, bonusType: 'untyped' }, names)).toBe('+3 à la compétence choisie')
    expect(effectText({ target: 'spell.slot_cost', op: 'add', value: 2, bonusType: 'untyped', scope: 'spell' }, names))
      .toBe('Le sort prend un emplacement de 2 niveaux plus haut')
  })
})
