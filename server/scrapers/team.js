const axios = require('axios');
const cheerio = require('cheerio');
const queries = require('../db/queries');

const PG_BASE = 'https://www.perfectgame.org';

function teamUrl(orgId, teamId, year) {
  return `${PG_BASE}/PGBA/Team/default.aspx?orgid=${orgId}&orgteamid=${teamId}&Year=${year}`;
}

async function scrapeTeamPage(orgId, teamId, year) {
  const url = teamUrl(orgId, teamId, year);
  console.log(`[scraper] Fetching team page: ${url}`);

  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 30000,
  });

  const $ = cheerio.load(html);
  const result = { team: null, players: [], tournaments: [], games: [] };

  // Parse team info
  result.team = parseTeamInfo($, orgId, teamId, url);
  if (result.team) {
    await queries.upsertTeam(result.team);
    console.log(`[scraper] Team: ${result.team.name} (${result.team.record})`);
  } else {
    console.log(`[scraper] No PG team page for ${orgId}/${teamId} (sign-in wall) — leaving existing team info untouched`);
  }

  // Parse roster
  result.players = parseRoster($, orgId, teamId);
  for (const player of result.players) {
    await queries.upsertPlayer(player);
  }
  console.log(`[scraper] Roster: ${result.players.length} players`);

  // Parse schedule (tournaments + games)
  const { tournaments, games } = parseSchedule($, orgId, teamId);
  result.tournaments = tournaments;
  result.games = games;

  for (const t of tournaments) {
    await queries.upsertTournament(t);
    await queries.linkTeamTournament(orgId, teamId, t.pgEventId);
  }
  console.log(`[scraper] Tournaments: ${tournaments.length}`);

  for (const g of games) {
    await queries.upsertGame(g);
  }
  console.log(`[scraper] Games: ${games.length}`);

  return result;
}

function parseTeamInfo($, orgId, teamId, url) {
  // Use page title (more reliable than h1 which may pick up ads)
  let name = '';
  const title = $('title').text().trim();

  // PG redirects unknown/invalid org+team combos to a sign-in wall rather than
  // a 404. Don't let that page's title clobber the team's real name — bail out
  // so the caller skips the upsert entirely.
  if (/sign\s*in/i.test(title)) return null;

  if (title) {
    name = title.replace(/\s*[-–]\s*Perfect Game.*$/i, '').trim();
  }
  // Fallback to h1 only if title doesn't look like a team name
  if (!name || name.length > 80) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 80) name = h1;
  }

  // Extract info from text content - look for common patterns
  const bodyText = $('body').text();

  let ageGroup = '';
  let hometown = '';
  let classification = '';
  let record = '';

  // Find age group (e.g., "14U")
  const ageMatch = bodyText.match(/AGE\s*DIVISION[:\s]*(\d+U)/i) || name.match(/(\d+U)/);
  if (ageMatch) ageGroup = ageMatch[1];

  // Find hometown
  const htMatch = bodyText.match(/HOMETOWN[:\s]*([^,\n]+,\s*[A-Z]{2})/i);
  if (htMatch) hometown = htMatch[1].trim();

  // Find classification
  const classMatch = bodyText.match(/CLASSIFICATION[:\s]*(AAA|AA|A|Major|Open)/i);
  if (classMatch) classification = classMatch[1];

  // Find record (e.g., "5-6-0")
  const recordMatch = bodyText.match(/(\d+-\d+-\d+)\s*Overall/i);
  if (recordMatch) record = recordMatch[1];

  return {
    pgOrgId: orgId,
    pgTeamId: teamId,
    name: name || `Team ${orgId}-${teamId}`,
    ageGroup,
    hometown,
    classification,
    record,
    pgUrl: url,
  };
}

function parseRoster($, orgId, teamId) {
  const players = [];

  // Find the roster table by looking for headers with "No", "Name", "Pos"
  $('table').each((_, table) => {
    const headers = [];
    $(table).find('thead tr th, thead tr td, tr:first-child th, tr:first-child td').each((_, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    const hasRosterHeaders = headers.some(h => h === 'no' || h === '#') &&
                             headers.some(h => h === 'name') &&
                             headers.some(h => h === 'pos');

    if (!hasRosterHeaders) return;

    // Map column indices
    const colMap = {};
    headers.forEach((h, i) => {
      if (h === 'no' || h === '#') colMap.number = i;
      else if (h === 'name') colMap.name = i;
      else if (h === 'pos') colMap.position = i;
      else if (h === 'b/t') colMap.bt = i;
      else if (h === 'grad') colMap.gradYear = i;
      else if (h === 'ht') colMap.height = i;
      else if (h === 'wt') colMap.weight = i;
      else if (h === 'hometown') colMap.hometown = i;
    });

    $(table).find('tbody tr, tr').slice(1).each((_, row) => {
      const cells = [];
      $(row).find('td').each((_, td) => cells.push($(td).text().trim()));
      if (cells.length < 3) return;

      const name = colMap.name !== undefined ? cells[colMap.name] : '';
      if (!name) return;

      let bats = '', throws_ = '';
      if (colMap.bt !== undefined && cells[colMap.bt]) {
        const bt = cells[colMap.bt].split('/');
        bats = bt[0] || '';
        throws_ = bt[1] || '';
      }

      players.push({
        pgOrgId: orgId,
        pgTeamId: teamId,
        name,
        number: colMap.number !== undefined ? cells[colMap.number] : '',
        position: colMap.position !== undefined ? cells[colMap.position] : '',
        bats,
        throws: throws_,
        gradYear: colMap.gradYear !== undefined ? cells[colMap.gradYear] : '',
        height: colMap.height !== undefined ? cells[colMap.height] : '',
        weight: colMap.weight !== undefined ? cells[colMap.weight] : '',
        hometown: colMap.hometown !== undefined ? cells[colMap.hometown] : '',
      });
    });
  });

  return players;
}

function parseSchedule($, orgId, teamId) {
  const tournaments = [];
  const games = [];
  const seenEvents = new Set();
  let currentEventId = null;
  let currentEventName = '';

  // Find tournament links
  $('a[href*="/events/Default.aspx?event="]').each((_, el) => {
    const href = $(el).attr('href');
    const eventMatch = href.match(/event=(\d+)/);
    if (!eventMatch) return;

    const eventId = parseInt(eventMatch[1]);
    if (seenEvents.has(eventId)) return;
    seenEvents.add(eventId);

    const text = $(el).text().trim();
    // Try to get date/location from surrounding text
    const parent = $(el).parent();
    const siblingText = parent.text().trim();

    let location = '';
    let startDate = '';
    let endDate = '';

    // Parse date range like "Dec 6-7" or "Mar 15-16" near the link
    const dateMatch = siblingText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)-(\d+)/i);
    if (dateMatch) {
      const month = dateMatch[1];
      const day1 = dateMatch[2];
      const day2 = dateMatch[3];
      // Determine year based on month
      const yearNum = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        .indexOf(month.charAt(0).toUpperCase() + month.slice(1).toLowerCase()) >= 6 ? 2025 : 2026;
      const monthNum = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        .indexOf(month.charAt(0).toUpperCase() + month.slice(1).toLowerCase()) + 1;
      startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(day1).padStart(2, '0')}`;
      endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(day2).padStart(2, '0')}`;
    }

    // Location often follows the date
    const locMatch = siblingText.match(/\d+\s+([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})/);
    if (locMatch) location = locMatch[1].trim();

    tournaments.push({
      pgEventId: eventId,
      name: text,
      startDate,
      endDate,
      location,
      pgUrl: `${PG_BASE}/events/Default.aspx?event=${eventId}`,
    });
  });

  // Find game results via box score links
  $('a[href*="/DiamondKast/Game.aspx?gameid="]').each((_, el) => {
    const href = $(el).attr('href');
    const gameMatch = href.match(/gameid=(\d+)/);
    if (!gameMatch) return;

    const pgGameId = parseInt(gameMatch[1]);

    // Walk up to find the row/context for this game
    const row = $(el).closest('tr');
    if (!row.length) return;

    const rowText = row.text().trim();
    const cells = [];
    row.find('td').each((_, td) => cells.push($(td).text().trim()));

    // Determine the event this game belongs to
    // Look for the closest preceding tournament link
    let eventId = null;
    const recapLink = row.find('a[href*="GameRecap.aspx"]').attr('href') || '';
    const eventFromRecap = recapLink.match(/event=(\d+)/);
    if (eventFromRecap) eventId = parseInt(eventFromRecap[1]);

    // Parse result: "W, 5-13" or "L, 2-10"
    let result = null, scoreUs = null, scoreThem = null, opponentName = '';
    const resultMatch = rowText.match(/([WLT]),?\s*(\d+)-(\d+)/);
    if (resultMatch) {
      result = resultMatch[1];
      scoreUs = parseInt(resultMatch[2]);
      scoreThem = parseInt(resultMatch[3]);
    }

    // Find opponent from team link
    const opponentLink = row.find('a[href*="/PGBA/Team/default.aspx?orgid="]');
    if (opponentLink.length) {
      opponentName = opponentLink.text().trim();
    } else {
      // Try to extract opponent from "vs. TeamName" pattern
      const vsMatch = rowText.match(/vs\.?\s+(.+?)(?:\s+Field|\s+$)/i);
      if (vsMatch) opponentName = vsMatch[1].trim();
    }

    // Parse opponent IDs from their link
    let opponentOrgId = null, opponentTeamId = null;
    if (opponentLink.length) {
      const oppHref = opponentLink.attr('href') || '';
      const oppOrgMatch = oppHref.match(/orgid=(\d+)/);
      const oppTeamMatch = oppHref.match(/orgteamid=(\d+)/);
      if (oppOrgMatch) opponentOrgId = parseInt(oppOrgMatch[1]);
      if (oppTeamMatch) opponentTeamId = parseInt(oppTeamMatch[1]);
    }

    // Parse date from row
    let gameDate = '';
    const dateCell = cells[0] || '';
    const dayMatch = dateCell.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)/i);
    if (dayMatch) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIdx = months.indexOf(dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1).toLowerCase());
      if (monthIdx >= 0) {
        const yearNum = monthIdx >= 6 ? 2025 : 2026;
        gameDate = `${yearNum}-${String(monthIdx + 1).padStart(2, '0')}-${String(dayMatch[2]).padStart(2, '0')}`;
      }
    }

    // Parse field (clean up extra whitespace from HTML)
    let field = '';
    const fieldMatch = rowText.match(/Field\s+\d+\s*@?\s*[^\n]*/i);
    if (fieldMatch) field = fieldMatch[0].replace(/\s+/g, ' ').trim();

    // Box score URL
    const pgBoxUrl = `${PG_BASE}/DiamondKast/Game.aspx?gameid=${pgGameId}`;

    // Recap URL
    let pgRecapUrl = '';
    const recapEl = row.find('a[href*="GameRecap.aspx"]');
    if (recapEl.length) {
      const recapHref = recapEl.attr('href');
      pgRecapUrl = recapHref.startsWith('http') ? recapHref : `${PG_BASE}/${recapHref.replace(/^(\.\.\/)+/g, '')}`;
    }

    games.push({
      pgGameId,
      pgEventId: eventId,
      teamOrgId: orgId,
      teamId,
      opponentName,
      opponentOrgId,
      opponentTeamId,
      gameDate,
      gameTime: '',
      field,
      scoreUs,
      scoreThem,
      result,
      pgBoxUrl,
      pgRecapUrl,
    });
  });

  // Deduplicate games by pgGameId
  const uniqueGames = [];
  const seenGameIds = new Set();
  for (const g of games) {
    if (!seenGameIds.has(g.pgGameId)) {
      seenGameIds.add(g.pgGameId);
      uniqueGames.push(g);
    }
  }

  return { tournaments, games: uniqueGames };
}

module.exports = { scrapeTeamPage, PG_BASE };
