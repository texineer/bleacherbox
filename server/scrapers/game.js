const cheerio = require('cheerio');
const { fetchPgHtml } = require('./pgFetch');
const { PG_BASE } = require('./team');

// Scrape final score from DiamondKast game page
async function scrapeGameScore(pgGameId) {
  const url = `${PG_BASE}/DiamondKast/Game.aspx?gameid=${pgGameId}`;

  try {
    const html = await fetchPgHtml(url);

    const $ = cheerio.load(html);

    // Extract from FinalRecap sections
    // Visitor: team name + runs scored
    const visitorText = $('[class*="FinalRecapVisitor"]').first().text().trim().replace(/\s+/g, ' ');
    const homeText = $('[class*="FinalRecapHome"]').first().text().trim().replace(/\s+/g, ' ');

    if (!visitorText && !homeText) return null;

    // Pattern: "TeamName Score Score TeamName" or "TeamName Final"
    // The last standalone number before "Final" or end is the total runs
    // Simpler: the FinalRecap contains team name + total runs
    // "1836 Roughriders 14U Edwards 7 7 1836 Roughriders 14U Edwards" → score is first number after name
    // "5 RR Yardbirds 14U" → score is the leading number

    // Better approach: find all ScoreNum values in each row
    // The total runs is typically the last ScoreNum or the ScoreNumActive
    let visitorRuns = null;
    let homeRuns = null;

    // Try getting the total from the recap text directly
    // Visitor format: "TeamName RUNS ... TeamName" — RUNS appears as a number
    // Home format: "RUNS TeamName"
    // Actually the structure has R H E columns. Let's parse differently.

    // Get the GameRecap text which has both
    const recapText = $('[class*="GameRecap"]').text().trim().replace(/\s+/g, ' ');
    // "Game Recap 1836 Roughriders 14U Edwards 7 7 1836 Roughriders 14U Edwards Final 5 RR Yardbirds 14U"

    // Alternative: count ScoreNum values per row
    // The inning-by-inning scores are in ScoreNum divs
    // Total runs = sum of inning scores for each team
    // But easier: extract from the recap which has "Final" marker

    // Parse visitor: text after team name, before "Final"
    // The FinalRecapVisitor contains: "TeamName R H TeamName" where R is runs
    const vMatch = visitorText.match(/^(.+?)\s+(\d+)\s+\d+\s+/);
    const hMatch = homeText.match(/^(\d+)\s+(.+)/);

    if (vMatch) {
      visitorRuns = parseInt(vMatch[2]);
    }
    if (hMatch) {
      homeRuns = parseInt(hMatch[1]);
    }

    // Extract team names
    let visitorName = vMatch ? vMatch[1].trim() : '';
    let homeName = hMatch ? hMatch[2].trim() : '';

    // If parsing failed, try simpler patterns
    if (visitorRuns === null) {
      // Just find the first number in visitor text
      const nums = visitorText.match(/\d+/g);
      if (nums && nums.length >= 1) visitorRuns = parseInt(nums[0]);
    }
    if (homeRuns === null) {
      const nums = homeText.match(/\d+/g);
      if (nums && nums.length >= 1) homeRuns = parseInt(nums[0]);
    }

    if (visitorRuns === null || homeRuns === null) return null;

    return {
      visitorName,
      homeName,
      visitorScore: visitorRuns,
      homeScore: homeRuns,
      isFinal: recapText.toLowerCase().includes('final') || recapText.toLowerCase().includes('recap'),
    };
  } catch (err) {
    console.log(`[scraper] Failed to fetch score for game ${pgGameId}: ${err.message}`);
    return null;
  }
}

module.exports = { scrapeGameScore };
