const cheerio = require('cheerio');
const queries = require('../db/queries');
const { fetchRenderedHtml, closeBrowser } = require('./browser');

// Five Tool runs separate sites per age bracket; each registered team picks one via ft_base_url.
const FT_SITES = {
  youth: 'https://play.fivetoolyouth.org',
  events: 'https://events.fivetool.org',
};
const DEFAULT_FT_BASE = FT_SITES.youth;

// Generate a deterministic integer from a string (for event IDs)
// Offset to 20M+ range to avoid collision with PG event IDs (typically 5-6 digits)
function ftEventHash(slug) {
  let hash = 0;
  for (const ch of slug) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return (hash & 0x7FFFFFFF) + 20000000;
}

// Pull the event slug out of an FT event URL regardless of which FT site it's on
function eventSlugFromUrl(eventUrl) {
  const m = (eventUrl || '').match(/\/events\/([^/]+)\/?/);
  return m ? m[1] : '';
}

// Pull the season + team UUID out of an FT team profile URL (either FT site)
function teamRefFromUrl(teamUrl) {
  const m = (teamUrl || '').match(/\/team\/details\/([^/]+)\/([0-9a-f-]{36})/i);
  return m ? { season: m[1], teamUuid: m[2] } : null;
}

// Deterministic synthetic pg_org_id/pg_team_id for FT-only teams that have no
// PerfectGame profile (the teams table's primary key requires both).
function syntheticPgIds(teamUuid) {
  const hash = (s) => {
    let h = 0;
    for (const ch of s) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
    return ((h & 0x7FFFFFFF) % 90000000) + 900000000;
  };
  return { orgId: hash('org:' + teamUuid), teamId: hash('team:' + teamUuid) };
}

function teamUrl(ftBase, season, teamUuid) {
  return `${ftBase}/team/details/${season}/${teamUuid}`;
}

// Scrape the FT event schedule page to get game times and matchups
async function scrapeFtEventSchedule(eventSlug, teamName, ftBase = DEFAULT_FT_BASE) {
  const url = `${ftBase}/events/${eventSlug}/schedule/all`;
  console.log(`[ft-scraper] Fetching event schedule: ${url}`);

  try {
    const { getBrowser } = require('./browser');
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    let scheduleJson = null;
    page.on('response', async (response) => {
      if (response.url().includes('schedule_ajax') && response.status() === 200) {
        try { scheduleJson = await response.json(); } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(8000);
    await context.close();

    if (!scheduleJson?.schedules) {
      console.log(`[ft-scraper] No schedule data from AJAX for ${eventSlug}`);
      return [];
    }

    // Extract games that match our team
    const games = [];
    const teamLower = (teamName || '').toLowerCase();

    for (const [dateKey, dayData] of Object.entries(scheduleJson.schedules)) {
      if (!dayData.teams || !Array.isArray(dayData.teams)) continue;
      const gameDate = dayData.date_short || ''; // "03/28/2026"
      // Convert MM/DD/YYYY to YYYY-MM-DD
      let isoDate = '';
      if (gameDate.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        isoDate = `${gameDate.slice(6)}-${gameDate.slice(0, 2)}-${gameDate.slice(3, 5)}`;
      }

      for (const game of dayData.teams) {
        const t1 = game.team_name_1 || '';
        const t2 = game.team_name_2 || '';
        const t1Lower = t1.toLowerCase();
        const t2Lower = t2.toLowerCase();

        // Check if our team is in this game (flexible matching — either contains the other)
        const isT1 = teamLower && (t1Lower.includes(teamLower) || teamLower.includes(t1Lower));
        const isT2 = teamLower && (t2Lower.includes(teamLower) || teamLower.includes(t2Lower));
        if (!isT1 && !isT2) continue;

        const opponentName = isT1 ? t2 : t1;
        const gameTime = game.start_time || '';
        // Different FT sites key the venue name differently (location_name, location, field_name).
        const field = game.location_name || game.location || game.field_name || '';
        const score1 = parseInt(game.team_score_1) || null;
        const score2 = parseInt(game.team_score_2) || null;

        let scoreUs = null, scoreThem = null, result = null;
        if (score1 !== null && score2 !== null) {
          scoreUs = isT1 ? score1 : score2;
          scoreThem = isT1 ? score2 : score1;
          result = scoreUs > scoreThem ? 'W' : scoreUs < scoreThem ? 'L' : 'T';
        }

        games.push({
          gameDate: isoDate,
          gameTime,
          field,
          opponentName,
          scoreUs,
          scoreThem,
          result,
          division: game.division || '',
        });
      }
    }

    console.log(`[ft-scraper] Found ${games.length} scheduled games for team in ${eventSlug}`);
    return games;
  } catch (err) {
    console.log(`[ft-scraper] Error scraping event schedule ${eventSlug}: ${err.message}`);
    return [];
  }
}

// Scrape registered teams from an FT event teams page, grouped by division panel
// Also extracts venue info from the event page
async function scrapeFtEventTeams(eventSlug, ageGroup, ftBase = DEFAULT_FT_BASE) {
  const url = `${ftBase}/events/${eventSlug}/teams`;
  console.log(`[ft-scraper] Fetching event teams: ${url}${ageGroup ? ` (filtering for ${ageGroup})` : ''}`);

  try {
    const { getBrowser } = require('./browser');
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(6000);

    // Extract teams grouped by panel + venue links
    const data = await page.evaluate(() => {
      // Teams by division panel
      const panels = [];
      document.querySelectorAll('[id$="open"]').forEach(panel => {
        const teams = [];
        panel.querySelectorAll('a[href*="/team/details/"]').forEach(a => {
          const name = a.textContent.trim();
          const href = a.href;
          if (name && name.length > 2) teams.push({ name, href });
        });
        if (teams.length > 0) panels.push({ panelId: panel.id, teams });
      });

      // Venue links
      const venues = [];
      document.querySelectorAll('a[href*="/venues"], a[href*="maps.google"], a[href*="goo.gl"]').forEach(a => {
        const text = a.textContent.trim();
        const href = a.href;
        if (text && text.length > 2) venues.push({ name: text, href });
      });

      return { panels, venues };
    });

    await context.close();

    // Filter by age group
    let allTeams = [];
    if (ageGroup) {
      const agePattern = ageGroup.replace(/U$/i, '').trim();
      for (const panel of data.panels) {
        const hasAge = panel.teams.some(t => {
          const m = t.name.match(/(\d+)\s*[Uu]/);
          return m && m[1] === agePattern;
        });
        if (hasAge) allTeams = allTeams.concat(panel.teams);
      }
    } else {
      for (const panel of data.panels) allTeams = allTeams.concat(panel.teams);
    }

    // Deduplicate and sort
    const teamMap = new Map();
    for (const t of allTeams) {
      teamMap.set(t.name.toLowerCase(), { name: t.name, href: t.href });
    }

    const result = [...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[ft-scraper] Found ${result.length} teams${ageGroup ? ` in ${ageGroup}` : ''} for ${eventSlug}`);

    // Return teams + venue info
    return { teams: result, venues: data.venues };
  } catch (err) {
    console.log(`[ft-scraper] Error fetching event teams ${eventSlug}: ${err.message}`);
    return { teams: [], venues: [] };
  }
}

async function scrapeFiveToolTeam(teamUuid, season, orgId, teamId, ftBase = DEFAULT_FT_BASE) {
  const url = teamUrl(ftBase, season, teamUuid);
  console.log(`[ft-scraper] Fetching: ${url}`);

  const html = await fetchRenderedHtml(url);

  const $ = cheerio.load(html);
  const result = { record: null, events: [], games: [], players: [], teamName: '' };

  // Detect our team name from the page title
  const titleText = $('title').text().trim();
  const titleMatch = titleText.match(/^(.+?)\s*Team Profile/i);
  if (titleMatch) result.teamName = titleMatch[1].trim();
  console.log(`[ft-scraper] Team name: "${result.teamName}"`);

  // Parse season record: "W-L-T 7-5-1"
  const recordText = $('.team-record-tables').text().replace(/\s+/g, ' ');
  const recordMatch = recordText.match(/W-L-T\s+(\d+-\d+-\d+)/);
  if (recordMatch) {
    result.record = recordMatch[1];
    console.log(`[ft-scraper] Record: ${result.record}`);
  }

  // Parse events, game results, and roster rows from tables
  const cleanText = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const rows = [];
  $('td[data-title]').closest('tr').each((_, row) => {
    const cells = {};
    $(row).find('td[data-title]').each((_, td) => {
      const title = $(td).attr('data-title');
      const text = cleanText($(td).find('.table-text').text() || $(td).text());
      const link = $(td).find('a').attr('href') || '';
      cells[title] = { text, link };
    });
    if (Object.keys(cells).length > 1) rows.push(cells);
  });

  // Roster rows (identified by the Name column, unique to the roster table)
  for (const row of rows) {
    if (!row['Name']) continue;
    if (!row['Name'].text) continue;
    const [bats, throws] = (row['H/T']?.text || '').split('/').map(s => s.trim());
    result.players.push({
      pgOrgId: orgId,
      pgTeamId: teamId,
      name: row['Name'].text,
      number: row['#']?.text || '',
      position: [row['Primary Pos']?.text, row['Sec. Pos']?.text].filter(Boolean).join('/'),
      bats: bats || '',
      throws: throws || '',
      gradYear: row['Grad Year - HS']?.text || '',
      height: row['HEIGHT']?.text || '',
      weight: row['Weight']?.text || '',
      hometown: [row['City']?.text, row['State']?.text].filter(Boolean).join(', '),
    });
  }
  console.log(`[ft-scraper] Roster: ${result.players.length} players`);
  for (const player of result.players) {
    await queries.upsertPlayer(player);
  }

  // Separate event rows from game rows
  for (const row of rows) {
    if (row['EVENT'] && row['DATE'] && row['W-L-T']) {
      const eventLink = row['EVENT'].link || '';
      const slug = eventSlugFromUrl(eventLink);
      const eventId = ftEventHash(slug);

      const event = {
        eventId,
        name: row['EVENT'].text.trim(),
        date: row['DATE'].text.trim(),
        division: row['DIVISION'] ? row['DIVISION'].text.trim() : '',
        wlt: row['W-L-T'].text.trim(),
        ftUrl: eventLink,
        slug,
      };
      result.events.push(event);
    } else if (row['#'] && row['TEAM'] && row['VS']) {
      const scoreText = row['VS'].text.replace(/\s+/g, ' ').trim();
      const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
      const teamLink = row['TEAM'].link || '';
      const isUs = teamLink.includes(teamUuid);
      const eventName = row['EVENT'] ? row['EVENT'].text.trim() : '';

      if (scoreMatch) {
        result.games.push({
          gameNum: row['#'].text.trim(),
          eventName,
          opponentName: isUs ? '' : row['TEAM'].text.trim(),
          s1: parseInt(scoreMatch[1]),
          s2: parseInt(scoreMatch[2]),
          isUs,
          scoreUs: null,
          scoreThem: null,
          result: null,
        });
      }
    }
  }

  console.log(`[ft-scraper] Events: ${result.events.length}, Games: ${result.games.length}`);

  // Auto-detect score direction by cross-validating against event W-L-T records
  for (const interp of ['A', 'B']) {
    let allMatch = true;
    for (const event of result.events) {
      const wltMatch = event.wlt.match(/(\d+)-(\d+)-(\d+)/);
      if (!wltMatch) continue;
      const expectedW = parseInt(wltMatch[1]), expectedL = parseInt(wltMatch[2]), expectedT = parseInt(wltMatch[3]);
      if (expectedW + expectedL + expectedT === 0) continue;

      const eventGames = result.games.filter(g => g.eventName === event.name);
      let w = 0, l = 0, t = 0;
      for (const g of eventGames) {
        let us, them;
        if (interp === 'A') { us = g.isUs ? g.s1 : g.s2; them = g.isUs ? g.s2 : g.s1; }
        else { us = g.isUs ? g.s2 : g.s1; them = g.isUs ? g.s1 : g.s2; }
        if (us > them) w++; else if (us < them) l++; else t++;
      }
      if (w !== expectedW || l !== expectedL || t !== expectedT) { allMatch = false; break; }
    }
    if (allMatch) {
      console.log(`[ft-scraper] Score interpretation: ${interp}`);
      for (const g of result.games) {
        if (interp === 'A') { g.scoreUs = g.isUs ? g.s1 : g.s2; g.scoreThem = g.isUs ? g.s2 : g.s1; }
        else { g.scoreUs = g.isUs ? g.s2 : g.s1; g.scoreThem = g.isUs ? g.s1 : g.s2; }
        g.result = g.scoreUs > g.scoreThem ? 'W' : g.scoreUs < g.scoreThem ? 'L' : 'T';
      }
      break;
    }
  }

  // Scrape event pages for date ranges and scheduled games
  for (const event of result.events) {
    try {
      const eventHtml = await fetchRenderedHtml(event.ftUrl);
      const $e = cheerio.load(eventHtml);
      const evTitle = $e('title').text().trim();
      const dateRangeMatch = evTitle.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
      if (dateRangeMatch) {
        const [_, sd, ed] = dateRangeMatch;
        event.startDate = `${sd.slice(6)}-${sd.slice(0, 2)}-${sd.slice(3, 5)}`;
        event.endDate = `${ed.slice(6)}-${ed.slice(0, 2)}-${ed.slice(3, 5)}`;
      }
    } catch (err) {
      console.log(`[ft-scraper] Could not fetch event details for ${event.name}: ${err.message}`);
    }

    // Scrape scheduled games from the event schedule page
    // Remove trailing year from team name (page title adds "2026" but schedule doesn't)
    const matchName = result.teamName.replace(/\s*\d{4}\s*$/, '').toLowerCase();
    const scheduledGames = await scrapeFtEventSchedule(event.slug, matchName, ftBase);
    event.scheduledGames = scheduledGames;
  }

  // Save events as tournaments
  for (const event of result.events) {
    await queries.upsertFtTournament({
      eventId: event.eventId,
      name: event.name,
      startDate: event.startDate || event.date,
      endDate: event.endDate || '',
      location: event.location || '',
      ftUrl: event.ftUrl,
    });
    await queries.linkTeamTournament(orgId, teamId, event.eventId);
  }

  // Save completed game results
  for (const game of result.games) {
    const matchingEvent = result.events.find(e => e.name === game.eventName);
    const eventId = matchingEvent ? matchingEvent.eventId : null;
    if (game.scoreUs === null) continue;

    const sourceGameKey = `ft:${eventId || 'unknown'}:${game.gameNum}:${game.scoreUs}-${game.scoreThem}`;
    await queries.upsertFtGame({
      sourceGameKey,
      pgEventId: eventId,
      teamOrgId: orgId,
      teamId,
      opponentName: game.opponentName || 'Unknown',
      gameDate: matchingEvent ? matchingEvent.date : '',
      scoreUs: game.scoreUs,
      scoreThem: game.scoreThem,
      result: game.result,
    });
  }

  // Save scheduled (upcoming) games from event schedules
  for (const event of result.events) {
    if (!event.scheduledGames?.length) continue;
    for (const sg of event.scheduledGames) {
      // Skip if this game already has a result in our completed games
      const alreadyHasResult = result.games.some(g =>
        g.eventName === event.name && g.opponentName === sg.opponentName && g.scoreUs !== null
      );
      if (alreadyHasResult) continue;

      const sourceGameKey = `ft:${event.eventId}:sched:${sg.gameDate}:${sg.gameTime}:${sg.opponentName}`;
      await queries.upsertFtGame({
        sourceGameKey,
        pgEventId: event.eventId,
        teamOrgId: orgId,
        teamId,
        opponentName: sg.opponentName,
        gameDate: sg.gameDate,
        gameTime: sg.gameTime,
        field: sg.field,
        scoreUs: sg.scoreUs,
        scoreThem: sg.scoreThem,
        result: sg.result,
      });
    }
  }

  return result;
}

module.exports = { scrapeFiveToolTeam, scrapeFtEventTeams, scrapeFtEventSchedule, FT_SITES, DEFAULT_FT_BASE, ftEventHash, eventSlugFromUrl, teamRefFromUrl, syntheticPgIds };
