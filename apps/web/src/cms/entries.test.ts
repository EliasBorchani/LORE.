import { describe, expect, it } from 'vitest'
import { groupEntries } from './entries'

describe('entry groups', () => {
  const labels = { official: 'D&D 3.5', inRuleset: (r: string) => `${r} — situations` }
  const rulesets = [{ slug: 'maison', name: 'Maison' }, { slug: 'eberron', name: 'Eberron' }]

  it('put the official entries first, then each ruleset in the group’s order, sorted by name', () => {
    const groups = groupEntries([
      { key: 'eberron:situation.vs_warforged', label: 'contre les forgeliers' },
      { key: 'situation.vs_poison', label: 'contre le poison' },
      { key: 'maison:situation.underwater', label: 'sous l’eau' },
      { key: 'situation.vs_evil', label: 'contre le Mal' },
    ], rulesets, labels)
    expect(groups.map((g) => g.label)).toEqual(['D&D 3.5', 'Maison — situations', 'Eberron — situations'])
    expect(groups[0].options.map((o) => o.label)).toEqual(['contre le Mal', 'contre le poison'])
  })

  it('leave out empty groups', () => {
    expect(groupEntries([{ key: 'maison:source.homebrew', label: 'Homebrew' }], rulesets, labels).map((g) => g.label)).toEqual(['Maison — situations'])
  })
})
