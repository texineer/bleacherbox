import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getTeams, joinTeam, leaveTeam, changePassword } from '../api'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'
import AddTeamByTournament from '../components/AddTeamByTournament'

export default function Account() {
  const navigate = useNavigate()
  const { user, roles, logout, refreshRoles, loading: authLoading } = useAuth()
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [addTeamMode, setAddTeamMode] = useState('join') // 'join' | 'new'
  const [allTeams, setAllTeams] = useState([])
  const [loadingTeams, setLoadingTeams] = useState(false)

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

  useEffect(() => {
    if (showAddTeam && allTeams.length === 0) {
      setLoadingTeams(true)
      getTeams().then(setAllTeams).catch(() => setAllTeams([])).finally(() => setLoadingTeams(false))
    }
  }, [showAddTeam])

  if (authLoading || !user) return <LoadingSpinner />

  const myTeamKeys = new Set(roles.map(r => `${r.pg_org_id}-${r.pg_team_id}`))
  const availableTeams = allTeams.filter(t => !myTeamKeys.has(`${t.pg_org_id}-${t.pg_team_id}`))

  async function handleJoin(team) {
    await joinTeam(team.pg_org_id, team.pg_team_id).catch(() => {})
    await refreshRoles()
  }

  async function handleTeamAdded(slug) {
    await refreshRoles()
    setShowAddTeam(false)
    setAddTeamMode('join')
    navigate(`/${slug}`)
  }

  async function handleLeave(role) {
    if (!confirm(`Remove ${role.team_name || role.slug} from your teams?`)) return
    await leaveTeam(role.pg_org_id, role.pg_team_id).catch(() => {})
    await refreshRoles()
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPwError('')
    setPwSuccess(false)
    setPwLoading(true)
    try {
      await changePassword(currentPw, newPw)
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
    <div className="min-h-dvh flex flex-col">
      {/* Header */}
      <header className="relative overflow-hidden py-6 px-6" style={{ background: 'var(--navy)' }}>
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-5 object-contain" />
          </Link>
          <button onClick={logout}
            className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded"
            style={{ color: 'var(--navy)', background: 'var(--gold)' }}>
            Sign Out
          </button>
        </div>
        <div className="stitch-line mt-4" />
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
            {showPwChange ? 'Cancel' : 'Change Password'}
          </button>

          {showPwChange && (
            <form onSubmit={handlePasswordChange} className="mt-3 space-y-3">
              <input type="password" required placeholder="Current password" value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
              <input type="password" required minLength={8} placeholder="New password (min 8 chars)" value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
              {pwError && <div className="text-xs font-semibold" style={{ color: 'var(--loss)' }}>{pwError}</div>}
              {pwSuccess && <div className="text-xs font-semibold" style={{ color: 'var(--win)' }}>Password changed!</div>}
              <button type="submit" disabled={pwLoading}
                className="h-10 px-4 rounded-lg font-display text-sm tracking-wider text-white active:scale-95"
                style={{ background: pwLoading ? 'var(--navy-muted)' : 'var(--navy)' }}>
                {pwLoading ? 'SAVING...' : 'UPDATE PASSWORD'}
              </button>
            </form>
          )}
        </div>

        {/* My Teams */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="section-label">My Teams</div>
            <button onClick={() => setShowAddTeam(v => !v)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg active:scale-95"
              style={{ background: showAddTeam ? 'var(--navy)' : 'var(--gold)', color: showAddTeam ? 'white' : 'var(--navy)' }}>
              {showAddTeam ? (
                <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg> Close</>
              ) : (
                <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Team</>
              )}
            </button>
          </div>

          {roles.length > 0 ? (
            <div className="space-y-2">
              {roles.map((role, i) => (
                <div key={`${role.pg_org_id}-${role.pg_team_id}`} className="card overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <Link to={`/${role.slug}`} className="flex items-center gap-3 flex-1 min-w-0 no-underline">
                      <img src={role.logo_url || '/yardbirds-logo.png'} alt="" className="w-11 h-11 object-contain shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-lg leading-tight truncate" style={{ color: 'var(--navy)' }}>
                          {role.team_name || role.slug}
                        </div>
                        <div className="flex gap-1.5 mt-0.5">
                          {role.age_group && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: 'var(--powder-pale)', color: 'var(--navy)' }}>{role.age_group}</span>
                          )}
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'var(--gold)', color: 'var(--navy)' }}>{role.role.toUpperCase()}</span>
                        </div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
                    </Link>
                    <button onClick={() => handleLeave(role)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0 active:scale-95"
                      style={{ background: 'var(--loss-bg, #fdecea)', color: 'var(--loss)' }}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-6 text-center">
              <div className="font-display text-xl mb-1" style={{ color: 'var(--navy-muted)' }}>NO TEAMS</div>
              <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>Tap "Add Team" to follow a team</p>
            </div>
          )}
        </div>

        {/* Add Team panel */}
        {showAddTeam && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3" style={{ background: 'var(--navy)' }}>
              <div className="font-display text-base text-white tracking-wider">ADD A TEAM</div>
            </div>

            <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
              {[['join', 'Join Existing'], ['new', 'New by Tournament']].map(([mode, label]) => (
                <button key={mode} onClick={() => setAddTeamMode(mode)}
                  className="flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider"
                  style={{
                    color: addTeamMode === mode ? 'var(--navy)' : 'var(--navy-muted)',
                    borderBottom: addTeamMode === mode ? '2px solid var(--gold)' : '2px solid transparent',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {addTeamMode === 'join' ? (
              loadingTeams ? <div className="p-4"><LoadingSpinner /></div> : availableTeams.length === 0 ? (
                <div className="p-4 text-sm text-center" style={{ color: 'var(--navy-muted)' }}>
                  {allTeams.length === 0 ? 'No teams available' : 'You\'re following all available teams'}
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {availableTeams.map(t => (
                    <button key={`${t.pg_org_id}-${t.pg_team_id}`}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-[var(--sky)]"
                      onClick={() => handleJoin(t)}>
                      <img src={t.logo_url || '/yardbirds-logo.png'} alt="" className="w-10 h-10 object-contain shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--navy)' }}>{t.name}</div>
                        <div className="flex gap-1.5 mt-0.5">
                          {t.age_group && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--powder-pale)', color: 'var(--navy)' }}>{t.age_group}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded flex-shrink-0" style={{ background: 'var(--win-bg)', color: 'var(--win)' }}>+ Add</span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <AddTeamByTournament onAdded={handleTeamAdded} />
            )}
          </div>
        )}
      </main>

      <footer className="text-center py-4 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--navy-muted)' }}>
        BleacherBox
      </footer>
    </div>
  )
}
