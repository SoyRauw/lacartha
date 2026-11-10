import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Calculator,
  Check,
  Circle,
  Copy,
  Flame,
  Layers,
  Minus,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Sandwich,
  Save,
  Sparkles,
  Trash2,
  Wheat,
} from 'lucide-react'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from '../../components/ui'
import { useCatalog } from '../../hooks/useCatalog'
import {
  buildCostContext,
  componentCost,
  marginOf,
  optionCost,
  productCost,
} from '../../lib/costing'
import { BASE_UNIT_LABELS, SLOT_LABELS } from '../../lib/constants'
import {
  money,
  moneyPrecise,
  number,
  parseNumber,
  priceToBs,
} from '../../lib/currency'
import { getRateValue } from '../../lib/rates'
import { refreshCatalog } from '../../lib/catalog'
import { supabase } from '../../lib/supabase'
import styles from './AdminBanderilla.module.css'

const BASE_SLOTS = ['masa', 'salchicha', 'queso', 'palillo', 'empaque']
const SLOT_ICONS = {
  masa: Wheat,
  salchicha: Flame,
  queso: Circle,
  palillo: Minus,
  empaque: Package,
}

function Hotspot({ id, x, y, w, h, label, sub, selected, onSelect, arrow }) {
  return (
    <g
      className={`${styles.hotspot} ${selected === id ? styles.hotspotActive : ''}`}
      onClick={() => onSelect(id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(id)
      }}
    >
      {arrow ? (
        <line
          x1={arrow.x1}
          y1={arrow.y1}
          x2={arrow.x2}
          y2={arrow.y2}
          stroke="#a88b78"
          strokeWidth="2"
          markerEnd="url(#arrowhead)"
        />
      ) : null}
      <rect x={x} y={y} width={w} height={h} rx="12" />
      <text x={x + 12} y={y + 19}>{label}</text>
      {sub ? (
        <text x={x + 12} y={y + 35} className={styles.hotspotSub}>{sub}</text>
      ) : null}
    </g>
  )
}

function BanderillaDiagram({
  product,
  recipeItems,
  toppingCount,
  sauceCount,
  selected,
  onSelect,
}) {
  const hasSausage = recipeItems.some((item) => item.slot === 'salchicha')
  const hasCheese = recipeItems.some((item) => item.slot === 'queso')

  const qtyOf = (slot, unit = 'u') => {
    const item = recipeItems.find((r) => r.slot === slot)
    if (!item) return 'Sin asignar'
    const qty = Number(item.quantity) || 0
    if (slot === 'masa') {
      return `${number(qty)} ${qty === 1 ? 'porción' : 'porciones'}`
    }
    return `${number(qty)} ${unit}`
  }

  return (
    <svg viewBox="0 0 640 570" className={styles.diagramSvg} role="img" aria-label="Partes de la banderilla">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#a88b78" />
        </marker>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#4a1c00" floodOpacity="0.13" />
        </filter>
        <linearGradient id="masaGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd98a" />
          <stop offset="55%" stopColor="#f5bf5c" />
          <stop offset="100%" stopColor="#e8a63c" />
        </linearGradient>
        <linearGradient id="sausageGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d64545" />
          <stop offset="50%" stopColor="#b83232" />
          <stop offset="100%" stopColor="#8f2424" />
        </linearGradient>
        <linearGradient id="cheeseGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffe08a" />
          <stop offset="60%" stopColor="#ffc94d" />
          <stop offset="100%" stopColor="#e8a92e" />
        </linearGradient>
      </defs>

      <ellipse cx="320" cy="300" rx="190" ry="230" fill="rgba(255,195,0,0.10)" />
      <circle cx="510" cy="80" r="7" fill="#ffc300" opacity="0.8" />
      <circle cx="545" cy="110" r="4" fill="#e85d04" opacity="0.7" />
      <circle cx="120" cy="330" r="5" fill="#e85d04" opacity="0.5" />

      {/* Palillo */}
      <g onClick={() => onSelect('palillo')} style={{ cursor: 'pointer' }}>
        <rect
          x="312"
          y="320"
          width="14"
          height="200"
          rx="7"
          fill="#8a5a2b"
          stroke={selected === 'palillo' ? '#e85d04' : '#6b431f'}
          strokeWidth={selected === 'palillo' ? 3 : 1}
        />
      </g>

      {/* Empaque */}
      <g onClick={() => onSelect('empaque')} style={{ cursor: 'pointer' }}>
        <path
          d="M240 500 L400 500 L380 545 L260 545 Z"
          fill="#e0b27a"
          stroke={selected === 'empaque' ? '#e85d04' : '#b07d3f'}
          strokeWidth={selected === 'empaque' ? 3 : 1.5}
        />
        <path d="M255 512 L385 512" stroke="#c9965a" strokeWidth="3" />
      </g>

      {/* Masa */}
      <g onClick={() => onSelect('masa')} style={{ cursor: 'pointer' }}>
        <rect
          x="238"
          y="95"
          width="164"
          height="255"
          rx="82"
          fill="url(#masaGradient)"
          stroke={selected === 'masa' ? '#e85d04' : '#d99a3a'}
          strokeWidth={selected === 'masa' ? 4 : 2}
          filter="url(#softShadow)"
        />
      </g>

      {/* Relleno */}
      {hasSausage && !hasCheese ? (
        <g onClick={() => onSelect('salchicha')} style={{ cursor: 'pointer' }}>
          <rect x="288" y="125" width="64" height="185" rx="32" fill="url(#sausageGradient)" />
        </g>
      ) : null}
      {hasCheese && !hasSausage ? (
        <g onClick={() => onSelect('queso')} style={{ cursor: 'pointer' }}>
          <rect x="288" y="125" width="64" height="185" rx="32" fill="url(#cheeseGradient)" />
        </g>
      ) : null}
      {hasSausage && hasCheese ? (
        <>
          <g onClick={() => onSelect('salchicha')} style={{ cursor: 'pointer' }}>
            <path
              d="M288 125 L352 125 L352 218 L288 218 Z"
              fill="url(#sausageGradient)"
            />
          </g>
          <g onClick={() => onSelect('queso')} style={{ cursor: 'pointer' }}>
            <path
              d="M288 218 L352 218 L352 310 L288 310 Z"
              fill="url(#cheeseGradient)"
            />
          </g>
        </>
      ) : null}

      {/* Topping crumbs */}
      <g onClick={() => onSelect('topping')} style={{ cursor: 'pointer' }}>
        {[
          [250, 120, 5, '#e85d04'],
          [265, 105, 4, '#f4a261'],
          [385, 130, 5, '#d62828'],
          [398, 160, 4, '#ffd166'],
          [246, 180, 4, '#ffb703'],
          [392, 210, 5, '#e85d04'],
          [250, 250, 4, '#d62828'],
          [390, 270, 4, '#f4a261'],
          [255, 305, 3, '#ffd166'],
          [385, 320, 4, '#e85d04'],
          [300, 108, 3, '#ffb703'],
          [340, 104, 3, '#d62828'],
        ].map(([cx, cy, r, fill], index) => (
          <circle key={index} cx={cx} cy={cy} r={r} fill={fill} opacity="0.9" />
        ))}
      </g>

      {/* Salsas */}
      <g onClick={() => onSelect('salsas')} style={{ cursor: 'pointer' }}>
        <path
          d="M250 150 C280 130 300 175 325 155 C350 135 370 170 395 150"
          fill="none"
          stroke="#fffaf0"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.95"
        />
        <path
          d="M255 225 C285 205 300 245 330 225 C360 205 375 245 400 225"
          fill="none"
          stroke="#ffd166"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.95"
        />
        <path
          d="M250 290 C280 270 300 310 330 290 C360 270 375 305 395 285"
          fill="none"
          stroke="#d62828"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.9"
        />
      </g>

      {/* Hotspots */}
      <Hotspot
        id="topping"
        x={20}
        y={55}
        w={148}
        h={48}
        label="Topping"
        sub={`${toppingCount} opciones · elige 1`}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 168, y1: 79, x2: 245, y2: 110 }}
      />
      <Hotspot
        id="masa"
        x={20}
        y={145}
        w={148}
        h={48}
        label="Masa"
        sub={qtyOf('masa')}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 168, y1: 169, x2: 235, y2: 200 }}
      />
      <Hotspot
        id="palillo"
        x={20}
        y={390}
        w={148}
        h={48}
        label="Palillo"
        sub={qtyOf('palillo')}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 168, y1: 414, x2: 305, y2: 414 }}
      />
      <Hotspot
        id="empaque"
        x={20}
        y={470}
        w={148}
        h={48}
        label="Vaso"
        sub={qtyOf('empaque')}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 168, y1: 494, x2: 255, y2: 510 }}
      />
      <Hotspot
        id="salchicha"
        x={472}
        y={90}
        w={148}
        h={48}
        label="Salchicha"
        sub={qtyOf('salchicha')}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 472, y1: 114, x2: 355, y2: 160 }}
      />
      <Hotspot
        id="queso"
        x={472}
        y={175}
        w={148}
        h={48}
        label="Queso"
        sub={qtyOf('queso', 'g')}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 472, y1: 199, x2: 355, y2: 235 }}
      />
      <Hotspot
        id="salsas"
        x={472}
        y={300}
        w={148}
        h={48}
        label="Salsas"
        sub={`${sauceCount} opciones · libre`}
        selected={selected}
        onSelect={onSelect}
        arrow={{ x1: 472, y1: 324, x2: 360, y2: 305 }}
      />

      <text x="320" y="32" textAnchor="middle" fill="#806555" fontSize="12" fontWeight="600">
        {product?.name || 'Banderilla'}
      </text>
    </svg>
  )
}

export default function AdminBanderilla() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [params, setParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState(params.get('product') || '')
  const [tab, setTab] = useState('base')
  const [selectedSlot, setSelectedSlot] = useState('masa')
  const [slotModal, setSlotModal] = useState(null)
  const [slotForm, setSlotForm] = useState({
    component_type: 'ingredient',
    ingredient_id: '',
    preparation_id: '',
    quantity: '1',
  })
  const [optionModal, setOptionModal] = useState(null)
  const [optionForm, setOptionForm] = useState({
    name: '',
    ingredient_id: '',
    quantity: '15',
    active: true,
  })
  const [priceForm, setPriceForm] = useState({ price_usd: '', price_bs: '', rate: '' })
  const [saving, setSaving] = useState(false)

  const ctx = useMemo(() => buildCostContext(catalog), [catalog])
  const products = useMemo(
    () =>
      (catalog.products || [])
        .filter((p) => p.category === 'banderilla' && p.active !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name)),
    [catalog.products],
  )

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId) || products[0] || null,
    [products, selectedId],
  )

  useEffect(() => {
    if (!selectedId && products[0]) {
      setSelectedId(products[0].id)
      setParams({ product: products[0].id }, { replace: true })
    }
  }, [products, selectedId, setParams])

  useEffect(() => {
    if (selectedProduct) {
      setPriceForm((prev) => ({
        ...prev,
        price_usd: String(selectedProduct.price_usd ?? ''),
        rate:
          prev.rate ||
          String(
            getRateValue(catalog.rate, 'bcv_eur') ||
              getRateValue(catalog.rate, 'bcv_usd') ||
              '',
          ),
      }))
    }
  }, [selectedProduct, catalog.rate])

  const recipeItems = useMemo(
    () =>
      (catalog.recipe_items || []).filter(
        (item) => item.product_id === selectedProduct?.id,
      ),
    [catalog.recipe_items, selectedProduct],
  )

  const toppingGroup = useMemo(
    () => (catalog.option_groups || []).find((g) => g.slug === 'topping'),
    [catalog.option_groups],
  )
  const sauceGroup = useMemo(
    () => (catalog.option_groups || []).find((g) => g.slug === 'salsas'),
    [catalog.option_groups],
  )
  const toppings = useMemo(
    () =>
      (catalog.options || [])
        .filter((o) => o.group_id === toppingGroup?.id && o.active !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [catalog.options, toppingGroup],
  )
  const sauces = useMemo(
    () =>
      (catalog.options || [])
        .filter((o) => o.group_id === sauceGroup?.id && o.active !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [catalog.options, sauceGroup],
  )

  const baseCost = selectedProduct ? productCost(selectedProduct, ctx) : 0
  const margin = marginOf(selectedProduct?.price_usd, baseCost)

  const selectProduct = (id) => {
    setSelectedId(id)
    setParams({ product: id }, { replace: true })
    setTab('base')
    setSelectedSlot('masa')
  }

  const slotItem = (slot) => recipeItems.find((item) => item.slot === slot)

  const componentInfo = (item) => {
    if (!item) return null
    if (item.component_type === 'preparation') {
      const prep = ctx.preparationsMap.get(item.preparation_id)
      return {
        name: prep?.name || 'Preparación',
        unit: prep?.yield_unit === 'portion' ? 'porción' : BASE_UNIT_LABELS[prep?.yield_unit] || 'unidad',
        cost: componentCost(item, ctx),
      }
    }
    const ing = ctx.ingredientsMap.get(item.ingredient_id)
    return {
      name: ing?.name || 'Ingrediente',
      unit: BASE_UNIT_LABELS[ing?.base_unit] || 'unidad',
      cost: componentCost(item, ctx),
    }
  }

  const openSlot = (slot) => {
    setSelectedSlot(slot)
    setTab('base')
    const item = slotItem(slot)
    setSlotForm({
      component_type:
        item?.component_type || (slot === 'masa' ? 'preparation' : 'ingredient'),
      ingredient_id: item?.ingredient_id || '',
      preparation_id:
        item?.preparation_id ||
        (slot === 'masa'
          ? (catalog.preparations || []).find((p) => p.name === 'Masa')?.id || ''
          : ''),
      quantity: item ? String(item.quantity) : slot === 'masa' ? '1' : slot === 'queso' ? '30' : '1',
    })
    setSlotModal({ slot })
  }

  const saveSlot = async () => {
    if (!selectedProduct) return
    const quantity = parseNumber(slotForm.quantity)
    if (quantity <= 0) {
      push('La cantidad debe ser mayor a cero', 'error')
      return
    }
    if (
      (slotForm.component_type === 'ingredient' && !slotForm.ingredient_id) ||
      (slotForm.component_type === 'preparation' && !slotForm.preparation_id)
    ) {
      push('Selecciona el componente', 'error')
      return
    }
    setSaving(true)
    try {
      const { error: delError } = await supabase
        .from('recipe_items')
        .delete()
        .eq('product_id', selectedProduct.id)
        .eq('slot', slotModal.slot)
      if (delError) throw delError

      const { error: insError } = await supabase.from('recipe_items').insert({
        product_id: selectedProduct.id,
        slot: slotModal.slot,
        component_type: slotForm.component_type,
        ingredient_id:
          slotForm.component_type === 'ingredient' ? slotForm.ingredient_id : null,
        preparation_id:
          slotForm.component_type === 'preparation' ? slotForm.preparation_id : null,
        quantity,
      })
      if (insError) throw insError
      await refreshCatalog()
      setSlotModal(null)
      push('Parte de la receta actualizada', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeSlot = async () => {
    if (!selectedProduct || !slotModal) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('recipe_items')
        .delete()
        .eq('product_id', selectedProduct.id)
        .eq('slot', slotModal.slot)
      if (error) throw error
      await refreshCatalog()
      setSlotModal(null)
      push('Componente quitado', 'success')
    } catch (e) {
      push(e.message || 'No se pudo quitar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openOption = (group, option = null) => {
    const recipe = option
      ? (catalog.option_recipe_items || []).find((item) => item.option_id === option.id)
      : null
    setOptionForm({
      name: option?.name || '',
      ingredient_id: recipe?.ingredient_id || '',
      quantity: recipe
        ? String(recipe.quantity)
        : group?.slug === 'topping'
          ? '20'
          : '15',
      active: option?.active !== false,
    })
    setOptionModal({ group, option })
  }

  const saveOption = async () => {
    if (!optionModal?.group) return
    if (!optionForm.name.trim()) {
      push('El nombre es obligatorio', 'error')
      return
    }
    if (!optionForm.ingredient_id) {
      push('Selecciona el ingrediente', 'error')
      return
    }
    const quantity = parseNumber(optionForm.quantity)
    if (quantity <= 0) {
      push('La cantidad debe ser mayor a cero', 'error')
      return
    }
    setSaving(true)
    try {
      let optionId = optionModal.option?.id
      if (optionId) {
        const { error } = await supabase
          .from('options')
          .update({ name: optionForm.name.trim(), active: optionForm.active })
          .eq('id', optionId)
        if (error) throw error
      } else {
        const maxSort = Math.max(0, ...(optionModal.group.id === toppingGroup?.id ? toppings : sauces).map((o) => o.sort_order || 0))
        const { data, error } = await supabase
          .from('options')
          .insert({
            group_id: optionModal.group.id,
            name: optionForm.name.trim(),
            price_delta_usd: 0,
            active: true,
            sort_order: maxSort + 1,
          })
          .select()
          .single()
        if (error) throw error
        optionId = data.id
      }

      const { error: delError } = await supabase
        .from('option_recipe_items')
        .delete()
        .eq('option_id', optionId)
      if (delError) throw delError

      const { error: insError } = await supabase.from('option_recipe_items').insert({
        option_id: optionId,
        component_type: 'ingredient',
        ingredient_id: optionForm.ingredient_id,
        quantity,
      })
      if (insError) throw insError

      await refreshCatalog()
      setOptionModal(null)
      push(optionModal.option ? 'Opción actualizada' : 'Opción creada', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo guardar la opción', 'error')
    } finally {
      setSaving(false)
    }
  }

  const archiveOption = async () => {
    if (!optionModal?.option) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('options')
        .update({ active: false })
        .eq('id', optionModal.option.id)
      if (error) throw error
      await refreshCatalog()
      setOptionModal(null)
      push('Opción archivada', 'success')
    } catch (e) {
      push(e.message || 'No se pudo archivar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const savePrice = async () => {
    if (!selectedProduct) return
    const price = parseNumber(priceForm.price_usd)
    if (price < 0) {
      push('El precio no puede ser negativo', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({ price_usd: price })
        .eq('id', selectedProduct.id)
      if (error) throw error
      await refreshCatalog()
      push('Precio actualizado', 'success')
    } catch (e) {
      push(e.message || 'No se pudo guardar el precio', 'error')
    } finally {
      setSaving(false)
    }
  }

  const priceFromBs = () => {
    const bsValue = parseNumber(priceForm.price_bs)
    const rateValue = parseNumber(priceForm.rate)
    if (bsValue <= 0 || rateValue <= 0) {
      push('Escribe un precio en Bs y una tasa válida', 'error')
      return
    }
    setPriceForm((prev) => ({ ...prev, price_usd: (bsValue / rateValue).toFixed(2) }))
    push(`Precio convertido a ${money(bsValue / rateValue)}`, 'success')
  }

  const copyBase = async () => {
    if (!selectedProduct) return
    if (!window.confirm('¿Copiar masa, palillo y vaso a las otras banderillas?')) return
    const baseSlots = ['masa', 'palillo', 'empaque']
    const sourceItems = recipeItems.filter((item) => baseSlots.includes(item.slot))
    if (!sourceItems.length) {
      push('Esta banderilla no tiene base para copiar', 'error')
      return
    }
    setSaving(true)
    try {
      for (const other of products) {
        if (other.id === selectedProduct.id) continue
        const { error: delError } = await supabase
          .from('recipe_items')
          .delete()
          .eq('product_id', other.id)
          .in('slot', baseSlots)
        if (delError) throw delError

        const rows = sourceItems.map((item) => ({
          product_id: other.id,
          slot: item.slot,
          component_type: item.component_type,
          ingredient_id: item.ingredient_id,
          preparation_id: item.preparation_id,
          quantity: item.quantity,
        }))
        const { error: insError } = await supabase.from('recipe_items').insert(rows)
        if (insError) throw insError
      }
      await refreshCatalog()
      push('Base copiada a las otras banderillas', 'success')
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo copiar la base', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!catalog.ready) {
    return (
      <>
        <PageHeader title="La banderilla" subtitle="Constructor visual de la receta." icon={Sandwich} />
        <div className="card">
          <EmptyState
            icon={Sandwich}
            title="Falta descargar el menú"
            text="Conéctate a internet y sincroniza para cargar las banderillas."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await refreshCatalog()
                    push('Menú descargado', 'success')
                  } catch (e) {
                    push(e.message || 'No se pudo descargar', 'error')
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

  if (!products.length) {
    return (
      <>
        <PageHeader title="La banderilla" subtitle="Constructor visual de la receta." icon={Sandwich} />
        <div className="card">
          <EmptyState
            icon={Sandwich}
            title="No hay banderillas"
            text="Crea una banderilla en Productos para configurar su receta."
            action={
              <a className="btn btn-primary" href="/admin/menu">
                <Plus size={15} /> Ir a Productos
              </a>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="La banderilla"
        subtitle="Toca cada parte para definir qué lleva y cuánto cuesta."
        icon={Sandwich}
        actions={
          <button type="button" className="btn" onClick={copyBase} disabled={saving}>
            <Copy size={15} /> Copiar base
          </button>
        }
      />

      <div className={styles.page}>
        <div className={`card ${styles.diagramCard}`}>
          <div className={styles.productTabs}>
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`chip ${selectedProduct?.id === product.id ? 'active' : ''}`}
                onClick={() => selectProduct(product.id)}
              >
                {product.name}
              </button>
            ))}
          </div>

          <BanderillaDiagram
            product={selectedProduct}
            recipeItems={recipeItems}
            toppingCount={toppings.length}
            sauceCount={sauces.length}
            selected={selectedSlot}
            onSelect={(slot) => {
              setSelectedSlot(slot)
              if (slot === 'topping') {
                setTab('topping')
              } else if (slot === 'salsas') {
                setTab('salsas')
              } else {
                setTab('base')
              }
            }}
          />

          <div className={styles.summaryGrid} style={{ marginTop: 10 }}>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Costo base</p>
              <p className={styles.summaryValue}>{money(baseCost)}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Precio</p>
              <p className={styles.summaryValue}>{money(selectedProduct.price_usd)}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Margen base</p>
              <p
                className={styles.summaryValue}
                style={{ color: margin.amount >= 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {money(margin.amount)}
              </p>
            </div>
          </div>
          <p className="tiny muted mt-1">
            Los toppings y salsas no cambian el precio; agregan costo. El POS calcula el costo
            exacto según lo que elija el cliente.
          </p>
        </div>

        <div className="card">
          <div className="tabs mb-3">
            <button type="button" className={`tab ${tab === 'base' ? 'active' : ''}`} onClick={() => setTab('base')}>
              <Layers size={14} /> Base
            </button>
            <button type="button" className={`tab ${tab === 'topping' ? 'active' : ''}`} onClick={() => setTab('topping')}>
              <Sparkles size={14} /> Toppings
            </button>
            <button type="button" className={`tab ${tab === 'salsas' ? 'active' : ''}`} onClick={() => setTab('salsas')}>
              <Circle size={14} /> Salsas
            </button>
            <button type="button" className={`tab ${tab === 'precio' ? 'active' : ''}`} onClick={() => setTab('precio')}>
              <Calculator size={14} /> Precio
            </button>
          </div>

          {tab === 'base' ? (
            <>
              <p className="small muted mb-2">
                Toca una parte del dibujo o una fila para editar. La masa se descuenta por
                porción; los demás ingredientes en su unidad base.
              </p>
              <div className={styles.slotList}>
                {BASE_SLOTS.map((slot) => {
                  const item = slotItem(slot)
                  const info = componentInfo(item)
                  const Icon = SLOT_ICONS[slot] || Layers
                  return (
                    <button
                      type="button"
                      key={slot}
                      className={`${styles.slotRow} ${selectedSlot === slot ? styles.slotRowActive : ''}`}
                      onClick={() => openSlot(slot)}
                    >
                      <span className={styles.slotIcon}><Icon size={17} /></span>
                      <span className={styles.slotBody}>
                        <span className={styles.slotTitle}>{SLOT_LABELS[slot]}</span>
                        <span className={styles.slotMeta}>
                          {info
                            ? `${info.name} · ${number(item.quantity)} ${info.unit}`
                            : 'Sin asignar · toca para agregar'}
                        </span>
                      </span>
                      <span className={styles.slotCost}>
                        {info ? money(info.cost) : '—'}
                      </span>
                      <Pencil size={14} style={{ color: 'var(--muted-2)' }} />
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}

          {tab === 'topping' ? (
            <>
              <p className="small muted mb-2">
                El cliente elige <strong>1 topping</strong>. Todos están incluidos en el precio.
              </p>
              <div className={styles.slotList}>
                {toppings.map((option) => {
                  const recipe = (catalog.option_recipe_items || []).find(
                    (item) => item.option_id === option.id,
                  )
                  const ing = recipe ? ctx.ingredientsMap.get(recipe.ingredient_id) : null
                  const cost = optionCost(option.id, ctx)
                  return (
                    <div className={styles.optionRow} key={option.id}>
                      <span className={styles.slotIcon}><Sparkles size={17} /></span>
                      <div className={styles.optionBody}>
                        <div className={styles.optionName}>{option.name}</div>
                        <div className={styles.optionMeta}>
                          {recipe
                            ? `${ing?.name || 'Ingrediente'} · ${number(recipe.quantity)} g`
                            : 'Sin receta'}
                        </div>
                      </div>
                      <div className={styles.optionCost}>{money(cost)}</div>
                      <button type="button" className="btn btn-sm" onClick={() => openOption(toppingGroup, option)}>
                        <Pencil size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button type="button" className="btn mt-2" onClick={() => openOption(toppingGroup)}>
                <Plus size={14} /> Nuevo topping
              </button>
            </>
          ) : null}

          {tab === 'salsas' ? (
            <>
              <p className="small muted mb-2">
                El cliente puede elegir <strong>todas las salsas que quiera</strong>. Cada salsa
                descuenta su porción.
              </p>
              <div className={styles.slotList}>
                {sauces.map((option) => {
                  const recipe = (catalog.option_recipe_items || []).find(
                    (item) => item.option_id === option.id,
                  )
                  const ing = recipe ? ctx.ingredientsMap.get(recipe.ingredient_id) : null
                  const cost = optionCost(option.id, ctx)
                  return (
                    <div className={styles.optionRow} key={option.id}>
                      <span className={styles.slotIcon}><Circle size={17} /></span>
                      <div className={styles.optionBody}>
                        <div className={styles.optionName}>{option.name}</div>
                        <div className={styles.optionMeta}>
                          {recipe
                            ? `${ing?.name || 'Ingrediente'} · ${number(recipe.quantity)} g`
                            : 'Sin receta'}
                        </div>
                      </div>
                      <div className={styles.optionCost}>{money(cost)}</div>
                      <button type="button" className="btn btn-sm" onClick={() => openOption(sauceGroup, option)}>
                        <Pencil size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button type="button" className="btn mt-2" onClick={() => openOption(sauceGroup)}>
                <Plus size={14} /> Nueva salsa
              </button>
            </>
          ) : null}

          {tab === 'precio' ? (
            <>
              <div className="form-grid">
                <div className="field">
                  <label>Precio de venta (USD)</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceForm.price_usd}
                    onChange={(e) => setPriceForm((prev) => ({ ...prev, price_usd: e.target.value }))}
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
                      value={priceForm.price_bs}
                      onChange={(e) => setPriceForm((prev) => ({ ...prev, price_bs: e.target.value }))}
                      placeholder="Bs"
                    />
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={priceForm.rate}
                      onChange={(e) => setPriceForm((prev) => ({ ...prev, rate: e.target.value }))}
                      placeholder="Tasa"
                      style={{ width: 110 }}
                    />
                    <button type="button" className="btn" onClick={priceFromBs}>
                      <Calculator size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <div className={styles.summaryGrid} style={{ marginTop: 14 }}>
                <div className={styles.summaryItem}>
                  <p className={styles.summaryLabel}>Costo base</p>
                  <p className={styles.summaryValue}>{money(baseCost)}</p>
                </div>
                <div className={styles.summaryItem}>
                  <p className={styles.summaryLabel}>Margen</p>
                  <p className={styles.summaryValue} style={{ color: margin.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {money(margin.amount)}
                  </p>
                </div>
                <div className={styles.summaryItem}>
                  <p className={styles.summaryLabel}>% Margen</p>
                  <p className={styles.summaryValue}>{margin.percent.toFixed(0)}%</p>
                </div>
              </div>
              <button type="button" className="btn btn-primary mt-3" onClick={savePrice} disabled={saving}>
                <Save size={15} /> Guardar precio
              </button>
              <p className="tiny muted mt-2">
                El precio se guarda en USD. El Bs que ve el cliente se recalcula con la tasa
                del menú público.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <Modal
        open={Boolean(slotModal)}
        onClose={() => setSlotModal(null)}
        title={`Editar ${slotModal ? SLOT_LABELS[slotModal.slot] : ''}`}
        icon={slotModal ? SLOT_ICONS[slotModal.slot] || Layers : Layers}
        footer={
          <>
            {slotItem(slotModal?.slot) ? (
              <button type="button" className="btn btn-danger" onClick={removeSlot} disabled={saving}>
                <Trash2 size={14} /> Quitar
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => setSlotModal(null)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={saveSlot} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Tipo</label>
            <select
              className="select"
              value={slotForm.component_type}
              onChange={(e) =>
                setSlotForm((prev) => ({
                  ...prev,
                  component_type: e.target.value,
                  ingredient_id: '',
                  preparation_id: '',
                }))
              }
            >
              <option value="ingredient">Ingrediente</option>
              <option value="preparation">Preparación</option>
            </select>
          </div>
          <div className="field">
            <label>Componente</label>
            {slotForm.component_type === 'ingredient' ? (
              <select
                className="select"
                value={slotForm.ingredient_id}
                onChange={(e) => setSlotForm((prev) => ({ ...prev, ingredient_id: e.target.value }))}
              >
                <option value="">Selecciona...</option>
                {(catalog.ingredients || [])
                  .filter((i) => i.active !== false)
                  .map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
              </select>
            ) : (
              <select
                className="select"
                value={slotForm.preparation_id}
                onChange={(e) => setSlotForm((prev) => ({ ...prev, preparation_id: e.target.value }))}
              >
                <option value="">Selecciona...</option>
                {(catalog.preparations || [])
                  .filter((p) => p.active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            )}
          </div>
        </div>

        <div className="form-grid mt-2">
          <div className="field">
            <label>Cantidad por banderilla</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.001"
              value={slotForm.quantity}
              onChange={(e) => setSlotForm((prev) => ({ ...prev, quantity: e.target.value }))}
            />
            <span className="tiny muted">
              {slotModal?.slot === 'masa'
                ? 'Porciones de la preparación'
                : 'Gramos, ml o unidades según el ingrediente'}
            </span>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <div className="card card-tight" style={{ background: 'var(--cream)', boxShadow: 'none' }}>
              <p className="label">Costo estimado</p>
              <p className="money">
                {money(componentCost({
                  component_type: slotForm.component_type,
                  ingredient_id: slotForm.ingredient_id,
                  preparation_id: slotForm.preparation_id,
                  quantity: parseNumber(slotForm.quantity),
                }, ctx))}
              </p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(optionModal)}
        onClose={() => setOptionModal(null)}
        title={
          optionModal?.option
            ? `Editar ${optionModal.option.name}`
            : optionModal?.group?.slug === 'topping'
              ? 'Nuevo topping'
              : 'Nueva salsa'
        }
        icon={Sparkles}
        footer={
          <>
            {optionModal?.option ? (
              <button type="button" className="btn btn-danger" onClick={archiveOption} disabled={saving}>
                <Trash2 size={14} /> Archivar
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => setOptionModal(null)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={saveOption} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Nombre</label>
          <input
            className="input"
            value={optionForm.name}
            onChange={(e) => setOptionForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Ej. Dorito"
          />
        </div>
        <div className="form-grid mt-2">
          <div className="field">
            <label>Ingrediente</label>
            <select
              className="select"
              value={optionForm.ingredient_id}
              onChange={(e) => setOptionForm((prev) => ({ ...prev, ingredient_id: e.target.value }))}
            >
              <option value="">Selecciona...</option>
              {(catalog.ingredients || [])
                .filter((i) => i.active !== false)
                .map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
            </select>
          </div>
          <div className="field">
            <label>Cantidad por banderilla</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.001"
              value={optionForm.quantity}
              onChange={(e) => setOptionForm((prev) => ({ ...prev, quantity: e.target.value }))}
            />
            <span className="tiny muted">Gramos o ml de la porción</span>
          </div>
        </div>
        {optionModal?.option ? (
          <label className="checkbox-row mt-2">
            <input
              type="checkbox"
              checked={optionForm.active}
              onChange={(e) => setOptionForm((prev) => ({ ...prev, active: e.target.checked }))}
            />
            Activa
          </label>
        ) : null}
      </Modal>
    </>
  )
}
