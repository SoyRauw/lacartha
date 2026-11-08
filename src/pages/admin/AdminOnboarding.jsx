import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  Calculator,
  CheckCircle2,
  Circle,
  Globe,
  ListChecks,
  Sandwich,
  Sparkles,
  UtensilsCrossed,
  Wallet,
  Wheat,
} from 'lucide-react'
import { PageHeader, StatCard, useToast } from '../../components/ui'
import { useCatalog } from '../../hooks/useCatalog'
import { supabase } from '../../lib/supabase'
import { getOpenLocalSession } from '../../lib/localCash'

export default function AdminOnboarding() {
  const { push } = useToast()
  const catalog = useCatalog()
  const [cashReady, setCashReady] = useState(false)
  const [capitalReady, setCapitalReady] = useState(false)
  const [loadingExtra, setLoadingExtra] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const session = await getOpenLocalSession()
        let capitalCount = 0
        if (navigator.onLine) {
          const { count } = await supabase
            .from('capital_movements')
            .select('id', { count: 'exact', head: true })
          capitalCount = count || 0
        }
        if (!cancelled) {
          setCashReady(Boolean(session))
          setCapitalReady(capitalCount > 0)
        }
      } catch (e) {
        console.warn('Primeros pasos', e)
      } finally {
        if (!cancelled) setLoadingExtra(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const ingredients = catalog.ingredients || []
  const products = (catalog.products || []).filter((p) => p.active !== false)
  const banderillas = products.filter((p) => p.category === 'banderilla')
  const options = catalog.options || []
  const recipeItems = catalog.recipe_items || []
  const optionRecipeItems = catalog.option_recipe_items || []

  const withCost = ingredients.filter((i) => Number(i.avg_cost_usd) > 0)
  const withStock = ingredients.filter((i) => Number(i.stock_base) > 0)
  const withPrice = products.filter((p) => Number(p.price_usd) > 0)
  const banderillasWithRecipe = banderillas.filter((p) =>
    recipeItems.some((item) => item.product_id === p.id),
  )
  const optionsWithRecipe = options.filter((o) =>
    optionRecipeItems.some((item) => item.option_id === o.id),
  )
  const rateReady = Boolean(catalog.rate?.bcv_usd || catalog.rate?.bcv_eur)
  const publicReady = catalog.business?.public_menu_enabled !== false

  const steps = [
    {
      id: 'ingredients',
      title: 'Precios de materia prima',
      description:
        'Carga el precio de compra de harina, queso, salchicha, salsas y toppings.',
      done: ingredients.length > 0 && withCost.length === ingredients.length,
      detail: `${withCost.length} / ${ingredients.length} ingredientes con costo`,
      to: '/admin/materia-prima',
      icon: Wheat,
      cta: 'Cargar precios',
    },
    {
      id: 'stock',
      title: 'Inventario inicial',
      description:
        'Registra una compra inicial o ajusta el stock actual para que el inventario arranque con datos reales.',
      done: withStock.length > 0,
      detail: `${withStock.length} ingrediente(s) con stock`,
      to: '/admin/compras',
      icon: Boxes,
      cta: 'Registrar compra',
    },
    {
      id: 'banderilla',
      title: 'Porciones de la banderilla',
      description:
        'Define cuánta masa, queso, salchicha, topping y salsa lleva cada banderilla.',
      done: banderillas.length > 0 && banderillasWithRecipe.length === banderillas.length,
      detail: `${banderillasWithRecipe.length} / ${banderillas.length} banderillas con receta`,
      to: '/admin/banderilla',
      icon: Sandwich,
      cta: 'Abrir constructor',
    },
    {
      id: 'prices',
      title: 'Precios de venta',
      description:
        'Revisa que todas las banderillas, bebidas, postres y snacks tengan precio.',
      done: products.length > 0 && withPrice.length === products.length,
      detail: `${withPrice.length} / ${products.length} productos con precio`,
      to: '/admin/menu',
      icon: UtensilsCrossed,
      cta: 'Revisar menú',
    },
    {
      id: 'options',
      title: 'Toppings y salsas',
      description:
        'Cada topping y salsa debe tener su ingrediente y porción para calcular costo y stock.',
      done: options.length > 0 && optionsWithRecipe.length === options.length,
      detail: `${optionsWithRecipe.length} / ${options.length} opciones con receta`,
      to: '/admin/banderilla',
      icon: Sparkles,
      cta: 'Revisar opciones',
    },
    {
      id: 'cash',
      title: 'Caja y saldos iniciales',
      description:
        'Abre la caja y registra el efectivo inicial. Si ya operas, carga tu capital y saldos.',
      done: cashReady || capitalReady,
      detail: cashReady ? 'Caja abierta' : capitalReady ? 'Capital registrado' : 'Pendiente',
      to: '/admin/caja',
      icon: Wallet,
      cta: 'Abrir caja',
    },
    {
      id: 'rates',
      title: 'Tasas del día',
      description:
        'Carga BCV USD y BCV EUR para convertir precios y cobrar en bolívares.',
      done: rateReady,
      detail: rateReady ? 'Tasas cargadas' : 'Sin tasas',
      to: '/admin/ajustes',
      icon: Calculator,
      cta: 'Cargar tasas',
    },
    {
      id: 'public',
      title: 'Menú público',
      description:
        'Activa el menú con QR y compártelo en Instagram o WhatsApp.',
      done: publicReady && products.length > 0,
      detail: publicReady ? 'Menú activo' : 'Menú oculto',
      to: '/admin/ajustes',
      icon: Globe,
      cta: 'Configurar menú',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const progress = Math.round((doneCount / steps.length) * 100)
  const nextStep = steps.find((s) => !s.done)

  const dataReady = steps.slice(0, 5).every((s) => s.done)

  return (
    <>
      <PageHeader
        title="Primeros pasos"
        subtitle="Deja el menú, los costos y la caja listos para operar."
        icon={ListChecks}
        actions={
          <Link to="/admin/vender" className="btn btn-primary">
            Ir a vender <ArrowRight size={15} />
          </Link>
        }
      />

      <div className="stat-grid mb-3">
        <StatCard icon={ListChecks} label="Progreso" value={`${progress}%`} hint={`${doneCount} de ${steps.length} pasos`} />
        <StatCard icon={Wheat} label="Ingredientes con costo" value={`${withCost.length}/${ingredients.length}`} hint="Materia prima" />
        <StatCard icon={Sandwich} label="Banderillas con receta" value={`${banderillasWithRecipe.length}/${banderillas.length}`} hint="Recetas configuradas" />
        <StatCard icon={UtensilsCrossed} label="Productos con precio" value={`${withPrice.length}/${products.length}`} hint="Menú de venta" />
      </div>

      <div className="card mb-3">
        <div className="flex justify-between gap-2 wrap mb-2">
          <p className="card-title" style={{ margin: 0 }}>
            <Sparkles size={16} /> Tu configuración
          </p>
          <span className="badge badge-orange">{progress}%</span>
        </div>
        <div
          style={{
            height: 10,
            borderRadius: 999,
            background: 'var(--cream-2)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--orange), var(--yellow))',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        {nextStep ? (
          <div className="flex items-center justify-between gap-2 wrap mt-3">
            <p className="small muted">
              Siguiente paso: <strong>{nextStep.title}</strong>
            </p>
            <Link to={nextStep.to} className="btn btn-sm btn-primary">
              {nextStep.cta} <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <div className="alert alert-success mt-3">
            ¡Todo listo! La Cartha puede empezar a vender, cobrar y medir ganancias.
          </div>
        )}
      </div>

      <div className="grid-2">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <div className="card" key={step.id} style={{ opacity: step.done ? 0.92 : 1 }}>
              <div className="flex items-start gap-3">
                <div
                  className={step.done ? 'slotIcon' : 'slotIcon'}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: step.done ? 'var(--green-soft)' : 'var(--cream-2)',
                    color: step.done ? 'var(--green)' : 'var(--orange)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 auto',
                  }}
                >
                  <Icon size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2">
                    {step.done ? (
                      <CheckCircle2 size={15} style={{ color: 'var(--green)' }} />
                    ) : (
                      <Circle size={15} style={{ color: 'var(--muted-2)' }} />
                    )}
                    <p className="row-title">{step.title}</p>
                  </div>
                  <p className="small muted mt-1" style={{ lineHeight: 1.45 }}>
                    {step.description}
                  </p>
                  <p className="tiny muted mt-1">{step.detail}</p>
                  <Link to={step.to} className="btn btn-sm mt-2">
                    {step.cta} <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {dataReady ? (
        <div className="card mt-3">
          <div className="flex items-center justify-between gap-2 wrap">
            <div>
              <p className="row-title">La base está lista</p>
              <p className="small muted">
                Ya puedes vender, cobrar y ver la ganancia del día.
              </p>
            </div>
            <Link to="/admin/vender" className="btn btn-primary">
              Vender ahora <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      ) : null}
    </>
  )
}
