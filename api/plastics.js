// Pakistani plastic raw material (dana) rates — PKR per lb/bag.
//
// Layers, most-live first:
//  1. International reference: SunSirs China PP spot price (published daily,
//     RMB/ton) converted to PKR live — the benchmark most imported dana
//     tracks. Attempted on every request.
//  2. FX runtime adjustment: local list rates move with USD/PKR against the
//     baseline captured when the rates were published (importers reprice on
//     the dollar intraday). Requires baselineUsdPkr, stamped automatically
//     by each admin publish.
//  3. Base list: data/plastics.json — updated daily from the Ahmed
//     Enterprises photo via /admin.html (OCR).
const fs = require('fs');
const path = require('path');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchWith(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFx() {
  const res = await fetchWith('https://open.er-api.com/v6/latest/USD');
  if (!res.ok) throw new Error(`fx: ${res.status}`);
  const json = await res.json();
  const pkr = json?.rates?.PKR;
  const cny = json?.rates?.CNY;
  if (!pkr || !cny) throw new Error('fx rates missing');
  return { usdPkr: pkr, pkrPerCny: pkr / cny };
}

// SunSirs publishes a daily China PP spot benchmark (RMB/ton)
const SUNSIRS_URLS = [
  'https://www.sunsirs.com/uk/prodetail-718.html',
  'https://www.sunsirs.com/m/page/commodity-price-detail/commodity-price-detail-718.html',
];

async function fetchSunSirsPP() {
  for (const url of SUNSIRS_URLS) {
    try {
      const res = await fetchWith(url);
      if (!res.ok) continue;
      const html = await res.text();
      // benchmark prices are 4-5 digit RMB/ton figures like 9,900.00 / 9900.00
      const m = html.match(/(\d{1,2},?\d{3}\.\d{2})/);
      if (!m) continue;
      const rmbTon = parseFloat(m[1].replace(/,/g, ''));
      if (!(rmbTon > 5000 && rmbTon < 20000)) continue;
      const chg = html.match(/([+-]\d+\.\d+)\s*%/);
      return { rmbTon, changePct: chg ? parseFloat(chg[1]) : null, url };
    } catch {}
  }
  throw new Error('SunSirs unreachable');
}

module.exports = async function handler(req, res) {
  let json;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'plastics.json'), 'utf-8');
    json = JSON.parse(raw);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: 'Plastic rates are temporarily unavailable' });
  }

  const [fxR, ppR] = await Promise.allSettled([fetchFx(), fetchSunSirsPP()]);
  const fx = fxR.status === 'fulfilled' ? fxR.value : null;
  const pp = ppR.status === 'fulfilled' ? ppR.value : null;

  // international live reference tiles
  const intl = [];
  if (pp && fx) {
    const pkrKg = (pp.rmbTon / 1000) * fx.pkrPerCny;
    intl.push({
      name: 'PP — China spot (SunSirs, daily)',
      pkrKg: Math.round(pkrKg),
      pkrLb: Math.round(pkrKg / 2.20462),
      rmbTon: pp.rmbTon,
      changePct: pp.changePct,
    });
  }

  // FX runtime adjustment of local list rates
  const baseline = json.baselineUsdPkr ?? null;
  let fxAdjustPct = null;
  if (fx && baseline) {
    fxAdjustPct = ((fx.usdPkr / baseline) - 1) * 100;
    for (const sec of json.sections) {
      for (const item of sec.items) {
        if (item.rate != null) {
          item.liveRate = Math.round(item.rate * (fx.usdPkr / baseline) * 10) / 10;
        }
      }
    }
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({
    success: true,
    data: {
      updated: json.updated,
      indicative: true,
      sections: json.sections,
      intl,
      fx: fx ? { usdPkr: fx.usdPkr, baselineUsdPkr: baseline, fxAdjustPct } : null,
      source: json.source || 'data/plastics.json',
    },
    source: json.source || 'plastics',
  });
};
