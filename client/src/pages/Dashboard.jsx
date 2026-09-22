import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getTeam, getSchedule, triggerScrape, syncTournament, getTournamentTeams } from '../api'
import { useAuth } from '../context/AuthContext'
import GameCard from '../components/GameCard'
import LoadingSpinner from '../components/LoadingSpinner'

export default function Dashboard({ orgId, teamId, slug }) {
  const [team, setTeam] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [scraping, setScraping] = useState(false)
  const [syncingTournament, setSyncingTournament] = useState(null)
  const [expandedTournaments, setExpandedTournaments] = useState(new Set())
  const { user, hasTeamRole } = useAuth()

  useEffect(() => {
    loadData()
  }, [orgId, teamId])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [teamData, scheduleData] = await Promise.all([
        getTeam(orgId, teamId),
        getSchedule(orgId, teamId),
      ])
      setTeam(teamData)
      setSchedule(scheduleData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleScrape() {
    setScraping(true)
    try {
      await triggerScrape(slug)
      // Scrape runs in background on server — poll until data refreshes
      const poll = async (attempts = 0) => {
        if (attempts >= 6) { setScraping(false); return }
        await new Promise(r => setTimeout(r, 5000))
        await loadData()
        setScraping(false)
      }
      poll()
    } catch (err) {
      setError(err.message)
      setScraping(false)
    }
  }

  if (loading) return <LoadingSpinner />

  if (error) {
    return (
      <div className="text-center py-16">
        <img src={team?.logo_url || '/yardbirds-logo.png'} alt="" className="w-20 h-20 object-contain mx-auto mb-4 opacity-40" />
        <div className="font-display text-2xl mb-2" style={{ color: 'var(--navy-muted)' }}>NO DATA YET</div>
        <p className="text-sm mb-6" style={{ color: 'var(--navy-muted)' }}>{error}</p>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className="btn-gold px-6 py-3 rounded-lg text-sm disabled:opacity-50"
        >
          {scraping ? 'Loading data...' : 'Load Team Data'}
        </button>
      </div>
    )
  }

  // Combined record from all sources (PG + Five Tool)
  const cr = team?.combinedRecord
  const wins = cr ? String(cr.wins || 0) : '0'
  const losses = cr ? String(cr.losses || 0) : '0'
  const ties = cr ? String(cr.ties || 0) : '0'

  // Sort tournaments by start date — next occurring first, then chronologically
  const now = new Date().toISOString().slice(0, 10)
  const tournaments = (schedule?.tournaments || []).slice().sort((a, b) => {
    const dateA = a.tournament.start_date || '9999'
    const dateB = b.tournament.start_date || '9999'
    // Upcoming tournaments first (nearest date), then past (most recent first)
    const aFuture = dateA >= now
    const bFuture = dateB >= now
    if (aFuture && !bFuture) return -1
    if (!aFuture && bFuture) return 1
    if (aFuture && bFuture) return dateA.localeCompare(dateB)  // nearest upcoming first
    return dateB.localeCompare(dateA)  // most recent past first
  })

  return (
    <div className="space-y-6">
      {/* Team Hero */}
      <div className="card relative overflow-hidden">
        <div className="h-1.5" style={{ background: 'linear-gradient(90deg, var(--powder), var(--gold), var(--powder))' }} />
        <div className="p-5">
          <div className="flex items-start gap-3">
            <img src={team?.logo_url || '/yardbirds-logo.png'} alt="" className="w-16 h-16 object-contain shrink-0" />
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-3xl leading-none" style={{ color: 'var(--navy)' }}>
                {team?.name || 'Team'}
              </h1>
              <div className="flex flex-wrap gap-2 mt-2">
                {team?.age_group && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--powder-pale)', color: 'var(--navy)' }}>
                    {team.age_group}
                  </span>
                )}
                {team?.classification && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
                    {team.classification}
                  </span>
                )}
                {team?.hometown && (
                  <span className="text-xs" style={{ color: 'var(--navy-muted)' }}>{team.hometown}</span>
                )}
              </div>
              <div className="font-display text-4xl leading-none mt-3" style={{ color: 'var(--navy)' }}>
                {wins}<span className="opacity-20">-</span>{losses}<span className="opacity-20">-</span>{ties}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <Link to="roster"
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg no-underline"
                style={{ background: 'var(--navy)', color: 'white' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                </svg>
                Roster
              </Link>
              <button onClick={handleScrape} disabled={scraping}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg disabled:opacity-70"
                style={{ background: scraping ? 'var(--powder-pale)' : 'var(--gold)', color: 'var(--navy)' }}>
                {scraping ? (
                  <><svg className="diamond-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Refreshing</>
                ) : (
                  <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Refresh All</>
                )}
              </button>
            </div>
          </div>

          {/* Team Sites */}
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-center mb-2" style={{ color: 'var(--navy-muted)' }}>Team Sites</div>
            <div className="flex gap-2">
              <a href={`https://www.perfectgame.org/PGBA/Team/default.aspx?orgid=${orgId}&orgteamid=${teamId}`}
                target="_blank" rel="noopener"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl no-underline active:scale-97"
                style={{ background: 'var(--navy)', color: 'white' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                <span className="text-xs font-bold uppercase tracking-wider">Perfect Game</span>
              </a>
              {team?.ft_team_uuid && team?.ft_seasons && (
                <a href={`${team.ft_base_url || 'https://play.fivetoolyouth.org'}/team/details/${team.ft_seasons.split(',')[0]}/${team.ft_team_uuid}`}
                  target="_blank" rel="noopener"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl no-underline active:scale-97"
                  style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                  <span className="text-xs font-bold uppercase tracking-wider">Five Tool</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Schedule grouped by tournament */}
      {tournaments.length === 0 && (
        <div className="text-center py-8">
          <div className="font-display text-xl" style={{ color: 'var(--navy-muted)' }}>NO GAMES YET</div>
          <p className="text-sm mt-1" style={{ color: 'var(--navy-muted)' }}>Tap Refresh All to load schedule data.</p>
        </div>
      )}

      {tournaments.map(({ tournament: t, games }) => {
        const opponents = [...new Set(games.map(g => g.opponent_name).filter(Boolean))].sort()
        const isPast = (t.end_date || t.start_date || '') < now
        const isExpanded = !isPast || expandedTournaments.has(t.pg_event_id)
        const toggleExpand = () => setExpandedTournaments(prev => {
          const next = new Set(prev)
          next.has(t.pg_event_id) ? next.delete(t.pg_event_id) : next.add(t.pg_event_id)
          return next
        })
        // Summary for collapsed past tournaments
        const gameResults = games.filter(g => g.result)
        const wCount = gameResults.filter(g => g.result === 'W').length
        const lCount = gameResults.filter(g => g.result === 'L').length

        return (
          <div key={t.pg_event_id}>
            {/* Tournament header */}
            <div className={`${isExpanded ? 'rounded-t-xl' : 'rounded-xl'} px-4 py-3`}
              style={{ background: 'var(--navy)', cursor: isPast ? 'pointer' : undefined }}
              onClick={isPast ? toggleExpand : undefined}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {t.pg_url ? (
                      <a href={t.pg_url} target="_blank" rel="noopener" className="font-display text-lg text-white leading-tight truncate no-underline hover:underline">{t.name}</a>
                    ) : (
                      <span className="font-display text-lg text-white leading-tight truncate">{t.name}</span>
                    )}
                    <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ background: t.source === 'ft' ? 'var(--gold)' : 'var(--powder)', color: 'var(--navy)' }}>
                      {t.source === 'ft' ? 'FT' : 'PG'}
                    </span>
                  </div>
                  {t.start_date && (
                    <div className="text-[10px] font-bold text-white/50 mt-1">
                      {formatDate(t.start_date)}{t.end_date && t.end_date !== t.start_date ? ` — ${formatDate(t.end_date)}` : ''}
                    </div>
                  )}
                  {t.last_scraped && (
                    <div className="text-[9px] text-white/30 mt-0.5">
                      Updated {formatTimeAgo(t.last_scraped)}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 ml-2 flex-shrink-0">
                  {/* Refresh this tournament */}
                  <button
                    onClick={async () => {
                      setSyncingTournament(t.pg_event_id)
                      await syncTournament(t.pg_event_id).catch(() => {})
                      // Poll until data refreshes (background scrape may take 10-30s)
                      const poll = async (attempt = 0) => {
                        if (attempt >= 4) { await loadData(); setSyncingTournament(null); return }
                        await new Promise(r => setTimeout(r, 8000))
                        await loadData()
                        setSyncingTournament(null)
                      }
                      poll()
                    }}
                    disabled={syncingTournament === t.pg_event_id}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
                    style={{ background: 'rgba(255,255,255,0.1)', color: syncingTournament === t.pg_event_id ? 'var(--gold)' : 'white', opacity: syncingTournament === t.pg_event_id ? 0.7 : 1 }}>
                    <svg className={syncingTournament === t.pg_event_id ? 'diamond-spin' : ''} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                    </svg>
                    {syncingTournament === t.pg_event_id ? 'Refreshing' : 'Refresh'}
                  </button>
                  {(t.location || t.pg_url) && (
                    <a href={t.source === 'ft' && t.pg_url ? `${t.pg_url}/venues` : t.pg_url || '#'}
                      target="_blank" rel="noopener"
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded no-underline"
                      style={{ background: 'rgba(212,168,50,0.2)', color: 'var(--gold)' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                      </svg>
                      Venue
                    </a>
                  )}
                  {t.source !== 'ft' && (
                    <Link to={`tournament/${t.pg_event_id}/bracket`}
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded no-underline text-center"
                      style={{ background: 'rgba(212,168,50,0.2)', color: 'var(--gold)' }}>
                      Bracket
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* Expand/collapse bar for past tournaments */}
            {isPast && gameResults.length > 0 && (
              <button onClick={toggleExpand}
                className="w-full flex items-center justify-between px-4 py-2.5 border border-t-0 active:bg-[var(--sky)] transition-colors"
                style={{ borderColor: 'var(--border)', background: isExpanded ? 'var(--sky)' : 'white', borderRadius: isExpanded ? 0 : '0 0 12px 12px' }}>
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg" style={{ color: 'var(--navy)' }}>{wCount}W - {lCount}L</span>
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--navy-muted)' }}>{gameResults.length} games</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--navy-muted)' }}>
                    {isExpanded ? 'Hide' : 'Show'} Games
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2.5" strokeLinecap="round"
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </button>
            )}

            {/* Games or Teams list (collapsible for past tournaments) */}
            {isExpanded && (
              <div className="rounded-b-xl overflow-hidden border border-t-0 mb-1" style={{ borderColor: 'var(--border)' }}>
                {games.length === 0 ? (
                  <div className="p-4">
                    <div className="text-sm text-center mb-3" style={{ color: 'var(--navy-muted)' }}>Schedule not available yet</div>
                    <TeamsInTournament eventId={t.pg_event_id} pgUrl={t.pg_url} source={t.source} ageGroup={team?.age_group} />
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {games.sort((a, b) => (a.game_date || '').localeCompare(b.game_date || '') || (a.game_time || '').localeCompare(b.game_time || '')).map((g, i) => (
                      <GameCard key={g.id} game={g} index={i} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

    </div>
  )
}

function TeamsInTournament({ eventId, pgUrl, source, ageGroup }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  function handleToggle() {
    if (!expanded && !data) {
      // Fetch on first expand
      setLoading(true)
      getTournamentTeams(eventId, ageGroup)
        .then(d => setData(d))
        .catch(() => setData({ teams: [], venues: [] }))
        .finally(() => setLoading(false))
    }
    setExpanded(v => !v)
  }

  const teams = data?.teams || []

  return (
    <div>
      <button onClick={handleToggle}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors active:scale-98"
        style={{ background: 'var(--sky)', color: 'var(--navy)', border: '1px solid var(--border)' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M9 6l6 6-6 6"/>
        </svg>
        {ageGroup ? `${ageGroup} ` : ''}Teams Currently Registered
        {teams.length > 0 && ` (${teams.length})`}
      </button>

      {expanded && (
        <div className="mt-1.5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3">
              <svg className="diamond-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--navy-muted)' }}>Loading...</span>
            </div>
          )}

          {!loading && teams.length === 0 && pgUrl && (
            <div className="text-center py-2">
              <a href={pgUrl} target="_blank" rel="noopener"
                className="inline-flex items-center gap-1.5 text-xs font-bold no-underline px-4 py-2 rounded-lg"
                style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
                Check {source === 'ft' ? 'Five Tool' : 'Perfect Game'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
              </a>
            </div>
          )}

          {!loading && teams.length > 0 && (
            <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {teams.map((t, i) => (
                <a key={t.name + i}
                  href={t.href || '#'}
                  target={t.href ? '_blank' : undefined}
                  rel="noopener"
                  className="block truncate no-underline px-2.5 py-1.5 transition-colors"
                  style={{
                    fontSize: '11px',
                    lineHeight: '1.3',
                    fontWeight: 500,
                    color: 'var(--navy)',
                    background: i % 4 < 2 ? 'var(--sky)' : 'white',
                  }}>
                  {t.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return ''
  try {
    // DB stores as "2026-03-31 00:27:17" (no T, no Z) — treat as UTC
    const normalized = dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z')
    const d = new Date(normalized)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const diffMs = now - d
    if (diffMs < 0) return 'just now'
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch { return '' }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return dateStr }
}
