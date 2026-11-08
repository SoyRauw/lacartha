import { supabase } from './supabase'
import { todayISO } from './dates'

const RATE_API_URL = 'https://ve.dolarapi.com/v1/cotizaciones'

function pickRate(data, currency) {
  if (!Array.isArray(data)) return null
  const official = data.find(
    (c) => String(c.moneda).toUpperCase() === currency && c.fuente === 'oficial',
  )
  const any = data.find((c) => String(c.moneda).toUpperCase() === currency)
  const row = official || any
  const value = parseFloat(row?.promedio)
  return Number.isFinite(value) ? value : null
}

export async function fetchRatesFromApi() {
  const res = await fetch(RATE_API_URL, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`No se pudieron consultar las tasas (${res.status})`)
  const data = await res.json()
  const bcv_usd = pickRate(data, 'USD')
  const bcv_eur = pickRate(data, 'EUR')
  if (!bcv_usd && !bcv_eur) throw new Error('La API no devolvió tasas válidas')
  const sourceDate =
    data.find(
      (c) => String(c.moneda).toUpperCase() === 'EUR' && c.fuente === 'oficial',
    )?.fechaActualizacion ||
    data[0]?.fechaActualizacion ||
    null
  return {
    bcv_usd,
    bcv_eur,
    usdt: 1,
    source: 'dolarapi',
    source_date: sourceDate,
    fetched_at: new Date().toISOString(),
  }
}

export async function saveRateSnapshot(rates) {
  const payload = {
    snapshot_date: todayISO(),
    bcv_usd: rates.bcv_usd ?? null,
    bcv_eur: rates.bcv_eur ?? null,
    usdt: rates.usdt ?? 1,
    source: rates.source || 'manual',
    fetched_at: rates.fetched_at || new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('rate_snapshots')
    .upsert(payload, { onConflict: 'snapshot_date' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function ensureDailyRates({ force = false } = {}) {
  const today = todayISO()

  if (!force) {
    const { data, error } = await supabase
      .from('rate_snapshots')
      .select('*')
      .eq('snapshot_date', today)
      .maybeSingle()
    if (error) throw error
    if (data && (Number(data.bcv_usd) > 0 || Number(data.bcv_eur) > 0)) {
      return data
    }
  }

  const fetched = await fetchRatesFromApi()
  return saveRateSnapshot(fetched)
}

export function getRateValue(rate, source) {
  if (!rate) return 0
  switch (source) {
    case 'bcv_usd':
      return parseFloat(rate.bcv_usd) || 0
    case 'bcv_eur':
      return parseFloat(rate.bcv_eur) || 0
    case 'usdt':
      return parseFloat(rate.usdt) || 1
    case 'manual':
      return parseFloat(rate.manual) || parseFloat(rate.bcv_eur) || parseFloat(rate.bcv_usd) || 0
    default:
      return parseFloat(rate.bcv_eur) || parseFloat(rate.bcv_usd) || 0
  }
}

export function rateLabel(source) {
  switch (source) {
    case 'bcv_usd':
      return 'BCV USD'
    case 'bcv_eur':
      return 'BCV EUR'
    case 'usdt':
      return 'USDT'
    case 'manual':
      return 'Manual'
    default:
      return 'Tasa'
  }
}
