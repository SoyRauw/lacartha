import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calculator, FlaskConical, Pencil, Plus, RefreshCw, Trash2, Wheat } from 'lucide-react'
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
import { BASE_UNIT_LABELS } from '../../lib/constants'
import { money, moneyPrecise, number, parseNumber } from '../../lib/currency'

const YIELD_UNITS = [
  { value: 'portion', label: 'porciones' },
  { value: 'g', label: 'gramos' },
  { value: 'ml', label: 'mililitros' },
  { value: 'unit', label: 'unidades' },
]

const EMPTY_FORM = {
  id: null,
  name: '',
  yield_quantity: '1',
  yield_unit: 'portion',
  notes: '',
  active: true,
  items: [],
}

export default function AdminPreparations() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [preparations, setPreparations] = useState([])
  const [items, setItems] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [prepRes, itemsRes, ingRes] = await Promise.all([
        supabase.from('preparations').select('*').order('name'),
        supabase.from('preparation_items').select('*'),
        supabase.from('ingredients').select('*').order('name'),
      ])
      if (prepRes.error) throw prepRes.error
      if (itemsRes.error) throw itemsRes.error
      if (ingRes.error) throw ingRes.error
      setPreparations(prepRes.data || [])
      setItems(itemsRes.data || [])
      setIngredients(ingRes.data || [])
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudieron cargar las preparaciones')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const ingredientMap = useMemo(
    () => new Map(ingredients.map((ing) => [ing.id, ing])),
    [ingredients],
  )

  const itemsByPrep = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      if (!map.has(item.preparation_id)) map.set(item.preparation_id, [])
      map.get(item.preparation_id).push(item)
    }
    return map
  }, [items])

  const prepRows = useMemo(() => {
    return preparations.map((prep) => {
      const prepItems = itemsByPrep.get(prep.id) || []
      const total = prepItems.reduce((sum, item) => {
        const ing = ingredientMap.get(item.ingredient_id)
        return sum + (Number(item.quantity_base) || 0) * (Number(ing?.avg_cost_usd) || 0)
      }, 0)
      const yieldQty = Number(prep.yield_quantity) || 1
      return { ...prep, prepItems, total, perUnit: total / yieldQty }
    })
  }, [preparations, itemsByPrep, ingredientMap])

  const openNew = () => {
    setForm({ ...EMPTY_FORM, items: [{ ingredient_id: '', quantity_base: '' }] })
    setModalOpen(true)
  }

  const openEdit = (prep) => {
    const prepItems = itemsByPrep.get(prep.id) || []
    setForm({
      id: prep.id,
      name: prep.name || '',
      yield_quantity: String(prep.yield_quantity ?? 1),
      yield_unit: prep.yield_unit || 'portion',
      notes: prep.notes || '',
      active: prep.active !== false,
      items: prepItems.map((item) => ({
        ingredient_id: item.ingredient_id,
        quantity_base: String(item.quantity_base ?? ''),
      })),
    })
    setModalOpen(true)
  }

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const setItem = (index, key, value) => {
    setForm((prev) => {
      const next = [...prev.items]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, items: next }
    })
  }

  const addItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { ingredient_id: '', quantity_base: '' }],
    }))
  }

  const removeItem = (index) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }))
  }

  const formTotal = useMemo(() => {
    return form.items.reduce((sum, item) => {
      const ing = ingredientMap.get(item.ingredient_id)
      return sum + (parseNumber(item.quantity_base) || 0) * (Number(ing?.avg_cost_usd) || 0)
    }, 0)
  }, [form.items, ingredientMap])

  const formYield = parseNumber(form.yield_quantity) || 1
  const formPerUnit = formTotal / formYield

  const handleSave = async () => {
    if (!form.name.trim()) {
      push('El nombre es obligatorio', 'error')
      return
    }
    const yieldQty = parseNumber(form.yield_quantity)
    if (yieldQty <= 0) {
      push('El rendimiento debe ser mayor a cero', 'error')
      return
    }
    const cleanItems = form.items.filter(
      (item) => item.ingredient_id && parseNumber(item.quantity_base) > 0,
    )
    if (cleanItems.length === 0) {
      push('Agrega al menos un ingrediente con cantidad', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        yield_quantity: yieldQty,
        yield_unit: form.yield_unit,
        notes: form.notes.trim() || null,
        active: form.active,
      }

      let prepId = form.id
      if (prepId) {
        const { error: upError } = await supabase
          .from('preparations')
          .update(payload)
          .eq('id', prepId)
        if (upError) throw upError
        const { error: delError } = await supabase
          .from('preparation_items')
          .delete()
          .eq('preparation_id', prepId)
        if (delError) throw delError
      } else {
        const { data, error: insError } = await supabase
          .from('preparations')
          .insert(payload)
          .select()
          .single()
        if (insError) throw insError
        prepId = data.id
      }

      const rows = cleanItems.map((item) => ({
        preparation_id: prepId,
        ingredient_id: item.ingredient_id,
        quantity_base: parseNumber(item.quantity_base),
      }))
      const { error: itemsError } = await supabase.from('preparation_items').insert(rows)
      if (itemsError) throw itemsError

      await refreshCatalog().catch(() => {})
      await load()
      setModalOpen(false)
      push(form.id ? 'Preparación actualizada' : 'Preparación creada', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar la preparación', 'error')
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(() => {
    const total = prepRows.length
    const withCost = prepRows.filter((p) => p.total > 0).length
    const sinCosto = total - withCost
    return { total, sinCosto }
  }, [prepRows])

  return (
    <>
      <PageHeader
        title="Preparaciones"
        subtitle="Masa, salsas caseras y rendimiento por tanda."
        icon={FlaskConical}
        actions={
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> Nueva preparación
          </button>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={FlaskConical} label="Preparaciones" value={stats.total} hint="Masa y salsas caseras" />
        <StatCard
          icon={Calculator}
          label="Sin costo"
          value={stats.sinCosto}
          tone={stats.sinCosto > 0 ? 'warning' : 'success'}
          hint="Falta cargar materia prima"
        />
        <StatCard
          icon={Wheat}
          label="Ingredientes"
          value={ingredients.filter((i) => i.active !== false).length}
          hint="Disponibles para recetas"
        />
      </div>

      <div className="alert alert-warn mb-3">
        La masa y las salsas caseras se descuentan por porción al vender. No necesitas
        contar la masa: se descuentan sus ingredientes según el rendimiento.
      </div>

      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      {loading ? (
        <Loading label="Cargando preparaciones..." />
      ) : prepRows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FlaskConical}
            title="No hay preparaciones"
            text="Crea la masa o una salsa casera para usarla en tus recetas."
            action={
              <button type="button" className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Nueva preparación
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid-2">
          {prepRows.map((prep) => (
            <div className="card" key={prep.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="row-title" style={{ fontSize: 16 }}>{prep.name}</p>
                  <p className="row-meta">
                    Rinde {number(prep.yield_quantity)}{' '}
                    {YIELD_UNITS.find((u) => u.value === prep.yield_unit)?.label || prep.yield_unit}
                  </p>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => openEdit(prep)}>
                  <Pencil size={13} /> Editar
                </button>
              </div>

              <div className="divider" />

              <div className="flex justify-between gap-2">
                <div>
                  <p className="label">Costo de la tanda</p>
                  <p className="money" style={{ fontSize: 18 }}>{money(prep.total)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="label">Costo por porción</p>
                  <p className="money positive" style={{ fontSize: 18 }}>
                    {moneyPrecise(prep.perUnit, 4)}
                  </p>
                </div>
              </div>

              <div className="divider" />

              <p className="label mb-1">Ingredientes</p>
              <div className="flex wrap gap-2">
                {prep.prepItems.map((item) => {
                  const ing = ingredientMap.get(item.ingredient_id)
                  return (
                    <span className="chip" key={item.id}>
                      {ing?.name || 'Ingrediente'}: {number(item.quantity_base)}{' '}
                      {BASE_UNIT_LABELS[ing?.base_unit] || ''}
                    </span>
                  )
                })}
              </div>

              {prep.notes ? <p className="muted small mt-2">{prep.notes}</p> : null}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Editar preparación' : 'Nueva preparación'}
        icon={FlaskConical}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar preparación'}
            </button>
          </>
        }
      >
        <div className="form-grid-3">
          <div className="field">
            <label>Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ej. Masa"
            />
          </div>
          <div className="field">
            <label>Rendimiento</label>
            <input
              className="input"
              type="number"
              min="0.001"
              step="0.001"
              value={form.yield_quantity}
              onChange={(e) => set('yield_quantity', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Unidad de rendimiento</label>
            <select
              className="select"
              value={form.yield_unit}
              onChange={(e) => set('yield_unit', e.target.value)}
            >
              {YIELD_UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="divider" />

        <div className="flex items-center justify-between mb-2">
          <p className="card-title" style={{ margin: 0 }}>
            <Wheat size={16} /> Ingredientes de la tanda
          </p>
          <button type="button" className="btn btn-sm" onClick={addItem}>
            <Plus size={13} /> Agregar
          </button>
        </div>

        {form.items.length === 0 ? (
          <p className="muted small">Agrega al menos un ingrediente.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Cantidad</th>
                  <th>Costo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, index) => {
                  const ing = ingredientMap.get(item.ingredient_id)
                  const cost =
                    (parseNumber(item.quantity_base) || 0) *
                    (Number(ing?.avg_cost_usd) || 0)
                  return (
                    <tr key={index}>
                      <td>
                        <select
                          className="select"
                          value={item.ingredient_id}
                          onChange={(e) => setItem(index, 'ingredient_id', e.target.value)}
                        >
                          <option value="">Selecciona...</option>
                          {ingredients
                            .filter((i) => i.active !== false)
                            .map((i) => (
                              <option key={i.id} value={i.id}>{i.name}</option>
                            ))}
                        </select>
                      </td>
                      <td style={{ width: 150 }}>
                        <div className="flex items-center gap-2">
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.001"
                            value={item.quantity_base}
                            onChange={(e) => setItem(index, 'quantity_base', e.target.value)}
                          />
                          <span className="tiny muted">
                            {BASE_UNIT_LABELS[ing?.base_unit] || ''}
                          </span>
                        </div>
                      </td>
                      <td className="num">{money(cost)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => removeItem(index)}
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
        )}

        <div className="flex justify-between gap-3 mt-2 card card-tight" style={{ background: 'var(--cream)', boxShadow: 'none' }}>
          <div>
            <p className="label">Costo total de la tanda</p>
            <p className="money" style={{ fontSize: 18 }}>{money(formTotal)}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="label">Costo por unidad de rendimiento</p>
            <p className="money positive" style={{ fontSize: 18 }}>{moneyPrecise(formPerUnit, 4)}</p>
          </div>
        </div>

        <div className="field mt-2">
          <label>Notas</label>
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Instrucciones, observaciones..."
          />
        </div>

        <label className="checkbox-row mt-2">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          Activa
        </label>

        {ingredients.filter((i) => i.active !== false).length === 0 ? (
          <p className="small mt-2">
            No tienes materia prima. <Link to="/admin/materia-prima">Cárgala aquí</Link>.
          </p>
        ) : null}
      </Modal>
    </>
  )
}
