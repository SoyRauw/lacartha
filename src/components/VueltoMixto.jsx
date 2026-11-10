import { Banknote, Coins, RefreshCw, Smartphone } from 'lucide-react'
import BillPicker from './BillPicker'
import { emptyBillCounts, proposeChange, sumBills } from '../lib/bills'
import { bs as formatBs, money } from '../lib/currency'
import styles from './VueltoMixto.module.css'

function emptyChange() {
  return {
    bills: emptyBillCounts(),
    bs: '',
    pm: '',
    pmReference: '',
  }
}

export default function VueltoMixto({
  changeDue = 0,
  drawer = emptyBillCounts(),
  rate = 0,
  value,
  onChange,
  disabled = false,
}) {
  const current = value || emptyChange()
  const due = Math.max(0, Number(changeDue) || 0)
  const effectiveRate = Number(rate) || 0
  const billsUsd = sumBills(current.bills || {})
  const bsAmount = Number(current.bs) || 0
  const bsUsd = effectiveRate > 0 ? bsAmount / effectiveRate : 0
  const pmUsd = Number(current.pm) || 0
  const covered = billsUsd + bsUsd + pmUsd
  const remaining = Math.round((due - covered) * 100) / 100
  const excess = remaining < -0.009 ? Math.abs(remaining) : 0

  const patch = (next) => onChange?.({ ...current, ...next })

  const propose = () => {
    const { proposal } = proposeChange(due, drawer)
    onChange?.({
      bills: proposal,
      bs: '',
      pm: '',
      pmReference: '',
    })
  }

  const coverWithBs = () => {
    if (effectiveRate <= 0 || remaining <= 0) return
    patch({
      bills: emptyBillCounts(),
      bs: (remaining * effectiveRate).toFixed(2),
      pm: '',
      pmReference: '',
    })
  }

  const coverWithPm = () => {
    if (remaining <= 0) return
    patch({
      bills: emptyBillCounts(),
      bs: '',
      pm: remaining.toFixed(2),
      pmReference: current.pmReference || '',
    })
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Vuelto</p>
          <p className={styles.due}>{money(due)}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-sm" onClick={propose} disabled={disabled}>
            <RefreshCw size={13} /> Proponer con cajón
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onChange?.(emptyChange())}
            disabled={disabled}
          >
            Limpiar
          </button>
        </div>
      </div>

      <div className={styles.methods}>
        <div className={styles.method}>
          <div className={styles.methodHead}>
            <span className={styles.methodTitle}>
              <Banknote size={14} /> Billetes USD
            </span>
            <strong>{money(billsUsd)}</strong>
          </div>
          <BillPicker
            value={current.bills}
            onChange={(bills) => patch({ bills })}
            disabled={disabled}
            compact
            showTotal={false}
            showClear={false}
            label=""
          />
        </div>

        <div className={styles.method}>
          <div className={styles.methodHead}>
            <span className={styles.methodTitle}>
              <Coins size={14} /> Bs en efectivo
            </span>
            <strong>{bsUsd > 0 ? `≈ ${money(bsUsd)}` : '—'}</strong>
          </div>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={current.bs}
            onChange={(e) => patch({ bs: e.target.value })}
            placeholder={effectiveRate > 0 ? 'Bs entregados' : 'Sin tasa'}
            disabled={disabled || effectiveRate <= 0}
          />
          {bsAmount > 0 ? (
            <p className={styles.hint}>{formatBs(bsAmount)} a la tasa EUR del día</p>
          ) : null}
          {remaining > 0 && effectiveRate > 0 ? (
            <button
              type="button"
              className={styles.coverBtn}
              onClick={coverWithBs}
              disabled={disabled}
            >
              Cubrir el resto con Bs
            </button>
          ) : null}
        </div>

        <div className={styles.method}>
          <div className={styles.methodHead}>
            <span className={styles.methodTitle}>
              <Smartphone size={14} /> Pago móvil
            </span>
            <strong>{pmUsd > 0 ? money(pmUsd) : '—'}</strong>
          </div>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={current.pm}
            onChange={(e) => patch({ pm: e.target.value })}
            placeholder="Monto en USD"
            disabled={disabled}
          />
          <input
            className="input mt-1"
            value={current.pmReference || ''}
            onChange={(e) => patch({ pmReference: e.target.value })}
            placeholder="Referencia (opcional)"
            disabled={disabled || pmUsd <= 0}
          />
          {remaining > 0 ? (
            <button
              type="button"
              className={styles.coverBtn}
              onClick={coverWithPm}
              disabled={disabled}
            >
              Cubrir el resto con pago móvil
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>Billetes</span>
          <strong>{money(billsUsd)}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Bs</span>
          <strong>{bsUsd > 0 ? `≈ ${money(bsUsd)}` : '—'}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Pago móvil</span>
          <strong>{pmUsd > 0 ? money(pmUsd) : '—'}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Cubierto</span>
          <strong className={remaining <= 0.009 && excess === 0 ? 'positive' : ''}>
            {money(covered)}
          </strong>
        </div>
        {remaining > 0.009 ? (
          <p className={styles.warning}>Faltan {money(remaining)} por cubrir.</p>
        ) : null}
        {excess > 0.009 ? (
          <p className={styles.warning}>
            Te pasaste por {money(excess)}. Ajusta el vuelto.
          </p>
        ) : null}
        {remaining >= -0.009 && remaining <= 0.009 ? (
          <p className={styles.ok}>Vuelto cuadrado.</p>
        ) : null}
      </div>
    </div>
  )
}

export function isChangeCovered(value, changeDue, rate) {
  const billsUsd = sumBills(value?.bills || {})
  const bsUsd = Number(rate) > 0 ? (Number(value?.bs) || 0) / Number(rate) : 0
  const pmUsd = Number(value?.pm) || 0
  const covered = billsUsd + bsUsd + pmUsd
  return Math.abs(covered - (Number(changeDue) || 0)) <= 0.012
}

export { emptyChange }
