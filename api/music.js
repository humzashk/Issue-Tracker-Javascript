// Global top 10 trending songs.
// Layer 1: YouTube trending (music category, US) — live, current-date data.
//          Requires YOUTUBE_API_KEY (free at console.cloud.google.com).
// Layer 2: Deezer's real-time global chart — no key, always current.
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

async function fromYouTube(regionCode, apiKey) {
  const url =
    'https://www.googleapis.com/youtube/v3/videos' +
    `?part=snippet&chart=mostPopular&videoCategoryId=10&regionCode=${regionCode}&maxResults=10&key=${apiKey}`;
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

async function fromDeezerChart() {
  const chart = await getJSON('https://api.deezer.com/chart/0/tracks?limit=10');
  const tracks = chart?.data ?? [];
  return tracks.slice(0, 10).map(t => ({
    title: t.title ?? '',
    subtitle: t.artist?.name ?? '',
    image: t.album?.cover_medium ?? t.album?.cover ?? null,
    preview: t.preview ?? null,
  }));
}

module.exports = async function handler(req, res) {
  try {
    const key = process.env.YOUTUBE_API_KEY;
    let data;
    let source;

    if (key) {
      try {
        data = await fromYouTube('US', key);
        source = 'YouTube Trending Music (Global/US) — live';
      } catch {}
    }
    if (!data?.length) {
      data = await fromDeezerChart();
      source = 'Deezer Global Chart — live';
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({ success: true, data, source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
