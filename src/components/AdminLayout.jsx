import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  ChevronRight,
  ClipboardList,
  Cloud,
  CloudOff,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Receipt,
  ReceiptText,
  RefreshCw,
  Sandwich,
  Settings,
  ShoppingCart,
  Truck,
  UtensilsCrossed,
  Wallet,
  Wheat,
  X,
} from 'lucide-react'
import Logo from './Logo'
import { useAuth } from '../hooks/useAuth'
import { useCatalog } from '../hooks/useCatalog'
import { useOnline, usePendingCount } from '../hooks/useOnline'
import { useNewOrdersCount } from '../hooks/usePublicOrders'
import { useToast } from './ui'
import { syncAll } from '../lib/sync'
import { ensureDailyRates } from '../lib/rates'

const NAV = [
  {
    section: 'Principal',
    items: [
      { to: '/admin/hoy', label: 'Hoy', icon: LayoutDashboard },
      { to: '/admin/comandas', label: 'Comandas', icon: ClipboardList },
      { to: '/admin/vender', label: 'Vender', icon: ShoppingCart },
      { to: '/admin/ventas', label: 'Ventas', icon: ReceiptText },
    ],
  },
  {
    section: 'Menú y recetas',
    items: [
      { to: '/admin/menu', label: 'Productos', icon: UtensilsCrossed },
      { to: '/admin/banderilla', label: 'La banderilla', icon: Sandwich },
      { to: '/admin/materia-prima', label: 'Materia prima', icon: Wheat },
      { to: '/admin/preparaciones', label: 'Preparaciones', icon: FlaskConical },
    ],
  },
  {
    section: 'Inventario y gastos',
    items: [
      { to: '/admin/compras', label: 'Compras', icon: Truck },
      { to: '/admin/inventario', label: 'Inventario', icon: Boxes },
      { to: '/admin/gastos', label: 'Gastos', icon: Receipt },
    ],
  },
  {
    section: 'Análisis',
    items: [
      { to: '/admin/caja', label: 'Caja', icon: Wallet },
      { to: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
    ],
  },
  {
    section: 'Sistema',
    items: [
      { to: '/admin/primeros-pasos', label: 'Primeros pasos', icon: ListChecks },
      { to: '/admin/ajustes', label: 'Ajustes', icon: Settings },
    ],
  },
]

const TITLES = {
  '/admin/hoy': 'Hoy',
  '/admin/comandas': 'Comandas',
  '/admin/vender': 'Vender',
  '/admin/ventas': 'Ventas',
  '/admin/menu': 'Productos',
  '/admin/banderilla': 'La banderilla',
  '/admin/materia-prima': 'Materia prima',
  '/admin/preparaciones': 'Preparaciones',
  '/admin/compras': 'Compras',
  '/admin/inventario': 'Inventario',
  '/admin/gastos': 'Gastos',
  '/admin/caja': 'Caja',
  '/admin/reportes': 'Reportes',
  '/admin/primeros-pasos': 'Primeros pasos',
  '/admin/ajustes': 'Ajustes',
}

export default function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const { profile, signOut } = useAuth()
  const { lastSync } = useCatalog()
  const online = useOnline()
  const pending = usePendingCount()
  const newOrders = useNewOrdersCount()
  const { push } = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!online) return undefined
    let cancelled = false
    setSyncing(true)
    ensureDailyRates()
      .catch((e) => {
        if (!cancelled) console.warn('No se pudo actualizar la tasa del día', e)
      })
      .then(() => syncAll())
      .then((result) => {
        if (!cancelled && result.error) {
          console.warn('Sync con advertencias', result.error)
        }
      })
      .catch((e) => console.warn('Sync inicial', e))
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSync = async () => {
    if (!online || syncing) return
    setSyncing(true)
    try {
      const result = await syncAll()
      if (result.error) {
        push(`Sync con advertencias: ${result.error}`, 'error')
      } else {
        push(
          `Sincronizado: ${result.salesSynced || 0} venta(s), ${result.cashSynced || 0} caja(s)`,
          'success',
        )
      }
    } catch (e) {
      push(e.message || 'No se pudo sincronizar', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/admin')
  }

  const title = TITLES[location.pathname] || 'La Cartha'
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
    : 'sin sincronizar'

  return (
    <div className="app-shell">
      {menuOpen ? <div className="nav-overlay" onClick={() => setMenuOpen(false)} /> : null}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Logo className="sidebar-logo-img" />
        </div>

        <nav className="sidebar-nav">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="nav-section">{group.section}</p>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                    {item.to === '/admin/ventas' && pending.sales > 0 ? (
                      <span className="nav-badge">{pending.sales}</span>
                    ) : null}
                    {item.to === '/admin/comandas' && newOrders.count > 0 ? (
                      <span className="nav-badge">{newOrders.count}</span>
                    ) : null}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            {profile?.name || profile?.email || 'La Cartha'}
            <br />
            <span style={{ opacity: 0.65 }}>{online ? 'En línea' : 'Sin conexión'}</span>
          </div>
          <button type="button" className="nav-item" onClick={handleLogout}>
            <LogOut size={17} /> Salir
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-icon mobile-only"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Abrir menú"
          >
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>

          <div>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">
              {online ? `Última sync: ${lastSyncLabel}` : 'Trabajando con datos locales'}
            </div>
          </div>

          <div className="topbar-spacer" />

          {pending.total > 0 ? (
            <span className="badge badge-yellow" title="Operaciones pendientes de sincronizar">
              <CloudOff size={12} /> {pending.total} pendiente(s)
            </span>
          ) : null}

          <span className={`badge ${online ? 'badge-green' : 'badge-red'}`}>
            {online ? <Cloud size={12} /> : <CloudOff size={12} />}
            {online ? 'En línea' : 'Offline'}
          </span>

          <button
            type="button"
            className="btn btn-sm"
            onClick={handleSync}
            disabled={!online || syncing}
            title="Sincronizar ahora"
          >
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            <span className="desktop-only">Sincronizar</span>
          </button>

          <button
            type="button"
            className="btn btn-sm btn-ghost desktop-only"
            onClick={() => navigate('/admin/vender')}
          >
            <ShoppingCart size={14} /> Vender <ChevronRight size={14} />
          </button>
        </header>

        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
