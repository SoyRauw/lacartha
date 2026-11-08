import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Lock,
  Plus,
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
import { useAuth } from '../../hooks/useAuth'
import { useOnline } from '../../hooks/useOnline'
import {
  cashTotalsByMethod,
  closeLocalCashSession,
  getLocalCashMovements,
  getOpenLocalSession,
  openLocalCashSession,
} from '../../lib/localCash'
import { syncAll, syncCashSession } from '../../lib/sync'
import { bs as formatBs, money, number, parseNumber } from '../../lib/currency'
import { formatDate, formatDateTime, todayISO } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'

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
    default:
      return Banknote
  }
}

export default function AdminCash() {
  const { user } = useAuth()
  const online = useOnline()
  const { push } = useToast()
  const [session, setSession] = useState(null)
  const [movements, setMovements] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [openModal, setOpenModal] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [openingUsd, setOpeningUsd] = useState('')
  const [openingBs, setOpeningBs] = useState('')
  const [countedUsd, setCountedUsd] = useState('')
  const [countedBs, setCountedBs] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [saving, setSaving] = useState(false)
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
        setMovements(await getLocalCashMovements(current.id))
      } else {
        setMovements([])
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
        setHistory(localClosed.sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at))))
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

  const cashMovements = useMemo(
    () => movements.filter((m) => m.affects_cash),
    [movements],
  )

  const expectedUsd = useMemo(() => {
    if (!session) return 0
    return (
      (Number(session.opening_usd) || 0) +
      cashMovements
        .filter((m) => m.currency === 'USD')
        .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
    )
  }, [session, cashMovements])

  const expectedBs = useMemo(() => {
    if (!session) return 0
    return (
      (Number(session.opening_bs) || 0) +
      cashMovements
        .filter((m) => m.currency === 'BS')
        .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
    )
  }, [session, cashMovements])

  const totalsByMethod = useMemo(() => cashTotalsByMethod(movements), [movements])

  const diffUsd = (parseNumber(countedUsd) || 0) - expectedUsd
  const diffBs = (parseNumber(countedBs) || 0) - expectedBs

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

  const handleOpen = async () => {
    setSaving(true)
    try {
      const newSession = await openLocalCashSession({
        opening_usd: parseNumber(openingUsd),
        opening_bs: parseNumber(openingBs),
        user_id: user?.id || null,
      })
      setSession(newSession)
      setOpenModal(false)
      setOpeningUsd('')
      setOpeningBs('')
      if (online) {
        syncCashSession(newSession).catch((e) => console.warn('Sync caja', e))
      }
      await load()
      push('Caja abierta', 'success')
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
        counted_usd: parseNumber(countedUsd),
        counted_bs: parseNumber(countedBs),
        notes: closeNotes.trim() || null,
        user_id: user?.id || null,
      })
      if (online) {
        try {
          await syncCashSession(closed)
        } catch (e) {
          console.warn('No se pudo sincronizar el cierre', e)
        }
      }
      setSession(null)
      setMovements([])
      setCloseModal(false)
      setCountedUsd('')
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
        <PageHeader title="Caja" subtitle="Apertura, cierre y arqueo." icon={Wallet} />
        <Loading label="Cargando caja..." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Caja"
        subtitle="Apertura, ventas, cierre y diferencia de efectivo."
        icon={Wallet}
        actions={
          <>
            <button type="button" className="btn" onClick={handleSync} disabled={!online || syncing}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} /> Sincronizar
            </button>
            {!session ? (
              <button type="button" className="btn btn-primary" onClick={() => setOpenModal(true)}>
                <Unlock size={15} /> Abrir caja
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setCloseModal(true)}>
                <Lock size={15} /> Cerrar caja
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
            text="Abre la caja con el efectivo inicial para empezar a vender."
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
              hint="Efectivo inicial"
            />
            <StatCard
              icon={Banknote}
              label="Apertura Bs"
              value={formatBs(session.opening_bs)}
              hint="Efectivo inicial"
            />
            <StatCard
              icon={ArrowUpRight}
              label="Esperado USD"
              value={money(expectedUsd)}
              hint="Apertura + ventas en efectivo"
              tone="success"
            />
            <StatCard
              icon={ArrowUpRight}
              label="Esperado Bs"
              value={formatBs(expectedBs)}
              hint="Apertura + ventas en efectivo"
              tone="success"
            />
          </div>

          <div className="grid-2 mb-3">
            <div className="card">
              <p className="card-title">
                <CheckCircle2 size={16} /> Caja abierta
              </p>
              <p className="small muted">
                Abierta el {formatDateTime(session.opened_at)}
              </p>
              <div className="divider" />
              <div className="flex justify-between gap-2">
                <span className="muted small">Efectivo USD esperado</span>
                <strong>{money(expectedUsd)}</strong>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="muted small">Efectivo Bs esperado</span>
                <strong>{formatBs(expectedBs)}</strong>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="muted small">Movimientos</span>
                <strong>{movements.length}</strong>
              </div>
            </div>

            <div className="card">
              <p className="card-title">
                <CircleDollarSign size={16} /> Cobros por método
              </p>
              {totalsByMethod.length === 0 ? (
                <p className="muted small">Todavía no hay cobros.</p>
              ) : (
                totalsByMethod.map((method) => {
                  const Icon = methodIcon(method.method_code)
                  return (
                    <div className="flex items-center justify-between gap-2" key={method.method_code} style={{ marginBottom: 6 }}>
                      <span className="small flex items-center gap-2">
                        <Icon size={14} style={{ color: 'var(--orange)' }} />
                        {method.method_name}
                      </span>
                      <strong className="small">
                        {method.currency === 'BS'
                          ? formatBs(method.amount)
                          : `${method.currency} ${number(method.amount)}`}
                      </strong>
                    </div>
                  )
                })
              )}
            </div>
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
                      <th className="num">Monto</th>
                      <th className="num">USD</th>
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
                            ? formatBs(movement.amount)
                            : `${movement.currency} ${number(movement.amount)}`}
                        </td>
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
                  <th className="num">Apertura USD</th>
                  <th className="num">Esperado USD</th>
                  <th className="num">Contado USD</th>
                  <th className="num">Diferencia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const diff = Number(row.difference_usd) || 0
                  return (
                    <tr key={row.id}>
                      <td>{formatDate(row.opened_at)}</td>
                      <td className="num">{money(row.opening_usd)}</td>
                      <td className="num">{money(row.expected_usd)}</td>
                      <td className="num">{money(row.counted_usd)}</td>
                      <td className={`num ${diff === 0 ? 'positive' : diff > 0 ? 'positive' : 'negative'}`}>
                        {money(diff)}
                      </td>
                      <td><span className="badge">Cerrada</span></td>
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
                <label>{capitalForm.currency === 'BS' ? 'Tasa Bs/USD' : 'Referencia'}</label>
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
          Cuenta el efectivo inicial. Puedes abrir con cero si no hay fondo.
        </p>
        <div className="form-grid">
          <div className="field">
            <label>Efectivo USD</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={openingUsd}
              onChange={(e) => setOpeningUsd(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="field">
            <label>Efectivo Bs</label>
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
        </div>
      </Modal>

      <Modal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        title="Cerrar caja"
        icon={Lock}
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
          Esperado: <strong>{money(expectedUsd)}</strong> USD ·{' '}
          <strong>{formatBs(expectedBs)}</strong>. Cuenta el efectivo real y escribe los totales.
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Contado USD</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={countedUsd}
              onChange={(e) => setCountedUsd(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="field">
            <label>Contado Bs</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={countedBs}
              onChange={(e) => setCountedBs(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="flex justify-between gap-2 mt-2">
          <span className="small muted">Diferencia USD</span>
          <strong className={diffUsd === 0 ? 'positive' : diffUsd > 0 ? 'positive' : 'negative'}>
            {money(diffUsd)}
          </strong>
        </div>
        <div className="flex justify-between gap-2 mt-1">
          <span className="small muted">Diferencia Bs</span>
          <strong className={diffBs === 0 ? 'positive' : diffBs > 0 ? 'positive' : 'negative'}>
            {formatBs(diffBs)}
          </strong>
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
    </>
  )
}
