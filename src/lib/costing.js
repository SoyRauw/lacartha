import { BASE_UNIT_LABELS, SLOT_LABELS } from './constants'

function groupBy(rows, key) {
  const map = new Map()
  for (const row of rows || []) {
    const k = row?.[key]
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(row)
  }
  return map
}

export function buildCostContext(catalog = {}) {
  return {
    ...catalog,
    ingredientsMap: new Map((catalog.ingredients || []).map((i) => [i.id, i])),
    preparationsMap: new Map((catalog.preparations || []).map((p) => [p.id, p])),
    productsMap: new Map((catalog.products || []).map((p) => [p.id, p])),
    optionsMap: new Map((catalog.options || []).map((o) => [o.id, o])),
    groupsMap: new Map((catalog.option_groups || []).map((g) => [g.id, g])),
    prepItemsByPrep: groupBy(catalog.preparation_items, 'preparation_id'),
    recipeByProduct: groupBy(catalog.recipe_items, 'product_id'),
    optionRecipeByOption: groupBy(catalog.option_recipe_items, 'option_id'),
    prepCache: new Map(),
  }
}

export function ingredientUnitCost(ingredient) {
  return parseFloat(ingredient?.avg_cost_usd) || 0
}

export function preparationTotalCost(preparationId, ctx) {
  const prep = ctx.preparationsMap?.get(preparationId)
  if (!prep) return 0
  const items = ctx.prepItemsByPrep?.get(preparationId) || []
  return items.reduce((sum, item) => {
    const ing = ctx.ingredientsMap?.get(item.ingredient_id)
    return sum + (parseFloat(item.quantity_base) || 0) * ingredientUnitCost(ing)
  }, 0)
}

export function preparationUnitCost(preparationId, ctx) {
  if (ctx.prepCache?.has(preparationId)) return ctx.prepCache.get(preparationId)
  const prep = ctx.preparationsMap?.get(preparationId)
  if (!prep) return 0
  const total = preparationTotalCost(preparationId, ctx)
  const yieldQty = parseFloat(prep.yield_quantity) || 1
  const perUnit = total / yieldQty
  ctx.prepCache?.set(preparationId, perUnit)
  return perUnit
}

export function componentCost(item, ctx) {
  if (!item) return 0
  const qty = parseFloat(item.quantity) || 0
  if (item.component_type === 'preparation') {
    return qty * preparationUnitCost(item.preparation_id, ctx)
  }
  const ing = ctx.ingredientsMap?.get(item.ingredient_id)
  return qty * ingredientUnitCost(ing)
}

export function recipeItemsFor(productId, ctx) {
  return ctx.recipeByProduct?.get(productId) || []
}

export function productCost(product, ctx) {
  if (!product) return 0
  if (product.product_type === 'simple') return parseFloat(product.cost_usd) || 0
  return recipeItemsFor(product.id, ctx).reduce((sum, item) => sum + componentCost(item, ctx), 0)
}

export function optionCost(optionId, ctx) {
  const items = ctx.optionRecipeByOption?.get(optionId) || []
  return items.reduce((sum, item) => sum + componentCost(item, ctx), 0)
}

export function optionPriceDelta(option) {
  return parseFloat(option?.price_delta_usd) || 0
}

export function saleItemUnitPrice(product, selectedOptions = []) {
  const base = parseFloat(product?.price_usd) || 0
  return base + selectedOptions.reduce((sum, opt) => sum + optionPriceDelta(opt), 0)
}

export function saleItemUnitCost(product, selectedOptions = [], ctx) {
  if (!product) return 0
  if (product.product_type === 'simple') return parseFloat(product.cost_usd) || 0
  return (
    productCost(product, ctx) +
    selectedOptions.reduce((sum, opt) => sum + optionCost(opt.id, ctx), 0)
  )
}

function addToMap(map, ingredientId, qty) {
  if (!ingredientId || !qty) return
  map.set(ingredientId, (map.get(ingredientId) || 0) + qty)
}

function explodeComponent(item, multiplier, ctx, out) {
  if (!item) return
  if (item.component_type === 'preparation') {
    const prep = ctx.preparationsMap?.get(item.preparation_id)
    if (!prep) return
    const prepItems = ctx.prepItemsByPrep?.get(item.preparation_id) || []
    const factor =
      ((parseFloat(item.quantity) || 0) / (parseFloat(prep.yield_quantity) || 1)) * multiplier
    for (const prepItem of prepItems) {
      addToMap(out, prepItem.ingredient_id, (parseFloat(prepItem.quantity_base) || 0) * factor)
    }
    return
  }
  addToMap(out, item.ingredient_id, (parseFloat(item.quantity) || 0) * multiplier)
}

export function explodeSaleItem(product, selectedOptions = [], quantity = 1, ctx) {
  if (!product || product.product_type === 'simple') return []
  const out = new Map()
  const qty = parseFloat(quantity) || 0
  for (const item of recipeItemsFor(product.id, ctx)) {
    explodeComponent(item, qty, ctx, out)
  }
  for (const option of selectedOptions) {
    const optionItems = ctx.optionRecipeByOption?.get(option.id) || []
    for (const item of optionItems) {
      explodeComponent(item, qty, ctx, out)
    }
  }
  return [...out.entries()].map(([ingredient_id, quantity_base]) => ({
    ingredient_id,
    quantity_base,
  }))
}

export function productCostBreakdown(product, ctx) {
  if (!product) return { items: [], total: 0 }
  if (product.product_type === 'simple') {
    return {
      items: [
        {
          label: product.name,
          slot: 'otro',
          quantity: 1,
          unit: BASE_UNIT_LABELS[product.base_unit] || 'unidad',
          cost: parseFloat(product.cost_usd) || 0,
        },
      ],
      total: parseFloat(product.cost_usd) || 0,
    }
  }
  const items = recipeItemsFor(product.id, ctx).map((item) => {
    if (item.component_type === 'preparation') {
      const prep = ctx.preparationsMap?.get(item.preparation_id)
      return {
        label: prep?.name || 'Preparación',
        slot: item.slot,
        slotLabel: SLOT_LABELS[item.slot] || item.slot,
        quantity: parseFloat(item.quantity) || 0,
        unit:
          prep?.yield_unit === 'portion'
            ? 'porción'
            : BASE_UNIT_LABELS[prep?.yield_unit] || 'unidad',
        cost: componentCost(item, ctx),
        componentType: 'preparation',
      }
    }
    const ing = ctx.ingredientsMap?.get(item.ingredient_id)
    return {
      label: ing?.name || 'Ingrediente',
      slot: item.slot,
      slotLabel: SLOT_LABELS[item.slot] || item.slot,
      quantity: parseFloat(item.quantity) || 0,
      unit: BASE_UNIT_LABELS[ing?.base_unit] || 'unidad',
      cost: componentCost(item, ctx),
      componentType: 'ingredient',
    }
  })
  return { items, total: items.reduce((sum, item) => sum + item.cost, 0) }
}

export function optionCostBreakdown(option, ctx) {
  const items = (ctx.optionRecipeByOption?.get(option.id) || []).map((item) => {
    if (item.component_type === 'preparation') {
      const prep = ctx.preparationsMap?.get(item.preparation_id)
      return {
        label: prep?.name || 'Preparación',
        quantity: parseFloat(item.quantity) || 0,
        unit:
          prep?.yield_unit === 'portion'
            ? 'porción'
            : BASE_UNIT_LABELS[prep?.yield_unit] || 'unidad',
        cost: componentCost(item, ctx),
      }
    }
    const ing = ctx.ingredientsMap?.get(item.ingredient_id)
    return {
      label: ing?.name || 'Ingrediente',
      quantity: parseFloat(item.quantity) || 0,
      unit: BASE_UNIT_LABELS[ing?.base_unit] || 'unidad',
      cost: componentCost(item, ctx),
    }
  })
  return { items, total: items.reduce((sum, item) => sum + item.cost, 0) }
}

export function marginOf(price, cost) {
  const p = parseFloat(price) || 0
  const c = parseFloat(cost) || 0
  return {
    amount: p - c,
    percent: p > 0 ? ((p - c) / p) * 100 : 0,
  }
}

export function optionsOfGroup(groupId, ctx) {
  return (ctx.options || [])
    .filter((o) => o.group_id === groupId && o.active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

export function groupsForProduct(product, ctx) {
  if (!product || product.product_type === 'simple' || product.category !== 'banderilla') return []
  return (ctx.option_groups || [])
    .filter((g) => g.active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

export function productOptionSummary(selectedOptions = []) {
  if (!selectedOptions.length) return 'Sin opciones'
  return selectedOptions.map((o) => o.name).join(' · ')
}

export function formatQty(qty, unit) {
  const n = parseFloat(qty) || 0
  const value = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
  return `${value} ${unit || ''}`.trim()
}
