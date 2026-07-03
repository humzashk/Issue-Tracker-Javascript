// Pakistani trending songs.
// Layer 1: YouTube trending (music category, region PK) — the only reliable
//          live "trending in Pakistan today" source. Requires YOUTUBE_API_KEY
//          (free at console.cloud.google.com).
// Layer 2: Deezer playlist search preferring current-year Pakistani playlists.
async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function findPreview(title, artist) {
  try {
    const term = encodeURIComponent(`${title} ${artist}`.replace(/\(.*?\)|\[.*?\]|official|video|lyrics/gi, '').trim());
    const j = await getJSON(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=1`);
    return j?.results?.[0]?.previewUrl ?? null;
  } catch {
    return null;
  }
}

async function fromYouTubePK(apiKey) {
  const url =
    'https://www.googleapis.com/youtube/v3/videos' +
    `?part=snippet&chart=mostPopular&videoCategoryId=10&regionCode=PK&maxResults=10&key=${apiKey}`;
  const j = await getJSON(url);
  const items = j?.items ?? [];
  if (!items.length) throw new Error('empty');
  return Promise.all(
    items.map(async v => ({
      title: v.snippet?.title ?? '',
      subtitle: v.snippet?.channelTitle ?? '',
      image: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
      preview: await findPreview(v.snippet?.title ?? '', ''),
    }))
  );
}

async function fromDeezer() {
  const year = new Date().getFullYear();
  const search = await getJSON(
    'https://api.deezer.com/search/playlist?q=' + encodeURIComponent('pakistani hits')
  );
  const playlists = (search?.data ?? []).filter(p => p.nb_tracks >= 10);
  // prefer playlists named with the current year, then by follower count
  playlists.sort((a, b) => {
    const aYear = a.title?.includes(String(year)) ? 1 : 0;
    const bYear = b.title?.includes(String(year)) ? 1 : 0;
    if (aYear !== bYear) return bYear - aYear;
    return (b.fans ?? 0) - (a.fans ?? 0);
  });
  if (!playlists.length) throw new Error('no playlists');
  const pl = await getJSON(`https://api.deezer.com/playlist/${playlists[0].id}/tracks?limit=10`);
  const tracks = pl?.data ?? [];
  return {
    data: tracks.slice(0, 10).map(t => ({
      title: t.title ?? '',
      subtitle: t.artist?.name ?? '',
      image: t.album?.cover_medium ?? t.album?.cover ?? null,
      preview: t.preview ?? null,
    })),
    source: `Deezer — ${playlists[0].title}`,
  };
}

module.exports = async function handler(req, res) {
  try {
    const key = process.env.YOUTUBE_API_KEY;
    let data;
    let source;

    if (key) {
      try {
        data = await fromYouTubePK(key);
        source = 'YouTube Trending Music (Pakistan) — live';
      } catch {}
    }
    if (!data?.length) {
      const dz = await fromDeezer();
      data = dz.data;
      source = dz.source;
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({ success: true, data, source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
