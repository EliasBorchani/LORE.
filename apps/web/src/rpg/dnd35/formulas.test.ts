import { describe, expect, it } from 'vitest'
import { parsePrerequisite, parseUses, parseValue, parseWhen, prerequisiteFormula, selfToggle, situationId, usesValue, valueFormula, whenFields } from './formulas'

describe('prerequisites', () => {
  it('reads rows joined by « and » and writes them back the same', () => {
    const formula = "@ability.dex.score >= 13 and has('feat.dodge') and @bab >= 4 and @skill.tumble.ranks >= 5 and level('class.monk') >= 1 and level() >= 6"
    const rows = parsePrerequisite(formula)
    expect(rows).toEqual([
      { kind: 'ability', ability: 'dex', min: 13 },
      { kind: 'entity', id: 'feat.dodge' },
      { kind: 'bab', min: 4 },
      { kind: 'skill', skill: 'skill.tumble', min: 5 },
      { kind: 'classLevel', classId: 'class.monk', min: 1 },
      { kind: 'level', min: 6 },
    ])
    expect(prerequisiteFormula(rows!)).toBe(formula)
  })

  it('keeps homebrew ids and other statistics', () => {
    expect(parsePrerequisite("has('maison:feat.x') and @turn_undead.level >= 1")).toEqual([
      { kind: 'entity', id: 'maison:feat.x' },
      { kind: 'stat', key: 'turn_undead.level', min: 1 },
    ])
  })

  it('gives up on « or » and parentheses, so the formula stays as written', () => {
    expect(parsePrerequisite("(@ability.dex.score >= 13 and @bab >= 8) or level('class.monk') >= 1")).toBeNull()
    expect(parsePrerequisite("has('feat.x') or has('feat.y')")).toBeNull()
  })

  it('leaves out rows not filled in', () => {
    expect(prerequisiteFormula([{ kind: 'entity', id: '' }, { kind: 'bab', min: 1 }])).toBe('@bab >= 1')
  })
})

describe('uses per day', () => {
  it('reads the common shapes', () => {
    expect(parseUses(3)).toEqual({ base: 3 })
    expect(parseUses('3 + @ability.cha.mod')).toEqual({ base: 3, ability: 'cha' })
    expect(parseUses("1 + floor(level('class.barbarian') / 4)")).toEqual({ base: 1, perLevels: { classId: 'class.barbarian', every: 4 } })
    expect(parseUses("level('class.monk')")).toEqual({ base: 0, perLevels: { classId: 'class.monk', every: 1 } })
    expect(parseUses("if(level('class.x') >= 5, 2, 1)")).toBeNull()
  })

  it('writes them back the same', () => {
    for (const value of [3, '3 + @ability.cha.mod', "1 + floor(level('class.barbarian') / 4)", "level('class.monk')"]) {
      expect(usesValue(parseUses(value)!)).toEqual(value)
    }
    expect(usesValue({ base: 0 })).toBeUndefined()
  })
})

describe('when an effect counts', () => {
  it('reads toggles, situations, synergies and formulas, and writes them back', () => {
    const cases = [
      {},
      { condition: "active('toggle.barbarian_rage')" },
      { situation: 'situation.vs_poison' },
      { condition: '@skill.jump.ranks >= 5' },
      { condition: "active('toggle.x') and not has('power.y')" },
      { condition: '@skill.craft.ranks >= 5', situation: 'situation.items' },
    ]
    for (const fields of cases) expect(whenFields(parseWhen(fields.condition, fields.situation))).toEqual(fields)
    expect(parseWhen("active('maison:toggle.fury')")).toEqual({ kind: 'toggle', id: 'maison:toggle.fury' })
  })

  it('names states after their entry, and situations after their words', () => {
    expect(selfToggle('feat.power_attack')).toBe('toggle.power_attack')
    expect(selfToggle('maison:feat.fury')).toBe('maison:toggle.fury')
    expect(situationId('contre le poison')).toBe('situation.contre_le_poison')
  })
})

describe('values', () => {
  const t = 'toggle.power_attack'
  it.each([
    [2, { kind: 'number', n: 2 }],
    ["floor(level('class.bard') / 3)", { kind: 'perLevel', n: 1, every: 3, source: { kind: 'class', classId: 'class.bard' } }],
    ["level('class.monk')", { kind: 'perLevel', n: 1, every: 1, source: { kind: 'class', classId: 'class.monk' } }],
    ['min(@spell.caster_level, 10)', { kind: 'perLevel', n: 1, every: 1, source: { kind: 'caster' }, max: 10 }],
    ['min(2 * floor(level() / 4), 6)', { kind: 'perLevel', n: 2, every: 4, source: { kind: 'character' }, max: 6 }],
    ['@ability.cha.mod', { kind: 'ability', ability: 'cha' }],
    ['-@toggle.power_attack.value', { kind: 'table', times: -1 }],
    ['@toggle.power_attack.value * 2', { kind: 'table', times: 2 }],
    ['1d6 fire', { kind: 'dice', count: 1, sides: 6, damage: 'fire' }],
  ])('reads %s and writes it back', (value, model) => {
    expect(parseValue(value, t)).toEqual(model)
    expect(valueFormula(parseValue(value, t), t)).toBe(value)
  })

  it('keeps anything else as written', () => {
    expect(parseValue('max(1, @ability.int.mod)', t)).toEqual({ kind: 'other', text: 'max(1, @ability.int.mod)' })
    expect(parseValue('2 * @toggle.power_attack.value', t)).toEqual({ kind: 'table', times: 2 })
    expect(parseValue('@toggle.other.value', t).kind).toBe('other')
  })
})
