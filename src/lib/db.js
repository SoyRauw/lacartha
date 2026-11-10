import Dexie from 'dexie'

export const db = new Dexie('lacartha')

db.version(1).stores({
  products: 'id, category, sort_order, active',
  recipe_items: 'id, product_id, slot',
  option_groups: 'id, sort_order',
  options: 'id, group_id, sort_order',
  option_recipe_items: 'id, option_id',
  ingredients: 'id, name, category, active',
  preparations: 'id, name',
  preparation_items: 'id, preparation_id',
  payment_methods: 'id, code, sort_order',
  settings: 'key',
  rate: 'id, snapshot_date',
  pending_sales: 'client_id, sync_status, created_at',
  cash_sessions: 'id, status, sync_status, opened_at',
  cash_movements: 'id, cash_session_id, created_at',
})

db.version(2).stores({
  cash_bill_movements: 'id, cash_session_id, sale_id, type, created_at',
})

db.version(3).stores({
  cash_bill_movements: 'id, cash_session_id, sale_id, type, sync_status, created_at',
})

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key)
  return row ? row.value : fallback
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value })
}

export async function getLatestRate() {
  return (await db.rate.get('latest')) || null
}

export async function getOpenCashSession() {
  const open = await db.cash_sessions.where('status').equals('open').toArray()
  if (!open.length) return null
  return open.sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)))[0]
}

export async function getCashMovements(sessionId) {
  if (!sessionId) return []
  const rows = await db.cash_movements.where('cash_session_id').equals(sessionId).toArray()
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

export async function markSaleSynced(clientId, serverResult) {
  const sale = await db.pending_sales.get(clientId)
  if (!sale) return
  await db.pending_sales.update(clientId, {
    sync_status: 'synced',
    server_id: serverResult?.sale_id || serverResult?.id || null,
    order_number: serverResult?.order_number || sale.order_number,
    synced_at: new Date().toISOString(),
    error: null,
  })
}

export async function markSaleError(clientId, message) {
  await db.pending_sales.update(clientId, {
    sync_status: 'error',
    error: message || 'Error de sincronización',
    last_attempt: new Date().toISOString(),
  })
}
