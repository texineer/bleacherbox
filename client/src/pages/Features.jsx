import { Link, useNavigate } from 'react-router-dom'

const FEATURES = [
  {
    icon: '📅',
    title: 'Schedule & Scores',
    description: 'See your team\'s full tournament schedule — game times, fields, opponents, and final scores — all in one place. No more digging through multiple websites.',
  },
  {
    icon: '⚾',
    title: 'Pitch Counts',
    description: 'Track how many pitches each player has thrown across tournaments. Know who\'s available to pitch and who needs rest to protect young arms.',
  },
  {
    icon: '🏆',
    title: 'Brackets & Standings',
    description: 'View tournament brackets after pool play, see matchups, seeds, and scores. Know exactly when and where your next game is.',
  },
  {
    icon: '📊',
    title: 'Perfect Game + Five Tool',
    description: 'BleacherBox pulls data from both Perfect Game and Five Tool Youth automatically. Your schedule, results, and pitch counts from both sources in one app.',
  },
  {
    icon: '🎵',
    title: 'Walkup Songs & DJ',
    description: 'Set a walkup song for each player from YouTube. The BleacherBox DJ plays the song with a stadium-style PA announcement — "Now batting, number 7, Mason Clark!"',
  },
  {
    icon: '👥',
    title: 'Team Management',
    description: 'Follow multiple teams, invite other parents, and manage who has access. Admins can control team settings and member roles.',
  },
  {
    icon: '🔄',
    title: 'Auto-Refresh',
    description: 'Game data syncs automatically every 6 hours. You can also manually refresh any tournament or hit "Refresh All" to get the latest scores and schedule changes.',
  },
  {
    icon: '📱',
    title: 'Works on Any Device',
    description: 'BleacherBox works on your phone, tablet, or laptop — no app download needed. Add it to your home screen for quick access at the ballpark.',
  },
]

const FAQ = [
  {
    q: 'How do I add my team?',
    a: 'Tap your avatar in the top right, go to your Account page, and tap "Add Team." Select your team from the list of registered teams.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Game schedules, scores, and pitch counts are pulled directly from Perfect Game (perfectgame.org) and Five Tool Youth (play.fivetoolyouth.org).',
  },
  {
    q: 'How often is data updated?',
    a: 'Automatically every 6 hours. You can also tap "Refresh" on any tournament or "Refresh All" on your team page to get the latest data immediately.',
  },
  {
    q: 'Can I follow more than one team?',
    a: 'Yes! Go to your Account page and tap "Add Team" to follow as many teams as you like. Switch between them using the dropdown in the header.',
  },
  {
    q: 'How do walkup songs work?',
    a: 'Go to the Roster page, find a player, and add a YouTube link for their walkup song. Set the start and end time for the clip. On the DJ page, tap the player to hear their announcement and song.',
  },
  {
    q: 'Is BleacherBox free?',
    a: 'Yes! BleacherBox is free for all baseball parents and families.',
  },
  {
    q: 'Who can see my team\'s information?',
    a: 'Only logged-in users who have been added to your team can see its data. Team admins control who has access.',
  },
]

export default function Features() {
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Header */}
      <header className="relative overflow-hidden py-6 px-6 text-center" style={{ background: 'var(--navy)' }}>
        <div className="relative z-10 max-w-lg mx-auto">
          <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-10 object-contain mx-auto mb-2" />
          <h1 className="font-display text-3xl text-white tracking-wider">FEATURES</h1>
          <p className="text-sm mt-1 font-medium" style={{ color: 'var(--gold)' }}>
            Everything you need at the ballpark
          </p>
        </div>
        <div className="stitch-line mt-4" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-8">
        {/* Back */}
        <button onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--navy-muted)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>

        {/* Feature cards */}
        <div className="space-y-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="card p-4 card-enter" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex gap-3">
                <span className="text-2xl flex-shrink-0 mt-0.5">{f.icon}</span>
                <div>
                  <div className="font-display text-lg" style={{ color: 'var(--navy)' }}>{f.title}</div>
                  <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--navy-muted)' }}>{f.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div>
          <div className="section-label mb-3">FREQUENTLY ASKED QUESTIONS</div>
          <div className="space-y-2">
            {FAQ.map((item, i) => (
              <details key={i} className="card overflow-hidden group">
                <summary className="px-4 py-3 cursor-pointer flex items-center justify-between font-semibold text-sm"
                  style={{ color: 'var(--navy)' }}>
                  {item.q}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--navy-muted)" strokeWidth="2.5" strokeLinecap="round"
                    className="flex-shrink-0 transition-transform group-open:rotate-180">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </summary>
                <div className="px-4 pb-3 text-sm leading-relaxed" style={{ color: 'var(--navy-muted)' }}>
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="text-center py-4">
          <p className="text-sm" style={{ color: 'var(--navy-muted)' }}>
            Questions or feedback? Contact us at{' '}
            <a href="mailto:ray@texineer.com" className="font-semibold no-underline" style={{ color: 'var(--gold-dark)' }}>
              ray@texineer.com
            </a>
          </p>
        </div>
      </main>

      <footer className="text-center py-4 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--navy-muted)' }}>
        BleacherBox
        <span className="mx-2">·</span>
        <Link to="/privacy" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Privacy</Link>
        <span className="mx-2">·</span>
        <Link to="/terms" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Terms</Link>
      </footer>
    </div>
  )
}
