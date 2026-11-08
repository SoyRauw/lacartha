import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { LogOut, ShieldAlert } from 'lucide-react'
import { useAuth } from './hooks/useAuth'
import { Loading } from './components/ui'
import AdminLayout from './components/AdminLayout'
import AdminLogin from './pages/admin/AdminLogin'

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminPOS = lazy(() => import('./pages/admin/AdminPOS'))
const AdminSales = lazy(() => import('./pages/admin/AdminSales'))
const AdminProducts = lazy(() => import('./pages/admin/AdminProducts'))
const AdminBanderilla = lazy(() => import('./pages/admin/AdminBanderilla'))
const AdminIngredients = lazy(() => import('./pages/admin/AdminIngredients'))
const AdminPreparations = lazy(() => import('./pages/admin/AdminPreparations'))
const AdminPurchases = lazy(() => import('./pages/admin/AdminPurchases'))
const AdminInventory = lazy(() => import('./pages/admin/AdminInventory'))
const AdminExpenses = lazy(() => import('./pages/admin/AdminExpenses'))
const AdminCash = lazy(() => import('./pages/admin/AdminCash'))
const AdminReports = lazy(() => import('./pages/admin/AdminReports'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))
const AdminOnboarding = lazy(() => import('./pages/admin/AdminOnboarding'))
const PublicMenu = lazy(() => import('./pages/public/PublicMenu'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function ProfileError() {
  const { authError, signOut } = useAuth()
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--cream)',
      }}
    >
      <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
        <ShieldAlert size={40} style={{ color: 'var(--red)', marginBottom: 12 }} />
        <h2>No pudimos cargar tu perfil</h2>
        <p className="muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
          {authError ||
            'Verifica que las migraciones de Supabase estén ejecutadas y que tu usuario tenga un perfil con rol admin.'}
        </p>
        <button type="button" className="btn btn-primary mt-3" onClick={signOut}>
          <LogOut size={16} /> Volver al login
        </button>
      </div>
    </div>
  )
}

function ProtectedRoute() {
  const { user, profile, loading } = useAuth()
  if (loading) return <Loading label="Cargando panel..." />
  if (!user) return <Navigate to="/admin" replace />
  if (!profile) return <ProfileError />
  if (profile.role !== 'admin') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2>Sin permiso</h2>
          <p className="muted mt-1">Este usuario no tiene rol de administrador.</p>
        </div>
      </div>
    )
  }
  return <Outlet />
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<Loading label="Cargando..." />}>
        <Routes>
          <Route path="/" element={<Navigate to="/menu" replace />} />
          <Route path="/menu" element={<PublicMenu />} />
          <Route path="/admin" element={<AdminLogin />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin/hoy" element={<AdminDashboard />} />
              <Route path="/admin/vender" element={<AdminPOS />} />
              <Route path="/admin/ventas" element={<AdminSales />} />
              <Route path="/admin/menu" element={<AdminProducts />} />
              <Route path="/admin/banderilla" element={<AdminBanderilla />} />
              <Route path="/admin/materia-prima" element={<AdminIngredients />} />
              <Route path="/admin/preparaciones" element={<AdminPreparations />} />
              <Route path="/admin/compras" element={<AdminPurchases />} />
              <Route path="/admin/inventario" element={<AdminInventory />} />
              <Route path="/admin/gastos" element={<AdminExpenses />} />
              <Route path="/admin/caja" element={<AdminCash />} />
              <Route path="/admin/reportes" element={<AdminReports />} />
              <Route path="/admin/primeros-pasos" element={<AdminOnboarding />} />
              <Route path="/admin/ajustes" element={<AdminSettings />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/admin/hoy" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
