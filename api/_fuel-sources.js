// Today's notified petrol & diesel prices (PKR/litre).
//
// Prices are now revised almost daily, and sites update at different speeds
// (on 7 Nov PSO's own page still showed the 6 Nov price). So each source
// reports the price AND the date it took effect, and the newest effective
// date that has started wins; within that date, the value most sources agree
// on. PSO's page carries no date, so it only counts when no dated source
// answers. Every source is read with a parser for its exact page layout.
//
// Sites that stopped updating (pakfuel.today stuck in March, petrolrate.pk in
// June) are not used: a stale source must never supply today's price.
const SANE = v => Number.isFinite(v) && v > 150 && v < 700;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const num = s => (s == null ? NaN : parseFloat(String(s).replace(/,/g, '')));
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => (y && m && d ? `${y}-${pad(m)}-${pad(d)}` : null);
// "Nov 7, 2026" | "7 Nov 2026" | "07 November 2026" → "2026-11-07"
function textDate(s) {
  if (!s) return null;
  let m = String(s).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)/);
  if (m) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(20\d\d)/);
  if (m) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

const SOURCES = [
  {
    name: 'BaKhabar',
    url: 'https://www.bakhabarpakistan.com/data/fuel-prices/',
    parse(html) {
      const card = label => num(html.match(new RegExp(
        `fp-price-label">\\s*${label}\\s*</span>\\s*<span class="fp-price-value">\\s*Rs\\.?\\s*([\\d,.]+)`, 'i'))?.[1]);
      const eff = html.match(/<span>\s*Effective\s*<\/span>\s*<strong>([^<]+)<\/strong>/i)?.[1];
      return { petrol: card('Petrol'), diesel: card('Diesel'), effective: textDate(eff) };
    },
  },
  {
    name: 'OilPrices.pk',
    url: 'https://oilprices.pk/',
    parse(html) {
      // <meta name="description" content="… petrol PKR 346.00/L, diesel PKR 378.00/L (7 Nov 2026). …">
      const m = html.match(/petrol PKR ([\d,.]+)\/L, diesel PKR ([\d,.]+)\/L \(([^)]+)\)/i);
      return { petrol: num(m?.[1]), diesel: num(m?.[2]), effective: textDate(m?.[3]) };
    },
  },
  {
    name: 'Vital Petroleum',
    url: 'https://vitalpetroleum.com.pk/price-history',
    parse(html) {
      // "Super Rs 346.00, diesel Rs 378.00 per litre (from 07-11-2026)"
      const m = html.match(/Super Rs\.?\s*([\d,.]+), diesel Rs\.?\s*([\d,.]+) per litre \(from (\d{2})-(\d{2})-(20\d\d)\)/i);
      return { petrol: num(m?.[1]), diesel: num(m?.[2]), effective: m ? ymd(+m[5], +m[4], +m[3]) : null };
    },
  },
  {
    name: 'Mashriq TV',
    url: 'https://mashriqtv.pk/en/petrol-price-in-pakistan-today/',
    parse(html) {
      // "Effective 07 November 2026: Petrol PKR 346.00, High Speed Diesel PKR 378.00, …"
      const m = html.match(/Effective (\d{1,2} [A-Za-z]+ 20\d\d): Petrol PKR ([\d,.]+), High Speed Diesel PKR ([\d,.]+)/i);
      return { petrol: num(m?.[2]), diesel: num(m?.[3]), effective: textDate(m?.[1]) };
    },
  },
  {
    name: 'PSO (official)',
    url: 'https://psopk.com/en/fuels/fuel-prices',
    parse(html) {
      const body = html.replace(/<!--[\s\S]*?-->/g, ''); // PSO keeps retired rows commented out
      const row = re => num(body.match(re)?.[1]);
      return {
        petrol: row(/<td>\s*PREMIER[^<]*<\/td>\s*<td>\s*Rs\.?\s*([\d,.]+)\s*\/\s*Ltr/i),
        diesel: row(/<td>\s*HI-?CETANE DIESEL[^<]*<\/td>\s*<td>\s*Rs\.?\s*([\d,.]+)\s*\/\s*Ltr/i),
        effective: null, // the page doesn't say
      };
    },
  },
];

async function fetchSource(src, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { name: src.name, status: res.status, error: `HTTP ${res.status}` };
    const out = src.parse(await res.text());
    return {
      name: src.name,
      status: res.status,
      petrol: SANE(out.petrol) ? out.petrol : null,
      diesel: SANE(out.diesel) ? out.diesel : null,
      effective: out.effective ?? null,
    };
  } catch (e) {
    return { name: src.name, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Pick one fuel's price from the source results (exported for tests).
// → { value, effective, from: [names], of: n } or null
function choose(results, fuel, today) {
  const got = results.filter(r => r[fuel] != null);
  if (!got.length) return null;
  // newest effective date that has started (a notification announced tonight
  // for tomorrow must not replace today's price)
  const dated = got.filter(r => r.effective && r.effective <= today);
  const newest = dated.length ? dated.map(r => r.effective).sort().at(-1) : null;
  const pool = newest ? dated.filter(r => r.effective === newest) : got;
  // the value most of that pool agrees on (within 0.5%); ties → source order
  let best = null;
  for (const r of pool) {
    const agree = pool.filter(o => Math.abs(o[fuel] - r[fuel]) / r[fuel] <= 0.005);
    if (!best || agree.length > best.agree.length) best = { r, agree };
  }
  return { value: best.r[fuel], effective: newest, from: best.agree.map(o => o.name), of: pool.length };
}

// → { petrol, diesel, effective, source, agree, results }
async function getLiveFuel(today) {
  const day = today ?? new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  const results = await Promise.all(SOURCES.map(s => fetchSource(s)));
  const petrol = choose(results, 'petrol', day);
  const diesel = choose(results, 'diesel', day);
  const names = [...new Set([...(petrol?.from ?? []), ...(diesel?.from ?? [])])];
  return {
    petrol: petrol?.value ?? null,
    diesel: diesel?.value ?? null,
    effective: petrol?.effective ?? diesel?.effective ?? null,
    source: names.join(' + ') || null,
    agree: Math.min(petrol?.from.length ?? 0, diesel?.from.length ?? 0) >= 2,
    results,
  };
}

module.exports = { getLiveFuel, choose, SOURCES, textDate };
