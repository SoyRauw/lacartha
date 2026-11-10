import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDateTime } from './dates'
import { bs, money, rate as formatRate } from './currency'
import {
  BUSINESS_INSTAGRAM_HANDLE,
  BUSINESS_NAME,
  BUSINESS_PHONE,
  BUSINESS_TAGLINE,
} from './constants'
import { rateLabel } from './rates'
import { LOGO_URL } from './assets'

function normalizeItems(sale) {
  const raw = sale.items || sale.sale_items || sale.payload?.items || []
  return raw.map((it) => {
    const options =
      it.options || it.sale_item_options || it.selected_options || it.config?.options || []
    return {
      ...it,
      product_name: it.product_name || it.name || it.product?.name || 'Producto',
      quantity: parseFloat(it.quantity) || 1,
      unit_price_usd: parseFloat(it.unit_price_usd ?? it.price_usd ?? it.unit_price) || 0,
      line_total_usd:
        parseFloat(it.line_total_usd ?? it.total_usd) ||
        (parseFloat(it.unit_price_usd ?? it.unit_price) || 0) * (parseFloat(it.quantity) || 1),
      options: Array.isArray(options) ? options : [],
    }
  })
}

function normalizePayments(sale) {
  const raw = sale.payments || sale.sale_payments || sale.payload?.payments || []
  return raw.map((p) => ({
    ...p,
    method_name: p.method_name || p.method || p.name || 'Pago',
    currency: p.currency || 'USD',
    amount: parseFloat(p.amount) || 0,
    amount_usd: parseFloat(p.amount_usd) || 0,
    received_amount: parseFloat(p.received_amount) || null,
    change_usd: parseFloat(p.change_usd) || 0,
    change_bs: parseFloat(p.change_bs) || 0,
    change_pm_amount: parseFloat(p.change_pm_amount) || 0,
  }))
}

function optionsText(item) {
  if (!item.options?.length) return ''
  return item.options
    .map((o) => o.option_name || o.name || o.option?.name || '')
    .filter(Boolean)
    .join(' · ')
}

async function loadLogoDataUrl() {
  try {
    const res = await fetch(LOGO_URL)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function generateReceiptPdf(sale) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const items = normalizeItems(sale)
  const payments = normalizePayments(sale)
  const totalUsd = parseFloat(sale.total_usd) || items.reduce((s, it) => s + it.line_total_usd, 0)
  const totalBs = parseFloat(sale.total_bs) || 0
  const rateValue = parseFloat(sale.rate_value) || 0
  const orderNumber = sale.order_number || sale.client_id?.slice(0, 8) || '—'

  doc.setFillColor(74, 28, 0)
  doc.rect(0, 0, 210, 44, 'F')
  const logo = await loadLogoDataUrl()
  if (logo) {
    doc.addImage(logo, 'PNG', 14, 7, 44, 30)
  }
  doc.setTextColor(255, 246, 229)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(BUSINESS_TAGLINE, 66, 17)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`${BUSINESS_NAME} · ${BUSINESS_PHONE}`, 66, 24)
  doc.text(BUSINESS_INSTAGRAM_HANDLE, 66, 30)
  doc.setTextColor(255, 195, 0)
  doc.setFontSize(8)
  doc.text('RECIBO DE VENTA', 66, 37)

  doc.setTextColor(43, 27, 18)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(`Pedido ${orderNumber}`, 14, 57)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(128, 101, 85)
  doc.text(formatDateTime(sale.created_at || new Date()), 14, 64)
  const customerLine = [sale.customer_name, sale.customer_phone]
    .filter(Boolean)
    .join(' · ')
  if (customerLine) doc.text(`Cliente: ${customerLine}`, 14, 70)
  if (rateValue > 0) {
    doc.text(
      `Tasa: ${rateLabel(sale.rate_source)} ${formatRate(rateValue)} Bs/USD`,
      14,
      customerLine ? 76 : 70,
    )
  }

  const tableStart = customerLine ? 84 : 78
  const body = items.map((it) => {
    const options = optionsText(it)
    return [
      options ? `${it.product_name}\n${options}` : it.product_name,
      String(it.quantity),
      money(it.unit_price_usd),
      money(it.line_total_usd),
    ]
  })

  autoTable(doc, {
    startY: tableStart,
    head: [['Producto', 'Cant.', 'Precio', 'Total']],
    body,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.4, textColor: [43, 27, 18] },
    headStyles: { fillColor: [232, 93, 4], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [255, 246, 229] },
    columnStyles: {
      0: { cellWidth: 96 },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  })

  let y = (doc.lastAutoTable?.finalY || tableStart) + 8
  const rightX = 196
  doc.setFontSize(9)
  doc.setTextColor(128, 101, 85)
  doc.text('TOTAL USD', 140, y)
  doc.setTextColor(43, 27, 18)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(money(totalUsd), rightX, y, { align: 'right' })
  y += 9
  if (totalBs > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(128, 101, 85)
    doc.text('TOTAL Bs', 140, y)
    doc.setTextColor(43, 27, 18)
    doc.setFont('helvetica', 'bold')
    doc.text(bs(totalBs), rightX, y, { align: 'right' })
    y += 9
  }

  if (payments.length) {
    y += 2
    doc.setDrawColor(232, 216, 197)
    doc.line(14, y, 196, y)
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(43, 27, 18)
    doc.text('Pagos', 14, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(128, 101, 85)
    for (const p of payments) {
      doc.text(p.method_name, 14, y)
      doc.text(
        p.currency === 'USD' || p.currency === 'USDT'
          ? `${p.currency} ${p.amount.toFixed(2)}`
          : bs(p.amount),
        196,
        y,
        { align: 'right' },
      )
      if (p.received_amount && Math.abs(p.received_amount - p.amount) > 0.009) {
        y += 4
        doc.text(
          p.currency === 'USD' || p.currency === 'USDT'
            ? `Recibido: ${p.currency} ${p.received_amount.toFixed(2)}`
            : `Recibido: ${bs(p.received_amount)}`,
          20,
          y,
        )
      }
      if (p.change_usd > 0) {
        y += 4
        doc.text(`Vuelto USD: ${money(p.change_usd)}`, 20, y)
      }
      if (p.change_bs > 0) {
        y += 4
        doc.text(`Vuelto Bs: ${bs(p.change_bs)}`, 20, y)
      }
      if (p.change_pm_amount > 0) {
        y += 4
        doc.text(`Vuelto pago móvil: ${money(p.change_pm_amount)}`, 20, y)
      }
      y += 5
    }
  }

  y += 10
  doc.setDrawColor(232, 216, 197)
  doc.line(14, y, 196, y)
  y += 7
  doc.setFontSize(8)
  doc.setTextColor(128, 101, 85)
  doc.text('Gracias por tu compra. ¡Vuelve pronto!', 14, y)
  doc.text(`${BUSINESS_INSTAGRAM_HANDLE} · ${BUSINESS_PHONE}`, 196, y, { align: 'right' })

  return doc
}

export async function downloadReceipt(sale) {
  const doc = await generateReceiptPdf(sale)
  const orderNumber = sale.order_number || 'recibo'
  doc.save(`LaCartha-${orderNumber}.pdf`)
}
