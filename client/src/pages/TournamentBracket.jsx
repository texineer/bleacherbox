import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTournamentBracket } from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import BackButton from '../components/BackButton'

const PG_BASE = 'https://www.perfectgame.org'

export default function TournamentBracket() {
  const { eventId, slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState(0)

  useEffect(() => {
    getTournamentBracket(eventId)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [eventId])

  if (loading) return <LoadingSpinner />

  const tournament = data?.tournament
  const brackets = data?.brackets || []
  const hasBrackets = brackets.length > 0 && brackets.some(b => b.games?.length > 0)
  const activeBracket = brackets[activeTab] || brackets[0]

  return (
    <div className="space-y-4">
      <BackButton fallback={`/${slug}`} />

      <div>
        <h1 className="font-display text-3xl" style={{ color: 'var(--navy)' }}>BRACKET</h1>
        {tournament && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--navy-muted)' }}>{tournament.name}</p>
        )}
      </div>

      {error && (
        <div className="text-sm font-semibold py-2 px-3 rounded-lg" style={{ color: 'var(--loss)', background: 'var(--loss-bg)' }}>{error}</div>
      )}

      {!hasBrackets ? (
        <div className="space-y-4">
          <div className="card p-6 text-center">
            <div className="font-display text-xl mb-2" style={{ color: 'var(--navy-muted)' }}>NO BRACKETS YET</div>
            <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>
              Brackets will appear after pool play is complete.
            </p>
          </div>
          <a href={`${PG_BASE}/events/Brackets.aspx?event=${eventId}`} target="_blank" rel="noopener"
            className="card block no-underline p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--gold)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--navy)" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4v6h4M4 7h8v5M20 4v6h-4M20 7h-8v5M8 17v3h8v-3"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm" style={{ color: 'var(--navy)' }}>View on Perfect Game</div>
              </div>
              <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: 'var(--gold)', color: 'var(--navy)' }}>Open</span>
            </div>
          </a>
        </div>
      ) : (
        <>
          {/* Bracket tabs */}
          {brackets.length > 1 && (
            <div className="flex rounded-xl overflow-hidden border-2 p-0.5 gap-0.5"
              style={{ borderColor: 'var(--border)', background: 'var(--sky)' }}>
              {brackets.map((b, i) => (
                <button key={i}
                  className="flex-1 py-2 rounded-lg font-display text-sm tracking-wider transition-all"
                  style={{
                    background: activeTab === i ? 'var(--navy)' : 'transparent',
                    color: activeTab === i ? 'white' : 'var(--navy-muted)',
                  }}
                  onClick={() => setActiveTab(i)}>
                  {b.name?.replace(/^\d+U\s+(?:OPEN\s+)?/i, '').replace(/\s+BRACKET$/i, '') || `Bracket ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Visual bracket */}
          {activeBracket && <BracketDiagram games={activeBracket.games} name={activeBracket.name} />}

          {/* PG link */}
          <a href={`${PG_BASE}/events/Brackets.aspx?event=${eventId}`} target="_blank" rel="noopener"
            className="block text-center text-xs font-bold no-underline py-2" style={{ color: 'var(--navy-muted)' }}>
            View on PerfectGame.org
          </a>
        </>
      )}
    </div>
  )
}

// ── Visual Bracket Diagram ────────────────────────────────────────────────────

function BracketDiagram({ games, name }) {
  if (!games || games.length === 0) return null

  // Group by round
  const roundMap = {}
  for (const g of games) {
    const round = g.round || g.bracket_round || 'Game'
    if (!roundMap[round]) roundMap[round] = []
    roundMap[round].push(g)
  }

  const roundOrder = ['Quarterfinal', 'Semifinal', 'Final', 'Game']
  const rounds = Object.entries(roundMap)
    .sort(([a], [b]) => {
      const ai = roundOrder.indexOf(a)
      const bi = roundOrder.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    .map(([name, games]) => ({ name, games }))

  // Layout constants
  const MATCHUP_W = 200
  const MATCHUP_H = 72
  const COL_GAP = 40
  const ROW_GAP = 16

  // Calculate total height based on first round
  const firstRound = rounds[0]
  const firstRoundCount = firstRound?.games.length || 1
  const totalH = firstRoundCount * (MATCHUP_H + ROW_GAP) - ROW_GAP + 40
  const totalW = rounds.length * (MATCHUP_W + COL_GAP) - COL_GAP + 20

  return (
    <div>
      <div className="section-label mb-2">{name}</div>
      <div className="overflow-x-auto -mx-4 px-4 pb-2">
        <svg width={totalW} height={totalH} viewBox={`0 0 ${totalW} ${totalH}`}
          style={{ minWidth: totalW, display: 'block' }}>

          {rounds.map((round, colIdx) => {
            const x = colIdx * (MATCHUP_W + COL_GAP) + 10
            // Vertical spacing increases per round (bracket convergence)
            const gamesInCol = round.games.length
            const colHeight = totalH - 40
            const spacing = gamesInCol > 1 ? colHeight / gamesInCol : 0
            const startY = gamesInCol > 1 ? (colHeight - (gamesInCol - 1) * spacing) / 2 + 20 : totalH / 2 - MATCHUP_H / 2

            return (
              <g key={colIdx}>
                {/* Round label */}
                <text x={x + MATCHUP_W / 2} y={14} textAnchor="middle"
                  fill="var(--gold-dark, #b8891e)" fontSize="10" fontWeight="700"
                  fontFamily="'Bebas Neue', sans-serif" letterSpacing="0.15em">
                  {round.name === 'Final' ? 'CHAMPIONSHIP' : round.name.toUpperCase()}
                </text>

                {round.games.map((game, gameIdx) => {
                  const y = gamesInCol > 1 ? startY + gameIdx * spacing : startY

                  const home = game.homeTeam || { name: game.opponent_name?.split(' vs ')[0] || '?', seed: game.home_seed, score: game.score_us }
                  const away = game.awayTeam || { name: game.opponent_name?.split(' vs ')[1] || '?', seed: game.away_seed, score: game.score_them }
                  const homeWon = home.score != null && away.score != null && home.score > away.score
                  const awayWon = home.score != null && away.score != null && away.score > home.score
                  const isFinal = round.name === 'Final'
                  const gameTime = game.gameTime || game.game_time || ''

                  // Draw connector lines to next round
                  const nextRound = rounds[colIdx + 1]
                  if (nextRound && gameIdx % 2 === 0) {
                    const nextGameIdx = Math.floor(gameIdx / 2)
                    const nextGamesInCol = nextRound.games.length
                    const nextSpacing = nextGamesInCol > 1 ? colHeight / nextGamesInCol : 0
                    const nextStartY = nextGamesInCol > 1 ? (colHeight - (nextGamesInCol - 1) * nextSpacing) / 2 + 20 : totalH / 2 - MATCHUP_H / 2
                    const nextY = nextGamesInCol > 1 ? nextStartY + nextGameIdx * nextSpacing : nextStartY

                    const midX = x + MATCHUP_W + COL_GAP / 2
                    const y1 = y + MATCHUP_H / 2
                    const y2Top = gameIdx < round.games.length - 1
                      ? (gamesInCol > 1 ? startY + (gameIdx + 1) * spacing : startY) + MATCHUP_H / 2
                      : y1
                    const nextMidY = nextY + MATCHUP_H / 2

                    return (
                      <g key={`line-${colIdx}-${gameIdx}`}>
                        {/* Line from this matchup right */}
                        <line x1={x + MATCHUP_W} y1={y1} x2={midX} y2={y1} stroke="var(--border)" strokeWidth="1.5" />
                        {/* Line from next matchup (below) right */}
                        {y2Top !== y1 && (
                          <line x1={x + MATCHUP_W} y1={y2Top} x2={midX} y2={y2Top} stroke="var(--border)" strokeWidth="1.5" />
                        )}
                        {/* Vertical connector */}
                        {y2Top !== y1 && (
                          <line x1={midX} y1={y1} x2={midX} y2={y2Top} stroke="var(--border)" strokeWidth="1.5" />
                        )}
                        {/* Line to next round */}
                        <line x1={midX} y1={nextMidY} x2={x + MATCHUP_W + COL_GAP} y2={nextMidY} stroke="var(--border)" strokeWidth="1.5" />
                      </g>
                    )
                  }

                  return null
                })}

                {/* Matchup boxes */}
                {round.games.map((game, gameIdx) => {
                  const y = gamesInCol > 1 ? startY + gameIdx * spacing : startY

                  const home = game.homeTeam || { name: game.opponent_name?.split(' vs ')[0] || '?', seed: game.home_seed, score: game.score_us }
                  const away = game.awayTeam || { name: game.opponent_name?.split(' vs ')[1] || '?', seed: game.away_seed, score: game.score_them }
                  const homeWon = home.score != null && away.score != null && home.score > away.score
                  const awayWon = home.score != null && away.score != null && away.score > home.score
                  const isFinal = round.name === 'Final'
                  const gameTime = game.gameTime || game.game_time || ''

                  return (
                    <g key={`matchup-${colIdx}-${gameIdx}`}>
                      {/* Box background */}
                      <rect x={x} y={y} width={MATCHUP_W} height={MATCHUP_H} rx="6"
                        fill="white" stroke={isFinal ? 'var(--gold, #D4A832)' : 'var(--border, #D8E4EC)'}
                        strokeWidth={isFinal ? 2 : 1} />

                      {/* Time bar */}
                      <rect x={x} y={y} width={MATCHUP_W} height={16} rx="6" fill="var(--sky, #F2F7FA)" />
                      <rect x={x} y={y + 10} width={MATCHUP_W} height={6} fill="var(--sky, #F2F7FA)" />
                      <text x={x + 6} y={y + 11} fontSize="8" fontWeight="700" fill="var(--navy-muted, #5A7A92)"
                        fontFamily="'DM Sans', sans-serif">
                        {gameTime || '—'}
                      </text>

                      {/* Home team row */}
                      <line x1={x} y1={y + 16} x2={x + MATCHUP_W} y2={y + 16} stroke="var(--border, #D8E4EC)" strokeWidth="0.5" />
                      {home.seed && (
                        <circle cx={x + 14} cy={y + 30} r="8" fill="var(--navy, #2B3E50)" />
                      )}
                      {home.seed && (
                        <text x={x + 14} y={y + 33} textAnchor="middle" fontSize="8" fontWeight="700" fill="white"
                          fontFamily="'DM Sans', sans-serif">{home.seed}</text>
                      )}
                      <text x={x + (home.seed ? 28 : 8)} y={y + 33}
                        fontSize="10" fontWeight={homeWon ? '700' : '500'}
                        fill={homeWon ? 'var(--win, #1B7340)' : 'var(--navy, #2B3E50)'}
                        fontFamily="'DM Sans', sans-serif"
                        clipPath={`rect(${x},${y+16},${MATCHUP_W - 30},${MATCHUP_H})`}>
                        {truncate(home.name, 18)}
                      </text>
                      <text x={x + MATCHUP_W - 8} y={y + 34} textAnchor="end"
                        fontSize="14" fontWeight="700"
                        fill={homeWon ? 'var(--win, #1B7340)' : 'var(--navy, #2B3E50)'}
                        fontFamily="'Bebas Neue', sans-serif"
                        opacity={homeWon ? 1 : 0.5}>
                        {home.score ?? '—'}
                      </text>

                      {/* Divider */}
                      <line x1={x + 4} y1={y + 44} x2={x + MATCHUP_W - 4} y2={y + 44} stroke="var(--border, #D8E4EC)" strokeWidth="0.5" />

                      {/* Away team row */}
                      {away.seed && (
                        <circle cx={x + 14} cy={y + 58} r="8" fill="var(--navy-muted, #5A7A92)" />
                      )}
                      {away.seed && (
                        <text x={x + 14} y={y + 61} textAnchor="middle" fontSize="8" fontWeight="700" fill="white"
                          fontFamily="'DM Sans', sans-serif">{away.seed}</text>
                      )}
                      <text x={x + (away.seed ? 28 : 8)} y={y + 61}
                        fontSize="10" fontWeight={awayWon ? '700' : '500'}
                        fill={awayWon ? 'var(--win, #1B7340)' : 'var(--navy, #2B3E50)'}
                        fontFamily="'DM Sans', sans-serif">
                        {truncate(away.name, 18)}
                      </text>
                      <text x={x + MATCHUP_W - 8} y={y + 62} textAnchor="end"
                        fontSize="14" fontWeight="700"
                        fill={awayWon ? 'var(--win, #1B7340)' : 'var(--navy, #2B3E50)'}
                        fontFamily="'Bebas Neue', sans-serif"
                        opacity={awayWon ? 1 : 0.5}>
                        {away.score ?? '—'}
                      </text>

                      {/* Championship label */}
                      {isFinal && (homeWon || awayWon) && (
                        <>
                          <rect x={x + MATCHUP_W / 2 - 30} y={y + MATCHUP_H - 2} width={60} height={14} rx="3"
                            fill="var(--gold, #D4A832)" />
                          <text x={x + MATCHUP_W / 2} y={y + MATCHUP_H + 9} textAnchor="middle"
                            fontSize="7" fontWeight="700" fill="var(--navy, #2B3E50)"
                            fontFamily="'Bebas Neue', sans-serif" letterSpacing="0.1em">
                            CHAMPION
                          </text>
                        </>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function truncate(str, len) {
  if (!str) return '?'
  return str.length > len ? str.slice(0, len - 1) + '...' : str
}
