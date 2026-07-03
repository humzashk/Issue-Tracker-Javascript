// Global top 10 trending songs — Apple Music "most played" streaming chart,
// enriched with 30s preview URLs from the iTunes Search API.
async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function findPreview(title, artist) {
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const j = await getJSON(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=1`
    );
    return j?.results?.[0]?.previewUrl ?? null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    const j = await getJSON(
      'https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json'
    );
    const results = j?.feed?.results ?? [];

    const data = await Promise.all(
      results.map(async s => ({
        title: s.name ?? '',
        subtitle: s.artistName ?? '',
        image: s.artworkUrl100 ?? null,
        preview: await findPreview(s.name ?? '', s.artistName ?? ''),
      }))
    );

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({ success: true, data, source: 'Apple Music Most Played (Global)' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
