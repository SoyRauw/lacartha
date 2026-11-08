import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calculator,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Wheat,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { useCatalog } from '../../hooks/useCatalog'
import { supabase } from '../../lib/supabase'
import { refreshCatalog } from '../../lib/catalog'
import { BASE_UNIT_LABELS, UNIT_OPTIONS } from '../../lib/constants'
import { money, moneyPrecise, number, parseNumber } from '../../lib/currency'
import { getRateValue } from '../../lib/rates'

const EMPTY_FORM = {
  id: null,
  name: '',
  category: '',
  base_unit: 'g',
  purchase_unit: 'kg',
  conversion_factor: '1000',
  purchase_price: '',
  stock_base: '0',
  min_stock_base: '0',
  track_stock: true,
  active: true,
  notes: '',
}

export default function AdminIngredients() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [bsPrice, setBsPrice] = useState('')
  const [bsRate, setBsRate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: supaError } = await supabase
        .from('ingredients')
        .select('*')
        .order('name', { ascending: true })
      if (supaError) throw supaError
      setIngredients(data || [])
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudieron cargar los ingredientes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const rate = catalog.rate
    const initial = rate ? getRateValue(rate, 'bcv_eur') || getRateValue(rate, 'bcv_usd') : 0
    setBsRate(initial ? String(initial) : '')
  }, [catalog.rate])

  const stats = useMemo(() => {
    const active = ingredients.filter((i) => i.active !== false)
    const sinCosto = active.filter((i) => !(Number(i.avg_cost_usd) > 0)).length
    const lowStock = active.filter(
      (i) =>
        i.track_stock &&
        Number(i.min_stock_base) > 0 &&
        Number(i.stock_base) <= Number(i.min_stock_base),
    ).length
    return { total: active.length, sinCosto, lowStock }
  }, [ingredients])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ingredients.filter((ing) => {
      if (filter === 'sin-costo' && Number(ing.avg_cost_usd) > 0) return false
      if (filter === 'bajo' && !(ing.track_stock && Number(ing.stock_base) <= Number(ing.min_stock_base))) {
        return false
      }
      if (filter === 'inactivos' && ing.active !== false) return false
      if (filter !== 'inactivos' && ing.active === false) return false
      if (!q) return true
      return (
        (ing.name || '').toLowerCase().includes(q) ||
        (ing.category || '').toLowerCase().includes(q)
      )
    })
  }, [ingredients, search, filter])

  const openNew = () => {
    setForm({ ...EMPTY_FORM })
    setBsPrice('')
    setModalOpen(true)
  }

  const openEdit = (ing) => {
    const purchasePrice =
      Number(ing.conversion_factor) > 0
        ? (Number(ing.avg_cost_usd) * Number(ing.conversion_factor)).toFixed(4)
        : ''
    setForm({
      id: ing.id,
      name: ing.name || '',
      category: ing.category || '',
      base_unit: ing.base_unit || 'g',
      purchase_unit: ing.purchase_unit || 'unit',
      conversion_factor: String(ing.conversion_factor ?? 1),
      purchase_price: purchasePrice,
      stock_base: String(ing.stock_base ?? 0),
      min_stock_base: String(ing.min_stock_base ?? 0),
      track_stock: ing.track_stock !== false,
      active: ing.active !== false,
      notes: ing.notes || '',
    })
    setBsPrice('')
    setModalOpen(true)
  }

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleConvertBs = () => {
    const price = parseNumber(bsPrice)
    const rate = parseNumber(bsRate)
    if (price <= 0 || rate <= 0) {
      push('Escribe el precio en Bs y una tasa válida', 'error')
      return
    }
    set('purchase_price', (price / rate).toFixed(4))
    push(`Precio convertido a ${money(price / rate)} por ${form.purchase_unit}`, 'success')
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      push('El nombre es obligatorio', 'error')
      return
    }
    const conversion = parseNumber(form.conversion_factor) || 0
    const purchasePrice = parseNumber(form.purchase_price) || 0
    if (conversion <= 0) {
      push('El factor de conversión debe ser mayor a cero', 'error')
      return
    }
    if (purchasePrice < 0) {
      push('El precio no puede ser negativo', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        base_unit: form.base_unit,
        purchase_unit: form.purchase_unit.trim() || 'unit',
        conversion_factor: conversion,
        avg_cost_usd: purchasePrice / conversion,
        stock_base: parseNumber(form.stock_base),
        min_stock_base: parseNumber(form.min_stock_base),
        track_stock: form.track_stock,
        active: form.active,
        notes: form.notes.trim() || null,
      }

      const query = form.id
        ? supabase.from('ingredients').update(payload).eq('id', form.id)
        : supabase.from('ingredients').insert(payload)
      const { error: saveError } = await query
      if (saveError) throw saveError

      await refreshCatalog().catch(() => {})
      await load()
      setModalOpen(false)
      push(form.id ? 'Ingrediente actualizado' : 'Ingrediente creado', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const conversion = parseNumber(form.conversion_factor) || 1
  const purchasePrice = parseNumber(form.purchase_price) || 0
  const baseCost = purchasePrice / conversion

  return (
    <>
      <PageHeader
        title="Materia prima"
        subtitle="Precios de compra, unidades, stock y costo por gramo."
        icon={Wheat}
        actions={
          <>
            <Link to="/admin/compras" className="btn">
              <RefreshCw size={15} /> Registrar compra
            </Link>
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Plus size={16} /> Nuevo ingrediente
            </button>
          </>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={Package} label="Ingredientes activos" value={stats.total} hint="Materia prima cargada" />
        <StatCard
          icon={AlertTriangle}
          label="Sin costo"
          value={stats.sinCosto}
          tone={stats.sinCosto > 0 ? 'warning' : 'success'}
          hint="Falta cargar el precio de compra"
        />
        <StatCard
          icon={Scale}
          label="Stock bajo"
          value={stats.lowStock}
          tone={stats.lowStock > 0 ? 'danger' : 'success'}
          hint="Por debajo del mínimo"
        />
        <StatCard icon={Calculator} label="Tasa BCV EUR" value={catalog.rate?.bcv_eur ? number(catalog.rate.bcv_eur) : '—'} hint="Para convertir Bs a USD" />
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
              placeholder="Buscar ingrediente o categoría..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="sin-costo">Sin costo</option>
            <option value="bajo">Stock bajo</option>
            <option value="inactivos">Archivados</option>
          </select>
          <button type="button" className="btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Actualizar
          </button>
        </div>

        {loading ? (
          <Loading label="Cargando materia prima..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wheat}
            title="No hay ingredientes"
            text="Crea el primero o revisa el filtro."
            action={
              <button type="button" className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Nuevo ingrediente
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Compra</th>
                  <th>Costo compra</th>
                  <th>Costo base</th>
                  <th>Stock</th>
                  <th>Mínimo</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((ing) => {
                  const low =
                    ing.track_stock &&
                    Number(ing.min_stock_base) > 0 &&
                    Number(ing.stock_base) <= Number(ing.min_stock_base)
                  const noCost = !(Number(ing.avg_cost_usd) > 0)
                  return (
                    <tr key={ing.id}>
                      <td>
                        <div className="row-title">{ing.name}</div>
                        <div className="row-meta">{ing.category || 'Sin categoría'}</div>
                      </td>
                      <td>
                        <div>1 {ing.purchase_unit}</div>
                        <div className="row-meta">
                          = {number(ing.conversion_factor)} {BASE_UNIT_LABELS[ing.base_unit] || ing.base_unit}
                        </div>
                      </td>
                      <td className="num">
                        {money(Number(ing.avg_cost_usd) * Number(ing.conversion_factor))}
                      </td>
                      <td className="num">
                        <strong>{moneyPrecise(ing.avg_cost_usd, 4)}</strong>
                        <div className="row-meta">
                          por {BASE_UNIT_LABELS[ing.base_unit] || ing.base_unit}
                        </div>
                      </td>
                      <td className="num">
                        {number(ing.stock_base)} {BASE_UNIT_LABELS[ing.base_unit] || ing.base_unit}
                      </td>
                      <td className="num">
                        {Number(ing.min_stock_base) > 0
                          ? `${number(ing.min_stock_base)} ${BASE_UNIT_LABELS[ing.base_unit] || ing.base_unit}`
                          : '—'}
                      </td>
                      <td>
                        <div className="flex gap-2 wrap">
                          {noCost ? <span className="badge badge-yellow">Sin costo</span> : null}
                          {low ? <span className="badge badge-red">Stock bajo</span> : null}
                          {ing.active === false ? <span className="badge">Archivado</span> : null}
                          {!noCost && !low && ing.active !== false ? (
                            <span className="badge badge-green">OK</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <button type="button" className="btn btn-sm" onClick={() => openEdit(ing)}>
                          <Pencil size={13} /> Editar
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Editar ingrediente' : 'Nuevo ingrediente'}
        icon={Wheat}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar ingrediente'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ej. Harina leudante"
            />
          </div>
          <div className="field">
            <label>Categoría</label>
            <input
              className="input"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="masa, proteína, salsa..."
            />
          </div>
        </div>

        <div className="divider" />

        <div className="form-grid-3">
          <div className="field">
            <label>Unidad base</label>
            <select className="select" value={form.base_unit} onChange={(e) => set('base_unit', e.target.value)}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Unidad de compra</label>
            <input
              className="input"
              value={form.purchase_unit}
              onChange={(e) => set('purchase_unit', e.target.value)}
              placeholder="kg, unidad, botella 1L..."
            />
          </div>
          <div className="field">
            <label>Factor de conversión</label>
            <input
              className="input"
              type="number"
              min="0.0001"
              step="0.01"
              value={form.conversion_factor}
              onChange={(e) => set('conversion_factor', e.target.value)}
            />
            <span className="tiny muted">
              1 {form.purchase_unit || 'compra'} = {number(conversion)} {BASE_UNIT_LABELS[form.base_unit]}
            </span>
          </div>
        </div>

        <div className="form-grid mt-2">
          <div className="field">
            <label>Precio de compra (USD por {form.purchase_unit || 'unidad'})</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.0001"
              value={form.purchase_price}
              onChange={(e) => set('purchase_price', e.target.value)}
              placeholder="Ej. 2.50"
            />
            <span className="tiny muted">
              Costo por {BASE_UNIT_LABELS[form.base_unit]}: {moneyPrecise(baseCost, 4)}
            </span>
          </div>
          <div className="field">
            <label>Stock actual ({BASE_UNIT_LABELS[form.base_unit]})</label>
            <input
              className="input"
              type="number"
              step="0.001"
              value={form.stock_base}
              onChange={(e) => set('stock_base', e.target.value)}
            />
            <span className="tiny muted">Se puede ajustar en el conteo semanal.</span>
          </div>
        </div>

        <div className="card card-tight mt-2" style={{ background: 'var(--cream)', boxShadow: 'none' }}>
          <p className="label mb-1">Convertir desde bolívares</p>
          <div className="form-grid-3">
            <div className="field">
              <label>Precio en Bs</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={bsPrice}
                onChange={(e) => setBsPrice(e.target.value)}
                placeholder="Bs"
              />
            </div>
            <div className="field">
              <label>Tasa Bs/USD</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={bsRate}
                onChange={(e) => setBsRate(e.target.value)}
                placeholder="Tasa"
              />
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={handleConvertBs}>
                <Calculator size={14} /> Calcular USD
              </button>
            </div>
          </div>
        </div>

        <div className="form-grid mt-2">
          <div className="field">
            <label>Stock mínimo ({BASE_UNIT_LABELS[form.base_unit]})</label>
            <input
              className="input"
              type="number"
              step="0.001"
              value={form.min_stock_base}
              onChange={(e) => set('min_stock_base', e.target.value)}
            />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.track_stock}
                onChange={(e) => set('track_stock', e.target.checked)}
              />
              Controlar stock
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              Activo
            </label>
          </div>
        </div>

        <div className="field mt-2">
          <label>Notas</label>
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Proveedor, marca, observaciones..."
          />
        </div>
      </Modal>
    </>
  )
}
