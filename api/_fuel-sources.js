// Today's notified petrol & diesel prices (PKR/litre).
//
// Two independent sources, each read with a parser written for its exact
// page layout:
//   PSO       — Pakistan State Oil's own price table (Premier = petrol,
//               Hi-Cetane Diesel = HSD), the official retail price.
//   BaKhabar  — publishes the notified prices with their effective date.
// When both answer they must agree (within 0.5%); if they disagree PSO, the
// official one, wins and the result is flagged. Sites that stopped updating
// (pakfuel.today stuck in March, petrolrate.pk in June) were removed — a
// stale source must never be able to supply today's price.
const SANE = v => Number.isFinite(v) && v > 150 && v < 700;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const num = s => (s == null ? NaN : parseFloat(String(s).replace(/,/g, '')));

const SOURCES = [
  {
    name: 'PSO (official)',
    url: 'https://psopk.com/en/fuels/fuel-prices',
    parse(html) {
      const body = html.replace(/<!--[\s\S]*?-->/g, ''); // PSO keeps retired rows commented out
      const row = re => num(body.match(re)?.[1]);
      return {
        petrol: row(/<td>\s*PREMIER[^<]*<\/td>\s*<td>\s*Rs\.?\s*([\d,.]+)\s*\/\s*Ltr/i),
        diesel: row(/<td>\s*HI-?CETANE DIESEL[^<]*<\/td>\s*<td>\s*Rs\.?\s*([\d,.]+)\s*\/\s*Ltr/i),
      };
    },
  },
  {
    name: 'BaKhabar',
    url: 'https://www.bakhabarpakistan.com/data/fuel-prices/',
    parse(html) {
      const card = label => num(html.match(new RegExp(
        `fp-price-label">\\s*${label}\\s*</span>\\s*<span class="fp-price-value">\\s*Rs\\.?\\s*([\\d,.]+)`, 'i'))?.[1]);
      const eff = html.match(/<span>\s*Effective\s*<\/span>\s*<strong>([^<]+)<\/strong>/i)?.[1]?.trim() ?? null;
      return { petrol: card('Petrol'), diesel: card('Diesel'), effective: eff };
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
      ...(out.effective ? { effective: out.effective } : {}),
    };
  } catch (e) {
    return { name: src.name, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// → { petrol, diesel, source, agree, results }
async function getLiveFuel() {
  const results = await Promise.all(SOURCES.map(s => fetchSource(s)));
  const pick = fuel => {
    const got = results.filter(r => r[fuel] != null);
    if (!got.length) return { value: null, from: [] };
    const [first] = got; // SOURCES order = priority (PSO first)
    const agreeing = got.filter(r => Math.abs(r[fuel] - first[fuel]) / first[fuel] <= 0.005);
    return { value: first[fuel], from: agreeing.map(r => r.name), disagree: agreeing.length < got.length };
  };
  const petrol = pick('petrol');
  const diesel = pick('diesel');
  const names = [...new Set([...petrol.from, ...diesel.from])];
  return {
    petrol: petrol.value,
    diesel: diesel.value,
    source: names.join(' + ') || null,
    agree: names.length >= 2 && !petrol.disagree && !diesel.disagree,
    results,
  };
}

module.exports = { getLiveFuel, SOURCES };
