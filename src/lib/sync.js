import { supabase } from './supabase'
import { db, markSaleError, markSaleSynced } from './db'
import { refreshCatalog } from './catalog'

export async function syncCashSession(session) {
  if (!session?.id) return
  const row = {
    id: session.id,
    status: session.status,
    opening_usd: session.opening_usd ?? 0,
    opening_bs: session.opening_bs ?? 0,
    opened_at: session.opened_at,
    closed_at: session.closed_at || null,
    expected_usd: session.expected_usd ?? null,
    expected_bs: session.expected_bs ?? null,
    counted_usd: session.counted_usd ?? null,
    counted_bs: session.counted_bs ?? null,
    difference_usd: session.difference_usd ?? null,
    difference_bs: session.difference_bs ?? null,
    notes: session.notes || null,
    opened_by: session.opened_by || null,
    closed_by: session.closed_by || null,
  }
  const { error } = await supabase.from('cash_sessions').upsert(row, { onConflict: 'id' })
  if (error) throw error
  await db.cash_sessions.update(session.id, {
    sync_status: 'synced',
    synced_at: new Date().toISOString(),
    sync_error: null,
  })
}

export async function syncPendingSales() {
  const pending = await db.pending_sales
    .where('sync_status')
    .anyOf('pending', 'error')
    .sortBy('created_at')

  let synced = 0
  let failed = 0
  let lastError = null

  for (const sale of pending) {
    if (!navigator.onLine) break
    try {
      const { data, error } = await supabase.rpc('register_sale', { payload: sale.payload })
      if (error) throw error
      const result = typeof data === 'string' ? JSON.parse(data) : data
      await markSaleSynced(sale.client_id, result || {})
      synced += 1
    } catch (e) {
      console.error('Error sincronizando venta', sale.client_id, e)
      lastError = e.message || String(e)
      await markSaleError(sale.client_id, lastError)
      failed += 1
      break
    }
  }

  return { synced, failed, lastError, total: pending.length }
}

export async function syncPendingCashSessions() {
  const pending = await db.cash_sessions.where('sync_status').equals('pending').toArray()
  let synced = 0
  let lastError = null
  for (const session of pending) {
    if (!navigator.onLine) break
    try {
      await syncCashSession(session)
      synced += 1
    } catch (e) {
      console.error('Error sincronizando caja', session.id, e)
      lastError = e.message || String(e)
      await db.cash_sessions.update(session.id, { sync_error: lastError })
      break
    }
  }
  return { synced, lastError, total: pending.length }
}

export async function syncAll({ refresh = true } = {}) {
  if (!navigator.onLine) {
    return {
      online: false,
      cashSynced: 0,
      salesSynced: 0,
      salesFailed: 0,
      error: 'Sin conexión',
    }
  }

  let cashResult = { synced: 0, lastError: null, total: 0 }
  let salesResult = { synced: 0, failed: 0, lastError: null, total: 0 }
  let catalogResult = null

  try {
    cashResult = await syncPendingCashSessions()
    salesResult = await syncPendingSales()
    if (refresh) {
      try {
        catalogResult = await refreshCatalog()
      } catch (e) {
        console.warn('No se pudo refrescar el catálogo', e)
      }
    }
  } catch (e) {
    console.error('Error en syncAll', e)
    return {
      online: true,
      cashSynced: cashResult.synced,
      salesSynced: salesResult.synced,
      salesFailed: salesResult.failed,
      error: e.message || String(e),
    }
  }

  return {
    online: true,
    cashSynced: cashResult.synced,
    salesSynced: salesResult.synced,
    salesFailed: salesResult.failed,
    error: cashResult.lastError || salesResult.lastError || null,
    catalog: catalogResult,
  }
}

export async function getPendingCounts() {
  const [sales, cash] = await Promise.all([
    db.pending_sales.where('sync_status').anyOf('pending', 'error').count(),
    db.cash_sessions.where('sync_status').equals('pending').count(),
  ])
  return { sales, cash, total: sales + cash }
}
