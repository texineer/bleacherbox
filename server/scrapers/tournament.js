const cheerio = require('cheerio');
const { fetchPgHtml } = require('./pgFetch');
const queries = require('../db/queries');
const { PG_BASE } = require('./team');

async function scrapeTournamentPage(eventId) {
  const url = `${PG_BASE}/events/Default.aspx?event=${eventId}`;
  console.log(`[scraper] Fetching tournament page: ${url}`);

  const html = await fetchPgHtml(url);

  const $ = cheerio.load(html);

  // Get title - prefer <title> tag, clean up suffix
  let title = $('title').text().trim().replace(/\s*\|\s*Perfect Game.*$/i, '').replace(/\s*-\s*Perfect Game.*$/i, '').trim();
  if (!title) title = $('h1, h2').first().text().trim();

  const bodyText = $('body').text();

  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
                   january:'01',february:'02',march:'03',april:'04',june:'06',
                   july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };

  let location = '';
  // Pattern: "Venue | City, ST"
  const locMatch = bodyText.match(/\|\s*([A-Z][A-Za-z\s.]+,\s*[A-Z]{2})/);
  if (locMatch) location = locMatch[1].trim();
  if (!location) {
    const locMatch2 = bodyText.match(/(?:Location|City)[:\s]*([^\n,]+,\s*[A-Z]{2})/i);
    if (locMatch2) location = locMatch2[1].trim();
  }

  let startDate = '', endDate = '';

  // Pattern 1: "Mar 28, 2026 Mar 29, 2026" (two separate dates with year)
  const twoDateMatch = bodyText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s*(\d{4})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s*(\d{4})/i);
  if (twoDateMatch) {
    const m1 = months[twoDateMatch[1].toLowerCase()];
    const m2 = months[twoDateMatch[4].toLowerCase()];
    startDate = `${twoDateMatch[3]}-${m1}-${String(twoDateMatch[2]).padStart(2, '0')}`;
    endDate = `${twoDateMatch[6]}-${m2}-${String(twoDateMatch[5]).padStart(2, '0')}`;
  }

  // Pattern 2: "March 28-29, 2026" (full month name, range)
  if (!startDate) {
    const rangeMatch = bodyText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})/i);
    if (rangeMatch) {
      const m = months[rangeMatch[1].toLowerCase()];
      startDate = `${rangeMatch[4]}-${m}-${String(rangeMatch[2]).padStart(2, '0')}`;
      endDate = `${rangeMatch[4]}-${m}-${String(rangeMatch[3]).padStart(2, '0')}`;
    }
  }

  // Pattern 3: "Feb 28-Mar 1" (cross-month, abbreviated)
  if (!startDate) {
    const crossMonth = bodyText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);
    if (crossMonth) {
      const m1 = months[crossMonth[1].toLowerCase()];
      const m2 = months[crossMonth[3].toLowerCase()];
      // Find year from title or body
      const yearMatch = title.match(/(\d{4})/) || bodyText.match(/(\d{4})/);
      const y = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
      startDate = `${y}-${m1}-${String(crossMonth[2]).padStart(2, '0')}`;
      endDate = `${y}-${m2}-${String(crossMonth[4]).padStart(2, '0')}`;
    }
  }

  // Pattern 4: "Mar 28-29" same-month abbreviated
  if (!startDate) {
    const shortMatch = bodyText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*-\s*(\d{1,2})/i);
    if (shortMatch) {
      const m = months[shortMatch[1].toLowerCase()];
      const yearMatch = title.match(/(\d{4})/) || bodyText.match(/(\d{4})/);
      const y = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
      startDate = `${y}-${m}-${String(shortMatch[2]).padStart(2, '0')}`;
      endDate = `${y}-${m}-${String(shortMatch[3]).padStart(2, '0')}`;
    }
  }

  if (title) {
    await queries.upsertTournament({
      pgEventId: eventId,
      name: title,
      startDate,
      endDate,
      location,
      pgUrl: url,
    });
  }

  return { name: title, startDate, endDate, location };
}

// Scrape the pitching restrictions/report page for a tournament
// URL: /events/Tournaments/PitchingRestrictions.aspx?event={eventId}
async function scrapePitchingReport(eventId) {
  const url = `${PG_BASE}/events/Tournaments/PitchingRestrictions.aspx?event=${eventId}`;
  console.log(`[scraper] Fetching pitching report: ${url}`);

  try {
    const html = await fetchPgHtml(url);

    const $ = cheerio.load(html);
    const entries = parsePitchingRestrictions($, eventId);

    if (entries.length > 0) {
      console.log(`[scraper] Found ${entries.length} pitching entries for event ${eventId}`);
    } else {
      console.log(`[scraper] No pitching data found for event ${eventId}`);
    }

    return entries;
  } catch (err) {
    console.log(`[scraper] Pitching report error for event ${eventId}: ${err.message}`);
    return [];
  }
}

function parsePitchingRestrictions($, eventId) {
  const entries = [];

  // The PitchingRestrictions page has a table with columns:
  // No. | Player | # Pitches | # Outs | Opponent
  // Rows are grouped by team (team name appears in a row spanning all columns)
  $('table').each((_, table) => {
    const headers = [];
    $(table).find('tr:first-child th, tr:first-child td').each((_, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    // Check if this is the pitching data table
    const hasPitchCol = headers.some(h => h.includes('pitch'));
    const hasPlayerCol = headers.some(h => h === 'player' || h === 'no.');
    if (!hasPitchCol || !hasPlayerCol) return;

    // Map columns
    const colMap = {};
    headers.forEach((h, i) => {
      if (h === 'no.' || h === 'no' || h === '#') colMap.number = i;
      else if (h === 'player') colMap.player = i;
      else if (h.includes('pitch')) colMap.pitches = i;
      else if (h.includes('out')) colMap.outs = i;
      else if (h === 'opponent') colMap.opponent = i;
    });

    let currentTeam = '';

    $(table).find('tr').slice(1).each((_, row) => {
      const cells = [];
      $(row).find('td').each((_, td) => cells.push($(td).text().trim()));

      // Team header rows typically have fewer cells or a single cell spanning columns
      const tds = $(row).find('td');
      if (tds.length === 1 || (cells.length === 1 && cells[0])) {
        // This is a team name header row
        currentTeam = cells[0].trim();
        return;
      }

      // Also check: if cells don't have a number in the "No." column, it might be a team row
      if (cells.length >= 2 && colMap.player !== undefined) {
        const playerName = cells[colMap.player];
        const pitchStr = colMap.pitches !== undefined ? cells[colMap.pitches] : '';
        const pitches = parseInt(pitchStr) || 0;

        if (!playerName || pitches === 0) {
          // Might be a team header or empty row
          if (cells.join('').trim() && !pitchStr) {
            // Could be team name - take the longest cell value
            const longestCell = cells.reduce((a, b) => a.length > b.length ? a : b, '');
            if (longestCell.length > 2) currentTeam = longestCell;
          }
          return;
        }

        // Convert outs to innings (3 outs = 1 inning)
        const outs = colMap.outs !== undefined ? parseInt(cells[colMap.outs]) || 0 : 0;
        const innings = Math.floor(outs / 3) + (outs % 3) / 10; // e.g., 7 outs = 2.1 IP

        const opponent = colMap.opponent !== undefined ? cells[colMap.opponent] : '';

        entries.push({
          playerName,
          teamName: currentTeam,
          pitches,
          innings,
          outs,
          opponent,
          strikeouts: null, // Not available on this page
          walks: null,
        });
      }
    });
  });

  return entries;
}

// Scrape scheduled games from the main tournament event page
// URL: /events/Default.aspx?event={eventId}
async function scrapeTournamentSchedule(eventId) {
  const url = `${PG_BASE}/events/Default.aspx?event=${eventId}`;
  console.log(`[scraper] Fetching tournament schedule: ${url}`);

  try {
    const html = await fetchPgHtml(url);

    const $ = cheerio.load(html);
    const games = [];

    // Try to extract tournament dates from date selector/tabs on the page
    // Look for patterns like "Mar 28, 2026" or "March 28, 2026"
    const bodyText = $('body').text();
    const allDates = [];
    const dateRegex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s*(\d{4})/gi;
    let dm;
    while ((dm = dateRegex.exec(bodyText)) !== null) {
      const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const m = months[dm[1].toLowerCase().slice(0,3)];
      if (m) allDates.push(`${dm[3]}-${m}-${String(dm[2]).padStart(2,'0')}`);
    }
    // Unique sorted dates for this tournament
    const tourneyDates = [...new Set(allDates)].sort();

    // Find all DiamondKast game links - the entire game card is one <a> tag
    $('a[href*="/DiamondKast/Game.aspx?gameid="], a[href*="DiamondKast/Game.aspx?gameid="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const gameMatch = href.match(/gameid=(\d+)/);
      if (!gameMatch) return;

      const pgGameId = parseInt(gameMatch[1]);

      // The entire card is the <a> tag - get its text
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      // Extract time (e.g., "8:00 AM", "10:00 AM")
      let gameTime = '';
      const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (timeMatch) gameTime = timeMatch[1].trim();

      // Extract field info - grab "Venue Name Field X" before the time
      let field = '';
      if (gameTime) {
        const beforeTime = text.slice(0, text.indexOf(gameTime)).trim();
        if (beforeTime) field = beforeTime;
      }
      if (!field) {
        const fieldMatch = text.match(/([A-Z][A-Za-z\s]+ Field \d+)/);
        if (fieldMatch) field = fieldMatch[0].replace(/\s+/g, ' ').trim();
      }

      // Parse team names from card text
      // Pattern: "Venue Field X  TIME  Team1  Score1  Team2  Score2"
      // Strategy: split on the time to get everything after it, then split on score numbers
      let teams = [];

      // Also try to find team links inside (some pages have them)
      const teamLinks = $(el).find('a[href*="/PGBA/Team/default.aspx"]');
      if (teamLinks.length >= 2) {
        teamLinks.each((_, tl) => {
          const tHref = $(tl).attr('href') || '';
          const orgMatch = tHref.match(/orgid=(\d+)/);
          const teamIdMatch = tHref.match(/orgteamid=(\d+)/);
          teams.push({
            name: $(tl).text().trim(),
            orgId: orgMatch ? parseInt(orgMatch[1]) : null,
            teamId: teamIdMatch ? parseInt(teamIdMatch[1]) : null,
          });
        });
      }

      // If no team links, parse from text after the time
      if (teams.length < 2 && gameTime) {
        const timeIdx = text.indexOf(gameTime);
        const afterTime = timeIdx >= 0 ? text.slice(timeIdx + gameTime.length).trim() : text;
        // Pattern: "Team1 Score1 Team2 Score2" — scores are lone numbers
        // Split into segments: text separated by lone numbers
        const segments = afterTime.split(/\s+\d{1,3}\s+/).map(s => s.trim()).filter(s => s.length > 1);
        // Remove trailing score from last segment
        if (segments.length >= 1) {
          segments[segments.length - 1] = segments[segments.length - 1].replace(/\s+\d{1,3}\s*$/, '').trim();
        }
        if (segments.length >= 2) {
          teams = segments.slice(0, 2).map(n => ({ name: n, orgId: null, teamId: null }));
        }
      }

      // Try to determine date - if tournament has 1 date, use it
      // If multiple dates, try to infer from position (AM games = day 1 typically)
      // For now, default to first tournament date if available
      let gameDate = tourneyDates.length === 1 ? tourneyDates[0] : '';

      games.push({
        pgGameId,
        pgEventId: eventId,
        gameDate,
        gameTime,
        field,
        teams,
        pgBoxUrl: `${PG_BASE}/DiamondKast/Game.aspx?gameid=${pgGameId}`,
      });
    });

    // Deduplicate
    const seen = new Set();
    const unique = games.filter(g => {
      if (seen.has(g.pgGameId)) return false;
      seen.add(g.pgGameId);
      return true;
    });

    console.log(`[scraper] Found ${unique.length} scheduled games for event ${eventId}`);
    return unique;
  } catch (err) {
    console.error(`[scraper] Tournament schedule error for event ${eventId}: ${err.message}`);
    return [];
  }
}

// Scrape registered teams from the PG event page
async function scrapeRegisteredTeams(eventId) {
  const url = `${PG_BASE}/events/Default.aspx?event=${eventId}`;
  console.log(`[scraper] Fetching registered teams: ${url}`);

  try {
    const html = await fetchPgHtml(url);

    const $ = cheerio.load(html);
    const teams = new Map(); // dedup by orgId-teamId

    // Find all team links: /PGBA/Team/default.aspx?orgid=XXX&orgteamid=XXX
    $('a[href*="/PGBA/Team/default.aspx"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const orgMatch = href.match(/orgid=(\d+)/);
      const teamIdMatch = href.match(/orgteamid=(\d+)/);
      const name = $(el).text().trim();
      if (orgMatch && teamIdMatch && name && name.length > 2) {
        const key = `${orgMatch[1]}-${teamIdMatch[1]}`;
        if (!teams.has(key)) {
          teams.set(key, {
            name,
            orgId: parseInt(orgMatch[1]),
            teamId: parseInt(teamIdMatch[1]),
          });
        }
      }
    });

    const result = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[scraper] Found ${result.length} registered teams for event ${eventId}`);
    return result;
  } catch (err) {
    console.log(`[scraper] Registered teams error for event ${eventId}: ${err.message}`);
    return [];
  }
}

// Scrape bracket games from the PG Brackets page
// URL: /events/Brackets.aspx?event={eventId}
async function scrapeBracketGames(eventId) {
  const url = `${PG_BASE}/events/Brackets.aspx?event=${eventId}`;
  console.log(`[scraper] Fetching bracket page: ${url}`);

  try {
    const html = await fetchPgHtml(url);

    const $ = cheerio.load(html);
    const games = [];

    // Find bracket names (e.g., "14U OPEN GOLD BRACKET", "14U OPEN SILVER BRACKET")
    const bracketLabels = [];
    $('span').each((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (/BRACKET$/i.test(text) && text.length < 80) {
        bracketLabels.push(text);
      }
    });

    // Collect all game top boxes, home boxes, and visitor boxes
    const gameTopBoxes = [];
    $('[class*="GameTopBox"]').each((_, el) => gameTopBoxes.push($(el).text().trim().replace(/\s+/g, ' ')));

    const homeBoxes = [];
    $('[class*="HomeTeamBox"]').each((_, el) => homeBoxes.push($(el).text().trim().replace(/\s+/g, ' ')));

    const visitorBoxes = [];
    $('[class*="VisitorTeamBox"]').each((_, el) => visitorBoxes.push($(el).text().trim().replace(/\s+/g, ' ')));

    // Collect DK game IDs from all game links on the page
    const allGameIds = [];
    $('a[href*="DiamondKast/Game.aspx?gameid="]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/gameid=(\d+)/);
      if (m) allGameIds.push(parseInt(m[1]));
    });
    // Deduplicate preserving order
    const uniqueGameIds = [...new Set(allGameIds)];

    // Determine which bracket each game belongs to based on position
    // Gold bracket games come first, Silver second (each bracket has equal games typically)
    const gamesPerBracket = bracketLabels.length > 1
      ? Math.ceil(gameTopBoxes.length / bracketLabels.length)
      : gameTopBoxes.length;

    // Determine tournament year from dates on page
    const bodyText = $('body').text();
    const yearMatch = bodyText.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

    const count = Math.min(gameTopBoxes.length, homeBoxes.length, visitorBoxes.length);
    for (let i = 0; i < count; i++) {
      const gi = gameTopBoxes[i];

      // Parse game info: "GM: 11 | 3/29 | 10:00 AM | GAME RECAPC2 @ Venue"
      const gmMatch = gi.match(/GM:\s*(\d+)/);
      const dateMatch = gi.match(/(\d{1,2})\/(\d{1,2})/);
      const timeMatch = gi.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      const fieldMatch = gi.match(/(?:GAME RECAP)?([A-Z][A-Za-z0-9\s]+?)\s*@\s*(.+)/);

      // Parse home team: "#4 Team Name 4" (seed, name, score)
      const hm = homeBoxes[i].match(/#(\d+)\s+(.+?)\s+(\d+)\s*$/);
      const vm = visitorBoxes[i].match(/#(\d+)\s+(.+?)\s+(\d+)\s*$/);

      // Find game ID for this game (by index into unique list)
      const pgGameId = uniqueGameIds[i] || null;

      // Date: M/D → YYYY-MM-DD
      let gameDate = '';
      if (dateMatch) {
        const mm = String(dateMatch[1]).padStart(2, '0');
        const dd = String(dateMatch[2]).padStart(2, '0');
        gameDate = `${year}-${mm}-${dd}`;
      }

      // Field name
      let field = '';
      if (fieldMatch) {
        field = fieldMatch[1].replace(/\s+/g, ' ').trim();
      }

      // Determine bracket name
      const bracketIdx = bracketLabels.length > 1 ? Math.floor(i / gamesPerBracket) : 0;
      const bracketName = bracketLabels[bracketIdx] || bracketLabels[0] || 'Bracket';

      // Determine round based on game number within bracket
      const posInBracket = bracketLabels.length > 1 ? i % gamesPerBracket : i;
      let round = '';
      if (gamesPerBracket <= 1) round = 'Final';
      else if (gamesPerBracket === 3) round = posInBracket === 0 ? 'Semifinal' : posInBracket === 1 ? 'Semifinal' : 'Final';
      else if (gamesPerBracket === 4) round = posInBracket < 2 ? 'Semifinal' : posInBracket === 2 ? 'Semifinal' : 'Final';
      else if (gamesPerBracket >= 7) round = posInBracket < 4 ? 'Quarterfinal' : posInBracket < 6 ? 'Semifinal' : 'Final';

      games.push({
        pgGameId,
        pgEventId: eventId,
        gameDate,
        gameTime: timeMatch ? timeMatch[1].trim() : '',
        field,
        gameNumber: gmMatch ? parseInt(gmMatch[1]) : null,
        bracketName,
        round,
        homeTeam: hm ? { name: hm[2].trim(), seed: parseInt(hm[1]), score: parseInt(hm[3]) } : null,
        awayTeam: vm ? { name: vm[2].trim(), seed: parseInt(vm[1]), score: parseInt(vm[3]) } : null,
      });
    }

    console.log(`[scraper] Found ${games.length} bracket games for event ${eventId} (${bracketLabels.join(', ')})`);
    return games;
  } catch (err) {
    console.log(`[scraper] Bracket page error for event ${eventId}: ${err.message}`);
    return [];
  }
}

// Scrape all games from TournamentSchedule.aspx (pool play + bracket play, all dates)
// URL: /events/TournamentSchedule.aspx?event={eventId}&Date={MM/DD/YYYY}
async function scrapeTournamentScheduleFull(eventId) {
  const baseUrl = `${PG_BASE}/events/TournamentSchedule.aspx?event=${eventId}`;
  console.log(`[scraper] Fetching full tournament schedule: ${baseUrl}`);

  try {
    // First, get the page to find all date tabs
    const html = await fetchPgHtml(baseUrl);
    const $first = cheerio.load(html);

    // Find all date links
    const dates = new Set();
    $first('a[href*="TournamentSchedule"]').each((_, el) => {
      const href = $first(el).attr('href') || '';
      const dm = href.match(/Date=(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (dm) dates.add(dm[1]);
    });

    // If no date tabs, try current page
    if (dates.size === 0) dates.add('');

    const allGames = [];

    for (const dateStr of dates) {
      const url = dateStr ? `${baseUrl}&Date=${dateStr}` : baseUrl;

      // Convert MM/DD/YYYY to YYYY-MM-DD
      let isoDate = '';
      if (dateStr) {
        const [m, d, y] = dateStr.split('/');
        isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }

      let pageHtml = html;
      if (dateStr && dateStr !== [...dates][0]) {
        pageHtml = await fetchPgHtml(url);
      }

      const $ = cheerio.load(pageHtml);
      const seen = new Set();

      $('a[href*="DiamondKast/Game.aspx?gameid="]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const gm = href.match(/gameid=(\d+)/);
        if (!gm) return;
        const pgGameId = parseInt(gm[1]);
        if (seen.has(pgGameId)) return;

        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (text.length < 10) return; // Skip sub-links (recap, etc.)
        seen.add(pgGameId);

        // Parse: "Field Name Game Recap Final Team1Name Score1 Team2Name Score2"
        // or: "Field Name Time Team1 vs Team2"
        const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
        const hasFinal = /Game Recap|Final/i.test(text);

        // Extract field (before 'Game Recap' or time)
        let field = '';
        const markerIdx = text.search(/Game Recap|\d{1,2}:\d{2}\s*(?:AM|PM)/i);
        if (markerIdx > 0) field = text.slice(0, markerIdx).trim();

        // Get the part after "Final" or after time
        let teamsPart = '';
        if (hasFinal) {
          const fi = text.search(/Final/i);
          teamsPart = text.slice(fi + 5).trim();
        } else if (timeMatch) {
          teamsPart = text.slice(text.indexOf(timeMatch[0]) + timeMatch[0].length).trim();
        }

        // Parse "Team1Name Score1 Team2Name Score2"
        // The score is the last number attached to each team segment
        // Split by finding standalone numbers that separate teams
        let team1 = '', team2 = '', score1 = null, score2 = null;

        // Strategy: match trailing number from the end for team2, then from remainder for team1
        const m2 = teamsPart.match(/^(.+?)\s+(\d{1,3})\s*$/);
        if (m2) {
          score2 = parseInt(m2[2]);
          const rest = m2[1].trim();
          // Now rest = "Team1Name Score1 Team2Name" — find score1 (a number in the middle)
          const m1 = rest.match(/^(.+?)\s+(\d{1,3})\s+(.+)$/);
          if (m1) {
            team1 = m1[1].trim();
            score1 = parseInt(m1[2]);
            team2 = m1[3].trim();
          }
        }

        // Fallback: try "Team1 vs Team2" (no scores)
        if (!team1 && teamsPart.includes(' vs ')) {
          const vsParts = teamsPart.split(' vs ');
          team1 = vsParts[0]?.trim() || '';
          team2 = vsParts[1]?.trim() || '';
        }

        if (!team1 && !team2) return;

        allGames.push({
          pgGameId,
          pgEventId: eventId,
          gameDate: isoDate,
          gameTime: timeMatch ? timeMatch[1].trim() : '',
          field,
          team1,
          team2,
          score1,
          score2,
          isFinal: hasFinal,
          pgBoxUrl: `${PG_BASE}/DiamondKast/Game.aspx?gameid=${pgGameId}`,
        });
      });
    }

    // Deduplicate by pgGameId
    const uniqueMap = new Map();
    for (const g of allGames) {
      if (!uniqueMap.has(g.pgGameId)) uniqueMap.set(g.pgGameId, g);
    }
    const unique = [...uniqueMap.values()];
    console.log(`[scraper] Found ${unique.length} games across ${dates.size} date(s) for event ${eventId}`);
    return unique;
  } catch (err) {
    console.error(`[scraper] TournamentSchedule error for ${eventId}: ${err.message}`);
    return [];
  }
}

module.exports = { scrapeTournamentPage, scrapePitchingReport, scrapeTournamentSchedule, scrapeBracketGames, scrapeRegisteredTeams, scrapeTournamentScheduleFull };
