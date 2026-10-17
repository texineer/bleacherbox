import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSchedule } from '../api'
import GameCard from '../components/GameCard'
import LoadingSpinner from '../components/LoadingSpinner'
import BackButton from '../components/BackButton'

export default function Schedule({ orgId, teamId }) {
  const { slug } = useParams()
  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSchedule(orgId, teamId)
      .then(setSchedule)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [orgId, teamId])

  if (loading) return <LoadingSpinner />

  const tournaments = (schedule?.tournaments || []).slice().sort((a, b) => {
    // Sort by start_date ascending — upcoming first, then past
    const dateA = a.tournament.start_date || ''
    const dateB = b.tournament.start_date || ''
    const now = new Date().toISOString().slice(0, 10)
    const aUpcoming = dateA >= now
    const bUpcoming = dateB >= now
    // Upcoming tournaments first, sorted by nearest date
    if (aUpcoming && !bUpcoming) return -1
    if (!aUpcoming && bUpcoming) return 1
    // Among upcoming: nearest first; among past: most recent first
    if (aUpcoming) return dateA.localeCompare(dateB)
    return dateB.localeCompare(dateA)
  })

  return (
    <div className="space-y-8">
      <BackButton fallback={`/${slug}`} />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl" style={{ color: 'var(--navy)' }}>SCHEDULE</h1>
        <div className="section-label">{tournaments.length} events</div>
      </div>

      {tournaments.length === 0 && (
        <div className="text-center py-12">
          <img src="/yardbirds-logo.png" alt="" className="w-16 h-16 object-contain mx-auto mb-3 opacity-30" />
          <div className="font-display text-xl" style={{ color: 'var(--navy-muted)' }}>NO EVENTS</div>
          <p className="text-sm mt-1" style={{ color: 'var(--navy-muted)' }}>Hit sync on the dashboard to pull schedule data.</p>
        </div>
      )}

      {tournaments.map(({ tournament: t, games }, ti) => {
        const dateStr = formatDateRange(t.start_date, t.end_date)

        return (
          <div key={t.pg_event_id} className="card-enter" style={{ animationDelay: `${ti * 80}ms` }}>
            <div className="card overflow-hidden">
              {/* Tournament Header */}
              <div className="px-4 py-3" style={{ background: 'var(--navy)', color: 'white' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {t.pg_url ? (
                        <a href={t.pg_url} target="_blank" rel="noopener"
                          className="font-display text-lg leading-tight no-underline text-white hover:underline">
                          {t.name}
                        </a>
                      ) : (
                        <h2 className="font-display text-lg leading-tight m-0">{t.name}</h2>
                      )}
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          background: t.source === 'ft' ? '#e74c3c' : '#3498db',
                          color: 'white',
                        }}>
                        {t.source === 'ft' ? 'Five Tool' : 'Perfect Game'}
                      </span>
                    </div>
                    <p className="text-xs mt-1 opacity-60">
                      {dateStr}
                      {dateStr && t.location && ' \u00B7 '}
                      {t.location}
                      {t.last_scraped && ` \u00B7 Updated ${formatTimestamp(t.last_scraped)}`}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1">
                    {t.source !== 'ft' && (
                      <Link
                        to={`../tournament/${t.pg_event_id}/pitching`}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded no-underline whitespace-nowrap"
                        style={{ background: 'var(--gold)', color: 'var(--navy)' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        Pitch Counts
                      </Link>
                    )}
                    {t.source !== 'ft' && (
                      <Link
                        to={`../tournament/${t.pg_event_id}/schedule`}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded no-underline whitespace-nowrap"
                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/></svg>
                        All Games
                      </Link>
                    )}
                    {t.source !== 'ft' && (
                      <Link
                        to={`../tournament/${t.pg_event_id}/bracket`}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded no-underline whitespace-nowrap"
                        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 4v6h4M4 7h8v5M20 4v6h-4M20 7h-8v5M8 17v3h8v-3"/></svg>
                      Bracket
                    </Link>
                    )}
                  </div>
                </div>
              </div>

              {/* Games */}
              <div className="p-3 space-y-2">
                {games.map((g, gi) => (
                  <GameCard key={g.id} game={g} index={gi} />
                ))}
                {games.length === 0 && (
                  <p className="text-sm text-center py-4" style={{ color: 'var(--navy-muted)' }}>
                    No games listed yet
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatDateRange(start, end) {
  if (!start && !end) return ''
  const fmt = (str) => {
    if (!str) return ''
    const d = new Date(str + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  const s = fmt(start)
  const e = fmt(end)
  if (!s) return e
  if (!e || s === e) return s
  return `${s} \u2013 ${e}`
}

function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts + (ts.includes('Z') ? '' : 'Z'))
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}
