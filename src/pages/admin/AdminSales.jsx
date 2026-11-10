import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Calendar,
  CheckCircle2,
  CloudOff,
  Download,
  Eye,
  ReceiptText,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  ConfirmModal,
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { useOnline } from '../../hooks/useOnline'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { bs as formatBs, money, number } from '../../lib/currency'
import { formatDateTime, presetRange, rangeToTimestamps } from '../../lib/dates'
import { downloadReceipt } from '../../lib/receipts'
import { reverseLocalSale } from '../../lib/localCash'

const PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'last-month', label: 'Mes pasado' },
]

function normalizeServerSale(sale) {
  return {
    ...sale,
    items: (sale.sale_items || []).map((item) => ({
      ...item,
      options: item.sale_item_options || [],
    })),
    payments: sale.sale_payments || [],
    pending: false,
  }
}

function normalizePendingSale(row) {
  const payload = row.payload || {}
  return {
    id: row.client_id,
    client_id: row.client_id,
    order_number: payload.order_number || row.order_number,
    status: 'pending',
    total_usd: Number(payload.total_usd) || Number(row.total_usd) || 0,
    total_bs: Number(payload.total_bs) || Number(row.total_bs) || 0,
    rate_source: payload.rate_source,
    rate_value: payload.rate_value,
    customer_name: payload.customer_name,
    notes: payload.notes,
    created_at: payload.created_at || row.created_at,
    items: payload.items || [],
    payments: payload.payments || [],
    sync_status: row.sync_status,
    sync_error: row.error,
    pending: true,
  }
}

export default function AdminSales() {
  const { push } = useToast()
  const online = useOnline()
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('month')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [voidSale, setVoidSale] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  const range = useMemo(() => presetRange(preset), [preset])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let serverSales = []
      if (navigator.onLine) {
        const { from, to } = rangeToTimestamps(range.from, range.to)
        const { data, error: supaError } = await supabase
          .from('sales')
          .select(`
            id,
            client_id,
            order_number,
            status,
            subtotal_usd,
            discount_usd,
            total_usd,
            total_bs,
            rate_source,
            rate_value,
            customer_name,
            notes,
            created_at,
            voided_at,
            void_reason,
            sale_items (
              id,
              product_name,
              quantity,
              unit_price_usd,
              unit_cost_usd,
              line_total_usd,
              config,
              notes,
              sale_item_options (option_name, group_name, price_delta_usd)
            ),
            sale_payments (method_name, method_code, currency, amount, amount_usd, reference)
          `)
          .gte('created_at', from)
          .lte('created_at', to)
          .order('created_at', { ascending: false })
        if (supaError) throw supaError
        serverSales = (data || []).map(normalizeServerSale)
      }

      const pendingRows = await db.pending_sales
        .where('sync_status')
        .anyOf('pending', 'error')
        .toArray()
      const pendingSales = pendingRows.map(normalizePendingSale)

      setSales([...pendingSales, ...serverSales])
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudieron cargar las ventas')
      const pendingRows = await db.pending_sales
        .where('sync_status')
        .anyOf('pending', 'error')
        .toArray()
        .catch(() => [])
      setSales(pendingRows.map(normalizePendingSale))
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sales
      .filter((sale) => {
        if (statusFilter === 'pending' && !sale.pending) return false
        if (statusFilter === 'completed' && (sale.pending || sale.status !== 'completed')) {
          return false
        }
        if (statusFilter === 'voided' && sale.status !== 'voided') return false
        if (!q) return true
        return (
          (sale.order_number || '').toLowerCase().includes(q) ||
          (sale.customer_name || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }, [sales, statusFilter, search])

  const stats = useMemo(() => {
    const completed = sales.filter((s) => !s.pending && s.status === 'completed')
    const total = completed.reduce((sum, s) => sum + (Number(s.total_usd) || 0), 0)
    const pending = sales.filter((s) => s.pending).length
    return {
      total,
      tickets: completed.length,
      avg: completed.length ? total / completed.length : 0,
      pending,
    }
  }, [sales])

  const handleVoid = async () => {
    if (!voidSale) return
    setVoiding(true)
    try {
      const { error: rpcError } = await supabase.rpc('void_sale', {
        p_sale_id: voidSale.id,
        p_reason: voidReason.trim() || null,
      })
      if (rpcError) throw rpcError
      await reverseLocalSale(voidSale.client_id)
      push('Venta anulada y stock restaurado', 'success')
      setVoidSale(null)
      setVoidReason('')
      setDetail(null)
      await load()
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo anular la venta', 'error')
    } finally {
      setVoiding(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Ventas"
        subtitle="Historial, recibos y anulaciones."
        icon={ReceiptText}
        actions={
          <button type="button" className="btn" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
          </button>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={ReceiptText} label="Ventas del período" value={money(stats.total)} hint={range.label} />
        <StatCard icon={CheckCircle2} label="Tickets" value={stats.tickets} hint="Ventas completadas" />
        <StatCard icon={ReceiptText} label="Ticket promedio" value={money(stats.avg)} hint="Por venta" />
        <StatCard
          icon={CloudOff}
          label="Pendientes sync"
          value={stats.pending}
          tone={stats.pending > 0 ? 'warning' : 'success'}
          hint="Guardadas localmente"
        />
      </div>

      {!online ? (
        <div className="alert alert-warn mb-3 flex items-center gap-2">
          <CloudOff size={15} /> Sin conexión: solo se muestran las ventas pendientes locales.
        </div>
      ) : null}
      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      <div className="card">
        <div className="flex items-center gap-2 wrap mb-3">
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search
              size={15}
              style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Buscar por pedido o cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="tabs" style={{ margin: 0 }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tab ${preset === p.id ? 'active' : ''}`}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="completed">Completadas</option>
            <option value="pending">Pendientes</option>
            <option value="voided">Anuladas</option>
          </select>
        </div>

        {loading ? (
          <Loading label="Cargando ventas..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No hay ventas"
            text="No encontramos ventas para este filtro."
          />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th className="num">Total USD</th>
                  <th className="num">Total Bs</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <div className="row-title">{sale.order_number || '—'}</div>
                      <div className="row-meta">{sale.payments?.[0]?.method_name || '—'}</div>
                    </td>
                    <td>{formatDateTime(sale.created_at)}</td>
                    <td>{sale.customer_name || 'Mostrador'}</td>
                    <td className="num"><strong>{money(sale.total_usd)}</strong></td>
                    <td className="num">{formatBs(sale.total_bs)}</td>
                    <td>
                      {sale.pending ? (
                        <span className="badge badge-yellow">Pendiente</span>
                      ) : sale.status === 'voided' ? (
                        <span className="badge badge-red">Anulada</span>
                      ) : (
                        <span className="badge badge-green">Completada</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button type="button" className="btn btn-sm" onClick={() => setDetail(sale)}>
                          <Eye size={13} /> Ver
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => downloadReceipt(sale)}
                        >
                          <Download size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Pedido ${detail.order_number || ''}` : 'Venta'}
        icon={ReceiptText}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => detail && downloadReceipt(detail)}>
              <Download size={15} /> PDF
            </button>
            {detail && !detail.pending && detail.status === 'completed' ? (
              <button type="button" className="btn btn-danger" onClick={() => setVoidSale(detail)}>
                <Ban size={15} /> Anular
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </>
        }
      >
        {detail ? (
          <>
            <div className="flex justify-between gap-2 wrap mb-2">
              <div>
                <p className="label">Fecha</p>
                <p className="small">{formatDateTime(detail.created_at)}</p>
              </div>
              <div>
                <p className="label">Estado</p>
                <p className="small">
                  {detail.pending
                    ? 'Pendiente de sincronizar'
                    : detail.status === 'voided'
                      ? 'Anulada'
                      : 'Completada'}
                </p>
              </div>
              <div>
                <p className="label">Tasa</p>
                <p className="small">
                  {detail.rate_value ? `${number(detail.rate_value)} Bs/USD` : '—'}
                </p>
              </div>
            </div>

            {detail.pending && detail.sync_error ? (
              <div className="alert alert-error mb-2">{detail.sync_error}</div>
            ) : null}

            <div className="table-wrap">
              <table className="table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Cant.</th>
                    <th className="num">Precio</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((item, index) => (
                    <tr key={item.id || index}>
                      <td>
                        <div className="row-title">{item.product_name}</div>
                        {item.options?.length ? (
                          <div className="row-meta">
                            {item.options
                              .map((o) => o.option_name || o.name)
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{number(item.quantity)}</td>
                      <td className="num">{money(item.unit_price_usd)}</td>
                      <td className="num">{money(item.line_total_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divider" />
            <div className="flex justify-between gap-2">
              <span className="muted small">Total USD</span>
              <strong>{money(detail.total_usd)}</strong>
            </div>
            <div className="flex justify-between gap-2 mt-1">
              <span className="muted small">Total Bs</span>
              <strong>{formatBs(detail.total_bs)}</strong>
            </div>

            <div className="divider" />
            <p className="label mb-1">Pagos</p>
            {(detail.payments || []).map((payment, index) => (
              <div className="flex justify-between gap-2" key={index} style={{ marginBottom: 4 }}>
                <span className="small">{payment.method_name}</span>
                <span className="small">
                  {payment.currency === 'BS'
                    ? formatBs(payment.amount)
                    : `${payment.currency} ${number(payment.amount)}`}
                  {payment.reference ? ` · ${payment.reference}` : ''}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(voidSale)}
        onClose={() => setVoidSale(null)}
        title="Anular venta"
        icon={AlertTriangle}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setVoidSale(null)} disabled={voiding}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" onClick={handleVoid} disabled={voiding}>
              {voiding ? 'Anulando...' : 'Anular venta'}
            </button>
          </>
        }
      >
        <div className="alert alert-warn mb-2">
          Se restaurará el stock de los ingredientes y se marcará la venta como anulada.
        </div>
        <div className="field">
          <label>Motivo</label>
          <textarea
            className="textarea"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Error de cobro, pedido cancelado..."
          />
        </div>
      </Modal>
    </>
  )
}
