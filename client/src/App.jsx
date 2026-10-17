import { useState, useEffect } from 'react'
import { Routes, Route, Link, Navigate, Outlet, useParams } from 'react-router-dom'
import { getTeamBySlug } from './api'
import Dashboard from './pages/Dashboard'
import Schedule from './pages/Schedule'
import GameDetail from './pages/GameDetail'
import PitchingReport from './pages/PitchingReport'
import TournamentSchedule from './pages/TournamentSchedule'
import TournamentBracket from './pages/TournamentBracket'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Account from './pages/Account'
import Admin from './pages/Admin'
import Teams from './pages/Teams'
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
import BottomNav from './components/BottomNav'
import ScrollManager from './components/ScrollManager'
import { setLastTeam } from './lastTeam'
import { ENABLED } from './features'

function App() {
  return (
    <div className="flex flex-col min-h-dvh">
      <ScrollManager />
      <Routes>
        {/* Sign-in screens — no bottom menu */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/score" element={<ScoreGame />} />
        {/* App screens outside a team — with the bottom menu */}
        <Route element={<WithBottomNav />}>
          <Route path="/teams" element={<Teams />} />
          <Route path="/account" element={<Account />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/features" element={<Features />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
        </Route>
        {/* Team pages — with header and bottom menu */}
        <Route path="/:slug/*" element={<TeamLayout />} />
      </Routes>
    </div>
  )
}

function WithBottomNav() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}

function TeamLayout() {
  const { slug } = useParams()
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getTeamBySlug(slug)
      .then(t => { setTeam(t); setLastTeam(t.slug) })
      .catch(() => setTeam(null))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="flex-1"><LoadingSpinner /></div>
  if (!team) return (
    <>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center py-16">
          <div className="font-display text-3xl" style={{ color: 'var(--navy)' }}>TEAM NOT FOUND</div>
          <p className="text-sm mt-2" style={{ color: 'var(--navy-muted)' }}>"{slug}" doesn't exist yet.</p>
          <Link to="/teams" className="inline-block mt-4 text-sm font-bold no-underline" style={{ color: 'var(--gold-dark)' }}>
            See all teams
          </Link>
        </div>
      </div>
      <BottomNav />
    </>
  )

  return (
    <>
      {/* Header */}
      <header className="relative overflow-hidden" style={{ background: 'var(--navy)' }}>
        <div className="safe-top-spacer" />
        <div className="relative px-4 py-3 flex items-center justify-between">
          <Link to={`/${slug}`} className="no-underline flex-shrink-0">
            <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-12 object-contain" />
          </Link>
          <Link to="/features" className="text-[10px] font-bold uppercase tracking-wider no-underline px-2 py-1 rounded flex-shrink-0"
            style={{ color: 'var(--gold)', background: 'rgba(255,255,255,0.08)' }}>
            Features
          </Link>
        </div>

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

      <BottomNav slug={slug} />
    </>
  )
}

export default App
