const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const queries = require('../db/queries');

// A valid YouTube video ID is exactly 11 chars of [A-Za-z0-9_-].
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Extract audio from a YouTube video and save as a trimmed MP3.
// Async + non-blocking: yt-dlp/ffmpeg run as child processes we await, so a
// single extraction can't stall the event loop for other requests.
async function extractYoutubeAudio(videoId, startSeconds, endSeconds, label) {
  try {
    // Reject anything that isn't a canonical YouTube ID before it reaches a
    // subprocess. Combined with execFile (no shell) this closes the command
    // injection vector entirely.
    if (!YOUTUBE_ID_RE.test(videoId)) {
      console.error(`[extract] Rejected invalid videoId: ${JSON.stringify(videoId)}`);
      return null;
    }
    const start = Number(startSeconds);
    const end = Number(endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      console.error(`[extract] Invalid clip range: ${startSeconds}-${endSeconds}`);
      return null;
    }
    const safeName = (label || videoId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `yt-${videoId}-${safeName}.mp3`;
    const walkupsDir = path.join(__dirname, '..', '..', 'data', 'walkups');
    if (!fs.existsSync(walkupsDir)) fs.mkdirSync(walkupsDir, { recursive: true });
    const outPath = path.join(walkupsDir, filename);
    const tempPath = outPath.replace('.mp3', '_full.%(ext)s');
    const fullMp3 = tempPath.replace('%(ext)s', 'mp3');
    try {
      // Pass every value as a discrete argv entry — no shell, no interpolation.
      await execFileAsync('yt-dlp', [
        '-x', '--audio-format', 'mp3',
        '-o', tempPath,
        `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 60000 });
      await execFileAsync('ffmpeg', [
        '-y', '-i', fullMp3,
        '-ss', String(start), '-t', String(end - start),
        '-acodec', 'libmp3lame', '-q:a', '2',
        outPath,
      ], { timeout: 30000 });
    } finally {
      // Always clean up the full-length download, even if the trim step fails.
      try { fs.unlinkSync(fullMp3); } catch (e) {}
    }
    console.log(`[extract] Audio: ${filename}`);
    return filename;
  } catch (err) {
    console.error(`[extract] Failed for ${videoId}: ${err.message}`);
    return null;
  }
}
const { scrapeAll } = require('../scrapers/run');
const { scrapeTournamentSchedule } = require('../scrapers/tournament');
const { requireAuth, requireTeamRole, validateTeamParams } = require('../middleware/auth');

const dataDir = path.join(__dirname, '..', '..', 'data');

// ── ElevenLabs PA Announcer ────────────────────────────────────────────────────

async function generateAnnouncement(orgId, teamId, playerName, playerNumber) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Adam — deep, authoritative
  const numStr = playerNumber ? ` number ${playerNumber},` : '';
  const text = `Now batting,${numStr} ${playerName}!`;
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true },
        speed: 0.82,
      },
      {
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
      }
    );
    const slug = playerName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const dir = path.join(dataDir, 'walkups', String(orgId), String(teamId));
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${slug}-announce.mp3`;
    fs.writeFileSync(path.join(dir, filename), Buffer.from(response.data));
    return `${orgId}/${teamId}/${filename}`;
  } catch (err) {
    console.error('[ElevenLabs] announcement generation failed:', err.message);
    return null;
  }
}

const walkupStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(dataDir, 'walkups', req.params.orgId, req.params.teamId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const slug = decodeURIComponent(req.params.playerName).toLowerCase().replace(/[^a-z0-9]/g, '-');
    cb(null, `${slug}${ext}`);
  },
});

const uploadWalkup = multer({
  storage: walkupStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp3', '.m4a'].includes(ext)) cb(null, true);
    else cb(new Error('Only .mp3 and .m4a files are allowed'));
  },
});

// GET /api/teams - list all registered teams
router.get('/teams', async (req, res) => {
  try {
    const teams = await queries.getAllTeams();
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teams/by-slug/:slug - get team by URL slug
router.get('/teams/by-slug/:slug', async (req, res) => {
  try {
    const team = await queries.getTeamBySlug(req.params.slug);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const combinedRecord = await queries.getCombinedRecord(team.pg_org_id, team.pg_team_id);
    const players = await queries.getPlayers(team.pg_org_id, team.pg_team_id);
    res.json({ ...team, players, combinedRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams - register a new team (requires auth, creator becomes admin)
router.post('/teams', requireAuth, async (req, res) => {
  try {
    const { slug, pgOrgId, pgTeamId, name, ageGroup, ftTeamUuid, ftSeasons, ftBaseUrl, logoUrl } = req.body;
    if (!slug || !pgOrgId || !pgTeamId) return res.status(400).json({ error: 'slug, pgOrgId, pgTeamId required' });

    // pg IDs must be positive integers.
    const orgId = Number(pgOrgId);
    const teamId = Number(pgTeamId);
    if (!Number.isInteger(orgId) || orgId <= 0 || !Number.isInteger(teamId) || teamId <= 0) {
      return res.status(400).json({ error: 'pgOrgId and pgTeamId must be positive integers' });
    }

    // Prevent takeover: only a global admin may re-register (and thus re-slug /
    // grant themselves admin over) a team that already exists. Open registration
    // is limited to genuinely new teams.
    const existing = await queries.getTeam(orgId, teamId);
    if (existing && !req.user.is_global_admin) {
      return res.status(409).json({ error: 'Team already registered' });
    }

    await queries.registerTeam({ slug, pgOrgId: orgId, pgTeamId: teamId, name: name || '', ageGroup: ageGroup || '', ftTeamUuid, ftSeasons, ftBaseUrl, logoUrl });
    // Auto-assign admin role to creator
    await queries.setUserTeamRole(req.user.id, orgId, teamId, 'admin');
    res.json({ status: 'ok', slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pitch count rules by age group
const PITCH_RULES = {
  '8U':  { dailyMax: 50,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }] },
  '9U':  { dailyMax: 75,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 66, rest: 4 }] },
  '10U': { dailyMax: 75,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 66, rest: 4 }] },
  '11U': { dailyMax: 85,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 66, rest: 4 }] },
  '12U': { dailyMax: 85,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 66, rest: 4 }] },
  '13U': { dailyMax: 95,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 66, rest: 4 }] },
  '14U': { dailyMax: 95,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 66, rest: 4 }] },
  '15U': { dailyMax: 95,  thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 76, rest: 4 }] },
  '16U': { dailyMax: 105, thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 76, rest: 4 }] },
  '17U': { dailyMax: 105, thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 76, rest: 4 }] },
  '18U': { dailyMax: 105, thresholds: [{ pitches: 1, rest: 0 }, { pitches: 21, rest: 1 }, { pitches: 36, rest: 2 }, { pitches: 51, rest: 3 }, { pitches: 76, rest: 4 }] },
};

// GET /api/pitch-rules/:ageGroup
router.get('/pitch-rules/:ageGroup', (req, res) => {
  const rules = PITCH_RULES[req.params.ageGroup.toUpperCase()];
  if (!rules) return res.status(404).json({ error: 'Unknown age group' });
  res.json(rules);
});

// GET /api/pitch-rules
router.get('/pitch-rules', (req, res) => {
  res.json(PITCH_RULES);
});

// GET /api/teams/:orgId/:teamId
router.get('/teams/:orgId/:teamId', async (req, res) => {
  try {
    const team = await queries.getTeam(parseInt(req.params.orgId), parseInt(req.params.teamId));
    if (!team) return res.status(404).json({ error: 'Team not found. Try scraping first.' });
    const players = await queries.getPlayers(team.pg_org_id, team.pg_team_id);
    const combinedRecord = await queries.getCombinedRecord(parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json({ ...team, players, combinedRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teams/:orgId/:teamId/schedule
router.get('/teams/:orgId/:teamId/schedule', async (req, res) => {
  try {
    const orgId = parseInt(req.params.orgId);
    const teamId = parseInt(req.params.teamId);
    const games = await queries.getTeamGames(orgId, teamId);
    const tournaments = await queries.getTeamTournaments(orgId, teamId);

    // Get pitch count totals per game
    const gameIds = games.map(g => g.id);
    const pitchTotals = await queries.getGamesPitchTotals(gameIds);

    // Attach pitch totals to games
    const gamesWithPitches = games.map(g => ({
      ...g,
      totalPitches: pitchTotals[g.id]?.totalPitches || 0,
      pitcherCount: pitchTotals[g.id]?.pitcherCount || 0,
    }));

    // Group games by tournament
    const grouped = {};
    for (const t of tournaments) {
      grouped[t.pg_event_id] = { tournament: t, games: [] };
    }
    for (const g of gamesWithPitches) {
      if (g.pg_event_id && grouped[g.pg_event_id]) {
        grouped[g.pg_event_id].games.push(g);
      }
    }

    res.json({ tournaments: Object.values(grouped), ungroupedGames: gamesWithPitches.filter(g => !g.pg_event_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teams/:orgId/:teamId/tournaments
router.get('/teams/:orgId/:teamId/tournaments', async (req, res) => {
  try {
    const tournaments = await queries.getTeamTournaments(parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teams/search?q=name
router.get('/teams/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (q.length < 2) return res.json([]);
    const teams = await queries.searchTeams(q);
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId
router.get('/games/:gameId', async (req, res) => {
  try {
    const game = await queries.getGame(parseInt(req.params.gameId));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    const pitchCounts = await queries.getGamePitchCounts(game.id);
    res.json({ ...game, pitchCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/pitchcounts
router.get('/games/:gameId/pitchcounts', async (req, res) => {
  try {
    const pitchCounts = await queries.getGamePitchCounts(parseInt(req.params.gameId));
    res.json(pitchCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/daily-totals
router.get('/games/:gameId/daily-totals', async (req, res) => {
  try {
    const totals = await queries.getDailyPitchTotals(parseInt(req.params.gameId));
    res.json(totals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/opponent-pitchers
router.get('/games/:gameId/opponent-pitchers', async (req, res) => {
  try {
    const game = await queries.getGame(parseInt(req.params.gameId));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!game.pg_event_id) {
      return res.json({ opponentName: game.opponent_name || 'Unknown', opponentPitchers: [], ourPitchers: [] });
    }
    // Get our team name from pitch counts (it's stored as team_name)
    const team = await queries.getTeam(game.team_org_id, game.team_id);
    const ourTeamName = team ? team.name : '';
    const opponentPitchers = game.opponent_name ? await queries.getOpponentPitcherTotals(game.pg_event_id, game.opponent_name) : [];
    const ourPitchers = ourTeamName ? await queries.getOpponentPitcherTotals(game.pg_event_id, ourTeamName) : [];
    res.json({ opponentName: game.opponent_name, ourTeamName, opponentPitchers, ourPitchers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:eventId
router.get('/tournaments/:eventId', async (req, res) => {
  try {
    const tournament = await queries.getTournament(parseInt(req.params.eventId));
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const games = await queries.getTournamentGames(tournament.pg_event_id);
    res.json({ ...tournament, games });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:eventId/full-schedule - scrape all games from PG event page
router.get('/tournaments/:eventId/full-schedule', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const tournament = await queries.getTournament(eventId);
    // Only scrape PG tournament schedules (FT doesn't have accessible schedule pages)
    if (tournament && tournament.source === 'ft') {
      return res.json({ tournament, games: [] });
    }
    const games = await scrapeTournamentSchedule(eventId);
    res.json({ tournament, games });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/:eventId/sync - re-scrape a single tournament
router.post('/tournaments/:eventId/sync', requireAuth, async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const tournament = await queries.getTournament(eventId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    res.json({ status: 'started' });

    // Run in background
    (async () => {
      try {
        if (tournament.source === 'ft') {
          // FT tournaments: re-scrape via the FT scraper for each registered team
          const allTeams = await queries.getAllTeams();
          for (const team of allTeams) {
            if (!team.ft_team_uuid) continue;
            const { scrapeFtEventSchedule, ftEventHash } = require('../scrapers/fivetool');
            // Extract slug + site from pg_url (FT tournaments may live on either FT site)
            const slugMatch = tournament.pg_url?.match(/\/events\/([^/]+)/);
            const ftBase = tournament.pg_url ? new URL(tournament.pg_url).origin : undefined;
            if (slugMatch) {
              const games = await scrapeFtEventSchedule(slugMatch[1], team.name, ftBase);
              for (const g of games) {
                const sourceKey = `ft-${eventId}-${g.gameDate}-${g.gameTime}-${g.opponentName}`;
                await queries.upsertFtGame({
                  sourceGameKey: sourceKey, pgEventId: eventId,
                  teamOrgId: team.pg_org_id, teamId: team.pg_team_id,
                  opponentName: g.opponentName, gameDate: g.gameDate, gameTime: g.gameTime,
                  field: g.field, scoreUs: g.scoreUs, scoreThem: g.scoreThem, result: g.result,
                });
              }
            }
          }
        } else {
          // PG tournaments: scrape TournamentSchedule.aspx (all dates, pool + bracket)
          const { scrapeTournamentPage, scrapePitchingReport, scrapeTournamentScheduleFull } = require('../scrapers/tournament');

          await scrapeTournamentPage(eventId);

          // Get all games from all dates via TournamentSchedule.aspx
          const allScrapedGames = await scrapeTournamentScheduleFull(eventId);
          const allTeams = await queries.getAllTeams();

          // Match each game to registered teams by exact name
          for (const sg of allScrapedGames) {
            for (const team of allTeams) {
              const tn = (team.name || '').toLowerCase();
              const t1 = sg.team1.toLowerCase();
              const t2 = sg.team2.toLowerCase();

              if (t1 !== tn && t2 !== tn) continue;

              const weAreTeam1 = t1 === tn;
              const opponentName = weAreTeam1 ? sg.team2 : sg.team1;
              const scoreUs = weAreTeam1 ? sg.score1 : sg.score2;
              const scoreThem = weAreTeam1 ? sg.score2 : sg.score1;
              let result = null;
              if (scoreUs != null && scoreThem != null) {
                result = scoreUs > scoreThem ? 'W' : scoreUs < scoreThem ? 'L' : 'T';
              }

              await queries.upsertGame({
                pgGameId: sg.pgGameId, pgEventId: eventId,
                teamOrgId: team.pg_org_id, teamId: team.pg_team_id,
                opponentName, opponentOrgId: null, opponentTeamId: null,
                gameDate: sg.gameDate || '', gameTime: sg.gameTime || '', field: sg.field || '',
                scoreUs, scoreThem, result,
                pgBoxUrl: sg.pgBoxUrl, pgRecapUrl: '',
              });
            }
          }

          // Refresh pitch counts
          const pitchData = await scrapePitchingReport(eventId);
          if (pitchData.length > 0) await queries.clearTournamentPitchCounts(eventId);
          for (const entry of pitchData) {
            await queries.insertPitchCount({
              gameId: null, pgEventId: eventId,
              playerName: entry.playerName, teamName: entry.teamName,
              pitches: entry.pitches, innings: entry.innings,
              strikeouts: entry.strikeouts, walks: entry.walks,
            });
          }
        }
        await queries.touchTournamentLastScraped(eventId);
        console.log(`[api] Tournament ${eventId} sync complete`);
      } catch (err) {
        console.error(`[api] Tournament ${eventId} sync error: ${err.message}`);
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:eventId/teams - get teams registered for a tournament
router.get('/tournaments/:eventId/teams', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const tournament = await queries.getTournament(eventId);

    const ageGroup = req.query.ageGroup || '';

    if (tournament && tournament.source === 'ft') {
      const { scrapeFtEventTeams } = require('../scrapers/fivetool');
      const slugMatch = tournament.pg_url?.match(/\/events\/([^/]+)/);
      const ftBase = tournament.pg_url ? new URL(tournament.pg_url).origin : undefined;
      if (slugMatch) {
        const result = await scrapeFtEventTeams(slugMatch[1], ageGroup, ftBase);
        return res.json(result);
      }
      return res.json({ teams: [], venues: [] });
    }

    // PG: try to extract teams from existing games in DB
    const games = await queries.getTournamentGames(eventId);
    if (games.length > 0) {
      const teamSet = new Map();
      for (const g of games) {
        if (g.opponent_name) teamSet.set(g.opponent_name.toLowerCase(), { name: g.opponent_name });
      }
      return res.json({ teams: [...teamSet.values()].sort((a, b) => a.name.localeCompare(b.name)), venues: [] });
    }

    // PG: try scraping team links from event page
    const { scrapeRegisteredTeams } = require('../scrapers/tournament');
    const teams = await scrapeRegisteredTeams(eventId);
    res.json({ teams, venues: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:eventId/bracket - get or scrape bracket games
router.get('/tournaments/:eventId/bracket', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const tournament = await queries.getTournament(eventId);

    // FT tournaments have no brackets
    if (tournament && tournament.source === 'ft') {
      return res.json({ tournament, brackets: [] });
    }

    // Try DB first
    let bracketGames = await queries.getBracketGames(eventId);

    // If no bracket games in DB, try live scrape
    if (bracketGames.length === 0) {
      const { scrapeBracketGames } = require('../scrapers/tournament');
      const scraped = await scrapeBracketGames(eventId);

      // Store scraped bracket games
      for (const g of scraped) {
        if (g.homeTeam && g.awayTeam) {
          await queries.upsertBracketGame({
            pgGameId: g.pgGameId,
            pgEventId: eventId,
            teamOrgId: 0,
            teamId: 0,
            opponentName: `${g.homeTeam.name} vs ${g.awayTeam.name}`,
            gameDate: g.gameDate,
            gameTime: g.gameTime,
            field: g.field,
            scoreUs: g.homeTeam.score,
            scoreThem: g.awayTeam.score,
            result: null,
            bracketName: g.bracketName,
            bracketRound: g.round,
            homeSeed: g.homeTeam.seed,
            awaySeed: g.awayTeam.seed,
          });
        }
      }

      // Return scraped data directly (richer than DB)
      // Group by bracket name
      const grouped = {};
      for (const g of scraped) {
        const name = g.bracketName || 'Bracket';
        if (!grouped[name]) grouped[name] = [];
        grouped[name].push(g);
      }
      return res.json({ tournament, brackets: Object.entries(grouped).map(([name, games]) => ({ name, games })) });
    }

    // Group DB results by bracket name
    const grouped = {};
    for (const g of bracketGames) {
      const name = g.bracket_name || 'Bracket';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push(g);
    }
    res.json({ tournament, brackets: Object.entries(grouped).map(([name, games]) => ({ name, games })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:eventId/pitching-report
router.get('/tournaments/:eventId/pitching-report', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    // FT tournaments have no pitch count data
    const tournament = await queries.getTournament(eventId);
    if (tournament && tournament.source === 'ft') {
      return res.json({ totals: [], details: [] });
    }
    const totals = await queries.getTournamentPitcherTotals(eventId);
    const details = await queries.getTournamentPitchCounts(eventId);
    res.json({ totals, details });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games - create a manual game for live scoring
router.post('/games', requireAuth, async (req, res) => {
  try {
    const { teamOrgId, teamId, opponentName } = req.body;
    if (!teamOrgId || !teamId || !opponentName) return res.status(400).json({ error: 'teamOrgId, teamId, and opponentName required' });
    const today = new Date().toISOString().split('T')[0];
    const gameId = await queries.createManualGame({ teamOrgId: parseInt(teamOrgId), teamId: parseInt(teamId), opponentName, gameDate: today });
    res.json({ gameId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Live Scorebook ────────────────────────────────────────────────────────────

const requireScorekeeper = requireTeamRole(['admin', 'scorekeeper']);

// POST /api/games/:gameId/fetch-score - scrape score from PG for a single game
router.post('/games/:gameId/fetch-score', requireScorekeeper, async (req, res) => {
  try {
    const game = await queries.getGame(parseInt(req.params.gameId));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!game.pg_game_id) return res.json({ error: 'No PG game ID' });

    const { scrapeGameScore } = require('../scrapers/game');
    const score = await scrapeGameScore(game.pg_game_id);
    if (!score || !score.isFinal) return res.json({ score: null, message: 'Game not final or no score found' });

    // Determine which side is ours
    const team = await queries.getTeam(game.team_org_id, game.team_id);
    const teamName = (team?.name || '').toLowerCase();
    const homeIsUs = score.homeName.toLowerCase().includes(teamName) || teamName.includes(score.homeName.toLowerCase());
    const scoreUs = homeIsUs ? score.homeScore : score.visitorScore;
    const scoreThem = homeIsUs ? score.visitorScore : score.homeScore;
    const result = scoreUs > scoreThem ? 'W' : scoreUs < scoreThem ? 'L' : 'T';

    // Update game in DB
    await queries.upsertGame({
      pgGameId: game.pg_game_id, pgEventId: game.pg_event_id,
      teamOrgId: game.team_org_id, teamId: game.team_id,
      opponentName: game.opponent_name,
      opponentOrgId: game.opponent_org_id, opponentTeamId: game.opponent_team_id,
      gameDate: game.game_date, gameTime: game.game_time, field: game.field,
      scoreUs, scoreThem, result,
      pgBoxUrl: game.pg_box_url, pgRecapUrl: game.pg_recap_url || '',
    });

    res.json({ scoreUs, scoreThem, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/score
router.get('/games/:gameId/score', async (req, res) => {
  try {
    const score = await queries.getGameScore(parseInt(req.params.gameId));
    res.json(score);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/spray-chart
router.get('/games/:gameId/spray-chart', async (req, res) => {
  try {
    const data = await queries.getGameSprayChart(parseInt(req.params.gameId));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/scorebook
router.get('/games/:gameId/scorebook', async (req, res) => {
  try {
    const data = await queries.getFullScorebookState(parseInt(req.params.gameId));
    if (!data) return res.status(404).json({ scorebook: null });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:gameId/live-pitch-counts
router.get('/games/:gameId/live-pitch-counts', async (req, res) => {
  try {
    const counts = await queries.getLivePitchCounts(parseInt(req.params.gameId));
    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:gameId/scorebook/init
router.post('/games/:gameId/scorebook/init', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { homeTeamName, awayTeamName, ourSide } = req.body;
    await queries.initScorebookState({ gameId, homeTeamName, awayTeamName, ourSide: ourSide || 'home' });
    const state = await queries.getScorebookState(gameId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:gameId/scorebook/start
router.post('/games/:gameId/scorebook/start', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    await queries.startGame(gameId);
    const state = await queries.getScorebookState(gameId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/games/:gameId/scorebook/state
router.put('/games/:gameId/scorebook/state', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { inning, half, outs, balls, strikes, runner1b, runner2b, runner3b, status } = req.body;
    await queries.updateScorebookState({ gameId, status, inning, half, outs, balls, strikes, runner1b, runner2b, runner3b });
    const state = await queries.getScorebookState(gameId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/games/:gameId/scorebook/lineup
router.put('/games/:gameId/scorebook/lineup', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { teamSide, entries } = req.body;
    for (const e of entries) {
      if (e.playerName) {
        await queries.upsertLineupEntry({ gameId, teamSide, battingOrder: e.battingOrder, playerName: e.playerName, jerseyNumber: e.jerseyNumber, position: e.position });
      }
    }
    const lineup = await queries.getLineup(gameId, teamSide);
    res.json(lineup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/games/:gameId/scorebook/inning/:inning/:half
router.put('/games/:gameId/scorebook/inning/:inning/:half', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const inning = parseInt(req.params.inning);
    const half = req.params.half;
    const { runs, hits, errors } = req.body;
    await queries.upsertInningScore({ gameId, inning, half, runs: runs ?? 0, hits: hits ?? 0, errors: errors ?? 0 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:gameId/scorebook/plate-appearance
router.post('/games/:gameId/scorebook/plate-appearance', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { inning, half, battingOrderPos, teamSide, playerName, pitcherName } = req.body;
    const paId = await queries.insertPlateAppearance({ gameId, inning, half, battingOrderPos, teamSide, playerName, pitcherName });
    res.json({ paId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/games/:gameId/scorebook/plate-appearance/:paId
router.put('/games/:gameId/scorebook/plate-appearance/:paId', requireScorekeeper, async (req, res) => {
  try {
    const paId = parseInt(req.params.paId);
    const { outcome, rbi, pitchSequence, hitType, hitX, hitY, fielder, runsScored } = req.body;
    await queries.updatePlateAppearanceOutcome({ paId, outcome, rbi, pitchSequence, hitType, hitX, hitY, fielder, runsScored });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:gameId/scorebook/pitch
router.post('/games/:gameId/scorebook/pitch', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { paId, pitcherName, pitcherTeamSide, pitchType, inning, half } = req.body;
    await queries.logPitch({ gameId, paId, pitcherName, pitcherTeamSide, pitchType, inning, half });
    const pitchCounts = await queries.getLivePitchCounts(gameId);
    res.json({ ok: true, pitchCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/games/:gameId/scorebook/pitch/last
router.delete('/games/:gameId/scorebook/pitch/last', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    await queries.deleteLastPitch(gameId);
    const pitchCounts = await queries.getLivePitchCounts(gameId);
    res.json({ ok: true, pitchCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:gameId/scorebook/substitution
router.post('/games/:gameId/scorebook/substitution', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { teamSide, battingOrder, newPlayerName, jerseyNumber, position } = req.body;
    await queries.recordSubstitution({ gameId, teamSide, battingOrder, newPlayerName, jerseyNumber, position });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:gameId/scorebook/end
router.post('/games/:gameId/scorebook/end', requireScorekeeper, async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const sbState = await queries.getScorebookState(gameId);
    const inningScores = await queries.getInningScores(gameId);
    const ourHalf = sbState?.our_side === 'home' ? 'bottom' : 'top';
    const themHalf = sbState?.our_side === 'home' ? 'top' : 'bottom';
    const scoreUs = inningScores.filter(s => s.half === ourHalf).reduce((sum, s) => sum + s.runs, 0);
    const scoreThem = inningScores.filter(s => s.half === themHalf).reduce((sum, s) => sum + s.runs, 0);
    await queries.endGame(gameId, scoreUs, scoreThem);
    const game = await queries.getGame(gameId);
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Team Member Management ───────────────────────────────────────────────────

const requireAdmin = requireTeamRole(['admin']);

// GET /api/teams/:orgId/:teamId/members
router.get('/teams/:orgId/:teamId/members', requireAdmin, async (req, res) => {
  try {
    const members = await queries.getTeamMembers(parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/:orgId/:teamId/members - add member by email
router.post('/teams/:orgId/:teamId/members', requireAdmin, async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'email and role required' });
    if (!['admin', 'scorekeeper', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const user = await queries.getUserByEmail(email.toLowerCase());
    if (!user) return res.status(404).json({ error: 'No user found with that email' });
    await queries.setUserTeamRole(user.id, parseInt(req.params.orgId), parseInt(req.params.teamId), role);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/teams/:orgId/:teamId/members/:userId - update role
router.put('/teams/:orgId/:teamId/members/:userId', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['admin', 'scorekeeper', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await queries.setUserTeamRole(parseInt(req.params.userId), parseInt(req.params.orgId), parseInt(req.params.teamId), role);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teams/:orgId/:teamId/members/:userId - remove member
router.delete('/teams/:orgId/:teamId/members/:userId', requireAdmin, async (req, res) => {
  try {
    await queries.removeUserTeamRole(parseInt(req.params.userId), parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/:orgId/:teamId/join - self-join as viewer
router.post('/teams/:orgId/:teamId/join', requireAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.orgId);
    const teamId = parseInt(req.params.teamId);
    // Check team exists
    const team = await queries.getTeam(orgId, teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    // Add as viewer (won't overwrite existing higher role due to UPSERT)
    const existing = await queries.getUserRoleForTeam(req.user.id, orgId, teamId);
    if (!existing) {
      await queries.setUserTeamRole(req.user.id, orgId, teamId, 'viewer');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/:orgId/:teamId/leave - self-remove from team
router.post('/teams/:orgId/:teamId/leave', requireAuth, async (req, res) => {
  try {
    await queries.removeUserTeamRole(req.user.id, parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/:slug - trigger manual scrape for a team by slug
router.post('/scrape/:slug', requireAuth, async (req, res) => {
  try {
    const { scrapeBySlug } = require('../scrapers/run');
    res.json({ status: 'started', message: 'Scrape started in background' });
    scrapeBySlug(req.params.slug).catch(err => {
      console.error(`[api] Background scrape failed: ${err.message}`);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape - scrape all registered teams
router.post('/scrape', requireAuth, async (req, res) => {
  try {
    const { scrapeAllTeams } = require('../scrapers/run');
    res.json({ status: 'started', message: 'Scraping all teams in background' });
    scrapeAllTeams().catch(err => {
      console.error(`[api] Background scrape-all failed: ${err.message}`);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Soundboard + Playlist ─────────────────────────────────────────────────

const SOUNDBOARD_DEFAULTS = [
  { key: 'mound_visit', label: 'Mound Visit', emoji: '⏰', hint: 'Search: "Jeopardy think music"',               youtube_video_id: 'vWuQVpBeqLs', suggestedStart: 0,  suggestedEnd: 30 },
  { key: 'bad_call',    label: 'Bad Call',     emoji: '🙈', hint: 'Search: "3 blind mice nursery rhyme"',        youtube_video_id: null,          suggestedStart: 0,  suggestedEnd: 12 },
  { key: 'wah_wah',     label: 'Wah Wah',      emoji: '😢', hint: 'Search: "sad trombone sound effect"',         youtube_video_id: 'CQeezCdF4mk', suggestedStart: 0,  suggestedEnd: 4  },
  { key: 'charge',      label: 'CHARGE!',       emoji: '🎺', hint: 'Search: "charge bugle baseball stadium"',    youtube_video_id: null,          suggestedStart: 0,  suggestedEnd: 5  },
  { key: 'strikeout',   label: 'Strikeout',     emoji: '🔥', hint: 'Search: "strikeout sound effect baseball"',  youtube_video_id: null,          suggestedStart: 0,  suggestedEnd: 5  },
  { key: 'walk',        label: 'Walk',          emoji: '🚶', hint: 'Search: "na na hey hey kiss him goodbye"',   youtube_video_id: 'jsaTElBljOE', suggestedStart: 0,  suggestedEnd: 15 },
  { key: 'rally',       label: 'RALLY!',        emoji: '⚡', hint: 'Search: "we will rock you queen stomp"',    youtube_video_id: '-tJYN-eG1zk', suggestedStart: 0,  suggestedEnd: 8  },
  { key: 'ymca',        label: 'YMCA',          emoji: '🕺', hint: 'Search: "YMCA village people chorus"',      youtube_video_id: 'CS9OO0S5w2k', suggestedStart: 46, suggestedEnd: 65 },
  { key: 'homerun',     label: 'Home Run!',     emoji: '💥', hint: 'Search: "Sweet Caroline Neil Diamond"',     youtube_video_id: '1vhFnTjia_I', suggestedStart: 62, suggestedEnd: 77 },
  { key: 'seventh',     label: '7th Inning',    emoji: '⚾', hint: 'Search: "take me out to the ballgame"',     youtube_video_id: null,          suggestedStart: 0,  suggestedEnd: 30 },
  { key: 'circus',      label: 'Clown Show',    emoji: '🎪', hint: 'Search: "circus calliope clown music"',     youtube_video_id: null,          suggestedStart: 0,  suggestedEnd: 10 },
  { key: 'walk_off',    label: 'Walk-Off!',     emoji: '🏆', hint: 'Search: "eye of the tiger survivor intro"', youtube_video_id: 'btPJPFnesV4', suggestedStart: 0,  suggestedEnd: 6  },
];

// GET /api/teams/:orgId/:teamId/soundboard (public)
router.get('/teams/:orgId/:teamId/soundboard', async (req, res) => {
  try {
    const rows = await queries.getTeamSoundboard(parseInt(req.params.orgId), parseInt(req.params.teamId));
    const byKey = {};
    for (const r of rows) byKey[r.button_key] = r;
    const merged = SOUNDBOARD_DEFAULTS.map((d, i) => ({
      ...d, sort_order: i, ...(byKey[d.key] || {}), button_key: d.key,
    }));
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/teams/:orgId/:teamId/soundboard/:buttonKey
router.put('/teams/:orgId/:teamId/soundboard/:buttonKey',
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      const { orgId, teamId, buttonKey } = req.params;
      const { youtubeUrl, startSeconds, endSeconds } = req.body;
      const videoId = youtubeUrl?.match(/(?:watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1] || null;
      const def = SOUNDBOARD_DEFAULTS.find(d => d.key === buttonKey);
      if (!def) return res.status(404).json({ error: 'Unknown button key' });
      const start = parseFloat(startSeconds) ?? def.suggestedStart;
      const end = parseFloat(endSeconds) ?? def.suggestedEnd;
      const extractedAudioPath = videoId ? await extractYoutubeAudio(videoId, start, end, buttonKey) : null;
      await queries.upsertSoundboardButton({
        pgOrgId: parseInt(orgId), pgTeamId: parseInt(teamId),
        buttonKey, label: def.label, emoji: def.emoji,
        youtubeVideoId: videoId,
        startSeconds: start, endSeconds: end,
        sortOrder: SOUNDBOARD_DEFAULTS.indexOf(def),
        extractedAudioPath,
      });
      res.json({ status: 'ok', videoId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/teams/:orgId/:teamId/playlist (public)
router.get('/teams/:orgId/:teamId/playlist', async (req, res) => {
  try {
    const songs = await queries.getTeamPlaylist(parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json(songs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/:orgId/:teamId/playlist
router.post('/teams/:orgId/:teamId/playlist',
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      const { orgId, teamId } = req.params;
      const { youtubeUrl, songTitle, artistName, startSeconds, endSeconds } = req.body;
      if (!songTitle) return res.status(400).json({ error: 'songTitle required' });
      const videoId = youtubeUrl?.match(/(?:watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1] || null;
      const start = parseFloat(startSeconds) || 0;
      const end = parseFloat(endSeconds) || 180;
      const extractedAudioPath = videoId ? await extractYoutubeAudio(videoId, start, end, songTitle) : null;
      const id = await queries.insertPlaylistSong({
        pgOrgId: parseInt(orgId), pgTeamId: parseInt(teamId),
        songTitle, artistName: artistName || null, youtubeVideoId: videoId,
        startSeconds: start, endSeconds: end, extractedAudioPath,
      });
      res.json({ status: 'ok', id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /api/teams/:orgId/:teamId/playlist/:id
router.put('/teams/:orgId/:teamId/playlist/:id',
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      const { youtubeUrl, songTitle, artistName, startSeconds, endSeconds } = req.body;
      const videoId = youtubeUrl?.match(/(?:watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1] || null;
      const start = parseFloat(startSeconds) || 0;
      const end = parseFloat(endSeconds) || 180;
      const extractedAudioPath = videoId ? await extractYoutubeAudio(videoId, start, end, songTitle) : null;
      await queries.updatePlaylistSong({
        id: parseInt(req.params.id), songTitle, artistName: artistName || null,
        youtubeVideoId: videoId,
        startSeconds: start, endSeconds: end, extractedAudioPath,
      });
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/teams/:orgId/:teamId/playlist/:id
router.delete('/teams/:orgId/:teamId/playlist/:id',
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      await queries.deletePlaylistSong(parseInt(req.params.id));
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Walkup Songs ──────────────────────────────────────────────────────────

// GET /api/teams/:orgId/:teamId/players/:playerName/walkup-song (public)
router.get('/teams/:orgId/:teamId/players/:playerName/walkup-song', async (req, res) => {
  try {
    const song = await queries.getWalkupSong(
      parseInt(req.params.orgId),
      parseInt(req.params.teamId),
      decodeURIComponent(req.params.playerName)
    );
    res.json(song || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/:orgId/:teamId/players/:playerName/walkup-song/upload
router.post('/teams/:orgId/:teamId/players/:playerName/walkup-song/upload',
  validateTeamParams,
  requireTeamRole(['admin', 'scorekeeper']),
  uploadWalkup.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const { orgId, teamId, playerName } = req.params;
      const filePath = `${orgId}/${teamId}/${req.file.filename}`;
      const shouldAnnounce = req.body.announce !== '0' && req.body.announce !== 'false';
      const decodedName = decodeURIComponent(playerName);
      const announceAudioPath = shouldAnnounce
        ? await generateAnnouncement(parseInt(orgId), parseInt(teamId), decodedName, req.body.playerNumber || null)
        : null;
      await queries.upsertWalkupSong({
        pgOrgId: parseInt(orgId),
        pgTeamId: parseInt(teamId),
        playerName: decodedName,
        songType: 'upload',
        filePath,
        youtubeUrl: null,
        youtubeVideoId: null,
        startSeconds: parseFloat(req.body.startSeconds) || 0,
        endSeconds: parseFloat(req.body.endSeconds) || 45,
        songTitle: req.body.title || null,
        artistName: req.body.artist || null,
        uploadedBy: req.user.id,
        announce: shouldAnnounce,
        announceAudioPath,
      });
      res.json({ status: 'ok', filePath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/teams/:orgId/:teamId/players/:playerName/walkup-song/youtube
router.post('/teams/:orgId/:teamId/players/:playerName/walkup-song/youtube',
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      const { orgId, teamId, playerName } = req.params;
      const { youtubeUrl, startSeconds, endSeconds, title, artist, announce, playerNumber } = req.body;
      if (!youtubeUrl) return res.status(400).json({ error: 'youtubeUrl required' });
      const videoId = youtubeUrl.match(/(?:watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1];
      if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });
      const shouldAnnounce = announce !== false && announce !== 0;
      const decodedName = decodeURIComponent(playerName);
      const announceAudioPath = shouldAnnounce
        ? await generateAnnouncement(parseInt(orgId), parseInt(teamId), decodedName, playerNumber || null)
        : null;
      const start = parseFloat(startSeconds) || 0;
      const end = parseFloat(endSeconds) || 45;

      // Extract audio from YouTube for iOS compatibility
      const extractedAudioPath = await extractYoutubeAudio(videoId, start, end, decodedName);

      await queries.upsertWalkupSong({
        pgOrgId: parseInt(orgId),
        pgTeamId: parseInt(teamId),
        playerName: decodedName,
        songType: 'youtube',
        filePath: null,
        youtubeUrl,
        youtubeVideoId: videoId,
        startSeconds: start,
        endSeconds: end,
        songTitle: title || null,
        artistName: artist || null,
        uploadedBy: req.user.id,
        announce: shouldAnnounce,
        announceAudioPath,
        extractedAudioPath,
      });
      res.json({ status: 'ok', videoId, extractedAudioPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/teams/:orgId/:teamId/players/:playerName/walkup-song
router.delete('/teams/:orgId/:teamId/players/:playerName/walkup-song',
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      const { orgId, teamId, playerName } = req.params;
      const name = decodeURIComponent(playerName);
      const song = await queries.getWalkupSong(parseInt(orgId), parseInt(teamId), name);
      if (song?.song_type === 'upload' && song?.file_path) {
        const fullPath = path.join(dataDir, 'walkups', song.file_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      if (song?.announce_audio_path) {
        const announcePath = path.join(dataDir, 'walkups', song.announce_audio_path);
        if (fs.existsSync(announcePath)) fs.unlinkSync(announcePath);
      }
      await queries.deleteWalkupSong(parseInt(orgId), parseInt(teamId), name);
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Baseball Cards ─────────────────────────────────────────────────────────────

const cardStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(dataDir, 'cards', req.params.orgId, req.params.teamId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const slug = decodeURIComponent(req.params.playerName).toLowerCase().replace(/[^a-z0-9]/g, '-');
    cb(null, `${slug}.png`);
  },
});

const uploadCard = multer({
  storage: cardStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') cb(null, true);
    else cb(new Error('Only PNG files are allowed'));
  },
});

// POST /api/teams/:orgId/:teamId/players/:playerName/baseball-card
router.post('/teams/:orgId/:teamId/players/:playerName/baseball-card',
  validateTeamParams,
  requireTeamRole(['admin', 'scorekeeper']),
  uploadCard.single('file'),
  async (req, res) => {
    try {
      const { orgId, teamId, playerName } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const name = decodeURIComponent(playerName);
      const cardPath = `${orgId}/${teamId}/${req.file.filename}`;
      await queries.setPlayerCardPath(parseInt(orgId), parseInt(teamId), name, cardPath);
      res.json({ cardUrl: `/cards/${cardPath}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/teams/:orgId/:teamId/players/:playerName/baseball-card
router.delete('/teams/:orgId/:teamId/players/:playerName/baseball-card',
  validateTeamParams,
  requireTeamRole(['admin', 'scorekeeper']),
  async (req, res) => {
    try {
      const { orgId, teamId, playerName } = req.params;
      const name = decodeURIComponent(playerName);
      const players = await queries.getPlayers(parseInt(orgId), parseInt(teamId));
      const player = players.find(p => p.name === name);
      if (player?.card_image_path) {
        const fullPath = path.join(dataDir, 'cards', player.card_image_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      await queries.setPlayerCardPath(parseInt(orgId), parseInt(teamId), name, null);
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Stream Config ─────────────────────────────────────────────────────────────

// GET /api/teams/:orgId/:teamId/stream
router.get('/teams/:orgId/:teamId/stream', async (req, res) => {
  try {
    const config = await queries.getStreamConfig(parseInt(req.params.orgId), parseInt(req.params.teamId));
    res.json({ youtube_url: config.youtube_url || '', is_live: !!config.is_live });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams/:orgId/:teamId/stream
router.post('/teams/:orgId/:teamId/stream', requireAuth, requireTeamRole(['admin']), async (req, res) => {
  try {
    const { youtube_url, is_live } = req.body;
    await queries.setStreamConfig(
      parseInt(req.params.orgId),
      parseInt(req.params.teamId),
      youtube_url,
      is_live
    );
    res.json({ youtube_url: youtube_url || '', is_live: !!is_live });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
