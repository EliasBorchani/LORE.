import { describe, expect, it } from 'vitest'
import type { Entity } from '../../api/types'
import { LABEL_ICONS, TYPE_ICONS } from './icons'
import { LABELS, shownLabels } from './labels'

const batches = import.meta.glob('../../../../../content/srd/**/*.json', { eager: true, import: 'default' }) as Record<string, { entities?: Entity[] }>
const entities = Object.values(batches).flatMap((b) => b.entities ?? [])

describe('curated labels', () => {
  it('each has an icon, and each icon a label', () => {
    expect(LABELS.filter((l) => !l.icon).map((l) => l.id)).toEqual([])
    expect(Object.keys(LABEL_ICONS).filter((id) => !LABELS.some((l) => l.id === id))).toEqual([])
    expect(new Set(LABELS.map((l) => l.id)).size).toBe(LABELS.length)
  })

  it('reads every label of the official content', () => {
    expect(entities.length).toBeGreaterThan(1000)
    const unknown = new Set(entities.flatMap((e) => shownLabels(e.type, e.labels ?? []).filter((l) => typeof l === 'string')))
    expect([...unknown]).toEqual([])
  })

  it('hides labels that repeat the type and maps old names', () => {
    expect(shownLabels('spell', ['spell', 'évocation', 'fire']).map((l) => (typeof l === 'string' ? l : l.id))).toEqual(['evocation', 'fire'])
  })

  it('has a mark for every main type', () => {
    for (const type of ['feat', 'class_power', 'spell', 'item', 'class', 'prestige_class', 'race', 'skill', 'domain']) expect(TYPE_ICONS[type]).toBeDefined()
  })
})
