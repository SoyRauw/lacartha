import { db, getOpenCashSession } from './db'

export async function openLocalCashSession({ opening_usd = 0, opening_bs = 0, user_id = null }) {
  const session = {
    id: crypto.randomUUID(),
    status: 'open',
    opening_usd: Number(opening_usd) || 0,
    opening_bs: Number(opening_bs) || 0,
    opened_at: new Date().toISOString(),
    closed_at: null,
    expected_usd: null,
    expected_bs: null,
    counted_usd: null,
    counted_bs: null,
    difference_usd: null,
    difference_bs: null,
    notes: null,
    opened_by: user_id,
    closed_by: null,
    sync_status: 'pending',
    created_at: new Date().toISOString(),
  }
  await db.cash_sessions.put(session)
  return session
}

export async function getOpenLocalSession() {
  return getOpenCashSession()
}

export async function addLocalCashMovement({
  sessionId,
  payment,
  saleId = null,
  movementType = 'sale',
  notes = null,
}) {
  if (!sessionId) return null
  const movement = {
    id: crypto.randomUUID(),
    cash_session_id: sessionId,
    movement_type: movementType,
    payment_method_id: payment.payment_method_id || null,
    method_code: payment.method_code,
    method_name: payment.method_name,
    affects_cash: Boolean(payment.affects_cash),
    currency: payment.currency,
    amount: Number(payment.amount) || 0,
    amount_usd: Number(payment.amount_usd) || 0,
    rate_source: payment.rate_source || null,
    rate_value: Number(payment.rate_value) || null,
    reference_type: saleId ? 'sale' : null,
    reference_id: saleId,
    notes,
    created_at: new Date().toISOString(),
  }
  await db.cash_movements.put(movement)
  return movement
}

export async function getLocalCashMovements(sessionId) {
  if (!sessionId) return []
  const rows = await db.cash_movements.where('cash_session_id').equals(sessionId).toArray()
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

export async function closeLocalCashSession({
  session,
  counted_usd = 0,
  counted_bs = 0,
  notes = null,
  user_id = null,
}) {
  const movements = await getLocalCashMovements(session.id)
  const cashMovements = movements.filter((m) => m.affects_cash)

  const expectedUsd =
    (Number(session.opening_usd) || 0) +
    cashMovements
      .filter((m) => m.currency === 'USD')
      .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)

  const expectedBs =
    (Number(session.opening_bs) || 0) +
    cashMovements
      .filter((m) => m.currency === 'BS')
      .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)

  const updated = {
    ...session,
    status: 'closed',
    closed_at: new Date().toISOString(),
    expected_usd: expectedUsd,
    expected_bs: expectedBs,
    counted_usd: Number(counted_usd) || 0,
    counted_bs: Number(counted_bs) || 0,
    difference_usd: (Number(counted_usd) || 0) - expectedUsd,
    difference_bs: (Number(counted_bs) || 0) - expectedBs,
    notes: notes || session.notes,
    closed_by: user_id,
    sync_status: 'pending',
  }
  await db.cash_sessions.put(updated)
  return updated
}

export function cashTotalsByMethod(movements = []) {
  const totals = {}
  for (const movement of movements) {
    const key = movement.method_code || 'otro'
    if (!totals[key]) {
      totals[key] = {
        method_code: key,
        method_name: movement.method_name || key,
        currency: movement.currency,
        amount: 0,
        amount_usd: 0,
        affects_cash: movement.affects_cash,
      }
    }
    totals[key].amount += Number(movement.amount) || 0
    totals[key].amount_usd += Number(movement.amount_usd) || 0
  }
  return Object.values(totals)
}
