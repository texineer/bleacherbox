import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTeamBySlug } from '../api'
import { useAuth } from '../context/AuthContext'
import WalkupSongManager from '../components/WalkupSongManager'
import LoadingSpinner from '../components/LoadingSpinner'

const PG_BASE = 'https://www.perfectgame.org'
const DEFAULT_FT_BASE = 'https://play.fivetoolyouth.org'

export default function Roster() {
  const { slug } = useParams()
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const { user, hasTeamRole } = useAuth()

  useEffect(() => {
    getTeamBySlug(slug)
      .then(setTeam)
      .catch(() => setTeam(null))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <LoadingSpinner />
  if (!team) return (
    <div className="text-center py-12">
      <div className="font-display text-xl" style={{ color: 'var(--navy-muted)' }}>TEAM NOT FOUND</div>
    </div>
  )

  const canEdit = user && hasTeamRole(team.pg_org_id, team.pg_team_id, ['admin', 'scorekeeper'])
  const pgUrl = `${PG_BASE}/PGBA/Team/default.aspx?orgid=${team.pg_org_id}&orgteamid=${team.pg_team_id}`
  const ftUrl = team.ft_team_uuid && team.ft_seasons
    ? `${team.ft_base_url || DEFAULT_FT_BASE}/team/details/${team.ft_seasons.split(',')[0]}/${team.ft_team_uuid}`
    : null

  return (
    <div className="space-y-4">
      {/* Back */}
      <Link to={`/${slug}`} className="inline-flex items-center gap-1 text-xs font-semibold no-underline" style={{ color: 'var(--navy-muted)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        Home
      </Link>

      {/* Header */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3" style={{ background: 'var(--navy)' }}>
          <div className="flex items-center gap-3">
            <img src={team.logo_url || '/yardbirds-logo.png'} alt="" className="w-10 h-10 object-contain" />
            <div>
              <div className="font-display text-xl text-white tracking-wider">{(team.name || slug).toUpperCase()}</div>
              <div className="flex gap-2 mt-0.5">
                {team.age_group && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(212,168,50,0.3)', color: 'var(--gold)' }}>{team.age_group}</span>
                )}
                {team.hometown && (
                  <span className="text-[10px] text-white/50">{team.hometown}</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="stitch-line" />

        {/* Source links */}
        <div className="flex gap-2 p-3">
          <a href={pgUrl} target="_blank" rel="noopener"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider no-underline"
            style={{ background: 'var(--navy)', color: 'white' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
            Perfect Game
          </a>
          {ftUrl && (
            <a href={ftUrl} target="_blank" rel="noopener"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider no-underline"
              style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
              Five Tool
            </a>
          )}
        </div>
      </div>

      {/* Roster count */}
      <div className="flex items-center justify-between">
        <div className="section-label">ROSTER ({team.players?.length || 0})</div>
      </div>

      {/* Players */}
      {team.players?.length > 0 ? (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border)' }}>
          {team.players.map((p, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-lg flex-shrink-0"
                  style={{ background: 'var(--navy)', color: 'white' }}>
                  {p.number || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold" style={{ color: 'var(--navy)' }}>{p.name}</div>
                  <div className="flex flex-wrap gap-2 mt-0.5">
                    {p.position && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--powder-pale)', color: 'var(--navy)' }}>{p.position}</span>
                    )}
                    {(p.bats || p.throws) && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--sky)', color: 'var(--navy-muted)' }}>B/T: {p.bats}/{p.throws}</span>
                    )}
                    {p.grad_year && (
                      <span className="text-[10px]" style={{ color: 'var(--navy-muted)' }}>Class of {p.grad_year}</span>
                    )}
                    {p.height && (
                      <span className="text-[10px]" style={{ color: 'var(--navy-muted)' }}>{p.height}</span>
                    )}
                  </div>
                  <WalkupSongManager
                    orgId={team.pg_org_id}
                    teamId={team.pg_team_id}
                    playerName={p.name}
                    playerNumber={p.number}
                    canEdit={canEdit}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-6 text-center">
          <div className="font-display text-xl mb-1" style={{ color: 'var(--navy-muted)' }}>NO ROSTER DATA</div>
          <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>Tap Refresh All on the home page to load roster data from Perfect Game.</p>
        </div>
      )}
    </div>
  )
}
