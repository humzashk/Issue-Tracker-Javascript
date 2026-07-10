// Diagnostic: shows which external rate sources are reachable from Vercel's
// servers and what values each yields. Open /api/probe in a browser after
// deploying — no guessing about scrapability.
const { SOURCES, fetchSource } = require('./_fuel-sources.js');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const EXTRA = [
  { name: 'SunSirs PP (uk)', url: 'https://www.sunsirs.com/uk/prodetail-718.html', re: /(\d{1,2},?\d{3}\.\d{2})/ },
  { name: 'SunSirs PP (mobile)', url: 'https://www.sunsirs.com/m/page/commodity-price-detail/commodity-price-detail-718.html', re: /(\d{1,2},?\d{3}\.\d{2})/ },
  { name: 'Zaraye dana rates', url: 'https://www.zaraye.co/plastic-dana-rate-today', re: /(?:Rs\.?|PKR)\s*([\d,]{2,6})/i },
];

async function probeExtra(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { source: src.name, httpStatus: res.status, sample: null };
    const html = await res.text();
    const m = html.match(src.re);
    return { source: src.name, httpStatus: res.status, sample: m ? m[1] : null, bytes: html.length };
  } catch (e) {
    return { source: src.name, httpStatus: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  const [fuel, extra] = await Promise.all([
    Promise.all(SOURCES.map(s => fetchSource(s, 8000))),
    Promise.all(EXTRA.map(probeExtra)),
  ]);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    checkedAt: new Date().toISOString(),
    fuelSources: fuel.map(r => ({
      source: r.name,
      httpStatus: r.status,
      petrol: r.petrol ?? null,
      diesel: r.diesel ?? null,
      error: r.error ?? null,
    })),
    plasticSources: extra,
    verdict: {
      fuel:
        fuel.find(r => r.petrol && r.diesel)?.name
          ? `Live fuel via: ${fuel.find(r => r.petrol && r.diesel).name}`
          : 'No fuel source reachable — reference rates shown',
      plastics:
        extra.find(r => r.sample)?.source
          ? `Live polymer reference via: ${extra.find(r => r.sample).source}`
          : 'No polymer source reachable — FX adjustment + daily photo remain the live layers',
    },
  });
};
