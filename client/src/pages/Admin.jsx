import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getTeams, triggerScrape, adminLookupTeam, adminAddTeam, adminDeleteTeam } from '../api'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'
import PendingAccounts from '../components/PendingAccounts'
import AddTeamByTournament from '../components/AddTeamByTournament'

// FT-only teams get synthetic PG IDs at or above this value (see server fivetool.js).
const SYNTHETIC_PG_ID_MIN = 900000000

const inputClass = 'w-full h-10 px-3 rounded-lg border text-sm focus:outline-none'
const inputStyle = { borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function Label({ children }) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--navy-muted)' }}>
      {children}
    </label>
  )
}

function SourceBadge({ children }) {
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--sky)', color: 'var(--navy)' }}>
      {children}
    </span>
  )
}

// Add a team from its Perfect Game and/or Five Tool team page URLs:
// look the team up first, confirm the name and URL, then add it.
function AddTeamByUrl({ onAdded }) {
  const [pgUrl, setPgUrl] = useState('')
  const [ftUrl, setFtUrl] = useState('')
  const [lookup, setLookup] = useState(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleLookup(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const data = await adminLookupTeam(pgUrl.trim(), ftUrl.trim())
      const teamName = data.pg?.name || data.ft?.name || ''
      setLookup(data)
      setName(teamName)
      setSlug(slugify(teamName))
      setAgeGroup(data.pg?.ageGroup || teamName.match(/\b(\d{1,2}U)\b/i)?.[1]?.toUpperCase() || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await adminAddTeam({ pgUrl: pgUrl.trim(), ftUrl: ftUrl.trim(), name, slug, ageGroup })
      setNotice(result.status === 'linked'
        ? `Five Tool linked to /${result.slug}. Gathering its data now.`
        : `Added /${result.slug}. Gathering its data now. This takes a minute or two.`)
      setLookup(null)
      setPgUrl('')
      setFtUrl('')
      onAdded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const existing = lookup?.existing
  const canLink = existing && lookup.ft && !existing.hasFiveTool

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3" style={{ background: 'var(--navy)' }}>
        <div className="font-display text-base text-white tracking-wider">ADD A TEAM</div>
      </div>

      {!lookup ? (
        <form onSubmit={handleLookup} className="p-4 space-y-3">
          <div>
            <Label>Perfect Game team URL</Label>
            <input value={pgUrl} onChange={e => setPgUrl(e.target.value)} className={inputClass} style={inputStyle}
              placeholder="https://www.perfectgame.org/PGBA/Team/default.aspx?orgid=…&orgteamid=…" />
          </div>
          <div>
            <Label>Five Tool team URL</Label>
            <input value={ftUrl} onChange={e => setFtUrl(e.target.value)} className={inputClass} style={inputStyle}
              placeholder="https://play.fivetoolyouth.org/team/details/…" />
          </div>
          <p className="text-xs" style={{ color: 'var(--navy-muted)' }}>
            Paste one or both. A team that plays in both gets one BleacherBox page with both sets of games.
          </p>
          {notice && <div className="text-sm font-semibold" style={{ color: 'var(--win)' }}>{notice}</div>}
          {error && <div className="text-sm font-semibold" style={{ color: 'var(--loss)' }}>{error}</div>}
          <button type="submit" disabled={busy || (!pgUrl.trim() && !ftUrl.trim())}
            className="w-full h-11 rounded-lg font-display text-base tracking-wider text-white active:scale-95 disabled:opacity-60"
            style={{ background: busy ? 'var(--navy-muted)' : 'var(--navy)' }}>
            {busy ? 'LOOKING UP… (UP TO A MINUTE)' : 'LOOK UP TEAM'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleAdd} className="p-4 space-y-3">
          <div className="space-y-1.5">
            {lookup.pg && (
              <div className="text-sm" style={{ color: 'var(--navy)' }}>
                <SourceBadge>PG</SourceBadge>{' '}
                <span className="font-semibold">{lookup.pg.name}</span>
                {[lookup.pg.record, lookup.pg.hometown].filter(Boolean).length > 0 && (
                  <span style={{ color: 'var(--navy-muted)' }}> · {[lookup.pg.record, lookup.pg.hometown].filter(Boolean).join(' · ')}</span>
                )}
              </div>
            )}
            {lookup.ft && (
              <div className="text-sm" style={{ color: 'var(--navy)' }}>
                <SourceBadge>5 TOOL</SourceBadge>{' '}
                <span className="font-semibold">{lookup.ft.name}</span>
                <span style={{ color: 'var(--navy-muted)' }}> · {lookup.ft.season}</span>
              </div>
            )}
          </div>

          {existing ? (
            <div className="text-sm rounded-lg p-3" style={{ background: 'var(--sky)', color: 'var(--navy)' }}>
              Already added as <Link to={`/${existing.slug}`} className="font-semibold">{existing.name}</Link>.
              {canLink && ' Add this Five Tool team to it so both sets of games show on one page?'}
            </div>
          ) : (
            <>
              <div>
                <Label>Team name</Label>
                <input value={name} onChange={e => setName(e.target.value)} required className={inputClass} style={inputStyle} />
              </div>
              <div>
                <Label>Team page URL</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm" style={{ color: 'var(--navy-muted)' }}>bleacherbox.app/</span>
                  <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} required
                    pattern="[a-z0-9-]+" className={inputClass} style={inputStyle} />
                </div>
              </div>
              <div>
                <Label>Age group (optional)</Label>
                <input value={ageGroup} onChange={e => setAgeGroup(e.target.value)} placeholder="e.g. 14U"
                  className={inputClass} style={inputStyle} />
              </div>
            </>
          )}

          {error && <div className="text-sm font-semibold" style={{ color: 'var(--loss)' }}>{error}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setLookup(null); setError('') }}
              className="flex-1 h-10 rounded-lg text-xs font-bold uppercase tracking-wider"
              style={{ background: 'var(--sky)', color: 'var(--navy)' }}>
              Back
            </button>
            {(!existing || canLink) && (
              <button type="submit" disabled={busy}
                className="flex-1 h-10 rounded-lg font-display text-sm tracking-wider text-white active:scale-95"
                style={{ background: busy ? 'var(--navy-muted)' : 'var(--navy)' }}>
                {busy ? 'SAVING…' : canLink ? 'LINK FIVE TOOL' : 'ADD TEAM'}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

function TeamList({ teams, loading, onDeleted }) {
  const [refreshing, setRefreshing] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  async function handleDelete(team) {
    const name = team.name || team.slug
    if (!confirm(`Delete ${name}?\n\nThis permanently removes its games, roster, scorebooks, walkup songs and baseball cards, and removes it from everyone's teams. This can't be undone.`)) return
    setError('')
    setDeleting(team.slug)
    try {
      await adminDeleteTeam(team.pg_org_id, team.pg_team_id)
      onDeleted?.()
    } catch (err) {
      setError(`Couldn't delete ${name}: ${err.message}`)
    } finally {
      setDeleting(null)
    }
  }

  async function handleRefresh(slug) {
    setRefreshing(r => ({ ...r, [slug]: true }))
    try {
      await triggerScrape(slug)
    } finally {
      // The scrape keeps running on the server; just let the admin know it started.
      setTimeout(() => setRefreshing(r => ({ ...r, [slug]: false })), 4000)
    }
  }

  return (
    <div>
      <div className="section-label mb-3">ALL TEAMS ({teams.length})</div>
      {error && <div className="text-sm font-semibold mb-2" style={{ color: 'var(--loss)' }}>{error}</div>}
      <div className="card overflow-hidden">
        {loading && <div className="p-4"><LoadingSpinner /></div>}
        {!loading && teams.length === 0 && (
          <div className="p-4 text-sm text-center" style={{ color: 'var(--navy-muted)' }}>No teams added yet.</div>
        )}
        {teams.map(t => (
          <div key={`${t.pg_org_id}-${t.pg_team_id}`}
            className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
            style={{ borderColor: 'var(--border)' }}>
            <img src={t.logo_url || '/yardbirds-logo.png'} alt="" className="w-10 h-10 object-contain shrink-0" />
            <div className="flex-1 min-w-0">
              <Link to={`/${t.slug}`} className="text-sm font-semibold truncate block no-underline" style={{ color: 'var(--navy)' }}>
                {t.name || t.slug}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                {t.age_group && <SourceBadge>{t.age_group}</SourceBadge>}
                {t.pg_org_id < SYNTHETIC_PG_ID_MIN && <SourceBadge>PG</SourceBadge>}
                {t.ft_team_uuid && <SourceBadge>5 TOOL</SourceBadge>}
                {t.last_scraped && (
                  <span className="text-[10px]" style={{ color: 'var(--navy-muted)' }}>
                    Updated {new Date(t.last_scraped + 'Z').toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => handleRefresh(t.slug)} disabled={refreshing[t.slug]}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded flex-shrink-0"
              style={{ background: 'var(--sky)', color: 'var(--navy)' }}>
              {refreshing[t.slug] ? 'Started' : 'Refresh'}
            </button>
            <button onClick={() => handleDelete(t)} disabled={deleting === t.slug}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded flex-shrink-0"
              style={{ background: 'var(--loss-bg, #fdecea)', color: 'var(--loss)' }}>
              {deleting === t.slug ? '…' : 'Delete'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Admin() {
  const { isGlobalAdmin, loading: authLoading } = useAuth()
  const [teams, setTeams] = useState([])
  const [loadingTeams, setLoadingTeams] = useState(true)

  function loadTeams() {
    getTeams().then(setTeams).catch(() => setTeams([])).finally(() => setLoadingTeams(false))
  }

  useEffect(() => {
    if (isGlobalAdmin) loadTeams()
  }, [isGlobalAdmin])

  if (authLoading) return <LoadingSpinner />

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="relative overflow-hidden py-6 px-6" style={{ background: 'var(--navy)' }}>
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <Link to="/account" className="flex items-center gap-2 no-underline">
            <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-5 object-contain" />
          </Link>
          <div className="font-display text-xl text-white tracking-wider">ADMIN</div>
        </div>
        <div className="stitch-line mt-4" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        {!isGlobalAdmin ? (
          <div className="text-center py-12">
            <div className="font-display text-xl" style={{ color: 'var(--navy)' }}>ADMIN ACCESS REQUIRED</div>
            <Link to="/account" className="text-sm font-semibold" style={{ color: 'var(--navy-muted)' }}>Back to your account</Link>
          </div>
        ) : (
          <>
            <AddTeamByUrl onAdded={loadTeams} />

            <details className="card overflow-hidden">
              <summary className="px-4 py-3 cursor-pointer text-sm font-semibold" style={{ color: 'var(--navy)' }}>
                Or add a team from a tournament's team list
              </summary>
              <AddTeamByTournament onAdded={loadTeams} />
            </details>

            <TeamList teams={teams} loading={loadingTeams} onDeleted={loadTeams} />

            <PendingAccounts />
          </>
        )}
      </main>
    </div>
  )
}
