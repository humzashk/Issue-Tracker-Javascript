// Official weekly Karachi prices from the Pakistan Bureau of Statistics.
//
// Every Thursday PBS publishes the Sensitive Price Indicator (SPI): prices of
// 51 essential items in 17 cities, as an Excel annex at a predictable URL
// (Annex_DD.MM.YYYY.xlsx). We read the Karachi average column from the last
// ~year of weekly annexes, so the Daily Rates charts have real, official
// history up to the latest week — read live, nothing stored.
//
// The .xlsx is a zip of XML files; it's unpacked with node's zlib, so this
// needs no dependencies.
const zlib = require('zlib');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE = 'https://www.pbs.gov.pk/wp-content/uploads/2020/07/';
const CITY = /^karachi\b/i;
const WEEKS = 52;

// ── minimal xlsx reader ──────────────────────────────────────────────────────

function unzip(buf) {
  // find the end-of-central-directory record, then walk the central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xmlText = s => s
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const colIndex = ref => {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

// → rows: Map(rowNumber → Map(colIndex → value)) for the first worksheet
function readSheet(buf) {
  const files = unzip(buf);
  const shared = files['xl/sharedStrings.xml']
    ? [...files['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText(m[1]).trim())
    : [];
  const sheet = files['xl/worksheets/sheet1.xml']();
  const rows = new Map();
  for (const c of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, row, attrs, inner = ''] = c;
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let value;
    if (/t="s"/.test(attrs)) value = shared[+v];
    else if (/t="inlineStr"/.test(attrs)) value = xmlText(inner).trim();
    else if (v != null) value = Number(v);
    if (value == null || value === '') continue;
    if (!rows.has(+row)) rows.set(+row, new Map());
    rows.get(+row).set(colIndex(col), value);
  }
  return rows;
}

// ── SPI annex → Karachi prices ───────────────────────────────────────────────

// → { "Wheat Flour Bag": { unit, avg, min, max }, … } for the Karachi column
function parseAnnex(buf) {
  const rows = readSheet(buf);
  let cityCol = -1, cityRow = -1;
  for (const [r, cells] of rows) {
    for (const [c, v] of cells) if (typeof v === 'string' && CITY.test(v)) { cityCol = c; cityRow = r; break; }
    if (cityCol >= 0) break;
  }
  if (cityCol < 0) throw new Error('Karachi column not found');

  // MIN / AVG / MAX headers sit under the city name (which may be merged
  // over them), so look for AVG in the next couple of rows near that column
  let avgCol = -1, minCol = -1, maxCol = -1, descCol = -1, unitCol = -1;
  for (let r = cityRow; r <= cityRow + 3 && avgCol < 0; r++) {
    const cells = rows.get(r);
    if (!cells) continue;
    for (const [c, v] of cells) {
      if (c < cityCol - 1 || c > cityCol + 3 || typeof v !== 'string') continue;
      if (/^avg/i.test(v) && avgCol < 0) avgCol = c;
    }
    if (avgCol >= 0) {
      for (const [c, v] of cells) {
        if (typeof v !== 'string') continue;
        if (/^min/i.test(v) && c < avgCol && c >= avgCol - 2) minCol = c;
        if (/^max/i.test(v) && c > avgCol && c <= avgCol + 2 && maxCol < 0) maxCol = c;
      }
    }
  }
  if (avgCol < 0) avgCol = cityCol + 1; // MIN AVG MAX under a merged city cell

  for (const [, cells] of rows) {
    for (const [c, v] of cells) {
      if (v === 'DESCRIPTION') descCol = c;
      if (v === 'UNIT') unitCol = c;
    }
    if (descCol >= 0) break;
  }
  if (descCol < 0) throw new Error('DESCRIPTION column not found');

  // the city block only covers the rows of its own table (a sheet holds
  // several city groups side by side, then more groups further down)
  const out = {};
  for (const [r, cells] of rows) {
    if (r <= cityRow) continue;
    const name = cells.get(descCol);
    const avg = cells.get(avgCol);
    if (typeof name !== 'string' || typeof avg !== 'number') {
      // a new header row for another table → stop
      if ([...cells.values()].some(v => typeof v === 'string' && /^(SL\.|APPENDIX)/i.test(v)) && Object.keys(out).length) break;
      continue;
    }
    if (out[name]) continue;
    out[name] = {
      unit: cells.get(unitCol) ?? '',
      avg,
      min: typeof cells.get(minCol) === 'number' ? cells.get(minCol) : null,
      max: typeof cells.get(maxCol) === 'number' ? cells.get(maxCol) : null,
    };
  }
  if (Object.keys(out).length < 20) throw new Error('too few items parsed');
  return out;
}

// ── fetching the weekly series ───────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0');
const ddmmyyyy = t => { const d = new Date(t); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; };
const ymd = t => new Date(t).toISOString().slice(0, 10);

async function fetchAnnex(dateStr) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}Annex_${dateStr}.xlsx`, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) return { status: res.status };
    return { status: 200, buf: Buffer.from(await res.arrayBuffer()) };
  } finally {
    clearTimeout(timer);
  }
}

// The SPI week ends on Thursday; a holiday can move a release a day earlier.
function recentThursdays(today, n) {
  const t = Date.parse(today);
  const back = (new Date(t).getUTCDay() - 4 + 7) % 7;
  const out = [];
  for (let i = 0; i < n; i++) out.push(t - (back + 7 * i) * 86400000);
  return out;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(e => ({ error: e.message })); }
  }));
  return out;
}

const weekCache = new Map(); // "DD.MM.YYYY" → parsed annex (past weeks never change)
let missCache = { at: 0, misses: new Set() };

// → { weeks: [{ date: 'YYYY-MM-DD', items }], report }
async function getSpiSeries(today) {
  if (Date.now() - missCache.at > 3 * 3600 * 1000) missCache = { at: Date.now(), misses: new Set() };
  const thursdays = recentThursdays(today, WEEKS);
  const report = [];
  const weeks = await pool(thursdays, 8, async t => {
    for (const day of [t, t - 86400000]) { // Thursday, else Wednesday
      const key = ddmmyyyy(day);
      if (weekCache.has(key)) return { date: ymd(day), items: weekCache.get(key) };
      if (missCache.misses.has(key)) continue;
      const r = await fetchAnnex(key);
      if (r.buf) {
        try {
          const items = parseAnnex(r.buf);
          weekCache.set(key, items);
          return { date: ymd(day), items };
        } catch (e) {
          report.push({ week: key, error: e.message });
          return null;
        }
      }
      missCache.misses.add(key);
    }
    return null;
  });
  const found = weeks.filter(w => w?.items).sort((a, b) => a.date.localeCompare(b.date));
  return { weeks: found, report: { weeksFound: found.length, latest: found.at(-1)?.date ?? null, errors: report } };
}

module.exports = { getSpiSeries, parseAnnex, readSheet, recentThursdays };
