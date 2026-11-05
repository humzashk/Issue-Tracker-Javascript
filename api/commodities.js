// Pakistani market commodity rates.
//
// Every price here comes from several independent sources and the card
// shows the consensus, so one stale or mis-read source can't decide it.
//
// Gold & silver (PKR per tola), in order of preference:
//   1. The official daily rate of the All-Pakistan Gems & Jewellers Sarafa
//      Association (APGJSA) — the figure newspapers quote — read from
//      Business Recorder's market feeds, which carry the association's rate
//      story every trading day (the feeds keep about three days).
//   2. If no association rate from the last 3 days: dealer boards — gold.pk
//      (Karachi) and pakgold.net (Rawalpindi/Islamabad) — median.
//   3. Last resort: international spot converted to PKR, labelled as such.
// Every local figure must sit in a plausible band around converted spot,
// so a mis-read number can never reach the card.
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

const BR_FEEDS = [
  'https://www.brecorder.com/feeds/markets/commodities',
  'https://www.brecorder.com/feeds/markets',
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

// ── Gold & silver ────────────────────────────────────────────────────────────

const DAY = 86400000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const karachiYmd = ms => new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 10);
const amount = s => parseInt(String(s).replace(/,/g, ''), 10);

const decodeXml = s => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&');
const plainText = html => decodeXml(html)
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// One Business Recorder item → { date, gold, silver } if it is an association
// rate story. These read like:
//   "…gold price per tola reached Rs435,636 after a gain of Rs9,600 during the day."
//   "They soared by Rs13,900 to settle at Rs426,036 per tola with … per 10 grams"
//   "…gold price per tola saw no change at Rs412,136 during the day."
//   "…the price of silver increased by Rs100 to reach Rs5,763 per tola."
// and also recap the previous day ("On Wednesday, the gold price per tola
// reached Rs426,036…") — those sentences are skipped.
function parseAssociationItem({ description, pubDate, link }) {
  const text = plainText(description);
  if (!/sarafa|jewellers association|APGJSA/i.test(text)) return null;
  const pub = Date.parse(pubDate);
  if (!Number.isFinite(pub)) return null;

  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter(x => !/^On (Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day\b/i.test(x));

  let gold = null, silver = null, weekday = null;
  for (const x of sentences) {
    if (weekday == null) {
      const w = x.toLowerCase().match(/\bon (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (w) weekday = WEEKDAYS.indexOf(w[1]);
    }
    if (gold == null && /per tola/i.test(x) && !/silver/i.test(x)) {
      const vals = [...x.matchAll(/Rs\.?\s?([\d,]{5,})/g)].map(m => amount(m[1])).filter(v => v >= 50000);
      if (vals.length) gold = Math.max(...vals); // the rate, not the day's change
    }
    if (silver == null && /silver/i.test(x)) {
      const m = x.match(/Rs\.?\s?([\d,]+)\s*per tola/i);
      if (m) silver = amount(m[1]);
    }
  }
  if (gold == null && silver == null) return null;

  // the story is dated by the weekday it names ("…increased on Thursday"),
  // counted back from when it was published
  let date = karachiYmd(pub);
  if (weekday != null) {
    const pubDow = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
    date = karachiYmd(pub - ((pubDow - weekday + 7) % 7) * DAY);
  }
  return { date, gold, silver, link: link || null };
}

async function getAssociationRates() {
  const feeds = await Promise.allSettled(BR_FEEDS.map(async u => (await fetchWith(u, 7000, 'application/rss+xml')).text()));
  const byDate = new Map();
  for (const f of feeds) {
    if (f.status !== 'fulfilled') continue;
    for (const [, item] of f.value.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
      const tag = t => item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? '';
      const r = parseAssociationItem({ description: tag('description'), pubDate: tag('pubDate'), link: tag('link').trim() });
      if (!r) continue;
      const prev = byDate.get(r.date);
      byDate.set(r.date, { date: r.date, gold: prev?.gold ?? r.gold, silver: prev?.silver ?? r.silver, link: prev?.link ?? r.link });
    }
  }
  return {
    rates: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
    errors: feeds.filter(f => f.status === 'rejected').map(f => String(f.reason?.message)),
  };
}

// Dealer boards, each read with a parser for its exact layout
const DEALERS = [
  {
    name: 'gold.pk',
    url: 'https://gold.pk/gold-rates-pakistan.php',
    parse: html => ({
      gold: amount(html.match(/goldratehome'?"?>\s*Rs\.?\s*([\d,]+)(?:\.\d+)?\s*<\/p>\s*<p>\s*24 Karat Gold Rate\s*<b>\s*\(1 Tola\)/i)?.[1]),
      silver: NaN,
    }),
  },
  {
    name: 'pakgold.net',
    url: 'https://www.pakgold.net/',
    parse: html => ({
      gold: amount(html.match(/id="vRawaSell">\s*([\d,]+)/)?.[1]),
      silver: amount(html.match(/id="vSilverLocalSell">\s*([\d,]+)/)?.[1]),
    }),
  },
];

async function readDealers() {
  return Promise.all(DEALERS.map(async d => {
    try {
      const out = d.parse(await (await fetchWith(d.url)).text());
      return {
        source: d.name,
        gold: Number.isFinite(out.gold) ? out.gold : null,
        silver: Number.isFinite(out.silver) ? out.silver : null,
      };
    } catch (e) {
      return { source: d.name, gold: null, silver: null, error: String(e.message).slice(0, 60) };
    }
  }));
}

// A local rate sits close to converted spot (duty + market premium): never
// far below, never wildly above. Silver's local premium varies more.
const BANDS = { gold: [0.93, 1.12], silver: [0.85, 1.4] };
function plausible(value, expected, metal) {
  if (!Number.isFinite(value) || value <= 0) return false;
  if (!expected) return true;
  const [lo, hi] = BANDS[metal];
  return value >= expected * lo && value <= expected * hi;
}

const fmtDay = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// → the card row for one metal, plus how it was decided
function metalRow(metal, { assoc, dealers, expected, today }) {
  const base = metal === 'gold'
    ? { id: 'gold', name: 'Gold (24k)', unit: 'per tola', currency: 'PKR' }
    : { id: 'silver', name: 'Silver', unit: 'per tola', currency: 'PKR' };

  // 1. association rate, newest day within the last 3
  const days = assoc.filter(r => plausible(r[metal], expected, metal));
  const latest = days[0];
  if (latest && (Date.parse(today) - Date.parse(latest.date)) / DAY <= 3) {
    const prev = days.find(r => r.date < latest.date);
    const change = prev ? latest[metal] - prev[metal] : null;
    return {
      ...base,
      price: latest[metal],
      live: true,
      basis: 'association',
      asOfDate: latest.date,
      ...(change != null ? { change, changePct: (change / prev[metal]) * 100, changeVs: prev.date } : {}),
      source: `Sarafa Association rate · ${fmtDay(latest.date)}`,
    };
  }

  // 2. dealer boards
  const got = dealers.filter(d => plausible(d[metal], expected, metal));
  if (got.length) {
    const c = consensus(got.map(d => d[metal]), 0.02);
    const agreeing = got.filter(d => Math.abs(d[metal] - c.value) / c.value <= 0.02).map(d => d.source);
    return {
      ...base,
      price: Math.round(c.value),
      live: true,
      basis: 'dealers',
      source: `sarafa dealers · ${agreeing.join(', ')}`,
    };
  }

  // 3. converted spot
  return { ...base, price: expected, live: false, basis: 'spot', source: 'international spot, converted (local rates unavailable)' };
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

  const today = karachiYmd(Date.now());
  const [assocR, dealersR] = await Promise.allSettled([getAssociationRates(), readDealers()]);
  const assoc = assocR.status === 'fulfilled' ? assocR.value : { rates: [], errors: [String(assocR.reason?.message)] };
  const dealers = dealersR.status === 'fulfilled' ? dealersR.value : [];
  const ctx = { assoc: assoc.rates, dealers, today };

  const data = [
    metalRow('gold', { ...ctx, expected: expectedGold }),
    metalRow('silver', { ...ctx, expected: expectedSilver }),
  ];

  if (copperLb != null && pkr) {
    data.push({
      id: 'copper', name: 'Copper', unit: 'per pound',
      price: Math.round(copperLb * pkr), currency: 'PKR',
      live: true, source: 'COMEX copper, converted',
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
    source: 'APGJSA sarafa rate via Business Recorder (fallback: gold.pk, pakgold.net) / ICE & NYMEX futures via CNBC, Yahoo, Stooq (consensus) / ExchangeRate API',
    ...(debug
      ? {
          debug: {
            usdPkr: pkr,
            spotGoldUsdPerOz: goldOz,
            spotSilverUsdPerOz: silverOz,
            expectedGoldTolaFromSpot: expectedGold,
            expectedSilverTolaFromSpot: expectedSilver,
            bands: BANDS,
            association: assoc,
            dealers,
            oil: oil.map(o => ({ id: o.id, ...o._raw })),
          },
        }
      : {}),
  });
};

module.exports.oilQuote = oilQuote;
module.exports.parseAssociationItem = parseAssociationItem;
module.exports.DEALERS = DEALERS;
module.exports.metalRow = metalRow;
