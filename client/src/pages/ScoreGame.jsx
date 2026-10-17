import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createGame, getTeams } from '../api'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'

export default function ScoreGame() {
  const { user, roles, isGlobalAdmin, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [selectedTeam, setSelectedTeam] = useState('')
  const [opponent, setOpponent] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [allTeams, setAllTeams] = useState(null)

  // Load all registered teams (for opponent dropdown + global admin team list)
  useEffect(() => {
    getTeams()
      .then(setAllTeams)
      .catch(() => setAllTeams([]))
  }, [])

  // Build team list: global admin sees all teams, others see their scorable teams
  const scorableTeams = isGlobalAdmin
    ? (allTeams || []).map(t => ({ pg_org_id: t.pg_org_id, pg_team_id: t.pg_team_id, slug: t.slug, team_name: t.name, age_group: t.age_group }))
    : roles.filter(r => ['admin', 'scorekeeper'].includes(r.role))

  // Auto-select if only one team
  useEffect(() => {
    if (scorableTeams.length === 1 && !selectedTeam) {
      setSelectedTeam(scorableTeams[0].slug)
    }
  }, [scorableTeams.length])

  async function handleStart(e) {
    e.preventDefault()
    if (!selectedTeam || !opponent.trim()) return
    setError('')
    setCreating(true)
    try {
      const team = scorableTeams.find(r => r.slug === selectedTeam)
      if (!team) { setError('Select a team'); setCreating(false); return }
      const { gameId } = await createGame(team.pg_org_id, team.pg_team_id, opponent.trim())
      navigate(`/${team.slug}/game/${gameId}/lineup`)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  if (authLoading) return null

  if (!user) {
    navigate('/')
    return null
  }

  const teamsLoading = allTeams === null

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="relative overflow-hidden py-10 px-6 text-center" style={{ background: 'var(--navy)' }}>
        <div className="safe-top-spacer" />
        <div className="relative z-10 max-w-lg mx-auto">
          <h1 className="font-display text-4xl text-white tracking-wider">SCORE GAME</h1>
          <p className="text-sm mt-1 font-medium" style={{ color: 'var(--gold)' }}>
            Set up a new game to score live
          </p>
        </div>
        <div className="stitch-line mt-6" />
      </header>

      <main className="flex-1 px-4 py-8 max-w-sm mx-auto w-full">
        {teamsLoading ? <LoadingSpinner /> : (
          <form onSubmit={handleStart} className="space-y-5">
            {/* Team picker */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5"
                style={{ color: 'var(--navy-muted)' }}>Your Team</label>
              {scorableTeams.length === 0 ? (
                <div className="text-sm py-3 px-4 rounded-xl" style={{ background: 'var(--sky)', color: 'var(--navy-muted)' }}>
                  No teams available. You need admin or scorekeeper access to a team.
                </div>
              ) : scorableTeams.length === 1 ? (
                <div className="h-12 px-4 rounded-xl border-2 flex items-center text-sm font-semibold"
                  style={{ borderColor: 'var(--gold)', color: 'var(--navy)', background: 'rgba(212,168,50,0.06)' }}>
                  {scorableTeams[0].team_name}
                  {scorableTeams[0].age_group && (
                    <span className="text-[10px] font-bold ml-2 px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--powder-pale)', color: 'var(--navy)' }}>
                      {scorableTeams[0].age_group}
                    </span>
                  )}
                </div>
              ) : (
                <select
                  required
                  className="w-full h-12 px-4 rounded-xl border-2 text-sm font-medium focus:outline-none appearance-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }}
                  value={selectedTeam}
                  onChange={e => setSelectedTeam(e.target.value)}>
                  <option value="">Select a team...</option>
                  {scorableTeams.map(r => (
                    <option key={r.slug} value={r.slug}>
                      {r.team_name}{r.age_group ? ` (${r.age_group})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Opponent */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5"
                style={{ color: 'var(--navy-muted)' }}>Opponent</label>
              <select
                required
                className="w-full h-12 px-4 rounded-xl border-2 text-sm font-medium focus:outline-none appearance-none"
                style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }}
                value={opponent}
                onChange={e => setOpponent(e.target.value)}>
                <option value="">Select opponent...</option>
                {(allTeams || [])
                  .filter(t => t.slug !== selectedTeam)
                  .map(t => (
                    <option key={t.slug || `${t.pg_org_id}-${t.pg_team_id}`} value={t.name}>
                      {t.name}{t.age_group ? ` (${t.age_group})` : ''}
                    </option>
                  ))}
              </select>
            </div>

            {error && (
              <div className="text-sm font-semibold text-center py-2 px-3 rounded-lg"
                style={{ color: 'var(--loss)', background: 'var(--loss-bg, #fdecea)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={creating || !selectedTeam || !opponent.trim()}
              className="w-full h-14 rounded-xl font-display text-xl tracking-widest text-white active:scale-95 transition-transform"
              style={{ background: creating || !selectedTeam || !opponent.trim() ? 'var(--navy-muted)' : 'var(--navy)' }}>
              {creating ? 'CREATING...' : 'SET UP LINEUP'}
            </button>
          </form>
        )}

        <div className="text-center mt-6">
          <button onClick={() => navigate(-1)} className="text-sm font-semibold" style={{ color: 'var(--navy-muted)' }}>
            Go back
          </button>
        </div>
      </main>

      <footer className="text-center py-4 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--navy-muted)' }}>
        BleacherBox
      </footer>
    </div>
  )
}
