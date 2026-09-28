// Petrol & diesel price history for the Daily Rates charts — read live,
// nothing stored.
//
// Pakistani fuel prices are government notifications (revised almost daily
// since Sep 2026), and several sites publish the full dated list. Their
// layouts aren't documented, so each page is parsed generically: table rows
// with a date and plausible per-litre prices, using the header row to tell
// the petrol column from the diesel/HSD column where there is one.
//
// A source is only trusted if its most recent price matches the live price
// the site scrapes right now (within 1%) — that rejects a wrong column, an
// old-price column, or a page that stopped updating. The first source that
// passes wins, per fuel. Results are cached per warm instance for 3 hours.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const SOURCES = [
  'https://www.bakhabarpakistan.com/data/fuel-prices/',
  'https://petrolprice.com.pk/petrol-price-history/',
  'https://pakistanpetrolprices.com/pakistan-petrol-price-history/',
  'https://petrolpricepakistan.com/price-history/',
  'https://petrolpriceinpakistantoday.pk/petrol-price-history/',
];

const PRICE = v => Number.isFinite(v) && v >= 150 && v <= 700;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');

// Parse the many ways these sites write a date → "YYYY-MM-DD" or null
function parseDate(text) {
  const t = String(text);
  let m = t.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d\d)\b/); // DD-MM-YYYY (Pakistani order)
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d\d)\b/); // 28 Sep 2026
  if (m) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return valid(+m[3], mo, +m[1]);
  }
  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/); // September 28, 2026
  if (m) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return valid(+m[3], mo, +m[2]);
  }
  return null;
}

function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function htmlToRows(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(r => r.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

const cellsOf = row => row.split('|').map(c => c.trim());
const priceIn = cell => {
  if (parseDate(cell)) return NaN; // don't read "2026" as a price
  const m = String(cell).replace(/,/g, '').match(/(?<![\d.])(\d{3}(?:\.\d{1,2})?)(?![\d.]*\d)/);
  return m ? parseFloat(m[1]) : NaN;
};

// → { petrol: [[date, price], …], diesel: [[date, price], …] } (ascending)
function parseHistory(html) {
  const rows = htmlToRows(html);
  const out = { petrol: new Map(), diesel: new Map() };
  let cols = null; // { petrol, diesel } column indices from the latest header row

  for (const row of rows) {
    const cells = cellsOf(row);
    const lower = cells.map(c => c.toLowerCase());

    // header row: names the columns, carries no date
    if (!parseDate(row) && lower.some(c => /petrol|ms\b|motor spirit/.test(c))) {
      const p = lower.findIndex(c => /petrol|motor spirit|\bms\b/.test(c));
      const d = lower.findIndex(c => /diesel|hsd/.test(c));
      cols = { petrol: p, diesel: d };
      continue;
    }

    const date = parseDate(row);
    if (!date) continue;

    if (cols && cols.petrol >= 0) {
      const p = priceIn(cells[cols.petrol]);
      const d = cols.diesel >= 0 ? priceIn(cells[cols.diesel]) : NaN;
      if (PRICE(p)) out.petrol.set(date, p);
      if (PRICE(d)) out.diesel.set(date, d);
    } else {
      // no header: "date | petrol | diesel" is the common order
      const nums = cells.map(priceIn).filter(PRICE);
      if (nums[0] != null) out.petrol.set(date, nums[0]);
      if (nums[1] != null) out.diesel.set(date, nums[1]);
    }
  }

  const sorted = m => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { petrol: sorted(out.petrol), diesel: sorted(out.diesel) };
}

// A series is usable if it has some depth and its latest point matches the
// live price (so it's current and it's really this fuel's column).
function trusted(series, live, today) {
  if (series.length < 5) return false;
  const [lastDate, lastPrice] = series[series.length - 1];
  if (live == null) return false;
  const ageDays = (Date.parse(today) - Date.parse(lastDate)) / 86400000;
  return ageDays <= 10 && Math.abs(lastPrice - live) / live <= 0.01;
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6500);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

let cache = null; // { at, pages: [{ url, parsed | error }] }
const TTL = 3 * 3600 * 1000;

async function getParsedPages() {
  if (cache && Date.now() - cache.at < TTL) return cache.pages;
  const pages = await Promise.all(SOURCES.map(async url => {
    try {
      return { url, parsed: parseHistory(await fetchPage(url)) };
    } catch (e) {
      return { url, error: String(e.message).slice(0, 60) };
    }
  }));
  if (pages.some(p => p.parsed)) cache = { at: Date.now(), pages };
  return pages;
}

// `live` may be a promise, so the pages download while the live price is scraped.
// → { petrol: {series, url} | null, diesel: …, report: [...] }
async function getFuelHistory(live, today) {
  [live] = await Promise.all([live, getParsedPages()]);
  const pages = await getParsedPages();
  const pick = fuel => {
    for (const p of pages) {
      const s = p.parsed?.[fuel] ?? [];
      if (trusted(s, live[fuel], today)) return { series: s, url: p.url };
    }
    return null;
  };
  return {
    petrol: pick('petrol'),
    diesel: pick('diesel'),
    report: pages.map(p => p.error
      ? { url: p.url, error: p.error }
      : { url: p.url, petrolPoints: p.parsed.petrol.length, dieselPoints: p.parsed.diesel.length,
          latest: { petrol: p.parsed.petrol.at(-1) ?? null, diesel: p.parsed.diesel.at(-1) ?? null } }),
  };
}

module.exports = { getFuelHistory, parseHistory, parseDate, trusted };
