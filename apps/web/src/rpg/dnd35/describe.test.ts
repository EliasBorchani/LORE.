import { describe, expect, it } from 'vitest'
import { effectText } from './describe'

const names = new Map([['class.bard', 'Barde'], ['feat.power_attack', 'Attaque en puissance']])

describe('values in sentences', () => {
  it.each([
    [{ target: 'attack.melee', op: 'add', value: '-@toggle.power_attack.value', condition: "active('toggle.power_attack')" },
      '− la valeur choisie à Attaque au corps à corps, quand « Attaque en puissance » est actif'],
    [{ target: 'damage.melee', op: 'add', value: '@toggle.power_attack.value * 2', condition: "active('toggle.power_attack')" },
      '+ 2 × la valeur choisie à Dégâts au corps à corps, quand « Attaque en puissance » est actif'],
    [{ target: 'ac.total', op: 'add', value: "min(floor(level('class.bard') / 3), 5)" }, '+ 1 tous les 3 niveaux de Barde (au plus 5) à Classe d’armure'],
    [{ target: 'ac.total', op: 'add', value: '@ability.cha.mod', bonusType: 'untyped' }, '+ le modificateur de Charisme à Classe d’armure'],
    [{ target: 'spell.damage', op: 'dice', value: '1d6 fire', scope: 'spell' as const }, expect.stringContaining('1d6 de feu')],
  ])('%o', (effect, text) => {
    expect(effectText(effect, names)).toEqual(text)
  })
})
