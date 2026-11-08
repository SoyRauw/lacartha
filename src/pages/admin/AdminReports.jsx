import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Boxes,
  Calculator,
  Download,
  FileSpreadsheet,
  FileText,
  Percent,
  Receipt,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import {
  EmptyState,
  Loading,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { useOnline } from '../../hooks/useOnline'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { money, number, percent } from '../../lib/currency'
import {
  dayKey,
  daysInRange,
  formatDate,
  formatDateShort,
  pad2,
  presetRange,
  rangeToTimestamps,
  toISODateLocal,
  toLocalDate,
} from '../../lib/dates'

const PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'last-month', label: 'Mes pasado' },
  { id: '3m', label: '3 meses' },
  { id: 'year', label: 'Año' },
]

const COLORS = ['#E85D04', '#FFC300', '#2D6A4F', '#6B2A00', '#C1121F', '#F48C06', '#806555']

function normalizeSale(sale) {
  return {
    ...sale,
    items: (sale.sale_items || sale.items || []).map((item) => ({
      ...item,
      options: item.sale_item_options || item.options || [],
    })),
    payments: sale.sale_payments || sale.payments || [],
  }
}

function monthKeyFromDate(value) {
  return String(value || '').slice(0, 7)
}

function rangeKeys(fromISO, toISO, monthly) {
  const keys = []
  const start = toLocalDate(fromISO)
  const end = toLocalDate(toISO)
  if (!start || !end) return keys
  const cursor = new Date(start)
  if (monthly) cursor.setDate(1)
  while (cursor <= end) {
    const key = monthly
      ? `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`
      : toISODateLocal(cursor)
    keys.push(key)
    if (monthly) cursor.setMonth(cursor.getMonth() + 1)
    else cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

function keyLabel(key, monthly) {
  if (monthly) {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('es-VE', {
      month: 'short',
      year: '2-digit',
    })
  }
  return formatDateShort(key)
}

export default function AdminReports() {
  const { push } = useToast()
  const online = useOnline()
  const [range, setRange] = useState(() => presetRange('month'))
  const [activePreset, setActivePreset] = useState('month')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState({
    revenue: 0,
    cogs: 0,
    expenses: 0,
    tickets: 0,
    series: [],
    topProducts: [],
    topOptions: [],
    payments: [],
    inventoryValue: 0,
    lowStock: 0,
    banderillaUnits: 0,
    totalUnits: 0,
    salesRows: [],
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { from, to } = rangeToTimestamps(range.from, range.to)
      let serverSales = []
      let expenses = []
      let ingredients = []
      let products = []

      if (navigator.onLine) {
        const [salesRes, expensesRes, ingredientsRes, productsRes] = await Promise.all([
          supabase
            .from('sales')
            .select(`
              id, order_number, status, total_usd, total_bs, created_at,
              sale_items (product_id, product_name, quantity, unit_price_usd, unit_cost_usd, line_total_usd, sale_item_options (option_name, group_name)),
              sale_payments (method_name, amount_usd, currency, amount)
            `)
            .gte('created_at', from)
            .lte('created_at', to)
            .eq('status', 'completed'),
          supabase
            .from('expenses')
            .select('id, expense_date, category, description, amount_usd')
            .gte('expense_date', range.from)
            .lte('expense_date', range.to),
          supabase
            .from('ingredients')
            .select('id, name, stock_base, min_stock_base, avg_cost_usd, track_stock'),
          supabase.from('products').select('id, name, category'),
        ])
        if (salesRes.error) throw salesRes.error
        if (expensesRes.error) throw expensesRes.error
        if (ingredientsRes.error) throw ingredientsRes.error
        if (productsRes.error) throw productsRes.error
        serverSales = salesRes.data || []
        expenses = expensesRes.data || []
        ingredients = ingredientsRes.data || []
        products = productsRes.data || []
      }

      const pendingRows = await db.pending_sales
        .where('sync_status')
        .anyOf('pending', 'error')
        .toArray()
      const pendingSales = pendingRows
        .filter((row) => {
          const iso = row.payload?.created_at || row.created_at
          return iso >= from && iso <= to
        })
        .map((row) => normalizeSale({ ...row.payload, created_at: row.payload?.created_at || row.created_at }))

      const sales = [...(serverSales || []).map(normalizeSale), ...pendingSales]
      const productsMap = new Map((products || []).map((p) => [p.id, p]))

      let revenue = 0
      let cogs = 0
      let totalUnits = 0
      let banderillaUnits = 0
      const productMap = new Map()
      const optionMap = new Map()
      const paymentMap = new Map()

      for (const sale of sales) {
        revenue += Number(sale.total_usd) || 0
        for (const item of sale.items || []) {
          const qty = Number(item.quantity) || 0
          const lineRevenue = Number(item.line_total_usd) || 0
          const lineCost = qty * (Number(item.unit_cost_usd) || 0)
          cogs += lineCost
          totalUnits += qty
          if (productsMap.get(item.product_id)?.category === 'banderilla') {
            banderillaUnits += qty
          }

          const key = item.product_id || item.product_name
          if (!productMap.has(key)) {
            productMap.set(key, {
              name: item.product_name || 'Producto',
              category: productsMap.get(item.product_id)?.category || 'otro',
              units: 0,
              revenue: 0,
              cost: 0,
              profit: 0,
            })
          }
          const row = productMap.get(key)
          row.units += qty
          row.revenue += lineRevenue
          row.cost += lineCost
          row.profit = row.revenue - row.cost

          for (const option of item.options || []) {
            const name = option.option_name || option.name
            if (!name) continue
            const optionKey = `${option.group_name || 'Opción'}|${name}`
            if (!optionMap.has(optionKey)) {
              optionMap.set(optionKey, { group: option.group_name || 'Opción', name, count: 0 })
            }
            optionMap.get(optionKey).count += qty
          }
        }
        for (const payment of sale.payments || []) {
          const name = payment.method_name || 'Pago'
          if (!paymentMap.has(name)) paymentMap.set(name, { name, amount: 0 })
          paymentMap.get(name).amount += Number(payment.amount_usd) || 0
        }
      }

      const expensesTotal = (expenses || []).reduce(
        (sum, expense) => sum + (Number(expense.amount_usd) || 0),
        0,
      )
      const inventoryValue = (ingredients || []).reduce(
        (sum, ing) =>
          sum + (Number(ing.stock_base) || 0) * (Number(ing.avg_cost_usd) || 0),
        0,
      )
      const lowStock = (ingredients || []).filter(
        (ing) =>
          ing.track_stock &&
          Number(ing.min_stock_base) > 0 &&
          Number(ing.stock_base) <= Number(ing.min_stock_base),
      ).length

      const days = daysInRange(range.from, range.to)
      const monthly = days > 62
      const seriesMap = new Map()
      for (const key of rangeKeys(range.from, range.to, monthly)) {
        seriesMap.set(key, {
          key,
          label: keyLabel(key, monthly),
          revenue: 0,
          cogs: 0,
          expenses: 0,
          net: 0,
        })
      }

      for (const sale of sales) {
        const key = monthly ? monthKeyFromDate(sale.created_at) : dayKey(sale.created_at)
        if (!seriesMap.has(key)) continue
        const row = seriesMap.get(key)
        row.revenue += Number(sale.total_usd) || 0
        for (const item of sale.items || []) {
          row.cogs +=
            (Number(item.quantity) || 0) * (Number(item.unit_cost_usd) || 0)
        }
      }
      for (const expense of expenses || []) {
        const key = monthly
          ? monthKeyFromDate(expense.expense_date)
          : String(expense.expense_date || '').slice(0, 10)
        if (!seriesMap.has(key)) continue
        seriesMap.get(key).expenses += Number(expense.amount_usd) || 0
      }
      const series = [...seriesMap.values()].map((row) => ({
        ...row,
        net: row.revenue - row.cogs - row.expenses,
      }))

      const topProducts = [...productMap.values()]
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 10)
      const topOptions = [...optionMap.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
      const payments = [...paymentMap.values()].sort((a, b) => b.amount - a.amount)

      const salesRows = sales.flatMap((sale) =>
        (sale.items || []).map((item) => ({
          Pedido: sale.order_number || '',
          Fecha: sale.created_at,
          Producto: item.product_name,
          Cantidad: Number(item.quantity) || 0,
          Precio: Number(item.unit_price_usd) || 0,
          Total: Number(item.line_total_usd) || 0,
          Costo: (Number(item.quantity) || 0) * (Number(item.unit_cost_usd) || 0),
        })),
      )

      setData({
        revenue,
        cogs,
        expenses: expensesTotal,
        tickets: sales.length,
        series,
        topProducts,
        topOptions,
        payments,
        inventoryValue,
        lowStock,
        banderillaUnits,
        totalUnits,
        salesRows,
      })
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudo generar el reporte')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  const gross = data.revenue - data.cogs
  const net = gross - data.expenses
  const margin = data.revenue > 0 ? (net / data.revenue) * 100 : 0
  const avgTicket = data.tickets > 0 ? data.revenue / data.tickets : 0
  const days = daysInRange(range.from, range.to)
  const avgMarginPerUnit = data.totalUnits > 0 ? gross / data.totalUnits : 0
  const expensesPerDay = data.expenses / Math.max(1, days)
  const breakEvenUnits = avgMarginPerUnit > 0 ? expensesPerDay / avgMarginPerUnit : 0

  const setPreset = (preset) => {
    setActivePreset(preset)
    setRange(presetRange(preset))
  }

  const exportPdf = () => {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      doc.setFillColor(74, 28, 0)
      doc.rect(0, 0, 210, 30, 'F')
      doc.setTextColor(255, 246, 229)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.text('La Cartha', 14, 15)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text('Reporte de ventas y ganancias', 14, 22)

      doc.setTextColor(43, 27, 18)
      doc.setFontSize(10)
      doc.text(`Período: ${formatDate(range.from)} → ${formatDate(range.to)}`, 14, 40)

      autoTable(doc, {
        startY: 46,
        head: [['Métrica', 'Valor']],
        body: [
          ['Ventas', money(data.revenue)],
          ['Costo de ventas', money(data.cogs)],
          ['Ganancia bruta', money(gross)],
          ['Gastos', money(data.expenses)],
          ['Ganancia neta', money(net)],
          ['Margen', percent(margin)],
          ['Tickets', String(data.tickets)],
          ['Ticket promedio', money(avgTicket)],
          ['Inventario actual', money(data.inventoryValue)],
          ['Punto de equilibrio (unidades/día)', number(breakEvenUnits)],
        ],
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [232, 93, 4] },
      })

      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY || 46) + 10,
        head: [['Producto', 'Unidades', 'Ventas', 'Costo', 'Ganancia']],
        body: data.topProducts.map((p) => [
          p.name,
          number(p.units),
          money(p.revenue),
          money(p.cost),
          money(p.profit),
        ]),
        theme: 'grid',
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [74, 28, 0] },
      })

      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY || 46) + 10,
        head: [['Método de pago', 'Monto USD']],
        body: data.payments.map((p) => [p.name, money(p.amount)]),
        theme: 'grid',
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [45, 106, 79] },
      })

      doc.save(`LaCartha-reporte-${range.from}-${range.to}.pdf`)
      push('PDF generado', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo generar el PDF', 'error')
    }
  }

  const exportExcel = () => {
    try {
      const wb = XLSX.utils.book_new()
      const summary = [
        {
          Métrica: 'Ventas',
          Valor: data.revenue,
        },
        { Métrica: 'Costo de ventas', Valor: data.cogs },
        { Métrica: 'Ganancia bruta', Valor: gross },
        { Métrica: 'Gastos', Valor: data.expenses },
        { Métrica: 'Ganancia neta', Valor: net },
        { Métrica: 'Margen %', Valor: margin },
        { Métrica: 'Tickets', Valor: data.tickets },
        { Métrica: 'Ticket promedio', Valor: avgTicket },
        { Métrica: 'Inventario actual', Valor: data.inventoryValue },
        { Métrica: 'Punto de equilibrio (unidades/día)', Valor: breakEvenUnits },
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen')
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(data.topProducts),
        'Productos',
      )
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(data.salesRows),
        'Ventas',
      )
      XLSX.writeFile(wb, `LaCartha-reporte-${range.from}-${range.to}.xlsx`)
      push('Excel generado', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo generar el Excel', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Ventas, ganancia, márgenes, inventario y punto de equilibrio."
        icon={BarChart3}
        actions={
          <>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
            </button>
            <button type="button" className="btn" onClick={exportPdf}>
              <FileText size={15} /> PDF
            </button>
            <button type="button" className="btn" onClick={exportExcel}>
              <FileSpreadsheet size={15} /> Excel
            </button>
          </>
        }
      />

      <div className="flex items-center gap-2 wrap mb-3">
        <div className="tabs" style={{ margin: 0 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`tab ${activePreset === p.id ? 'active' : ''}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          type="date"
          value={range.from}
          onChange={(e) => {
            setActivePreset('custom')
            setRange((prev) => ({ ...prev, from: e.target.value }))
          }}
          style={{ width: 150 }}
        />
        <span className="muted small">→</span>
        <input
          className="input"
          type="date"
          value={range.to}
          onChange={(e) => {
            setActivePreset('custom')
            setRange((prev) => ({ ...prev, to: e.target.value }))
          }}
          style={{ width: 150 }}
        />
        {!online ? <span className="badge badge-red">Sin conexión: solo ventas pendientes</span> : null}
      </div>

      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      {loading ? (
        <Loading label="Calculando reporte..." />
      ) : (
        <>
          <div className="stat-grid mb-3">
            <StatCard icon={TrendingUp} label="Ventas" value={money(data.revenue)} hint={`${data.tickets} ticket(s)`} />
            <StatCard icon={Receipt} label="Costo de ventas" value={money(data.cogs)} hint="COGS del período" />
            <StatCard icon={TrendingUp} label="Ganancia bruta" value={money(gross)} tone={gross >= 0 ? 'success' : 'danger'} hint="Ventas − costo" />
            <StatCard icon={Wallet} label="Gastos" value={money(data.expenses)} tone="danger" hint="Gastos del período" />
            <StatCard icon={Percent} label="Ganancia neta" value={money(net)} tone={net >= 0 ? 'success' : 'danger'} hint={`Margen ${margin.toFixed(1)}%`} />
            <StatCard icon={Calculator} label="Ticket promedio" value={money(avgTicket)} hint="Por venta" />
            <StatCard icon={Boxes} label="Inventario actual" value={money(data.inventoryValue)} hint={`${data.lowStock} ingrediente(s) bajo mínimo`} />
            <StatCard icon={Calculator} label="Punto de equilibrio" value={`${number(breakEvenUnits)} u/día`} hint="Para cubrir gastos" />
          </div>

          <div className="grid-2 mb-3">
            <div className="card">
              <p className="card-title">
                <BarChart3 size={16} /> Ventas, costo y ganancia
              </p>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.series} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value) => money(value)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue" name="Ventas" fill="#E85D04" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cogs" name="Costo" fill="#FFC300" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="Gastos" fill="#C1121F" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <p className="card-title">
                <TrendingUp size={16} /> Ganancia neta
              </p>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.series} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value) => money(value)} />
                    <Line type="monotone" dataKey="net" name="Ganancia neta" stroke="#2D6A4F" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid-2 mb-3">
            <div className="card">
              <p className="card-title">
                <TrendingUp size={16} /> Productos con más ganancia
              </p>
              {data.topProducts.length === 0 ? (
                <EmptyState icon={TrendingUp} title="Sin ventas en el período" text="Prueba con otro rango." />
              ) : (
                <div className="table-wrap">
                  <table className="table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="num">Unid.</th>
                        <th className="num">Ventas</th>
                        <th className="num">Costo</th>
                        <th className="num">Ganancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.map((product) => (
                        <tr key={product.name}>
                          <td>
                            <div className="row-title">{product.name}</div>
                            <div className="row-meta">{product.category}</div>
                          </td>
                          <td className="num">{number(product.units)}</td>
                          <td className="num">{money(product.revenue)}</td>
                          <td className="num">{money(product.cost)}</td>
                          <td className={`num ${product.profit >= 0 ? 'positive' : 'negative'}`}>
                            <strong>{money(product.profit)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <p className="card-title">
                <Wallet size={16} /> Cobros por método
              </p>
              {data.payments.length === 0 ? (
                <EmptyState icon={Wallet} title="Sin cobros" text="No hay pagos en el período." />
              ) : (
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.payments}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={(entry) => entry.name}
                      >
                        {data.payments.map((entry, index) => (
                          <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => money(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <p className="card-title">
                <Calculator size={16} /> Top toppings y salsas
              </p>
              {data.topOptions.length === 0 ? (
                <p className="muted small">Sin opciones vendidas en el período.</p>
              ) : (
                <div className="flex wrap gap-2">
                  {data.topOptions.map((option) => (
                    <span className="chip" key={`${option.group}-${option.name}`}>
                      {option.name} · {number(option.count)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <p className="card-title">
                <Boxes size={16} /> Lectura rápida
              </p>
              <p className="small muted" style={{ lineHeight: 1.6 }}>
                Con {number(data.banderillaUnits)} banderilla(s) vendida(s) en {days} día(s), el
                margen bruto promedio por unidad es{' '}
                <strong>{money(avgMarginPerUnit)}</strong>. Para cubrir los gastos del período
                necesitas aproximadamente <strong>{number(breakEvenUnits)}</strong> unidad(es)
                por día.
              </p>
              <div className="divider" />
              <p className="small">
                Inventario actual: <strong>{money(data.inventoryValue)}</strong>
              </p>
              <p className="small">
                Ingredientes bajo mínimo: <strong>{data.lowStock}</strong>
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
