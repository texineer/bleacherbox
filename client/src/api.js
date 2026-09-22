const API_BASE = '/api';

async function fetchJson(url) {
  const res = await fetch(`${API_BASE}${url}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function getTeams() {
  return fetchJson('/teams');
}

export function getTeamBySlug(slug) {
  return fetchJson(`/teams/by-slug/${slug}`);
}

export function getTeam(orgId, teamId) {
  return fetchJson(`/teams/${orgId}/${teamId}`);
}

export function getSchedule(orgId, teamId) {
  return fetchJson(`/teams/${orgId}/${teamId}/schedule`);
}

export function getTournaments(orgId, teamId) {
  return fetchJson(`/teams/${orgId}/${teamId}/tournaments`);
}

export function getGame(gameId) {
  return fetchJson(`/games/${gameId}`);
}

export function getGamePitchCounts(gameId) {
  return fetchJson(`/games/${gameId}/pitchcounts`);
}

export function getDailyPitchTotals(gameId) {
  return fetchJson(`/games/${gameId}/daily-totals`);
}

export function getOpponentPitchers(gameId) {
  return fetchJson(`/games/${gameId}/opponent-pitchers`);
}

export function getTournamentPitchingReport(eventId) {
  return fetchJson(`/tournaments/${eventId}/pitching-report`);
}

export function getTournamentFullSchedule(eventId) {
  return fetchJson(`/tournaments/${eventId}/full-schedule`);
}

export function syncTournament(eventId) {
  return fetch(`${API_BASE}/tournaments/${eventId}/sync`, { method: 'POST', credentials: 'include' }).then(r => r.json());
}

export function getTournamentTeams(eventId, ageGroup) {
  const params = ageGroup ? `?ageGroup=${encodeURIComponent(ageGroup)}` : '';
  return fetchJson(`/tournaments/${eventId}/teams${params}`);
}

export function getTournamentBracket(eventId) {
  return fetchJson(`/tournaments/${eventId}/bracket`);
}

export function searchTeams(query) {
  return fetchJson(`/teams/search?q=${encodeURIComponent(query)}`);
}

export function getPitchRules(ageGroup) {
  return fetchJson(`/pitch-rules/${ageGroup}`);
}

export function triggerScrape(slug) {
  return fetch(`${API_BASE}/scrape/${slug}`, { method: 'POST', credentials: 'include' }).then(r => r.json());
}

// Pitch count severity helper
export function pitchSeverity(pitches, dailyMax = 95) {
  const pct = pitches / dailyMax;
  if (pct >= 0.9) return 'danger';
  if (pct >= 0.7) return 'warning';
  return 'ok';
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function authFetch(method, url, body) {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`);
  return data;
}

export function authRegister(email, password, displayName) {
  return authFetch('POST', '/auth/register', { email, password, displayName });
}

export function authLogin(email, password) {
  return authFetch('POST', '/auth/login', { email, password });
}

export function authLogout() {
  return authFetch('POST', '/auth/logout');
}

export function changePassword(currentPassword, newPassword) {
  return authFetch('POST', '/auth/change-password', { currentPassword, newPassword });
}

export function authMe() {
  return fetchJson('/auth/me');
}

// ── Team Members ──────────────────────────────────────────────────────────────

export function getTeamMembers(orgId, teamId) {
  return fetchJson(`/teams/${orgId}/${teamId}/members`);
}

export function addTeamMember(orgId, teamId, email, role) {
  return authFetch('POST', `/teams/${orgId}/${teamId}/members`, { email, role });
}

export function updateTeamMember(orgId, teamId, userId, role) {
  return authFetch('PUT', `/teams/${orgId}/${teamId}/members/${userId}`, { role });
}

export function joinTeam(orgId, teamId) {
  return authFetch('POST', `/teams/${orgId}/${teamId}/join`);
}

export function leaveTeam(orgId, teamId) {
  return authFetch('POST', `/teams/${orgId}/${teamId}/leave`);
}

export function removeTeamMember(orgId, teamId, userId) {
  return authFetch('DELETE', `/teams/${orgId}/${teamId}/members/${userId}`);
}

// ── Live Scorebook ────────────────────────────────────────────────────────────

async function mutate(method, url, body) {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

// Fetch score from PG for a game missing its score
export function fetchGameScore(gameId) {
  return authFetch('POST', `/games/${gameId}/fetch-score`);
}

// Game score (calculated from play data)
export function getGameScore(gameId) {
  return fetchJson(`/games/${gameId}/score`);
}

// Viewer (no auth)
export function getScorebookState(gameId) {
  return fetchJson(`/games/${gameId}/scorebook`).catch(() => null);
}

export function getLivePitchCounts(gameId) {
  return fetchJson(`/games/${gameId}/live-pitch-counts`);
}

// Scorekeeper (auth required)
export function initScorebookGame(gameId, body) {
  return mutate('POST', `/games/${gameId}/scorebook/init`, body);
}

export function saveLineup(gameId, body) {
  return mutate('PUT', `/games/${gameId}/scorebook/lineup`, body);
}

export function startScorebookGame(gameId) {
  return mutate('POST', `/games/${gameId}/scorebook/start`, {});
}

export function updateScorebookState(gameId, body) {
  return mutate('PUT', `/games/${gameId}/scorebook/state`, body);
}

export function updateInningScore(gameId, inning, half, body) {
  return mutate('PUT', `/games/${gameId}/scorebook/inning/${inning}/${half}`, body);
}

export function startPlateAppearance(gameId, body) {
  return mutate('POST', `/games/${gameId}/scorebook/plate-appearance`, body);
}

export function recordPlateAppearanceOutcome(gameId, paId, body) {
  return mutate('PUT', `/games/${gameId}/scorebook/plate-appearance/${paId}`, body);
}

export function logPitch(gameId, body) {
  return mutate('POST', `/games/${gameId}/scorebook/pitch`, body);
}

export function undoLastPitch(gameId) {
  return mutate('DELETE', `/games/${gameId}/scorebook/pitch/last`, null);
}

export function recordSubstitution(gameId, body) {
  return mutate('POST', `/games/${gameId}/scorebook/substitution`, body);
}

export function endScorebookGame(gameId, body) {
  return mutate('POST', `/games/${gameId}/scorebook/end`, body);
}

// ── Soundboard ────────────────────────────────────────────────────────────────

export function getSoundboard(orgId, teamId) {
  return fetchJson(`/teams/${orgId}/${teamId}/soundboard`);
}

export function saveSoundboardButton(orgId, teamId, buttonKey, data) {
  return authFetch('PUT', `/teams/${orgId}/${teamId}/soundboard/${buttonKey}`, data);
}

// ── Playlist ──────────────────────────────────────────────────────────────────

export function getPlaylist(orgId, teamId) {
  return fetchJson(`/teams/${orgId}/${teamId}/playlist`);
}

export function addPlaylistSong(orgId, teamId, data) {
  return authFetch('POST', `/teams/${orgId}/${teamId}/playlist`, data);
}

export function updatePlaylistSong(orgId, teamId, id, data) {
  return authFetch('PUT', `/teams/${orgId}/${teamId}/playlist/${id}`, data);
}

export function removePlaylistSong(orgId, teamId, id) {
  return authFetch('DELETE', `/teams/${orgId}/${teamId}/playlist/${id}`);
}

// ── Walkup Songs ──────────────────────────────────────────────────────────────

export function getWalkupSong(orgId, teamId, playerName) {
  return fetchJson(`/teams/${orgId}/${teamId}/players/${encodeURIComponent(playerName)}/walkup-song`);
}

export function saveYoutubeWalkup(orgId, teamId, playerName, data) {
  return authFetch('POST', `/teams/${orgId}/${teamId}/players/${encodeURIComponent(playerName)}/walkup-song/youtube`, data);
}

export function uploadWalkupSong(orgId, teamId, playerName, formData) {
  return fetch(`${API_BASE}/teams/${orgId}/${teamId}/players/${encodeURIComponent(playerName)}/walkup-song/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }).then(async r => {
    const data = await r.json().catch(() => ({ error: r.statusText }));
    if (!r.ok) throw new Error(data.error || `API error: ${r.status}`);
    return data;
  });
}

export function deleteWalkupSong(orgId, teamId, playerName) {
  return authFetch('DELETE', `/teams/${orgId}/${teamId}/players/${encodeURIComponent(playerName)}/walkup-song`);
}

// ── Register team (auth required) ─────────────────────────────────────────────

export function registerTeam(body) {
  return authFetch('POST', '/teams', body);
}

export function lookupTournament(url) {
  return authFetch('POST', '/tournaments/lookup', { url });
}

export function addTeamFromTournament(body) {
  return authFetch('POST', '/teams/from-tournament', body);
}

// ── Create manual game (auth required) ────────────────────────────────────────

export function createGame(teamOrgId, teamId, opponentName) {
  return authFetch('POST', '/games', { teamOrgId, teamId, opponentName });
}
