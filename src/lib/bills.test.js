import { describe, expect, it } from 'vitest'
import {
  BILL_DENOMINATIONS,
  billsToJson,
  drawerFromLedger,
  emptyBillCounts,
  formatBillsList,
  proposeChange,
  sumBills,
} from './bills'

describe('billetes', () => {
  it('suma denominaciones', () => {
    expect(BILL_DENOMINATIONS).toEqual([100, 50, 20, 10, 5, 2, 1])
    expect(sumBills({ 20: 2, 10: 1, 5: 1, 2: 1, 1: 3 })).toBe(60)
  })

  it('calcula el cajón desde el libro', () => {
    const rows = [
      { type: 'apertura', denomination: 20, quantity: 2 },
      { type: 'venta', denomination: 20, quantity: 1 },
      { type: 'vuelto', denomination: 10, quantity: 1 },
      { type: 'gasto', denomination: 5, quantity: 1 },
      { type: 'retiro', denomination: 2, quantity: 1 },
      { type: 'ajuste', denomination: 1, quantity: 4 },
    ]
    const drawer = drawerFromLedger(rows)
    expect(drawer[20]).toBe(3)
    expect(drawer[10]).toBe(-1)
    expect(drawer[5]).toBe(-1)
    expect(drawer[2]).toBe(-1)
    expect(drawer[1]).toBe(4)
  })

  it('propone vuelto con lo que hay en el cajón', () => {
    const drawer = emptyBillCounts()
    drawer[5] = 1
    drawer[2] = 2
    drawer[1] = 1

    const result = proposeChange(9.5, drawer)
    expect(result.ok).toBe(false)
    expect(result.proposal[5]).toBe(1)
    expect(result.proposal[2]).toBe(2)
    expect(result.proposal[1]).toBe(0)
    expect(sumBills(result.proposal)).toBe(9)
  })

  it('propone vuelto exacto cuando hay billetes suficientes', () => {
    const drawer = emptyBillCounts()
    drawer[10] = 2
    drawer[5] = 1
    drawer[2] = 1

    const result = proposeChange(17, drawer)
    expect(result.ok).toBe(true)
    expect(sumBills(result.proposal)).toBe(17)
  })

  it('serializa solo cantidades positivas', () => {
    expect(billsToJson({ 20: 1, 10: 0, 5: 2, 2: null })).toEqual({ 20: 1, 5: 2 })
    expect(formatBillsList({ 20: 1, 5: 2 })).toBe('1×$20, 2×$5')
  })
})
