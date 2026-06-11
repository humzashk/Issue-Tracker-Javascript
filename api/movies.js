// Top 10 movies from Apple iTunes RSS, enriched with IMDb rating and
// Metascore via OMDb. Set OMDB_API_KEY in Vercel env vars (free key at
// omdbapi.com, 1000 req/day); without it the list still works, just
// without ratings.
async function fetchRatings(title, apiKey) {
  try {
    const url = `https://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.Response !== 'True') return null;
    return {
      imdbRating: json.imdbRating !== 'N/A' ? json.imdbRating : null,
      metascore: json.Metascore !== 'N/A' ? json.Metascore : null,
    };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    const url = 'https://itunes.apple.com/us/rss/topmovies/limit=10/json';
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`iTunes error: ${response.status}`);

    const json = await response.json();
    const entries = json?.feed?.entry ?? [];
    const apiKey = process.env.OMDB_API_KEY;

    const data = await Promise.all(
      entries.map(async e => {
        const title = e['im:name']?.label ?? '';
        const ratings = apiKey ? await fetchRatings(title, apiKey) : null;

        const parts = [];
        if (ratings?.imdbRating) parts.push(`⭐ IMDb ${ratings.imdbRating}`);
        if (ratings?.metascore) parts.push(`Metascore ${ratings.metascore}`);
        if (!parts.length) parts.push(e?.category?.attributes?.label ?? '');

        return {
          title,
          subtitle: parts.join('  ·  '),
          image: e['im:image']?.[2]?.label ?? e['im:image']?.[0]?.label ?? null,
        };
      })
    );

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json({
      success: true,
      data,
      source: apiKey ? 'Apple iTunes + OMDb' : 'Apple iTunes (set OMDB_API_KEY for ratings)',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
