import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calculator,
  Eye,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  Wheat,
} from 'lucide-react'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import BillPicker from '../../components/BillPicker'
import { useCatalog } from '../../hooks/useCatalog'
import { supabase } from '../../lib/supabase'
import { refreshCatalog } from '../../lib/catalog'
import { BASE_UNIT_LABELS, RATE_SOURCES } from '../../lib/constants'
import {
  bs as formatBs,
  convertUsdToBs,
  money,
  number,
  parseNumber,
  roundBs,
} from '../../lib/currency'
import { formatDate, formatDateTime, todayISO } from '../../lib/dates'
import { getRateValue } from '../../lib/rates'
import { addLocalBillMovements, addLocalCashMovement, getLocalBillLedger, getOpenLocalSession } from '../../lib/localCash'
import { drawerFromLedger, emptyBillCounts, sumBills } from '../../lib/bills'
import { syncCashBillMovements } from '../../lib/sync'

function newRow() {
  return {
    key: crypto.randomUUID(),
    ingredient_id: '',
    quantity: '',
    total_usd: '',
  }
}

export default function AdminPurchases() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [purchases, setPurchases] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cashBills, setCashBills] = useState(emptyBillCounts())
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState({
    purchase_date: todayISO(),
    supplier_name: '',
    payment_method_id: '',
    rate_source: 'bcv_eur',
    rate_value: '',
    notes: '',
    items: [newRow()],
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [purchasesRes, ingredientsRes] = await Promise.all([
        supabase
          .from('purchases')
          .select(`
            *,
            purchase_items (id, ingredient_id, quantity, unit_cost_usd, total_usd, base_quantity, ingredients(name, base_unit, purchase_unit)),
            payment_methods (name, currency)
          `)
          .order('purchase_date', { ascending: false })
          .limit(60),
        supabase.from('ingredients').select('*').order('name'),
      ])
      if (purchasesRes.error) throw purchasesRes.error
      if (ingredientsRes.error) throw ingredientsRes.error
      setPurchases(purchasesRes.data || [])
      setIngredients(ingredientsRes.data || [])
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudieron cargar las compras')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!form.rate_value && catalog.rate) {
      const value = getRateValue(catalog.rate, 'bcv_eur') || getRateValue(catalog.rate, 'bcv_usd')
      if (value) setForm((prev) => ({ ...prev, rate_value: String(value) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.rate])

  const ingredientMap = useMemo(
    () => new Map(ingredients.map((ing) => [ing.id, ing])),
    [ingredients],
  )

  const paymentMethods = useMemo(
    () => (catalog.payment_methods || []).filter((m) => m.active !== false),
    [catalog.payment_methods],
  )

  const selectedMethod = useMemo(
    () => paymentMethods.find((m) => m.id === form.payment_method_id) || null,
    [paymentMethods, form.payment_method_id],
  )
  const cashBillsTotal = useMemo(() => sumBills(cashBills), [cashBills])
  const needsBills =
    selectedMethod?.affects_cash === true && selectedMethod?.currency === 'USD'

  const formTotal = useMemo(
    () =>
      form.items.reduce((sum, item) => sum + (parseNumber(item.total_usd) || 0), 0),
    [form.items],
  )
  const rateValue = parseNumber(form.rate_value) || 0
  const totalBs = rateValue > 0 ? roundBs(convertUsdToBs(formTotal, rateValue), 'up_010') : 0

  const stats = useMemo(() => {
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const monthPurchases = purchases.filter((p) => (p.purchase_date || '').startsWith(month))
    return {
      total: purchases.length,
      monthTotal: monthPurchases.reduce((sum, p) => sum + (Number(p.total_usd) || 0), 0),
      items: purchases.reduce((sum, p) => sum + (p.purchase_items?.length || 0), 0),
    }
  }, [purchases])

  const openNew = () => {
    const rate = catalog.rate
      ? getRateValue(catalog.rate, 'bcv_eur') || getRateValue(catalog.rate, 'bcv_usd')
      : 0
    setForm({
      purchase_date: todayISO(),
      supplier_name: '',
      payment_method_id: paymentMethods[0]?.id || '',
      rate_source: 'bcv_eur',
      rate_value: rate ? String(rate) : '',
      notes: '',
      items: [newRow()],
    })
    setCashBills(emptyBillCounts())
    setModalOpen(true)
  }

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const setRow = (index, key, value) => {
    setForm((prev) => {
      const next = [...prev.items]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, items: next }
    })
  }

  const addRow = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, newRow()] }))
  }

  const removeRow = (index) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }))
  }

  const handleSave = async () => {
    const cleanItems = form.items.filter(
      (item) => item.ingredient_id && parseNumber(item.quantity) > 0,
    )
    if (cleanItems.length === 0) {
      push('Agrega al menos un ingrediente con cantidad', 'error')
      return
    }
    if (formTotal < 0) {
      push('El total no puede ser negativo', 'error')
      return
    }
    if (needsBills && Math.abs(cashBillsTotal - formTotal) > 0.02) {
      push(
        'Los billetes suman ' +
          money(cashBillsTotal) +
          ' y la compra es ' +
          money(formTotal) +
          '. Ajusta los billetes o cambia el método.',
        'error',
      )
      return
    }

    let cashSession = null
    if (needsBills) {
      cashSession = await getOpenLocalSession()
      if (cashSession) {
        const ledger = await getLocalBillLedger(cashSession.id)
        const drawer = drawerFromLedger(ledger)
        for (const [denom, qty] of Object.entries(cashBills)) {
          if (Number(qty) > (drawer[denom] || 0)) {
            push(`No hay suficientes billetes de $${denom} en el cajón`, 'error')
            return
          }
        }
      }
    }
    setSaving(true)
    try {
      const payload = {
        client_id: crypto.randomUUID(),
        purchase_date: form.purchase_date,
        supplier_name: form.supplier_name.trim() || null,
        total_usd: formTotal,
        total_bs: totalBs,
        rate_source: form.rate_source,
        rate_value: rateValue || null,
        payment_method_id: form.payment_method_id || null,
        notes: form.notes.trim() || null,
        items: cleanItems.map((item) => ({
          ingredient_id: item.ingredient_id,
          quantity: parseNumber(item.quantity),
          total_usd: parseNumber(item.total_usd),
        })),
      }
      const { data, error: rpcError } = await supabase.rpc('register_purchase', { payload })
      if (rpcError) throw rpcError

      const method = paymentMethods.find((m) => m.id === form.payment_method_id)
      if (method?.affects_cash && formTotal > 0) {
        const session = cashSession || (await getOpenLocalSession())
        if (session) {
          const cashAmount = method.currency === 'BS' ? totalBs : formTotal
          await addLocalCashMovement({
            sessionId: session.id,
            movementType: 'expense',
            payment: {
              payment_method_id: method.id,
              method_code: method.code,
              method_name: method.name,
              affects_cash: true,
              currency: method.currency,
              amount: -cashAmount,
              amount_usd: -formTotal,
              rate_source: form.rate_source,
              rate_value: rateValue,
            },
            notes: `Compra ${form.supplier_name || ''}`.trim(),
          })
          if (method.currency === 'USD' && cashBillsTotal > 0) {
            await addLocalBillMovements({
              sessionId: session.id,
              type: 'gasto',
              counts: cashBills,
              note: `Compra ${form.supplier_name || ''}`.trim(),
              syncStatus: 'pending',
            })
            if (navigator.onLine) await syncCashBillMovements(session.id)
          }
        }
      }

      await refreshCatalog().catch(() => {})
      await load()
      setModalOpen(false)
      setCashBills(emptyBillCounts())
      push('Compra registrada y stock actualizado', 'success')
      if (data?.purchase_id) {
        // La compra ya quedó cargada; no hace falta abrir el detalle.
      }
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo registrar la compra', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Registra materia prima y actualiza el costo promedio en USD."
        icon={Truck}
        actions={
          <>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
            </button>
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Plus size={16} /> Nueva compra
            </button>
          </>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={Truck} label="Compras registradas" value={stats.total} hint="Últimas 60" />
        <StatCard icon={Calculator} label="Compras del mes" value={money(stats.monthTotal)} hint="Total en USD" />
        <StatCard icon={Wheat} label="Líneas de compra" value={stats.items} hint="Ingredientes comprados" />
      </div>

      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      <div className="card">
        {loading ? (
          <Loading label="Cargando compras..." />
        ) : purchases.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No hay compras registradas"
            text="Registra la primera compra para cargar stock y costos."
            action={
              <button type="button" className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Nueva compra
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Ítems</th>
                  <th>Pago</th>
                  <th className="num">Total USD</th>
                  <th className="num">Total Bs</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>
                      <div className="row-title">{formatDate(purchase.purchase_date)}</div>
                      <div className="row-meta">{formatDateTime(purchase.created_at)}</div>
                    </td>
                    <td>{purchase.supplier_name || '—'}</td>
                    <td>{purchase.purchase_items?.length || 0}</td>
                    <td>{purchase.payment_methods?.name || '—'}</td>
                    <td className="num"><strong>{money(purchase.total_usd)}</strong></td>
                    <td className="num">{formatBs(purchase.total_bs)}</td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => setDetail(purchase)}>
                        <Eye size={13} /> Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nueva compra"
        icon={Truck}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Registrar compra'}
            </button>
          </>
        }
      >
        <div className="form-grid-3">
          <div className="field">
            <label>Fecha</label>
            <input
              className="input"
              type="date"
              value={form.purchase_date}
              onChange={(e) => set('purchase_date', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Proveedor</label>
            <input
              className="input"
              value={form.supplier_name}
              onChange={(e) => set('supplier_name', e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="field">
            <label>Medio de pago</label>
            <select
              className="select"
              value={form.payment_method_id}
              onChange={(e) => set('payment_method_id', e.target.value)}
            >
              <option value="">Sin especificar</option>
              {paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-grid-3 mt-2">
          <div className="field">
            <label>Tasa Bs/USD (referencia)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.rate_value}
              onChange={(e) => set('rate_value', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Fuente de tasa</label>
            <select
              className="select"
              value={form.rate_source}
              onChange={(e) => set('rate_source', e.target.value)}
            >
              {RATE_SOURCES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <div className="card card-tight" style={{ background: 'var(--cream)', boxShadow: 'none' }}>
              <p className="label">Total Bs</p>
              <p className="money">{formatBs(totalBs)}</p>
            </div>
          </div>
        </div>

        {needsBills ? (
          <div className="mt-2">
            <BillPicker
              value={cashBills}
              onChange={setCashBills}
              label="Billetes entregados"
            />
            <p className="tiny muted mt-1">
              Los billetes deben sumar {money(formTotal)}.
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between mb-2 mt-3">
          <p className="card-title" style={{ margin: 0 }}>
            <Wheat size={16} /> Ingredientes comprados
          </p>
          <button type="button" className="btn btn-sm" onClick={addRow}>
            <Plus size={13} /> Agregar
          </button>
        </div>

        <div className="table-wrap">
          <table className="table" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th>Cantidad</th>
                <th>Total USD</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.items.map((item, index) => {
                const ing = ingredientMap.get(item.ingredient_id)
                return (
                  <tr key={item.key}>
                    <td>
                      <select
                        className="select"
                        value={item.ingredient_id}
                        onChange={(e) => setRow(index, 'ingredient_id', e.target.value)}
                      >
                        <option value="">Selecciona...</option>
                        {ingredients
                          .filter((i) => i.active !== false)
                          .map((i) => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))}
                      </select>
                      {ing ? (
                        <div className="row-meta">
                          1 {ing.purchase_unit} = {number(ing.conversion_factor)}{' '}
                          {BASE_UNIT_LABELS[ing.base_unit] || ing.base_unit}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ width: 150 }}>
                      <div className="flex items-center gap-2">
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) => setRow(index, 'quantity', e.target.value)}
                        />
                        <span className="tiny muted">{ing?.purchase_unit || ''}</span>
                      </div>
                    </td>
                    <td style={{ width: 150 }}>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.total_usd}
                        onChange={(e) => setRow(index, 'total_usd', e.target.value)}
                        placeholder="0.00"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => removeRow(index)}
                        disabled={form.items.length === 1}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between gap-3 mt-2">
          <span className="small muted">Total de la compra</span>
          <strong style={{ fontSize: 18 }}>{money(formTotal)}</strong>
        </div>

        <div className="field mt-2">
          <label>Notas</label>
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Factura, observaciones..."
          />
        </div>

        <p className="tiny muted mt-2">
          Al guardar se suma el stock y se recalcula el costo promedio en USD. Si pagas en
          efectivo USD, detalla los billetes para que el cajón cuadre.
        </p>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Compra ${formatDate(detail.purchase_date)}` : 'Compra'}
        icon={Truck}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setDetail(null)}>
            Cerrar
          </button>
        }
      >
        {detail ? (
          <>
            <div className="flex justify-between gap-2 wrap mb-2">
              <div>
                <p className="label">Proveedor</p>
                <p className="small">{detail.supplier_name || '—'}</p>
              </div>
              <div>
                <p className="label">Pago</p>
                <p className="small">{detail.payment_methods?.name || '—'}</p>
              </div>
              <div>
                <p className="label">Total</p>
                <p className="small">{money(detail.total_usd)}</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Total USD</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.purchase_items || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.ingredients?.name || 'Ingrediente'}</td>
                      <td className="num">
                        {number(item.quantity)} {item.ingredients?.purchase_unit || ''}
                      </td>
                      <td className="num">{money(item.total_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.notes ? <p className="small muted mt-2">{detail.notes}</p> : null}
          </>
        ) : null}
      </Modal>
    </>
  )
}
