import { useState } from 'react'
import { lookupTournament, addTeamFromTournament } from '../api'

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export default function AddTeamByTournament({ onAdded }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lookup, setLookup] = useState(null) // { source, eventId, ftBase, teams }
  const [selected, setSelected] = useState(null)
  const [slug, setSlug] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleLookup(e) {
    e.preventDefault()
    setError('')
    setLookup(null)
    setSelected(null)
    setLoading(true)
    try {
      const data = await lookupTournament(url.trim())
      setLookup(data)
      if (!data.teams?.length) setError('No teams found at that event.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSelect(team) {
    setSelected(team)
    setSlug(slugify(team.name))
    setAgeGroup('')
    setError('')
  }

  async function handleConfirm(e) {
    e.preventDefault()
    setError('')
    setAdding(true)
    try {
      const payload = lookup.source === 'pg'
        ? { source: 'pg', slug, name: selected.name, ageGroup, orgId: selected.orgId, teamId: selected.teamId }
        : { source: 'ft', slug, name: selected.name, ageGroup, teamHref: selected.href, ftBase: lookup.ftBase }
      const result = await addTeamFromTournament(payload)
      onAdded?.(result.slug)
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  if (selected) {
    return (
      <form onSubmit={handleConfirm} className="p-4 space-y-3">
        <div className="text-sm font-semibold" style={{ color: 'var(--navy)' }}>{selected.name}</div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--navy-muted)' }}>
            URL Slug
          </label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} required
            className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--navy-muted)' }}>
            Age Group (optional)
          </label>
          <input value={ageGroup} onChange={e => setAgeGroup(e.target.value)} placeholder="e.g. 14U"
            className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
        </div>
        {error && <div className="text-xs font-semibold" style={{ color: 'var(--loss)' }}>{error}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setSelected(null)}
            className="flex-1 h-10 rounded-lg text-xs font-bold uppercase tracking-wider"
            style={{ background: 'var(--sky)', color: 'var(--navy)' }}>
            Back
          </button>
          <button type="submit" disabled={adding}
            className="flex-1 h-10 rounded-lg font-display text-sm tracking-wider text-white active:scale-95"
            style={{ background: adding ? 'var(--navy-muted)' : 'var(--navy)' }}>
            {adding ? 'ADDING...' : 'ADD TEAM'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <form onSubmit={handleLookup} className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest block" style={{ color: 'var(--navy-muted)' }}>
          Tournament URL (PerfectGame or Five Tool)
        </label>
        <div className="flex gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} required
            placeholder="https://..."
            className="flex-1 h-10 px-3 rounded-lg border text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--navy)' }} />
          <button type="submit" disabled={loading}
            className="h-10 px-4 rounded-lg font-display text-sm tracking-wider text-white active:scale-95"
            style={{ background: loading ? 'var(--navy-muted)' : 'var(--navy)' }}>
            {loading ? '...' : 'FIND'}
          </button>
        </div>
      </form>
      <p className="text-xs" style={{ color: 'var(--navy-muted)' }}>
        Paste the link to your team's tournament page from perfectgame.org, play.fivetoolyouth.org, or events.fivetool.org — we'll list the teams registered there so you can pick yours.
      </p>
      {error && <div className="text-xs font-semibold" style={{ color: 'var(--loss)' }}>{error}</div>}
      {lookup?.teams?.length > 0 && (
        <div className="divide-y rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {lookup.teams.map((t, i) => (
            <button key={i} type="button" onClick={() => handleSelect(t)}
              className="w-full text-left px-3 py-2.5 text-sm active:bg-[var(--sky)]"
              style={{ color: 'var(--navy)' }}>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
