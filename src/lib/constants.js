export const APP_NAME = 'La Cartha'
export const BUSINESS_NAME = 'La Cartha'
export const BUSINESS_TAGLINE = 'Banderillas Coreanas'
export const BUSINESS_PHONE = '0424-4315118'
export const BUSINESS_WHATSAPP = '584244315118'
export const BUSINESS_INSTAGRAM = 'https://www.instagram.com/lacartha.mcboo/'
export const BUSINESS_INSTAGRAM_HANDLE = '@lacartha.mcboo'

export const CATEGORIES = [
  { value: 'banderilla', label: 'Banderillas' },
  { value: 'bebida', label: 'Bebidas' },
  { value: 'postre', label: 'Postres' },
  { value: 'snack', label: 'Nuggets y papitas' },
  { value: 'otro', label: 'Otros' },
]

export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

export const RATE_SOURCES = [
  { value: 'bcv_usd', label: 'BCV USD', short: 'USD BCV' },
  { value: 'bcv_eur', label: 'BCV EUR', short: 'EUR BCV' },
  { value: 'usdt', label: 'USDT', short: 'USDT' },
  { value: 'manual', label: 'Manual', short: 'Manual' },
]

export const RATE_LABELS = Object.fromEntries(RATE_SOURCES.map((r) => [r.value, r.label]))

export const PAYMENT_CODES = {
  EFECTIVO_USD: 'efectivo_usd',
  EFECTIVO_BS: 'efectivo_bs',
  PAGO_MOVIL: 'pago_movil',
  PUNTO_VENTA: 'punto_venta',
  ZELLE: 'zelle',
  BINANCE: 'binance',
}

export const CURRENCY_LABELS = {
  USD: 'USD',
  BS: 'Bs',
  USDT: 'USDT',
}

export const EXPENSE_CATEGORIES = [
  'Alquiler',
  'Gas',
  'Luz',
  'Agua',
  'Internet',
  'Transporte',
  'Sueldos',
  'Empaque',
  'Limpieza',
  'Mantenimiento',
  'Impuestos',
  'Merma',
  'Otros',
]

export const UNIT_OPTIONS = [
  { value: 'g', label: 'gramos (g)' },
  { value: 'ml', label: 'mililitros (ml)' },
  { value: 'unit', label: 'unidades' },
]

export const BASE_UNIT_LABELS = {
  g: 'g',
  ml: 'ml',
  unit: 'unidad',
}

export const PRODUCT_TYPE_LABELS = {
  recipe: 'Receta',
  simple: 'Simple',
}

export const SLOT_LABELS = {
  masa: 'Masa',
  salchicha: 'Salchicha',
  queso: 'Queso',
  palillo: 'Palillo',
  empaque: 'Empaque',
  bebida: 'Bebida',
  topping: 'Topping',
  salsa: 'Salsa',
  otro: 'Otro',
}
