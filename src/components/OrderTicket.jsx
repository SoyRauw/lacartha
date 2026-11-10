import { motion } from 'framer-motion'
import { Clock3, MapPin, Store, Truck } from 'lucide-react'
import { bs as formatBs, money } from '../lib/currency'
import { formatTime } from '../lib/dates'
import styles from './OrderTicket.module.css'

const STATUS = {
  nuevo: { label: 'Nueva', className: styles.statusNuevo, order: 0 },
  preparando: { label: 'Preparando', className: styles.statusPreparando, order: 1 },
  listo: { label: 'Lista', className: styles.statusListo, order: 2 },
  entregado: { label: 'Entregada', className: styles.statusEntregado, order: 3 },
  cancelado: { label: 'Cancelada', className: styles.statusCancelado, order: 4 },
}

function minutesSince(value) {
  const created = new Date(value).getTime()
  if (!Number.isFinite(created)) return 0
  return Math.max(0, Math.floor((Date.now() - created) / 60000))
}

function elapsedLabel(value) {
  const minutes = minutesSince(value)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `hace ${hours} h ${minutes % 60} min`
}

export function orderStatusLabel(status) {
  return STATUS[status]?.label || status
}

export function orderStatusOrder(status) {
  return STATUS[status]?.order ?? 9
}

export default function OrderTicket({ order, index = 0, onClick }) {
  const status = STATUS[order.status] || STATUS.nuevo
  const items = order.public_order_items || []
  const count = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const minutes = minutesSince(order.created_at)
  const overdue = minutes >= 15 && ['nuevo', 'preparando'].includes(order.status)
  const rotate = ((index % 5) - 2) * 0.45

  return (
    <motion.button
      type="button"
      className={styles.ticketButton}
      onClick={() => onClick?.(order)}
      initial={{ y: -22, opacity: 0, rotate: rotate - 1.5 }}
      animate={{ y: 0, opacity: 1, rotate }}
      transition={{ type: 'spring', stiffness: 220, damping: 18, delay: Math.min(index, 4) * 0.04 }}
      whileHover={{ y: 5, rotate: 0, scale: 1.02 }}
      whileTap={{ scale: 0.99 }}
    >
      <span className={styles.clip} aria-hidden="true" />
      <span className={`${styles.ticket} ${overdue ? styles.overdue : ''}`}>
        <span className={styles.topRow}>
          <span className={styles.number}>{order.order_number}</span>
          <span className={`${styles.stamp} ${status.className}`}>{status.label}</span>
        </span>

        <span className={styles.customer}>{order.customer_name}</span>

        <span className={styles.metaRow}>
          <span className={styles.meta}>
            {order.fulfillment === 'delivery' ? <Truck size={11} /> : <Store size={11} />}
            {order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}
          </span>
          <span className={styles.meta}>
            <Clock3 size={11} /> {formatTime(order.created_at)}
          </span>
        </span>

        {order.fulfillment === 'delivery' && order.address ? (
          <span className={styles.address}>
            <MapPin size={11} /> {order.address}
          </span>
        ) : null}

        <span className={styles.divider} />

        <span className={styles.itemsLine}>
          {count} artículo{count === 1 ? '' : 's'}
        </span>
        <span className={styles.total}>{money(order.total_usd)}</span>
        {Number(order.total_bs) > 0 ? (
          <span className={styles.bsTotal}>{formatBs(order.total_bs)}</span>
        ) : null}

        <span className={`${styles.elapsed} ${overdue ? styles.elapsedOverdue : ''}`}>
          {elapsedLabel(order.created_at)}
        </span>

        {order.sale_id ? <span className={styles.paid}>Pagada</span> : null}
      </span>
    </motion.button>
  )
}
