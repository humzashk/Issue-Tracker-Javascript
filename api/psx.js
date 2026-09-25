// PSX KSE-100 index — keyless.
//
// Primary: the Pakistan Stock Exchange's own data portal (dps.psx.com.pk).
//   /timeseries/eod/KSE100 → {"status":1,"data":[[epoch, close, volume, open], …]}
//   /timeseries/int/KSE100 → intraday ticks, [[epoch, price, volume], …]
//   Both newest-first; sorted defensively here anyway.
//   Since 24 Sep 2026 every data endpoint returns 403 unless the request
//   carries an X-Req-Id header. The token is embedded in the portal's HTML
//   (<script>window.__ps = {…,"_k":"<token>",…}</script>) and rotates about
//   every 5 minutes; no cookies are involved. It's cached per warm function
//   instance and refreshed once on a 403.
// Fallback: Yahoo Finance ^KSE.
//
// "Live" is decided from the data, not the clock: the latest intraday tick
// has to be under 20 minutes old. Otherwise the card says the market is
// closed and shows the last close, rather than pretending a stale number is
// live. Add ?debug=1 to see which source answered.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TZ = 'Asia/Karachi';
const SANE = v => Number.isFinite(v) && v > 5000 && v < 2000000;

async function getJSON(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── PSX request token ────────────────────────────────────────────────────
const PSX = 'https://dps.psx.com.pk';
const TOKEN_TTL = 4 * 60 * 1000; // rotates ~5 min; refresh a little early
let psxToken = null;
let psxTokenAt = 0;

function extractToken(html) {
  const m = String(html).match(/"_k"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

// Concurrent callers (the eod + intraday requests) share one page fetch
let tokenInFlight = null;
function freshToken() {
  tokenInFlight ??= fetchToken().finally(() => { tokenInFlight = null; });
  return tokenInFlight;
}

async function fetchToken() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${PSX}/`, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`PSX page HTTP ${res.status}`);
    const token = extractToken(await res.text());
    if (!token) throw new Error('PSX token not found in page');
    psxToken = token;
    psxTokenAt = Date.now();
    return token;
  } finally {
    clearTimeout(timer);
  }
}

async function psxToken_() {
  return psxToken && Date.now() - psxTokenAt < TOKEN_TTL ? psxToken : freshToken();
}

// GET a PSX data endpoint with the token; on 403 get a new token and retry once
async function psxGet(path) {
  const headers = (token) => ({
    Referer: `${PSX}/`,
    'X-Req-Id': token,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': 'en-US,en;q=0.9',
  });
  try {
    return await getJSON(PSX + path, headers(await psxToken_()));
  } catch (e) {
    if (e.status !== 403) throw e;
    return getJSON(PSX + path, headers(await freshToken()));
  }
}

const toMs = ts => (ts < 1e12 ? ts * 1000 : ts);
const karachiDay = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });

function rows(json, priceIdx) {
  return (json?.data ?? [])
    .filter(r => Array.isArray(r) && Number.isFinite(+r[0]) && SANE(+r[priceIdx]))
    .map(r => ({ t: toMs(+r[0]), v: +r[priceIdx] }))
    .sort((a, b) => a.t - b.t);
}

async function fromPsx() {
  await psxToken_(); // one token fetch shared by both requests below
  const [eodR, intR] = await Promise.allSettled([
    psxGet('/timeseries/eod/KSE100'),
    psxGet('/timeseries/int/KSE100'),
  ]);
  const eod = eodR.status === 'fulfilled' ? rows(eodR.value, 1) : [];
  const intra = intR.status === 'fulfilled' ? rows(intR.value, 1) : [];
  if (!eod.length && !intra.length) {
    const why = [eodR, intR].map(r => r.reason?.message).filter(Boolean).join('; ');
    throw new Error(`PSX: no usable rows${why ? ` (${why})` : ''}`);
  }

  const lastTick = intra[intra.length - 1] ?? null;
  const lastEod = eod[eod.length - 1] ?? null;

  let value, asOf, prevClose, day;
  if (lastTick && (!lastEod || karachiDay(lastTick.t) >= karachiDay(lastEod.t))) {
    value = lastTick.v;
    asOf = lastTick.t;
    day = karachiDay(lastTick.t);
    prevClose = [...eod].reverse().find(r => karachiDay(r.t) < day)?.v ?? null;
  } else {
    value = lastEod.v;
    asOf = lastEod.t;
    day = karachiDay(lastEod.t);
    prevClose = eod.length > 1 ? eod[eod.length - 2].v : null;
  }

  const todays = intra.filter(r => karachiDay(r.t) === day).map(r => r.v);
  const series = eod.slice(-30).map(r => r.v);
  if (day !== karachiDay(lastEod?.t ?? 0)) series.push(value);

  return {
    value,
    prevClose,
    high: todays.length ? Math.max(...todays) : null,
    low: todays.length ? Math.min(...todays) : null,
    series,
    asOf,
    live: Boolean(lastTick) && Date.now() - lastTick.t < 20 * 60 * 1000,
    source: 'PSX Data Portal',
  };
}

async function fromYahoo() {
  const j = await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/%5EKSE?range=1mo&interval=1d');
  const r = j?.chart?.result?.[0];
  const meta = r?.meta;
  const value = meta?.regularMarketPrice;
  if (!SANE(value)) throw new Error('Yahoo: no usable price');
  const series = (r?.indicators?.quote?.[0]?.close ?? []).filter(SANE);
  return {
    value,
    prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    high: meta.regularMarketDayHigh ?? null,
    low: meta.regularMarketDayLow ?? null,
    series,
    asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    live: false,
    source: 'Yahoo Finance (may be delayed)',
  };
}

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  const attempts = [];
  let data = null;
  for (const [name, fn] of [['psx', fromPsx], ['yahoo', fromYahoo]]) {
    try {
      data = await fn();
      break;
    } catch (e) {
      attempts.push({ source: name, error: String(e.message).slice(0, 80) });
    }
  }

  if (!data) {
    return res.status(502).json({
      success: false,
      message: 'KSE-100 data is temporarily unavailable',
      ...(debug ? { attempts } : {}),
    });
  }

  const change = data.prevClose ? data.value - data.prevClose : null;
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.json({
    success: true,
    data: {
      ...data,
      change,
      changePct: change != null ? (change / data.prevClose) * 100 : null,
    },
    ...(debug ? { attempts } : {}),
  });
};

module.exports.extractToken = extractToken;
