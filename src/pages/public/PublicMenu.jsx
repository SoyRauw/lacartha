import { useEffect, useMemo, useState } from 'react'
import {
  AtSign,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  ShoppingBag,
  Store,
  Truck,
  UtensilsCrossed,
  X,
  Sparkles,
  Sandwich,
} from 'lucide-react'
import { Modal } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { LOGO_URL } from '../../lib/assets'
import {
  BUSINESS_INSTAGRAM,
  BUSINESS_INSTAGRAM_HANDLE,
  BUSINESS_PHONE,
  BUSINESS_TAGLINE,
  BUSINESS_WHATSAPP,
  CATEGORIES,
  CATEGORY_LABELS,
} from '../../lib/constants'
import {
  bs as formatBs,
  convertUsdToBs,
  money,
  parseNumber,
  roundBs,
} from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import { fetchRatesFromApi, rateLabel } from '../../lib/rates'
import { buildOrderMessage, openWhatsApp } from '../../lib/whatsapp'
import styles from './PublicMenu.module.css'

const EMPTY_CUSTOMER = {
  name: '',
  phone: '',
  fulfillment: 'pickup',
  address: '',
  notes: '',
}

function productIcon(category) {
  return category === 'banderilla' ? Sandwich : UtensilsCrossed
}

export default function PublicMenu() {
  const [business, setBusiness] = useState(null)
  const [products, setProducts] = useState([])
  const [groups, setGroups] = useState([])
  const [options, setOptions] = useState([])
  const [rate, setRate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('todos')
  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  const [configProduct, setConfigProduct] = useState(null)
  const [configForm, setConfigForm] = useState({
    toppingId: '',
    sauceIds: [],
    quantity: '1',
    notes: '',
  })
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER)
  const [sending, setSending] = useState(false)
  const [sentOrder, setSentOrder] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [businessRes, productsRes, groupsRes, optionsRes, rateRes] =
        await Promise.all([
          supabase.from('public_business_settings').select('*').maybeSingle(),
          supabase.from('public_menu_products').select('*'),
          supabase.from('public_menu_option_groups').select('*'),
          supabase.from('public_menu_options').select('*'),
          supabase.from('public_rate_latest').select('*').maybeSingle(),
        ])

      if (businessRes.error) throw businessRes.error
      if (productsRes.error) throw productsRes.error
      if (groupsRes.error) throw groupsRes.error
      if (optionsRes.error) throw optionsRes.error
      if (rateRes.error) throw rateRes.error

      let liveRate = null
      if (navigator.onLine) {
        try {
          liveRate = await fetchRatesFromApi()
        } catch (rateError) {
          console.warn('No se pudo consultar la tasa en vivo; usando snapshot', rateError)
        }
      }

      setBusiness(businessRes.data || null)
      setProducts(productsRes.data || [])
      setGroups(groupsRes.data || [])
      setOptions(optionsRes.data || [])
      setRate(liveRate || rateRes.data || null)
    } catch (e) {
      console.error(e)
      setError(e.message || 'No se pudo cargar el menú')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    document.title = 'La Cartha — Banderillas Coreanas'
    const meta = document.querySelector('meta[name="description"]')
    if (meta) {
      meta.setAttribute(
        'content',
        'La Cartha by Valentina Castro — banderillas coreanas, delivery y comer aquí en Maracaibo.',
      )
    }
  }, [])

  const source = ['bcv_usd', 'bcv_eur'].includes(business?.public_rate_source)
    ? business.public_rate_source
    : 'bcv_eur'
  const rateValue =
    source === 'manual'
      ? Number(business?.public_rate_value) || 0
      : Number(rate?.[source]) ||
        Number(rate?.bcv_eur) ||
        Number(rate?.bcv_usd) ||
        0

  const rateDate =
    rate?.source_date || rate?.fetched_at || rate?.snapshot_date || null

  const bsPrice = (priceUsd) =>
    rateValue > 0 ? roundBs(convertUsdToBs(priceUsd, rateValue), 'up_010') : null

  const toppingGroup = useMemo(
    () => groups.find((g) => g.slug === 'topping'),
    [groups],
  )
  const sauceGroup = useMemo(() => groups.find((g) => g.slug === 'salsas'), [groups])
  const toppingOptions = useMemo(
    () =>
      options
        .filter((o) => o.group_id === toppingGroup?.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [options, toppingGroup],
  )
  const sauceOptions = useMemo(
    () =>
      options
        .filter((o) => o.group_id === sauceGroup?.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [options, sauceGroup],
  )

  const categories = useMemo(
    () => [
      { value: 'todos', label: 'Todo' },
      ...CATEGORIES.filter((c) => products.some((p) => p.category === c.value)).map(
        (c) => ({ value: c.value, label: c.label }),
      ),
    ],
    [products],
  )

  const visibleProducts = useMemo(() => {
    return products.filter((p) => category === 'todos' || p.category === category)
  }, [products, category])

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
    ? Number(configProduct.price_usd) +
      selectedConfigOptions.reduce((sum, o) => sum + (Number(o.price_delta_usd) || 0), 0)
    : 0

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.quantity), 0),
    [cart],
  )
  const cartTotalUsd = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + Number(item.unitPriceUsd) * Number(item.quantity),
        0,
      ),
    [cart],
  )
  const cartTotalBs =
    rateValue > 0 ? roundBs(convertUsdToBs(cartTotalUsd, rateValue), 'up_010') : 0

  const openConfig = (product) => {
    setConfigProduct(product)
    setConfigForm({ toppingId: '', sauceIds: [], quantity: '1', notes: '' })
  }

  const addToCart = (product, selectedOptions = [], quantity = 1, notes = '') => {
    const qty = Number(quantity) || 1
    if (qty <= 0) return
    const unitPriceUsd =
      Number(product.price_usd) +
      selectedOptions.reduce((sum, o) => sum + (Number(o.price_delta_usd) || 0), 0)
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
          unitPriceUsd,
        },
      ]
    })
  }

  const addConfigured = () => {
    if (!configProduct) return
    if (toppingGroup?.required && !configForm.toppingId) {
      alert('Elige un topping para tu banderilla.')
      return
    }
    addToCart(
      configProduct,
      selectedConfigOptions,
      parseNumber(configForm.quantity) || 1,
      configForm.notes,
    )
    setConfigProduct(null)
  }

  const updateQty = (key, delta) => {
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
    setCart((prev) => prev.filter((item) => item.key !== key))
  }

  const openCheckout = () => {
    if (!cart.length) return
    const defaultFulfillment =
      business?.pickup_enabled === false && business?.delivery_enabled !== false
        ? 'delivery'
        : 'pickup'
    setCustomer((prev) => ({ ...prev, fulfillment: defaultFulfillment }))
    setCartOpen(false)
    setCheckoutOpen(true)
  }

  const sendOrder = async () => {
    if (!cart.length) return
    if (!customer.name.trim() || !customer.phone.trim()) {
      alert('Escribe tu nombre y teléfono para enviar el pedido.')
      return
    }
    if (customer.fulfillment === 'delivery' && !customer.address.trim()) {
      alert('Escribe la dirección para el delivery.')
      return
    }
    setSending(true)
    try {
      const payload = {
        customer_name: customer.name.trim(),
        customer_phone: customer.phone.trim(),
        fulfillment: customer.fulfillment,
        address: customer.address.trim(),
        notes: customer.notes.trim(),
        rate_source: source,
        rate_value: rateValue,
        items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: Number(item.quantity),
          notes: item.notes || '',
          option_ids: item.selectedOptions.map((option) => option.id),
        })),
      }

      const { data, error: rpcError } = await supabase.rpc('create_public_order', { payload })
      if (rpcError) throw rpcError
      const result = typeof data === 'string' ? JSON.parse(data) : data
      if (!result?.order_number) throw new Error('No se recibió el número de pedido')

      const message = buildOrderMessage({
        orderNumber: result.order_number,
        customer,
        items: cart.map((item) => ({
          product_name: item.product.name,
          quantity: item.quantity,
          options: item.selectedOptions.map((o) => ({ option_name: o.name })),
          line_total_usd: Number(item.unitPriceUsd) * Number(item.quantity),
        })),
        totalUsd: Number(result.total_usd ?? cartTotalUsd),
        totalBs: Number(result.total_bs ?? cartTotalBs),
        rateSource: result.rate_source || source,
        rateValue: Number(result.rate_value ?? rateValue),
        notes: customer.notes,
      })

      setSentOrder({
        orderNumber: result.order_number,
        message,
        totalUsd: Number(result.total_usd ?? cartTotalUsd),
        totalBs: Number(result.total_bs ?? cartTotalBs),
        fulfillment: customer.fulfillment,
        address: customer.address.trim(),
        registered: true,
      })
      setCheckoutOpen(false)
      setCart([])
      setCartOpen(false)
    } catch (e) {
      console.error(e)
      const message = e.message || 'No se pudo registrar el pedido'
      alert(`${message}. Intenta de nuevo o escríbenos por WhatsApp.`)
    } finally {
      setSending(false)
    }
  }

  const closeSent = () => {
    setSentOrder(null)
    setCustomer(EMPTY_CUSTOMER)
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
          }}
        >
          <img src={LOGO_URL} alt="La Cartha" style={{ width: 180, borderRadius: 18 }} />
          <Loader2 size={26} className="spin" style={{ color: 'var(--orange)' }} />
          <p className="muted small">Cargando el menú...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.heroInner}>
            <img src={LOGO_URL} alt="La Cartha" className={styles.logo} />
            <div className={styles.heroCopy}>
              <h1 className={styles.heroTitle}>
                La Cartha
                <br />
                <span>Banderillas Coreanas</span>
              </h1>
              <p className={styles.heroText}>
                El menú no está disponible en este momento. Escríbenos por WhatsApp y te
                atendemos.
              </p>
              <div className={styles.heroActions}>
                <a
                  className={`${styles.heroAction} ${styles.heroActionPrimary}`}
                  href={`https://wa.me/${business?.whatsapp_phone || BUSINESS_WHATSAPP}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
                <a className={styles.heroAction} href={`tel:${business?.phone || BUSINESS_PHONE}`}>
                  <Phone size={14} /> {business?.phone || BUSINESS_PHONE}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (business?.public_menu_enabled === false) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.heroInner}>
            <img src={LOGO_URL} alt="La Cartha" className={styles.logo} />
            <div className={styles.heroCopy}>
              <div className={styles.kicker}>La Cartha</div>
              <h1 className={styles.heroTitle}>
                Menú
                <br />
                <span>temporalmente cerrado</span>
              </h1>
              <p className={styles.heroText}>
                Estamos actualizando el menú. Escríbenos por WhatsApp para hacer tu pedido.
              </p>
              <div className={styles.heroActions}>
                <a
                  className={`${styles.heroAction} ${styles.heroActionPrimary}`}
                  href={`https://wa.me/${business?.whatsapp_phone || BUSINESS_WHATSAPP}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const phone = business?.phone || BUSINESS_PHONE
  const instagram = business?.instagram_url || BUSINESS_INSTAGRAM
  const whatsapp = business?.whatsapp_phone || BUSINESS_WHATSAPP

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <img src={LOGO_URL} alt="La Cartha" className={styles.logo} />
          <div className={styles.heroCopy}>
            <div className={styles.kicker}>
              <Sparkles size={12} /> {BUSINESS_TAGLINE}
            </div>
            <h1 className={styles.heroTitle}>
              La Cartha
              <br />
              <span>antojo coreano.</span>
            </h1>
            <p className={styles.heroText}>
              Banderillas hechas al momento, con 1 topping y todas las salsas que quieras.
              Delivery y comer aquí en Maracaibo.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.heroAction} href="#menu">
                <ShoppingBag size={14} /> Ver menú
              </a>
              <a
                className={`${styles.heroAction} ${styles.heroActionPrimary}`}
                href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                  'Hola, quiero hacer un pedido en La Cartha.',
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={14} /> WhatsApp
              </a>
            </div>
            <div className={styles.heroMeta}>
              <span><Truck size={12} /> Delivery</span>
              <span><Store size={12} /> Comer aquí</span>
              <span><Phone size={12} /> {phone}</span>
              <span><AtSign size={12} /> {BUSINESS_INSTAGRAM_HANDLE}</span>
            </div>
          </div>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <p className={styles.stepTitle}>Elige tu banderilla</p>
            <p className={styles.stepText}>Escoge relleno, topping y todas las salsas.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <p className={styles.stepTitle}>Envía el pedido</p>
            <p className={styles.stepText}>Queda registrado en el tablero de La Cartha.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <p className={styles.stepTitle}>Paga y recibe</p>
            <p className={styles.stepText}>
              Comer aquí se paga en caja. Delivery se cotiza por WhatsApp.
            </p>
          </div>
        </div>
      </section>

      <div className={styles.categoryNav}>
        <div className={styles.categoryNavInner}>
          {categories.map((cat) => (
            <button
              key={cat.value}
              type="button"
              className={`${styles.categoryBtn} ${category === cat.value ? styles.categoryBtnActive : ''}`}
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <section className={styles.section} id="menu">
        <h2 className={styles.sectionTitle}>El menú</h2>
        <p className={styles.sectionSub}>
          Precios en dólares.{' '}
          {rateValue > 0
            ? `En Bs a la tasa ${rateLabel(source)}${
                rateDate ? ` del ${formatDate(rateDate)}` : ' del día'
              }.`
            : ''}{' '}
          Los toppings y salsas están incluidos.
        </p>

        {visibleProducts.length === 0 ? (
          <div className={`${styles.step}`}>
            <p className={styles.stepTitle}>No hay productos en esta categoría.</p>
            <p className={styles.stepText}>Prueba con otra categoría.</p>
          </div>
        ) : (
          <div className={styles.productGrid}>
            {visibleProducts.map((product) => {
              const Icon = productIcon(product.category)
              const isBanderilla = product.category === 'banderilla'
              const priceBs = bsPrice(product.price_usd)
              return (
                <article className={styles.productCard} key={product.id}>
                  <div className={styles.productImage}>
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} loading="lazy" />
                    ) : (
                      <Icon size={38} />
                    )}
                  </div>
                  <div className={styles.productBody}>
                    <p className={styles.productCategory}>
                      {CATEGORY_LABELS[product.category] || product.category}
                    </p>
                    <p className={styles.productName}>{product.name}</p>
                    <p className={styles.productDesc}>
                      {product.description ||
                        (isBanderilla
                          ? 'Incluye 1 topping y salsas ilimitadas.'
                          : '')}
                    </p>
                    <div className={styles.productPrices}>
                      <div>
                        <div className={styles.productPriceUsd}>{money(product.price_usd)}</div>
                        {priceBs ? (
                          <div className={styles.productPriceBs}>{formatBs(priceBs)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={styles.addBtn}
                        aria-label={`Agregar ${product.name}`}
                        onClick={() =>
                          isBanderilla
                            ? openConfig(product)
                            : addToCart(product, [], 1, '')
                        }
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <div>
          <strong>La Cartha</strong> by Valentina Castro
          <br />
          {BUSINESS_TAGLINE}
        </div>
        <div>
          <a href={instagram} target="_blank" rel="noreferrer">
            {BUSINESS_INSTAGRAM_HANDLE}
          </a>
          <br />
          <a href={`tel:${phone}`}>{phone}</a>
        </div>
      </footer>

      {cartCount > 0 ? (
        <div className={styles.cartBar}>
          <div className={styles.cartBarInfo}>
            <div className={styles.cartBarLabel}>{cartCount} artículo(s)</div>
            <div className={styles.cartBarTotal}>{money(cartTotalUsd)}</div>
            {cartTotalBs > 0 ? (
              <div className={styles.cartBarLabel}>{formatBs(cartTotalBs)}</div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCartOpen(true)}
          >
            <ShoppingBag size={15} /> Ver pedido
          </button>
        </div>
      ) : null}

      {cartOpen ? (
        <div className={styles.drawerOverlay} onClick={() => setCartOpen(false)}>
          <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <ShoppingBag size={20} style={{ color: 'var(--orange)' }} />
              <div className={styles.drawerTitle}>Tu pedido</div>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setCartOpen(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles.drawerBody}>
              {cart.length === 0 ? (
                <p className="muted small">Tu pedido está vacío.</p>
              ) : (
                cart.map((item) => (
                  <div className={styles.cartItem} key={item.key}>
                    <div className={styles.cartItemTop}>
                      <div>
                        <div className={styles.cartItemName}>{item.product.name}</div>
                        {item.selectedOptions.length ? (
                          <div className={styles.cartItemMeta}>
                            {item.selectedOptions.map((o) => o.name).join(' · ')}
                          </div>
                        ) : null}
                        {item.notes ? (
                          <div className={styles.cartItemMeta}>Nota: {item.notes}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => removeItem(item.key)}
                      >
                        <X size={14} />
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
                      <strong className="small">
                        {money(Number(item.unitPriceUsd) * Number(item.quantity))}
                      </strong>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className={styles.drawerFooter}>
              <div className={styles.cartTotalRow}>
                <span>Total USD</span>
                <strong>{money(cartTotalUsd)}</strong>
              </div>
              {cartTotalBs > 0 ? (
                <div className={styles.cartTotalRow}>
                  <span>Total Bs</span>
                  <strong>{formatBs(cartTotalBs)}</strong>
                </div>
              ) : null}
              <button
                type="button"
                className="btn btn-primary btn-block btn-lg mt-2"
                onClick={openCheckout}
                disabled={!cart.length}
              >
                <ShoppingBag size={16} /> Hacer pedido
              </button>
              <p className="tiny muted mt-2" style={{ textAlign: 'center' }}>
                Tu pedido llega al tablero de La Cartha. Los datos de pago se comparten por WhatsApp.
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      <Modal
        open={Boolean(configProduct)}
        onClose={() => setConfigProduct(null)}
        title={configProduct?.name || 'Tu banderilla'}
        icon={Sandwich}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfigProduct(null)}>
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
                <p className="money" style={{ fontSize: 22 }}>{money(configPrice)}</p>
                {bsPrice(configPrice) ? (
                  <p className="small muted">{formatBs(bsPrice(configPrice))}</p>
                ) : null}
              </div>
              <p className="small muted" style={{ maxWidth: 180, textAlign: 'right' }}>
                Incluye 1 topping y salsas ilimitadas.
              </p>
            </div>

            {toppingOptions.length ? (
              <div className="mb-3">
                <p className="label mb-1">Elige tu topping</p>
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
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {sauceOptions.length ? (
              <div className="mb-3">
                <p className="label mb-1">Salsas (todas las que quieras)</p>
                <div className="flex wrap gap-2">
                  {sauceOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`chip ${configForm.sauceIds.includes(option.id) ? 'active' : ''}`}
                      onClick={() =>
                        setConfigForm((prev) => ({
                          ...prev,
                          sauceIds: prev.sauceIds.includes(option.id)
                            ? prev.sauceIds.filter((id) => id !== option.id)
                            : [...prev.sauceIds, option.id],
                        }))
                      }
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.checkoutGrid}>
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
                    value={configForm.quantity}
                    onChange={(e) =>
                      setConfigForm((prev) => ({ ...prev, quantity: e.target.value }))
                    }
                    style={{ textAlign: 'center', maxWidth: 80 }}
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
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="Datos del pedido"
        icon={ShoppingBag}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCheckoutOpen(false)}>
              Volver
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={sendOrder}
              disabled={sending}
            >
              {sending ? <Loader2 size={15} className="spin" /> : <ShoppingBag size={15} />}
              Enviar pedido
            </button>
          </>
        }
      >
        <div className={styles.fulfillment}>
          {business?.delivery_enabled !== false ? (
            <button
              type="button"
              className={`${styles.fulfillmentBtn} ${customer.fulfillment === 'delivery' ? styles.fulfillmentActive : ''}`}
              onClick={() => setCustomer((prev) => ({ ...prev, fulfillment: 'delivery' }))}
            >
              <Truck size={14} /> Delivery
            </button>
          ) : null}
          {business?.pickup_enabled !== false ? (
            <button
              type="button"
              className={`${styles.fulfillmentBtn} ${customer.fulfillment === 'pickup' ? styles.fulfillmentActive : ''}`}
              onClick={() => setCustomer((prev) => ({ ...prev, fulfillment: 'pickup' }))}
            >
              <UtensilsCrossed size={14} /> Comer aquí
            </button>
          ) : null}
        </div>

        <div className={styles.checkoutGrid}>
          <div className="field">
            <label>Nombre</label>
            <input
              className="input"
              value={customer.name}
              onChange={(e) => setCustomer((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Tu nombre"
            />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input
              className="input"
              type="tel"
              value={customer.phone}
              onChange={(e) => setCustomer((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="0414-0000000"
            />
          </div>
        </div>

        {customer.fulfillment === 'delivery' ? (
          <div className="field mt-2">
            <label>Dirección</label>
            <input
              className="input"
              value={customer.address}
              onChange={(e) => setCustomer((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Calle, casa, punto de referencia"
            />
            <p className="tiny muted mt-1">
              El costo del delivery se cotiza por WhatsApp. El total mostrado es solo de los
              productos.
            </p>
          </div>
        ) : (
          <div className="alert alert-warn mt-2">
            <UtensilsCrossed size={13} style={{ verticalAlign: -2 }} /> Comer aquí en La
            Cartha. Paga en caja.
          </div>
        )}

        <div className="field mt-2">
          <label>Notas</label>
          <textarea
            className="textarea"
            value={customer.notes}
            onChange={(e) => setCustomer((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Indicaciones para el pedido..."
          />
        </div>

        <div className="divider" />
        <div className={styles.cartTotalRow}>
          <span>Total USD</span>
          <strong>{money(cartTotalUsd)}</strong>
        </div>
        {cartTotalBs > 0 ? (
          <div className={styles.cartTotalRow}>
            <span>Total Bs</span>
            <strong>{formatBs(cartTotalBs)}</strong>
          </div>
        ) : null}
        <p className="tiny muted mt-2">
          {customer.fulfillment === 'delivery'
            ? 'Al enviar, tu pedido llega al tablero. Te cotizamos el delivery y coordinamos por WhatsApp.'
            : 'Al enviar, tu pedido llega al tablero de La Cartha. Paga en caja.'}
        </p>
      </Modal>

      <Modal
        open={Boolean(sentOrder)}
        onClose={closeSent}
        title="Pedido registrado"
        icon={CheckCircle2}
        footer={
          <>
            {sentOrder?.fulfillment === 'delivery' ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  openWhatsApp(
                    sentOrder.message,
                    business?.whatsapp_phone || BUSINESS_WHATSAPP,
                  )
                }
              >
                <MessageCircle size={15} /> Abrir WhatsApp
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={closeSent}>
              Hacer otro pedido
            </button>
          </>
        }
      >
        {sentOrder ? (
          <div style={{ textAlign: 'center' }}>
            <div className={styles.confirmIcon}>
              <CheckCircle2 size={32} />
            </div>
            <p className="label">
              {sentOrder.fulfillment === 'delivery' ? 'Delivery' : 'Comer aquí'} · Pedido
            </p>
            <p className="money" style={{ fontSize: 18 }}>{sentOrder.orderNumber}</p>
            <p className="money" style={{ fontSize: 30, marginTop: 8 }}>
              {money(sentOrder.totalUsd)}
            </p>
            {sentOrder.totalBs > 0 ? (
              <p className="muted">{formatBs(sentOrder.totalBs)}</p>
            ) : null}
            <p className="small muted mt-3">
              {sentOrder.fulfillment === 'delivery'
                ? 'Tu pedido quedó registrado. Abre WhatsApp para enviar la dirección y coordinar el costo del delivery y el pago.'
                : 'Tu pedido quedó registrado. Paga en caja y muestra este número.'}
            </p>
            <p className="tiny muted mt-2">
              {sentOrder.fulfillment === 'delivery'
                ? 'El costo del delivery se cotiza por WhatsApp.'
                : 'No necesitas enviar WhatsApp para este pedido.'}
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
