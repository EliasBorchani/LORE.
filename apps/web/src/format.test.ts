import { describe, expect, it } from 'vitest'
import { formatModifier, formatNumber, splitDice, toInteger, formatThreatRange } from './format'

describe('format', () => {
  it('groups thousands with a narrow space and uses a decimal comma', () => {
    expect(formatNumber('2480')).toBe('2 480')
    expect(formatNumber('1718250')).toBe('1 718 250')
    expect(formatNumber('25.5')).toBe('25,5')
    expect(formatNumber('-3')).toBe('−3')
    expect(formatNumber('1/3')).toBe('1/3')
  })

  it('signs modifiers with a true minus', () => {
    expect(formatModifier('145')).toBe('+145')
    expect(formatModifier('-2')).toBe('−2')
    expect(formatModifier('0')).toBe('+0')
  })

  it('splits dice and their average', () => {
    expect(splitDice('3d6 + 138 (~148)')).toEqual({ expression: '3d6 + 138', average: '148' })
    expect(splitDice('15 × 8d6 + 1250 (~5040)')).toEqual({ expression: '15 × 8d6 + 1 250', average: '5 040' })
    expect(splitDice('12')).toEqual({ expression: '12', average: null })
  })

  it('reads whole numbers only', () => {
    expect(toInteger('2480')).toBe(2480)
    expect(toInteger('3d6 + 1 (~11)')).toBeNull()
    expect(toInteger(undefined)).toBeNull()
  })
})

describe('formatThreatRange', () => {
  it('shows how many d20 numbers threaten as a range ending at 20', () => {
    expect(formatThreatRange('1')).toBe('20')
    expect(formatThreatRange('2')).toBe('19–20')
    expect(formatThreatRange('6')).toBe('15–20')
    expect(formatThreatRange('0')).toBe('0')
  })
})
