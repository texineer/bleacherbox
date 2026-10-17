import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTournamentFullSchedule } from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import BackButton from '../components/BackButton'

export default function TournamentSchedule() {
  const { eventId, slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTournamentFullSchedule(eventId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [eventId])

  if (loading) return <LoadingSpinner />

  const tournament = data?.tournament
  const games = data?.games || []

  // Group games by time slot
  const byTime = {}
  for (const g of games) {
    const key = g.gameTime || 'TBD'
    if (!byTime[key]) byTime[key] = []
    byTime[key].push(g)
  }

  return (
    <div className="space-y-6">
      <BackButton fallback={`/${slug}`} />

      <div>
        <h1 className="font-display text-3xl" style={{ color: 'var(--navy)' }}>FULL SCHEDULE</h1>
        {tournament && (
          <p className="text-sm mt-1" style={{ color: 'var(--navy-muted)' }}>
            {tournament.name}
            {tournament.start_date && ` \u2014 ${formatDate(tournament.start_date)}`}
            {tournament.end_date && tournament.end_date !== tournament.start_date && ` \u2013 ${formatDate(tournament.end_date)}`}
          </p>
        )}
      </div>

      {games.length === 0 && (
        <div className="text-center py-12">
          <div className="font-display text-xl" style={{ color: 'var(--navy-muted)' }}>NO GAMES</div>
          <p className="text-sm mt-1" style={{ color: 'var(--navy-muted)' }}>Schedule hasn't been posted yet</p>
        </div>
      )}

      {Object.entries(byTime).map(([time, timeGames], ti) => (
        <div key={time} className="card-enter" style={{ animationDelay: `${ti * 60}ms` }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="font-display text-lg" style={{ color: 'var(--navy)' }}>{time}</div>
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          </div>
          <div className="space-y-2">
            {timeGames.map((g, gi) => {
              const team1 = g.teams[0]?.name || 'TBD'
              const team2 = g.teams[1]?.name || 'TBD'
              return (
                <a
                  key={g.pgGameId || gi}
                  href={g.pgBoxUrl}
                  target="_blank"
                  rel="noopener"
                  className="card block no-underline overflow-hidden"
                >
                  <div className="flex items-stretch">
                    <div className="flex-1 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[0.95rem]" style={{ color: 'var(--navy)' }}>{team1}</span>
                        <span className="text-xs font-bold" style={{ color: 'var(--navy-muted)' }}>vs</span>
                        <span className="font-semibold text-[0.95rem]" style={{ color: 'var(--navy)' }}>{team2}</span>
                      </div>
                      {g.field && (
                        <p className="text-xs mt-1" style={{ color: 'var(--navy-muted)' }}>{g.field}</p>
                      )}
                    </div>
                    <div className="flex items-center px-3">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2" strokeLinecap="round" opacity="0.4">
                        <path d="M7 17L17 7M17 7H7M17 7v10"/>
                      </svg>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
