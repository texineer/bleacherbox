import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { changePassword } from '../api'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'

export default function Account() {
  const navigate = useNavigate()
  const { user, logout, refreshUser, isGlobalAdmin, loading: authLoading } = useAuth()

  // Password change
  const [showPwChange, setShowPwChange] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) navigate('/login', { replace: true })
  }, [authLoading, user])

  if (authLoading || !user) return <LoadingSpinner />

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPwError('')
    setPwSuccess(false)
    setPwLoading(true)
    try {
      await changePassword(currentPw, newPw)
      if (!user.has_password) await refreshUser()
      setPwSuccess(true)
      setCurrentPw('')
      setNewPw('')
      setTimeout(() => setShowPwChange(false), 2000)
    } catch (err) {
      setPwError(err.message)
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="relative overflow-hidden px-6" style={{ background: 'var(--navy)' }}>
        <div className="safe-top-spacer" />
        <div className="flex items-center justify-between max-w-2xl mx-auto py-5">
          <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-5 object-contain" />
          <div className="flex items-center gap-2">
            {isGlobalAdmin && (
              <Link to="/admin" className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded no-underline"
                style={{ color: 'white', border: '1px solid var(--gold)' }}>
                Admin
              </Link>
            )}
            <button onClick={logout}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded"
              style={{ color: 'var(--navy)', background: 'var(--gold)' }}>
              Sign Out
            </button>
          </div>
        </div>
        <div className="stitch-line" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        {/* Profile */}
        <div className="card p-5">
          <div className="flex items-center gap-4">
            <span className="w-14 h-14 rounded-full flex items-center justify-center font-display text-2xl"
              style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
              {(user.display_name || user.email).charAt(0).toUpperCase()}
            </span>
            <div>
              <div className="font-display text-2xl" style={{ color: 'var(--navy)' }}>
                {user.display_name || 'Account'}
              </div>
              <div className="text-sm" style={{ color: 'var(--navy-muted)' }}>{user.email}</div>
            </div>
          </div>

          {/* Change password toggle */}
          <button onClick={() => { setShowPwChange(v => !v); setPwError(''); setPwSuccess(false) }}
            className="mt-4 text-xs font-bold uppercase tracking-wider"
            style={{ color: 'var(--navy-muted)' }}>
            {showPwChange ? 'Cancel' : user.has_password ? 'Change Password' : 'Set Password'}
          </button>

          {showPwChange && (
            <form onSubmit={handlePasswordChange} className="mt-3 space-y-3">
              {user.has_password ? (
                <input type="password" required placeholder="Current password" value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
              ) : (
                <div className="text-xs" style={{ color: 'var(--navy-muted)' }}>
                  You sign in with Google. Set a password to also sign in with your email.
                </div>
              )}
              <input type="password" required minLength={8} placeholder="New password (min 8 chars)" value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
              {pwError && <div className="text-xs font-semibold" style={{ color: 'var(--loss)' }}>{pwError}</div>}
              {pwSuccess && <div className="text-xs font-semibold" style={{ color: 'var(--win)' }}>Password saved!</div>}
              <button type="submit" disabled={pwLoading}
                className="h-10 px-4 rounded-lg font-display text-sm tracking-wider text-white active:scale-95"
                style={{ background: pwLoading ? 'var(--navy-muted)' : 'var(--navy)' }}>
                {pwLoading ? 'SAVING...' : 'UPDATE PASSWORD'}
              </button>
            </form>
          )}
        </div>

        <p className="text-sm text-center" style={{ color: 'var(--navy-muted)' }}>
          Your teams are on the <Link to="/teams" className="font-semibold" style={{ color: 'var(--navy)' }}>Teams</Link> tab.
        </p>

        <div className="text-center text-[10px] font-semibold uppercase tracking-wider space-x-3" style={{ color: 'var(--navy-muted)' }}>
          <Link to="/features" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Features</Link>
          <Link to="/privacy" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Privacy</Link>
          <Link to="/terms" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Terms</Link>
        </div>
      </main>
    </div>
  )
}
