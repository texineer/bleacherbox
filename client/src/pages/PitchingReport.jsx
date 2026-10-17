import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTournamentPitchingReport, pitchSeverity } from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import BackButton from '../components/BackButton'

const DAILY_MAX = 95

export default function PitchingReport() {
  const { eventId, slug } = useParams()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('totals')

  useEffect(() => {
    getTournamentPitchingReport(eventId)
      .then(setReport)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [eventId])

  if (loading) return <LoadingSpinner />

  const totals = report?.totals || []
  const details = report?.details || []
  const hasData = totals.length > 0 || details.length > 0

  // Group by team
  const byTeam = {}
  for (const t of totals) {
    const team = t.team_name || 'Unknown'
    if (!byTeam[team]) byTeam[team] = []
    byTeam[team].push(t)
  }

  const detailsByTeam = {}
  for (const d of details) {
    const team = d.team_name || 'Unknown'
    if (!detailsByTeam[team]) detailsByTeam[team] = []
    detailsByTeam[team].push(d)
  }

  return (
    <div className="space-y-6">
      <BackButton fallback={`/${slug}`} />

      <h1 className="font-display text-3xl" style={{ color: 'var(--navy)' }}>PITCHING REPORT</h1>

      {!hasData && (
        <div className="text-center py-12">
          <div className="font-display text-xl" style={{ color: 'var(--navy-muted)' }}>NO DATA</div>
          <p className="text-sm mt-1" style={{ color: 'var(--navy-muted)' }}>No pitch count data available for this tournament yet</p>
        </div>
      )}

      {hasData && (
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--parchment-dark)' }}>
          <button
            onClick={() => setView('totals')}
            className="flex-1 text-xs font-bold uppercase tracking-wider py-2 rounded-md transition-all"
            style={{
              background: view === 'totals' ? 'var(--navy)' : 'transparent',
              color: view === 'totals' ? 'white' : 'var(--navy-muted)',
            }}
          >
            Totals
          </button>
          <button
            onClick={() => setView('all')}
            className="flex-1 text-xs font-bold uppercase tracking-wider py-2 rounded-md transition-all"
            style={{
              background: view === 'all' ? 'var(--navy)' : 'transparent',
              color: view === 'all' ? 'white' : 'var(--navy-muted)',
            }}
          >
            All Appearances
          </button>
        </div>
      )}

      {view === 'totals' && Object.entries(byTeam).map(([teamName, pitchers], ti) => (
        <div key={teamName} className="card-enter" style={{ animationDelay: `${ti * 60}ms` }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gold-dark)' }}>
            {teamName}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full stat-table">
              <thead>
                <tr>
                  <th className="text-left">Pitcher</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">App</th>
                  <th className="text-right">IP</th>
                  <th className="text-right">Max</th>
                </tr>
              </thead>
              <tbody>
                {pitchers.map((p, i) => {
                  const sev = pitchSeverity(p.max_pitches)
                  const pct = Math.min((p.max_pitches / DAILY_MAX) * 100, 100)
                  return (
                    <tr key={i}>
                      <td>
                        <span className="font-semibold">{p.player_name}</span>
                        <div className="pitch-bar mt-1">
                          <div className={`pitch-bar-fill pitch-bar-${sev}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="text-right font-display text-lg">{p.total_pitches}</td>
                      <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{p.appearances}</td>
                      <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{p.total_innings || '-'}</td>
                      <td className="text-right">
                        <span className={`font-display text-lg ${
                          sev === 'danger' ? 'text-[var(--danger)]' :
                          sev === 'warning' ? 'text-[var(--warning)]' : ''
                        }`}>
                          {p.max_pitches}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {view === 'all' && Object.entries(detailsByTeam).map(([teamName, entries], ti) => (
        <div key={teamName} className="card-enter" style={{ animationDelay: `${ti * 60}ms` }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gold-dark)' }}>
            {teamName}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full stat-table">
              <thead>
                <tr>
                  <th className="text-left">Pitcher</th>
                  <th className="text-right">Pitches</th>
                  <th className="text-right">Outs</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const sev = pitchSeverity(e.pitches)
                  const pct = Math.min((e.pitches / DAILY_MAX) * 100, 100)
                  return (
                    <tr key={i}>
                      <td>
                        <span className="font-semibold">{e.player_name}</span>
                        <div className="pitch-bar mt-1">
                          <div className={`pitch-bar-fill pitch-bar-${sev}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="text-right">
                        <span className={`font-display text-lg ${
                          sev === 'danger' ? 'text-[var(--danger)]' :
                          sev === 'warning' ? 'text-[var(--warning)]' : ''
                        }`}>
                          {e.pitches}
                        </span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--navy-muted)' }}>
                        {e.innings ? Math.round(e.innings * 3) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {hasData && (
        <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--navy-muted)' }}>
          <span>14U daily max: 95</span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--warning)' }} />
            70%+
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--danger)' }} />
            90%+
          </span>
        </div>
      )}
    </div>
  )
}
