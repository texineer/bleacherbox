// The team the user last opened, so the bottom menu's Home and Stream tabs can
// take them back to it from screens outside a team (Account, Teams, ...).
const KEY = 'bb.lastTeam'

export function getLastTeam() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setLastTeam(slug) {
  try { localStorage.setItem(KEY, slug) } catch { /* storage unavailable */ }
}
