import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSetting } from '../lib/db'

const EMPTY = {
  products: [],
  recipe_items: [],
  option_groups: [],
  options: [],
  option_recipe_items: [],
  ingredients: [],
  preparations: [],
  preparation_items: [],
  payment_methods: [],
  business: {},
  rate: null,
  lastSync: null,
  ready: false,
}

export function useCatalog() {
  return (
    useLiveQuery(async () => {
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
        lastSync,
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
        db.rate.get('latest'),
        getSetting('last_catalog_sync', null),
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
        lastSync,
        ready: products.length > 0 || Boolean(lastSync),
      }
    }, []) || EMPTY
  )
}
