// Pakistani trending songs — Apple Music "most played" chart, PK storefront
module.exports = async function handler(req, res) {
  try {
    const url = 'https://rss.applemarketingtools.com/api/v2/pk/music/most-played/10/songs.json';
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Apple Music PK chart: ${response.status}`);

    const results = (await response.json())?.feed?.results ?? [];

    const data = results.map(s => ({
      title: s.name ?? '',
      subtitle: s.artistName ?? '',
      image: s.artworkUrl100 ?? null,
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({ success: true, data, source: 'Apple Music Most Played (Pakistan)' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
