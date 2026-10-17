import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getGame, getDailyPitchTotals, getOpponentPitchers, pitchSeverity, getScorebookState, fetchGameScore } from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import BackButton from '../components/BackButton'

const DAILY_MAX = 95

export default function GameDetail() {
  const { gameId, slug } = useParams()
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dailyTotals, setDailyTotals] = useState(null)
  const [showDaily, setShowDaily] = useState(false)
  const [opponentPitchers, setOpponentPitchers] = useState(null)
  const [scorebookStatus, setScorebookStatus] = useState(null)

  useEffect(() => {
    getGame(gameId)
      .then(g => {
        setGame(g)
        // If PG game has no score, try fetching it live
        if (g && g.pg_game_id && !g.result && g.source !== 'ft') {
          fetchGameScore(gameId)
            .then(score => {
              if (score?.result) {
                setGame(prev => ({ ...prev, score_us: score.scoreUs, score_them: score.scoreThem, result: score.result }))
              }
            })
            .catch(() => {})
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
    getScorebookState(gameId)
      .then(d => setScorebookStatus(d?.state?.status ?? null))
      .catch(() => {})
  }, [gameId])

  // Auto-load opponent pitcher data
  useEffect(() => {
    if (game && game.opponent_name && game.source !== 'ft') {
      getOpponentPitchers(gameId).then(setOpponentPitchers).catch(console.error)
    }
  }, [game, gameId])

  useEffect(() => {
    if (showDaily && !dailyTotals) {
      getDailyPitchTotals(gameId).then(setDailyTotals).catch(console.error)
    }
  }, [showDaily, gameId, dailyTotals])

  if (loading) return <LoadingSpinner />
  if (!game) return (
    <div className="text-center py-12">
      <div className="font-display text-xl" style={{ color: 'var(--navy-muted)' }}>GAME NOT FOUND</div>
    </div>
  )

  const isWin = game.result === 'W'
  const isLoss = game.result === 'L'
  const resultColor = isWin ? 'var(--win)' : isLoss ? 'var(--loss)' : 'var(--navy-muted)'

  return (
    <div className="space-y-6">
      <BackButton fallback={`/${slug}`} />

      {/* Live Scoring Banners */}
      {(scorebookStatus === 'in_progress' || scorebookStatus === 'live') && (
        <Link to="live" className="card flex items-center gap-3 px-4 py-3 no-underline"
          style={{ borderLeft: '4px solid var(--win)' }}>
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className="absolute inset-0 rounded-full animate-ping opacity-75" style={{ background: 'var(--win)' }} />
            <span className="relative rounded-full h-2.5 w-2.5" style={{ background: 'var(--win)' }} />
          </span>
          <span className="font-display text-lg tracking-widest" style={{ color: 'var(--win)' }}>LIVE</span>
          <span className="text-sm font-semibold flex-1" style={{ color: 'var(--navy)' }}>View live scoreboard</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      )}
      {scorebookStatus === 'final' && (
        <Link to="live" className="card flex items-center gap-3 px-4 py-3 no-underline"
          style={{ borderLeft: '4px solid var(--navy-muted, #6b7c8d)' }}>
          <span className="font-display text-base tracking-widest" style={{ color: 'var(--navy)' }}>VIEW SCOREBOOK</span>
          <span className="text-xs flex-1" style={{ color: 'var(--navy-muted)' }}>Full play-by-play</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      )}
      {!game?.result && !scorebookStatus && (
        <Link to="lineup" className="card flex items-center gap-3 px-4 py-3 no-underline"
          style={{ borderLeft: '4px solid var(--gold)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2a5 5 0 110 10A5 5 0 0112 2z"/><circle cx="12" cy="12" r="2.5" fill="var(--gold)"/>
          </svg>
          <span className="font-display text-base tracking-widest" style={{ color: 'var(--navy)' }}>SCORE THIS GAME</span>
          <span className="text-xs flex-1" style={{ color: 'var(--navy-muted)' }}>Scorekeeper access required</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      )}

      {/* Game Hero */}
      <div className="card overflow-hidden">
        {/* Top bar with tournament name */}
        <div className="px-4 py-2" style={{ background: 'var(--parchment)' }}>
          <span className="section-label">{game.tournament_name || 'Game'}</span>
        </div>
        <div className="stitch-line" />

        <div className="p-5">
          <h1 className="font-display text-3xl leading-none" style={{ color: 'var(--navy)' }}>
            VS {(game.opponent_name || 'TBD').toUpperCase()}
          </h1>

          {/* Score */}
          {game.result && (
            <div className="mt-4 flex items-center gap-4 score-reveal">
              <span
                className="font-display text-sm px-2 py-1 rounded text-white"
                style={{ background: resultColor }}
              >
                {game.result === 'W' ? 'WIN' : game.result === 'L' ? 'LOSS' : game.result}
              </span>
              <div className="font-display text-5xl tracking-wider" style={{ color: 'var(--navy)' }}>
                {game.score_us}
                <span className="opacity-20 mx-1">-</span>
                {game.score_them}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="mt-4 space-y-1 text-sm" style={{ color: 'var(--navy-muted)' }}>
            {game.game_date && (
              <p className="font-medium">{formatDate(game.game_date)}{game.game_time && ` at ${game.game_time}`}</p>
            )}
            {!game.game_date && game.game_time && (
              <p className="font-medium">{game.game_time}</p>
            )}
            {game.field && <p>{game.field}</p>}
          </div>

          {game.pg_box_url && (
            <a href={game.pg_box_url} target="_blank" rel="noopener"
              className="inline-flex items-center gap-1 mt-3 text-xs font-bold no-underline" style={{ color: 'var(--gold-dark)' }}>
              View on Perfect Game
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
            </a>
          )}
        </div>
      </div>

      {/* Tournament Pitch Counts — Both Teams */}
      {opponentPitchers && (opponentPitchers.ourPitchers?.length > 0 || opponentPitchers.opponentPitchers?.length > 0) && (
        <div className="space-y-4">
          <div className="section-label">Tournament Pitch Counts</div>

          {/* Our Team */}
          {opponentPitchers.ourPitchers?.length > 0 && (
            <TeamPitchTable
              teamName={opponentPitchers.ourTeamName || 'Our Team'}
              pitchers={opponentPitchers.ourPitchers}
              accent="var(--powder)"
            />
          )}

          {/* Opponent */}
          {opponentPitchers.opponentPitchers?.length > 0 && (
            <TeamPitchTable
              teamName={opponentPitchers.opponentName || 'Opponent'}
              pitchers={opponentPitchers.opponentPitchers}
              accent="var(--loss)"
            />
          )}

          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--navy-muted)' }}>
            Cumulative pitch counts for this tournament
          </p>
        </div>
      )}

      {/* Pitch Counts */}
      {game.pitchCounts?.length > 0 && (
        <div>
          <div className="section-label mb-2">Pitch Counts</div>
          <div className="card overflow-hidden">
            <table className="w-full stat-table">
              <thead>
                <tr>
                  <th className="text-left">Pitcher</th>
                  <th className="text-left">Team</th>
                  <th className="text-right">PC</th>
                  <th className="text-right">IP</th>
                  <th className="text-right">K</th>
                  <th className="text-right">BB</th>
                </tr>
              </thead>
              <tbody>
                {game.pitchCounts.map((pc, i) => (
                  <PitchCountRow key={i} pc={pc} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Daily Totals toggle */}
          <button
            onClick={() => setShowDaily(!showDaily)}
            className="mt-3 w-full text-xs font-bold uppercase tracking-wider py-2.5 rounded-lg transition-colors"
            style={{
              background: showDaily ? 'var(--navy)' : 'var(--parchment-dark)',
              color: showDaily ? 'white' : 'var(--navy-muted)',
            }}
          >
            {showDaily ? 'Hide' : 'View'} Daily Totals {game.game_date ? `\u2014 ${formatDate(game.game_date)}` : ''}
          </button>

          {/* Daily Totals */}
          {showDaily && (
            <div className="mt-3 card-enter">
              {!dailyTotals && <LoadingSpinner />}
              {dailyTotals && dailyTotals.length === 0 && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--navy-muted)' }}>No daily totals available</p>
              )}
              {dailyTotals && dailyTotals.length > 0 && (() => {
                const byTeam = {}
                for (const p of dailyTotals) {
                  const team = p.team_name || 'Unknown'
                  if (!byTeam[team]) byTeam[team] = []
                  byTeam[team].push(p)
                }
                return Object.entries(byTeam).map(([teamName, pitchers]) => (
                  <div key={teamName} className="mb-3">
                    <div className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--gold-dark)' }}>
                      {teamName}
                    </div>
                    <div className="card overflow-hidden">
                      <table className="w-full stat-table">
                        <thead>
                          <tr>
                            <th className="text-left">Pitcher</th>
                            <th className="text-right">Day</th>
                            <th className="text-right">G</th>
                            <th className="text-right">IP</th>
                            <th className="text-right">K</th>
                            <th className="text-right">BB</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pitchers.map((p, i) => {
                            const sev = pitchSeverity(p.total_pitches)
                            const pct = Math.min((p.total_pitches / DAILY_MAX) * 100, 100)
                            return (
                              <tr key={i}>
                                <td>
                                  <span className="font-semibold">{p.player_name}</span>
                                  <div className="pitch-bar mt-1">
                                    <div className={`pitch-bar-fill pitch-bar-${sev}`} style={{ width: `${pct}%` }} />
                                  </div>
                                </td>
                                <td className="text-right">
                                  <span className={`font-display text-lg ${
                                    sev === 'danger' ? 'text-[var(--danger)]' :
                                    sev === 'warning' ? 'text-[var(--warning)]' : ''
                                  }`}>
                                    {p.total_pitches}
                                  </span>
                                </td>
                                <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{p.appearances}</td>
                                <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{p.total_innings || '-'}</td>
                                <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{p.total_strikeouts ?? '-'}</td>
                                <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{p.total_walks ?? '-'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}

          <PitchLegend />
        </div>
      )}

      {game.pitchCounts?.length === 0 && game.result && (
        <div className="text-center py-6">
          <div className="font-display text-base" style={{ color: 'var(--navy-muted)' }}>NO PITCH DATA</div>
          <p className="text-xs mt-1" style={{ color: 'var(--navy-muted)' }}>Pitch counts aren't available for this game</p>
        </div>
      )}
    </div>
  )
}

function TeamPitchTable({ teamName, pitchers, accent }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 flex items-center gap-2" style={{ background: 'var(--navy)', color: 'white' }}>
        <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
        <span className="text-[10px] font-bold uppercase tracking-wider">{teamName}</span>
      </div>
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
            return (
              <tr key={i}>
                <td>
                  <span className="font-semibold">{p.player_name}</span>
                  <div className="pitch-bar mt-1">
                    <div className={`pitch-bar-fill pitch-bar-${sev}`} style={{ width: `${Math.min((p.total_pitches / DAILY_MAX) * 100, 100)}%` }} />
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
  )
}

function PitchCountRow({ pc }) {
  const sev = pitchSeverity(pc.pitches)
  const pct = Math.min((pc.pitches / DAILY_MAX) * 100, 100)

  return (
    <tr>
      <td>
        <span className="font-semibold">{pc.player_name}</span>
        <div className="pitch-bar mt-1">
          <div className={`pitch-bar-fill pitch-bar-${sev}`} style={{ width: `${pct}%` }} />
        </div>
      </td>
      <td className="text-xs" style={{ color: 'var(--navy-muted)' }}>{pc.team_name}</td>
      <td className="text-right">
        <span className={`font-display text-lg ${
          sev === 'danger' ? 'text-[var(--danger)]' :
          sev === 'warning' ? 'text-[var(--warning)]' : ''
        }`}>
          {pc.pitches}
        </span>
      </td>
      <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{pc.innings || '-'}</td>
      <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{pc.strikeouts ?? '-'}</td>
      <td className="text-right" style={{ color: 'var(--navy-muted)' }}>{pc.walks ?? '-'}</td>
    </tr>
  )
}

function PitchLegend() {
  return (
    <div className="flex items-center gap-4 mt-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--navy-muted)' }}>
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
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
