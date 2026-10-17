import { useNavigate } from 'react-router-dom'

// Back link for drill-down pages. Goes back in the app's history when there is
// some (works like the phone's back gesture); when the page was opened directly
// (shared link, app launch) it goes to `fallback` instead of leaving the app.
export default function BackButton({ fallback, label = 'Back' }) {
  const navigate = useNavigate()

  function handleClick() {
    // React Router records each in-app navigation's position as history.state.idx.
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }

  return (
    <button type="button" onClick={handleClick}
      className="inline-flex items-center gap-1 text-xs font-semibold py-1 -my-1"
      style={{ color: 'var(--navy-muted)' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </button>
  )
}
