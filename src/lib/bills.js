/**
 * Billetes de dólar para el cajón.
 * La caja de La Cartha sigue el mismo modelo que elitestore: un libro por denominación.
 */

export const BILL_DENOMINATIONS = [100, 50, 20, 10, 5, 2, 1]

export function emptyBillCounts() {
  const counts = {}
  for (const denom of BILL_DENOMINATIONS) counts[denom] = 0
  return counts
}

export function normalizeBillCounts(counts = {}) {
  const normalized = emptyBillCounts()
  for (const denom of BILL_DENOMINATIONS) {
    const qty = parseInt(counts[denom], 10)
    normalized[denom] = Number.isFinite(qty) && qty > 0 ? qty : 0
  }
  return normalized
}

export function sumBills(counts = {}) {
  return BILL_DENOMINATIONS.reduce(
    (sum, denom) => sum + (parseInt(counts[denom], 10) || 0) * denom,
    0,
  )
}

/**
 * Convierte el libro de billetes en el cajón actual.
 * apertura, venta y ajuste suman; vuelto, gasto y retiro restan.
 * cierre solo se incluye cuando se pide el conteo final.
 */
export function drawerFromLedger(rows = [], { includeCierre = false } = {}) {
  const drawer = emptyBillCounts()
  for (const row of rows) {
    const denom = parseFloat(row.denomination)
    const qty = parseInt(row.quantity, 10) || 0
    if (!BILL_DENOMINATIONS.includes(denom)) continue

    switch (row.type) {
      case 'apertura':
      case 'venta':
      case 'ajuste':
        drawer[denom] = (drawer[denom] || 0) + qty
        break
      case 'vuelto':
      case 'gasto':
      case 'retiro':
        drawer[denom] = (drawer[denom] || 0) - qty
        break
      case 'cierre':
        if (includeCierre) drawer[denom] = (drawer[denom] || 0) + qty
        break
      default:
        break
    }
  }
  return drawer
}

/**
 * Propone un vuelto con los billetes disponibles en el cajón.
 * Devuelve { ok, missing, proposal }. Si falta, missing dice qué billetes faltan.
 */
export function proposeChange(changeAmount, drawer = {}) {
  let remaining = Math.round((parseFloat(changeAmount) || 0) * 100) / 100
  const proposal = emptyBillCounts()
  const missing = emptyBillCounts()

  for (const denom of BILL_DENOMINATIONS) {
    const available = parseInt(drawer[denom], 10) || 0
    const needed = Math.min(Math.floor(remaining / denom + 1e-9), available)
    if (needed > 0) {
      proposal[denom] = needed
      remaining = Math.round((remaining - needed * denom) * 100) / 100
    }
  }

  const ok = remaining <= 0.009
  if (!ok) {
    for (const denom of BILL_DENOMINATIONS) {
      const needed = Math.floor(remaining / denom + 1e-9)
      if (needed > 0) {
        missing[denom] = (missing[denom] || 0) + needed
        remaining = Math.round((remaining - needed * denom) * 100) / 100
      }
    }
  }

  return { ok, missing, proposal }
}

/** Propuesta sin límite de cajón, solo para mostrar un vuelto posible. */
export function proposeChangeUnlimited(changeAmount) {
  let remaining = Math.round((parseFloat(changeAmount) || 0) * 100) / 100
  const proposal = emptyBillCounts()
  for (const denom of BILL_DENOMINATIONS) {
    const needed = Math.floor(remaining / denom + 1e-9)
    if (needed > 0) {
      proposal[denom] = needed
      remaining = Math.round((remaining - needed * denom) * 100) / 100
    }
  }
  return { ok: remaining <= 0.009, proposal }
}

export function formatBillsList(counts = {}) {
  return BILL_DENOMINATIONS
    .filter((denom) => (parseInt(counts[denom], 10) || 0) > 0)
    .map((denom) => `${counts[denom]}×$${denom}`)
    .join(', ')
}

export function billsToJson(counts = {}) {
  const json = {}
  for (const denom of BILL_DENOMINATIONS) {
    const qty = parseInt(counts[denom], 10) || 0
    if (qty > 0) json[denom] = qty
  }
  return json
}

export function billsFromJson(value) {
  return normalizeBillCounts(value && typeof value === 'object' ? value : {})
}

export function countsTotal(counts = {}) {
  return BILL_DENOMINATIONS.reduce(
    (sum, denom) => sum + (parseInt(counts[denom], 10) || 0),
    0,
  )
}

export function billsEqual(a = {}, b = {}) {
  return BILL_DENOMINATIONS.every(
    (denom) => (parseInt(a[denom], 10) || 0) === (parseInt(b[denom], 10) || 0),
  )
}
