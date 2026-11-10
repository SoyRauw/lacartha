const SOUND_KEY = 'lacartha.orders.sound'

let audioContext = null

export function isSoundEnabled() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SOUND_KEY) !== 'off'
}

export function setSoundEnabled(enabled) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off')
  }
  if (enabled) primeAudio()
}

export function primeAudio() {
  if (typeof window === 'undefined') return null
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    if (!audioContext) audioContext = new Ctx()
    if (audioContext.state === 'suspended') audioContext.resume()
    return audioContext
  } catch {
    return null
  }
}

export function playNewOrderSound() {
  if (!isSoundEnabled()) return
  const ctx = primeAudio()
  if (!ctx) return

  const now = ctx.currentTime
  const notes = [880, 1174.66, 1567.98]
  notes.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = now + index * 0.13
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.14)
  })
}

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'error'
  }
}

export function showOrderNotification(order) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const items = Array.isArray(order?.public_order_items) ? order.public_order_items : []
  const count = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const title = `Nueva comanda ${order?.order_number || ''}`.trim()
  const body = [
    order?.customer_name,
    order?.customer_phone,
    count > 0 ? `${count} artículo(s)` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  try {
    new Notification(title, {
      body,
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      tag: order?.id || title,
    })
  } catch {
    // Algunos navegadores no permiten notificaciones desde la PWA.
  }
}
