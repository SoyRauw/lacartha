import { db, getOpenCashSession } from './db'
import { billsToJson, normalizeBillCounts, sumBills } from './bills'

export async function openLocalCashSession({
  opening_usd = 0,
  opening_bs = 0,
  opening_bills = null,
  exchange_rate = null,
  user_id = null,
}) {
  const hasBills = opening_bills && Object.values(opening_bills).some((qty) => Number(qty) > 0)
  const bills = hasBills ? normalizeBillCounts(opening_bills) : null
  const openingUsd = bills ? sumBills(bills) : Number(opening_usd) || 0

  const session = {
    id: crypto.randomUUID(),
    status: 'open',
    opening_usd: openingUsd,
    opening_bs: Number(opening_bs) || 0,
    opening_bills: bills ? billsToJson(bills) : null,
    exchange_rate: Number(exchange_rate) || null,
    opened_at: new Date().toISOString(),
    closed_at: null,
    expected_usd: null,
    expected_bs: null,
    expected_total_usd: null,
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

  if (bills) {
    await addLocalBillMovements({
      sessionId: session.id,
      type: 'apertura',
      counts: bills,
      note: 'Apertura de caja',
      syncStatus: 'pending',
    })
  }

  return session
}

export async function getOpenLocalSession() {
  return getOpenCashSession()
}

export async function addLocalBillMovements({
  sessionId,
  type,
  counts,
  saleId = null,
  note = null,
  syncStatus = 'pending',
}) {
  if (!sessionId || !counts) return []
  const normalized = normalizeBillCounts(counts)
  const rows = []
  for (const [denom, qty] of Object.entries(normalized)) {
    if (qty <= 0) continue
    rows.push({
      id: crypto.randomUUID(),
      cash_session_id: sessionId,
      sale_id: saleId,
      type,
      denomination: Number(denom),
      quantity: qty,
      note,
      created_at: new Date().toISOString(),
      sync_status: syncStatus,
    })
  }
  if (rows.length) await db.cash_bill_movements.bulkPut(rows)
  return rows
}

export async function getLocalBillLedger(sessionId) {
  if (!sessionId) return []
  const rows = await db.cash_bill_movements
    .where('cash_session_id')
    .equals(sessionId)
    .toArray()
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

export async function addLocalCashMovement({
  sessionId,
  payment,
  saleId = null,
  movementType = 'sale',
  notes = null,
}) {
  if (!sessionId) return null
  const isCash = Boolean(payment.affects_cash)
  const amount = isCash
    ? Number(payment.received_amount ?? payment.amount) || 0
    : Number(payment.amount) || 0
  const amountUsd = isCash
    ? Number(payment.received_usd ?? payment.amount_usd) || 0
    : Number(payment.amount_usd) || 0
  const movement = {
    id: crypto.randomUUID(),
    cash_session_id: sessionId,
    movement_type: movementType,
    payment_method_id: payment.payment_method_id || null,
    method_code: payment.method_code,
    method_name: payment.method_name,
    affects_cash: Boolean(payment.affects_cash),
    currency: payment.currency,
    amount,
    amount_usd: amountUsd,
    received_amount: Number(payment.received_amount ?? payment.amount) || 0,
    change_usd: Number(payment.change_usd) || 0,
    change_bs: Number(payment.change_bs) || 0,
    change_pm_amount: Number(payment.change_pm_amount) || 0,
    change_pm_reference: payment.change_pm_reference || null,
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

export function expectedCashFromMovements(session, movements = []) {
  const cash = (movements || []).filter((m) => m.affects_cash)
  const usdReceived = cash
    .filter((m) => m.currency === 'USD')
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
  const bsReceived = cash
    .filter((m) => m.currency === 'BS')
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
  const changeUsd = cash.reduce((sum, m) => sum + (Number(m.change_usd) || 0), 0)
  const changeBs = cash.reduce((sum, m) => sum + (Number(m.change_bs) || 0), 0)

  const expectedUsd = (Number(session?.opening_usd) || 0) + usdReceived - changeUsd
  const expectedBs = (Number(session?.opening_bs) || 0) + bsReceived - changeBs
  const rate = Number(session?.exchange_rate) || 0
  const expectedTotalUsd = expectedUsd + (rate > 0 ? expectedBs / rate : 0)

  return { expectedUsd, expectedBs, expectedTotalUsd }
}

export async function reverseLocalSale(clientId) {
  if (!clientId) return

  const session = await getOpenLocalSession()
  if (session) {
    const movements = await getLocalCashMovements(session.id)
    const originals = movements.filter(
      (movement) =>
        movement.reference_type === 'sale' && movement.reference_id === clientId,
    )
    const now = new Date().toISOString()
    for (const movement of originals) {
      await db.cash_movements.put({
        ...movement,
        id: crypto.randomUUID(),
        movement_type: 'adjustment',
        amount: -(Number(movement.amount) || 0),
        amount_usd: -(Number(movement.amount_usd) || 0),
        received_amount: -(Number(movement.received_amount) || 0),
        change_usd: -(Number(movement.change_usd) || 0),
        change_bs: -(Number(movement.change_bs) || 0),
        change_pm_amount: -(Number(movement.change_pm_amount) || 0),
        reference_type: 'sale_void',
        notes: 'Anulación local',
        created_at: now,
      })
    }
  }

  const bills = await db.cash_bill_movements.where('sale_id').equals(clientId).toArray()
  const reversals = bills
    .filter((bill) => ['venta', 'vuelto'].includes(bill.type))
    .map((bill) => ({
      ...bill,
      id: crypto.randomUUID(),
      type: bill.type === 'venta' ? 'vuelto' : 'venta',
      note: 'Anulación local',
      sync_status: 'synced',
      created_at: new Date().toISOString(),
    }))
  if (reversals.length) await db.cash_bill_movements.bulkPut(reversals)
}

export async function closeLocalCashSession({
  session,
  closing_bills = null,
  counted_usd = 0,
  counted_bs = 0,
  notes = null,
  user_id = null,
}) {
  const movements = await getLocalCashMovements(session.id)
  const { expectedUsd, expectedBs, expectedTotalUsd } = expectedCashFromMovements(
    session,
    movements,
  )

  const hasClosingBills =
    closing_bills && Object.values(closing_bills).some((qty) => Number(qty) > 0)
  const bills = hasClosingBills ? normalizeBillCounts(closing_bills) : null
  const countedUsd = bills ? sumBills(bills) : Number(counted_usd) || 0

  if (bills) {
    await addLocalBillMovements({
      sessionId: session.id,
      type: 'cierre',
      counts: bills,
      note: 'Cierre de caja',
      syncStatus: 'pending',
    })
  }

  const updated = {
    ...session,
    status: 'closed',
    closed_at: new Date().toISOString(),
    expected_usd: expectedUsd,
    expected_bs: expectedBs,
    expected_total_usd: expectedTotalUsd,
    counted_usd: countedUsd,
    counted_bs: Number(counted_bs) || 0,
    difference_usd: countedUsd - expectedUsd,
    difference_bs: (Number(counted_bs) || 0) - expectedBs,
    closing_bills: bills ? billsToJson(bills) : null,
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
