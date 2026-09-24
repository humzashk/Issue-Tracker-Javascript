// PSX KSE-100 index — keyless.
//
// Primary: the Pakistan Stock Exchange's own data portal (dps.psx.com.pk).
//   /timeseries/eod/KSE100 → {"status":1,"data":[[epoch, close, volume, open], …]}
//   /timeseries/int/KSE100 → intraday ticks, [[epoch, price, volume], …]
//   Both newest-first; sorted defensively here anyway.
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
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
  const headers = { Referer: 'https://dps.psx.com.pk/' };
  const [eodR, intR] = await Promise.allSettled([
    getJSON('https://dps.psx.com.pk/timeseries/eod/KSE100', headers),
    getJSON('https://dps.psx.com.pk/timeseries/int/KSE100', headers),
  ]);
  const eod = eodR.status === 'fulfilled' ? rows(eodR.value, 1) : [];
  const intra = intR.status === 'fulfilled' ? rows(intR.value, 1) : [];
  if (!eod.length && !intra.length) throw new Error('PSX: no usable rows');

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
