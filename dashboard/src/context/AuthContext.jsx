import { createContext, useContext, useState, useEffect } from 'react'

const AUTH_KEY = 'nfs_ai_tester_auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_KEY)
      setIsAuthenticated(stored === '1')
    } catch (_) {}
    setReady(true)
  }, [])

  const login = () => {
    try {
      localStorage.setItem(AUTH_KEY, '1')
    } catch (_) {}
    setIsAuthenticated(true)
  }

  const logout = () => {
    try {
      localStorage.removeItem(AUTH_KEY)
    } catch (_) {}
    setIsAuthenticated(false)
  }

  if (!ready) return null

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
