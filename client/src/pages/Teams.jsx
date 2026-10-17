import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getTeams, joinTeam, leaveTeam } from '../api'
import { useAuth } from '../context/AuthContext'
import { getLastTeam } from '../lastTeam'
import LoadingSpinner from '../components/LoadingSpinner'

function AgeBadge({ ageGroup }) {
  if (!ageGroup) return null
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: 'var(--powder-pale)', color: 'var(--navy)' }}>{ageGroup}</span>
  )
}

// One team row: tap to open the team; optional action button on the right.
function TeamRow({ slug, name, logoUrl, ageGroup, badge, current, action }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <Link to={`/${slug}`} className="flex items-center gap-3 flex-1 min-w-0 no-underline">
        <img src={logoUrl || '/yardbirds-logo.png'} alt="" className="w-11 h-11 object-contain shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg leading-tight truncate" style={{ color: 'var(--navy)' }}>{name || slug}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <AgeBadge ageGroup={ageGroup} />
            {badge}
            {current && <span className="text-[10px] font-semibold" style={{ color: 'var(--gold-dark)' }}>Viewing</span>}
          </div>
        </div>
      </Link>
      {action}
    </div>
  )
}

export default function Teams() {
  const { user, roles, refreshRoles, loading: authLoading } = useAuth()
  const [allTeams, setAllTeams] = useState([])
  const [loadingTeams, setLoadingTeams] = useState(true)
  const [busy, setBusy] = useState(null)
  const lastTeam = getLastTeam()

  useEffect(() => {
    getTeams().then(setAllTeams).catch(() => setAllTeams([])).finally(() => setLoadingTeams(false))
  }, [])

  async function handleFollow(team) {
    setBusy(team.slug)
    await joinTeam(team.pg_org_id, team.pg_team_id).catch(() => {})
    await refreshRoles()
    setBusy(null)
  }

  async function handleLeave(role) {
    if (!confirm(`Remove ${role.team_name || role.slug} from your teams?`)) return
    setBusy(role.slug)
    await leaveTeam(role.pg_org_id, role.pg_team_id).catch(() => {})
    await refreshRoles()
    setBusy(null)
  }

  const myTeamKeys = new Set(roles.map(r => `${r.pg_org_id}-${r.pg_team_id}`))
  const otherTeams = allTeams.filter(t => !myTeamKeys.has(`${t.pg_org_id}-${t.pg_team_id}`))

  return (
    <div className="flex-1 flex flex-col">
      <header className="relative overflow-hidden px-6" style={{ background: 'var(--navy)' }}>
        <div className="safe-top-spacer" />
        <div className="flex items-center justify-between max-w-2xl mx-auto py-5">
          <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-5 object-contain" />
          <div className="font-display text-xl text-white tracking-wider">TEAMS</div>
        </div>
        <div className="stitch-line" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        {authLoading || loadingTeams ? <LoadingSpinner /> : (
          <>
            {user && (
              <div>
                <div className="section-label mb-3">MY TEAMS</div>
                <div className="card overflow-hidden">
                  {roles.length === 0 ? (
                    <div className="p-5 text-center text-sm" style={{ color: 'var(--navy-muted)' }}>
                      You're not following any teams yet. Pick one below.
                    </div>
                  ) : roles.map(role => (
                    <TeamRow key={role.slug} slug={role.slug} name={role.team_name} logoUrl={role.logo_url}
                      ageGroup={role.age_group} current={role.slug === lastTeam}
                      badge={role.role !== 'viewer' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--gold)', color: 'var(--navy)' }}>{role.role.toUpperCase()}</span>
                      )}
                      action={
                        <button onClick={() => handleLeave(role)} disabled={busy === role.slug}
                          aria-label={`Unfollow ${role.team_name || role.slug}`}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs flex-shrink-0 active:scale-95"
                          style={{ background: 'var(--loss-bg, #fdecea)', color: 'var(--loss)' }}>
                          ✕
                        </button>
                      } />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="section-label mb-3">{user ? 'FOLLOW A TEAM' : 'ALL TEAMS'}</div>
              <div className="card overflow-hidden">
                {otherTeams.length === 0 ? (
                  <div className="p-5 text-center text-sm" style={{ color: 'var(--navy-muted)' }}>
                    {allTeams.length === 0 ? 'No teams yet.' : "You're following every team."}
                  </div>
                ) : otherTeams.map(t => (
                  <TeamRow key={t.slug} slug={t.slug} name={t.name} logoUrl={t.logo_url} ageGroup={t.age_group}
                    current={t.slug === lastTeam}
                    action={user && (
                      <button onClick={() => handleFollow(t)} disabled={busy === t.slug}
                        className="text-[10px] font-bold px-2.5 py-1.5 rounded flex-shrink-0 active:scale-95"
                        style={{ background: 'var(--win-bg)', color: 'var(--win)' }}>
                        {busy === t.slug ? '…' : '+ Follow'}
                      </button>
                    )} />
                ))}
                <p className="px-4 py-3 text-xs border-t" style={{ color: 'var(--navy-muted)', borderColor: 'var(--border)' }}>
                  {user ? (
                    <>Don't see your team? Email{' '}
                      <a href="mailto:ray@texineer.com" className="font-semibold" style={{ color: 'var(--navy)' }}>ray@texineer.com</a>
                      {' '}with its Perfect Game or Five Tool team link and we'll add it.</>
                  ) : (
                    <><Link to="/login" className="font-semibold" style={{ color: 'var(--navy)' }}>Sign in</Link> to follow teams and keep them in My Teams.</>
                  )}
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
