const { getDb, saveDb } = require('./schema');

// Helper: sql.js returns arrays of objects via stmt approach; this helper simplifies
function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(db, sql, params = []) {
  const rows = all(db, sql, params);
  return rows[0] || null;
}

function run(db, sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// Teams
async function upsertTeam({ pgOrgId, pgTeamId, name, ageGroup, hometown, classification, record, pgUrl }) {
  const db = await getDb();
  run(db, `
    INSERT INTO teams (pg_org_id, pg_team_id, name, age_group, hometown, classification, record, pg_url, last_scraped)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(pg_org_id, pg_team_id) DO UPDATE SET
      name=excluded.name, age_group=excluded.age_group, hometown=excluded.hometown,
      classification=excluded.classification, record=excluded.record, pg_url=excluded.pg_url,
      last_scraped=datetime('now')
  `, [pgOrgId, pgTeamId, name, ageGroup, hometown, classification, record, pgUrl]);
}

async function getTeam(orgId, teamId) {
  const db = await getDb();
  return get(db, 'SELECT * FROM teams WHERE pg_org_id = ? AND pg_team_id = ?', [orgId, teamId]);
}

async function getTeamBySlug(slug) {
  const db = await getDb();
  return get(db, 'SELECT * FROM teams WHERE slug = ?', [slug]);
}

async function getAllTeams() {
  const db = await getDb();
  return all(db, 'SELECT * FROM teams WHERE slug IS NOT NULL ORDER BY name');
}

async function registerTeam({ slug, pgOrgId, pgTeamId, name, ageGroup, ftTeamUuid, ftSeasons, ftBaseUrl, logoUrl }) {
  const db = await getDb();
  // Upsert: if team exists by PG IDs, update slug/ft fields; otherwise insert
  const existing = get(db, 'SELECT * FROM teams WHERE pg_org_id = ? AND pg_team_id = ?', [pgOrgId, pgTeamId]);
  if (existing) {
    run(db, `UPDATE teams SET slug=?, ft_team_uuid=?, ft_seasons=?, ft_base_url=?, logo_url=? WHERE pg_org_id=? AND pg_team_id=?`,
      [slug, ftTeamUuid || null, ftSeasons || null, ftBaseUrl || null, logoUrl || null, pgOrgId, pgTeamId]);
  } else {
    run(db, `INSERT INTO teams (pg_org_id, pg_team_id, name, age_group, slug, ft_team_uuid, ft_seasons, ft_base_url, logo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pgOrgId, pgTeamId, name, ageGroup, slug, ftTeamUuid || null, ftSeasons || null, ftBaseUrl || null, logoUrl || null]);
  }
}

async function searchTeams(query) {
  const db = await getDb();
  return all(db, 'SELECT * FROM teams WHERE name LIKE ? ORDER BY name LIMIT 50', [`%${query}%`]);
}

// Players
async function upsertPlayer({ pgOrgId, pgTeamId, name, number, position, bats, throws: th, gradYear, height, weight, hometown }) {
  const db = await getDb();
  run(db, `
    INSERT INTO players (pg_org_id, pg_team_id, name, number, position, bats, throws, grad_year, height, weight, hometown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pg_org_id, pg_team_id, name) DO UPDATE SET
      number=excluded.number, position=excluded.position, bats=excluded.bats,
      throws=excluded.throws, grad_year=excluded.grad_year, height=excluded.height,
      weight=excluded.weight, hometown=excluded.hometown
  `, [pgOrgId, pgTeamId, name, number, position, bats, th, gradYear, height, weight, hometown]);
}

async function getPlayers(orgId, teamId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM players WHERE pg_org_id = ? AND pg_team_id = ? ORDER BY name', [orgId, teamId]);
}

async function setPlayerCardPath(orgId, teamId, name, cardPath) {
  const db = await getDb();
  run(db, 'UPDATE players SET card_image_path = ? WHERE pg_org_id = ? AND pg_team_id = ? AND name = ?', [cardPath, orgId, teamId, name]);
  saveDb();
}

// Tournaments
async function upsertTournament({ pgEventId, name, startDate, endDate, location, pgUrl }) {
  const db = await getDb();
  run(db, `
    INSERT INTO tournaments (pg_event_id, name, start_date, end_date, location, pg_url, last_scraped)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(pg_event_id) DO UPDATE SET
      name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date,
      location=excluded.location, pg_url=excluded.pg_url, last_scraped=datetime('now')
  `, [pgEventId, name, startDate, endDate, location, pgUrl]);
}

async function linkTeamTournament(orgId, teamId, eventId) {
  const db = await getDb();
  run(db, 'INSERT OR IGNORE INTO team_tournaments (pg_org_id, pg_team_id, pg_event_id) VALUES (?, ?, ?)', [orgId, teamId, eventId]);
}

async function getTeamTournaments(orgId, teamId) {
  const db = await getDb();
  return all(db, `
    SELECT t.* FROM tournaments t
    JOIN team_tournaments tt ON t.pg_event_id = tt.pg_event_id
    WHERE tt.pg_org_id = ? AND tt.pg_team_id = ?
    ORDER BY t.start_date DESC
  `, [orgId, teamId]);
}

async function getTournament(eventId) {
  const db = await getDb();
  return get(db, 'SELECT * FROM tournaments WHERE pg_event_id = ?', [eventId]);
}

// Games
async function upsertGame({ pgGameId, pgEventId, teamOrgId, teamId, opponentName, opponentOrgId, opponentTeamId, gameDate, gameTime, field, scoreUs, scoreThem, result, pgBoxUrl, pgRecapUrl }) {
  const db = await getDb();
  run(db, `
    INSERT INTO games (pg_game_id, pg_event_id, team_org_id, team_id, opponent_name, opponent_org_id, opponent_team_id, game_date, game_time, field, score_us, score_them, result, pg_box_url, pg_recap_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pg_game_id) DO UPDATE SET
      team_org_id=excluded.team_org_id, team_id=excluded.team_id,
      opponent_name=excluded.opponent_name, game_date=excluded.game_date, game_time=excluded.game_time,
      field=excluded.field, score_us=excluded.score_us, score_them=excluded.score_them,
      result=excluded.result, pg_box_url=excluded.pg_box_url, pg_recap_url=excluded.pg_recap_url
  `, [pgGameId, pgEventId, teamOrgId, teamId, opponentName, opponentOrgId, opponentTeamId, gameDate, gameTime, field, scoreUs, scoreThem, result, pgBoxUrl, pgRecapUrl]);
}

async function createManualGame({ teamOrgId, teamId, opponentName, gameDate }) {
  const db = await getDb();
  db.run(
    `INSERT INTO games (team_org_id, team_id, opponent_name, game_date, source, scoring_status)
     VALUES (?, ?, ?, ?, 'manual', 'none')`,
    [teamOrgId, teamId, opponentName, gameDate]
  );
  const result = db.exec('SELECT last_insert_rowid() as id');
  const id = result[0].values[0][0];
  saveDb();
  return id;
}

async function getTeamGames(orgId, teamId) {
  const db = await getDb();
  return all(db, `
    SELECT g.*, t.name as tournament_name FROM games g
    LEFT JOIN tournaments t ON g.pg_event_id = t.pg_event_id
    WHERE g.team_org_id = ? AND g.team_id = ?
    ORDER BY g.game_date DESC
  `, [orgId, teamId]);
}

async function getGame(gameId) {
  const db = await getDb();
  return get(db, `
    SELECT g.*, t.name as tournament_name FROM games g
    LEFT JOIN tournaments t ON g.pg_event_id = t.pg_event_id
    WHERE g.id = ?
  `, [gameId]);
}

async function getGameByPgId(pgGameId) {
  const db = await getDb();
  return get(db, 'SELECT * FROM games WHERE pg_game_id = ?', [pgGameId]);
}

async function getTournamentGames(eventId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM games WHERE pg_event_id = ? ORDER BY game_date', [eventId]);
}

// Pitch Counts
async function insertPitchCount({ gameId, pgEventId, playerName, teamName, pitches, innings, strikeouts, walks }) {
  const db = await getDb();
  run(db, `
    INSERT INTO pitch_counts (game_id, pg_event_id, player_name, team_name, pitches, innings, strikeouts, walks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [gameId, pgEventId, playerName, teamName, pitches, innings, strikeouts, walks]);
}

async function clearPitchCounts(gameId) {
  const db = await getDb();
  run(db, 'DELETE FROM pitch_counts WHERE game_id = ?', [gameId]);
}

async function clearTournamentPitchCounts(eventId) {
  const db = await getDb();
  run(db, 'DELETE FROM pitch_counts WHERE pg_event_id = ?', [eventId]);
}

async function getGamePitchCounts(gameId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM pitch_counts WHERE game_id = ? ORDER BY pitches DESC', [gameId]);
}

async function getTournamentPitchCounts(eventId) {
  const db = await getDb();
  return all(db, `
    SELECT * FROM pitch_counts
    WHERE pg_event_id = ?
    ORDER BY team_name, player_name
  `, [eventId]);
}

async function getTournamentPitcherTotals(eventId) {
  const db = await getDb();
  return all(db, `
    SELECT
      player_name,
      team_name,
      SUM(pitches) as total_pitches,
      COUNT(*) as appearances,
      SUM(innings) as total_innings,
      MAX(pitches) as max_pitches
    FROM pitch_counts
    WHERE pg_event_id = ?
    GROUP BY player_name, team_name
    ORDER BY total_pitches DESC
  `, [eventId]);
}

// Daily pitch totals: given a game, find all pitchers on the same date + team and sum their pitches
async function getDailyPitchTotals(gameId) {
  const db = await getDb();
  return all(db, `
    SELECT
      pc.player_name,
      pc.team_name,
      SUM(pc.pitches) as total_pitches,
      COUNT(*) as appearances,
      SUM(pc.innings) as total_innings,
      SUM(pc.strikeouts) as total_strikeouts,
      SUM(pc.walks) as total_walks
    FROM pitch_counts pc
    JOIN games g2 ON pc.game_id = g2.id
    JOIN games g1 ON g1.id = ?
    WHERE g2.game_date = g1.game_date
      AND g2.pg_event_id = g1.pg_event_id
    GROUP BY pc.player_name, pc.team_name
    ORDER BY pc.team_name, total_pitches DESC
  `, [gameId]);
}

// Get total pitch count per game (for badge display)
async function getGamesPitchTotals(gameIds) {
  if (!gameIds.length) return {};
  const db = await getDb();
  const placeholders = gameIds.map(() => '?').join(',');
  const rows = all(db, `
    SELECT game_id, SUM(pitches) as total_pitches, COUNT(*) as pitcher_count
    FROM pitch_counts
    WHERE game_id IN (${placeholders})
    GROUP BY game_id
  `, gameIds);
  const map = {};
  for (const r of rows) map[r.game_id] = { totalPitches: r.total_pitches, pitcherCount: r.pitcher_count };
  return map;
}

// Five Tool upserts
async function upsertFtTournament({ eventId, name, startDate, endDate, location, ftUrl }) {
  const db = await getDb();
  run(db, `
    INSERT INTO tournaments (pg_event_id, name, start_date, end_date, location, pg_url, last_scraped, source)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'ft')
    ON CONFLICT(pg_event_id) DO UPDATE SET
      name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date,
      location=excluded.location, pg_url=excluded.pg_url, last_scraped=datetime('now'), source='ft'
  `, [eventId, name, startDate, endDate, location, ftUrl]);
}

async function upsertFtGame({ sourceGameKey, pgEventId, teamOrgId, teamId, opponentName, gameDate, gameTime, field, scoreUs, scoreThem, result }) {
  const db = await getDb();
  const existing = get(db, 'SELECT id FROM games WHERE source_game_key = ?', [sourceGameKey]);
  if (existing) {
    run(db, `
      UPDATE games SET opponent_name=?, game_date=?, game_time=COALESCE(?, game_time), field=COALESCE(?, field), score_us=?, score_them=?, result=?
      WHERE source_game_key=?
    `, [opponentName, gameDate, gameTime || null, field || null, scoreUs, scoreThem, result, sourceGameKey]);
  } else {
    run(db, `
      INSERT INTO games (pg_event_id, team_org_id, team_id, opponent_name, game_date, game_time, field, score_us, score_them, result, source, source_game_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ft', ?)
    `, [pgEventId, teamOrgId, teamId, opponentName, gameDate, gameTime || '', field || '', scoreUs, scoreThem, result, sourceGameKey]);
  }
}

// Combined record across all sources
async function getCombinedRecord(orgId, teamId) {
  const db = await getDb();
  return get(db, `
    SELECT
      SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN result = 'T' THEN 1 ELSE 0 END) as ties
    FROM games WHERE team_org_id = ? AND team_id = ?
  `, [orgId, teamId]);
}

// Opponent pitcher totals for a tournament
async function getOpponentPitcherTotals(eventId, opponentName) {
  const db = await getDb();
  return all(db, `
    SELECT
      player_name,
      SUM(pitches) as total_pitches,
      COUNT(*) as appearances,
      SUM(innings) as total_innings,
      MAX(pitches) as max_pitches
    FROM pitch_counts
    WHERE pg_event_id = ? AND team_name = ?
    GROUP BY player_name
    ORDER BY total_pitches DESC
  `, [eventId, opponentName]);
}

// ── Live Scorebook ──────────────────────────────────────────────────────────

async function getScorebookState(gameId) {
  const db = await getDb();
  return get(db, 'SELECT * FROM game_scorebook WHERE game_id = ?', [gameId]);
}

async function initScorebookState({ gameId, homeTeamName, awayTeamName, ourSide }) {
  const db = await getDb();
  run(db, `
    INSERT INTO game_scorebook (game_id, status, home_team_name, away_team_name, our_side)
    VALUES (?, 'lineup', ?, ?, ?)
    ON CONFLICT(game_id) DO UPDATE SET
      status='lineup', home_team_name=excluded.home_team_name,
      away_team_name=excluded.away_team_name, our_side=excluded.our_side,
      updated_at=datetime('now')
  `, [gameId, homeTeamName, awayTeamName, ourSide]);
  run(db, `UPDATE games SET scoring_status='lineup' WHERE id=?`, [gameId]);
}

async function updateScorebookState({ gameId, status, inning, half, outs, balls, strikes, runner1b, runner2b, runner3b, homeBatterIdx, awayBatterIdx }) {
  const db = await getDb();
  const fields = [];
  const params = [];
  if (status !== undefined)  { fields.push('status=?');   params.push(status); }
  if (inning !== undefined)  { fields.push('inning=?');   params.push(inning); }
  if (half !== undefined)    { fields.push('half=?');     params.push(half); }
  if (outs !== undefined)    { fields.push('outs=?');     params.push(outs); }
  if (balls !== undefined)   { fields.push('balls=?');    params.push(balls); }
  if (strikes !== undefined) { fields.push('strikes=?');  params.push(strikes); }
  if (runner1b !== undefined){ fields.push('runner_1b=?'); params.push(runner1b ?? null); }
  if (runner2b !== undefined){ fields.push('runner_2b=?'); params.push(runner2b ?? null); }
  if (runner3b !== undefined){ fields.push('runner_3b=?'); params.push(runner3b ?? null); }
  if (homeBatterIdx !== undefined) { fields.push('home_batter_idx=?'); params.push(homeBatterIdx); }
  if (awayBatterIdx !== undefined) { fields.push('away_batter_idx=?'); params.push(awayBatterIdx); }
  fields.push("updated_at=datetime('now')");
  params.push(gameId);
  run(db, `UPDATE game_scorebook SET ${fields.join(', ')} WHERE game_id=?`, params);
}

async function startGame(gameId) {
  const db = await getDb();
  run(db, `UPDATE game_scorebook SET status='in_progress', started_at=datetime('now'), updated_at=datetime('now') WHERE game_id=?`, [gameId]);
  run(db, `UPDATE games SET scoring_status='live' WHERE id=?`, [gameId]);
}

async function endGame(gameId, scoreUs, scoreThem) {
  const db = await getDb();
  const result = scoreUs > scoreThem ? 'W' : scoreUs < scoreThem ? 'L' : 'T';
  run(db, `UPDATE game_scorebook SET status='final', ended_at=datetime('now'), updated_at=datetime('now') WHERE game_id=?`, [gameId]);
  run(db, `UPDATE games SET score_us=?, score_them=?, result=?, scoring_status='final' WHERE id=?`, [scoreUs, scoreThem, result, gameId]);
}

// ── Lineup ──────────────────────────────────────────────────────────────────

async function getLineup(gameId, teamSide) {
  const db = await getDb();
  return all(db, `SELECT * FROM lineup_entries WHERE game_id=? AND team_side=? ORDER BY batting_order`, [gameId, teamSide]);
}

async function upsertLineupEntry({ gameId, teamSide, battingOrder, playerName, jerseyNumber, position }) {
  const db = await getDb();
  const existing = get(db, `SELECT id FROM lineup_entries WHERE game_id=? AND team_side=? AND batting_order=? AND active=1`, [gameId, teamSide, battingOrder]);
  if (existing) {
    run(db, `UPDATE lineup_entries SET player_name=?, jersey_number=?, position=? WHERE id=?`,
      [playerName, jerseyNumber ?? null, position ?? null, existing.id]);
  } else {
    run(db, `INSERT INTO lineup_entries (game_id, team_side, batting_order, player_name, jersey_number, position) VALUES (?, ?, ?, ?, ?, ?)`,
      [gameId, teamSide, battingOrder, playerName, jerseyNumber ?? null, position ?? null]);
  }
}

async function recordSubstitution({ gameId, teamSide, battingOrder, newPlayerName, jerseyNumber, position }) {
  const db = await getDb();
  run(db, `UPDATE lineup_entries SET active=0 WHERE game_id=? AND team_side=? AND batting_order=? AND active=1`, [gameId, teamSide, battingOrder]);
  run(db, `INSERT INTO lineup_entries (game_id, team_side, batting_order, player_name, jersey_number, position) VALUES (?, ?, ?, ?, ?, ?)`,
    [gameId, teamSide, battingOrder, newPlayerName, jerseyNumber ?? null, position ?? null]);
}

// ── Inning Scores ────────────────────────────────────────────────────────────

async function getInningScores(gameId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM inning_scores WHERE game_id=? ORDER BY inning, half', [gameId]);
}

async function upsertInningScore({ gameId, inning, half, runs, hits, errors }) {
  const db = await getDb();
  run(db, `
    INSERT INTO inning_scores (game_id, inning, half, runs, hits, errors)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_id, inning, half) DO UPDATE SET runs=excluded.runs, hits=excluded.hits, errors=excluded.errors
  `, [gameId, inning, half, runs, hits, errors]);
}

// ── Plate Appearances ────────────────────────────────────────────────────────

async function getPlateAppearances(gameId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM plate_appearances WHERE game_id=? ORDER BY pa_order', [gameId]);
}

async function insertPlateAppearance({ gameId, inning, half, battingOrderPos, teamSide, playerName, pitcherName }) {
  const db = await getDb();
  const maxPa = get(db, 'SELECT MAX(pa_order) as m FROM plate_appearances WHERE game_id=?', [gameId]);
  const nextOrder = (maxPa?.m ?? 0) + 1;
  db.run(`INSERT INTO plate_appearances (game_id, inning, half, batting_order_pos, team_side, player_name, pitcher_name, pa_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [gameId, inning, half, battingOrderPos, teamSide, playerName, pitcherName ?? null, nextOrder]);
  const idResult = db.exec('SELECT last_insert_rowid() as id');
  const newId = idResult[0].values[0][0];
  saveDb();
  return newId;
}

async function updatePlateAppearanceOutcome({ paId, outcome, rbi, pitchSequence, hitType, hitX, hitY, fielder, runsScored }) {
  const db = await getDb();
  run(db, `UPDATE plate_appearances SET outcome=?, pitch_sequence=?, rbi=?, hit_type=?, hit_x=?, hit_y=?, fielder=?, runs_scored=? WHERE id=?`,
    [outcome, pitchSequence ?? null, rbi ?? 0, hitType ?? null, hitX ?? null, hitY ?? null, fielder ?? null, runsScored ?? 0, paId]);
}

// ── Live Pitches ─────────────────────────────────────────────────────────────

async function logPitch({ gameId, paId, pitcherName, pitcherTeamSide, pitchType, inning, half }) {
  const db = await getDb();
  const maxSeq = get(db, 'SELECT MAX(pitch_seq) as m FROM live_pitches WHERE game_id=? AND pitcher_name=?', [gameId, pitcherName]);
  const nextSeq = (maxSeq?.m ?? 0) + 1;
  run(db, `INSERT INTO live_pitches (game_id, pa_id, pitcher_name, pitcher_team_side, pitch_type, inning, half, pitch_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [gameId, paId ?? null, pitcherName, pitcherTeamSide, pitchType, inning, half, nextSeq]);
}

async function getLivePitchCounts(gameId) {
  const db = await getDb();
  return all(db, `
    SELECT
      pitcher_name,
      pitcher_team_side,
      COUNT(*) as total_pitches,
      SUM(CASE WHEN pitch_type='S' OR pitch_type='C' THEN 1 ELSE 0 END) as strikes,
      SUM(CASE WHEN pitch_type='B' THEN 1 ELSE 0 END) as balls
    FROM live_pitches
    WHERE game_id=?
    GROUP BY pitcher_name, pitcher_team_side
    ORDER BY total_pitches DESC
  `, [gameId]);
}

async function deleteLastPitch(gameId) {
  const db = await getDb();
  run(db, 'DELETE FROM live_pitches WHERE id = (SELECT MAX(id) FROM live_pitches WHERE game_id=?)', [gameId]);
}

async function getFullScorebookState(gameId) {
  const db = await getDb();
  const state = get(db, 'SELECT * FROM game_scorebook WHERE game_id=?', [gameId]);
  if (!state) return null;
  const homeLineup = all(db, `SELECT * FROM lineup_entries WHERE game_id=? AND team_side='home' ORDER BY batting_order`, [gameId]);
  const awayLineup = all(db, `SELECT * FROM lineup_entries WHERE game_id=? AND team_side='away' ORDER BY batting_order`, [gameId]);
  const inningScores = all(db, 'SELECT * FROM inning_scores WHERE game_id=? ORDER BY inning, half', [gameId]);
  const pitchCounts = all(db, `SELECT pitcher_name, pitcher_team_side, COUNT(*) as total_pitches FROM live_pitches WHERE game_id=? GROUP BY pitcher_name, pitcher_team_side`, [gameId]);
  const plateAppearances = all(db, 'SELECT * FROM plate_appearances WHERE game_id=? ORDER BY pa_order DESC LIMIT 10', [gameId]);
  return { state, homeLineup, awayLineup, inningScores, pitchCounts, plateAppearances };
}

// ── Bracket Games ─────────────────────────────────────────────────────────

async function touchTournamentLastScraped(eventId) {
  const db = await getDb();
  run(db, "UPDATE tournaments SET last_scraped = datetime('now') WHERE pg_event_id = ?", [eventId]);
}

// Check if a bracket team name matches our team name — exact match (case-insensitive)
function bracketNameMatches(bracketName, teamName) {
  if (!bracketName || !teamName) return false;
  const bn = bracketName.trim().toLowerCase();
  const tn = teamName.trim().toLowerCase();
  return bn === tn;
}

// Claim bracket games for a team. Processes ALL bracket games with "vs" in the name.
async function claimBracketGamesForTeam(eventId, orgId, teamId, teamName) {
  const db = await getDb();
  const bracketGames = all(db, `SELECT * FROM games WHERE pg_event_id = ? AND game_type = 'bracket'`, [eventId]);

  for (const g of bracketGames) {
    if (!g.opponent_name || !g.opponent_name.includes(' vs ')) continue;

    const parts = g.opponent_name.split(' vs ').map(s => s.trim());
    if (parts.length !== 2) continue;

    const weAre0 = bracketNameMatches(parts[0], teamName);
    const weAre1 = bracketNameMatches(parts[1], teamName);

    if (!weAre0 && !weAre1) {
      // Not our game — unclaim if we wrongly own it
      if (g.team_org_id === orgId && g.team_id === teamId) {
        run(db, `UPDATE games SET team_org_id=0, team_id=0, result=NULL WHERE id=?`, [g.id]);
      }
      continue;
    }

    // Our game — set proper opponent, scores, and result
    const opponent = weAre0 ? parts[1] : parts[0];
    let scoreUs = weAre0 ? g.score_us : g.score_them;
    let scoreThem = weAre0 ? g.score_them : g.score_us;
    let result = null;
    if (scoreUs != null && scoreThem != null) {
      result = scoreUs > scoreThem ? 'W' : scoreUs < scoreThem ? 'L' : 'T';
    }

    run(db, `UPDATE games SET team_org_id=?, team_id=?, opponent_name=?, score_us=?, score_them=?, result=? WHERE id=?`,
      [orgId, teamId, opponent, scoreUs, scoreThem, result, g.id]);
  }
}

async function getBracketGames(eventId) {
  const db = await getDb();
  return all(db, `
    SELECT * FROM games
    WHERE pg_event_id = ? AND game_type = 'bracket'
    ORDER BY bracket_name, bracket_round, game_time
  `, [eventId]);
}

async function upsertBracketGame({ pgGameId, pgEventId, teamOrgId, teamId, opponentName, gameDate, gameTime, field, scoreUs, scoreThem, result, bracketName, bracketRound, homeSeed, awaySeed }) {
  const db = await getDb();
  const sourceKey = `bracket-${pgEventId}-${pgGameId || gameDate + gameTime + opponentName}`;
  const existing = pgGameId ? get(db, 'SELECT id FROM games WHERE pg_game_id = ?', [pgGameId]) : get(db, 'SELECT id FROM games WHERE source_game_key = ?', [sourceKey]);

  if (existing) {
    run(db, `UPDATE games SET opponent_name=?, game_date=?, game_time=?, field=?, score_us=?, score_them=?, result=?,
      game_type='bracket', bracket_name=?, bracket_round=?, home_seed=?, away_seed=? WHERE id=?`,
      [opponentName, gameDate, gameTime, field, scoreUs, scoreThem, result, bracketName, bracketRound, homeSeed, awaySeed, existing.id]);
  } else {
    run(db, `INSERT INTO games (pg_game_id, pg_event_id, team_org_id, team_id, opponent_name, game_date, game_time, field,
      score_us, score_them, result, source, source_game_key, game_type, bracket_name, bracket_round, home_seed, away_seed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pg', ?, 'bracket', ?, ?, ?, ?)`,
      [pgGameId, pgEventId, teamOrgId, teamId, opponentName, gameDate, gameTime, field,
       scoreUs, scoreThem, result, sourceKey, bracketName, bracketRound, homeSeed, awaySeed]);
  }
}

// ── Spray Chart ───────────────────────────────────────────────────────────

async function getGameSprayChart(gameId) {
  const db = await getDb();
  return all(db, `
    SELECT player_name, team_side, outcome, hit_type, hit_x, hit_y, fielder, inning, half
    FROM plate_appearances
    WHERE game_id = ? AND hit_x IS NOT NULL
    ORDER BY pa_order
  `, [gameId]);
}

async function getGameScore(gameId) {
  const db = await getDb();
  // Get scorebook to know which side is home
  const sb = get(db, 'SELECT our_side FROM game_scorebook WHERE game_id = ?', [gameId]);
  // Sum runs_scored from plate_appearances grouped by half (top = away scoring, bottom = home scoring)
  const homeRuns = get(db, `SELECT COALESCE(SUM(runs_scored), 0) as runs FROM plate_appearances WHERE game_id = ? AND half = 'bottom'`, [gameId]);
  const awayRuns = get(db, `SELECT COALESCE(SUM(runs_scored), 0) as runs FROM plate_appearances WHERE game_id = ? AND half = 'top'`, [gameId]);
  return { homeScore: homeRuns?.runs ?? 0, awayScore: awayRuns?.runs ?? 0 };
}

async function getHalfInningStats(gameId, inning, half) {
  const db = await getDb();
  return get(db, `
    SELECT
      COALESCE(SUM(runs_scored), 0) as runs,
      SUM(CASE WHEN outcome IN ('1B','2B','3B','HR') THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN outcome = 'E' THEN 1 ELSE 0 END) as errors
    FROM plate_appearances
    WHERE game_id = ? AND inning = ? AND half = ?
  `, [gameId, inning, half]);
}

// ── Walkup Songs ──────────────────────────────────────────────────────────

async function getWalkupSong(orgId, teamId, playerName) {
  const db = await getDb();
  return get(db, 'SELECT * FROM player_walkup_songs WHERE pg_org_id = ? AND pg_team_id = ? AND player_name = ?', [orgId, teamId, playerName]);
}

async function upsertWalkupSong({ pgOrgId, pgTeamId, playerName, songType, filePath, youtubeUrl, youtubeVideoId, startSeconds, endSeconds, songTitle, artistName, uploadedBy, announce = 1, announceAudioPath = null, extractedAudioPath = null }) {
  const db = await getDb();
  run(db, `
    INSERT INTO player_walkup_songs (pg_org_id, pg_team_id, player_name, song_type, file_path, youtube_url, youtube_video_id, start_seconds, end_seconds, song_title, artist_name, uploaded_by, announce, announce_audio_path, extracted_audio_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pg_org_id, pg_team_id, player_name) DO UPDATE SET
      song_type=excluded.song_type, file_path=excluded.file_path, youtube_url=excluded.youtube_url,
      youtube_video_id=excluded.youtube_video_id, start_seconds=excluded.start_seconds,
      end_seconds=excluded.end_seconds, song_title=excluded.song_title, artist_name=excluded.artist_name,
      uploaded_by=excluded.uploaded_by, announce=excluded.announce,
      announce_audio_path=excluded.announce_audio_path, extracted_audio_path=excluded.extracted_audio_path,
      created_at=datetime('now')
  `, [pgOrgId, pgTeamId, playerName, songType, filePath ?? null, youtubeUrl ?? null, youtubeVideoId ?? null, startSeconds, endSeconds, songTitle ?? null, artistName ?? null, uploadedBy ?? null, announce ? 1 : 0, announceAudioPath ?? null, extractedAudioPath ?? null]);
}

async function deleteWalkupSong(orgId, teamId, playerName) {
  const db = await getDb();
  run(db, 'DELETE FROM player_walkup_songs WHERE pg_org_id = ? AND pg_team_id = ? AND player_name = ?', [orgId, teamId, playerName]);
}

// ── Soundboard ────────────────────────────────────────────────────────────

async function getTeamSoundboard(orgId, teamId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM team_soundboard WHERE pg_org_id = ? AND pg_team_id = ? ORDER BY sort_order', [orgId, teamId]);
}

async function upsertSoundboardButton({ pgOrgId, pgTeamId, buttonKey, label, emoji, youtubeVideoId, startSeconds, endSeconds, sortOrder, extractedAudioPath }) {
  const db = await getDb();
  run(db, `
    INSERT INTO team_soundboard (pg_org_id, pg_team_id, button_key, label, emoji, youtube_video_id, start_seconds, end_seconds, sort_order, extracted_audio_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pg_org_id, pg_team_id, button_key) DO UPDATE SET
      label=excluded.label, emoji=excluded.emoji, youtube_video_id=excluded.youtube_video_id,
      start_seconds=excluded.start_seconds, end_seconds=excluded.end_seconds, sort_order=excluded.sort_order,
      extracted_audio_path=excluded.extracted_audio_path
  `, [pgOrgId, pgTeamId, buttonKey, label, emoji ?? null, youtubeVideoId ?? null, startSeconds, endSeconds, sortOrder ?? 0, extractedAudioPath ?? null]);
}

// ── Playlist ──────────────────────────────────────────────────────────────

async function getTeamPlaylist(orgId, teamId) {
  const db = await getDb();
  return all(db, 'SELECT * FROM team_playlist WHERE pg_org_id = ? AND pg_team_id = ? ORDER BY sort_order, id', [orgId, teamId]);
}

async function insertPlaylistSong({ pgOrgId, pgTeamId, songTitle, artistName, youtubeVideoId, startSeconds, endSeconds, sortOrder, extractedAudioPath }) {
  const db = await getDb();
  const maxOrder = get(db, 'SELECT MAX(sort_order) as m FROM team_playlist WHERE pg_org_id = ? AND pg_team_id = ?', [pgOrgId, pgTeamId]);
  const nextOrder = sortOrder ?? ((maxOrder?.m ?? -1) + 1);
  db.run(
    `INSERT INTO team_playlist (pg_org_id, pg_team_id, song_title, artist_name, youtube_video_id, start_seconds, end_seconds, sort_order, extracted_audio_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pgOrgId, pgTeamId, songTitle, artistName ?? null, youtubeVideoId ?? null, startSeconds ?? 0, endSeconds ?? 180, nextOrder, extractedAudioPath ?? null]
  );
  const result = db.exec('SELECT last_insert_rowid() as id');
  const id = result[0].values[0][0];
  saveDb();
  return id;
}

async function updatePlaylistSong({ id, songTitle, artistName, youtubeVideoId, startSeconds, endSeconds, extractedAudioPath }) {
  const db = await getDb();
  run(db, `UPDATE team_playlist SET song_title=?, artist_name=?, youtube_video_id=?, start_seconds=?, end_seconds=?, extracted_audio_path=? WHERE id=?`,
    [songTitle, artistName ?? null, youtubeVideoId ?? null, startSeconds ?? 0, endSeconds ?? 180, extractedAudioPath ?? null, id]);
}

async function deletePlaylistSong(id) {
  const db = await getDb();
  run(db, 'DELETE FROM team_playlist WHERE id = ?', [id]);
}

// ── Users & Roles ─────────────────────────────────────────────────────────

async function createUser({ email, passwordHash, displayName }) {
  const db = await getDb();
  db.run(
    `INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)`,
    [email, passwordHash, displayName || null]
  );
  const result = db.exec('SELECT last_insert_rowid() as id');
  const id = result[0].values[0][0];
  saveDb();
  return id;
}

async function getUserByEmail(email) {
  const db = await getDb();
  return get(db, 'SELECT * FROM users WHERE email = ?', [email]);
}

async function getUserById(id) {
  const db = await getDb();
  return get(db, 'SELECT id, email, display_name, is_global_admin, contact_email, created_at FROM users WHERE id = ?', [id]);
}

async function getUserTeamRoles(userId) {
  const db = await getDb();
  return all(db, `
    SELECT utr.*, t.name as team_name, t.slug, t.logo_url, t.age_group
    FROM user_team_roles utr
    JOIN teams t ON t.pg_org_id = utr.pg_org_id AND t.pg_team_id = utr.pg_team_id
    WHERE utr.user_id = ?
    ORDER BY t.name
  `, [userId]);
}

async function getUserRoleForTeam(userId, orgId, teamId) {
  const db = await getDb();
  const row = get(db, 'SELECT role FROM user_team_roles WHERE user_id = ? AND pg_org_id = ? AND pg_team_id = ?', [userId, orgId, teamId]);
  return row ? row.role : null;
}

async function setUserTeamRole(userId, orgId, teamId, role) {
  const db = await getDb();
  run(db, `
    INSERT INTO user_team_roles (user_id, pg_org_id, pg_team_id, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, pg_org_id, pg_team_id) DO UPDATE SET role=excluded.role
  `, [userId, orgId, teamId, role]);
}

async function removeUserTeamRole(userId, orgId, teamId) {
  const db = await getDb();
  run(db, 'DELETE FROM user_team_roles WHERE user_id = ? AND pg_org_id = ? AND pg_team_id = ?', [userId, orgId, teamId]);
}

async function getTeamMembers(orgId, teamId) {
  const db = await getDb();
  return all(db, `
    SELECT u.id, u.email, u.display_name, utr.role, utr.created_at
    FROM user_team_roles utr
    JOIN users u ON u.id = utr.user_id
    WHERE utr.pg_org_id = ? AND utr.pg_team_id = ?
    ORDER BY utr.role, u.display_name
  `, [orgId, teamId]);
}

async function getTeamFromGameId(gameId) {
  const db = await getDb();
  return get(db, 'SELECT team_org_id, team_id FROM games WHERE id = ?', [gameId]);
}

// Stream config
async function getStreamConfig(orgId, teamId) {
  const db = await getDb();
  return get(db, `SELECT youtube_url, is_live FROM team_stream_config WHERE pg_org_id = ? AND pg_team_id = ?`, [orgId, teamId])
    || { youtube_url: null, is_live: 0 };
}

async function setStreamConfig(orgId, teamId, youtubeUrl, isLive) {
  const db = await getDb();
  run(db, `
    INSERT INTO team_stream_config (pg_org_id, pg_team_id, youtube_url, is_live, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(pg_org_id, pg_team_id) DO UPDATE SET
      youtube_url = excluded.youtube_url,
      is_live = excluded.is_live,
      updated_at = excluded.updated_at
  `, [orgId, teamId, youtubeUrl || null, isLive ? 1 : 0]);
}

module.exports = {
  upsertTeam, getTeam, getTeamBySlug, getAllTeams, registerTeam, searchTeams,
  upsertPlayer, getPlayers, setPlayerCardPath,
  upsertTournament, linkTeamTournament, getTeamTournaments, getTournament,
  upsertGame, createManualGame, getTeamGames, getGame, getGameByPgId, getTournamentGames,
  insertPitchCount, clearPitchCounts, clearTournamentPitchCounts, getGamePitchCounts, getTournamentPitchCounts, getTournamentPitcherTotals,
  getDailyPitchTotals, getGamesPitchTotals,
  upsertFtTournament, upsertFtGame, getCombinedRecord, getOpponentPitcherTotals,
  // Live scorebook
  getScorebookState, initScorebookState, updateScorebookState, startGame, endGame,
  getLineup, upsertLineupEntry, recordSubstitution,
  getInningScores, upsertInningScore,
  getPlateAppearances, insertPlateAppearance, updatePlateAppearanceOutcome,
  logPitch, getLivePitchCounts, deleteLastPitch, getFullScorebookState, getGameSprayChart, getGameScore, getHalfInningStats,
  touchTournamentLastScraped, claimBracketGamesForTeam, getBracketGames, upsertBracketGame,
  // Auth
  createUser, getUserByEmail, getUserById, getUserTeamRoles, getUserRoleForTeam,
  setUserTeamRole, removeUserTeamRole, getTeamMembers, getTeamFromGameId,
  // Walkup Songs
  getWalkupSong, upsertWalkupSong, deleteWalkupSong,
  // Soundboard
  getTeamSoundboard, upsertSoundboardButton,
  // Playlist
  getTeamPlaylist, insertPlaylistSong, updatePlaylistSong, deletePlaylistSong,
  // Stream config
  getStreamConfig, setStreamConfig,
};
