// Diagnostic: shows which external data sources are reachable from Vercel's
// servers and what values each yields. Open /api/probe in a browser after
// deploying — no guessing about scrapability.
const { SOURCES, fetchSource } = require('./_fuel-sources.js');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const EXTRA = [
  { name: 'Spotify Pakistan Daily (kworb)', url: 'https://kworb.net/spotify/country/pk_daily.html', re: /track\/[^"]*"[^>]*>([^<]{3,80})</i },
  { name: 'Spotify Global Daily (kworb)',   url: 'https://kworb.net/spotify/country/global_daily.html', re: /track\/[^"]*"[^>]*>([^<]{3,80})</i },
  { name: 'YouTube Pakistan Daily (kworb)', url: 'https://kworb.net/youtube/insights/pk_daily.html', re: /(?:track|video)\/[^"]*"[^>]*>([^<]{3,80})</i },
  { name: 'iTunes Pakistan RSS',            url: 'https://itunes.apple.com/pk/rss/topsongs/limit=5/json', re: /"im:name":\s*\{"label":"([^"]{2,60})"/i },
  { name: 'Apple Music PK most-played',     url: 'https://rss.applemarketingtools.com/api/v2/pk/music/most-played/5/songs.json', re: /"name":\s*"([^"]{2,60})"/i },
  { name: 'gold.pk (www)',                  url: 'https://www.gold.pk/', re: /([\d][\d,]{4,9})/ },
  { name: 'gold.pk (apex)',                 url: 'https://gold.pk/', re: /([\d][\d,]{4,9})/ },
  { name: 'oilprice.com',                   url: 'https://oilprice.com/', re: /brent[^]{0,60}?(\d{1,3}\.\d{1,2})/i },
  { name: 'Deezer chart',                   url: 'https://api.deezer.com/chart/0/tracks?limit=5', re: /"title":\s*"([^"]{2,60})"/i },
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
    chartSources: extra,
    verdict: {
      fuel:
        fuel.find(r => r.petrol && r.diesel)?.name
          ? `Live fuel via: ${fuel.find(r => r.petrol && r.diesel).name}`
          : 'No fuel source reachable — reference rates shown',
      charts: (() => {
        const ok = extra.filter(r => r.sample).map(r => r.source);
        return ok.length
          ? `Live chart sources reachable (${ok.length}/${extra.length}): ${ok.join(', ')}`
          : 'No chart source reachable from this deployment';
      })(),
    },
  });
};
