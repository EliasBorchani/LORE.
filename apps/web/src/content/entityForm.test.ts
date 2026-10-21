import { describe, expect, it } from 'vitest'
import { idFrom } from './entityForm'

describe('idFrom', () => {
  it('turns a name into an id with the type prefix', () => {
    expect(idFrom('feat', 'Power Attack')).toBe('feat.power_attack')
    expect(idFrom('class_power', 'Cœur de l’Épée !')).toBe('power.coeur_de_l_epee')
    expect(idFrom('prestige_class', 'Archmage')).toBe('class.archmage')
    expect(idFrom('feat', ' ? ')).toBe('')
    expect(idFrom('feat', 'Dragon Blood', 'eberron')).toBe('eberron:feat.dragon_blood')
    expect(idFrom('feat', ' ? ', 'eberron')).toBe('')
  })
})
