import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authMe, authLogin as apiLogin, authRegister as apiRegister, authGoogle as apiGoogle, authLogout as apiLogout } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)

  const isGlobalAdmin = !!user?.is_global_admin

  useEffect(() => {
    authMe()
      .then(data => {
        setUser(data.user)
        setRoles(data.roles || [])
      })
      .catch(() => {
        setUser(null)
        setRoles([])
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password)
    setUser(data.user)
    setRoles(data.roles || [])
    return data
  }, [])

  const register = useCallback(async (email, password, displayName) => {
    const data = await apiRegister(email, password, displayName)
    if (data.pending) return data
    setUser(data.user)
    setRoles(data.roles || [])
    return data
  }, [])

  const loginWithGoogle = useCallback(async (credential) => {
    const data = await apiGoogle(credential)
    if (data.pending) return data
    setUser(data.user)
    setRoles(data.roles || [])
    return data
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
    setRoles([])
  }, [])

  const refreshRoles = useCallback(async () => {
    const data = await authMe()
    setRoles(data.roles || [])
  }, [])

  const refreshUser = useCallback(async () => {
    const data = await authMe()
    setUser(data.user)
    setRoles(data.roles || [])
  }, [])

  const hasTeamRole = useCallback((orgId, teamId, allowedRoles) => {
    // Global admins have all roles on all teams
    if (isGlobalAdmin) return true
    const r = roles.find(r => r.pg_org_id === orgId && r.pg_team_id === teamId)
    if (!r) return false
    return allowedRoles.includes(r.role)
  }, [roles, isGlobalAdmin])

  return (
    <AuthContext.Provider value={{ user, roles, loading, login, register, loginWithGoogle, logout, refreshRoles, refreshUser, hasTeamRole, isGlobalAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
