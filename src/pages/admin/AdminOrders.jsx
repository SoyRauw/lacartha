import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  ChefHat,
  ClipboardList,
  Clock3,
  CreditCard,
  History,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  Truck,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from '../../components/ui'
import OrderTicket, {
  fulfillmentLabel,
  orderStatusLabel,
  orderStatusOrder,
} from '../../components/OrderTicket'
import { useOrdersBoard } from '../../hooks/usePublicOrders'
import { supabase } from '../../lib/supabase'
import { bs as formatBs, money } from '../../lib/currency'
import { formatDateTime, formatTime, todayISO } from '../../lib/dates'
import {
  isSoundEnabled,
  primeAudio,
  requestNotificationPermission,
  setSoundEnabled,
} from '../../lib/notify'
import styles from './AdminOrders.module.css'

const ACTIVE_STATUSES = ['nuevo', 'preparando', 'listo']
const STATUS_FILTERS = [
  { value: 'todas', label: 'Todas' },
  { value: 'nuevo', label: 'Nuevas' },
  { value: 'preparando', label: 'Preparando' },
  { value: 'listo', label: 'Listas' },
]

function orderItems(order) {
  return [...(order?.public_order_items || [])].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )
}

function itemOptionText(item) {
  const options = item.public_order_item_options || []
  if (options.length) return options.map((option) => option.option_name).join(' · ')
  const config = item.config || {}
  const parts = []
  if (config.topping) parts.push(config.topping)
  if (Array.isArray(config.sauces) && config.sauces.length) {
    parts.push(...config.sauces)
  }
  return parts.join(' · ')
}

function statusCount(orders, status) {
  return orders.filter((order) => order.status === status).length
}

function isToday(value) {
  if (!value) return false
  return String(value).slice(0, 10) === todayISO()
}

export default function AdminOrders() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { orders, loading, error, refresh } = useOrdersBoard()
  const [view, setView] = useState('activas')
  const [filter, setFilter] = useState('todas')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [sound, setSound] = useState(() => isSoundEnabled())
  const [refreshing, setRefreshing] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onPointerDown = () => primeAudio()
    window.addEventListener('pointerdown', onPointerDown, { once: true })
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const activeOrders = useMemo(
    () =>
      orders
        .filter((order) => ACTIVE_STATUSES.includes(order.status))
        .sort(
          (a, b) =>
            orderStatusOrder(a.status) - orderStatusOrder(b.status) ||
            String(a.created_at).localeCompare(String(b.created_at)),
        ),
    [orders],
  )

  const historyOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          ['entregado', 'cancelado'].includes(order.status) && isToday(order.created_at),
      ),
    [orders],
  )

  const baseOrders = view === 'activas' ? activeOrders : historyOrders

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    return baseOrders.filter((order) => {
      if (view === 'activas' && filter !== 'todas' && order.status !== filter) return false
      if (!q) return true
      return (
        String(order.order_number || '').toLowerCase().includes(q) ||
        String(order.customer_name || '').toLowerCase().includes(q) ||
        String(order.customer_phone || '').toLowerCase().includes(q)
      )
    })
  }, [baseOrders, view, filter, search])

  const selected = useMemo(
    () => orders.find((order) => order.id === selectedId) || null,
    [orders, selectedId],
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const toggleSound = async () => {
    const next = !sound
    setSound(next)
    setSoundEnabled(next)
    if (next) {
      primeAudio()
      await requestNotificationPermission()
      push('Avisos activados', 'success')
    } else {
      push('Avisos silenciados', 'info')
    }
  }

  const updateStatus = useCallback(
    async (status) => {
      if (!selected) return
      setSaving(true)
      try {
        const now = new Date().toISOString()
        const patch = { status }
        if (status === 'preparando') patch.accepted_at = now
        if (status === 'listo') patch.ready_at = now
        if (status === 'entregado') patch.delivered_at = now

        const { error: updateError } = await supabase
          .from('public_orders')
          .update(patch)
          .eq('id', selected.id)
        if (updateError) throw updateError

        push(
          `Comanda ${status === 'entregado' ? 'entregada' : orderStatusLabel(status).toLowerCase()}`,
          'success',
        )
        await refresh()
      } catch (e) {
        console.error(e)
        push(e.message || 'No se pudo actualizar la comanda', 'error')
      } finally {
        setSaving(false)
      }
    },
    [selected, push, refresh],
  )

  const cancelOrder = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const { error: cancelError } = await supabase
        .from('public_orders')
        .update({
          status: 'cancelado',
          cancelled_at: now,
          cancel_reason: cancelReason.trim() || null,
        })
        .eq('id', selected.id)
      if (cancelError) throw cancelError
      setCancelOpen(false)
      setCancelReason('')
      push('Comanda cancelada', 'success')
      await refresh()
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo cancelar la comanda', 'error')
    } finally {
      setSaving(false)
    }
  }

  const chargeOrder = (order) => {
    if (!order || order.sale_id) return
    setSelectedId(null)
    navigate(`/admin/vender?comanda=${order.id}`)
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title="Comandas"
          subtitle="Pedidos del menú público en tiempo real."
          icon={ClipboardList}
        />
        <Loading label="Cargando comandas..." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Comandas"
        subtitle="Las facturitas del menú público, colgadas y en tiempo real."
        icon={ClipboardList}
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={toggleSound}
              title={sound ? 'Silenciar avisos' : 'Activar sonido y notificaciones'}
            >
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
              {sound ? 'Sonido activo' : 'Sonido apagado'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Actualizar
            </button>
          </>
        }
      />

      {error ? (
        <div className="alert alert-error mb-3">
          {error}
          <button type="button" className="btn btn-sm ml-2" onClick={refresh}>
            Reintentar
          </button>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.viewTabs}>
          <button
            type="button"
            className={`${styles.viewTab} ${view === 'activas' ? styles.viewTabActive : ''}`}
            onClick={() => setView('activas')}
          >
            <ClipboardList size={15} /> Activas
            <span className={styles.count}>{activeOrders.length}</span>
          </button>
          <button
            type="button"
            className={`${styles.viewTab} ${view === 'historial' ? styles.viewTabActive : ''}`}
            onClick={() => setView('historial')}
          >
            <History size={15} /> Historial de hoy
            <span className={styles.count}>{historyOrders.length}</span>
          </button>
        </div>

        <div className={styles.searchBox}>
          <Search size={15} />
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o número..."
          />
        </div>
      </div>

      {view === 'activas' ? (
        <div className={styles.filters}>
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip ${filter === option.value ? 'active' : ''}`}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              {option.value !== 'todas' ? (
                <span className={styles.filterCount}>
                  {statusCount(activeOrders, option.value)}
                </span>
              ) : (
                <span className={styles.filterCount}>{activeOrders.length}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      <section className={styles.board}>
        <div className={styles.rail} aria-hidden="true">
          <span className={styles.railLabel}>
            {view === 'activas' ? 'Comandas activas' : 'Comandas de hoy'}
          </span>
          <span className={styles.railLine} />
          <span className={styles.railEnd} />
        </div>

        {filteredOrders.length === 0 ? (
          <div className={styles.emptyBoard}>
            <EmptyState
              icon={view === 'activas' ? ClipboardList : History}
              title={
                view === 'activas'
                  ? 'No hay comandas activas'
                  : 'Todavía no hay historial hoy'
              }
              text={
                view === 'activas'
                  ? 'Cuando un cliente pida desde el menú público, la facturita aparecerá aquí.'
                  : 'Las comandas entregadas y canceladas de hoy se guardan aquí.'
              }
              action={
                view === 'activas' ? (
                  <button type="button" className="btn" onClick={handleRefresh}>
                    <RefreshCw size={15} /> Buscar nuevas
                  </button>
                ) : null
              }
            />
          </div>
        ) : (
          <div className={styles.tickets}>
            {filteredOrders.map((order, index) => (
              <OrderTicket
                key={order.id}
                order={order}
                index={index}
                onClick={(value) => setSelectedId(value.id)}
              />
            ))}
            <div className={styles.railSpacer} />
          </div>
        )}
      </section>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? `Comanda ${selected.order_number}` : 'Comanda'}
        icon={ClipboardList}
        wide
        footer={
          selected ? (
            <div className={styles.modalFooter}>
              <div className={styles.modalFooterLeft}>
                {!selected.sale_id && selected.status !== 'cancelado' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => chargeOrder(selected)}
                    disabled={saving}
                  >
                    <CreditCard size={15} /> Cobrar comanda
                  </button>
                ) : null}
                {selected.sale_id ? (
                  <span className="badge badge-green">
                    <CheckCircle2 size={12} /> Pagada
                  </span>
                ) : null}
                {['nuevo', 'preparando', 'listo'].includes(selected.status) ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setCancelOpen(true)}
                    disabled={saving}
                  >
                    <XCircle size={15} /> Cancelar
                  </button>
                ) : null}
              </div>
              <div className={styles.modalFooterRight}>
                {selected.status === 'nuevo' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => updateStatus('preparando')}
                    disabled={saving}
                  >
                    <ChefHat size={15} /> Empezar preparación
                  </button>
                ) : null}
                {selected.status === 'preparando' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => updateStatus('listo')}
                    disabled={saving}
                  >
                    <CheckCircle2 size={15} /> Marcar lista
                  </button>
                ) : null}
                {selected.status === 'listo' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => updateStatus('entregado')}
                    disabled={saving}
                  >
                    <PackageCheck size={15} /> Entregar
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => setSelectedId(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className={styles.detail}>
            <div className={styles.detailTop}>
              <div>
                <p className={styles.detailNumber}>{selected.order_number}</p>
                <p className={styles.detailCustomer}>{selected.customer_name}</p>
                <div className={styles.detailMeta}>
                  <a href={`tel:${selected.customer_phone}`} className={styles.detailLink}>
                    <Phone size={13} /> {selected.customer_phone}
                  </a>
                  <a
                    href={`https://wa.me/${String(selected.customer_phone).replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.detailLink}
                  >
                    <MessageCircle size={13} /> WhatsApp
                  </a>
                </div>
              </div>
              <div className={styles.detailStatus}>
                <span
                  className={`badge ${
                    selected.status === 'listo'
                      ? 'badge-green'
                      : selected.status === 'cancelado'
                        ? 'badge-red'
                        : 'badge-yellow'
                  }`}
                >
                  {orderStatusLabel(selected.status)}
                </span>
                <span className={styles.detailTime}>
                  <Clock3 size={12} /> {formatTime(selected.created_at)}
                </span>
                <span className={styles.detailTime}>
                  {selected.fulfillment === 'delivery' ? (
                    <Truck size={12} />
                  ) : (
                    <UtensilsCrossed size={12} />
                  )}
                  {fulfillmentLabel(selected.fulfillment)}
                </span>
              </div>
            </div>

            {selected.fulfillment === 'delivery' && selected.address ? (
              <div className={styles.addressBox}>
                <MapPin size={14} />
                <div>
                  <span>{selected.address}</span>
                  <span className={styles.deliveryPending}>Delivery por cotizar</span>
                </div>
              </div>
            ) : null}

            {selected.notes ? (
              <div className={styles.noteBox}>
                <strong>Notas:</strong> {selected.notes}
              </div>
            ) : null}

            <div className={styles.itemsList}>
              {orderItems(selected).map((item) => {
                const options = itemOptionText(item)
                return (
                  <div className={styles.item} key={item.id}>
                    <div className={styles.itemQty}>{Number(item.quantity)}×</div>
                    <div className={styles.itemBody}>
                      <div className={styles.itemName}>{item.product_name}</div>
                      {options ? <div className={styles.itemOptions}>{options}</div> : null}
                      {item.notes ? (
                        <div className={styles.itemNotes}>Nota: {item.notes}</div>
                      ) : null}
                    </div>
                    <strong className={styles.itemTotal}>{money(item.line_total_usd)}</strong>
                  </div>
                )
              })}
            </div>

            <div className={styles.totalBox}>
              <div>
                <span className={styles.totalLabel}>Total USD</span>
                <strong className={styles.totalUsd}>{money(selected.total_usd)}</strong>
              </div>
              <div>
                <span className={styles.totalLabel}>Total Bs</span>
                <strong className={styles.totalBs}>{formatBs(selected.total_bs)}</strong>
              </div>
              {Number(selected.rate_value) > 0 ? (
                <div className={styles.rateLine}>
                  Tasa {selected.rate_source || 'BCV'} ·{' '}
                  {Number(selected.rate_value).toLocaleString('es-VE')}
                </div>
              ) : null}
            </div>

            <div className={styles.timeline}>
              <div className={styles.timelineItem}>
                <span className={styles.timelineDot} />
                <span>Creada {formatDateTime(selected.created_at)}</span>
              </div>
              {selected.accepted_at ? (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineDot} />
                  <span>Preparando {formatDateTime(selected.accepted_at)}</span>
                </div>
              ) : null}
              {selected.ready_at ? (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineDot} />
                  <span>Lista {formatDateTime(selected.ready_at)}</span>
                </div>
              ) : null}
              {selected.delivered_at ? (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineDot} />
                  <span>Entregada {formatDateTime(selected.delivered_at)}</span>
                </div>
              ) : null}
              {selected.cancelled_at ? (
                <div className={styles.timelineItem}>
                  <span className={`${styles.timelineDot} ${styles.timelineDotRed}`} />
                  <span>Cancelada {formatDateTime(selected.cancelled_at)}</span>
                </div>
              ) : null}
            </div>

            {selected.sale_id ? (
              <p className={styles.saleLink}>
                Venta vinculada: <strong>{selected.sale_id}</strong>
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar comanda"
        icon={XCircle}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setCancelOpen(false)}
              disabled={saving}
            >
              Volver
            </button>
            <button type="button" className="btn btn-danger" onClick={cancelOrder} disabled={saving}>
              {saving ? 'Cancelando...' : 'Cancelar comanda'}
            </button>
          </>
        }
      >
        <p className="small muted mb-2">
          La comanda saldrá del tablero activo y quedará en el historial.
        </p>
        <div className="field">
          <label>Motivo (opcional)</label>
          <textarea
            className="textarea"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Cliente no contestó, se agotó un ingrediente..."
          />
        </div>
      </Modal>
    </>
  )
}
