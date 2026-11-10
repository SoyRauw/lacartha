import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calculator,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
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
import { EXPENSE_CATEGORIES } from '../../lib/constants'
import {
  bs as formatBs,
  convertBsToUsd,
  money,
  number,
  parseNumber,
} from '../../lib/currency'
import { formatDate, todayISO } from '../../lib/dates'
import { getRateValue } from '../../lib/rates'
import { addLocalBillMovements, addLocalCashMovement, getLocalBillLedger, getOpenLocalSession } from '../../lib/localCash'
import { drawerFromLedger, emptyBillCounts, sumBills } from '../../lib/bills'
import { syncCashBillMovements } from '../../lib/sync'

const EMPTY_FORM = {
  id: null,
  expense_date: todayISO(),
  category: 'Otros',
  description: '',
  amount: '',
  currency: 'USD',
  rate_value: '',
  payment_method_id: '',
  notes: '',
}

export default function AdminExpenses() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('todas')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [cashBills, setCashBills] = useState(emptyBillCounts())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: supaError } = await supabase
        .from('expenses')
        .select('*, payment_methods(name, currency, affects_cash)')
        .order('expense_date', { ascending: false })
        .limit(120)
      if (supaError) throw supaError
      setExpenses(data || [])
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudieron cargar los gastos')
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
    !form.id &&
    selectedMethod?.affects_cash === true &&
    selectedMethod?.currency === 'USD' &&
    form.currency === 'USD'

  const stats = useMemo(() => {
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const monthExpenses = expenses.filter((e) => (e.expense_date || '').startsWith(month))
    const today = expenses.filter((e) => e.expense_date === todayISO())
    return {
      month: monthExpenses.reduce((sum, e) => sum + (Number(e.amount_usd) || 0), 0),
      today: today.reduce((sum, e) => sum + (Number(e.amount_usd) || 0), 0),
      count: monthExpenses.length,
    }
  }, [expenses])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter((expense) => {
      if (categoryFilter !== 'todas' && expense.category !== categoryFilter) return false
      if (!q) return true
      return (
        (expense.description || '').toLowerCase().includes(q) ||
        (expense.category || '').toLowerCase().includes(q)
      )
    })
  }, [expenses, search, categoryFilter])

  const openNew = () => {
    const rate = catalog.rate
      ? getRateValue(catalog.rate, 'bcv_eur') || getRateValue(catalog.rate, 'bcv_usd')
      : 0
    setForm({
      ...EMPTY_FORM,
      expense_date: todayISO(),
      rate_value: rate ? String(rate) : '',
      payment_method_id: paymentMethods[0]?.id || '',
    })
    setCashBills(emptyBillCounts())
    setModalOpen(true)
  }

  const openEdit = (expense) => {
    setCashBills(emptyBillCounts())
    setForm({
      id: expense.id,
      expense_date: expense.expense_date || todayISO(),
      category: expense.category || 'Otros',
      description: expense.description || '',
      amount: String(expense.amount ?? ''),
      currency: expense.currency || 'USD',
      rate_value: String(expense.rate_value ?? ''),
      payment_method_id: expense.payment_method_id || '',
      notes: expense.notes || '',
    })
    setModalOpen(true)
  }

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const amountUsd = useMemo(() => {
    const amount = parseNumber(form.amount)
    if (form.currency === 'BS') {
      return convertBsToUsd(amount, parseNumber(form.rate_value))
    }
    return amount
  }, [form.amount, form.currency, form.rate_value])

  const handleSave = async () => {
    const amount = parseNumber(form.amount)
    if (amount < 0) {
      push('El monto no puede ser negativo', 'error')
      return
    }
    if (!form.description.trim() && form.category === 'Otros') {
      // Permitimos gastos sin descripción, pero el monto debe existir.
    }
    if (needsBills && Math.abs(cashBillsTotal - amountUsd) > 0.02) {
      push(
        'Los billetes suman ' +
          money(cashBillsTotal) +
          ' y el gasto es ' +
          money(amountUsd) +
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
        expense_date: form.expense_date,
        category: form.category,
        description: form.description.trim() || null,
        amount,
        currency: form.currency,
        amount_usd: amountUsd,
        rate_source: 'bcv_eur',
        rate_value: parseNumber(form.rate_value) || null,
        payment_method_id: form.payment_method_id || null,
        notes: form.notes.trim() || null,
      }

      if (form.id) {
        const { error } = await supabase.from('expenses').update(payload).eq('id', form.id)
        if (error) throw error
        push('Gasto actualizado', 'success')
      } else {
        const { error } = await supabase.from('expenses').insert(payload)
        if (error) throw error

        // Si el gasto se paga en efectivo y hay una caja abierta, impacta el arqueo local.
        const method = paymentMethods.find((m) => m.id === form.payment_method_id)
        if (method?.affects_cash && form.currency !== 'USDT') {
          const session = cashSession || (await getOpenLocalSession())
          if (session) {
            await addLocalCashMovement({
              sessionId: session.id,
              movementType: 'expense',
              payment: {
                payment_method_id: method.id,
                method_code: method.code,
                method_name: method.name,
                affects_cash: true,
                currency: form.currency,
                amount: -amount,
                amount_usd: -amountUsd,
                rate_source: 'bcv_eur',
                rate_value: parseNumber(form.rate_value),
              },
              notes: `Gasto: ${form.description || form.category}`,
            })
            if (method.currency === 'USD' && form.currency === 'USD' && cashBillsTotal > 0) {
              await addLocalBillMovements({
                sessionId: session.id,
                type: 'gasto',
                counts: cashBills,
                note: `Gasto: ${form.description || form.category}`,
                syncStatus: 'pending',
              })
              if (navigator.onLine) await syncCashBillMovements(session.id)
            }
            push('Gasto registrado y descontado de la caja', 'success')
          } else {
            push('Gasto registrado; no hay caja abierta para descontarlo', 'success')
          }
        } else {
          push('Gasto registrado', 'success')
        }
      }

      await load()
      setModalOpen(false)
      setCashBills(emptyBillCounts())
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Gastos"
        subtitle="Gastos fijos y variables del negocio."
        icon={Receipt}
        actions={
          <>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
            </button>
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Plus size={16} /> Nuevo gasto
            </button>
          </>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={Receipt} label="Gastos del mes" value={money(stats.month)} hint={`${stats.count} gasto(s)`} />
        <StatCard icon={Wallet} label="Gastos de hoy" value={money(stats.today)} hint="Registrados hoy" />
        <StatCard icon={Calculator} label="Tasa BCV EUR" value={catalog.rate?.bcv_eur ? number(catalog.rate.bcv_eur) : '—'} hint="Referencia Bs/€" />
      </div>

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
              placeholder="Buscar gasto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="todas">Todas las categorías</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <Loading label="Cargando gastos..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No hay gastos"
            text="Registra el primero para que la ganancia sea real."
            action={
              <button type="button" className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Nuevo gasto
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Categoría</th>
                  <th>Descripción</th>
                  <th>Pago</th>
                  <th className="num">Monto</th>
                  <th className="num">USD</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((expense) => (
                  <tr key={expense.id}>
                    <td>{formatDate(expense.expense_date)}</td>
                    <td>
                      <span className="badge badge-orange">{expense.category}</span>
                    </td>
                    <td>{expense.description || '—'}</td>
                    <td>{expense.payment_methods?.name || '—'}</td>
                    <td className="num">
                      {expense.currency === 'BS'
                        ? formatBs(expense.amount)
                        : `${expense.currency} ${number(expense.amount)}`}
                    </td>
                    <td className="num"><strong>{money(expense.amount_usd)}</strong></td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => openEdit(expense)}>
                        <Pencil size={13} /> Editar
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
        title={form.id ? 'Editar gasto' : 'Nuevo gasto'}
        icon={Receipt}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar gasto'}
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
              value={form.expense_date}
              onChange={(e) => set('expense_date', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select className="select" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
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

        <div className="field mt-2">
          <label>Descripción</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Ej. Alquiler, gas, empaque..."
          />
        </div>

        <div className="form-grid-3 mt-2">
          <div className="field">
            <label>Monto</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="field">
            <label>Moneda</label>
            <select className="select" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              <option value="USD">USD</option>
              <option value="BS">Bs</option>
              <option value="USDT">USDT</option>
            </select>
          </div>
          <div className="field">
            <label>Total en USD</label>
            <input className="input" value={money(amountUsd)} readOnly />
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
              Los billetes deben sumar {money(amountUsd)}.
            </p>
          </div>
        ) : null}

        {form.currency === 'BS' ? (
          <div className="field mt-2">
            <label>Tasa EUR (Bs/€)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.rate_value}
              onChange={(e) => set('rate_value', e.target.value)}
            />
          </div>
        ) : null}

        <div className="field mt-2">
          <label>Notas</label>
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Opcional"
          />
        </div>

        <p className="tiny muted mt-2">
          Si el gasto se paga en efectivo USD, detalla los billetes para que el cajón cuadre.
        </p>
      </Modal>
    </>
  )
}
