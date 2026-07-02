// Reels/viral trending audio — proxied via Deezer (free, no key).
// Searches for the most-followed "reels viral hits" playlist and returns
// its top tracks; falls back to Deezer's global chart if nothing matches.
async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Deezer: ${res.status}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  try {
    let tracks = [];
    let source = 'Deezer';

    try {
      const search = await getJSON(
        'https://api.deezer.com/search/playlist?q=' + encodeURIComponent('reels viral hits')
      );
      // pick the most-followed matching playlist
      const playlists = (search?.data ?? [])
        .filter(p => p.nb_tracks >= 10)
        .sort((a, b) => (b.fans ?? 0) - (a.fans ?? 0));
      if (playlists.length) {
        const pl = await getJSON(`https://api.deezer.com/playlist/${playlists[0].id}/tracks?limit=10`);
        tracks = pl?.data ?? [];
        source = `Deezer playlist: ${playlists[0].title}`;
      }
    } catch {}

    if (!tracks.length) {
      const chart = await getJSON('https://api.deezer.com/chart/0/tracks?limit=10');
      tracks = chart?.data ?? [];
      source = 'Deezer Global Chart';
    }

    const data = tracks.slice(0, 10).map(t => ({
      title: t.title ?? '',
      subtitle: t.artist?.name ?? '',
      image: t.album?.cover_medium ?? t.album?.cover ?? null,
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({ success: true, data, source });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
