import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  CreditCard,
  Landmark,
  Lock,
  PackagePlus,
  RefreshCw,
  Save,
  Smartphone,
  Unlock,
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
import { useAuth } from '../../hooks/useAuth'
import { useCatalog } from '../../hooks/useCatalog'
import { useOnline } from '../../hooks/useOnline'
import {
  addLocalBillMovements,
  addLocalCashMovement,
  cashTotalsByMethod,
  closeLocalCashSession,
  expectedCashFromMovements,
  getLocalBillLedger,
  getLocalCashMovements,
  getOpenLocalSession,
  openLocalCashSession,
} from '../../lib/localCash'
import {
  BILL_DENOMINATIONS,
  billsFromJson,
  drawerFromLedger,
  emptyBillCounts,
  formatBillsList,
  sumBills,
} from '../../lib/bills'
import { bs as formatBs, money, number, parseNumber, rate as formatRate } from '../../lib/currency'
import { formatDate, formatDateTime, todayISO } from '../../lib/dates'
import { getRateValue } from '../../lib/rates'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { syncAll, syncCashBillMovements, syncCashSession } from '../../lib/sync'
import styles from './AdminCash.module.css'

const MOVEMENT_LABELS = {
  opening: 'Apertura',
  sale: 'Venta',
  expense: 'Gasto',
  withdrawal: 'Retiro',
  adjustment: 'Ajuste',
  closing: 'Cierre',
}

function methodIcon(code) {
  switch (code) {
    case 'pago_movil':
      return Smartphone
    case 'punto_venta':
      return CreditCard
    case 'zelle':
      return Landmark
    case 'binance':
      return CircleDollarSign
    case 'efectivo_bs':
      return Coins
    default:
      return Banknote
  }
}

function emptyOutflow() {
  return {
    type: 'retiro',
    bills: emptyBillCounts(),
    note: '',
  }
}

export default function AdminCash() {
  const { user } = useAuth()
  const online = useOnline()
  const catalog = useCatalog()
  const { push } = useToast()

  const [session, setSession] = useState(null)
  const [movements, setMovements] = useState([])
  const [billLedger, setBillLedger] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [openModal, setOpenModal] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [outflowModal, setOutflowModal] = useState(false)

  const [openingBills, setOpeningBills] = useState(emptyBillCounts())
  const [openingBs, setOpeningBs] = useState('')
  const [exchangeRate, setExchangeRate] = useState('')

  const [closeBills, setCloseBills] = useState(emptyBillCounts())
  const [countedBs, setCountedBs] = useState('')
  const [closeNotes, setCloseNotes] = useState('')

  const [outflow, setOutflow] = useState(emptyOutflow())

  const [capital, setCapital] = useState([])
  const [capitalForm, setCapitalForm] = useState({
    movement_type: 'aporte',
    movement_date: todayISO(),
    amount: '',
    currency: 'USD',
    rate_value: '',
    notes: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const current = await getOpenLocalSession()
      setSession(current)

      if (current) {
        const [moves, ledger] = await Promise.all([
          getLocalCashMovements(current.id),
          getLocalBillLedger(current.id),
        ])
        setMovements(moves)
        setBillLedger(ledger)
      } else {
        setMovements([])
        setBillLedger([])
      }

      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('status', 'closed')
          .order('closed_at', { ascending: false })
          .limit(20)
        if (!error) setHistory(data || [])

        const { data: capitalData, error: capitalError } = await supabase
          .from('capital_movements')
          .select('*')
          .order('movement_date', { ascending: false })
          .limit(30)
        if (!capitalError) setCapital(capitalData || [])
      } else {
        const localClosed = await db.cash_sessions.where('status').equals('closed').toArray()
        setHistory(
          localClosed.sort((a, b) =>
            String(b.closed_at).localeCompare(String(a.closed_at)),
          ),
        )
      }
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo cargar la caja', 'error')
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (exchangeRate) return undefined
    let cancelled = false

    const loadRate = async () => {
      let value =
        getRateValue(catalog.rate, 'bcv_eur') ||
        getRateValue(catalog.rate, 'bcv_usd') ||
        getRateValue(catalog.rate, 'usdt')
      if (!value && navigator.onLine) {
        const { data } = await supabase
          .from('rate_snapshots')
          .select('*')
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        value = data?.bcv_eur || data?.bcv_usd || data?.usdt
      }
      if (!cancelled && value) setExchangeRate(String(value))
    }

    loadRate().catch((e) => console.warn('No se pudo cargar la tasa', e))
    return () => {
      cancelled = true
    }
  }, [catalog.rate, exchangeRate])

  const expected = useMemo(
    () => expectedCashFromMovements(session, movements),
    [session, movements],
  )

  const sessionDrawer = useMemo(() => drawerFromLedger(billLedger), [billLedger])
  const drawerTotal = useMemo(() => sumBills(sessionDrawer), [sessionDrawer])
  const openingTotal = useMemo(() => sumBills(openingBills), [openingBills])
  const closeTotal = useMemo(() => sumBills(closeBills), [closeBills])
  const outflowTotal = useMemo(() => sumBills(outflow.bills), [outflow.bills])

  const diffUsd = closeTotal - expected.expectedUsd
  const diffBs = (parseNumber(countedBs) || 0) - expected.expectedBs
  const outflowSign = outflow.type === 'ajuste' ? 1 : -1

  const totalsByMethod = useMemo(() => cashTotalsByMethod(movements), [movements])

  const capitalTotals = useMemo(() => {
    const aportes = capital
      .filter((row) => row.movement_type === 'aporte')
      .reduce((sum, row) => sum + (Number(row.amount_usd) || 0), 0)
    const retiros = capital
      .filter((row) => row.movement_type === 'retiro')
      .reduce((sum, row) => sum + (Number(row.amount_usd) || 0), 0)
    return { aportes, retiros, net: aportes - retiros }
  }, [capital])

  const saveCapital = async () => {
    const amount = parseNumber(capitalForm.amount)
    if (amount <= 0) {
      push('El monto debe ser mayor a cero', 'error')
      return
    }
    const rate = parseNumber(capitalForm.rate_value)
    if (capitalForm.currency === 'BS' && rate <= 0) {
      push('Escribe la tasa para el monto en Bs', 'error')
      return
    }
    const amountUsd = capitalForm.currency === 'BS' ? amount / rate : amount
    setSaving(true)
    try {
      const { error } = await supabase.from('capital_movements').insert({
        movement_date: capitalForm.movement_date,
        movement_type: capitalForm.movement_type,
        amount,
        currency: capitalForm.currency,
        amount_usd: amountUsd,
        rate_source: 'manual',
        rate_value: rate || null,
        notes: capitalForm.notes.trim() || null,
        created_by: user?.id || null,
      })
      if (error) throw error
      setCapitalForm((prev) => ({
        ...prev,
        amount: '',
        notes: '',
        rate_value: '',
      }))
      await load()
      push('Movimiento de capital registrado', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo registrar el capital', 'error')
    } finally {
      setSaving(false)
    }
  }

  const bringLastClose = async () => {
    try {
      const localClosed = await db.cash_sessions.where('status').equals('closed').toArray()
      const lastLocal = localClosed.sort((a, b) =>
        String(b.closed_at).localeCompare(String(a.closed_at)),
      )[0]

      if (lastLocal) {
        if (lastLocal.closing_bills) {
          setOpeningBills(billsFromJson(lastLocal.closing_bills))
          push('Conteo del cierre anterior cargado', 'success')
          return
        }
        const rows = await db.cash_bill_movements
          .where('cash_session_id')
          .equals(lastLocal.id)
          .toArray()
        const closingRows = rows.filter((row) => row.type === 'cierre')
        if (closingRows.length) {
          setOpeningBills(drawerFromLedger(closingRows, { includeCierre: true }))
          push('Conteo del cierre anterior cargado', 'success')
          return
        }
      }

      if (navigator.onLine) {
        const { data: lastServer } = await supabase
          .from('cash_sessions')
          .select('id')
          .eq('status', 'closed')
          .order('closed_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastServer?.id) {
          const { data: rows } = await supabase
            .from('cash_bill_movements')
            .select('*')
            .eq('cash_session_id', lastServer.id)
            .eq('type', 'cierre')
          if (rows?.length) {
            setOpeningBills(drawerFromLedger(rows, { includeCierre: true }))
            push('Conteo del cierre anterior cargado', 'success')
            return
          }
        }
      }

      push('No hay un cierre anterior con billetes', 'info')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo traer el cierre anterior', 'error')
    }
  }

  const handleOpen = async () => {
    const rate = parseNumber(exchangeRate)
    if (rate <= 0) {
      push('Escribe la tasa EUR del día en Bs/€', 'error')
      return
    }
    setSaving(true)
    try {
      const newSession = await openLocalCashSession({
        opening_bills: openingBills,
        opening_bs: parseNumber(openingBs),
        exchange_rate: rate,
        user_id: user?.id || null,
      })
      setSession(newSession)
      setOpenModal(false)
      setOpeningBills(emptyBillCounts())
      setOpeningBs('')
      if (online) {
        await syncCashSession(newSession)
        await syncCashBillMovements(newSession.id)
      }
      await load()
      push('Caja abierta con el conteo de billetes', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo abrir la caja', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = async () => {
    if (!session) return
    setSaving(true)
    try {
      const closed = await closeLocalCashSession({
        session,
        closing_bills: closeBills,
        counted_bs: parseNumber(countedBs),
        notes: closeNotes.trim() || null,
        user_id: user?.id || null,
      })
      if (online) {
        try {
          await syncCashSession(closed)
          await syncCashBillMovements(closed.id)
        } catch (e) {
          console.warn('No se pudo sincronizar el cierre', e)
        }
      }
      setSession(null)
      setMovements([])
      setBillLedger([])
      setCloseModal(false)
      setCloseBills(emptyBillCounts())
      setCountedBs('')
      setCloseNotes('')
      await load()
      push('Caja cerrada', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo cerrar la caja', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleOutflow = async () => {
    if (!session) return
    if (outflowTotal <= 0) {
      push('Selecciona al menos un billete', 'error')
      return
    }
    if (outflow.type !== 'ajuste') {
      for (const [denom, qty] of Object.entries(outflow.bills)) {
        if (Number(qty) > (sessionDrawer[denom] || 0)) {
          push(`No hay suficientes billetes de $${denom} en el cajón`, 'error')
          return
        }
      }
    }
    setSaving(true)
    try {
      const isAdjustment = outflow.type === 'ajuste'
      const billType = isAdjustment ? 'ajuste' : outflow.type
      const movementType = isAdjustment
        ? 'adjustment'
        : outflow.type === 'gasto'
          ? 'expense'
          : 'withdrawal'
      const label =
        outflow.type === 'gasto'
          ? 'Gasto en efectivo'
          : outflow.type === 'retiro'
            ? 'Retiro de efectivo'
            : 'Ajuste de cajón'

      await addLocalBillMovements({
        sessionId: session.id,
        type: billType,
        counts: outflow.bills,
        note: `${label}: ${outflow.note || 'sin nota'}`,
        syncStatus: 'pending',
      })

      await addLocalCashMovement({
        sessionId: session.id,
        movementType,
        payment: {
          method_code: 'efectivo_usd',
          method_name: 'Efectivo USD',
          affects_cash: true,
          currency: 'USD',
          amount: outflowSign * outflowTotal,
          amount_usd: outflowSign * outflowTotal,
          received_amount: outflowSign * outflowTotal,
        },
        notes: `${label}: ${outflow.note || ''}`.trim(),
      })

      if (online) {
        await syncCashBillMovements(session.id)
      }

      setOutflowModal(false)
      setOutflow(emptyOutflow())
      await load()
      push(
        isAdjustment ? 'Billetes agregados al cajón' : 'Salida de efectivo registrada',
        'success',
      )
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo registrar la salida', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    if (!online || syncing) return
    setSyncing(true)
    try {
      const result = await syncAll()
      if (result.error) push(`Sync con advertencias: ${result.error}`, 'error')
      else push('Caja sincronizada', 'success')
      await load()
    } catch (e) {
      push(e.message || 'No se pudo sincronizar', 'error')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Caja" subtitle="Apertura, cierre y arqueo por billetes." icon={Wallet} />
        <Loading label="Cargando caja..." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Caja"
        subtitle="Billetes de dólar, Bs, vuelto y métodos de pago."
        icon={Wallet}
        actions={
          <>
            <button type="button" className="btn" onClick={handleSync} disabled={!online || syncing}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} /> Sincronizar
            </button>
            {session ? (
              <>
                <button type="button" className="btn" onClick={() => setOutflowModal(true)}>
                  <PackagePlus size={15} /> Movimiento de efectivo
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setCloseModal(true)}>
                  <Lock size={15} /> Cerrar caja
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setOpenModal(true)}>
                <Unlock size={15} /> Abrir caja
              </button>
            )}
          </>
        }
      />

      {!session ? (
        <div className="card">
          <EmptyState
            icon={Wallet}
            title="No hay caja abierta"
            text="Abre la caja contando los billetes. La tasa EUR del día se toma automáticamente."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setOpenModal(true)}>
                <Unlock size={15} /> Abrir caja
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="stat-grid mb-3">
            <StatCard
              icon={Banknote}
              label="Apertura USD"
              value={money(session.opening_usd)}
              hint={formatBillsList(billsFromJson(session.opening_bills)) || 'Sin billetes'}
            />
            <StatCard
              icon={Coins}
              label="Apertura Bs"
              value={formatBs(session.opening_bs)}
              hint="Efectivo inicial"
            />
            <StatCard
              icon={ArrowUpRight}
              label="Esperado USD"
              value={money(expected.expectedUsd)}
              hint="Apertura + ventas − vueltos − salidas"
              tone="success"
            />
            <StatCard
              icon={ArrowUpRight}
              label="Esperado Bs"
              value={formatBs(expected.expectedBs)}
              hint="Apertura + cobros Bs − vuelto Bs"
              tone="success"
            />
            <StatCard
              icon={Wallet}
              label="Total esperado"
              value={money(expected.expectedTotalUsd)}
              hint="USD + Bs a la tasa EUR del día"
            />
          </div>

          <div className="grid-2 mb-3">
            <div className="card">
              <p className="card-title">
                <CheckCircle2 size={16} /> Caja abierta
              </p>
              <p className="small muted">Abierta el {formatDateTime(session.opened_at)}</p>
              <div className="divider" />
              <div className="flex justify-between gap-2">
                <span className="muted small">Tasa EUR del día</span>
                <strong>{formatRate(session.exchange_rate)} Bs/€</strong>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="muted small">Efectivo USD esperado</span>
                <strong>{money(expected.expectedUsd)}</strong>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="muted small">Efectivo Bs esperado</span>
                <strong>{formatBs(expected.expectedBs)}</strong>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="muted small">Movimientos</span>
                <strong>{movements.length}</strong>
              </div>
            </div>

            <div className="card">
              <p className="card-title">
                <Banknote size={16} /> Cajón de billetes en vivo
              </p>
              <div className={styles.drawerGrid}>
                {BILL_DENOMINATIONS.map((denom) => {
                  const qty = sessionDrawer[denom] || 0
                  return (
                    <div
                      className={`${styles.drawerTile} ${qty < 0 ? styles.drawerTileNegative : ''}`}
                      key={denom}
                    >
                      <span className={styles.drawerDenom}>${denom}</span>
                      <strong className={styles.drawerQty}>×{qty}</strong>
                      <span className={styles.drawerSubtotal}>{money(qty * denom)}</span>
                    </div>
                  )
                })}
              </div>
              <div className={styles.drawerTotal}>
                <span>Total cajón</span>
                <strong>{money(drawerTotal)}</strong>
              </div>
              {drawerTotal < 0 ? (
                <p className="tiny negative mt-1">
                  El cajón está negativo. Revisa un vuelto o una salida mal registrada.
                </p>
              ) : null}
            </div>
          </div>

          <div className="card mb-3">
            <p className="card-title">
              <CircleDollarSign size={16} /> Cobros por método
            </p>
            {totalsByMethod.length === 0 ? (
              <p className="muted small">Todavía no hay cobros.</p>
            ) : (
              <div className="grid-3">
                {totalsByMethod.map((method) => {
                  const Icon = methodIcon(method.method_code)
                  return (
                    <div className={styles.methodCard} key={method.method_code}>
                      <span className="small flex items-center gap-2">
                        <Icon size={14} style={{ color: 'var(--orange)' }} />
                        {method.method_name}
                      </span>
                      <strong>
                        {method.currency === 'BS'
                          ? formatBs(method.amount)
                          : `${method.currency} ${number(method.amount)}`}
                      </strong>
                      <span className="tiny muted">{money(method.amount_usd)} equivalente</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <p className="card-title">
              <ArrowUpRight size={16} /> Movimientos de la caja
            </p>
            {movements.length === 0 ? (
              <p className="muted small">Aún no hay movimientos.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Tipo</th>
                      <th>Método</th>
                      <th className="num">Recibido</th>
                      <th className="num">Vuelto USD</th>
                      <th className="num">Vuelto Bs</th>
                      <th className="num">USD neto</th>
                      <th>Caja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{formatDateTime(movement.created_at)}</td>
                        <td>{MOVEMENT_LABELS[movement.movement_type] || movement.movement_type}</td>
                        <td>{movement.method_name || movement.method_code}</td>
                        <td className="num">
                          {movement.currency === 'BS'
                            ? formatBs(movement.received_amount ?? movement.amount)
                            : `${movement.currency} ${number(movement.received_amount ?? movement.amount)}`}
                        </td>
                        <td className="num">{money(movement.change_usd || 0)}</td>
                        <td className="num">{formatBs(movement.change_bs || 0)}</td>
                        <td className="num">{money(movement.amount_usd)}</td>
                        <td>
                          {movement.affects_cash ? (
                            <span className="badge badge-green">Efectivo</span>
                          ) : (
                            <span className="badge">Digital</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="card mt-3">
        <p className="card-title">
          <Wallet size={16} /> Historial de cierres
        </p>
        {history.length === 0 ? (
          <p className="muted small">No hay cierres registrados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="num">Tasa</th>
                  <th className="num">Apertura USD</th>
                  <th className="num">Esperado USD</th>
                  <th className="num">Contado USD</th>
                  <th className="num">Dif. USD</th>
                  <th className="num">Esperado Bs</th>
                  <th className="num">Contado Bs</th>
                  <th className="num">Dif. Bs</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const diff = Number(row.difference_usd) || 0
                  const diffBs = Number(row.difference_bs) || 0
                  return (
                    <tr key={row.id}>
                      <td>{formatDate(row.opened_at)}</td>
                      <td className="num">{number(row.exchange_rate)}</td>
                      <td className="num">{money(row.opening_usd)}</td>
                      <td className="num">{money(row.expected_usd)}</td>
                      <td className="num">{money(row.counted_usd)}</td>
                      <td
                        className={`num ${diff === 0 ? 'positive' : diff > 0 ? 'positive' : 'negative'}`}
                      >
                        {money(diff)}
                      </td>
                      <td className="num">{formatBs(row.expected_bs)}</td>
                      <td className="num">{formatBs(row.counted_bs)}</td>
                      <td
                        className={`num ${diffBs === 0 ? 'positive' : diffBs > 0 ? 'positive' : 'negative'}`}
                      >
                        {formatBs(diffBs)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt-3">
        <p className="card-title">
          <Wallet size={16} /> Capital del negocio
        </p>
        <div className="stat-grid mb-3">
          <StatCard
            icon={ArrowDownRight}
            label="Aportes"
            value={money(capitalTotals.aportes)}
            hint="Capital invertido"
          />
          <StatCard
            icon={ArrowUpRight}
            label="Retiros"
            value={money(capitalTotals.retiros)}
            hint="Dinero retirado"
          />
          <StatCard
            icon={Wallet}
            label="Capital neto"
            value={money(capitalTotals.net)}
            tone={capitalTotals.net >= 0 ? 'success' : 'danger'}
            hint="Aportes − retiros"
          />
        </div>

        <div className="grid-2">
          <div>
            <p className="label mb-1">Registrar movimiento</p>
            <div className="form-grid">
              <div className="field">
                <label>Tipo</label>
                <select
                  className="select"
                  value={capitalForm.movement_type}
                  onChange={(e) =>
                    setCapitalForm((prev) => ({ ...prev, movement_type: e.target.value }))
                  }
                >
                  <option value="aporte">Aporte</option>
                  <option value="retiro">Retiro</option>
                </select>
              </div>
              <div className="field">
                <label>Fecha</label>
                <input
                  className="input"
                  type="date"
                  value={capitalForm.movement_date}
                  onChange={(e) =>
                    setCapitalForm((prev) => ({ ...prev, movement_date: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="form-grid-3 mt-2">
              <div className="field">
                <label>Monto</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={capitalForm.amount}
                  onChange={(e) =>
                    setCapitalForm((prev) => ({ ...prev, amount: e.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="field">
                <label>Moneda</label>
                <select
                  className="select"
                  value={capitalForm.currency}
                  onChange={(e) =>
                    setCapitalForm((prev) => ({ ...prev, currency: e.target.value }))
                  }
                >
                  <option value="USD">USD</option>
                  <option value="BS">Bs</option>
                  <option value="USDT">USDT</option>
                </select>
              </div>
              <div className="field">
                <label>{capitalForm.currency === 'BS' ? 'Tasa EUR (Bs/€)' : 'Referencia'}</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={capitalForm.rate_value}
                  onChange={(e) =>
                    setCapitalForm((prev) => ({ ...prev, rate_value: e.target.value }))
                  }
                  disabled={capitalForm.currency !== 'BS'}
                  placeholder={capitalForm.currency === 'BS' ? 'Tasa' : '—'}
                />
              </div>
            </div>
            <div className="field mt-2">
              <label>Notas</label>
              <input
                className="input"
                value={capitalForm.notes}
                onChange={(e) =>
                  setCapitalForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Ej. Capital inicial, retiro personal..."
              />
            </div>
            <button
              type="button"
              className="btn btn-primary mt-2"
              onClick={saveCapital}
              disabled={saving || !online}
            >
              <Save size={14} /> Registrar movimiento
            </button>
            {!online ? (
              <p className="tiny muted mt-1">Necesitas conexión para guardar capital.</p>
            ) : null}
          </div>

          <div>
            <p className="label mb-1">Últimos movimientos</p>
            {capital.length === 0 ? (
              <p className="muted small">Sin movimientos registrados.</p>
            ) : (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th className="num">Monto</th>
                      <th className="num">USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capital.slice(0, 8).map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.movement_date)}</td>
                        <td>
                          <span
                            className={`badge ${
                              row.movement_type === 'aporte' ? 'badge-green' : 'badge-yellow'
                            }`}
                          >
                            {row.movement_type === 'aporte' ? 'Aporte' : 'Retiro'}
                          </span>
                        </td>
                        <td className="num">
                          {row.currency === 'BS'
                            ? formatBs(row.amount)
                            : `${row.currency} ${number(row.amount)}`}
                        </td>
                        <td className="num">{money(row.amount_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title="Abrir caja"
        icon={Unlock}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpenModal(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleOpen} disabled={saving}>
              {saving ? 'Abriendo...' : 'Abrir caja'}
            </button>
          </>
        }
      >
        <p className="small muted mb-2">
          Cuenta los billetes con los que abre la caja. El total en USD se calcula solo.
        </p>
        <BillPicker
          value={openingBills}
          onChange={setOpeningBills}
          disabled={saving}
          label="Billetes de apertura"
        />
        <div className="form-grid mt-3">
          <div className="field">
            <label>Efectivo Bs inicial</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={openingBs}
              onChange={(e) => setOpeningBs(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="field">
            <label>Tasa EUR del día</label>
            <div className={styles.rateReadonly}>
              {exchangeRate ? `${formatRate(exchangeRate)} Bs/€` : 'Sin tasa disponible'}
            </div>
          </div>
        </div>
        <p className="tiny muted mt-1">
          La tasa se toma automáticamente de la BCV EUR del día.
        </p>
        <div className="flex justify-between items-center gap-2 mt-2 wrap">
          <strong className="small">Total apertura: {money(openingTotal)}</strong>
          <button type="button" className="btn btn-sm" onClick={bringLastClose}>
            <RefreshCw size={13} /> Traer cierre anterior
          </button>
        </div>
      </Modal>

      <Modal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        title="Cerrar caja"
        icon={Lock}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCloseModal(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleClose} disabled={saving}>
              {saving ? 'Cerrando...' : 'Cerrar caja'}
            </button>
          </>
        }
      >
        <div className="alert alert-warn mb-3">
          Esperado: <strong>{money(expected.expectedUsd)}</strong> USD ·{' '}
          <strong>{formatBs(expected.expectedBs)}</strong> Bs ·{' '}
          <strong>{money(expected.expectedTotalUsd)}</strong> total.
        </div>
        <div className="flex justify-between items-center gap-2 mb-2 wrap">
          <p className="small muted">Cuenta los billetes reales del cajón.</p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setCloseBills({ ...sessionDrawer })}
          >
            Usar cajón esperado
          </button>
        </div>
        <BillPicker
          value={closeBills}
          onChange={setCloseBills}
          disabled={saving}
          label="Billetes contados"
        />
        <p className="tiny muted mt-1">
          Esperado por denominación: {formatBillsList(sessionDrawer) || 'sin billetes'}
        </p>
        <div className="form-grid mt-3">
          <div className="field">
            <label>Bs contados</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={countedBs}
              onChange={(e) => setCountedBs(e.target.value)}
              placeholder={`Esperado: ${formatBs(expected.expectedBs)}`}
            />
          </div>
          <div className="field">
            <label>Diferencia USD</label>
            <div
              className={`${styles.diffBox} ${diffUsd === 0 ? styles.diffOk : diffUsd > 0 ? styles.diffUp : styles.diffDown}`}
            >
              {money(diffUsd)}
            </div>
          </div>
          <div className="field">
            <label>Diferencia Bs</label>
            <div
              className={`${styles.diffBox} ${diffBs === 0 ? styles.diffOk : diffBs > 0 ? styles.diffUp : styles.diffDown}`}
            >
              {formatBs(diffBs)}
            </div>
          </div>
        </div>
        <div className="field mt-2">
          <label>Notas del cierre</label>
          <textarea
            className="textarea"
            value={closeNotes}
            onChange={(e) => setCloseNotes(e.target.value)}
            placeholder="Observaciones, faltante, sobrante..."
          />
        </div>
      </Modal>

      <Modal
        open={outflowModal}
        onClose={() => setOutflowModal(false)}
        title="Movimiento de efectivo"
        icon={PackagePlus}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setOutflowModal(false)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleOutflow} disabled={saving}>
              {saving ? 'Guardando...' : 'Registrar movimiento'}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Tipo</label>
          <select
            className="select"
            value={outflow.type}
            onChange={(e) => setOutflow((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="retiro">Retiro de efectivo</option>
            <option value="gasto">Gasto en efectivo</option>
            <option value="ajuste">Agregar billetes al cajón</option>
          </select>
        </div>
        <div className="mt-2">
          <BillPicker
            value={outflow.bills}
            onChange={(bills) => setOutflow((prev) => ({ ...prev, bills }))}
            disabled={saving}
            label="Billetes"
          />
        </div>
        <div className="field mt-2">
          <label>Nota</label>
          <input
            className="input"
            value={outflow.note}
            onChange={(e) => setOutflow((prev) => ({ ...prev, note: e.target.value }))}
            placeholder="Ej. Retiro para compra, cambio de billetes..."
          />
        </div>
        <p className="small muted mt-2">
          {outflow.type === 'ajuste'
            ? `Se suman ${money(outflowTotal)} al cajón.`
            : `Se descuentan ${money(outflowTotal)} del cajón.`}
        </p>
      </Modal>
    </>
  )
}
