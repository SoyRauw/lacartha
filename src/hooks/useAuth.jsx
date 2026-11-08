import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
const USER_KEY = 'lc_user'
const PROFILE_KEY = 'lc_profile'

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setProfile(null)
      return null
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, name, role, active')
        .eq('id', authUser.id)
        .maybeSingle()
      if (error) throw error
      if (data) {
        setProfile(data)
        localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
        setAuthError('')
        return data
      }
      const message =
        'No se encontró tu perfil. Verifica que las migraciones de Supabase estén ejecutadas.'
      setAuthError(message)
      return null
    } catch (e) {
      console.error('Error cargando perfil', e)
      const cached = readCache(PROFILE_KEY)
      if (cached) {
        setProfile(cached)
      } else {
        setAuthError(e.message || 'No se pudo cargar el perfil')
      }
      return cached
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const session = data?.session
        if (session?.user) {
          setUser(session.user)
          localStorage.setItem(
            USER_KEY,
            JSON.stringify({ id: session.user.id, email: session.user.email }),
          )
          await loadProfile(session.user)
        } else if (!navigator.onLine) {
          const cachedUser = readCache(USER_KEY)
          const cachedProfile = readCache(PROFILE_KEY)
          if (cachedUser && cachedProfile) {
            setUser(cachedUser)
            setProfile(cachedProfile)
          }
        }
      } catch (e) {
        console.error('Error iniciando sesión', e)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user)
        localStorage.setItem(
          USER_KEY,
          JSON.stringify({ id: session.user.id, email: session.user.email }),
        )
        await loadProfile(session.user)
      } else {
        setUser(null)
        setProfile(null)
        localStorage.removeItem(USER_KEY)
        localStorage.removeItem(PROFILE_KEY)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = async (email, password) => {
    setAuthError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data.user) {
      setUser(data.user)
      localStorage.setItem(
        USER_KEY,
        JSON.stringify({ id: data.user.id, email: data.user.email }),
      )
      await loadProfile(data.user)
    }
    return data
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(PROFILE_KEY)
  }

  const value = {
    user,
    profile,
    loading,
    authError,
    signIn,
    signOut,
    isAdmin: profile?.role === 'admin',
    isSeller: profile?.role === 'seller',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
