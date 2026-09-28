// Pakistani market commodity rates.
//
// Every price here comes from several independent sources and the card
// shows the consensus, so one stale or mis-read source can't decide it.
//
// Gold & silver (PKR per tola): the local sarafa rate as published by five
// Pakistani rate sites (gold.pk, HamariWeb, UrduPoint, PakistanGoldPrice,
// Oraan). Each page is parsed for the 24K per-tola figure, sanity-checked
// against international spot converted to PKR, and the MEDIAN of the sources
// that answered is shown. Only if none can be read does the card fall back
// to the converted international price — and it says so.
//
// Crude oil (USD/barrel): ICE Brent and NYMEX WTI front-month futures from
// three feeds — CNBC's quote service (continuous front month, the figure
// news reports quote), Yahoo Finance and Stooq. The consensus is the
// median; a feed more than 1.5% away from it is ignored, which is exactly
// what happens when one feed is still on an expiring contract around a
// roll date. The daily change comes from the same feed as the price shown.
//
// Add ?debug=1 to see every source's raw figure and which ones agreed.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const TROY_OZ_PER_TOLA = 0.375; // 1 tola = 11.6638 g = exactly 0.375 troy oz

const GOLD_SOURCES = [
  { name: 'gold.pk', urls: ['https://gold.pk/', 'https://www.gold.pk/'] },
  { name: 'HamariWeb', urls: ['https://hamariweb.com/finance/gold_rate/'] },
  { name: 'UrduPoint', urls: ['https://www.urdupoint.com/business/gold-rates.html'] },
  { name: 'PakistanGoldPrice', urls: ['https://pakistangoldprice.com/'] },
  { name: 'Oraan', urls: ['https://www.oraan.com/gold-rate-pakistan-today'] },
];

const OIL = [
  { id: 'oil-brent', name: 'Crude Oil (Brent)', cnbc: '@LCO.1', yahoo: 'BZ=F', stooq: 'cb.f', market: 'ICE Brent' },
  { id: 'oil-wti', name: 'Crude Oil (WTI)', cnbc: '@CL.1', yahoo: 'CL=F', stooq: 'cl.f', market: 'NYMEX WTI' },
];
const OIL_SANE = v => Number.isFinite(v) && v > 10 && v < 400;

async function fetchWith(url, timeoutMs = 8000, accept = 'text/html') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooPrice(symbol) {
  const res = await fetchWith(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
    7000,
    'application/json'
  );
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  return meta?.regularMarketPrice ?? meta?.previousClose ?? null;
}

async function fetchPKRRate() {
  const res = await fetchWith('https://open.er-api.com/v6/latest/USD', 7000, 'application/json');
  const json = await res.json();
  const pkr = json?.rates?.PKR;
  if (!pkr) throw new Error('PKR rate missing');
  return pkr;
}

// gold.pk publishes rates in tables where the UNIT lives in the header row
// and the PURITY in the first cell, so a plain proximity search mis-reads it
// (the "per 10 gram" header sits as close to a value as "per tola" does).
// These helpers keep rows and columns intact instead.
function htmlToRows(html) {
  const flat = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(tr|table|p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  return flat
    .split('\n')
    .map(r => r.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

const splitCells = row => row.split('|').map(c => c.trim()).filter(Boolean);

function toAmount(cell) {
  const m = cell.match(/([\d][\d,]{2,12})(?:\.\d+)?/);
  if (!m) return null;
  const v = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(v) && v >= 100 ? v : null;
}

const isTola = t => /\btola\b/i.test(t);
const isOtherUnit = t => /\d+\s*gram|\bgram\b|\bounce\b|\boz\b|\bmasha\b/i.test(t);

// Row label describes the metal (and, for gold, 24K rather than 22/21/18K)
function labelMatches(label, metal) {
  const t = label.toLowerCase();
  if (/phone|call|whatsapp|contact|\+92/.test(t)) return false;
  if (metal === 'gold') {
    if (!/gold|karat|carat|\b2[1248]\s*k\b/.test(t)) return false;
    if (/\b(22|21|18|14|12|10)\s*(k|karat|carat)\b/.test(t)) return false;
    return true;
  }
  return /silver|chandi/.test(t) && !/gold/.test(t);
}

// Strategy A — table with a unit header row: take the value under "per tola".
function findByColumn(rows, metal) {
  let tolaCol = null;
  for (const row of rows) {
    const cells = splitCells(row);
    const idx = cells.findIndex(isTola);
    if (idx > 0 && cells.every(c => toAmount(c) === null || isTola(c) || isOtherUnit(c))) {
      tolaCol = idx;
      continue;
    }
    if (tolaCol == null) continue;

    if (cells.length > tolaCol && labelMatches(cells[0], metal)) {
      const value = toAmount(cells[tolaCol]);
      if (value != null) return { value, how: `column ${tolaCol} under a "per tola" header`, context: row.slice(0, 90) };
    }
  }
  return null;
}

// Strategy B — the unit word sits in the same row as the number
// (e.g. "24K Gold Per Tola | Rs 442,300").
function findByRow(rows, metal) {
  for (const row of rows) {
    if (!isTola(row)) continue;
    const cells = splitCells(row);
    const label = cells.find(c => toAmount(c) === null) ?? cells[0] ?? '';
    if (!labelMatches(label + ' ' + row, metal)) continue;

    for (const cell of cells) {
      if (isOtherUnit(cell) && !isTola(cell)) continue;
      const value = toAmount(cell);
      if (value != null) return { value, how: 'same row as the word "tola"', context: row.slice(0, 90) };
    }
  }
  return null;
}

// Plausibility guard: a local Pakistani rate sits at or a little above the
// spot-derived value (duty + market premium) — never far below, never wildly
// above. Keeps a mis-parse from ever reaching the card.
// Pakistani 24K gold trades within a few percent of converted spot; the
// lower bound also keeps a mis-read 22K figure (~0.92x) out. Silver's local
// premium varies more, so its band is wider.
const BANDS = { gold: [0.93, 1.25], silver: [0.85, 1.6] };

function plausible(value, expected, metal = 'gold') {
  if (value == null) return false;
  if (!expected) return value > 0;
  const [lo, hi] = BANDS[metal];
  return value >= expected * lo && value <= expected * hi;
}

function findRate(rows, metal, expected) {
  for (const [name, fn] of [['column', findByColumn], ['row', findByRow]]) {
    const hit = fn(rows, metal);
    if (hit && plausible(hit.value, expected, metal)) return { ...hit, strategy: name };
  }
  return null;
}

const median = arr => {
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// Consensus of several readings: median, then drop anything more than `tol`
// away and take the median of what's left. Returns null if nothing usable.
function consensus(values, tol) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return null;
  const m0 = median(v);
  const agree = v.filter(x => Math.abs(x - m0) / m0 <= tol);
  return { value: median(agree.length ? agree : v), agreeing: agree.length, total: v.length };
}

async function readGoldSource(src, expectedGold, expectedSilver) {
  let lastErr = null;
  for (const url of src.urls) {
    try {
      const rows = htmlToRows(await (await fetchWith(url)).text());
      const gold = findRate(rows, 'gold', expectedGold);
      const silver = findRate(rows, 'silver', expectedSilver);
      if (gold || silver) return { source: src.name, url, gold: gold?.value ?? null, silver: silver?.value ?? null };
      lastErr = 'no per-tola rate found on page';
    } catch (e) {
      lastErr = String(e.message).slice(0, 60);
    }
  }
  return { source: src.name, gold: null, silver: null, error: lastErr };
}

async function scrapePakistaniGold(expectedGold, expectedSilver) {
  const readings = await Promise.all(GOLD_SOURCES.map(s => readGoldSource(s, expectedGold, expectedSilver)));
  const pick = metal => {
    const got = readings.filter(r => r[metal] != null);
    const c = consensus(got.map(r => r[metal]), 0.02);
    if (!c) return null;
    const agreeing = got.filter(r => Math.abs(r[metal] - c.value) / c.value <= 0.02).map(r => r.source);
    return { value: Math.round(c.value), sources: agreeing };
  };
  return { gold: pick('gold'), silver: pick('silver'), readings };
}

// Front-month futures quote with previous settlement and quote time.
// Tries both of Yahoo's hosts — one is sometimes rate-limited.
async function yahooQuote(symbol) {
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const res = await fetchWith(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        7000,
        'application/json'
      );
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (!OIL_SANE(price)) throw new Error('no usable price');
      return {
        price,
        prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Independent second feed. CSV: Symbol,Date,Time,Open,High,Low,Close
async function stooqQuote(symbol) {
  const res = await fetchWith(`https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlc&h&e=csv`, 7000, 'text/csv');
  const [header, row] = (await res.text()).trim().split(/\r?\n/);
  if (!row) throw new Error('empty');
  const cols = header.split(',').map(c => c.trim().toLowerCase());
  const vals = row.split(',');
  const price = parseFloat(vals[cols.indexOf('close')]);
  if (!OIL_SANE(price)) throw new Error('no usable price');
  return { price };
}

// CNBC's public quote service — continuous front month, as quoted in news.
const num = x => (x == null ? NaN : parseFloat(String(x).replace(/[,+%]/g, '')));
let cnbcBatch = null;
async function cnbcQuotes() {
  cnbcBatch ??= (async () => {
    const syms = OIL.map(o => o.cnbc).join('|');
    const res = await fetchWith(
      'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol' +
        `?symbols=${encodeURIComponent(syms)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`,
      7000,
      'application/json'
    );
    const list = (await res.json())?.FormattedQuoteResult?.FormattedQuote ?? [];
    return Object.fromEntries(list.map(q => [q.symbol, q]));
  })().finally(() => setTimeout(() => { cnbcBatch = null; }, 0));
  return cnbcBatch;
}

async function cnbcQuote(symbol) {
  const q = (await cnbcQuotes())[symbol];
  const price = num(q?.last);
  if (!OIL_SANE(price)) throw new Error('no usable price');
  const prev = num(q.previous_day_closing);
  return { price, prevClose: OIL_SANE(prev) ? prev : null, asOf: q.last_time ? Date.parse(q.last_time) || null : null };
}

async function oilQuote(o) {
  const feeds = [
    // priority order when feeds disagree; Yahoo last — its Brent (BZ=F) is a
    // thinly traded copy that lags, especially around contract roll dates
    ['CNBC', () => cnbcQuote(o.cnbc)],
    ['Stooq', () => stooqQuote(o.stooq)],
    ['Yahoo', () => yahooQuote(o.yahoo)],
  ];
  const results = await Promise.allSettled(feeds.map(([, fn]) => fn()));
  const got = results
    .map((r, i) => (r.status === 'fulfilled' ? { feed: feeds[i][0], ...r.value } : null))
    .filter(Boolean);
  const raw = Object.fromEntries(results.map((r, i) => [feeds[i][0], r.status === 'fulfilled' ? r.value.price : String(r.reason?.message)]));
  if (!got.length) throw new Error(`${o.name}: no source available`);

  const c = consensus(got.map(g => g.price), 0.015);
  const agreeing = got.filter(g => Math.abs(g.price - c.value) / c.value <= 0.015);
  // show the highest-priority agreeing feed, so price and change match
  const shown = agreeing[0] ?? got[0];
  const withPrev = (agreeing.length ? agreeing : [shown]).find(g => g.prevClose);
  const change = withPrev ? shown.price - withPrev.prevClose : null;
  const verified = agreeing.length >= 2;

  return {
    id: o.id,
    name: o.name,
    unit: 'per barrel',
    price: shown.price,
    currency: 'USD',
    live: true,
    change,
    changePct: change != null ? (change / withPrev.prevClose) * 100 : null,
    asOf: shown.asOf ?? null,
    source: `${o.market} · ${verified ? `${agreeing.length} of ${got.length} feeds agree` : got.length > 1 ? 'feeds disagree' : 'single feed'}`,
    _raw: { ...raw, shown: shown.feed, agreeing: agreeing.map(g => g.feed) },
  };
}

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';

  const [pkrR, goldOzR, silverOzR, copperR, ...oilR] = await Promise.allSettled([
    fetchPKRRate(),
    fetchYahooPrice('GC=F'),
    fetchYahooPrice('SI=F'),
    fetchYahooPrice('HG=F'),
    ...OIL.map(oilQuote),
  ]);

  const val = r => (r.status === 'fulfilled' ? r.value : null);
  const pkr = val(pkrR);
  const goldOz = val(goldOzR);
  const silverOz = val(silverOzR);
  const copperLb = val(copperR);
  const oil = oilR.map(val).filter(Boolean);

  const spotTola = ozPrice =>
    ozPrice != null && pkr ? Math.round(ozPrice * TROY_OZ_PER_TOLA * pkr) : null;

  const expectedGold = spotTola(goldOz);
  const expectedSilver = spotTola(silverOz);

  let scraped = { gold: null, silver: null, readings: [] };
  try {
    scraped = await scrapePakistaniGold(expectedGold, expectedSilver);
  } catch (e) {
    console.error('gold scrape failed:', e.message);
  }
  const srcLabel = r => `sarafa rate · ${r.sources.length} source${r.sources.length > 1 ? 's' : ''}` +
    (r.sources.length === 1 ? ` (${r.sources[0]})` : '');

  const data = [];

  data.push({
    id: 'gold',
    name: 'Gold (24k)',
    unit: 'per tola',
    price: scraped.gold?.value ?? expectedGold,
    currency: 'PKR',
    live: Boolean(scraped.gold),
    source: scraped.gold ? srcLabel(scraped.gold) : 'international spot, converted (local sites unreachable)',
  });

  data.push({
    id: 'silver',
    name: 'Silver',
    unit: 'per tola',
    price: scraped.silver?.value ?? expectedSilver,
    currency: 'PKR',
    live: Boolean(scraped.silver),
    source: scraped.silver ? srcLabel(scraped.silver) : 'international spot, converted (local sites unreachable)',
  });

  if (copperLb != null && pkr) {
    data.push({
      id: 'copper', name: 'Copper', unit: 'per pound',
      price: Math.round(copperLb * pkr), currency: 'PKR',
      live: true, source: 'LME spot (converted)',
    });
  }
  for (const { _raw, ...o } of oil) data.push(o);

  const usable = data.filter(d => d.price != null);
  if (!usable.length) {
    return res.status(502).json({ success: false, message: 'Could not fetch commodity prices' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({
    success: true,
    data: usable,
    source: 'Pakistani sarafa rate sites (median) / ICE & NYMEX futures via CNBC, Yahoo, Stooq (consensus) / ExchangeRate API',
    ...(debug
      ? {
          debug: {
            usdPkr: pkr,
            spotGoldUsdPerOz: goldOz,
            spotSilverUsdPerOz: silverOz,
            expectedGoldTolaFromSpot: expectedGold,
            expectedSilverTolaFromSpot: expectedSilver,
            acceptWindow: expectedGold
              ? { min: Math.round(expectedGold * 0.8), max: Math.round(expectedGold * 1.9) }
              : null,
            goldReadings: scraped.readings,
            oil: oil.map(o => ({ id: o.id, ...o._raw })),
          },
        }
      : {}),
  });
};

module.exports.oilQuote = oilQuote;
