import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getGame, getTeamBySlug, getTeams, initScorebookGame, saveLineup, startScorebookGame } from '../api'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import LoadingSpinner from '../components/LoadingSpinner'

const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH']

function buildLineupFromRoster(players) {
  // Pre-fill lineup with all roster players (up to roster size)
  return players.map(p => ({
    playerName: p.name,
    jerseyNumber: p.number || '',
    position: p.position || '',
  }))
}

export default function LineupSetup() {
  const { gameId, slug } = useParams()
  const navigate = useNavigate()
  const { user, hasTeamRole, loading: authLoading } = useAuth()
  const [game, setGame] = useState(null)
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('our')
  const [ourSide, setOurSide] = useState('home')
  const [saving, setSaving] = useState(false)
  const [opponentTeam, setOpponentTeam] = useState(null)

  const [homeLineup, setHomeLineup] = useState([])
  const [awayLineup, setAwayLineup] = useState([])
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    Promise.all([
      getGame(gameId).catch(() => null),
      getTeamBySlug(slug).catch(() => null),
      getTeams().catch(() => []),
    ]).then(([g, t, allTeams]) => {
      setGame(g)
      setTeam(t)
      if (g?.opponent_name && allTeams.length) {
        const oppTeam = allTeams.find(at => at.name === g.opponent_name)
        if (oppTeam?.slug) {
          getTeamBySlug(oppTeam.slug).then(opp => {
            setOpponentTeam(opp)
            // Pre-fill away lineup with opponent roster
            if (!initialized) {
              setAwayLineup(buildLineupFromRoster(opp.players || []))
            }
          }).catch(() => {})
        }
      }
      // Pre-fill home lineup with our roster
      if (!initialized && t?.players?.length) {
        setHomeLineup(buildLineupFromRoster(t.players))
        setInitialized(true)
      }
      setLoading(false)
    })
  }, [gameId, slug])

  // Also set away lineup when opponentTeam loads (if home was set first)
  useEffect(() => {
    if (opponentTeam?.players?.length && awayLineup.length === 0) {
      setAwayLineup(buildLineupFromRoster(opponentTeam.players))
    }
  }, [opponentTeam])

  const canScore = !authLoading && user && team && hasTeamRole(team.pg_org_id, team.pg_team_id, ['admin', 'scorekeeper'])

  if (loading || authLoading) return <LoadingSpinner />

  if (!user) {
    return (
      <div className="text-center py-12">
        <div className="font-display text-2xl mb-2" style={{ color: 'var(--navy)' }}>SIGN IN REQUIRED</div>
        <p className="text-sm mb-4" style={{ color: 'var(--navy-muted)' }}>
          You need to be signed in as a scorekeeper to score this game.
        </p>
        <Link to="/login" className="inline-block font-display text-lg tracking-wider px-6 py-3 rounded-xl text-white no-underline"
          style={{ background: 'var(--navy)' }}>
          SIGN IN
        </Link>
      </div>
    )
  }

  if (!canScore) {
    return (
      <div className="text-center py-12">
        <div className="font-display text-2xl mb-2" style={{ color: 'var(--navy)' }}>ACCESS DENIED</div>
        <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>
          You need scorekeeper or admin access to score this game. Contact the team admin.
        </p>
      </div>
    )
  }

  const ourLineup = ourSide === 'home' ? homeLineup : awayLineup
  const themLineup = ourSide === 'home' ? awayLineup : homeLineup
  const ourSetter = ourSide === 'home' ? setHomeLineup : setAwayLineup
  const themSetter = ourSide === 'home' ? setAwayLineup : setHomeLineup

  const currentLineup = activeTab === 'our' ? ourLineup : themLineup
  const currentSetter = activeTab === 'our' ? ourSetter : themSetter

  const hasEnough = ourLineup.some(e => e.playerName) && themLineup.some(e => e.playerName)

  async function handleSaveAndStart() {
    setSaving(true)
    try {
      const opponentName = game?.opponent_name || 'Opponent'
      const homeTeamName = ourSide === 'home' ? (team?.name || 'Home') : opponentName
      const awayTeamName = ourSide === 'away' ? (team?.name || 'Away') : opponentName

      await initScorebookGame(parseInt(gameId), { homeTeamName, awayTeamName, ourSide })

      const homeEntries = homeLineup.filter(e => e.playerName).map((e, i) => ({ battingOrder: i + 1, ...e }))
      const awayEntries = awayLineup.filter(e => e.playerName).map((e, i) => ({ battingOrder: i + 1, ...e }))
      await saveLineup(parseInt(gameId), { teamSide: 'home', entries: homeEntries })
      await saveLineup(parseInt(gameId), { teamSide: 'away', entries: awayEntries })
      await startScorebookGame(parseInt(gameId))

      navigate(`/${slug}/game/${gameId}/score`)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <BackButton fallback={`/${slug}/game/${gameId}`} />
      {/* Header */}
      <div>
        <div className="font-display text-2xl" style={{ color: 'var(--navy)' }}>LINEUP SETUP</div>
        {game && (
          <div className="text-sm mt-0.5" style={{ color: 'var(--navy-muted)' }}>
            vs {game.opponent_name || 'Opponent'}
            {game.game_date && ` · ${formatDate(game.game_date)}`}
            {game.game_time && ` · ${game.game_time}`}
          </div>
        )}
      </div>

      {/* HOME / AWAY toggle */}
      <div className="card px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--navy-muted)' }}>
          WE ARE
        </div>
        <div className="flex rounded-xl overflow-hidden border-2 p-0.5 gap-0.5"
          style={{ borderColor: 'var(--border)', background: 'var(--sky)' }}>
          {['home', 'away'].map(side => (
            <button key={side}
              className="flex-1 py-2.5 rounded-lg font-display text-lg tracking-wider transition-all active:scale-97"
              style={{
                background: ourSide === side ? 'var(--navy)' : 'transparent',
                color: ourSide === side ? 'white' : 'var(--navy-muted)',
              }}
              onClick={() => setOurSide(side)}>
              {side.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Team Tabs */}
      <div className="flex rounded-xl overflow-hidden border-2 p-0.5 gap-0.5"
        style={{ borderColor: 'var(--border)', background: 'var(--sky)' }}>
        {['our', 'opp'].map(tab => {
          const label = tab === 'our'
            ? (team?.name?.toUpperCase() || 'OUR TEAM')
            : (game?.opponent_name?.toUpperCase() || 'OPPONENT')
          const lineup = tab === 'our' ? ourLineup : themLineup
          return (
            <button key={tab}
              className="flex-1 py-2.5 rounded-lg font-display text-base tracking-wider transition-all"
              style={{
                background: activeTab === tab ? 'var(--navy)' : 'transparent',
                color: activeTab === tab ? 'white' : 'var(--navy-muted)',
              }}
              onClick={() => setActiveTab(tab)}>
              <span className="truncate block px-1">{label}</span>
              <span className="text-[10px] opacity-70">{lineup.length} players</span>
            </button>
          )
        })}
      </div>

      {/* Draggable Lineup */}
      <div>
        <div className="section-label mb-2">BATTING ORDER — drag to reorder</div>
        <DraggableLineup lineup={currentLineup} setLineup={currentSetter} />
      </div>

      {/* Save & Start */}
      <button
        className="w-full h-14 rounded-xl font-display text-xl tracking-widest text-white transition-opacity active:scale-95"
        style={{ background: hasEnough ? 'var(--navy)' : 'var(--navy-muted)', opacity: hasEnough ? 1 : 0.5 }}
        disabled={!hasEnough || saving}
        onClick={handleSaveAndStart}>
        {saving ? 'STARTING...' : 'SAVE & START GAME'}
      </button>

      <p className="text-center text-xs" style={{ color: 'var(--navy-muted)' }}>
        All roster players are pre-loaded. Drag to set batting order. Remove players who aren't in this game.
      </p>
    </div>
  )
}

// ── Draggable Lineup ──────────────────────────────────────────────────────────

function DraggableLineup({ lineup, setLineup }) {
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const listRef = useRef(null)
  const dragStartY = useRef(0)
  const dragItemHeight = useRef(0)

  // Touch drag handlers
  function handleTouchStart(idx, e) {
    const touch = e.touches[0]
    const el = e.currentTarget
    dragStartY.current = touch.clientY
    dragItemHeight.current = el.getBoundingClientRect().height + 6 // gap
    setDragIdx(idx)
    setOverIdx(idx)
  }

  function handleTouchMove(e) {
    if (dragIdx === null) return
    e.preventDefault()
    const touch = e.touches[0]
    const diff = touch.clientY - dragStartY.current
    const slotsMoved = Math.round(diff / dragItemHeight.current)
    const newOver = Math.max(0, Math.min(lineup.length - 1, dragIdx + slotsMoved))
    setOverIdx(newOver)
  }

  function handleTouchEnd() {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      setLineup(prev => {
        const next = [...prev]
        const [item] = next.splice(dragIdx, 1)
        next.splice(overIdx, 0, item)
        return next
      })
    }
    setDragIdx(null)
    setOverIdx(null)
  }

  // Mouse drag (for desktop)
  function handleDragStart(idx) {
    setDragIdx(idx)
  }

  function handleDragOver(idx, e) {
    e.preventDefault()
    setOverIdx(idx)
  }

  function handleDrop() {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      setLineup(prev => {
        const next = [...prev]
        const [item] = next.splice(dragIdx, 1)
        next.splice(overIdx, 0, item)
        return next
      })
    }
    setDragIdx(null)
    setOverIdx(null)
  }

  function handleDragEnd() {
    setDragIdx(null)
    setOverIdx(null)
  }

  function removePlayer(idx) {
    setLineup(prev => prev.filter((_, i) => i !== idx))
  }

  // Determine where the insertion indicator should appear
  // The indicator shows BETWEEN rows — above the overIdx row if moving down, below if moving up
  const showIndicatorAt = (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) ? overIdx : null
  const indicatorAbove = dragIdx !== null && overIdx !== null && overIdx < dragIdx

  function InsertionIndicator() {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: 'var(--gold)' }} />
        <div className="flex-1 h-[3px] rounded-full" style={{ background: 'var(--gold)' }} />
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: 'var(--gold)' }} />
      </div>
    )
  }

  return (
    <div ref={listRef}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
    >
      {lineup.map((entry, idx) => {
        const isDragging = dragIdx === idx
        return (
          <div key={`${entry.playerName}-${idx}`}>
            {/* Insertion indicator ABOVE this row */}
            {showIndicatorAt === idx && indicatorAbove && <InsertionIndicator />}

            <div
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(idx, e)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onTouchStart={(e) => handleTouchStart(idx, e)}
              className="flex items-center gap-2 py-2.5 px-3 rounded-xl select-none"
              style={{
                background: isDragging ? 'rgba(212,168,50,0.25)' : 'var(--cream)',
                border: '1px solid var(--border)',
                opacity: isDragging ? 0.5 : 1,
                cursor: 'grab',
                touchAction: 'none',
                transition: 'opacity 0.15s, background 0.15s',
              }}
            >
              {/* Drag handle */}
              <span className="text-lg flex-shrink-0 select-none" style={{ color: 'var(--navy-muted)', cursor: 'grab', lineHeight: 1 }}>
                ⠿
              </span>

              {/* Order number */}
              <span className="font-display text-lg w-6 text-center flex-shrink-0"
                style={{ color: 'var(--navy)' }}>
                {idx + 1}
              </span>

              {/* Player info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--navy)' }}>
                  {entry.playerName}
                </div>
                <div className="flex gap-2 items-center">
                  {entry.jerseyNumber && (
                    <span className="text-[10px] font-bold" style={{ color: 'var(--gold-dark, #b8891e)' }}>
                      #{entry.jerseyNumber}
                    </span>
                  )}
                  {entry.position && (
                    <span className="text-[10px] font-bold" style={{ color: 'var(--navy-muted)' }}>
                      {entry.position}
                    </span>
                  )}
                </div>
              </div>

              {/* Remove */}
              <button
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs active:scale-95 flex-shrink-0"
                style={{ background: 'var(--loss-bg, #fdecea)', color: 'var(--loss)' }}
                onClick={(e) => { e.stopPropagation(); removePlayer(idx) }}
                onTouchEnd={(e) => { e.stopPropagation() }}>
                ✕
              </button>
            </div>

            {/* Insertion indicator BELOW this row */}
            {showIndicatorAt === idx && !indicatorAbove && <InsertionIndicator />}
          </div>
        )
      })}

      {lineup.length === 0 && (
        <div className="text-sm text-center py-8 italic" style={{ color: 'var(--navy-muted)' }}>
          No players loaded for this team
        </div>
      )}
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
