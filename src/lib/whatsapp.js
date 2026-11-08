import { BUSINESS_WHATSAPP, RATE_LABELS } from './constants'
import { bs, money, rate as formatRate } from './currency'

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

export function buildOrderMessage({
  orderNumber,
  customer,
  items,
  totalUsd,
  totalBs,
  rateSource,
  rateValue,
  notes,
}) {
  const lines = []
  lines.push(`*Pedido ${orderNumber || ''}*`.trim())
  lines.push('')
  if (customer?.name) lines.push(`*Nombre:* ${customer.name}`)
  if (customer?.phone) lines.push(`*Teléfono:* ${customer.phone}`)
  if (customer?.fulfillment) {
    lines.push(`*Entrega:* ${customer.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}`)
  }
  if (customer?.address) lines.push(`*Dirección:* ${customer.address}`)
  lines.push('')
  lines.push('*Pedido:*')
  for (const item of items || []) {
    const options = (item.options || [])
      .map((o) => o.option_name || o.name)
      .filter(Boolean)
      .join(' · ')
    lines.push(
      `- ${item.quantity}x ${item.product_name}${options ? ` (${options})` : ''} — ${money(
        item.line_total_usd,
      )}`,
    )
  }
  lines.push('')
  lines.push(`*Total:* ${money(totalUsd)}`)
  if (totalBs > 0) {
    const rateText =
      rateValue > 0
        ? ` (${RATE_LABELS[rateSource] || rateSource || 'tasa'} ${formatRate(rateValue)})`
        : ''
    lines.push(`*Total Bs:* ${bs(totalBs)}${rateText}`)
  }
  if (notes) {
    lines.push('')
    lines.push(`*Notas:* ${notes}`)
  }
  lines.push('')
  lines.push('Quedo atento a los datos de pago. ¡Gracias!')
  return lines.join('\n')
}

export function openWhatsApp(message, phone = BUSINESS_WHATSAPP) {
  const normalized = normalizePhone(phone)
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
