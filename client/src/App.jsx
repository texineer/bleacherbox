import { useState, useEffect } from 'react'
import { Routes, Route, Link, Navigate, useLocation, useParams, useNavigate } from 'react-router-dom'
import { getTeamBySlug } from './api'
import { useAuth } from './context/AuthContext'
import Dashboard from './pages/Dashboard'
import Schedule from './pages/Schedule'
import GameDetail from './pages/GameDetail'
import PitchingReport from './pages/PitchingReport'
import TeamSearch from './pages/TeamSearch'
import TournamentSchedule from './pages/TournamentSchedule'
import TournamentBracket from './pages/TournamentBracket'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Account from './pages/Account'
import Admin from './pages/Admin'
import Features from './pages/Features'
import { PrivacyPolicy, TermsOfService } from './pages/Legal'
import ScoreGame from './pages/ScoreGame'
import LineupSetup from './pages/LineupSetup'
import Scorebook from './pages/Scorebook'
import LiveScoreboard from './pages/LiveScoreboard'
import TeamMembers from './pages/TeamMembers'
import Roster from './pages/Roster'
import BleacherBoxDJ from './pages/BleacherBoxDJ'
import Lunch from './pages/Lunch'
import BaseballCard from './pages/BaseballCard'
import Stream from './pages/Stream'
import LoadingSpinner from './components/LoadingSpinner'
import { ENABLED } from './features'

function App() {
  const location = useLocation()

  return (
    <div className="flex flex-col min-h-dvh">
      <Routes>
        {/* Landing page — no header/nav */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/features" element={<Features />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/score" element={<ScoreGame />} />
        {/* Team pages — with header/nav */}
        <Route path="/:slug/*" element={<TeamLayout />} />
      </Routes>
    </div>
  )
}

function TeamLayout() {
  const { slug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showTeamSwitcher, setShowTeamSwitcher] = useState(false)
  const { user, roles, hasTeamRole } = useAuth()

  useEffect(() => {
    setLoading(true)
    getTeamBySlug(slug)
      .then(setTeam)
      .catch(() => setTeam(null))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="flex-1"><LoadingSpinner /></div>
  if (!team) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center py-16">
        <div className="font-display text-3xl" style={{ color: 'var(--navy)' }}>TEAM NOT FOUND</div>
        <p className="text-sm mt-2" style={{ color: 'var(--navy-muted)' }}>"{slug}" doesn't exist yet.</p>
        <Link to="/" className="inline-block mt-4 text-sm font-bold no-underline" style={{ color: 'var(--gold-dark)' }}>
          Back to all teams
        </Link>
      </div>
    </div>
  )

  const isAdmin = user && hasTeamRole(team.pg_org_id, team.pg_team_id, ['admin'])
  const canScore = user && hasTeamRole(team.pg_org_id, team.pg_team_id, ['admin', 'scorekeeper'])

  const navItems = [
    { path: `/${slug}`, label: 'Home', icon: HomeIcon },
    ...(ENABLED.dj ? [{ path: `/${slug}/dj`, label: 'DJ', icon: DJIcon }] : []),
    ...(ENABLED.lunch ? [{ path: `/${slug}/lunch`, label: 'Lunch', icon: LunchIcon }] : []),
    { path: `/${slug}/stream`, label: 'Stream', icon: StreamIcon },
    ...(ENABLED.baseballCard ? [{ path: `/${slug}/baseball-card`, label: 'Card', icon: CardIcon }] : []),
    ...(isAdmin ? [{ path: `/${slug}/members`, label: 'Members', icon: MembersIcon }] : []),
    { path: `/${slug}/search`, label: 'Teams', icon: SearchIcon },
  ]

  return (
    <>
      {/* Header */}
      <header className="relative overflow-hidden" style={{ background: 'var(--navy)' }}>
        <div className="relative px-4 py-3 flex items-center justify-between">
          <Link to={`/${slug}`} className="no-underline flex-shrink-0">
            <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-12 object-contain" />
          </Link>
          {/* Features + User avatar */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Link to="/features" className="text-[10px] font-bold uppercase tracking-wider no-underline px-2 py-1 rounded"
              style={{ color: 'var(--gold)', background: 'rgba(255,255,255,0.08)' }}>
              Features
            </Link>
            {user ? (
              <Link to="/account" className="flex items-center gap-1.5 no-underline px-2 py-1 rounded"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
                  {(user.display_name || user.email).charAt(0).toUpperCase()}
                </span>
              </Link>
            ) : (
              <Link to="/login" className="text-[10px] font-bold uppercase tracking-wider no-underline px-2 py-1.5 rounded"
                style={{ color: 'var(--navy)', background: 'var(--gold)' }}>
                Sign In
              </Link>
            )}
          </div>
        </div>

        {/* Team switcher dropdown */}
        {showTeamSwitcher && roles.length > 1 && (
          <div className="px-4 pb-2">
            <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              {roles.filter(r => r.slug !== slug).map(r => (
                <button key={r.slug}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b last:border-b-0 transition-colors active:bg-white/10"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                  onClick={() => { setShowTeamSwitcher(false); navigate(`/${r.slug}`) }}>
                  <img src={r.logo_url || '/yardbirds-logo.png'} alt="" className="w-7 h-7 object-contain flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-display text-sm text-white tracking-wide truncate block">{(r.team_name || r.slug).toUpperCase()}</span>
                    {r.age_group && <span className="text-[9px] text-white/40">{r.age_group}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="stitch-line" />
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full">
        <Routes>
          <Route path="/" element={<Dashboard orgId={team.pg_org_id} teamId={team.pg_team_id} slug={slug} />} />
          <Route path="/schedule" element={<Schedule orgId={team.pg_org_id} teamId={team.pg_team_id} />} />
          <Route path="/game/:gameId" element={<GameDetail />} />
          <Route path="/game/:gameId/lineup" element={<LineupSetup />} />
          <Route path="/game/:gameId/score" element={<Scorebook />} />
          <Route path="/game/:gameId/live" element={<LiveScoreboard />} />
          <Route path="/tournament/:eventId/pitching" element={<PitchingReport />} />
          <Route path="/tournament/:eventId/schedule" element={<TournamentSchedule />} />
          <Route path="/tournament/:eventId/bracket" element={<TournamentBracket />} />
          <Route path="/search" element={<TeamSearch />} />
          <Route path="/roster" element={<Roster />} />
          {ENABLED.dj && <Route path="/dj" element={<BleacherBoxDJ orgId={team.pg_org_id} teamId={team.pg_team_id} slug={slug} />} />}
          {ENABLED.lunch && <Route path="/lunch" element={<Lunch />} />}
          <Route path="/members" element={<TeamMembers orgId={team.pg_org_id} teamId={team.pg_team_id} />} />
          {ENABLED.baseballCard && <Route path="/baseball-card" element={<BaseballCard orgId={team.pg_org_id} teamId={team.pg_team_id} />} />}
          <Route path="/stream" element={<Stream orgId={team.pg_org_id} teamId={team.pg_team_id} />} />
          {/* Hidden or unknown team pages (e.g. an old /dj link) go to the team home */}
          <Route path="*" element={<Navigate to={`/${slug}`} replace />} />
        </Routes>
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t-2 px-2 pb-[env(safe-area-inset-bottom)] sticky bottom-0 z-50" style={{ borderColor: 'var(--border)' }}>
        <div className="flex justify-around max-w-md mx-auto">
          {navItems.map(item => {
            const active = location.pathname === item.path
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center py-2.5 px-4 no-underline transition-colors ${
                  active ? 'nav-active' : 'text-[var(--navy-muted)] opacity-50'
                }`}
              >
                <Icon active={active} />
                <span className="text-[10px] font-semibold mt-1 tracking-wide uppercase">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

// Nav icons
function HomeIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l9-8 9 8" /><path d="M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9" />
    </svg>
  )
}

function CalendarIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  )
}

function SearchIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function ScoreIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
    </svg>
  )
}

function DJIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function MembersIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}

function StreamIcon({ active }) {
  const c = active ? 'var(--gold-dark)' : 'currentColor'
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M4.93 4.93a10 10 0 000 14.14M19.07 4.93a10 10 0 010 14.14" />
      <path d="M7.76 7.76a6 6 0 000 8.49M16.24 7.76a6 6 0 010 8.49" />
    </svg>
  )
}

function LunchIcon({ active }) {
  const c = active ? 'var(--gold-dark)' : 'currentColor'
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 010 8h-1" />
      <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
      <path d="M6 1v3M10 1v3M14 1v3" />
    </svg>
  )
}

function CardIcon({ active }) {
  const c = active ? 'var(--gold-dark)' : 'currentColor'
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="9" r="3" />
      <path d="M6 21v-1a6 6 0 0112 0v1" />
    </svg>
  )
}

export default App
