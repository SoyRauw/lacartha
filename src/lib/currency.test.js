import { describe, expect, it } from 'vitest'
import {
  convertBsToUsd,
  convertUsdToBs,
  marginPercent,
  moneyPrecise,
  roundBs,
} from './currency'

describe('currency', () => {
  it('converts USD to Bs', () => {
    expect(convertUsdToBs(10, 120)).toBe(1200)
  })

  it('converts Bs to USD', () => {
    expect(convertBsToUsd(1200, 120)).toBe(10)
  })

  it('rounds Bs up to the nearest 0.10', () => {
    expect(roundBs(10.01, 'up_010')).toBe(10.1)
    expect(roundBs(10, 'up_010')).toBe(10)
    expect(roundBs(10.24, 'up_050')).toBe(10.5)
  })

  it('calculates margin percent', () => {
    expect(marginPercent(3.5, 1.5)).toBeCloseTo(57.1428, 3)
  })

  it('formats precise unit costs', () => {
    expect(moneyPrecise(0.002, 4)).toBe('$0.0020')
  })
})
