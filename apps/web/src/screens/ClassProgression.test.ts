import { describe, expect, it } from 'vitest'
import { iterativeAttacks } from './ClassProgression'

describe('iterativeAttacks', () => {
  it('adds an attack at −5 from +6 on, four at most', () => {
    expect(iterativeAttacks(1)).toBe('+1')
    expect(iterativeAttacks(5)).toBe('+5')
    expect(iterativeAttacks(6)).toBe('+6/+1')
    expect(iterativeAttacks(16)).toBe('+16/+11/+6/+1')
    expect(iterativeAttacks(20)).toBe('+20/+15/+10/+5')
    expect(iterativeAttacks(26)).toBe('+26/+21/+16/+11')
  })

  it('shows exact running totals as whole numbers', () => {
    expect(iterativeAttacks('7.5')).toBe('+7/+2')
    expect(iterativeAttacks(0)).toBe('+0')
  })
})
