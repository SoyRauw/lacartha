import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  Calculator,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Pencil,
  Phone,
  QrCode,
  RefreshCw,
  Save,
  Settings,
  Store,
  Wallet,
} from 'lucide-react'
import QRCode from 'qrcode'
import {
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { useCatalog } from '../../hooks/useCatalog'
import { supabase } from '../../lib/supabase'
import { LOGO_URL } from '../../lib/assets'
import { refreshCatalog, readCatalogFromDb } from '../../lib/catalog'
import { db } from '../../lib/db'
import { RATE_SOURCES, BUSINESS_INSTAGRAM_HANDLE, BUSINESS_PHONE } from '../../lib/constants'
import { money, number, parseNumber, rate as formatRate } from '../../lib/currency'
import { ensureDailyRates, saveRateSnapshot } from '../../lib/rates'

const EMPTY_PAYMENT = {
  id: null,
  code: '',
  name: '',
  currency: 'USD',
  active: true,
  affects_cash: false,
  requires_reference: false,
  detailsText: '{}',
  qr_url: '',
}

function detailsToText(details) {
  try {
    return JSON.stringify(details || {}, null, 2)
  } catch {
    return '{}'
  }
}

function formatDetails(details) {
  if (!details || typeof details !== 'object') return ''
  return Object.entries(details)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}

export default function AdminSettings() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [business, setBusiness] = useState(null)
  const [paymentMethods, setPaymentMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetchingRates, setFetchingRates] = useState(false)
  const [paymentModal, setPaymentModal] = useState(false)
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT)
  const [qr, setQr] = useState('')
  const [rates, setRates] = useState({ bcv_usd: '', bcv_eur: '', usdt: '1' })
  const [publicRateSource, setPublicRateSource] = useState('bcv_eur')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [businessRes, paymentsRes, rateRes] = await Promise.all([
        supabase.from('business_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('payment_methods').select('*').order('sort_order'),
        supabase
          .from('rate_snapshots')
          .select('*')
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (businessRes.error) throw businessRes.error
      if (paymentsRes.error) throw paymentsRes.error
      setBusiness(businessRes.data || null)
      setPaymentMethods(paymentsRes.data || [])
      setPublicRateSource(businessRes.data?.public_rate_source || 'bcv_eur')
      if (rateRes.data) {
        setRates({
          bcv_usd: rateRes.data.bcv_usd ? String(rateRes.data.bcv_usd) : '',
          bcv_eur: rateRes.data.bcv_eur ? String(rateRes.data.bcv_eur) : '',
          usdt: rateRes.data.usdt ? String(rateRes.data.usdt) : '1',
        })
      }
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudieron cargar los ajustes', 'error')
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    load()
  }, [load])

  const publicMenuUrl = `${window.location.origin}${import.meta.env.BASE_URL}menu`

  useEffect(() => {
    QRCode.toDataURL(publicMenuUrl, {
      width: 640,
      margin: 1,
      color: { dark: '#4A1C00', light: '#FFF6E5' },
    })
      .then(setQr)
      .catch((e) => console.warn('QR', e))
  }, [publicMenuUrl])

  const latestRate = useMemo(() => {
    if (catalog.rate) return catalog.rate
    return null
  }, [catalog.rate])

  const handleSaveBusiness = async () => {
    if (!business) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('business_settings')
        .update({
          instagram_url: business.instagram_url || null,
          phone: business.phone || null,
          whatsapp_phone: business.whatsapp_phone || null,
          delivery_enabled: business.delivery_enabled !== false,
          pickup_enabled: business.pickup_enabled !== false,
          public_menu_enabled: business.public_menu_enabled !== false,
          public_rate_source: publicRateSource,
        })
        .eq('id', 1)
      if (error) throw error
      await refreshCatalog()
      push('Ajustes del negocio guardados', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudieron guardar los ajustes', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleFetchRates = async () => {
    setFetchingRates(true)
    try {
      const saved = await ensureDailyRates({ force: true })
      setRates({
        bcv_usd: saved?.bcv_usd ? String(saved.bcv_usd) : '',
        bcv_eur: saved?.bcv_eur ? String(saved.bcv_eur) : '',
        usdt: saved?.usdt ? String(saved.usdt) : '1',
      })
      await refreshCatalog()
      push('Tasas actualizadas desde la API', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudieron consultar las tasas', 'error')
    } finally {
      setFetchingRates(false)
    }
  }

  const handleSaveRates = async () => {
    setSaving(true)
    try {
      await saveRateSnapshot({
        bcv_usd: parseNumber(rates.bcv_usd),
        bcv_eur: parseNumber(rates.bcv_eur),
        usdt: parseNumber(rates.usdt) || 1,
        source: 'manual',
      })
      await refreshCatalog()
      push('Tasas guardadas', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudieron guardar las tasas', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openPayment = (method) => {
    setPaymentForm({
      id: method.id,
      code: method.code,
      name: method.name,
      currency: method.currency,
      active: method.active !== false,
      affects_cash: method.affects_cash === true,
      requires_reference: method.requires_reference === true,
      detailsText: detailsToText(method.details),
      qr_url: method.qr_url || '',
    })
    setPaymentModal(true)
  }

  const savePayment = async () => {
    setSaving(true)
    try {
      let details = {}
      try {
        details = JSON.parse(paymentForm.detailsText || '{}')
      } catch {
        throw new Error('Los detalles deben ser un JSON válido')
      }
      const { error } = await supabase
        .from('payment_methods')
        .update({
          name: paymentForm.name,
          currency: paymentForm.currency,
          active: paymentForm.active,
          affects_cash: paymentForm.affects_cash,
          requires_reference: paymentForm.requires_reference,
          details,
          qr_url: paymentForm.qr_url || null,
        })
        .eq('id', paymentForm.id)
      if (error) throw error
      await refreshCatalog()
      await load()
      setPaymentModal(false)
      push('Medio de pago actualizado', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar el medio de pago', 'error')
    } finally {
      setSaving(false)
    }
  }

  const copyDetails = async (method) => {
    const text = `${method.name}\n${formatDetails(method.details)}`
    try {
      await navigator.clipboard.writeText(text)
      push('Datos copiados', 'success')
    } catch {
      push('No se pudo copiar', 'error')
    }
  }

  const downloadBackup = async () => {
    try {
      const catalogData = await readCatalogFromDb()
      const pendingSales = await db.pending_sales.toArray()
      const payload = {
        exportedAt: new Date().toISOString(),
        business: catalogData.business,
        catalog: catalogData,
        pendingSales,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lacartha-respaldo-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      push('Respaldo descargado', 'success')
    } catch (e) {
      push(e.message || 'No se pudo generar el respaldo', 'error')
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Ajustes" subtitle="Tasas, medios de pago y menú público." icon={Settings} />
        <Loading label="Cargando ajustes..." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Ajustes"
        subtitle="Tasas, medios de pago, menú público y respaldos."
        icon={Settings}
      />

      <div className="stat-grid mb-3">
        <StatCard
          icon={Calculator}
          label="BCV USD"
          value={latestRate?.bcv_usd ? formatRate(latestRate.bcv_usd) : '—'}
          hint="Tasa del dólar"
        />
        <StatCard
          icon={Calculator}
          label="BCV EUR"
          value={latestRate?.bcv_eur ? formatRate(latestRate.bcv_eur) : '—'}
          hint="Tasa del euro"
        />
        <StatCard
          icon={Wallet}
          label="USDT"
          value={latestRate?.usdt ? formatRate(latestRate.usdt) : '1,00'}
          hint="Binance / USDT"
        />
        <StatCard
          icon={Globe}
          label="Menú público"
          value={business?.public_menu_enabled === false ? 'Oculto' : 'Activo'}
          hint="/menu"
        />
      </div>

      <div className="grid-2">
        <div className="card">
          <p className="card-title">
            <Store size={16} /> Identidad del negocio
          </p>
          <div className="flex items-center gap-3 mb-3">
            <img
              src={LOGO_URL}
              alt="La Cartha"
              style={{ width: 120, borderRadius: 12, background: 'var(--brown)' }}
            />
            <div>
              <p className="row-title">La Cartha</p>
              <p className="row-meta">by Valentina Castro</p>
              <p className="tiny muted mt-1">Marca fija del sistema</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Instagram</label>
              <input
                className="input"
                value={business?.instagram_url || ''}
                onChange={(e) => setBusiness((prev) => ({ ...prev, instagram_url: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input
                className="input"
                value={business?.phone || ''}
                onChange={(e) => setBusiness((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
          </div>
          <div className="form-grid mt-2">
            <div className="field">
              <label>WhatsApp (solo números)</label>
              <input
                className="input"
                value={business?.whatsapp_phone || ''}
                onChange={(e) => setBusiness((prev) => ({ ...prev, whatsapp_phone: e.target.value }))}
                placeholder="584244315118"
              />
            </div>
            <div className="field">
              <label>Tasa por defecto del menú</label>
              <select
                className="select"
                value={publicRateSource}
                onChange={(e) => setPublicRateSource(e.target.value)}
              >
                {RATE_SOURCES.filter((r) => ['bcv_usd', 'bcv_eur'].includes(r.value)).map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-4 mt-2 wrap">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={business?.delivery_enabled !== false}
                onChange={(e) => setBusiness((prev) => ({ ...prev, delivery_enabled: e.target.checked }))}
              />
              Delivery
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={business?.pickup_enabled !== false}
                onChange={(e) => setBusiness((prev) => ({ ...prev, pickup_enabled: e.target.checked }))}
              />
              Pickup
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={business?.public_menu_enabled !== false}
                onChange={(e) => setBusiness((prev) => ({ ...prev, public_menu_enabled: e.target.checked }))}
              />
              Menú público activo
            </label>
          </div>
          <button type="button" className="btn btn-primary mt-3" onClick={handleSaveBusiness} disabled={saving}>
            <Save size={15} /> Guardar ajustes
          </button>
        </div>

        <div className="card">
          <p className="card-title">
            <Calculator size={16} /> Tasas del día
          </p>
          <p className="small muted mb-2">
            Se usan para convertir Bs y mostrar precios. El menú público usa la tasa por defecto.
          </p>
          <div className="form-grid-3">
            <div className="field">
              <label>BCV USD</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={rates.bcv_usd}
                onChange={(e) => setRates((prev) => ({ ...prev, bcv_usd: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>BCV EUR</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={rates.bcv_eur}
                onChange={(e) => setRates((prev) => ({ ...prev, bcv_eur: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>USDT</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={rates.usdt}
                onChange={(e) => setRates((prev) => ({ ...prev, usdt: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3 wrap">
            <button type="button" className="btn" onClick={handleFetchRates} disabled={fetchingRates}>
              <RefreshCw size={15} className={fetchingRates ? 'spin' : ''} /> Consultar tasas
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSaveRates} disabled={saving}>
              <Save size={15} /> Guardar tasas
            </button>
          </div>
          <p className="tiny muted mt-2">
            Última actualización: {latestRate?.fetched_at ? new Date(latestRate.fetched_at).toLocaleString('es-VE') : '—'}
            {' · '}
            Se actualiza automáticamente al iniciar sesión.
          </p>
        </div>
      </div>

      <div className="grid-2 mt-3">
        <div className="card">
          <p className="card-title">
            <Wallet size={16} /> Medios de pago
          </p>
          <p className="small muted mb-2">
            Se usan en el POS y en la caja. No se muestran en el menú público; los datos se
            envían manualmente por WhatsApp.
          </p>
          {paymentMethods.map((method) => (
            <div className="flex items-center gap-2" key={method.id} style={{ marginBottom: 8 }}>
              <span className="badge badge-orange">{method.currency}</span>
              <span className="small" style={{ flex: 1 }}>{method.name}</span>
              {method.affects_cash ? <span className="badge badge-green">Caja</span> : null}
              <button type="button" className="btn btn-sm" onClick={() => copyDetails(method)}>
                <Copy size={12} />
              </button>
              <button type="button" className="btn btn-sm" onClick={() => openPayment(method)}>
                <Pencil size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="card">
          <p className="card-title">
            <QrCode size={16} /> Menú público
          </p>
          <div className="flex gap-3 items-center wrap">
            {qr ? (
              <img
                src={qr}
                alt="QR del menú"
                style={{ width: 150, borderRadius: 12, border: '1px solid var(--line)' }}
              />
            ) : null}
            <div style={{ flex: 1, minWidth: 180 }}>
              <p className="small muted">Comparte este link o imprime el QR.</p>
              <p className="small" style={{ wordBreak: 'break-all', marginTop: 6 }}>{publicMenuUrl}</p>
              <div className="flex gap-2 mt-2 wrap">
                <a className="btn btn-sm" href={publicMenuUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Abrir
                </a>
                <a className="btn btn-sm" href={qr} download="lacartha-menu-qr.png">
                  <Download size={13} /> QR
                </a>
              </div>
            </div>
          </div>
          <div className="divider" />
          <p className="small muted">
            El menú público muestra productos y precios, y permite armar un pedido que se envía
            por WhatsApp. Los datos de pago se comparten manualmente.
          </p>
        </div>
      </div>

      <div className="card mt-3">
        <p className="card-title">
          <Download size={16} /> Datos y respaldo
        </p>
        <div className="flex gap-2 wrap">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await refreshCatalog()
                push('Menú actualizado', 'success')
              } catch (e) {
                push(e.message || 'No se pudo actualizar', 'error')
              }
            }}
          >
            <RefreshCw size={15} /> Actualizar menú
          </button>
          <button type="button" className="btn" onClick={downloadBackup}>
            <Download size={15} /> Descargar respaldo JSON
          </button>
        </div>
        <p className="tiny muted mt-2">
          El respaldo incluye el catálogo local y las ventas pendientes de sincronizar.
        </p>
      </div>

      <Modal
        open={paymentModal}
        onClose={() => setPaymentModal(false)}
        title={`Editar ${paymentForm.name || 'medio de pago'}`}
        icon={Wallet}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setPaymentModal(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={savePayment} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Nombre</label>
            <input
              className="input"
              value={paymentForm.name}
              onChange={(e) => setPaymentForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Moneda</label>
            <select
              className="select"
              value={paymentForm.currency}
              onChange={(e) => setPaymentForm((prev) => ({ ...prev, currency: e.target.value }))}
            >
              <option value="USD">USD</option>
              <option value="BS">Bs</option>
              <option value="USDT">USDT</option>
            </select>
          </div>
        </div>
        <div className="flex gap-4 mt-2 wrap">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={paymentForm.active}
              onChange={(e) => setPaymentForm((prev) => ({ ...prev, active: e.target.checked }))}
            />
            Activo
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={paymentForm.affects_cash}
              onChange={(e) => setPaymentForm((prev) => ({ ...prev, affects_cash: e.target.checked }))}
            />
            Afecta caja
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={paymentForm.requires_reference}
              onChange={(e) => setPaymentForm((prev) => ({ ...prev, requires_reference: e.target.checked }))}
            />
            Pide referencia
          </label>
        </div>
        <div className="field mt-2">
          <label>Datos para copiar (JSON)</label>
          <textarea
            className="textarea"
            style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 12 }}
            value={paymentForm.detailsText}
            onChange={(e) => setPaymentForm((prev) => ({ ...prev, detailsText: e.target.value }))}
          />
          <span className="tiny muted">
            Ej. {'{"bank":"Mercantil","id":"V.29.986.494","phone":"0424-4315118"}'}
          </span>
        </div>
        <div className="field mt-2">
          <label>QR de pago (URL, opcional)</label>
          <input
            className="input"
            value={paymentForm.qr_url}
            onChange={(e) => setPaymentForm((prev) => ({ ...prev, qr_url: e.target.value }))}
            placeholder="https://..."
          />
        </div>
      </Modal>
    </>
  )
}
