import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getLastTeam } from '../lastTeam'

// Which tab a path belongs to, so the tab stays highlighted on drill-down pages
// (a game, a tournament, the roster all count as Home).
function activeTab(pathname, slug) {
  if (pathname === '/teams') return 'teams'
  if (['/account', '/admin', '/login'].includes(pathname)) return 'account'
  if (!slug) return null
  if (pathname.startsWith(`/${slug}/stream`)) return 'stream'
  if (pathname.startsWith(`/${slug}/members`)) return 'members'
  if (pathname === `/${slug}` || pathname.startsWith(`/${slug}/`)) return 'home'
  return null
}

// The app's bottom tab bar, shown on every main screen. `slug` is the team being
// viewed; elsewhere the tabs point at the team the user last opened.
export default function BottomNav({ slug: teamSlug }) {
  const { pathname } = useLocation()
  const { user, roles, isGlobalAdmin } = useAuth()
  const slug = teamSlug || getLastTeam() || roles[0]?.slug || null
  const isTeamAdmin = isGlobalAdmin || roles.some(r => r.slug === slug && r.role === 'admin')

  const tabs = [
    ...(slug ? [
      { key: 'home', path: `/${slug}`, label: 'Home', icon: HomeIcon },
      { key: 'stream', path: `/${slug}/stream`, label: 'Stream', icon: StreamIcon },
    ] : []),
    { key: 'teams', path: '/teams', label: 'Teams', icon: TeamsIcon },
    ...(slug && user && isTeamAdmin ? [{ key: 'members', path: `/${slug}/members`, label: 'Members', icon: MembersIcon }] : []),
    user
      ? { key: 'account', path: '/account', label: 'Account', icon: AccountIcon }
      : { key: 'account', path: '/login', label: 'Sign In', icon: AccountIcon },
  ]
  const active = activeTab(pathname, slug)

  return (
    <nav className="bg-white border-t-2 px-2 pb-[env(safe-area-inset-bottom)] sticky bottom-0 z-50" style={{ borderColor: 'var(--border)' }}>
      <div className="flex justify-around max-w-md mx-auto">
        {tabs.map(tab => {
          const isActive = tab.key === active
          const Icon = tab.icon
          return (
            <Link
              key={tab.key}
              to={tab.path}
              className={`flex-1 flex flex-col items-center py-2.5 no-underline transition-colors ${
                isActive ? 'nav-active' : 'text-[var(--navy-muted)] opacity-50'
              }`}
            >
              <Icon active={isActive} />
              <span className="text-[10px] font-semibold mt-1 tracking-wide uppercase">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function NavIcon({ active, children }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--gold-dark)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

function HomeIcon({ active }) {
  return (
    <NavIcon active={active}>
      <path d="M3 12l9-8 9 8" /><path d="M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9" />
    </NavIcon>
  )
}

function StreamIcon({ active }) {
  return (
    <NavIcon active={active}>
      <circle cx="12" cy="12" r="2" />
      <path d="M4.93 4.93a10 10 0 000 14.14M19.07 4.93a10 10 0 010 14.14" />
      <path d="M7.76 7.76a6 6 0 000 8.49M16.24 7.76a6 6 0 010 8.49" />
    </NavIcon>
  )
}

function TeamsIcon({ active }) {
  return (
    <NavIcon active={active}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
    </NavIcon>
  )
}

function MembersIcon({ active }) {
  return (
    <NavIcon active={active}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </NavIcon>
  )
}

function AccountIcon({ active }) {
  return (
    <NavIcon active={active}>
      <circle cx="12" cy="8" r="4" /><path d="M4 21v-1a8 8 0 0116 0v1" />
    </NavIcon>
  )
}
