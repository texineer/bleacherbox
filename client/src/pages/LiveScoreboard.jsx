import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getScorebookState } from '../api'
import BasesDiamond from '../components/BasesDiamond'
import LoadingSpinner from '../components/LoadingSpinner'
import BackButton from '../components/BackButton'

const OUTCOME_COLORS = {
  K: 'var(--loss)', 'Kl': 'var(--loss)', K_L: 'var(--loss)',
  BB: 'var(--win)', HBP: 'var(--win)',
  HR: 'var(--gold)',
  '1B': 'var(--powder)', '2B': 'var(--powder)', '3B': 'var(--powder)',
}

function outcomeColor(outcome) {
  return OUTCOME_COLORS[outcome] || 'var(--navy)'
}

function OutsDots({ count }) {
  return (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map(i => (
        <span key={i} className="inline-block w-2.5 h-2.5 rounded-full border-2"
          style={{
            background: i < count ? 'var(--gold)' : 'transparent',
            borderColor: i < count ? 'var(--gold)' : 'rgba(255,255,255,0.4)',
          }} />
      ))}
    </div>
  )
}

function InningScoreGrid({ inningScores, currentInning, currentHalf, homeTeam, awayTeam, ourSide }) {
  const innings = Array.from({ length: Math.max(9, currentInning) }, (_, i) => i + 1)

  const totals = { home: { r: 0, h: 0, e: 0 }, away: { r: 0, h: 0, e: 0 } }
  const scoreMap = {}
  for (const s of inningScores) {
    scoreMap[`${s.inning}-${s.half}`] = s
    totals[s.half].r += s.runs
    totals[s.half].h += s.hits
    totals[s.half].e += s.errors
  }

  const ourHalf = ourSide === 'home' ? 'bottom' : 'top'
  const themHalf = ourSide === 'home' ? 'top' : 'bottom'

  const renderRow = (side, half, label) => (
    <tr style={side === ourSide ? { borderLeft: '3px solid var(--gold)' } : {}}>
      <td className="text-left font-bold text-xs w-12 px-2 py-1.5 sticky left-0"
        style={{ background: 'var(--cream)', color: 'var(--navy)' }}>
        {label}
      </td>
      {innings.map(i => {
        const s = scoreMap[`${i}-${half}`]
        const isCurrent = i === currentInning && half === currentHalf
        return (
          <td key={i} className="w-7 text-center py-1.5"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '0.9rem',
              color: isCurrent ? 'var(--gold-dark, #b8891e)' : 'var(--navy)',
              fontWeight: isCurrent ? '700' : '400',
              background: isCurrent ? 'rgba(212,168,50,0.08)' : undefined,
            }}>
            {s ? s.runs : '·'}
          </td>
        )
      })}
      <td className="w-8 text-center py-1.5 font-bold"
        style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', color: 'var(--navy)', background: 'rgba(43,62,80,0.06)' }}>
        {totals[half].r}
      </td>
      <td className="w-7 text-center py-1.5 text-xs" style={{ color: 'var(--navy-muted)', background: 'rgba(43,62,80,0.04)' }}>{totals[half].h}</td>
      <td className="w-7 text-center py-1.5 text-xs" style={{ color: 'var(--navy-muted)', background: 'rgba(43,62,80,0.04)' }}>{totals[half].e}</td>
    </tr>
  )

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full" style={{ minWidth: innings.length * 28 + 140 }}>
          <thead>
            <tr style={{ background: 'var(--sky)', borderBottom: '1px solid var(--border)' }}>
              <th className="text-left text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 sticky left-0"
                style={{ color: 'var(--navy-muted)', background: 'var(--sky)' }}>TEAM</th>
              {innings.map(i => (
                <th key={i} className="w-7 text-center text-[10px] font-bold py-1.5"
                  style={{ color: i === currentInning ? 'var(--navy)' : 'var(--navy-muted)' }}>
                  {i}
                </th>
              ))}
              <th className="w-8 text-center text-[10px] font-bold py-1.5"
                style={{ background: 'var(--navy)', color: 'var(--gold)' }}>R</th>
              <th className="w-7 text-center text-[10px] font-bold py-1.5"
                style={{ background: 'rgba(43,62,80,0.8)', color: 'white' }}>H</th>
              <th className="w-7 text-center text-[10px] font-bold py-1.5"
                style={{ background: 'rgba(43,62,80,0.6)', color: 'white' }}>E</th>
            </tr>
          </thead>
          <tbody style={{ borderTop: '1px solid var(--border)' }}>
            {ourSide === 'home'
              ? <>{renderRow('away', 'top', awayTeam?.slice(0, 4).toUpperCase() || 'AWAY')}{renderRow('home', 'bottom', homeTeam?.slice(0, 4).toUpperCase() || 'HOME')}</>
              : <>{renderRow('away', 'top', awayTeam?.slice(0, 4).toUpperCase() || 'AWAY')}{renderRow('home', 'bottom', homeTeam?.slice(0, 4).toUpperCase() || 'HOME')}</>
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function LiveScoreboard() {
  const { gameId, slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const prevUpdatedAt = useRef(null)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      setUpdating(true)
      try {
        const result = await getScorebookState(gameId)
        if (!cancelled) {
          if (result?.state?.updated_at !== prevUpdatedAt.current) {
            prevUpdatedAt.current = result?.state?.updated_at
            setData(result)
          }
        }
      } catch {
        // silently ignore poll errors
      } finally {
        if (!cancelled) setUpdating(false)
      }
    }

    poll().then(() => setLoading(false))
    const interval = setInterval(() => {
      if (data?.state?.status !== 'final') poll()
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [gameId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingSpinner />

  if (!data) {
    return (
      <div className="py-12 text-center">
        <div className="font-display text-2xl mb-2" style={{ color: 'var(--navy)' }}>NOT STARTED</div>
        <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>Scorekeeping hasn't begun yet.</p>
        <p className="text-xs mt-3" style={{ color: 'var(--navy-muted)' }}>Page auto-updates every 5 seconds.</p>
      </div>
    )
  }

  const { state, homeLineup, awayLineup, inningScores, pitchCounts, plateAppearances } = data

  if (state.status === 'lineup') {
    return (
      <div className="py-12 text-center">
        <div className="font-display text-2xl mb-2" style={{ color: 'var(--navy)' }}>SETTING LINEUPS</div>
        <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>Game starting soon...</p>
      </div>
    )
  }

  const isFinal = state.status === 'final'
  const ourHalf = state.our_side === 'home' ? 'bottom' : 'top'
  const themHalf = state.our_side === 'home' ? 'top' : 'bottom'

  // Compute scores from inning totals
  const scoreUs = inningScores.filter(s => s.half === ourHalf).reduce((sum, s) => sum + s.runs, 0)
  const scoreThem = inningScores.filter(s => s.half === themHalf).reduce((sum, s) => sum + s.runs, 0)

  const halfLabel = state.half === 'top' ? '▲' : '▼'
  const ordinals = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH', '10TH', '11TH', '12TH']
  const inningLabel = `${halfLabel} ${ordinals[state.inning] || state.inning + 'TH'}`

  const ourTeamName = state.our_side === 'home' ? state.home_team_name : state.away_team_name
  const oppTeamName = state.our_side === 'home' ? state.away_team_name : state.home_team_name

  // Current batter from lineup
  const battingHalf = state.half
  const battingLineup = battingHalf === ourHalf ? (state.our_side === 'home' ? homeLineup : awayLineup) : (state.our_side === 'home' ? awayLineup : homeLineup)

  return (
    <div className="space-y-3 pb-4">
      <BackButton fallback={`/${slug}/game/${gameId}`} />
      {/* Status bar */}
      <div className="card px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isFinal ? (
            <span className="font-display text-base tracking-widest px-2 py-0.5 rounded text-white"
              style={{ background: 'var(--navy-muted, #6b7c8d)' }}>FINAL</span>
          ) : (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inset-0 rounded-full animate-ping opacity-75"
                  style={{ background: 'var(--win)' }} />
                <span className="relative rounded-full h-2.5 w-2.5"
                  style={{ background: 'var(--win)' }} />
              </span>
              <span className="font-display text-base tracking-widest" style={{ color: 'var(--win)' }}>LIVE</span>
            </>
          )}
        </div>
        {!isFinal && (
          <span className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
            style={{ color: 'var(--navy-muted)' }}>
            {updating && <span className="diamond-spin inline-block w-3 h-3 opacity-60" style={{ borderTop: '2px solid var(--navy-muted)', borderRadius: '50%' }} />}
            auto-updating
          </span>
        )}
      </div>

      {/* Score banner */}
      <div className="rounded-2xl overflow-hidden shadow-md" style={{ background: 'var(--navy)' }}>
        <div className="flex justify-between items-center px-5 pt-4 pb-1">
          <span className="font-display text-sm tracking-widest text-white opacity-70">{ourTeamName || 'HOME'}</span>
          <span className="text-white opacity-30 text-xs font-semibold">VS</span>
          <span className="font-display text-sm tracking-widest text-white opacity-70">{oppTeamName || 'AWAY'}</span>
        </div>
        <div className="flex justify-center items-baseline gap-6 pb-3 px-4">
          <span className="font-display leading-none" style={{ fontSize: '4.5rem', color: 'white' }}>{scoreUs}</span>
          <span className="font-display text-2xl opacity-30 text-white">—</span>
          <span className="font-display leading-none" style={{ fontSize: '4.5rem', color: 'white' }}>{scoreThem}</span>
        </div>
        <div className="stitch-line opacity-20" />
        {!isFinal && (
          <div className="flex items-center justify-center gap-4 px-4 py-2.5 text-xs font-semibold">
            <span style={{ color: 'var(--gold)' }}>{inningLabel}</span>
            <OutsDots count={state.outs} />
            <span className="text-white opacity-50">{state.outs} OUT{state.outs !== 1 ? 'S' : ''}</span>
            <span className="text-white opacity-30">·</span>
            <span style={{ color: 'var(--powder)' }}>{state.balls}-{state.strikes} COUNT</span>
          </div>
        )}
      </div>

      {/* Line score */}
      <InningScoreGrid
        inningScores={inningScores}
        currentInning={state.inning}
        currentHalf={state.half}
        homeTeam={state.home_team_name}
        awayTeam={state.away_team_name}
        ourSide={state.our_side}
      />

      {/* Situation + Diamond */}
      {!isFinal && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4 flex flex-col justify-center gap-3">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--navy-muted)' }}>SITUATION</div>
            <div className="font-display text-xl" style={{ color: 'var(--navy)' }}>{inningLabel}</div>
            <OutsDots count={state.outs} />
            <div className="text-xs font-semibold" style={{ color: 'var(--navy-muted)' }}>{state.outs} OUT{state.outs !== 1 ? 'S' : ''}</div>
            <div className="text-sm font-bold" style={{ color: 'var(--navy)' }}>
              COUNT: <span style={{ color: 'var(--win)' }}>{state.balls}</span>-<span style={{ color: 'var(--loss)' }}>{state.strikes}</span>
            </div>
          </div>
          <div className="card p-4 flex flex-col items-center justify-center gap-1">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--navy-muted)' }}>ON BASE</div>
            <BasesDiamond
              runners={{ first: !!state.runner_1b, second: !!state.runner_2b, third: !!state.runner_3b }}
              interactive={false}
              size={120}
            />
          </div>
        </div>
      )}

      {/* Current at bat */}
      {!isFinal && state.runner_1b === undefined && (
        null
      )}
      {!isFinal && (
        <div className="card px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--navy-muted)' }}>AT BAT</div>
          {battingLineup.length > 0 ? (
            <div className="flex items-center gap-3">
              <span className="font-display text-2xl" style={{ color: 'var(--navy)' }}>
                {battingLineup[0]?.jersey_number ? `#${battingLineup[0].jersey_number}` : ''}
              </span>
              <span className="font-semibold text-base" style={{ color: 'var(--navy)' }}>
                {battingLineup[0]?.player_name || '—'}
              </span>
              <span className="text-xs" style={{ color: 'var(--navy-muted)' }}>{battingLineup[0]?.position || ''}</span>
            </div>
          ) : (
            <div className="text-sm" style={{ color: 'var(--navy-muted)' }}>Lineup pending</div>
          )}
          {pitchCounts.length > 0 && (
            <div className="mt-2 text-xs" style={{ color: 'var(--navy-muted)' }}>
              Pitching: {pitchCounts[0]?.pitcher_name} · {pitchCounts[0]?.total_pitches} pitches
            </div>
          )}
        </div>
      )}

      {/* Recent plays */}
      {plateAppearances.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="section-label">RECENT PLAYS</span>
          </div>
          <div>
            {[...plateAppearances].reverse().slice(0, 5).map((pa, i) => (
              <div key={pa.id} className="flex items-center gap-3 px-4 py-2.5"
                style={{ background: i % 2 === 0 ? 'var(--sky)' : 'var(--cream)', borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs font-bold w-16 truncate" style={{ color: 'var(--navy-muted)' }}>
                  {pa.player_name.split(' ').pop()}
                </span>
                <span className="text-xs flex-1" style={{ color: 'var(--navy-muted)' }}>
                  {ordinals[pa.inning] || pa.inning} Inn.
                </span>
                {pa.outcome ? (
                  <span className="font-display text-sm px-2 py-0.5 rounded text-white min-w-[36px] text-center"
                    style={{ background: outcomeColor(pa.outcome) }}>
                    {pa.outcome}
                  </span>
                ) : (
                  <span className="text-xs italic" style={{ color: 'var(--navy-muted)' }}>in progress</span>
                )}
                {pa.rbi > 0 && (
                  <span className="text-[10px] font-bold" style={{ color: 'var(--gold-dark, #b8891e)' }}>{pa.rbi} RBI</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live pitch counts */}
      {pitchCounts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="section-label">LIVE PITCH COUNTS</span>
          </div>
          <div className="px-4 py-2 space-y-2">
            {pitchCounts.map(pc => {
              const pct = Math.min(pc.total_pitches / 95, 1)
              const severity = pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warning' : 'ok'
              const sideLabel = pc.pitcher_team_side === state.our_side
                ? (state.our_side === 'home' ? state.home_team_name : state.away_team_name)
                : (state.our_side === 'home' ? state.away_team_name : state.home_team_name)
              return (
                <div key={`${pc.pitcher_name}-${pc.pitcher_team_side}`} className="py-1">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-semibold" style={{ color: 'var(--navy)' }}>
                      {pc.pitcher_name}
                      <span className="text-[10px] font-normal ml-1.5" style={{ color: 'var(--navy-muted)' }}>
                        ({sideLabel?.slice(0, 8) || pc.pitcher_team_side})
                      </span>
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--navy)' }}>{pc.total_pitches} / 95</span>
                  </div>
                  <div className="pitch-bar">
                    <div className={`pitch-bar-fill pitch-bar-${severity}`} style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Final link */}
      {isFinal && (
        <Link to=".." relative="path" className="card flex items-center gap-3 px-4 py-3 no-underline">
          <span className="font-display text-base" style={{ color: 'var(--navy)' }}>VIEW GAME DETAILS</span>
          <svg className="ml-auto w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      )}
    </div>
  )
}
