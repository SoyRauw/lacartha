import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  History,
  RefreshCw,
  Save,
  Scale,
  Search,
} from 'lucide-react'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { refreshCatalog } from '../../lib/catalog'
import { BASE_UNIT_LABELS } from '../../lib/constants'
import { money, moneyPrecise, number, parseNumber } from '../../lib/currency'
import { formatDate, todayISO } from '../../lib/dates'

export default function AdminInventory() {
  const { push } = useToast()
  const [ingredients, setIngredients] = useState([])
  const [counts, setCounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('todos')
  const [countOpen, setCountOpen] = useState(false)
  const [countDate, setCountDate] = useState(todayISO())
  const [countNotes, setCountNotes] = useState('')
  const [countItems, setCountItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ingredientsRes, countsRes] = await Promise.all([
        supabase.from('ingredients').select('*').order('name'),
        supabase
          .from('inventory_counts')
          .select('*, inventory_count_items (id, ingredient_id, theoretical_qty_base, counted_qty_base, difference_qty_base, difference_usd, ingredients(name, base_unit))')
          .order('count_date', { ascending: false })
          .limit(12),
      ])
      if (ingredientsRes.error) throw ingredientsRes.error
      if (countsRes.error) throw countsRes.error
      setIngredients(ingredientsRes.data || [])
      setCounts(countsRes.data || [])
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudo cargar el inventario')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const tracked = useMemo(
    () => ingredients.filter((ing) => ing.active !== false && ing.track_stock),
    [ingredients],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tracked.filter((ing) => {
      if (filter === 'bajo') {
        if (!(Number(ing.min_stock_base) > 0 && Number(ing.stock_base) <= Number(ing.min_stock_base))) {
          return false
        }
      }
      if (!q) return true
      return (
        (ing.name || '').toLowerCase().includes(q) ||
        (ing.category || '').toLowerCase().includes(q)
      )
    })
  }, [tracked, search, filter])

  const stats = useMemo(() => {
    const low = tracked.filter(
      (ing) =>
        Number(ing.min_stock_base) > 0 &&
        Number(ing.stock_base) <= Number(ing.min_stock_base),
    ).length
    const value = tracked.reduce(
      (sum, ing) =>
        sum + (Number(ing.stock_base) || 0) * (Number(ing.avg_cost_usd) || 0),
      0,
    )
    const lastCount = counts.find((c) => c.status === 'completed')
    return { total: tracked.length, low, value, lastCount }
  }, [tracked, counts])

  const openCount = () => {
    setCountDate(todayISO())
    setCountNotes('')
    setCountItems(
      tracked.map((ing) => ({
        ingredient_id: ing.id,
        name: ing.name,
        base_unit: ing.base_unit,
        theoretical: Number(ing.stock_base) || 0,
        counted: String(ing.stock_base ?? 0),
        unit_cost: Number(ing.avg_cost_usd) || 0,
      })),
    )
    setCountOpen(true)
  }

  const setCounted = (index, value) => {
    setCountItems((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], counted: value }
      return next
    })
  }

  const countPreview = useMemo(() => {
    return countItems.reduce(
      (acc, item) => {
        const diff = (parseNumber(item.counted) || 0) - (Number(item.theoretical) || 0)
        const value = diff * (Number(item.unit_cost) || 0)
        acc.diffQty += diff
        acc.diffValue += value
        if (diff !== 0) acc.changed += 1
        return acc
      },
      { diffQty: 0, diffValue: 0, changed: 0 },
    )
  }, [countItems])

  const saveCount = async () => {
    if (countItems.length === 0) {
      push('No hay ingredientes para contar', 'error')
      return
    }
    setSaving(true)
    try {
      const { data: countRow, error: countError } = await supabase
        .from('inventory_counts')
        .insert({
          count_date: countDate,
          status: 'draft',
          notes: countNotes.trim() || null,
        })
        .select()
        .single()
      if (countError) throw countError

      const rows = countItems.map((item) => {
        const diff =
          (parseNumber(item.counted) || 0) - (Number(item.theoretical) || 0)
        return {
          count_id: countRow.id,
          ingredient_id: item.ingredient_id,
          theoretical_qty_base: Number(item.theoretical) || 0,
          counted_qty_base: parseNumber(item.counted),
          difference_qty_base: diff,
          unit_cost_usd: Number(item.unit_cost) || 0,
          difference_usd: diff * (Number(item.unit_cost) || 0),
          reason: diff < 0 ? 'merma' : 'otro',
        }
      })
      const { error: itemsError } = await supabase
        .from('inventory_count_items')
        .insert(rows)
      if (itemsError) throw itemsError

      const { error: rpcError } = await supabase.rpc('complete_inventory_count', {
        p_count_id: countRow.id,
      })
      if (rpcError) throw rpcError

      await refreshCatalog().catch(() => {})
      await load()
      setCountOpen(false)
      push('Conteo completo; stock y merma actualizados', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar el conteo', 'error')
    } finally {
      setSaving(false)
    }
  }

  const showDetail = (count) => {
    setDetail(count)
  }

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle="Stock teórico diario y conteo semanal para corregir diferencias."
        icon={Boxes}
        actions={
          <>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
            </button>
            <button type="button" className="btn btn-primary" onClick={openCount}>
              <ClipboardList size={15} /> Nuevo conteo
            </button>
          </>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={Boxes} label="Ingredientes" value={stats.total} hint="Con control de stock" />
        <StatCard
          icon={AlertTriangle}
          label="Stock bajo"
          value={stats.low}
          tone={stats.low > 0 ? 'danger' : 'success'}
          hint="Bajo el mínimo"
        />
        <StatCard icon={Scale} label="Valor del inventario" value={money(stats.value)} hint="Stock × costo promedio USD" />
        <StatCard
          icon={History}
          label="Último conteo"
          value={stats.lastCount ? formatDate(stats.lastCount.count_date) : '—'}
          hint="Verificación física"
        />
      </div>

      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      <div className="card mb-3">
        <div className="flex items-center gap-2 wrap mb-3">
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search
              size={15}
              style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Buscar ingrediente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="bajo">Solo stock bajo</option>
          </select>
        </div>

        {loading ? (
          <Loading label="Cargando inventario..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No hay ingredientes con stock"
            text="Carga materia prima y activa el control de stock."
          />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th className="num">Stock teórico</th>
                  <th className="num">Mínimo</th>
                  <th className="num">Costo promedio</th>
                  <th className="num">Valor</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ing) => {
                  const low =
                    Number(ing.min_stock_base) > 0 &&
                    Number(ing.stock_base) <= Number(ing.min_stock_base)
                  const value = (Number(ing.stock_base) || 0) * (Number(ing.avg_cost_usd) || 0)
                  return (
                    <tr key={ing.id}>
                      <td>
                        <div className="row-title">{ing.name}</div>
                        <div className="row-meta">
                          {ing.category || 'Sin categoría'} · 1 {ing.purchase_unit} ={' '}
                          {number(ing.conversion_factor)} {BASE_UNIT_LABELS[ing.base_unit]}
                        </div>
                      </td>
                      <td className="num">
                        <strong>
                          {number(ing.stock_base)} {BASE_UNIT_LABELS[ing.base_unit]}
                        </strong>
                        {ing.base_unit === 'ml' && Number(ing.conversion_factor) > 1 ? (
                          <div className="row-meta">
                            ≈ {number(Number(ing.stock_base) / Number(ing.conversion_factor))} {ing.purchase_unit}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">
                        {Number(ing.min_stock_base) > 0
                          ? `${number(ing.min_stock_base)} ${BASE_UNIT_LABELS[ing.base_unit]}`
                          : '—'}
                      </td>
                      <td className="num">
                        {moneyPrecise(ing.avg_cost_usd, 4)}
                        <div className="row-meta">por {BASE_UNIT_LABELS[ing.base_unit]}</div>
                      </td>
                      <td className="num">{money(value)}</td>
                      <td>
                        {low ? (
                          <span className="badge badge-red">Stock bajo</span>
                        ) : (
                          <span className="badge badge-green">OK</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">
          <History size={16} /> Historial de conteos
        </p>
        {counts.length === 0 ? (
          <p className="muted small">No hay conteos registrados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th className="num">Ítems</th>
                  <th className="num">Diferencia USD</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {counts.map((count) => {
                  const diff = (count.inventory_count_items || []).reduce(
                    (sum, item) => sum + (Number(item.difference_usd) || 0),
                    0,
                  )
                  return (
                    <tr key={count.id}>
                      <td>{formatDate(count.count_date)}</td>
                      <td>
                        <span className={`badge ${count.status === 'completed' ? 'badge-green' : 'badge-yellow'}`}>
                          {count.status === 'completed' ? 'Completado' : 'Borrador'}
                        </span>
                      </td>
                      <td className="num">{count.inventory_count_items?.length || 0}</td>
                      <td className={`num ${diff < 0 ? 'negative' : 'positive'}`}>{money(diff)}</td>
                      <td>
                        <button type="button" className="btn btn-sm" onClick={() => showDetail(count)}>
                          Ver
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={countOpen}
        onClose={() => setCountOpen(false)}
        title="Conteo de inventario"
        icon={ClipboardList}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCountOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={saveCount} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar conteo'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Fecha del conteo</label>
            <input
              className="input"
              type="date"
              value={countDate}
              onChange={(e) => setCountDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Notas</label>
            <input
              className="input"
              value={countNotes}
              onChange={(e) => setCountNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="alert alert-warn mt-2">
          Escribe cuánto hay realmente de cada ingrediente. El sistema ajusta el stock y
          registra la diferencia como merma al costo promedio.
        </div>

        <div className="table-wrap mt-2" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th className="num">Teórico</th>
                <th className="num">Contado</th>
                <th className="num">Diferencia</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {countItems.map((item, index) => {
                const diff = (parseNumber(item.counted) || 0) - (Number(item.theoretical) || 0)
                const value = diff * (Number(item.unit_cost) || 0)
                return (
                  <tr key={item.ingredient_id}>
                    <td>
                      <div className="row-title">{item.name}</div>
                      <div className="row-meta">{BASE_UNIT_LABELS[item.base_unit]}</div>
                    </td>
                    <td className="num">{number(item.theoretical)}</td>
                    <td style={{ width: 130 }}>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.counted}
                        onChange={(e) => setCounted(index, e.target.value)}
                      />
                    </td>
                    <td className={`num ${diff < 0 ? 'negative' : diff > 0 ? 'positive' : ''}`}>
                      {number(diff)}
                    </td>
                    <td className={`num ${value < 0 ? 'negative' : value > 0 ? 'positive' : ''}`}>
                      {money(value)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between gap-2 mt-2">
          <span className="small muted">Diferencia neta</span>
          <strong className={countPreview.diffValue < 0 ? 'negative' : 'positive'}>
            {money(countPreview.diffValue)} · {countPreview.changed} ítem(s)
          </strong>
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Conteo ${formatDate(detail.count_date)}` : 'Conteo'}
        icon={History}
        wide
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setDetail(null)}>
            Cerrar
          </button>
        }
      >
        {detail ? (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 540 }}>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th className="num">Teórico</th>
                  <th className="num">Contado</th>
                  <th className="num">Diferencia</th>
                  <th className="num">USD</th>
                </tr>
              </thead>
              <tbody>
                {(detail.inventory_count_items || []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.ingredients?.name || 'Ingrediente'}</td>
                    <td className="num">{number(item.theoretical_qty_base)}</td>
                    <td className="num">{number(item.counted_qty_base)}</td>
                    <td className={`num ${Number(item.difference_qty_base) < 0 ? 'negative' : 'positive'}`}>
                      {number(item.difference_qty_base)}
                    </td>
                    <td className={`num ${Number(item.difference_usd) < 0 ? 'negative' : 'positive'}`}>
                      {money(item.difference_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
