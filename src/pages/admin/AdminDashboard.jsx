import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  CloudOff,
  ListChecks,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  EmptyState,
  Loading,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { useCatalog } from '../../hooks/useCatalog'
import { useOnline } from '../../hooks/useOnline'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { getLocalCashMovements, getOpenLocalSession } from '../../lib/localCash'
import { bs as formatBs, money, number } from '../../lib/currency'
import {
  dayKey,
  formatDate,
  formatDateShort,
  formatTime,
  lastNDays,
  rangeToTimestamps,
  todayISO,
} from '../../lib/dates'

function saleCogs(items = []) {
  return items.reduce(
    (sum, item) =>
      sum + (Number(item.quantity) || 0) * (Number(item.unit_cost_usd) || 0),
    0,
  )
}

export default function AdminDashboard() {
  const { push } = useToast()
  const online = useOnline()
  const catalog = useCatalog()
  const [data, setData] = useState({
    revenue: 0,
    cogs: 0,
    tickets: 0,
    expenses: 0,
    pendingRevenue: 0,
    pendingCogs: 0,
    pendingCount: 0,
    cashExpectedUsd: 0,
    cashExpectedBs: 0,
    capitalNet: 0,
    lowStock: [],
    recent: [],
    chart: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const today = todayISO()
      const { from, to } = rangeToTimestamps(today, today)
      const week = lastNDays(7)
      const weekRange = rangeToTimestamps(week.from, week.to)

      const [salesRes, expensesRes, weekRes, ingredientsRes, capitalRes, pendingSales, session] =
        await Promise.all([
          supabase
            .from('sales')
            .select('id, order_number, total_usd, total_bs, status, created_at, sale_items(quantity, unit_cost_usd)')
            .gte('created_at', from)
            .lte('created_at', to)
            .eq('status', 'completed')
            .order('created_at', { ascending: false }),
          supabase.from('expenses').select('amount_usd').eq('expense_date', today),
          supabase
            .from('sales')
            .select('id, total_usd, created_at')
            .gte('created_at', weekRange.from)
            .lte('created_at', weekRange.to)
            .eq('status', 'completed'),
          supabase
            .from('ingredients')
            .select('id, name, stock_base, min_stock_base, base_unit, track_stock, avg_cost_usd')
            .order('name'),
          supabase.from('capital_movements').select('movement_type, amount_usd'),
          db.pending_sales.where('sync_status').anyOf('pending', 'error').toArray(),
          getOpenLocalSession(),
        ])

      if (salesRes.error) throw salesRes.error
      if (expensesRes.error) throw expensesRes.error
      if (weekRes.error) throw weekRes.error
      if (ingredientsRes.error) throw ingredientsRes.error
      if (capitalRes.error) throw capitalRes.error

      const sales = salesRes.data || []
      const revenue = sales.reduce((sum, sale) => sum + (Number(sale.total_usd) || 0), 0)
      const cogs = sales.reduce(
        (sum, sale) => sum + saleCogs(sale.sale_items || []),
        0,
      )
      const expenses = (expensesRes.data || []).reduce(
        (sum, row) => sum + (Number(row.amount_usd) || 0),
        0,
      )

      const pendingToday = pendingSales.filter(
        (sale) => dayKey(sale.payload?.created_at || sale.created_at) === today,
      )
      const pendingRevenue = pendingToday.reduce(
        (sum, sale) =>
          sum +
          (sale.payload?.items || []).reduce(
            (s, item) =>
              s +
              (Number(item.quantity) || 0) * (Number(item.unit_price_usd) || 0),
            0,
          ),
        0,
      )
      const pendingCogs = pendingToday.reduce(
        (sum, sale) =>
          sum +
          (sale.payload?.items || []).reduce(
            (s, item) =>
              s +
              (Number(item.quantity) || 0) * (Number(item.unit_cost_usd) || 0),
            0,
          ),
        0,
      )

      let cashExpectedUsd = 0
      let cashExpectedBs = 0
      if (session) {
        const movements = await getLocalCashMovements(session.id)
        cashExpectedUsd =
          (Number(session.opening_usd) || 0) +
          movements
            .filter((m) => m.affects_cash && m.currency === 'USD')
            .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
        cashExpectedBs =
          (Number(session.opening_bs) || 0) +
          movements
            .filter((m) => m.affects_cash && m.currency === 'BS')
            .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
      }

      const capitalNet = (capitalRes.data || []).reduce(
        (sum, row) =>
          sum +
          (row.movement_type === 'aporte'
            ? Number(row.amount_usd) || 0
            : -(Number(row.amount_usd) || 0)),
        0,
      )

      const lowStock = (ingredientsRes.data || [])
        .filter(
          (ing) =>
            ing.track_stock &&
            Number(ing.min_stock_base) > 0 &&
            Number(ing.stock_base) <= Number(ing.min_stock_base),
        )
        .sort((a, b) => Number(a.stock_base) - Number(b.stock_base))
        .slice(0, 6)

      const chartMap = new Map()
      for (let i = 0; i < 7; i += 1) {
        const d = new Date()
        d.setDate(d.getDate() - (6 - i))
        const key = dayKey(d.toISOString())
        chartMap.set(key, { key, label: formatDateShort(key), revenue: 0 })
      }
      for (const sale of weekRes.data || []) {
        const key = dayKey(sale.created_at)
        if (chartMap.has(key)) {
          chartMap.get(key).revenue += Number(sale.total_usd) || 0
        }
      }
      for (const sale of pendingSales) {
        const key = dayKey(sale.payload?.created_at || sale.created_at)
        if (chartMap.has(key)) {
          chartMap.get(key).revenue += (sale.payload?.items || []).reduce(
            (sum, item) =>
              sum +
              (Number(item.quantity) || 0) * (Number(item.unit_price_usd) || 0),
            0,
          )
        }
      }

      const recentServer = sales.slice(0, 5).map((sale) => ({
        id: sale.id,
        order_number: sale.order_number,
        total_usd: Number(sale.total_usd) || 0,
        created_at: sale.created_at,
        pending: false,
      }))
      const recentPending = pendingSales
        .slice()
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 5)
        .map((sale) => ({
          id: sale.client_id,
          order_number: sale.payload?.order_number || sale.order_number,
          total_usd: Number(sale.total_usd) || 0,
          created_at: sale.payload?.created_at || sale.created_at,
          pending: true,
        }))
      const recent = [...recentServer, ...recentPending]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 6)

      setData({
        revenue,
        cogs,
        tickets: sales.length,
        expenses,
        pendingRevenue,
        pendingCogs,
        pendingCount: pendingSales.length,
        cashExpectedUsd,
        cashExpectedBs,
        capitalNet,
        lowStock,
        recent,
        chart: [...chartMap.values()],
      })
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudo cargar el dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const gross = data.revenue + data.pendingRevenue - data.cogs - data.pendingCogs
  const net = gross - data.expenses
  const margin = data.revenue > 0 ? (net / data.revenue) * 100 : 0

  const quickActions = [
    { to: '/admin/vender', label: 'Vender', icon: ShoppingCart, primary: true },
    { to: '/admin/compras', label: 'Compra', icon: Receipt },
    { to: '/admin/gastos', label: 'Gasto', icon: Wallet },
    { to: '/admin/inventario', label: 'Conteo', icon: Boxes },
  ]

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={`${formatDate(todayISO())} · El pulso de La Cartha`}
        icon={CalendarDays}
        actions={
          <>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
            </button>
            <Link to="/admin/vender" className="btn btn-primary">
              <ShoppingCart size={15} /> Vender
            </Link>
          </>
        }
      />

      {!online ? (
        <div className="alert alert-warn mb-3 flex items-center gap-2">
          <CloudOff size={15} /> Sin conexión: los datos del servidor pueden estar incompletos.
          Las ventas pendientes se muestran abajo.
        </div>
      ) : null}

      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      {loading ? (
        <Loading label="Cargando el día..." />
      ) : (
        <>
          <div className="stat-grid mb-3">
            <StatCard
              icon={TrendingUp}
              label="Ventas de hoy"
              value={money(data.revenue + data.pendingRevenue)}
              hint={`${data.tickets + data.pendingCount} ticket(s) · ${data.pendingCount} pendiente(s)`}
            />
            <StatCard
              icon={Receipt}
              label="Costo de ventas"
              value={money(data.cogs + data.pendingCogs)}
              hint="Costo de recetas y productos"
            />
            <StatCard
              icon={TrendingUp}
              label="Ganancia bruta"
              value={money(gross)}
              tone={gross >= 0 ? 'success' : 'danger'}
              hint="Ventas − costo de ventas"
            />
            <StatCard
              icon={Wallet}
              label="Gastos de hoy"
              value={money(data.expenses)}
              tone="danger"
              hint="Gastos operativos del día"
            />
            <StatCard
              icon={CheckCircle2}
              label="Ganancia neta"
              value={money(net)}
              tone={net >= 0 ? 'success' : 'danger'}
              hint={`Margen ${margin.toFixed(0)}%`}
            />
            <StatCard
              icon={Wallet}
              label="Efectivo esperado"
              value={money(data.cashExpectedUsd)}
              hint={`Bs ${number(data.cashExpectedBs)} en caja`}
            />
            <StatCard
              icon={Boxes}
              label="Stock bajo"
              value={data.lowStock.length}
              tone={data.lowStock.length > 0 ? 'warning' : 'success'}
              hint="Ingredientes por debajo del mínimo"
            />
            <StatCard
              icon={Wallet}
              label="Capital neto"
              value={money(data.capitalNet)}
              tone={data.capitalNet >= 0 ? 'success' : 'danger'}
              hint="Aportes − retiros"
            />
          </div>

          <div className="grid-2 mb-3">
            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="card-title" style={{ margin: 0 }}>
                  <BarChart3 size={16} /> Ventas últimos 7 días
                </p>
                <Link to="/admin/reportes" className="btn btn-sm">
                  Reportes <ArrowRight size={13} />
                </Link>
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.chart} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value) => money(value)} />
                    <Bar dataKey="revenue" name="Ventas" fill="#E85D04" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <p className="card-title">
                <Plus size={16} /> Acciones rápidas
              </p>
              <div className="grid-2">
                {quickActions.map((action) => {
                  const Icon = action.icon
                  return (
                    <Link
                      key={action.to}
                      to={action.to}
                      className={`btn ${action.primary ? 'btn-primary' : ''}`}
                      style={{ justifyContent: 'flex-start', padding: '14px' }}
                    >
                      <Icon size={17} /> {action.label}
                    </Link>
                  )
                })}
              </div>
              <div className="divider" />
              <p className="small muted">
                {catalog.ready
                  ? 'Menú descargado y listo para vender.'
                  : 'El menú aún no está descargado. Entra a Vender para sincronizarlo.'}
              </p>
              {data.pendingCount > 0 ? (
                <p className="small mt-1" style={{ color: 'var(--orange)' }}>
                  Tienes {data.pendingCount} venta(s) pendiente(s) de sincronizar.
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="card-title" style={{ margin: 0 }}>
                  <Receipt size={16} /> Últimas ventas
                </p>
                <Link to="/admin/ventas" className="btn btn-sm">
                  Ver todas <ArrowRight size={13} />
                </Link>
              </div>
              {data.recent.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Todavía no hay ventas hoy"
                  text="Cuando hagas la primera venta, aparecerá aquí."
                  action={
                    <Link to="/admin/vender" className="btn btn-primary">
                      <ShoppingCart size={15} /> Vender ahora
                    </Link>
                  }
                />
              ) : (
                <div>
                  {data.recent.map((sale) => (
                    <div
                      className="flex items-center justify-between gap-2"
                      key={sale.id}
                      style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}
                    >
                      <div>
                        <p className="small" style={{ fontWeight: 700 }}>
                          {sale.order_number || 'Venta'}
                        </p>
                        <p className="tiny muted">{formatTime(sale.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {sale.pending ? <span className="badge badge-yellow">Pendiente</span> : null}
                        <strong className="small">{money(sale.total_usd)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="card-title" style={{ margin: 0 }}>
                  <AlertTriangle size={16} /> Stock bajo
                </p>
                <Link to="/admin/inventario" className="btn btn-sm">
                  Inventario <ArrowRight size={13} />
                </Link>
              </div>
              {data.lowStock.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Todo en orden"
                  text="No hay ingredientes por debajo del mínimo."
                />
              ) : (
                <div>
                  {data.lowStock.map((ing) => (
                    <div
                      className="flex items-center justify-between gap-2"
                      key={ing.id}
                      style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}
                    >
                      <div>
                        <p className="small" style={{ fontWeight: 700 }}>{ing.name}</p>
                        <p className="tiny muted">
                          Mínimo {number(ing.min_stock_base)} {ing.base_unit}
                        </p>
                      </div>
                      <span className="badge badge-red">
                        {number(ing.stock_base)} {ing.base_unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card mt-3">
            <p className="card-title">
              <ListChecks size={16} /> Para dejar la app lista
            </p>
            <div className="flex gap-2 wrap">
              <Link to="/admin/primeros-pasos" className="btn">
                <ListChecks size={15} /> Primeros pasos
              </Link>
              <Link to="/admin/materia-prima" className="btn">
                <Boxes size={15} /> Precios de materia prima
              </Link>
              <Link to="/admin/banderilla" className="btn">
                <Plus size={15} /> Porciones de la banderilla
              </Link>
              <Link to="/admin/ajustes" className="btn">
                <Wallet size={15} /> Tasas y menú público
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  )
}
