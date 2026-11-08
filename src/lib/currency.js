const nfUsd = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const nfBs = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const nfNumber = new Intl.NumberFormat('es-VE', {
  maximumFractionDigits: 3,
})

export function money(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${nfUsd.format(n)}`
}

export function usd(value) {
  return money(value)
}

export function moneyPrecise(value, digits = 4) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return `$0.${'0'.repeat(digits)}`
  return `$${n.toFixed(digits)}`
}

export function bs(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return 'Bs 0,00'
  return `Bs ${nfBs.format(n)}`
}

export function number(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '0'
  return nfNumber.format(n)
}

export function rate(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '0,00'
  return nfUsd.format(n)
}

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (!value) return 0
  const normalized = String(value).replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : 0
}

export function convertUsdToBs(amountUsd, rateValue) {
  const amount = parseFloat(amountUsd) || 0
  const r = parseFloat(rateValue) || 0
  if (r <= 0) return 0
  return amount * r
}

export function convertBsToUsd(amountBs, rateValue) {
  const amount = parseFloat(amountBs) || 0
  const r = parseFloat(rateValue) || 0
  if (r <= 0) return 0
  return amount / r
}

export function roundBs(value, mode = 'up_010') {
  const n = parseFloat(value) || 0
  if (mode === 'none') return Math.round(n * 100) / 100
  const step = mode === 'up_050' ? 0.5 : mode === 'up_1' ? 1 : 0.1
  return Math.round(Math.ceil((n - 1e-9) / step) * step * 100) / 100
}

export function priceToBs(priceUsd, rateValue, rounding = 'up_010') {
  return roundBs(convertUsdToBs(priceUsd, rateValue), rounding)
}

export function marginPercent(price, cost) {
  const p = parseFloat(price) || 0
  const c = parseFloat(cost) || 0
  if (p <= 0) return 0
  return ((p - c) / p) * 100
}

export function percent(value, digits = 1) {
  const n = parseFloat(value) || 0
  return `${n.toFixed(digits)}%`
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
