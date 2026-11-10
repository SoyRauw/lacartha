import { Minus, Plus } from 'lucide-react'
import {
  BILL_DENOMINATIONS,
  emptyBillCounts,
  normalizeBillCounts,
  sumBills,
} from '../lib/bills'
import { money } from '../lib/currency'
import styles from './BillPicker.module.css'

export default function BillPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  showTotal = true,
  showClear = true,
  label = 'Billetes',
}) {
  const counts = normalizeBillCounts(value)

  const update = (denom, delta) => {
    if (!onChange) return
    const next = {
      ...counts,
      [denom]: Math.max(0, (parseInt(counts[denom], 10) || 0) + delta),
    }
    onChange(next)
  }

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`}>
      {label ? <p className={styles.label}>{label}</p> : null}
      <div className={styles.grid}>
        {BILL_DENOMINATIONS.map((denom) => {
          const qty = parseInt(counts[denom], 10) || 0
          return (
            <div className={`${styles.tile} ${qty > 0 ? styles.tileActive : ''}`} key={denom}>
              <span className={styles.denom}>${denom}</span>
              <div className={styles.stepper}>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => update(denom, -1)}
                  disabled={disabled || qty <= 0}
                  aria-label={`Quitar un billete de $${denom}`}
                >
                  <Minus size={12} />
                </button>
                <span className={styles.qty}>{qty}</span>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => update(denom, 1)}
                  disabled={disabled}
                  aria-label={`Agregar un billete de $${denom}`}
                >
                  <Plus size={12} />
                </button>
              </div>
              <span className={styles.subtotal}>
                {qty > 0 ? money(qty * denom) : '—'}
              </span>
            </div>
          )
        })}
      </div>

      <div className={styles.footer}>
        {showTotal ? (
          <div className={styles.total}>
            <span>Total en billetes</span>
            <strong>{money(sumBills(counts))}</strong>
          </div>
        ) : (
          <span />
        )}
        {showClear ? (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => onChange?.(emptyBillCounts())}
            disabled={disabled}
          >
            Empezar en cero
          </button>
        ) : null}
      </div>
    </div>
  )
}
