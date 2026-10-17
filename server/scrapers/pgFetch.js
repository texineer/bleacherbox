const axios = require('axios');
const { getBrowser, scheduleIdleClose } = require('./browser');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Perfect Game sits behind an Azure WAF that rejects plain HTTP clients with a
// 403 block page. Try a plain request first (fast, light); when the WAF blocks
// it, fetch through the stealth browser and keep doing so for an hour before
// trying plain requests again.
const BLOCK_RETRY_MS = 60 * 60 * 1000;
const WAF_MARKER = 'Azure WAF';
let blockedUntil = 0;

async function fetchPgHtml(url) {
  if (Date.now() >= blockedUntil) {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (res.status < 400) return res.data;
    if (res.status !== 403) throw new Error(`Request failed with status code ${res.status}`);
    console.log('[scraper] Perfect Game blocked plain request (403) — switching to browser');
    blockedUntil = Date.now() + BLOCK_RETRY_MS;
  }
  return fetchWithBrowser(url);
}

async function fetchWithBrowser(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = res ? res.status() : 0;
    if (status >= 400 && status !== 403) throw new Error(`Request failed with status code ${status}`);

    // The WAF answers with a 403 JavaScript challenge page that reloads into
    // the real page once solved. PG pages are server-rendered, so the real
    // page is complete as soon as the challenge page is gone.
    const deadline = Date.now() + 20000;
    for (;;) {
      const html = await page.content().catch(() => '');  // throws mid-navigation
      if (html && !html.includes(WAF_MARKER)) return html;
      if (Date.now() > deadline) throw new Error('Request failed with status code 403');
      await page.waitForTimeout(500);
    }
  } finally {
    await context.close();
    scheduleIdleClose();
  }
}

module.exports = { fetchPgHtml };
