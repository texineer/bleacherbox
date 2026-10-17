import { useState, useEffect } from 'react'
import { getPendingUsers, approveUser, denyUser } from '../api'

// Sign-ups waiting for global-admin approval, with Approve / Deny.
export default function PendingAccounts() {
  const [pendingUsers, setPendingUsers] = useState([])
  const [error, setError] = useState('')

  function loadPending() {
    return getPendingUsers().then(setPendingUsers).catch(err => setError(err.message))
  }

  useEffect(() => { loadPending() }, [])

  async function handleApprove(userId) {
    try {
      await approveUser(userId)
      await loadPending()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeny(pending) {
    if (!confirm(`Deny and delete the sign-up for ${pending.email}?`)) return
    try {
      await denyUser(pending.id)
      await loadPending()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <div className="section-label mb-3">PENDING ACCOUNTS ({pendingUsers.length})</div>
      {error && <div className="text-sm font-semibold mb-2" style={{ color: 'var(--loss)' }}>{error}</div>}
      <div className="card overflow-hidden">
        {pendingUsers.length === 0 && (
          <div className="p-4 text-sm text-center" style={{ color: 'var(--navy-muted)' }}>
            No accounts waiting for approval.
          </div>
        )}
        {pendingUsers.map(pending => (
          <div key={pending.id}
            className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
            style={{ borderColor: 'var(--border)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
              style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
              {(pending.display_name || pending.email).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--navy)' }}>
                {pending.display_name || pending.email}
              </div>
              <div className="text-xs truncate" style={{ color: 'var(--navy-muted)' }}>
                {pending.email} · {pending.has_google ? 'Google' : 'Email'} · {new Date(pending.created_at + 'Z').toLocaleDateString()}
              </div>
            </div>
            <button
              className="text-xs font-bold px-2 py-1 rounded text-white"
              style={{ background: 'var(--win)' }}
              onClick={() => handleApprove(pending.id)}>
              APPROVE
            </button>
            <button
              className="text-xs font-bold px-2 py-1 rounded"
              style={{ color: 'var(--loss)', background: 'var(--loss-bg, #fdecea)' }}
              onClick={() => handleDeny(pending)}>
              DENY
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
