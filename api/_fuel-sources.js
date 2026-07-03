// Shared multi-source fuel price scraper.
// Tries each source in order; first one that yields sane values wins.
// Sanity window keeps a bad regex match from publishing a wrong price.
const SANE = v => Number.isFinite(v) && v > 150 && v < 600;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SOURCES = [
  {
    name: 'OGRA (official)',
    url: 'https://www.ogra.org.pk/notified-petroleum-prices',
    petrol: /(?:premier|motor\s*gasoline|petrol|mogas|pmg)[^]{0,300}?([\d,]{3,6}\.?\d{0,2})/i,
    diesel: /(?:high\s*speed\s*diesel|hsd|diesel)[^]{0,300}?([\d,]{3,6}\.?\d{0,2})/i,
  },
  {
    name: 'pakfuel.today',
    url: 'https://pakfuel.today/',
    petrol: /petrol[^]{0,200}?(?:Rs\.?|PKR)?\s*([\d,]{3,6}\.?\d{0,2})/i,
    diesel: /(?:high\s*speed\s*)?diesel[^]{0,200}?(?:Rs\.?|PKR)?\s*([\d,]{3,6}\.?\d{0,2})/i,
  },
  {
    name: 'petrolrate.pk',
    url: 'https://petrolrate.pk/',
    petrol: /petrol[^]{0,200}?(?:Rs\.?|PKR)?\s*([\d,]{3,6}\.?\d{0,2})/i,
    diesel: /(?:high\s*speed\s*)?diesel[^]{0,200}?(?:Rs\.?|PKR)?\s*([\d,]{3,6}\.?\d{0,2})/i,
  },
  {
    name: 'hamariweb',
    url: 'https://hamariweb.com/finance/petroleum_prices/',
    petrol: /petrol[^]{0,250}?([\d,]{3,6}\.?\d{0,2})/i,
    diesel: /(?:high\s*speed\s*)?diesel[^]{0,250}?([\d,]{3,6}\.?\d{0,2})/i,
  },
  {
    name: 'PSO (official)',
    url: 'https://psopk.com/en/fuels/fuel-prices',
    petrol: /(?:premier|pmg|petrol)[^]{0,300}?([\d,]{3,6}\.?\d{0,2})/i,
    diesel: /(?:hsd|diesel)[^]{0,300}?([\d,]{3,6}\.?\d{0,2})/i,
  },
];

async function fetchSource(src, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
  try {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { name: src.name, status: res.status, error: `HTTP ${res.status}` };
    const html = await res.text();

    const parse = re => {
      const m = html.match(re);
      if (!m) return null;
      const v = parseFloat(m[1].replace(/,/g, ''));
      return SANE(v) ? v : null;
    };

    return {
      name: src.name,
      status: res.status,
      petrol: parse(src.petrol),
      diesel: parse(src.diesel),
      bytes: html.length,
    };
  } catch (e) {
    return { name: src.name, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Returns { petrol, diesel, source } from the first source with both values,
// falling back to the first with at least one value.
async function getLiveFuel() {
  const results = await Promise.all(SOURCES.map(s => fetchSource(s)));
  const full = results.find(r => r.petrol && r.diesel);
  if (full) return { petrol: full.petrol, diesel: full.diesel, source: full.name, results };
  const partial = results.find(r => r.petrol || r.diesel);
  if (partial) return { petrol: partial.petrol ?? null, diesel: partial.diesel ?? null, source: partial.name, results };
  return { petrol: null, diesel: null, source: null, results };
}

module.exports = { SOURCES, fetchSource, getLiveFuel };
