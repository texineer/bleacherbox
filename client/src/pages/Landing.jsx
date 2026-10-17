import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { getLastTeam } from '../lastTeam'

function AuthForm() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useAuth()

  // Signed-in users are redirected by Landing; pending sign-ups get a notice.
  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (mode === 'login') await login(email, password)
      else {
        const data = await register(email, password, displayName)
        if (data.pending) { setNotice(data.message); setPassword('') }
      }
    } catch (err) {
      if (err.pending) setNotice(err.message)
      else setError(err.message)
    }
    finally { setLoading(false) }
  }

  return (
    <div className="max-w-sm mx-auto w-full">
      <div className="flex rounded-xl overflow-hidden border-2 p-0.5 gap-0.5 mb-6"
        style={{ borderColor: 'var(--border)', background: 'var(--sky)' }}>
        {['login', 'register'].map(m => (
          <button key={m}
            className="flex-1 py-2.5 rounded-lg font-display text-lg tracking-wider transition-all"
            style={{ background: mode === m ? 'var(--navy)' : 'transparent', color: mode === m ? 'white' : 'var(--navy-muted)' }}
            onClick={() => { setMode(m); setError(''); setNotice('') }}>
            {m === 'login' ? 'SIGN IN' : 'REGISTER'}
          </button>
        ))}
      </div>
      {notice && (
        <div className="text-sm font-semibold text-center py-3 px-3 rounded-lg mb-6"
          style={{ color: 'var(--navy)', background: 'var(--sky)', border: '2px solid var(--border)' }}>
          {notice}
        </div>
      )}
      <GoogleSignInButton
        onStart={() => { setError(''); setNotice(''); setLoading(true) }}
        onDone={data => { setLoading(false); if (data.pending) setNotice(data.message) }}
        onError={err => { setLoading(false); if (err.pending) setNotice(err.message); else setError(err.message) }}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--navy-muted)' }}>Display Name</label>
            <input type="text" className="w-full h-12 px-4 rounded-xl border-2 text-sm font-medium focus:outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }}
              placeholder="Your name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--navy-muted)' }}>Email</label>
          <input type="email" required className="w-full h-12 px-4 rounded-xl border-2 text-sm font-medium focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }}
            placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--navy-muted)' }}>Password</label>
          <input type="password" required minLength={8} className="w-full h-12 px-4 rounded-xl border-2 text-sm font-medium focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }}
            placeholder={mode === 'register' ? 'Min 8 characters' : 'Your password'}
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {error && (
          <div className="text-sm font-semibold text-center py-2 px-3 rounded-lg"
            style={{ color: 'var(--loss)', background: 'var(--loss-bg, #fdecea)' }}>{error}</div>
        )}
        {mode === 'register' && (
          <p className="text-xs text-center" style={{ color: 'var(--navy-muted)' }}>
            By creating an account you agree to the{' '}
            <Link to="/terms" className="font-semibold" style={{ color: 'var(--navy)' }}>Terms of Service</Link> and{' '}
            <Link to="/privacy" className="font-semibold" style={{ color: 'var(--navy)' }}>Privacy Policy</Link>.
          </p>
        )}
        <button type="submit" disabled={loading}
          className="w-full h-14 rounded-xl font-display text-xl tracking-widest text-white active:scale-95 transition-transform"
          style={{ background: loading ? 'var(--navy-muted)' : 'var(--navy)' }}>
          {loading ? 'PLEASE WAIT...' : mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </button>
      </form>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const { user, roles, logout, loading: authLoading } = useAuth()

  // Auto-redirect: one team → team page, logged in → account page
  useEffect(() => {
    if (!authLoading && user) {
      const last = getLastTeam()
      const team = roles.find(r => r.slug === last) || roles[0]
      navigate(team ? `/${team.slug}` : '/teams', { replace: true })
    }
  }, [authLoading, user, roles])

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Header */}
      <header className="relative overflow-hidden py-10 px-6 text-center" style={{ background: 'var(--navy)' }}>
        <div className="safe-top-spacer" />
        <div className="relative z-10 max-w-lg mx-auto">
          <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-8 object-contain mx-auto mb-1" />
          <h1 className="font-display text-4xl text-white tracking-wider">BLEACHERBOX.APP</h1>
          <p className="text-sm mt-2 font-medium" style={{ color: 'var(--gold)' }}>
            Schedules, pitch counts & scouting for baseball parents
          </p>
        </div>
        {!authLoading && user && (
          <div className="relative z-10 mt-4 flex justify-center items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
                {(user.display_name || user.email).charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-semibold text-white">{user.display_name || user.email}</span>
            </div>
            <button onClick={logout}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded"
              style={{ color: 'var(--navy)', background: 'var(--gold)' }}>
              Sign Out
            </button>
          </div>
        )}
        <div className="stitch-line mt-6" />
      </header>

      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        {authLoading && <LoadingSpinner />}
        {!authLoading && !user && <AuthForm />}
        {!authLoading && user && <LoadingSpinner />}
      </main>

      <footer className="text-center py-4 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--navy-muted)' }}>
        BleacherBox
        <span className="mx-2">·</span>
        <Link to="/privacy" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Privacy</Link>
        <span className="mx-2">·</span>
        <Link to="/terms" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Terms</Link>
      </footer>
    </div>
  )
}
