import { Link } from 'react-router-dom'

const EFFECTIVE_DATE = 'October 16, 2026'
const CONTACT_EMAIL = 'ray@texineer.com'

function Mail() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold no-underline" style={{ color: 'var(--gold-dark)' }}>
      {CONTACT_EMAIL}
    </a>
  )
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl tracking-wider" style={{ color: 'var(--navy)' }}>{title}</h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--navy)' }}>{children}</div>
    </section>
  )
}

function List({ items }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

function LegalPage({ title, children }) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="relative overflow-hidden py-6 px-6 text-center" style={{ background: 'var(--navy)' }}>
        <div className="safe-top-spacer" />
        <div className="relative z-10 max-w-lg mx-auto">
          <Link to="/">
            <img src="/bleacherbox_logo_sm.png" alt="BleacherBox" className="h-10 object-contain mx-auto mb-2" />
          </Link>
          <h1 className="font-display text-3xl text-white tracking-wider">{title}</h1>
          <p className="text-sm mt-1 font-medium" style={{ color: 'var(--gold)' }}>
            Effective {EFFECTIVE_DATE}
          </p>
        </div>
        <div className="stitch-line mt-4" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        {children}
      </main>

      <footer className="text-center py-4 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--navy-muted)' }}>
        <Link to="/" className="no-underline" style={{ color: 'var(--navy-muted)' }}>BleacherBox</Link>
        <span className="mx-2">·</span>
        <Link to="/privacy" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Privacy</Link>
        <span className="mx-2">·</span>
        <Link to="/terms" className="no-underline" style={{ color: 'var(--navy-muted)' }}>Terms</Link>
      </footer>
    </div>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="PRIVACY POLICY">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--navy)' }}>
        BleacherBox (bleacherbox.app) is operated by Texineer ("we", "us"). This policy explains what
        information we collect, how we use it, and the choices you have. Questions? Email <Mail />.
      </p>

      <Section title="INFORMATION WE COLLECT">
        <p><strong>Account information.</strong> When you sign up we collect your email address, display name,
          and a password, which is stored only as a one-way hash. If you sign in with Google, we receive your
          name, email address, and a Google account identifier from Google. We do not receive your Google
          password and do not access your Gmail, contacts, Drive, or any other Google data.</p>
        <p><strong>Team and game information you add.</strong> Team admins, scorekeepers, and members may enter
          player names and jersey numbers, lineups, scores, pitch counts, walkup song choices, uploaded audio
          files, baseball card photos, and live stream links.</p>
        <p><strong>Public tournament data.</strong> We collect publicly posted schedules, results, rosters, and
          pitch counts from Perfect Game and Five Tool Youth to show them in the app.</p>
        <p><strong>Technical information.</strong> We use a single cookie to keep you signed in (see Cookies below).
          Our servers may record standard log information such as IP address, browser type, and request times
          for security and troubleshooting.</p>
      </Section>

      <Section title="HOW WE USE INFORMATION">
        <List items={[
          'To run BleacherBox: show schedules, scores, pitch counts, lineups, and team features.',
          'To create and secure your account, including reviewing and approving new sign-ups.',
          'To contact you about your account or important changes to the service.',
        ]} />
        <p>We do not sell your information, show ads, or use third-party analytics or advertising trackers.</p>
      </Section>

      <Section title="HOW INFORMATION IS SHARED">
        <List items={[
          <><strong>With your team.</strong> Team members can see team data and other members according to their role. Team schedules, scores, and rosters may be viewable by anyone who has the team's link.</>,
          <><strong>Service providers.</strong> Google (to sign you in, if you choose Google), ElevenLabs (we send a player's name and number to generate the PA announcement audio), and YouTube (to retrieve audio for walkup songs you select).</>,
          <><strong>Legal reasons.</strong> If required by law, or to protect the safety, rights, or property of our users or others.</>,
        ]} />
      </Section>

      <Section title="GOOGLE USER DATA">
        <p>BleacherBox's use of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer"
            className="font-semibold" style={{ color: 'var(--gold-dark)' }}>Google API Services User Data Policy</a>,
          including the Limited Use requirements. We use your Google name and email only to create and sign in to
          your BleacherBox account, and we do not share them with anyone else.</p>
      </Section>

      <Section title="CHILDREN'S INFORMATION">
        <p>BleacherBox accounts are for adults (parents, coaches, and team staff) 18 or older. We do not knowingly
          let children create accounts. Youth players appear in BleacherBox only through information entered by
          adults or published by tournament organizers, such as name, jersey number, stats, and an optional photo.
          A parent or guardian can ask us to correct or remove a player's information at any time by emailing <Mail />.</p>
      </Section>

      <Section title="COOKIES AND LOCAL STORAGE">
        <p>We use one essential cookie that keeps you signed in for up to 7 days. The app may also store
          preferences and cached pages in your browser so it loads quickly and works with a weak signal at the
          ballpark. We do not use advertising or tracking cookies.</p>
      </Section>

      <Section title="RETENTION AND DELETION">
        <p>We keep your account information while your account is active. Sign-ups that are not approved are
          deleted. To delete your account or have your information removed, email <Mail /> and we will do so
          within 30 days, except where we must keep information to meet legal obligations.</p>
      </Section>

      <Section title="SECURITY">
        <p>Passwords are hashed, sign-in cookies are protected from page scripts, and the site is served over
          HTTPS. No system is perfectly secure, so please use a strong, unique password.</p>
      </Section>

      <Section title="CHANGES TO THIS POLICY">
        <p>If we change this policy, we will update the effective date above. If the changes are significant,
          we will let account holders know.</p>
      </Section>

      <Section title="CONTACT">
        <p>Texineer · <Mail /></p>
      </Section>
    </LegalPage>
  )
}

export function TermsOfService() {
  return (
    <LegalPage title="TERMS OF SERVICE">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--navy)' }}>
        These terms govern your use of BleacherBox (bleacherbox.app), operated by Texineer ("we", "us").
        By creating an account or using BleacherBox, you agree to these terms and to our{' '}
        <Link to="/privacy" className="font-semibold" style={{ color: 'var(--gold-dark)' }}>Privacy Policy</Link>.
      </p>

      <Section title="ELIGIBILITY AND ACCOUNTS">
        <List items={[
          'You must be 18 or older to create an account.',
          'New accounts are reviewed and may be approved or declined at our discretion.',
          'Keep your sign-in details secure. You are responsible for activity on your account.',
          'Give accurate information, and tell us if you believe your account has been compromised.',
        ]} />
      </Section>

      <Section title="YOUR CONTENT">
        <p>You keep ownership of the information, photos, and audio you add. You give us permission to store,
          display, and process that content as needed to run BleacherBox for you and your team.</p>
        <p>Only add content you have the right to share. Before adding a player's photo or personal details, make
          sure you are that player's parent or guardian or have their parent's or guardian's permission.</p>
      </Section>

      <Section title="ACCEPTABLE USE">
        <p>You agree not to:</p>
        <List items={[
          'Upload content that is unlawful, harassing, or infringes anyone else\'s rights.',
          'Access teams, accounts, or data you are not authorized to use.',
          'Disrupt, overload, scrape, or try to bypass the security of the service.',
          'Use BleacherBox to stream or record where the venue, league, or tournament prohibits it.',
        ]} />
      </Section>

      <Section title="MUSIC AND STREAMING">
        <p>Walkup songs and the DJ feature play audio you choose. You are responsible for having the right to play
          that music at your venue. Live streams are run by your team, and your team is responsible for following
          venue and tournament rules about filming and broadcasting.</p>
      </Section>

      <Section title="TOURNAMENT DATA AND PITCH COUNTS">
        <p>Schedules, scores, and pitch counts come from third-party sources and from team scorekeepers, and may be
          incomplete, delayed, or wrong. Pitch counts are for information only. Always follow official tournament
          pitching rules and use your own judgment about player health. BleacherBox is not affiliated with or
          endorsed by Perfect Game, Five Tool Youth, Google, or YouTube.</p>
      </Section>

      <Section title="SUSPENSION AND TERMINATION">
        <p>You may stop using BleacherBox at any time and ask us to delete your account. We may suspend or end
          access to accounts that break these terms or put other users or the service at risk.</p>
      </Section>

      <Section title="DISCLAIMERS">
        <p>BleacherBox is provided "as is" and "as available", without warranties of any kind, express or implied.
          We do not guarantee that the service will be uninterrupted, error-free, or that data will be accurate.</p>
      </Section>

      <Section title="LIMITATION OF LIABILITY">
        <p>To the fullest extent permitted by law, Texineer will not be liable for any indirect, incidental, special,
          or consequential damages, or for any loss of data, arising from your use of BleacherBox. Our total
          liability for any claim relating to the service is limited to the amount you paid us in the 12 months
          before the claim, or $50 if you paid nothing.</p>
      </Section>

      <Section title="CHANGES TO THESE TERMS">
        <p>We may update these terms. We will update the effective date above, and continued use of BleacherBox
          after a change means you accept the updated terms.</p>
      </Section>

      <Section title="GOVERNING LAW">
        <p>These terms are governed by the laws of the State of Texas, without regard to its conflict-of-law rules.</p>
      </Section>

      <Section title="CONTACT">
        <p>Texineer · <Mail /></p>
      </Section>
    </LegalPage>
  )
}
