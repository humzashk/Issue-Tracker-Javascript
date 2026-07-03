// Pakistani trending songs.
// Apple's PK storefront often has no "most played" feed (hence the failures),
// so this tries Apple first and falls back to the most-followed Pakistani
// hits playlist on Deezer (free, no key, includes 30s previews).

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

async function fromApple() {
  const j = await getJSON(
    'https://rss.applemarketingtools.com/api/v2/pk/music/most-played/10/songs.json'
  );
  const results = j?.feed?.results ?? [];
  if (!results.length) throw new Error('empty');
  return Promise.all(
    results.map(async s => ({
      title: s.name ?? '',
      subtitle: s.artistName ?? '',
      image: s.artworkUrl100 ?? null,
      preview: await findPreview(s.name ?? '', s.artistName ?? ''),
    }))
  );
}

async function fromDeezer() {
  const search = await getJSON(
    'https://api.deezer.com/search/playlist?q=' + encodeURIComponent('pakistani hits')
  );
  const playlists = (search?.data ?? [])
    .filter(p => p.nb_tracks >= 10)
    .sort((a, b) => (b.fans ?? 0) - (a.fans ?? 0));
  if (!playlists.length) throw new Error('no playlists');
  const pl = await getJSON(`https://api.deezer.com/playlist/${playlists[0].id}/tracks?limit=10`);
  const tracks = pl?.data ?? [];
  return tracks.slice(0, 10).map(t => ({
    title: t.title ?? '',
    subtitle: t.artist?.name ?? '',
    image: t.album?.cover_medium ?? t.album?.cover ?? null,
    preview: t.preview ?? null,
  }));
}

module.exports = async function handler(req, res) {
  try {
    let data;
    let source = 'Apple Music (Pakistan)';
    try {
      data = await fromApple();
    } catch {
      data = await fromDeezer();
      source = 'Deezer — Pakistani Hits';
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({ success: true, data, source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
