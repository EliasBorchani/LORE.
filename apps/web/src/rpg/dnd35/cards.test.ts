import { describe, expect, it } from 'vitest'
import type { CardContent, Entity } from '../../api/types'
import { blurbOf, cardOf } from './cards'

interface Batch {
  entities?: Entity[]
  relations?: { from: string; relation: string; to: string; level?: number }[]
}

const batches = Object.values(import.meta.glob('../../../../../content/srd/**/*.json', { eager: true, import: 'default' }) as Record<string, Batch>)
const entities = batches.flatMap((b) => b.entities ?? [])
const relations = batches.flatMap((b) => b.relations ?? [])
const names = new Map(entities.map((e) => [e.id, e.name.fr ?? e.name.en ?? e.id]))

/** The card the server sends for an entity (`server/src/catalog/cards.rs`). */
function cardItem(entity: Entity) {
  const { id, type, name: _name, labels, description: _description, note: _note, ...rest } = entity
  const spellLevels = relations.filter((r) => r.from === id && r.relation === 'on_spell_list').map((r) => ({ list: r.to, level: r.level ?? null }))
  const card: CardContent = { ...rest, ...(spellLevels.length && { spellLevels }) }
  return { type, labels, card }
}

const card = (id: string) => {
  const entity = entities.find((e) => e.id === id)!
  return cardOf(cardItem(entity), names)
}
const fact = (id: string, label: string) => card(id).facts.find((f) => f.label === label)?.value

describe('cardOf', () => {
  it('gives every official entity a card, with facts for the types that have some', () => {
    const withFacts = ['spell', 'class', 'maneuver', 'stance']
    for (const entity of entities) {
      const model = cardOf(cardItem(entity), names)
      const priced = entity.type === 'item' && (entity.item as { cost?: string }).cost
      if (withFacts.includes(entity.type) || priced) expect(model.facts.length, entity.id).toBeGreaterThan(0)
      if (entity.type === 'feat' && entity.prerequisite) expect(model.facts.some((f) => f.label === 'Conditions'), entity.id).toBe(true)
      for (const f of model.facts) expect(f.value, `${entity.id} ${f.label}`).not.toMatch(/undefined|null|\[object/)
    }
  })

  it('shows a spell by its school, levels and short facts', () => {
    const fireball = card('spell.fireball')
    expect(fireball.kicker).toBe('Évocation [feu]')
    expect(fact('spell.fireball', 'Niveaux')).toMatch(/Magicien 3/)
    expect(fact('spell.fireball', 'Portée')).toBe('Longue')
    expect(fact('spell.fireball', 'Jet de sauvegarde')).toBe('Réflexes, 1/2 dégâts')
  })

  it('shows a weapon by its damage and critical, a skill by its key ability', () => {
    expect(fact('item.longsword', 'Dégâts')).toBe('1d8 (1d6 P)')
    expect(fact('item.longsword', 'Critique')).toBe('19–20/×2')
    expect(fact('item.full_plate', 'Bonus d’armure')).toBe('+8')
    expect(card('skill.climb').big?.value).toBe('FOR')
  })

  it('reads a prerequisite, a class and a race in words', () => {
    expect(fact('feat.power_attack', 'Conditions')).toBe('Force ≥ 13')
    expect(card('class.wizard').big?.value).toBe('d4')
    expect(fact('class.wizard', 'Sorts')).toBe('profanes préparés (Int)')
    expect(fact('race.elf', 'Caractéristiques')).toBe('Dex +2, Con −2')
  })
})

describe('blurbOf', () => {
  it('keeps the first paragraph, cut at a word', () => {
    expect(blurbOf('\n\nUne sphère de feu.\n\nEn jeu\n• 1d6')).toBe('Une sphère de feu.')
    const long = blurbOf('mot '.repeat(100))!
    expect(long.endsWith('mot…')).toBe(true)
    expect(blurbOf('  ')).toBeUndefined()
  })
})
