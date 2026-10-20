import { describe, expect, it } from 'vitest'
import { prerequisiteParts, type PrerequisiteWords } from './prerequisite'

const words: PrerequisiteWords = {
  stats: { 'ability.str.score': 'Force', bab: 'BBA' },
  ranks: 'rangs',
  and: 'et',
  or: 'ou',
  characterLevel: 'niveau global',
  levelOf: 'niveau de',
}
const names = new Map([
  ['feat.power_attack', 'Attaque en puissance'],
  ['skill.spellcraft', 'Art de la magie'],
  ['class.wizard', 'Magicien'],
])

describe('prerequisiteParts', () => {
  it('names statistics and links entities', () => {
    expect(prerequisiteParts("@ability.str.score >= 13 and has('feat.power_attack')", names, words)).toEqual([
      { text: 'Force ≥ 13 et ' },
      { id: 'feat.power_attack', name: 'Attaque en puissance' },
    ])
  })

  it('reads skill ranks, levels and or', () => {
    expect(prerequisiteParts("@skill.spellcraft.ranks >= 12 or level('class.wizard') >= 5 or level() >= 9", names, words)).toEqual([
      { id: 'skill.spellcraft', name: 'Art de la magie' },
      { text: ' (rangs) ≥ 12 ou niveau de ' },
      { id: 'class.wizard', name: 'Magicien' },
      { text: ' ≥ 5 ou niveau global ≥ 9' },
    ])
  })

  it('keeps what it does not know as written', () => {
    expect(prerequisiteParts("(@feats.spell_focus.schools >= 2) and has('feat.unknown')", names, words)).toEqual([
      { text: "(@feats.spell_focus.schools ≥ 2) et has('feat.unknown')" },
    ])
    expect(prerequisiteParts("has('feat.power_attack')", new Map(), words)).toEqual([{ text: "has('feat.power_attack')" }])
  })
})
