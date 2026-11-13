// Karachi utilities: K-Electric load-shed schedule and SSGC gas supply hours.
//
// Electricity: K-Electric publishes its load-shed schedule as a PDF linked
//   from ke.com.pk/load-shed-schedule (feeder name, grid, up to four daily
//   outage cycles). The page is read for the current PDF link, and the PDF's
//   table is parsed with unpdf (a free, MIT-licensed reader) — so a new
//   schedule is picked up on its own. If KE can't be reached, the last saved
//   schedule (data/ke-loadshed.json) is served and labelled.
//
// Gas: SSGC announces supply hours as a picture on its homepage, which can't
//   be read by a program. The announced hours live in data/utilities.json.
//   The homepage is checked on every refresh, and if SSGC has posted a
//   different notice image the response says so, so the card can warn that
//   the hours may have changed and link to the new notice.
//
// Add ?debug=1 to see what each source returned.
const fs = require('fs');
const path = require('path');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const KE_PAGE = 'https://ke.com.pk/load-shed-schedule/';
const SSGC_HOME = 'https://www.ssgc.com.pk/web/';
const DATA = name => path.join(process.cwd(), 'data', name);

async function fetchBuf(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timeout' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// ── K-Electric schedule PDF ──────────────────────────────────────────────────

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const CYCLE = /^(\d{2})(\d{2})\s*[~-]\s*(\d{2})(\d{2})$/;

// "applicable from 23rd October, 2026" → "2026-10-23"
function effectiveDate(text) {
  const m = text.match(/applicable from\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*,?\s+(20\d\d)/i);
  const mo = m && MONTHS[m[2].toLowerCase()];
  return mo ? `${m[3]}-${pad(mo)}-${pad(+m[1])}` : null;
}

// Text items with positions → table rows. Cells of one printed row can sit
// a point apart vertically, so rows are clustered rather than matched exactly.
function toRows(items) {
  const cells = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - c.y) <= 3) row.cells.push(c);
    else rows.push({ y: c.y, cells: [c] });
  }
  return rows.map(r => r.cells.sort((a, b) => a.x - b.x));
}

// → { effective, feeders: [[name, grid, [[startMin, endMin], …]], …] }
async function parseSchedulePdf(buf) {
  const { getDocumentProxy } = require('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
  const feeders = [];
  let effective = null;
  let gridX = null; // left edge of the "Grids" column, from the header row

  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    if (n === 1) effective = effectiveDate(content.items.map(i => i.str).join(' '));
    for (const cells of toRows(content.items)) {
      const header = cells.find(c => /^grids?$/i.test(c.s));
      if (header && cells.some(c => /cycle/i.test(c.s))) { gridX = header.x - 60; continue; }

      const cycles = [];
      const rest = [];
      for (const c of cells) {
        const m = c.s.match(CYCLE);
        if (m) cycles.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
        else if (c.s !== '-') rest.push(c);
      }
      if (!cycles.length || gridX == null) continue;
      const name = rest.filter(c => c.x < gridX).map(c => c.s).join(' ').replace(/\s+/g, ' ').trim();
      const grid = rest.filter(c => c.x >= gridX).map(c => c.s).join(' ').replace(/\s+/g, ' ').trim();
      if (!name || !grid) continue;
      if (cycles.some(([s, e]) => s >= 1440 || e >= 1440)) continue;
      feeders.push([name, grid, cycles]);
    }
  }
  if (feeders.length < 20) throw new Error(`only ${feeders.length} feeders read`);
  return { effective, feeders };
}

// The schedule PDF's name changes with every release, so find it on the page
function schedulePdfLinks(html) {
  const links = [...html.matchAll(/href="([^"]+\.pdf)"/gi)]
    .map(m => new URL(m[1].replace(/&amp;/g, '&'), KE_PAGE).href)
    .filter(u => !/non-?payers/i.test(u));
  const rank = u => (/lsm|load-?shed|schedule/i.test(u) ? 0 : /feeders?-list/i.test(u) ? 2 : 1);
  return [...new Set(links)].sort((a, b) => rank(a) - rank(b));
}

let powerCache = null; // { at, value }
const POWER_TTL = 6 * 3600 * 1000;

async function getPower() {
  if (powerCache && Date.now() - powerCache.at < POWER_TTL) return powerCache.value;
  const tried = [];
  try {
    const links = schedulePdfLinks((await fetchBuf(KE_PAGE)).toString('utf8'));
    if (!links.length) throw new Error('no PDF link on the KE page');
    for (const url of links.slice(0, 3)) {
      try {
        const parsed = await parseSchedulePdf(await fetchBuf(url, 10000));
        const value = { ...parsed, pdf: url, source: 'live', tried };
        powerCache = { at: Date.now(), value };
        return value;
      } catch (e) {
        tried.push({ url, error: e.message });
      }
    }
    throw new Error('no PDF on the KE page could be read as a schedule');
  } catch (e) {
    tried.push({ error: e.message });
    try {
      const saved = JSON.parse(fs.readFileSync(DATA('ke-loadshed.json'), 'utf8'));
      return { ...saved, source: 'saved', tried };
    } catch {
      return { feeders: null, source: 'unavailable', tried };
    }
  }
}

// ── SSGC gas hours ───────────────────────────────────────────────────────────

// The notice image SSGC is showing right now, if any
function gasNoticeImage(html) {
  const imgs = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]*\/wp-content\/uploads\/[^"]*\.(?:webp|jpe?g|png))"/gi)].map(m => m[1]);
  return imgs.find(u => /gas[_-]?(?:timing|schedule|supply|hours)|load[_-]?(?:shedding|management)/i.test(u)) ?? null;
}

async function getGas() {
  const saved = JSON.parse(fs.readFileSync(DATA('utilities.json'), 'utf8')).gas;
  let liveImage = null, error = null;
  try {
    liveImage = gasNoticeImage((await fetchBuf(SSGC_HOME, 6000)).toString('utf8'));
  } catch (e) {
    error = e.message;
  }
  return {
    slots: saved.slots,
    announced: saved.announced,
    note: saved.note,
    notice: liveImage ?? saved.image,
    // a different image on SSGC's site means a newer announcement than ours
    changed: Boolean(liveImage && liveImage !== saved.image),
    checked: error ? `SSGC unreachable: ${error}` : liveImage ? 'ok' : 'no notice image on SSGC homepage',
  };
}

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  const t0 = Date.now();
  const [power, gas] = await Promise.allSettled([getPower(), getGas()]);
  const p = power.status === 'fulfilled' ? power.value : { feeders: null, source: 'unavailable', tried: [{ error: String(power.reason?.message) }] };
  const g = gas.status === 'fulfilled' ? gas.value : null;
  const { tried, ...powerOut } = p;
  const { checked, ...gasOut } = g ?? {};

  if (!powerOut.feeders && !g) {
    return res.status(502).json({ success: false, message: 'Power and gas schedules are temporarily unavailable' });
  }

  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.json({
    success: true,
    data: { power: powerOut.feeders ? powerOut : null, gas: g ? gasOut : null },
    ...(debug ? { debug: { ms: Date.now() - t0, power: { source: p.source, feeders: p.feeders?.length ?? 0, effective: p.effective, pdf: p.pdf, tried }, gas: checked ?? String(gas.reason?.message) } } : {}),
  });
};

module.exports.parseSchedulePdf = parseSchedulePdf;
module.exports.schedulePdfLinks = schedulePdfLinks;
module.exports.gasNoticeImage = gasNoticeImage;
