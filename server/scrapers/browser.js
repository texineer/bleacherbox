const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin to avoid bot detection
chromium.use(StealthPlugin());

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  console.log('[browser] Launching stealth Chromium...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return browser;
}

async function fetchRenderedHtml(url, { waitFor = 'networkidle', timeout = 30000, waitSelector = null } = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: waitFor, timeout });

    // If a specific selector is provided, wait for it to appear
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 15000 }).catch(() => {
        console.log(`[browser] Selector "${waitSelector}" not found, continuing...`);
      });
    }

    // Extra wait for JS-rendered content
    await page.waitForTimeout(2000);

    const html = await page.content();
    return html;
  } finally {
    await context.close();
  }
}

async function closeBrowser() {
  clearTimeout(idleTimer);
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Close the browser once nothing has used it for a while, so a one-off fetch
// doesn't leave Chromium holding memory. Contexts still open (e.g. a Five Tool
// scrape in progress) postpone the close.
let idleTimer = null;
function scheduleIdleClose(ms = 60000) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!browser) return;
    if (browser.contexts().length > 0) return scheduleIdleClose(ms);
    closeBrowser().catch(() => {});
  }, ms);
  idleTimer.unref();
}

module.exports = { getBrowser, fetchRenderedHtml, closeBrowser, scheduleIdleClose };
