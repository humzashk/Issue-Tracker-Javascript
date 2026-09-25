// Pakistani market commodity rates.
//
// Gold & silver come from gold.pk (the Karachi Sarafa / local market rate),
// NOT from international spot converted to PKR — local rates carry duty and
// a market premium, so a spot conversion reads several thousand rupees low.
// Spot is still fetched, but only as a plausibility yardstick for validating
// what was scraped, and as a clearly-labelled fallback if gold.pk is down.
//
// Crude oil comes straight from the exchange benchmarks — the prices news
// wires quote: ICE Brent and NYMEX WTI front-month futures, read from Yahoo
// Finance's market-data feed (quoted within minutes of the exchange). Each
// is cross-checked against a second, independent feed (Stooq): within 1.5%
// the card says "verified"; if the two disagree more than that, the card
// says so instead of silently picking one. Change is measured against the
// exchange's previous settlement, not estimated in the browser.
//
// Add ?debug=1 to any request to see the raw figures from each source.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const TROY_OZ_PER_TOLA = 0.375; // 1 tola = 11.6638 g = exactly 0.375 troy oz

const GOLD_PK_URLS = [
  'https://www.gold.pk/',
  'https://gold.pk/',
  'https://www.gold.pk/gold-rate-in-pakistan.html',
  'https://www.gold.pk/karachi-gold-rates.html',
];

const OIL = [
  { id: 'oil-brent', name: 'Crude Oil (Brent)', yahoo: 'BZ=F', stooq: 'cb.f', market: 'ICE Brent futures' },
  { id: 'oil-wti', name: 'Crude Oil (WTI)', yahoo: 'CL=F', stooq: 'cl.f', market: 'NYMEX WTI futures' },
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
function plausible(value, expected) {
  if (value == null) return false;
  if (!expected) return value > 0;
  return value >= expected * 0.80 && value <= expected * 1.90;
}

function findRate(rows, metal, expected) {
  for (const [name, fn] of [['column', findByColumn], ['row', findByRow]]) {
    const hit = fn(rows, metal);
    if (hit && plausible(hit.value, expected)) return { ...hit, strategy: name };
  }
  return null;
}

async function scrapeGoldPk(expectedGold, expectedSilver) {
  const tried = [];
  for (const url of GOLD_PK_URLS) {
    try {
      const res = await fetchWith(url);
      const rows = htmlToRows(await res.text());
      const gold = findRate(rows, 'gold', expectedGold);
      const silver = findRate(rows, 'silver', expectedSilver);
      tried.push({
        url,
        ok: true,
        rowCount: rows.length,
        gold: gold ? { value: gold.value, via: gold.how, context: gold.context } : null,
        silver: silver ? { value: silver.value, via: silver.how, context: silver.context } : null,
      });
      if (gold) return { gold, silver, url, tried };
    } catch (e) {
      tried.push({ url, ok: false, error: String(e.message).slice(0, 60) });
    }
  }
  return { gold: null, silver: null, url: null, tried };
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

async function oilQuote(o) {
  const [y, s] = await Promise.allSettled([yahooQuote(o.yahoo), stooqQuote(o.stooq)]);
  const yq = y.status === 'fulfilled' ? y.value : null;
  const sq = s.status === 'fulfilled' ? s.value : null;
  if (!yq && !sq) throw new Error(`${o.name}: no source available`);

  const primary = yq ?? sq;
  const diff = yq && sq ? Math.abs(yq.price - sq.price) / yq.price : null;
  const verified = diff != null && diff <= 0.015;
  const change = yq?.prevClose ? yq.price - yq.prevClose : null;

  return {
    id: o.id,
    name: o.name,
    unit: 'per barrel',
    price: primary.price,
    currency: 'USD',
    live: true,
    change,
    changePct: change != null ? (change / yq.prevClose) * 100 : null,
    asOf: yq?.asOf ?? null,
    source: `${o.market}${verified ? ' · verified 2 sources' : diff != null ? ' · sources differ, check' : ''}`,
    _raw: { yahoo: yq?.price ?? String(y.reason?.message), stooq: sq?.price ?? String(s.reason?.message), diffPct: diff != null ? +(diff * 100).toFixed(2) : null },
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

  let scraped = { gold: null, silver: null, url: null, tried: [] };
  try {
    scraped = await scrapeGoldPk(expectedGold, expectedSilver);
  } catch (e) {
    console.error('gold.pk scrape failed:', e.message);
  }

  const data = [];

  data.push({
    id: 'gold',
    name: 'Gold (24k)',
    unit: 'per tola',
    price: scraped.gold?.value ?? expectedGold,
    currency: 'PKR',
    live: Boolean(scraped.gold),
    source: scraped.gold ? 'gold.pk — local market' : 'international spot (converted)',
  });

  data.push({
    id: 'silver',
    name: 'Silver',
    unit: 'per tola',
    price: scraped.silver?.value ?? expectedSilver,
    currency: 'PKR',
    live: Boolean(scraped.silver),
    source: scraped.silver ? 'gold.pk — local market' : 'international spot (converted)',
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

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
  res.json({
    success: true,
    data: usable,
    goldSource: scraped.gold ? `gold.pk (${scraped.url})` : 'international spot fallback',
    source: 'gold.pk / ICE & NYMEX futures via Yahoo Finance + Stooq / ExchangeRate API',
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
            attempts: scraped.tried,
            oil: oil.map(o => ({ id: o.id, ...o._raw })),
          },
        }
      : {}),
  });
};

module.exports.oilQuote = oilQuote;
