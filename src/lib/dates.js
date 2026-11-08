export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function toISODateLocal(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function todayISO() {
  return toISODateLocal(new Date())
}

export function toLocalDate(isoDate) {
  if (!isoDate) return null
  const s = String(isoDate).slice(0, 10)
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function formatDate(isoDate) {
  if (!isoDate) return '—'
  const d = String(isoDate).length <= 10 ? toLocalDate(isoDate) : new Date(isoDate)
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateShort(isoDate) {
  if (!isoDate) return '—'
  const d = String(isoDate).length <= 10 ? toLocalDate(isoDate) : new Date(isoDate)
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

export function endOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

export function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

export function startOfWeek(date = new Date()) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}

export function dayRangeISO(date = new Date()) {
  return {
    from: toISODateLocal(startOfDay(date)),
    to: toISODateLocal(endOfDay(date)),
  }
}

export function rangeToTimestamps(fromISO, toISO) {
  return {
    from: startOfDay(toLocalDate(fromISO)).toISOString(),
    to: endOfDay(toLocalDate(toISO)).toISOString(),
  }
}

export function lastNDays(n = 7, endDate = new Date()) {
  const end = endOfDay(endDate)
  const start = startOfDay(addDays(endDate, -(n - 1)))
  return {
    from: toISODateLocal(start),
    to: toISODateLocal(end),
  }
}

export function presetRange(preset) {
  const now = new Date()
  const thisMonth = startOfMonth(now)
  switch (preset) {
    case 'today':
      return { from: toISODateLocal(now), to: toISODateLocal(now), label: 'Hoy' }
    case 'yesterday': {
      const y = addDays(now, -1)
      return { from: toISODateLocal(y), to: toISODateLocal(y), label: 'Ayer' }
    }
    case 'week': {
      const start = startOfWeek(now)
      return { from: toISODateLocal(start), to: toISODateLocal(now), label: 'Esta semana' }
    }
    case 'last-month': {
      const start = addMonths(thisMonth, -1)
      const end = endOfMonth(start)
      return { from: toISODateLocal(start), to: toISODateLocal(end), label: 'Mes pasado' }
    }
    case '3m':
      return {
        from: toISODateLocal(addMonths(thisMonth, -2)),
        to: toISODateLocal(endOfMonth(now)),
        label: 'Últimos 3 meses',
      }
    case 'year':
      return {
        from: toISODateLocal(new Date(now.getFullYear(), 0, 1)),
        to: toISODateLocal(new Date(now.getFullYear(), 11, 31)),
        label: 'Este año',
      }
    case 'month':
    default:
      return {
        from: toISODateLocal(thisMonth),
        to: toISODateLocal(endOfMonth(now)),
        label: 'Este mes',
      }
  }
}

export function dayKey(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function daysInRange(fromISO, toISO) {
  const from = toLocalDate(fromISO)
  const to = toLocalDate(toISO)
  if (!from || !to) return 0
  return Math.max(1, Math.round((to - from) / 86400000) + 1)
}

export function generateOrderNumber(date = new Date()) {
  const y = String(date.getFullYear()).slice(-2)
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mm = pad2(date.getMinutes())
  const ss = pad2(date.getSeconds())
  const suffix = Math.floor(Math.random() * 900 + 100)
  return `LC-${y}${m}${d}-${hh}${mm}${ss}-${suffix}`
}
