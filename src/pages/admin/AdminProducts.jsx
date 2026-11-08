import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calculator,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Sandwich,
  Search,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  StatCard,
  useToast,
} from '../../components/ui'
import { useCatalog } from '../../hooks/useCatalog'
import { buildCostContext, marginOf, productCost } from '../../lib/costing'
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/constants'
import { money, moneyPrecise, number, parseNumber, priceToBs } from '../../lib/currency'
import { getRateValue } from '../../lib/rates'
import { supabase } from '../../lib/supabase'
import { refreshCatalog } from '../../lib/catalog'

const EMPTY_FORM = {
  id: null,
  name: '',
  category: 'banderilla',
  product_type: 'recipe',
  price_usd: '',
  cost_usd: '0',
  stock_base: '0',
  base_unit: 'unit',
  track_stock: false,
  active: true,
  is_public: true,
  description: '',
  image_url: '',
  sort_order: '0',
  recipeItems: [],
}

function newRecipeRow(slot = 'otro') {
  return {
    key: crypto.randomUUID(),
    slot,
    component_type: 'ingredient',
    ingredient_id: '',
    preparation_id: '',
    quantity: '',
  }
}

export default function AdminProducts() {
  const { push } = useToast()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [priceBs, setPriceBs] = useState('')
  const [priceRate, setPriceRate] = useState('')

  const ctx = useMemo(() => buildCostContext(catalog), [catalog])

  useEffect(() => {
    const rate = catalog.rate
    const value = rate ? getRateValue(rate, 'bcv_eur') || getRateValue(rate, 'bcv_usd') : 0
    if (!priceRate && value) setPriceRate(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.rate])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (catalog.products || [])
      .filter((p) => {
        if (category !== 'todos' && p.category !== category) return false
        if (!q) return true
        return (
          (p.name || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))
  }, [catalog.products, search, category])

  const stats = useMemo(() => {
    const products = catalog.products || []
    const banderillas = products.filter((p) => p.category === 'banderilla' && p.active !== false)
    const sinPrecio = products.filter((p) => p.active !== false && !(Number(p.price_usd) > 0)).length
    const sinCosto = products.filter((p) => {
      if (p.active === false) return false
      return p.product_type === 'simple'
        ? !(Number(p.cost_usd) > 0)
        : !(productCost(p, ctx) > 0)
    }).length
    return { total: products.filter((p) => p.active !== false).length, banderillas: banderillas.length, sinPrecio, sinCosto }
  }, [catalog.products, ctx])

  const openNew = () => {
    setForm({ ...EMPTY_FORM, recipeItems: [] })
    setPriceBs('')
    setModalOpen(true)
  }

  const openEdit = (product) => {
    const recipeItems = (catalog.recipe_items || [])
      .filter((item) => item.product_id === product.id)
      .map((item) => ({
        key: item.id,
        id: item.id,
        slot: item.slot || 'otro',
        component_type: item.component_type,
        ingredient_id: item.ingredient_id || '',
        preparation_id: item.preparation_id || '',
        quantity: String(item.quantity ?? ''),
      }))
    setForm({
      id: product.id,
      name: product.name || '',
      category: product.category || 'banderilla',
      product_type: product.product_type || 'recipe',
      price_usd: String(product.price_usd ?? ''),
      cost_usd: String(product.cost_usd ?? 0),
      stock_base: String(product.stock_base ?? 0),
      base_unit: product.base_unit || 'unit',
      track_stock: product.track_stock === true,
      active: product.active !== false,
      is_public: product.is_public !== false,
      description: product.description || '',
      image_url: product.image_url || '',
      sort_order: String(product.sort_order ?? 0),
      recipeItems,
    })
    setPriceBs('')
    setModalOpen(true)
  }

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const setRecipeRow = (index, key, value) => {
    setForm((prev) => {
      const next = [...prev.recipeItems]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, recipeItems: next }
    })
  }

  const addRecipeRow = () => {
    setForm((prev) => ({ ...prev, recipeItems: [...prev.recipeItems, newRecipeRow('otro')] }))
  }

  const removeRecipeRow = (index) => {
    setForm((prev) => ({
      ...prev,
      recipeItems: prev.recipeItems.filter((_, i) => i !== index),
    }))
  }

  const handlePriceFromBs = () => {
    const bsValue = parseNumber(priceBs)
    const rateValue = parseNumber(priceRate)
    if (bsValue <= 0 || rateValue <= 0) {
      push('Escribe un precio en Bs y una tasa válida', 'error')
      return
    }
    set('price_usd', (bsValue / rateValue).toFixed(2))
    push(`Precio convertido a ${money(bsValue / rateValue)}`, 'success')
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      push('El nombre es obligatorio', 'error')
      return
    }
    const price = parseNumber(form.price_usd)
    if (price < 0) {
      push('El precio no puede ser negativo', 'error')
      return
    }
    if (form.product_type === 'simple' && parseNumber(form.cost_usd) < 0) {
      push('El costo no puede ser negativo', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        product_type: form.product_type,
        price_usd: price,
        cost_usd: form.product_type === 'simple' ? parseNumber(form.cost_usd) : 0,
        stock_base: form.product_type === 'simple' ? parseNumber(form.stock_base) : 0,
        base_unit: form.base_unit,
        track_stock: form.product_type === 'simple' ? form.track_stock : false,
        active: form.active,
        is_public: form.is_public,
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        sort_order: Math.trunc(parseNumber(form.sort_order)),
      }

      let productId = form.id
      if (productId) {
        const { error } = await supabase.from('products').update(payload).eq('id', productId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('products').insert(payload).select().single()
        if (error) throw error
        productId = data.id
      }

      // La receta de las banderillas se edita en el constructor visual.
      if (form.category !== 'banderilla') {
        const { error: delError } = await supabase
          .from('recipe_items')
          .delete()
          .eq('product_id', productId)
        if (delError) throw delError

        if (form.product_type === 'recipe') {
          const rows = form.recipeItems
            .filter((row) => {
              if (row.component_type === 'ingredient') {
                return row.ingredient_id && parseNumber(row.quantity) > 0
              }
              return row.preparation_id && parseNumber(row.quantity) > 0
            })
            .map((row) => ({
              product_id: productId,
              slot: row.slot || 'otro',
              component_type: row.component_type,
              ingredient_id: row.component_type === 'ingredient' ? row.ingredient_id : null,
              preparation_id:
                row.component_type === 'preparation' ? row.preparation_id : null,
              quantity: parseNumber(row.quantity),
            }))
          if (rows.length) {
            const { error: insError } = await supabase.from('recipe_items').insert(rows)
            if (insError) throw insError
          }
        }
      }

      await refreshCatalog().catch(() => {})
      setModalOpen(false)
      push(form.id ? 'Producto actualizado' : 'Producto creado', 'success')

      if (!form.id && form.category === 'banderilla') {
        navigate(`/admin/banderilla?product=${productId}`)
      }
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar el producto', 'error')
    } finally {
      setSaving(false)
    }
  }

  const formCost = useMemo(() => {
    if (form.product_type === 'simple') return parseNumber(form.cost_usd)
    return form.recipeItems.reduce((sum, row) => {
      if (row.component_type === 'ingredient') {
        const ing = ctx.ingredientsMap.get(row.ingredient_id)
        return sum + (parseNumber(row.quantity) || 0) * (Number(ing?.avg_cost_usd) || 0)
      }
      const prep = ctx.preparationsMap.get(row.preparation_id)
      if (!prep) return sum
      const items = ctx.prepItemsByPrep.get(prep.id) || []
      const total = items.reduce((s, item) => {
        const ing = ctx.ingredientsMap.get(item.ingredient_id)
        return s + (Number(item.quantity_base) || 0) * (Number(ing?.avg_cost_usd) || 0)
      }, 0)
      const perUnit = total / (Number(prep.yield_quantity) || 1)
      return sum + (parseNumber(row.quantity) || 0) * perUnit
    }, 0)
  }, [form, ctx])

  const formMargin = marginOf(parseNumber(form.price_usd), formCost)
  const currentRate = parseNumber(priceRate) || getRateValue(catalog.rate, 'bcv_eur') || 0

  if (!catalog.ready) {
    return (
      <>
        <PageHeader title="Productos" subtitle="Banderillas, bebidas, postres y snacks." icon={UtensilsCrossed} />
        <div className="card">
          <EmptyState
            icon={UtensilsCrossed}
            title="Falta descargar el menú"
            text="Conéctate a internet y sincroniza para cargar los productos."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await refreshCatalog()
                    push('Menú descargado', 'success')
                  } catch (e) {
                    push(e.message || 'No se pudo descargar el menú', 'error')
                  }
                }}
              >
                <RefreshCw size={15} /> Descargar menú
              </button>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle="Banderillas, bebidas, postres y snacks. Precios y recetas."
        icon={UtensilsCrossed}
        actions={
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> Nuevo producto
          </button>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={UtensilsCrossed} label="Productos activos" value={stats.total} hint="En el menú" />
        <StatCard icon={Sandwich} label="Banderillas" value={stats.banderillas} hint="Con receta configurable" />
        <StatCard
          icon={AlertTriangle}
          label="Sin precio"
          value={stats.sinPrecio}
          tone={stats.sinPrecio > 0 ? 'warning' : 'success'}
          hint="Completa el precio de venta"
        />
        <StatCard
          icon={Calculator}
          label="Sin costo"
          value={stats.sinCosto}
          tone={stats.sinCosto > 0 ? 'warning' : 'success'}
          hint="Falta materia prima o costo"
        />
      </div>

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
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="todos">Todas las categorías</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="No hay productos"
            text="Crea el primero o cambia el filtro."
            action={
              <button type="button" className="btn btn-primary" onClick={openNew}>
                <Plus size={15} /> Nuevo producto
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Precio</th>
                  <th>Costo</th>
                  <th>Margen</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => {
                  const cost = productCost(product, ctx)
                  const margin = marginOf(product.price_usd, cost)
                  const isBanderilla = product.category === 'banderilla'
                  const stock =
                    product.product_type === 'simple' && product.track_stock
                      ? `${number(product.stock_base)} ${product.base_unit === 'unit' ? 'u' : product.base_unit}`
                      : 'Receta'
                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="row-title">{product.name}</div>
                        <div className="row-meta">
                          {product.product_type === 'recipe' ? 'Receta' : 'Simple'}
                          {product.is_public === false ? ' · No público' : ''}
                        </div>
                      </td>
                      <td>{CATEGORY_LABELS[product.category] || product.category}</td>
                      <td className="num">
                        <strong>{money(product.price_usd)}</strong>
                        {currentRate > 0 ? (
                          <div className="row-meta">Bs {number(priceToBs(product.price_usd, currentRate, 'up_010'))}</div>
                        ) : null}
                      </td>
                      <td className="num">
                        {product.product_type === 'simple' ? money(product.cost_usd) : moneyPrecise(cost, 2)}
                      </td>
                      <td className={`num ${margin.amount >= 0 ? 'positive' : 'negative'}`}>
                        {money(margin.amount)}
                        <div className="row-meta">{margin.percent.toFixed(0)}%</div>
                      </td>
                      <td className="num">{stock}</td>
                      <td>
                        {product.active === false ? (
                          <span className="badge">Inactivo</span>
                        ) : (
                          <span className="badge badge-green">Activo</span>
                        )}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          {isBanderilla ? (
                            <Link className="btn btn-sm" to={`/admin/banderilla?product=${product.id}`}>
                              <Sandwich size={13} /> Receta
                            </Link>
                          ) : null}
                          <button type="button" className="btn btn-sm" onClick={() => openEdit(product)}>
                            <Pencil size={13} /> Editar
                          </button>
                        </div>
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
        title={form.id ? 'Editar producto' : 'Nuevo producto'}
        icon={UtensilsCrossed}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar producto'}
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
              placeholder="Ej. Mixta"
            />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select className="select" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-grid mt-2">
          <div className="field">
            <label>Tipo</label>
            <select
              className="select"
              value={form.product_type}
              onChange={(e) => set('product_type', e.target.value)}
            >
              <option value="recipe">Receta (banderilla, bebida por vaso)</option>
              <option value="simple">Simple (botella, postre, snack)</option>
            </select>
          </div>
          <div className="field">
            <label>Orden en el menú</label>
            <input
              className="input"
              type="number"
              step="1"
              value={form.sort_order}
              onChange={(e) => set('sort_order', e.target.value)}
            />
          </div>
        </div>

        <div className="divider" />

        <div className="form-grid">
          <div className="field">
            <label>Precio de venta (USD)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.price_usd}
              onChange={(e) => set('price_usd', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Precio en Bs (referencia)</label>
            <div className="flex gap-2">
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={priceBs}
                onChange={(e) => setPriceBs(e.target.value)}
                placeholder="Bs"
              />
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={priceRate}
                onChange={(e) => setPriceRate(e.target.value)}
                placeholder="Tasa"
                style={{ width: 110 }}
              />
              <button type="button" className="btn" onClick={handlePriceFromBs}>
                <Calculator size={14} />
              </button>
            </div>
            <span className="tiny muted">
              Se guarda el USD. El Bs del menú se recalcula con la tasa.
            </span>
          </div>
        </div>

        {form.product_type === 'simple' ? (
          <div className="form-grid-3 mt-2">
            <div className="field">
              <label>Costo (USD)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.cost_usd}
                onChange={(e) => set('cost_usd', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Stock</label>
              <input
                className="input"
                type="number"
                step="0.001"
                value={form.stock_base}
                onChange={(e) => set('stock_base', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Unidad</label>
              <select className="select" value={form.base_unit} onChange={(e) => set('base_unit', e.target.value)}>
                <option value="unit">unidad</option>
                <option value="g">gramos</option>
                <option value="ml">mililitros</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="card card-tight mt-2" style={{ background: 'var(--cream)', boxShadow: 'none' }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="label">Costo calculado</p>
                <p className="money" style={{ fontSize: 18 }}>{moneyPrecise(formCost, 2)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p className="label">Margen</p>
                <p className={`money ${formMargin.amount >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: 18 }}>
                  {money(formMargin.amount)} ({formMargin.percent.toFixed(0)}%)
                </p>
              </div>
            </div>
            {form.category === 'banderilla' ? (
              <p className="small mt-2">
                La receta de esta banderilla se edita en{' '}
                <Link to={`/admin/banderilla${form.id ? `?product=${form.id}` : ''}`}>
                  La banderilla
                </Link>
                . Ahí defines masa, relleno, topping y salsas.
              </p>
            ) : null}
          </div>
        )}

        {form.product_type === 'recipe' && form.category !== 'banderilla' ? (
          <>
            <div className="flex items-center justify-between mb-2 mt-3">
              <p className="card-title" style={{ margin: 0 }}>
                <UtensilsCrossed size={16} /> Receta
              </p>
              <button type="button" className="btn btn-sm" onClick={addRecipeRow}>
                <Plus size={13} /> Ingrediente
              </button>
            </div>
            {form.recipeItems.length === 0 ? (
              <p className="muted small">Agrega los ingredientes que consume este producto.</p>
            ) : (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>Componente</th>
                      <th>Tipo</th>
                      <th>Cantidad</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.recipeItems.map((row, index) => {
                      const component =
                        row.component_type === 'ingredient'
                          ? ctx.ingredientsMap.get(row.ingredient_id)
                          : ctx.preparationsMap.get(row.preparation_id)
                      return (
                        <tr key={row.key}>
                          <td>
                            <select
                              className="select"
                              value={
                                row.component_type === 'ingredient'
                                  ? row.ingredient_id
                                  : row.preparation_id
                              }
                              onChange={(e) => {
                                if (row.component_type === 'ingredient') {
                                  setRecipeRow(index, 'ingredient_id', e.target.value)
                                } else {
                                  setRecipeRow(index, 'preparation_id', e.target.value)
                                }
                              }}
                            >
                              <option value="">Selecciona...</option>
                              {row.component_type === 'ingredient'
                                ? (catalog.ingredients || [])
                                    .filter((i) => i.active !== false)
                                    .map((i) => (
                                      <option key={i.id} value={i.id}>{i.name}</option>
                                    ))
                                : (catalog.preparations || [])
                                    .filter((p) => p.active !== false)
                                    .map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="select"
                              value={row.component_type}
                              onChange={(e) => {
                                setRecipeRow(index, 'component_type', e.target.value)
                                setRecipeRow(index, 'ingredient_id', '')
                                setRecipeRow(index, 'preparation_id', '')
                              }}
                            >
                              <option value="ingredient">Ingrediente</option>
                              <option value="preparation">Preparación</option>
                            </select>
                          </td>
                          <td style={{ width: 130 }}>
                            <div className="flex items-center gap-2">
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step="0.001"
                                value={row.quantity}
                                onChange={(e) => setRecipeRow(index, 'quantity', e.target.value)}
                              />
                              <span className="tiny muted">
                                {component?.base_unit || component?.yield_unit || ''}
                              </span>
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => removeRecipeRow(index)}
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
          </>
        ) : null}

        <div className="form-grid mt-3">
          <div className="field">
            <label>Descripción</label>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Texto para el menú público..."
            />
          </div>
          <div className="field">
            <label>Imagen (URL)</label>
            <input
              className="input"
              value={form.image_url}
              onChange={(e) => set('image_url', e.target.value)}
              placeholder="https://..."
            />
            <span className="tiny muted">
              <ImageIcon size={12} style={{ verticalAlign: -2 }} /> Opcional. Puedes usar una foto alojada.
            </span>
          </div>
        </div>

        <div className="flex gap-4 mt-2 wrap">
          <label className="checkbox-row">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            Activo
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => set('is_public', e.target.checked)}
            />
            Visible en el menú público
          </label>
          {form.product_type === 'simple' ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.track_stock}
                onChange={(e) => set('track_stock', e.target.checked)}
              />
              Controlar stock
            </label>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
