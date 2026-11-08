import { describe, expect, it } from 'vitest'
import {
  buildCostContext,
  explodeSaleItem,
  marginOf,
  optionCost,
  preparationUnitCost,
  productCost,
  saleItemUnitCost,
  saleItemUnitPrice,
} from './costing'

const catalog = {
  ingredients: [
    { id: 'harina', name: 'Harina', base_unit: 'g', avg_cost_usd: 0.002 },
    { id: 'salchicha', name: 'Salchicha', base_unit: 'unit', avg_cost_usd: 0.35 },
    { id: 'queso', name: 'Queso', base_unit: 'g', avg_cost_usd: 0.006 },
    { id: 'dorito', name: 'Dorito', base_unit: 'g', avg_cost_usd: 0.01 },
  ],
  preparations: [
    { id: 'masa', name: 'Masa', yield_quantity: 12, yield_unit: 'portion' },
  ],
  preparation_items: [
    { id: 'pi1', preparation_id: 'masa', ingredient_id: 'harina', quantity_base: 1000 },
  ],
  products: [
    {
      id: 'mixta',
      name: 'Mixta',
      category: 'banderilla',
      product_type: 'recipe',
      price_usd: 3.5,
    },
  ],
  recipe_items: [
    { id: 'r1', product_id: 'mixta', slot: 'masa', component_type: 'preparation', preparation_id: 'masa', quantity: 1 },
    { id: 'r2', product_id: 'mixta', slot: 'salchicha', component_type: 'ingredient', ingredient_id: 'salchicha', quantity: 0.5 },
    { id: 'r3', product_id: 'mixta', slot: 'queso', component_type: 'ingredient', ingredient_id: 'queso', quantity: 30 },
  ],
  option_groups: [
    { id: 'topping', name: 'Topping', slug: 'topping' },
  ],
  options: [
    { id: 'dorito-opt', group_id: 'topping', name: 'Dorito', price_delta_usd: 0 },
  ],
  option_recipe_items: [
    { id: 'o1', option_id: 'dorito-opt', component_type: 'ingredient', ingredient_id: 'dorito', quantity: 20 },
  ],
}

describe('costing', () => {
  const ctx = buildCostContext(catalog)
  const product = catalog.products[0]
  const option = catalog.options[0]

  it('calculates the masa cost per portion', () => {
    expect(preparationUnitCost('masa', ctx)).toBeCloseTo(2 / 12, 6)
  })

  it('calculates the base product cost', () => {
    expect(productCost(product, ctx)).toBeCloseTo(2 / 12 + 0.175 + 0.18, 6)
  })

  it('calculates option cost', () => {
    expect(optionCost('dorito-opt', ctx)).toBeCloseTo(0.2, 6)
  })

  it('calculates sale item price and cost', () => {
    expect(saleItemUnitPrice(product, [option])).toBe(3.5)
    expect(saleItemUnitCost(product, [option], ctx)).toBeCloseTo(
      2 / 12 + 0.175 + 0.18 + 0.2,
      6,
    )
  })

  it('explodes a sale into ingredient quantities', () => {
    const rows = explodeSaleItem(product, [option], 2, ctx)
    const map = new Map(rows.map((row) => [row.ingredient_id, row.quantity_base]))
    expect(map.get('harina')).toBeCloseTo((1000 / 12) * 2, 6)
    expect(map.get('salchicha')).toBeCloseTo(1, 6)
    expect(map.get('queso')).toBeCloseTo(60, 6)
    expect(map.get('dorito')).toBeCloseTo(40, 6)
  })

  it('calculates margin', () => {
    const margin = marginOf(3.5, 1.5)
    expect(margin.amount).toBe(2)
    expect(margin.percent).toBeCloseTo(57.1428, 3)
  })
})
