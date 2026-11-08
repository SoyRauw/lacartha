import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="page-header">
      <div>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {Icon ? <Icon size={24} style={{ color: 'var(--orange)' }} /> : null}
          {title}
        </h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  )
}

export function StatCard({ icon: Icon, label, value, hint, tone }) {
  const color =
    tone === 'danger'
      ? 'var(--red)'
      : tone === 'success'
        ? 'var(--green)'
        : tone === 'warning'
          ? 'var(--orange)'
          : undefined
  return (
    <div className="stat-card">
      <div>
        <p className="stat-label">
          {Icon ? <Icon size={13} /> : null}
          {label}
        </p>
        <p className="stat-value" style={color ? { color } : undefined}>
          {value}
        </p>
      </div>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      {Icon ? (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            background: 'var(--cream-2)',
            color: 'var(--orange)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <Icon size={24} />
        </div>
      ) : null}
      {title ? (
        <p style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{title}</p>
      ) : null}
      {text ? <p>{text}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  )
}

export function Loading({ label = 'Cargando...' }) {
  return (
    <div className="loading-screen">
      <Loader2
        size={30}
        className="spin"
        style={{ animation: 'spin 0.8s linear infinite', color: 'var(--orange)' }}
      />
      <span>{label}</span>
    </div>
  )
}

export function ErrorAlert({ children }) {
  if (!children) return null
  return <div className="alert alert-error">{children}</div>
}

export function Modal({ open, onClose, title, icon: Icon, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <motion.div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
      >
        <div className="modal-header">
          {Icon ? <Icon size={18} style={{ color: 'var(--orange)' }} /> : null}
          <h2>{title}</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = '¿Confirmar?',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = true,
  busy = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={AlertTriangle}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--muted)', lineHeight: 1.55 }}>{message}</p>
    </Modal>
  )
}

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((message, type = 'info', duration = 3800) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
  }, [])

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map((toast) => {
          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
                ? AlertTriangle
                : Info
          return (
            <motion.div
              key={toast.id}
              className={`toast toast-${toast.type}`}
              initial={{ opacity: 0, x: 30, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              onClick={() => remove(toast.id)}
            >
              <Icon size={17} />
              <span>{toast.message}</span>
            </motion.div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider')
  return ctx
}
