/**
 * Yad2 apartment finder — scraper.
 *
 * Beats Radware bot protection by driving a real (headless) Google Chrome:
 * warm up on the homepage (which clears the challenge), then call Yad2's
 * internal feed API from inside the warmed browser context.
 *
 * Target search (matches https://www.yad2.co.il/realestate/rent/tel-aviv-area):
 *   region=3 (Tel Aviv & surroundings) · 4 rooms · <= 8000 ILS
 *   must have: parking + elevator + mamad (shelter)
 *
 * Writes docs/listings.json (current matches, deduped, NEW flag preserved).
 * If the scrape is blocked/fails, the previous listings.json is left untouched.
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');

const PROFILE = path.join(__dirname, '.profile-chrome');
const OUT = path.join(__dirname, 'docs', 'listings.json');

const FEED = 'https://gw.yad2.co.il/realestate-feed/rent/feed?';
const QUERY = [
  'region=3',
  'minRooms=4',
  'maxRooms=4',
  'minPrice=6500',
  'maxPrice=8000',
  'parking=1',
  'elevator=1',
  'shelter=1', // ממ"ד / mamad
].join('&');

const SEARCH_PAGE_URL =
  'https://www.yad2.co.il/realestate/rent/tel-aviv-area?minPrice=6500&maxPrice=8000&minRooms=4&maxRooms=4&parking=1&elevator=1&shelter=1';

const log = (...a) => console.log(new Date().toISOString(), ...a);

function normalize(item) {
  const a = item.address || {};
  const d = item.additionalDetails || {};
  const houseNum = a.house && a.house.number ? a.house.number : '';
  const street = a.street && a.street.text ? a.street.text : '';
  const hood = a.neighborhood && a.neighborhood.text ? a.neighborhood.text : '';
  const city = a.city && a.city.text ? a.city.text : '';
  const addressParts = [
    [street, houseNum].filter(Boolean).join(' '),
    hood,
    city,
  ].filter(Boolean);
  return {
    id: String(item.token || item.orderId),
    token: item.token,
    price: item.price || 0,
    rooms: d.roomsCount || null,
    sqm: d.squareMeter || null,
    floor: a.house && a.house.floor != null ? a.house.floor : null,
    city,
    neighborhood: hood,
    street,
    address: addressParts.join(', '),
    lat: a.coords ? a.coords.lat : null,
    lon: a.coords ? a.coords.lon : null,
    image: item.metaData ? item.metaData.coverImage : null,
    images: item.metaData ? item.metaData.images || [] : [],
    tags: (item.tags || []).map((t) => t.name),
    adType: item.adType || '',
    url: item.token ? `https://www.yad2.co.il/realestate/item/${item.token}` : null,
  };
}

async function warmUp(page) {
  await page.goto('https://www.yad2.co.il/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let title = await page.title();
  for (let i = 0; i < 30 && /radware/i.test(title); i++) {
    await page.waitForTimeout(1500);
    title = await page.title();
  }
  if (/radware/i.test(title)) throw new Error('Radware challenge did not clear on homepage');
  await page.waitForTimeout(2000);
}

async function fetchPage(page, pageNum) {
  const url = FEED + QUERY + '&page=' + pageNum;
  const r = await page.evaluate(async (u) => {
    const res = await fetch(u, { headers: { accept: 'application/json' }, credentials: 'include' });
    return { status: res.status, text: await res.text() };
  }, url);
  if (r.status !== 200) throw new Error(`feed page ${pageNum} status ${r.status}`);
  const j = JSON.parse(r.text);
  const data = j.data || {};
  const items = [...(data.private || []), ...(data.agency || [])];
  const total = data.pagination ? data.pagination.total : null;
  return { items, total };
}

function loadPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (_) {
    return { updatedAt: null, listings: [] };
  }
}

(async () => {
  const prev = loadPrevious();
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    channel: 'chrome',
    viewport: { width: 1366, height: 900 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await context.newPage();
  try {
    log('warming up (clearing Radware)...');
    await warmUp(page);
    log('collecting listings...');
    const collected = [];
    const seen = new Set();
    for (let p = 1; p <= 15; p++) {
      const { items } = await fetchPage(page, p);
      if (!items.length) break;
      let added = 0;
      for (const it of items) {
        const norm = normalize(it);
        if (norm.id && !seen.has(norm.id)) {
          seen.add(norm.id);
          collected.push(norm);
          added++;
        }
      }
      log(`  page ${p}: +${added} (total ${collected.length})`);
      if (added === 0) break;
      await page.waitForTimeout(700);
    }
    if (!collected.length) throw new Error('0 listings collected (likely blocked) — keeping previous data');

    // Merge: preserve firstSeen, flag genuinely new listings.
    const prevById = new Map((prev.listings || []).map((l) => [l.id, l]));
    const now = new Date().toISOString();
    let newCount = 0;
    const listings = collected.map((l) => {
      const old = prevById.get(l.id);
      const isNew = !old;
      if (isNew) newCount++;
      return {
        ...l,
        firstSeen: old ? old.firstSeen : now,
        isNew,
      };
    });
    // sort: newest firstSeen first, then priced-cheapest (unpriced sink to bottom)
    const priceKey = (p) => (p > 0 ? p : Infinity);
    listings.sort((a, b) => {
      if (a.firstSeen !== b.firstSeen) return a.firstSeen < b.firstSeen ? 1 : -1;
      return priceKey(a.price) - priceKey(b.price);
    });

    const out = {
      updatedAt: now,
      lastRunOk: true,
      count: listings.length,
      newCount,
      searchUrl: SEARCH_PAGE_URL,
      criteria: {
        area: 'תל אביב והסביבה (region 3)',
        rooms: 4,
        minPrice: 6500,
        maxPrice: 8000,
        features: ['ממ"ד', 'חניה', 'מעלית'],
      },
      listings,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    log(`DONE: ${listings.length} listings, ${newCount} new. Written to ${OUT}`);
  } catch (err) {
    log('SCRAPE FAILED:', err.message);
    // touch the previous file's timestamp info so the page can show a stale warning,
    // but do NOT overwrite the listings.
    if (prev && prev.listings) {
      prev.lastRunOk = false;
      prev.lastErrorAt = new Date().toISOString();
      prev.lastError = err.message;
      try { fs.writeFileSync(OUT, JSON.stringify(prev, null, 2)); } catch (_) {}
    }
    process.exitCode = 1;
  } finally {
    await context.close();
  }
})();
