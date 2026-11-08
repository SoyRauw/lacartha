import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, Sparkles } from 'lucide-react'
import Logo from '../../components/Logo'
import { useAuth } from '../../hooks/useAuth'
import { BUSINESS_INSTAGRAM_HANDLE, BUSINESS_TAGLINE } from '../../lib/constants'
import styles from './AdminLogin.module.css'

export default function AdminLogin() {
  const { user, profile, loading, signIn, authError } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && user && profile) {
      navigate('/admin/hoy', { replace: true })
    }
  }, [loading, user, profile, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate('/admin/hoy', { replace: true })
    } catch (e) {
      setError(
        e.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : e.message || 'No se pudo iniciar sesión.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.brandPanel}>
        <Logo className={styles.logo} />
        <div className={styles.brandCopy}>
          <div className={styles.kicker}>
            <Sparkles size={14} /> Sistema de administración
          </div>
          <h1>
            La Cartha
            <br />
            <span>en orden.</span>
          </h1>
          <p>
            Ventas, recetas, inventario y ganancias reales en un solo lugar. Hecho para
            que Valentina sepa cuánto invierte y cuánto gana, sin complicarse.
          </p>
          <div className={styles.pills}>
            <span className={styles.pill}>Vender sin internet</span>
            <span className={styles.pill}>Costos por receta</span>
            <span className={styles.pill}>Caja y reportes</span>
          </div>
        </div>
        <p className={styles.footerNote}>
          {BUSINESS_TAGLINE} · {BUSINESS_INSTAGRAM_HANDLE}
        </p>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formCard}>
          <Logo className={styles.mobileLogo} />
          <h2>Bienvenida de vuelta</h2>
          <p>Entra con el correo y la contraseña de La Cartha.</p>

          {error || authError ? (
            <div className={`alert alert-error ${styles.error}`}>{error || authError}</div>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div className={`field ${styles.field}`}>
              <label htmlFor="email">Correo</label>
              <div className={styles.inputWrap}>
                <Mail size={17} />
                <input
                  id="email"
                  type="email"
                  className="input"
                  placeholder="lacartha@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className={`field ${styles.field}`}>
              <label htmlFor="password">Contraseña</label>
              <div className={styles.inputWrap}>
                <LockKeyhole size={17} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={`btn btn-primary btn-block ${styles.submit}`}
              disabled={submitting}
            >
              {submitting ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />}
              {submitting ? 'Entrando...' : 'Entrar al panel'}
            </button>
          </form>

          <div className={styles.footerLinks}>
            <Link to="/menu">Ver menú público</Link>
            <span>{BUSINESS_INSTAGRAM_HANDLE}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
