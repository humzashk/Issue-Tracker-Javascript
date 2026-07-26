// Keyless music-chart sources.
//
// No API keys anywhere: every source here is a public page or public JSON
// feed. Each fetcher returns [{title, subtitle, image, preview}] or throws,
// and callers run them as a waterfall so a dead source never blanks a card.
//
// Freshness note: all sources below are rebuilt daily by their publishers,
// so "today's chart" really is today's.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(url, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url, timeoutMs = 7000) {
  return JSON.parse(await fetchText(url, timeoutMs));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .trim();
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

// "Artist - Title" → {subtitle: artist, title}
function splitArtistTitle(text) {
  const clean = decodeEntities(text);
  const idx = clean.indexOf(' - ');
  if (idx === -1) return { title: clean, subtitle: '' };
  return { subtitle: clean.slice(0, idx).trim(), title: clean.slice(idx + 3).trim() };
}

// ── Enrichment: artwork + 30s preview, keyless via the iTunes Search API ────
const enrichCache = new Map();

async function enrich(title, artist) {
  const key = `${artist}|${title}`.toLowerCase();
  if (enrichCache.has(key)) return enrichCache.get(key);
  let out = { image: null, preview: null };
  try {
    const term = `${artist} ${title}`
      .replace(/\(.*?\)|\[.*?\]|official|video|lyrics|audio|feat\.?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const j = await fetchJSON(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`,
      6000
    );
    const r = j?.results?.[0];
    if (r) {
      out = {
        image: (r.artworkUrl100 || r.artworkUrl60 || '').replace('100x100', '200x200') || null,
        preview: r.previewUrl ?? null,
      };
    }
  } catch {}
  enrichCache.set(key, out);
  return out;
}

async function enrichAll(rows, limit = 10) {
  return Promise.all(
    rows.slice(0, limit).map(async r => {
      const e = await enrich(r.title, r.subtitle);
      return { title: r.title, subtitle: r.subtitle, image: r.image ?? e.image, preview: r.preview ?? e.preview };
    })
  );
}

// ── Source: kworb Spotify country charts (rebuilt daily, plain HTML) ────────
// Rows link to ../track/<id>.html with "Artist - Title" as the link text.
function parseKworbTracks(html) {
  const rows = [];
  const seen = new Set();
  const re = /<a\s+href="[^"]*(?:track|video)\/[^"]*"[^>]*>([^<]{3,120})<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const { title, subtitle } = splitArtistTitle(stripTags(m[1]));
    if (!title) continue;
    const key = `${subtitle}|${title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, subtitle });
  }
  return rows;
}

async function kworb(pathname) {
  const html = await fetchText(`https://kworb.net/${pathname}`);
  const rows = parseKworbTracks(html);
  if (rows.length < 5) throw new Error('kworb: too few rows parsed');
  return rows;
}

// ── Source: Apple/iTunes RSS per storefront (rebuilt daily, keyless) ────────
// Old-style RSS works for storefronts the newer marketing API omits (e.g. pk).
async function itunesRss(storefront, kind = 'topsongs') {
  const j = await fetchJSON(
    `https://itunes.apple.com/${storefront}/rss/${kind}/limit=25/json`
  );
  const entries = j?.feed?.entry ?? [];
  const rows = entries.map(e => ({
    title: e['im:name']?.label ?? '',
    subtitle: e['im:artist']?.label ?? '',
    image: e['im:image']?.[2]?.label ?? e['im:image']?.[0]?.label ?? null,
    preview: e.link?.find?.(l => l?.attributes?.type === 'audio/x-m4a')?.attributes?.href ?? null,
  })).filter(r => r.title);
  if (!rows.length) throw new Error(`itunes ${storefront}: empty`);
  return rows;
}

// ── Source: Apple Music "most played" marketing feed (daily, keyless) ───────
async function appleMostPlayed(storefront) {
  const j = await fetchJSON(
    `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/25/songs.json`
  );
  const rows = (j?.feed?.results ?? []).map(s => ({
    title: s.name ?? '',
    subtitle: s.artistName ?? '',
    image: s.artworkUrl100 ?? null,
  })).filter(r => r.title);
  if (!rows.length) throw new Error(`apple ${storefront}: empty`);
  return rows;
}

// ── Source: Deezer public chart / playlist search (live, keyless) ───────────
async function deezerChart(limit = 25) {
  const j = await fetchJSON(`https://api.deezer.com/chart/0/tracks?limit=${limit}`);
  const rows = (j?.data ?? []).map(t => ({
    title: t.title ?? '',
    subtitle: t.artist?.name ?? '',
    image: t.album?.cover_medium ?? t.album?.cover ?? null,
    preview: t.preview ?? null,
  })).filter(r => r.title);
  if (!rows.length) throw new Error('deezer chart: empty');
  return rows;
}

// Playlists whose titles carry the current or previous year rank first, so a
// stale "best of 2019" list never wins.
async function deezerPlaylist(query, limit = 25) {
  const j = await fetchJSON(
    `https://api.deezer.com/search/playlist?q=${encodeURIComponent(query)}&limit=25`
  );
  const year = new Date().getFullYear();
  const scored = (j?.data ?? [])
    .filter(p => (p.nb_tracks ?? 0) >= 10)
    .map(p => {
      const t = p.title ?? '';
      let score = 0;
      if (t.includes(String(year))) score += 1000;
      else if (t.includes(String(year - 1))) score += 500;
      if (/\b(20(0\d|1\d|2[0-4]))\b/.test(t)) score -= 800; // explicitly old years
      if (/new|latest|trending|viral|top|hits/i.test(t)) score += 100;
      score += Math.min(p.fans ?? 0, 50000) / 1000;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) throw new Error('deezer playlist: no candidates');

  const pl = scored[0].p;
  const tracks = await fetchJSON(`https://api.deezer.com/playlist/${pl.id}/tracks?limit=${limit}`);
  const rows = (tracks?.data ?? []).map(t => ({
    title: t.title ?? '',
    subtitle: t.artist?.name ?? '',
    image: t.album?.cover_medium ?? t.album?.cover ?? null,
    preview: t.preview ?? null,
  })).filter(r => r.title);
  if (!rows.length) throw new Error('deezer playlist: empty');
  return { rows, title: pl.title };
}

// ── Source: YouTube trending RSS-ish scrape (keyless) ───────────────────────
// The results page ships an ytInitialData JSON blob; titles are enough for us
// since artwork/preview come from the enrichment step.
async function youtubeSearchTitles(query) {
  const html = await fetchText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAI%253D`
  );
  const rows = [];
  const seen = new Set();
  const re = /"videoRenderer":\{.*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html)) !== null && rows.length < 30) {
    let raw;
    try { raw = JSON.parse(`"${m[1]}"`); } catch { continue; }
    const cleaned = raw
      .replace(/\|.*$/, '')
      .replace(/\((?:official|lyrical|full)[^)]*\)/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 3) continue;
    const { title, subtitle } = splitArtistTitle(cleaned);
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, subtitle });
  }
  if (rows.length < 5) throw new Error('youtube: too few rows');
  return rows;
}

// Run sources in order; first success wins. Returns {rows, source}.
async function waterfall(candidates) {
  const attempts = [];
  for (const c of candidates) {
    try {
      const out = await c.run();
      const rows = Array.isArray(out) ? out : out.rows;
      const label = Array.isArray(out) ? c.name : (out.title ? `${c.name} — ${out.title}` : c.name);
      if (rows?.length) return { rows, source: label, attempts };
      attempts.push({ source: c.name, error: 'empty' });
    } catch (e) {
      attempts.push({ source: c.name, error: String(e.message).slice(0, 80) });
    }
  }
  const err = new Error('All chart sources unavailable');
  err.attempts = attempts;
  throw err;
}

module.exports = {
  fetchText,
  fetchJSON,
  enrichAll,
  kworb,
  itunesRss,
  appleMostPlayed,
  deezerChart,
  deezerPlaylist,
  youtubeSearchTitles,
  waterfall,
};
