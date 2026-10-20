import { describe, expect, it } from 'vitest'
import { slugOf } from './GroupSettingsScreen'

describe('slugOf', () => {
  it('reads a slug or a ruleset page link', () => {
    expect(slugOf(' eberron ')).toBe('eberron')
    expect(slugOf('https://lore.example.org/rulesets/eberron')).toBe('eberron')
    expect(slugOf('/rulesets/monde_2?x=1')).toBe('monde_2')
  })
})
