import { supabase } from './supabase'
import { db, getLatestRate, getSetting } from './db'

async function fetchTable(name, query) {
  const { data, error } = await query
  if (error) throw new Error(`${name}: ${error.message}`)
  return data || []
}

export async function fetchCatalogFromSupabase() {
  const [
    products,
    recipeItems,
    optionGroups,
    options,
    optionRecipeItems,
    ingredients,
    preparations,
    preparationItems,
    paymentMethods,
    businessSettings,
    rateSnapshot,
  ] = await Promise.all([
    fetchTable(
      'products',
      supabase.from('products').select('*').order('sort_order', { ascending: true }),
    ),
    fetchTable('recipe_items', supabase.from('recipe_items').select('*')),
    fetchTable(
      'option_groups',
      supabase.from('option_groups').select('*').order('sort_order', { ascending: true }),
    ),
    fetchTable(
      'options',
      supabase.from('options').select('*').order('sort_order', { ascending: true }),
    ),
    fetchTable('option_recipe_items', supabase.from('option_recipe_items').select('*')),
    fetchTable(
      'ingredients',
      supabase.from('ingredients').select('*').order('name', { ascending: true }),
    ),
    fetchTable(
      'preparations',
      supabase.from('preparations').select('*').order('name', { ascending: true }),
    ),
    fetchTable('preparation_items', supabase.from('preparation_items').select('*')),
    fetchTable(
      'payment_methods',
      supabase.from('payment_methods').select('*').order('sort_order', { ascending: true }),
    ),
    supabase.from('business_settings').select('*').eq('id', 1).maybeSingle(),
    supabase
      .from('rate_snapshots')
      .select('*')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (businessSettings.error) throw new Error(`business_settings: ${businessSettings.error.message}`)
  if (rateSnapshot.error) throw new Error(`rate_snapshots: ${rateSnapshot.error.message}`)

  return {
    products,
    recipe_items: recipeItems,
    option_groups: optionGroups,
    options,
    option_recipe_items: optionRecipeItems,
    ingredients,
    preparations,
    preparation_items: preparationItems,
    payment_methods: paymentMethods,
    business: businessSettings.data || null,
    rate: rateSnapshot.data || null,
  }
}

export async function refreshCatalog() {
  const catalog = await fetchCatalogFromSupabase()
  await db.transaction(
    'rw',
    [
      db.products,
      db.recipe_items,
      db.option_groups,
      db.options,
      db.option_recipe_items,
      db.ingredients,
      db.preparations,
      db.preparation_items,
      db.payment_methods,
      db.settings,
      db.rate,
    ],
    async () => {
      await db.products.clear()
      await db.recipe_items.clear()
      await db.option_groups.clear()
      await db.options.clear()
      await db.option_recipe_items.clear()
      await db.ingredients.clear()
      await db.preparations.clear()
      await db.preparation_items.clear()
      await db.payment_methods.clear()

      await db.products.bulkPut(catalog.products)
      await db.recipe_items.bulkPut(catalog.recipe_items)
      await db.option_groups.bulkPut(catalog.option_groups)
      await db.options.bulkPut(catalog.options)
      await db.option_recipe_items.bulkPut(catalog.option_recipe_items)
      await db.ingredients.bulkPut(catalog.ingredients)
      await db.preparations.bulkPut(catalog.preparations)
      await db.preparation_items.bulkPut(catalog.preparation_items)
      await db.payment_methods.bulkPut(catalog.payment_methods)

      await db.settings.put({ key: 'business', value: catalog.business || {} })
      await db.settings.put({ key: 'last_catalog_sync', value: new Date().toISOString() })
      if (catalog.rate) {
        await db.rate.put({ ...catalog.rate, id: 'latest' })
      }
    },
  )

  return {
    products: catalog.products.length,
    ingredients: catalog.ingredients.length,
    preparations: catalog.preparations.length,
    options: catalog.options.length,
    syncedAt: new Date().toISOString(),
  }
}

export async function readCatalogFromDb() {
  const [
    products,
    recipe_items,
    option_groups,
    options,
    option_recipe_items,
    ingredients,
    preparations,
    preparation_items,
    payment_methods,
    business,
    rate,
  ] = await Promise.all([
    db.products.toArray(),
    db.recipe_items.toArray(),
    db.option_groups.toArray(),
    db.options.toArray(),
    db.option_recipe_items.toArray(),
    db.ingredients.toArray(),
    db.preparations.toArray(),
    db.preparation_items.toArray(),
    db.payment_methods.toArray(),
    getSetting('business', {}),
    getLatestRate(),
  ])

  return {
    products,
    recipe_items,
    option_groups,
    options,
    option_recipe_items,
    ingredients,
    preparations,
    preparation_items,
    payment_methods,
    business,
    rate,
  }
}
