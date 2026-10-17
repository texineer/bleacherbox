import { Link, useParams } from 'react-router-dom'

export default function GameCard({ game, highlight, index = 0 }) {
  const { slug } = useParams()
  const isWin = game.result === 'W'
  const isLoss = game.result === 'L'
  const hasResult = !!game.result

  const borderColor = highlight ? 'var(--gold)' :
                      isWin ? 'var(--win)' :
                      isLoss ? 'var(--loss)' :
                      'var(--powder-light)'

  const resultBg = isWin ? 'var(--win)' : isLoss ? 'var(--loss)' : 'var(--navy-muted)'

  return (
    <div
      className="card-enter card overflow-hidden"
      style={{
        animationDelay: `${index * 60}ms`,
        borderLeftWidth: '3px',
        borderLeftColor: borderColor,
      }}
    >
      <Link
        to={`/${slug}/game/${game.id}`}
        className="flex items-stretch no-underline"
      >
        {/* Main content */}
        <div className="flex-1 px-4 py-3 min-w-0">
          <div className="flex items-center gap-2">
            {game.scoring_status === 'live' && (
              <span className="flex items-center gap-1 font-display text-xs px-1.5 py-0.5 rounded text-white leading-none"
                style={{ background: 'var(--win)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-ping opacity-80" />
                LIVE
              </span>
            )}
            {hasResult && (
              <span
                className="font-display text-sm px-1.5 py-0.5 rounded text-white leading-none"
                style={{ background: resultBg }}
              >
                {game.result}
              </span>
            )}
            <span className="font-semibold text-[var(--navy)] truncate text-[0.95rem]">
              vs {game.opponent_name || 'TBD'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-2 mt-1.5 text-xs" style={{ color: 'var(--navy-muted)' }}>
            {game.game_date && <span>{formatDate(game.game_date)}</span>}
            {game.game_time && <span>{game.game_time}</span>}
            {game.field && <span className="truncate max-w-[180px]">{game.field}</span>}
          </div>
        </div>

        {/* Right side: score */}
        <div className="flex items-center gap-2 px-4">
          {/* Score */}
          {hasResult && game.score_us != null && (
            <div className="score-reveal font-display text-2xl tracking-wide" style={{ color: 'var(--navy)' }}>
              {game.score_us}<span className="opacity-30 mx-0.5">-</span>{game.score_them}
            </div>
          )}

          {/* Arrow for upcoming */}
          {!hasResult && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="var(--gold)" strokeWidth="2" strokeLinecap="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          )}
        </div>
      </Link>

      {/* Pitch Counts button row */}
      {hasResult && (
        <Link
          to={`/${slug}/game/${game.id}`}
          className="flex items-center justify-between px-4 py-2 no-underline border-t"
          style={{ borderColor: 'var(--border)', background: 'var(--sky)' }}
        >
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--navy-muted)' }}>
              Pitch Counts
            </span>
          </div>
          {game.totalPitches > 0 && (
            <span className="font-display text-sm" style={{ color: 'var(--navy)' }}>
              {game.totalPitches} total
            </span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--navy-muted)" strokeWidth="2" strokeLinecap="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      )}

      {/* Highlight accent bar */}
      {highlight && (
        <div className="h-0.5" style={{ background: 'linear-gradient(90deg, var(--gold), var(--powder), transparent)' }} />
      )}
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
