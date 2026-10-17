import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getTeamMembers, addTeamMember, updateTeamMember, removeTeamMember } from '../api'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'

const ROLES = ['admin', 'scorekeeper', 'viewer']

export default function TeamMembers({ orgId, teamId }) {
  const { slug } = useParams()
  const { user, hasTeamRole } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)

  const isAdmin = hasTeamRole(orgId, teamId, ['admin'])

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return }
    loadMembers()
  }, [orgId, teamId, isAdmin])

  async function loadMembers() {
    try {
      const data = await getTeamMembers(orgId, teamId)
      setMembers(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAddError('')
    setAdding(true)
    try {
      await addTeamMember(orgId, teamId, email, role)
      setEmail('')
      setRole('viewer')
      await loadMembers()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      await updateTeamMember(orgId, teamId, userId, newRole)
      await loadMembers()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRemove(userId) {
    try {
      await removeTeamMember(orgId, teamId, userId)
      await loadMembers()
    } catch (err) {
      setError(err.message)
    }
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <div className="font-display text-xl" style={{ color: 'var(--navy)' }}>SIGN IN REQUIRED</div>
        <p className="text-sm mt-2" style={{ color: 'var(--navy-muted)' }}>You must be signed in to manage team members.</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <div className="font-display text-xl" style={{ color: 'var(--navy)' }}>ADMIN ACCESS REQUIRED</div>
        <p className="text-sm mt-2" style={{ color: 'var(--navy-muted)' }}>Only team admins can manage members.</p>
      </div>
    )
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <div className="font-display text-2xl" style={{ color: 'var(--navy)' }}>TEAM MEMBERS</div>
        <p className="text-sm mt-0.5" style={{ color: 'var(--navy-muted)' }}>
          Manage who can access and score games for this team.
        </p>
      </div>

      {error && (
        <div className="text-sm font-semibold py-2 px-3 rounded-lg" style={{ color: 'var(--loss)', background: 'var(--loss-bg, #fdecea)' }}>
          {error}
        </div>
      )}

      {/* Add member form */}
      <form onSubmit={handleAdd} className="card p-4 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--navy-muted)' }}>
          ADD MEMBER
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            required
            className="flex-1 h-11 px-3 rounded-lg border text-sm font-medium focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)' }}
            placeholder="Email address..."
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <select
            className="h-11 px-2 rounded-lg border text-sm font-bold appearance-none text-center"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--cream)', minWidth: '6rem' }}
            value={role}
            onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        </div>
        {addError && (
          <div className="text-sm font-semibold" style={{ color: 'var(--loss)' }}>{addError}</div>
        )}
        <button
          type="submit"
          disabled={adding}
          className="w-full h-11 rounded-lg font-display text-base tracking-wider text-white active:scale-95 transition-transform"
          style={{ background: adding ? 'var(--navy-muted)' : 'var(--navy)' }}>
          {adding ? 'ADDING...' : 'ADD MEMBER'}
        </button>
        <p className="text-xs" style={{ color: 'var(--navy-muted)' }}>
          The user must have a BleacherBox account before they can be added.
        </p>
      </form>

      {/* Members list */}
      <div>
        <div className="section-label mb-3">CURRENT MEMBERS ({members.length})</div>
        <div className="card overflow-hidden">
          {members.length === 0 && (
            <div className="p-4 text-sm text-center" style={{ color: 'var(--navy-muted)' }}>
              No members yet. Add someone above.
            </div>
          )}
          {members.map((member, i) => {
            const isSelf = member.id === user?.id
            return (
              <div key={member.id}
                className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
                style={{ borderColor: 'var(--border)' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm text-white flex-shrink-0"
                  style={{ background: 'var(--navy)' }}>
                  {(member.display_name || member.email).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: 'var(--navy)' }}>
                    {member.display_name || member.email}
                    {isSelf && <span className="text-xs ml-1" style={{ color: 'var(--navy-muted)' }}>(you)</span>}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--navy-muted)' }}>{member.email}</div>
                </div>
                <select
                  className="h-8 px-2 rounded border text-xs font-bold text-center appearance-none"
                  style={{ borderColor: 'var(--border)', color: 'var(--navy)', background: 'var(--sky)' }}
                  value={member.role}
                  disabled={isSelf}
                  onChange={e => handleRoleChange(member.id, e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                </select>
                {!isSelf && (
                  <button
                    className="text-xs font-bold px-2 py-1 rounded"
                    style={{ color: 'var(--loss)', background: 'var(--loss-bg, #fdecea)' }}
                    onClick={() => handleRemove(member.id)}>
                    REMOVE
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Role descriptions */}
      <div className="card p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--navy-muted)' }}>
          ROLE PERMISSIONS
        </div>
        <div className="space-y-2 text-sm" style={{ color: 'var(--navy)' }}>
          <div><span className="font-bold">Admin</span> — Full access: manage members, score games, view data</div>
          <div><span className="font-bold">Scorekeeper</span> — Can set up lineups and score games</div>
          <div><span className="font-bold">Viewer</span> — Team appears in "My Teams" on home page</div>
        </div>
      </div>
    </div>
  )
}
