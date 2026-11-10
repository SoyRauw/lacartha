import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Banknote,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Cloud,
  CloudOff,
  CreditCard,
  Landmark,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react'
import {
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from '../../components/ui'
import BillPicker from '../../components/BillPicker'
import VueltoMixto, {
  emptyChange,
  isChangeCovered,
} from '../../components/VueltoMixto'
import {
  billsToJson,
  drawerFromLedger,
  emptyBillCounts,
  proposeChange,
  sumBills,
} from '../../lib/bills'
import { useAuth } from '../../hooks/useAuth'
import { useCatalog } from '../../hooks/useCatalog'
import { useOnline, usePendingCount } from '../../hooks/useOnline'
import {
  buildCostContext,
  explodeSaleItem,
  groupsForProduct,
  marginOf,
  optionCost,
  optionsOfGroup,
  saleItemUnitCost,
  saleItemUnitPrice,
} from '../../lib/costing'
import { CATEGORY_LABELS, RATE_SOURCES } from '../../lib/constants'
import {
  bs as formatBs,
  convertBsToUsd,
  convertUsdToBs,
  money,
  number,
  parseNumber,
} from '../../lib/currency'
import { generateOrderNumber } from '../../lib/dates'
import { db } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import {
  addLocalBillMovements,
  addLocalCashMovement,
  getLocalBillLedger,
  getOpenLocalSession,
  openLocalCashSession,
} from '../../lib/localCash'
import { getRateValue } from '../../lib/rates'
import { refreshCatalog } from '../../lib/catalog'
import { downloadReceipt } from '../../lib/receipts'
import { syncAll, syncCashSession, syncPendingSales } from '../../lib/sync'
import styles from './AdminPOS.module.css'

const CATEGORY_TABS = [
  { value: 'todos', label: 'Todo' },
  { value: 'banderilla', label: 'Banderillas' },
  { value: 'bebida', label: 'Bebidas' },
  { value: 'postre', label: 'Postres' },
  { value: 'snack', label: 'Snacks' },
]

const BS_RATE_SOURCES = RATE_SOURCES.filter((r) => r.value !== 'usdt')

function methodIcon(code) {
  switch (code) {
    case 'efectivo_usd':
    case 'efectivo_bs':
      return Banknote
    case 'pago_movil':
      return Smartphone
    case 'punto_venta':
      return CreditCard
    case 'zelle':
      return Landmark
    case 'binance':
      return CircleDollarSign
    default:
      return Wallet
  }
}

function optionNames(options = []) {
  return options.map((o) => o.name).filter(Boolean)
}

export default function AdminPOS() {
  const { user } = useAuth()
  const { push } = useToast()
  const catalog = useCatalog()
  const online = useOnline()
  const pending = usePendingCount()

  const [category, setCategory] = useState('todos')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [configProduct, setConfigProduct] = useState(null)
  const [configForm, setConfigForm] = useState({
    toppingId: '',
    sauceIds: [],
    quantity: '1',
    notes: '',
  })
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [payments, setPayments] = useState([])
  const [rateSource, setRateSource] = useState('bcv_eur')
  const [rateValue, setRateValue] = useState('')
  const [saleNotes, setSaleNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [completedSale, setCompletedSale] = useState(null)
  const [cashSession, setCashSession] = useState(null)
  const [cashLoading, setCashLoading] = useState(true)
  const [openCashOpen, setOpenCashOpen] = useState(false)
  const [openingBs, setOpeningBs] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [openingBills, setOpeningBills] = useState(emptyBillCounts())
  const [sessionDrawer, setSessionDrawer] = useState(emptyBillCounts())
  const [changeValue, setChangeValue] = useState(emptyChange())
  const [orderData, setOrderData] = useState(null)
  const [orderCustomer, setOrderCustomer] = useState(null)
  const [orderId, setOrderId] = useState(null)
  const loadedOrderRef = useRef(null)
  const lastChangeDueRef = useRef(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const comandaId = searchParams.get('comanda')

  const ctx = useMemo(() => buildCostContext(catalog), [catalog])

  const loadCash = useCallback(async () => {
    setCashLoading(true)
    try {
      const session = await getOpenLocalSession()
      setCashSession(session)
      if (session) {
        const ledger = await getLocalBillLedger(session.id)
        setSessionDrawer(drawerFromLedger(ledger))
        if (session.exchange_rate) setRateValue(String(session.exchange_rate))
      } else {
        setSessionDrawer(emptyBillCounts())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCashLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCash()
  }, [loadCash])

  useEffect(() => {
    if (!rateValue) {
      const source = catalog.business?.public_rate_source || 'bcv_eur'
      const validSource = BS_RATE_SOURCES.some((r) => r.value === source) ? source : 'bcv_eur'
      const value = getRateValue(catalog.rate, validSource)
      setRateSource(validSource)
      if (value) setRateValue(String(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.rate, catalog.business])

  useEffect(() => {
    if (!comandaId || !catalog.ready || loadedOrderRef.current === comandaId) return undefined
    let cancelled = false

    const loadOrder = async () => {
      loadedOrderRef.current = comandaId
      const { data, error } = await supabase
        .from('public_orders')
        .select('*, public_order_items(*, public_order_item_options(*))')
        .eq('id', comandaId)
        .maybeSingle()

      if (cancelled) return
      if (error) {
        loadedOrderRef.current = null
        push(error.message || 'No se pudo cargar la comanda', 'error')
        return
      }
      if (!data) {
        loadedOrderRef.current = null
        push('Comanda no encontrada', 'error')
        return
      }
      if (data.sale_id) {
        loadedOrderRef.current = null
        push('Esa comanda ya fue cobrada', 'info')
        setSearchParams({})
        return
      }

      const mapped = []
      for (const item of data.public_order_items || []) {
        const product = (catalog.products || []).find((p) => p.id === item.product_id)
        if (!product) {
          loadedOrderRef.current = null
          push('Producto no disponible: ' + item.product_name, 'error')
          return
        }
        const selectedOptions = (item.public_order_item_options || [])
          .map((opt) => (catalog.options || []).find((o) => o.id === opt.option_id))
          .filter(Boolean)
        mapped.push({
          key: 'order-' + item.id,
          product,
          quantity: Number(item.quantity),
          selectedOptions,
          notes: item.notes || '',
          unitPrice: Number(item.unit_price_usd),
          unitCost: saleItemUnitCost(product, selectedOptions, ctx),
        })
      }

      setCart(mapped)
      setOrderData(data)
      setOrderId(data.id)
      setOrderCustomer(data.customer_name)
      if (Number(data.rate_value) > 0) {
        setRateValue(String(data.rate_value))
        setRateSource(data.rate_source || 'bcv_eur')
      }
      setSaleNotes(
        'Comanda ' +
          data.order_number +
          ' · ' +
          data.customer_phone +
          ' · ' +
          (data.fulfillment === 'delivery'
            ? 'Delivery: ' + (data.address || '')
            : 'Pickup'),
      )
      push('Comanda ' + data.order_number + ' cargada', 'success')
    }

    loadOrder().catch((e) => {
      console.error(e)
      loadedOrderRef.current = null
      push(e.message || 'No se pudo cargar la comanda', 'error')
    })

    return () => {
      cancelled = true
    }
  }, [comandaId, catalog.ready, catalog.options, catalog.products, ctx, push, setSearchParams])

  const products = useMemo(
    () =>
      (catalog.products || [])
        .filter((p) => p.active !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name)),
    [catalog.products],
  )

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (category !== 'todos' && p.category !== category) return false
      if (!q) return true
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      )
    })
  }, [products, category, search])

  const paymentMethods = useMemo(
    () =>
      (catalog.payment_methods || [])
        .filter((m) => m.active !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [catalog.payment_methods],
  )

  const total = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
        0,
      ),
    [cart],
  )
  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.quantity), 0),
    [cart],
  )
  const totalBs = convertUsdToBs(total, rateValue)

  const configGroups = useMemo(
    () => (configProduct ? groupsForProduct(configProduct, ctx) : []),
    [configProduct, ctx],
  )
  const toppingGroup = configGroups.find((g) => g.slug === 'topping')
  const sauceGroup = configGroups.find((g) => g.slug === 'salsas')
  const toppingOptions = useMemo(
    () => (toppingGroup ? optionsOfGroup(toppingGroup.id, ctx) : []),
    [toppingGroup, ctx],
  )
  const sauceOptions = useMemo(
    () => (sauceGroup ? optionsOfGroup(sauceGroup.id, ctx) : []),
    [sauceGroup, ctx],
  )
  const selectedConfigOptions = useMemo(() => {
    const list = []
    if (configForm.toppingId) {
      const topping = toppingOptions.find((o) => o.id === configForm.toppingId)
      if (topping) list.push(topping)
    }
    for (const id of configForm.sauceIds) {
      const sauce = sauceOptions.find((o) => o.id === id)
      if (sauce) list.push(sauce)
    }
    return list
  }, [configForm, toppingOptions, sauceOptions])

  const configPrice = configProduct
    ? saleItemUnitPrice(configProduct, selectedConfigOptions)
    : 0
  const configCost = configProduct
    ? saleItemUnitCost(configProduct, selectedConfigOptions, ctx)
    : 0
  const configMargin = marginOf(configPrice, configCost)

  const paidUsd = useMemo(
    () => payments.reduce((sum, p) => sum + (Number(p.amountUsd) || 0), 0),
    [payments],
  )
  const remaining = Math.max(0, total - paidUsd)
  const changeDue = Math.max(0, paidUsd - total)
  const rateNumber = parseNumber(rateValue) || 0
  const cashPayments = payments.filter((p) => p.method.affects_cash)
  const referencesOk = payments.every(
    (p) => !p.method.requires_reference || p.reference.trim().length > 0,
  )
  const changeCovered =
    changeDue <= 0.011 || isChangeCovered(changeValue, changeDue, rateNumber)
  const canCharge =
    total > 0 &&
    payments.length > 0 &&
    remaining <= 0.011 &&
    referencesOk &&
    changeCovered

  useEffect(() => {
    if (changeDue <= 0.011) {
      if (lastChangeDueRef.current !== 0) setChangeValue(emptyChange())
      lastChangeDueRef.current = 0
      return
    }
    if (Math.abs(changeDue - lastChangeDueRef.current) > 0.009) {
      const { proposal } = proposeChange(changeDue, sessionDrawer)
      setChangeValue({ bills: proposal, bs: '', pm: '', pmReference: '' })
      lastChangeDueRef.current = changeDue
    }
  }, [changeDue, sessionDrawer])

  const addToCart = (product, selectedOptions = [], quantity = 1, notes = '') => {
    if (orderId) {
      push('Quita la comanda para modificar el carrito', 'info')
      return
    }
    const qty = Number(quantity) || 1
    if (qty <= 0) return
    const unitPrice = saleItemUnitPrice(product, selectedOptions)
    const unitCost = saleItemUnitCost(product, selectedOptions, ctx)
    const optionsKey = selectedOptions.map((o) => o.id).sort().join(',')
    const key = `${product.id}|${optionsKey}|${notes.trim()}`
    setCart((prev) => {
      const existing = prev.find((item) => item.key === key)
      if (existing) {
        return prev.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + qty } : item,
        )
      }
      return [
        ...prev,
        {
          key,
          product,
          quantity: qty,
          selectedOptions,
          notes: notes.trim(),
          unitPrice,
          unitCost,
        },
      ]
    })
    push(`${product.name} agregado`, 'success', 1800)
  }

  const openConfig = (product) => {
    setConfigProduct(product)
    setConfigForm({ toppingId: '', sauceIds: [], quantity: '1', notes: '' })
  }

  const closeConfig = () => setConfigProduct(null)

  const toggleSauce = (id) => {
    setConfigForm((prev) => ({
      ...prev,
      sauceIds: prev.sauceIds.includes(id)
        ? prev.sauceIds.filter((x) => x !== id)
        : [...prev.sauceIds, id],
    }))
  }

  const addConfigured = () => {
    if (!configProduct) return
    if (toppingGroup?.required && !configForm.toppingId) {
      push('Selecciona un topping', 'error')
      return
    }
    addToCart(
      configProduct,
      selectedConfigOptions,
      parseNumber(configForm.quantity) || 1,
      configForm.notes,
    )
    closeConfig()
  }

  const updateQty = (key, delta) => {
    if (orderId) {
      push('Quita la comanda para modificar el carrito', 'info')
      return
    }
    setCart((prev) =>
      prev
        .map((item) =>
          item.key === key
            ? { ...item, quantity: Number(item.quantity) + delta }
            : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }

  const removeItem = (key) => {
    if (orderId) {
      push('Quita la comanda para modificar el carrito', 'info')
      return
    }
    setCart((prev) => prev.filter((item) => item.key !== key))
  }

  const clearCart = () => {
    if (orderId) {
      clearOrder()
      return
    }
    if (!cart.length) return
    if (!window.confirm('¿Vaciar el carrito?')) return
    setCart([])
  }

  const handleOpenCash = async () => {
    try {
      const session = await openLocalCashSession({
        opening_bills: openingBills,
        opening_bs: parseNumber(openingBs),
        exchange_rate: parseNumber(rateValue) || null,
        user_id: user?.id || null,
      })
      setCashSession(session)
      setOpenCashOpen(false)
      setOpeningBills(emptyBillCounts())
      setOpeningBs('')
      push('Caja abierta', 'success')
      if (online) {
        syncCashSession(session)
          .then(() => syncAll())
          .catch((e) => console.warn('No se pudo sincronizar la caja', e))
      }
      await loadCash()
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo abrir la caja', 'error')
    }
  }

  const clearOrder = () => {
    setOrderData(null)
    setOrderId(null)
    setOrderCustomer(null)
    setCart([])
    setSaleNotes('')
    loadedOrderRef.current = null
    setSearchParams({})
  }

  const openPayment = () => {
    if (!cart.length) return
    if (!cashSession) {
      setOpenCashOpen(true)
      push('Abre la caja antes de cobrar', 'error')
      return
    }
    const source = rateSource || 'bcv_eur'
    const value =
      parseNumber(rateValue) ||
      getRateValue(catalog.rate, source) ||
      Number(cashSession.exchange_rate) ||
      0
    setRateSource(source)
    if (value) setRateValue(String(value))
    setPayments([])
    setChangeValue(emptyChange())
    if (!orderId) setSaleNotes('')
    setPaymentOpen(true)
  }

  const addPayment = (method) => {
    const rest = Math.max(0, total - paidUsd)
    if (rest <= 0.011) {
      push('La venta ya está cubierta', 'info')
      return
    }
    const rate = parseNumber(rateValue) || 0
    if (method.currency === 'BS' && rate <= 0) {
      push('Escribe la tasa Bs/USD para cobrar en bolívares', 'error')
      return
    }

    const isCashUsd = method.affects_cash && method.currency === 'USD'
    const amount = isCashUsd
      ? ''
      : method.currency === 'BS'
        ? convertUsdToBs(rest, rate).toFixed(2)
        : rest.toFixed(2)
    const amountUsd = isCashUsd ? 0 : rest

    setPayments((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        method,
        amount,
        amountUsd: amountUsd.toFixed(2),
        reference: '',
        bills: isCashUsd ? emptyBillCounts() : null,
      },
    ])
  }

  const updatePayment = (key, field, value) => {
    setPayments((prev) =>
      prev.map((p) => {
        if (p.key !== key) return p
        if (field === 'amount') {
          const amountNum = parseNumber(value)
          const rate = parseNumber(rateValue) || 0
          const amountUsd =
            p.method.currency === 'BS' ? convertBsToUsd(amountNum, rate) : amountNum
          return { ...p, amount: value, amountUsd: amountUsd.toFixed(2) }
        }
        if (field === 'bills') {
          const totalBills = sumBills(value)
          return {
            ...p,
            bills: value,
            amount: totalBills ? totalBills.toFixed(2) : '',
            amountUsd: totalBills.toFixed(2),
          }
        }
        return { ...p, [field]: value }
      }),
    )
  }

  const removePayment = (key) => {
    setPayments((prev) => prev.filter((p) => p.key !== key))
  }

  const changeRateSource = (source) => {
    setRateSource(source)
    const value = getRateValue(catalog.rate, source)
    if (value) applyRateValue(String(value))
  }

  const applyRateValue = (value) => {
    setRateValue(value)
    const rate = parseNumber(value) || 0
    if (rate <= 0) return
    setPayments((prev) =>
      prev.map((p) => {
        if (p.method.currency !== 'BS') return p
        const amountUsd = Number(p.amountUsd) || 0
        return { ...p, amount: convertUsdToBs(amountUsd, rate).toFixed(2) }
      }),
    )
  }

  const handleCharge = async () => {
    if (!cashSession) {
      setOpenCashOpen(true)
      return
    }
    if (!canCharge) {
      if (changeDue > 0.011 && !changeCovered) {
        push('Completa el vuelto para poder cobrar', 'error')
      } else if (!referencesOk) {
        push('Completa las referencias obligatorias de los pagos', 'error')
      } else {
        push('Faltan pagos por cubrir', 'error')
      }
      return
    }

    setSubmitting(true)
    try {
      const clientId = crypto.randomUUID()
      const orderNumber = generateOrderNumber()
      const rate = parseNumber(rateValue) || 0
      const now = new Date().toISOString()

      const itemsPayload = cart.map((item) => {
        const options = item.selectedOptions.map((opt) => {
          const group = ctx.groupsMap.get(opt.group_id)
          return {
            option_id: opt.id,
            group_name: group?.name || '',
            option_name: opt.name,
            price_delta_usd: Number(opt.price_delta_usd) || 0,
            unit_cost_usd: optionCost(opt.id, ctx),
          }
        })
        return {
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: Number(item.quantity),
          unit_price_usd: Number(item.unitPrice),
          unit_cost_usd: Number(item.unitCost),
          line_total_usd: Number(item.unitPrice) * Number(item.quantity),
          config: {
            topping: options.find((o) => o.group_name === 'Topping')?.option_name || null,
            sauces: options
              .filter((o) => o.group_name === 'Salsas')
              .map((o) => o.option_name),
            options,
          },
          notes: item.notes || null,
          options,
        }
      })

      if (changeDue > 0.011 && cashPayments.length === 0) {
        throw new Error('El vuelto solo se puede dar desde un pago en efectivo')
      }
      if (changeDue > 0.011 && cashPayments.length > 1) {
        throw new Error('Usa un solo pago en efectivo para poder dar el vuelto')
      }

      const changeTarget =
        changeDue > 0.011
          ? cashPayments[0]
          : null

      if (changeTarget && (Number(changeTarget.amountUsd) || 0) + 0.011 < changeDue) {
        throw new Error(
          'El pago en efectivo no alcanza para dar el vuelto. Agrega un billete más grande.',
        )
      }

      const changeUsd = sumBills(changeValue.bills || {})
      const changeBs = parseNumber(changeValue.bs)
      const changePm = parseNumber(changeValue.pm)

      for (const [denom, qty] of Object.entries(changeValue.bills || {})) {
        if (Number(qty) > (sessionDrawer[denom] || 0)) {
          throw new Error(`No hay suficientes billetes de $${denom} para el vuelto`)
        }
      }

      const paymentsPayload = payments.map((p) => {
        const grossUsd = Number(p.amountUsd) || 0
        const isTarget = changeTarget?.key === p.key
        const appliedUsd = isTarget ? Math.max(0, grossUsd - changeDue) : grossUsd
        const appliedNative = p.method.currency === 'BS' ? appliedUsd * rate : appliedUsd
        const receivedNative = p.method.affects_cash ? parseNumber(p.amount) : appliedNative
        return {
          payment_method_id: p.method.id,
          method_code: p.method.code,
          method_name: p.method.name,
          currency: p.method.currency,
          amount: appliedNative,
          amount_usd: appliedUsd,
          received_amount: receivedNative,
          received_usd: p.method.affects_cash ? grossUsd : appliedUsd,
          change_usd: isTarget ? changeUsd : 0,
          change_bs: isTarget ? changeBs : 0,
          change_pm_amount: isTarget ? changePm : 0,
          change_pm_reference: isTarget ? changeValue.pmReference || null : null,
          bills:
            p.method.affects_cash && p.method.currency === 'USD'
              ? billsToJson(p.bills || {})
              : null,
          change_bills: isTarget ? billsToJson(changeValue.bills || {}) : null,
          rate_source: rateSource,
          rate_value: rate,
          reference: p.reference || null,
          affects_cash: p.method.affects_cash === true,
        }
      })

      const salePayload = {
        client_id: clientId,
        order_number: orderNumber,
        cash_session_id: cashSession.id,
        public_order_id: orderId || null,
        subtotal_usd: total,
        discount_usd: 0,
        total_usd: total,
        total_bs: convertUsdToBs(total, rate),
        change_usd: changeUsd,
        change_bs: changeBs,
        rate_source: rateSource,
        rate_value: rate,
        customer_name: orderCustomer || null,
        notes: saleNotes.trim() || null,
        created_at: now,
        items: itemsPayload,
        payments: paymentsPayload,
      }

      await db.pending_sales.put({
        client_id: clientId,
        payload: salePayload,
        sync_status: 'pending',
        created_at: now,
        order_number: orderNumber,
        total_usd: total,
        total_bs: convertUsdToBs(total, rate),
        error: null,
      })

      // Descuento local para que el stock se refleje de inmediato.
      for (const item of cart) {
        if (item.product.product_type === 'recipe') {
          const explosion = explodeSaleItem(
            item.product,
            item.selectedOptions,
            item.quantity,
            ctx,
          )
          for (const row of explosion) {
            const ing = await db.ingredients.get(row.ingredient_id)
            if (ing) {
              await db.ingredients.update(row.ingredient_id, {
                stock_base: (Number(ing.stock_base) || 0) - row.quantity_base,
              })
            }
          }
        } else if (item.product.track_stock) {
          const prod = await db.products.get(item.product.id)
          if (prod) {
            await db.products.update(item.product.id, {
              stock_base: (Number(prod.stock_base) || 0) - Number(item.quantity),
            })
          }
        }
      }

      for (const payment of paymentsPayload) {
        await addLocalCashMovement({
          sessionId: cashSession.id,
          payment,
          saleId: clientId,
          notes: 'Venta ' + orderNumber,
        })
      }

      const receivedBills = {}
      const changeBills = {}
      for (const payment of payments) {
        if (payment.method.affects_cash && payment.method.currency === 'USD' && payment.bills) {
          for (const [denom, qty] of Object.entries(payment.bills)) {
            if (Number(qty) > 0) {
              receivedBills[denom] = (receivedBills[denom] || 0) + Number(qty)
            }
          }
        }
      }
      for (const [denom, qty] of Object.entries(changeValue.bills || {})) {
        if (Number(qty) > 0) {
          changeBills[denom] = (changeBills[denom] || 0) + Number(qty)
        }
      }

      if (Object.keys(receivedBills).length) {
        await addLocalBillMovements({
          sessionId: cashSession.id,
          type: 'venta',
          counts: receivedBills,
          saleId: clientId,
          note: 'Venta ' + orderNumber,
          syncStatus: 'with_sale',
        })
      }
      if (Object.keys(changeBills).length) {
        await addLocalBillMovements({
          sessionId: cashSession.id,
          type: 'vuelto',
          counts: changeBills,
          saleId: clientId,
          note: 'Vuelto ' + orderNumber,
          syncStatus: 'with_sale',
        })
      }

      await loadCash()

      const receiptSale = {
        ...salePayload,
        items: itemsPayload,
        payments: paymentsPayload,
        change_value: changeValue,
      }

      setCompletedSale(receiptSale)
      setPaymentOpen(false)
      setCart([])
      setPayments([])
      setSaleNotes('')
      setCartOpen(false)
      setChangeValue(emptyChange())
      setOrderData(null)
      setOrderId(null)
      setOrderCustomer(null)
      loadedOrderRef.current = null
      setSearchParams({})
      push(
        online
          ? 'Venta registrada; sincronizando...'
          : 'Venta guardada sin internet',
        'success',
      )

      if (online) {
        syncCashSession(cashSession)
          .then(() => syncPendingSales())
          .then(() => refreshCatalog())
          .catch((e) => console.warn('No se pudo sincronizar la venta', e))
      }
    } catch (e) {
      console.error(e)
      push(e.message || 'No se pudo registrar la venta', 'error')
    } finally {
      setSubmitting(false)
    }
  }


  const handleSync = async () => {
    if (!online || syncing) return
    setSyncing(true)
    try {
      const result = await syncAll()
      if (result.error) push(`Sync con advertencias: ${result.error}`, 'error')
      else push(`Sincronizado: ${result.salesSynced || 0} venta(s)`, 'success')
      await loadCash()
    } catch (e) {
      push(e.message || 'No se pudo sincronizar', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const renderCart = () => (
    <>
      <div className={styles.cartItems}>
        {cart.length === 0 ? (
          <div className={styles.cartEmpty}>
            <ShoppingCart size={28} style={{ color: 'var(--orange)', marginBottom: 8 }} />
            <p>El carrito está vacío.</p>
            <p style={{ marginTop: 4 }}>Toca un producto para empezar.</p>
          </div>
        ) : (
          cart.map((item) => (
            <div className={styles.cartItem} key={item.key}>
              <div className={styles.cartItemTop}>
                <div>
                  <div className={styles.cartItemName}>{item.product.name}</div>
                  {item.selectedOptions.length ? (
                    <div className={styles.cartItemMeta}>
                      {optionNames(item.selectedOptions).join(' · ')}
                    </div>
                  ) : null}
                  {item.notes ? (
                    <div className={styles.cartItemMeta}>Nota: {item.notes}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={styles.paymentLineDelete}
                  onClick={() => removeItem(item.key)}
                  aria-label="Quitar"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className={styles.cartItemBottom}>
                <div className={styles.qtyControls}>
                  <button type="button" className={styles.qtyBtn} onClick={() => updateQty(item.key, -1)}>
                    <Minus size={13} />
                  </button>
                  <span className={styles.qtyValue}>{item.quantity}</span>
                  <button type="button" className={styles.qtyBtn} onClick={() => updateQty(item.key, 1)}>
                    <Plus size={13} />
                  </button>
                </div>
                <div className={styles.lineTotal}>
                  {money(Number(item.unitPrice) * Number(item.quantity))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>Subtotal</span>
          <strong>{money(total)}</strong>
        </div>
        <div className={styles.totalRow}>
          <span>Total Bs</span>
          <strong>{formatBs(totalBs)}</strong>
        </div>
        <div className={`${styles.totalRow} mt-2`}>
          <span>Total</span>
          <span className={styles.grandTotal}>{money(total)}</span>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block btn-lg mt-3"
        onClick={openPayment}
        disabled={!cart.length}
      >
        <Calculator size={17} /> Cobrar {money(total)}
      </button>
      {!cashSession ? (
        <button
          type="button"
          className="btn btn-block mt-2"
          onClick={() => setOpenCashOpen(true)}
        >
          Abrir caja para cobrar
        </button>
      ) : (
        <p className="tiny muted mt-2" style={{ textAlign: 'center' }}>
          Caja abierta · {money(cashSession.opening_usd)} USD · {formatBs(cashSession.opening_bs)}
        </p>
      )}
    </>
  )

  if (!catalog.ready) {
    return (
      <>
        <PageHeader
          title="Vender"
          subtitle="POS táctil con toppings, salsas y pagos mixtos."
          icon={ShoppingCart}
        />
        <div className="card">
          <EmptyState
            icon={ShoppingCart}
            title="Falta descargar el menú"
            text="Conéctate a internet y sincroniza para cargar productos, recetas y precios."
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
        title="Vender"
        subtitle="Toca la banderilla, elige topping y salsas, y cobra."
        icon={ShoppingCart}
        actions={
          <>
            <Link to="/admin/caja" className="btn">
              <Wallet size={15} /> Caja
            </Link>
            <button type="button" className="btn" onClick={handleSync} disabled={!online || syncing}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} /> Sincronizar
            </button>
          </>
        }
      />

      {orderData ? (
        <div className="alert alert-warn mb-3 flex items-center justify-between gap-2 wrap">
          <span className="flex items-center gap-2">
            <ClipboardList size={15} />
            Cobrando comanda <strong>{orderData.order_number}</strong> de{' '}
            {orderData.customer_name}
            {orderData.fulfillment === 'delivery' ? ' · Delivery' : ' · Pickup'}
          </span>
          <button type="button" className="btn btn-sm" onClick={clearOrder}>
            <X size={14} /> Quitar comanda
          </button>
        </div>
      ) : null}

      {!cashSession && !cashLoading ? (
        <div className="alert alert-warn mb-3 flex items-center justify-between gap-2 wrap">
          <span>No hay caja abierta. Ábrela para empezar a vender.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpenCashOpen(true)}>
            Abrir caja
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-2 wrap mb-3">
        <span className={`badge ${online ? 'badge-green' : 'badge-red'}`}>
          {online ? <Cloud size={12} /> : <CloudOff size={12} />}
          {online ? 'En línea' : 'Sin conexión: se guarda local'}
        </span>
        {pending.total > 0 ? (
          <span className="badge badge-yellow">
            {pending.total} operación(es) pendiente(s)
          </span>
        ) : null}
        {cashSession ? (
          <span className="badge badge-orange">
            <Wallet size={12} /> Caja abierta
          </span>
        ) : null}
      </div>

      <div className={styles.layout}>
        <div className={styles.productSection}>
          <div className="card">
            <div className="flex items-center gap-2 wrap mb-3">
              <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: 11,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--muted-2)',
                  }}
                />
                <input
                  className="input"
                  style={{ paddingLeft: 34 }}
                  placeholder="Buscar producto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-1 wrap mb-3">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={`chip ${category === tab.value ? 'active' : ''}`}
                  onClick={() => setCategory(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 ? (
              <EmptyState
                icon={UtensilsCrossed}
                title="No hay productos"
                text="Revisa el buscador, la categoría o carga el menú."
              />
            ) : (
              <div className={styles.productGrid}>
                {filteredProducts.map((product) => {
                  const cost = saleItemUnitCost(product, [], ctx)
                  const margin = marginOf(product.price_usd, cost)
                  const isBanderilla = product.category === 'banderilla'
                  return (
                    <button
                      key={product.id}
                      type="button"
                      className={styles.productCard}
                      onClick={() =>
                        isBanderilla
                          ? openConfig(product)
                          : addToCart(product, [], 1, '')
                      }
                    >
                      <div>
                        <div className={styles.productVisual}>
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} loading="lazy" />
                          ) : (
                            <UtensilsCrossed size={28} />
                          )}
                        </div>
                        <div className={styles.productName}>{product.name}</div>
                        <div className={styles.productMeta}>
                          {CATEGORY_LABELS[product.category] || product.category}
                          {isBanderilla ? ' · 1 topping + salsas' : ''}
                        </div>
                      </div>
                      <div className={styles.productBottom}>
                        <div>
                          <div className={styles.productPrice}>{money(product.price_usd)}</div>
                          <div className={styles.productMeta}>
                            Margen {money(margin.amount)}
                          </div>
                        </div>
                        <span className={styles.productAdd}>
                          <Plus size={15} />
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <aside className={styles.cartPanel}>
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="card-title" style={{ margin: 0 }}>
                <ShoppingCart size={16} /> Carrito ({cartCount})
              </p>
              {cart.length ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={clearCart}>
                  Vaciar
                </button>
              ) : null}
            </div>
            {renderCart()}
          </div>
        </aside>
      </div>

      {cartCount > 0 ? (
        <div className={styles.mobileCartBar}>
          <div style={{ flex: 1 }}>
            <div className="tiny" style={{ opacity: 0.7 }}>{cartCount} artículo(s)</div>
            <div className={styles.grandTotal}>{money(total)}</div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCartOpen(true)}
          >
            Ver carrito
          </button>
        </div>
      ) : null}

      <Modal
        open={Boolean(configProduct)}
        onClose={closeConfig}
        title={configProduct?.name || 'Configurar banderilla'}
        icon={UtensilsCrossed}
        footer={
          <>
            <button type="button" className="btn" onClick={closeConfig}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={addConfigured}>
              <Plus size={15} /> Agregar {money(configPrice * (parseNumber(configForm.quantity) || 1))}
            </button>
          </>
        }
      >
        {configProduct ? (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <p className="label">Precio</p>
                <p className="money" style={{ fontSize: 20 }}>{money(configPrice)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p className="label">Costo / margen</p>
                <p className="small">
                  {money(configCost)} ·{' '}
                  <span className={configMargin.amount >= 0 ? 'positive' : 'negative'}>
                    {money(configMargin.amount)}
                  </span>
                </p>
              </div>
            </div>

            {toppingOptions.length ? (
              <div className="mb-3">
                <p className="label mb-1">
                  Topping {toppingGroup?.required ? '(obligatorio, elige 1)' : '(elige 1)'}
                </p>
                <div className="flex wrap gap-2">
                  {toppingOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`chip ${configForm.toppingId === option.id ? 'active' : ''}`}
                      onClick={() =>
                        setConfigForm((prev) => ({ ...prev, toppingId: option.id }))
                      }
                    >
                      {option.name}
                      <span className="tiny" style={{ opacity: 0.65 }}>
                        {money(optionCost(option.id, ctx))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {sauceOptions.length ? (
              <div className="mb-3">
                <p className="label mb-1">Salsas (todas las que quiera)</p>
                <div className="flex wrap gap-2">
                  {sauceOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`chip ${configForm.sauceIds.includes(option.id) ? 'active' : ''}`}
                      onClick={() => toggleSauce(option.id)}
                    >
                      {option.name}
                      <span className="tiny" style={{ opacity: 0.65 }}>
                        {money(optionCost(option.id, ctx))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="form-grid">
              <div className="field">
                <label>Cantidad</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() =>
                      setConfigForm((prev) => ({
                        ...prev,
                        quantity: String(Math.max(1, (parseNumber(prev.quantity) || 1) - 1)),
                      }))
                    }
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={configForm.quantity}
                    onChange={(e) =>
                      setConfigForm((prev) => ({ ...prev, quantity: e.target.value }))
                    }
                    style={{ textAlign: 'center', maxWidth: 90 }}
                  />
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() =>
                      setConfigForm((prev) => ({
                        ...prev,
                        quantity: String((parseNumber(prev.quantity) || 1) + 1),
                      }))
                    }
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Nota</label>
                <input
                  className="input"
                  value={configForm.notes}
                  onChange={(e) =>
                    setConfigForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Sin cebolla, extra salsa..."
                />
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title="Cobrar"
        icon={Wallet}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setPaymentOpen(false)} disabled={submitting}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={handleCharge}
              disabled={!canCharge || submitting}
            >
              {submitting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
              {submitting ? 'Registrando...' : `Cobrar ${money(total)}`}
            </button>
          </>
        }
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <p className="label">Total a cobrar</p>
            <p className="money" style={{ fontSize: 26 }}>{money(total)}</p>
            <p className="small muted">{formatBs(totalBs)}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="label">Pagado</p>
            <p className="money positive" style={{ fontSize: 18 }}>{money(paidUsd)}</p>
            {changeDue > 0.011 ? (
              <p className="small positive">Vuelto {money(changeDue)}</p>
            ) : (
              <p className={`small ${remaining > 0.011 ? 'negative' : 'positive'}`}>
                {remaining > 0.011 ? `Faltan ${money(remaining)}` : 'Cubierto'}
              </p>
            )}
          </div>
        </div>

        <p className="label mb-1">Tasa para bolívares</p>

        <p className="label mb-1">Tasa para bolívares</p>
        <div className={styles.rateRow}>
          {BS_RATE_SOURCES.map((source) => (
            <button
              key={source.value}
              type="button"
              className={`${styles.rateBtn} ${rateSource === source.value ? styles.rateBtnActive : ''}`}
              onClick={() => changeRateSource(source.value)}
            >
              {source.label}
            </button>
          ))}
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={rateValue}
            onChange={(e) => applyRateValue(e.target.value)}
            placeholder="Tasa Bs/USD"
            style={{ maxWidth: 140 }}
          />
        </div>
        {!parseNumber(rateValue) ? (
          <p className="tiny muted mb-2">
            Puedes cobrar en USD sin tasa. Para bolívares, escribe la tasa Bs/USD.
          </p>
        ) : null}

        <p className="label mb-1">Métodos de pago</p>
        <div className={styles.paymentGrid}>
          {paymentMethods.map((method) => {
            const Icon = methodIcon(method.code)
            return (
              <button
                key={method.id}
                type="button"
                className={styles.paymentMethodBtn}
                onClick={() => addPayment(method)}
              >
                <span className="flex items-center gap-2">
                  <Icon size={16} style={{ color: 'var(--orange)' }} />
                  <span className={styles.paymentMethodName}>{method.name}</span>
                </span>
                <span className={styles.paymentMethodMeta}>
                  {method.currency === 'BS' ? 'Bolívares' : method.currency}
                  {method.affects_cash ? ' · caja' : ''}
                </span>
              </button>
            )
          })}
        </div>

        {payments.length ? (
          <div className="mt-3">
            <p className="label mb-1">Pagos agregados</p>
            {payments.map((payment) => (
              <div className={styles.paymentLine} key={payment.key}>
                <div className={styles.paymentLineTop}>
                  <span className={styles.paymentLineName}>
                    {payment.method.name} · {payment.method.currency}
                  </span>
                  <button
                    type="button"
                    className={styles.paymentLineDelete}
                    onClick={() => removePayment(payment.key)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className={styles.paymentLineGrid}>
                  {payment.method.affects_cash && payment.method.currency === 'USD' ? (
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <BillPicker
                        value={payment.bills || emptyBillCounts()}
                        onChange={(bills) => updatePayment(payment.key, 'bills', bills)}
                        compact
                        label="Billetes que entrega"
                        showClear={false}
                      />
                      <span className="tiny muted">
                        Entrega: {money(payment.amountUsd)} ·{' '}
                        {sumBills(payment.bills || {}) > 0
                          ? 'Toca los billetes recibidos'
                          : 'Selecciona los billetes del cliente'}
                      </span>
                    </div>
                  ) : (
                    <div className="field">
                      <label>
                        {payment.method.currency === 'BS' ? 'Monto en Bs' : 'Monto'}
                      </label>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={payment.amount}
                        onChange={(e) => updatePayment(payment.key, 'amount', e.target.value)}
                      />
                      <span className="tiny muted">
                        {money(payment.amountUsd)} equivalente
                      </span>
                    </div>
                  )}
                  <div className="field">
                    <label>Referencia</label>
                    <input
                      className="input"
                      value={payment.reference}
                      onChange={(e) => updatePayment(payment.key, 'reference', e.target.value)}
                      placeholder={payment.method.requires_reference ? 'Obligatoria' : 'Opcional'}
                    />
                  </div>
                </div>              </div>
            ))}
          </div>
        ) : (
          <p className="muted small mt-2">Toca un método para agregar el pago.</p>
        )}

        {changeDue > 0.011 ? (
          <div className="mt-2">
            <VueltoMixto
              changeDue={changeDue}
              drawer={sessionDrawer}
              rate={rateNumber}
              value={changeValue}
              onChange={setChangeValue}
              disabled={submitting}
            />
          </div>
        ) : null}
        {changeDue > 0.011 && cashPayments.length === 0 ? (
          <p className="small negative mt-1">
            El vuelto solo se puede dar desde un pago en efectivo.
          </p>
        ) : null}

        {!referencesOk ? (
          <p className="small negative mt-1">
            Completa las referencias obligatorias de los pagos.
          </p>
        ) : null}

        <div className="field mt-3">
          <label>Nota de la venta</label>
          <input
            className="input"
            value={saleNotes}
            onChange={(e) => setSaleNotes(e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </Modal>

      <Modal
        open={openCashOpen}
        onClose={() => setOpenCashOpen(false)}
        title="Abrir caja"
        icon={Wallet}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpenCashOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleOpenCash}>
              Abrir caja
            </button>
          </>
        }
      >
        <p className="small muted mb-2">
          Cuenta los billetes con los que abre la caja. El total se calcula solo.
        </p>
        <BillPicker
          value={openingBills}
          onChange={setOpeningBills}
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
            <label>Tasa del turno (Bs/USD)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
              placeholder="Tasa BCV EUR"
            />
          </div>
        </div>
        <p className="small muted mt-2">
          Total apertura: <strong>{money(sumBills(openingBills))}</strong>
        </p>
      </Modal>

      <Modal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={`Carrito (${cartCount})`}
        icon={ShoppingCart}
      >
        {renderCart()}
      </Modal>

      <Modal
        open={Boolean(completedSale)}
        onClose={() => setCompletedSale(null)}
        title="Venta registrada"
        icon={CheckCircle2}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => completedSale && downloadReceipt(completedSale)}
            >
              Descargar PDF
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCompletedSale(null)}>
              Nueva venta
            </button>
          </>
        }
      >
        {completedSale ? (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle2 size={44} style={{ color: 'var(--green)', marginBottom: 8 }} />
            <p className="label">Pedido</p>
            <p className="money" style={{ fontSize: 18 }}>{completedSale.order_number}</p>
            <p className="money" style={{ fontSize: 30, marginTop: 8 }}>
              {money(completedSale.total_usd)}
            </p>
            <p className="muted">{formatBs(completedSale.total_bs)}</p>
            <div className="divider" />
            <div className="small" style={{ textAlign: 'left' }}>
              {completedSale.payments.map((p, index) => (
                <div className="flex justify-between gap-2" key={index} style={{ marginBottom: 4 }}>
                  <span>{p.method_name}</span>
                  <span>
                    {p.currency === 'BS'
                      ? formatBs(p.amount)
                      : `${p.currency} ${number(p.amount)}`}
                  </span>
                </div>
              ))}
            </div>
            {!online ? (
              <p className="tiny muted mt-3">
                Guardada localmente. Se sincronizará cuando vuelva el internet.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
