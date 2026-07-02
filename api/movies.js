// Top 10 movies — IMDb "Most Popular Movies" chart (live popularity data),
// enriched with IMDb rating + Metascore via OMDb when OMDB_API_KEY is set.
// Falls back to the iTunes top-movies RSS if the IMDb fetch fails.

async function fetchImdbPopular() {
  const res = await fetch('https://www.imdb.com/chart/moviemeter/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`IMDb: ${res.status}`);
  const html = await res.text();

  // IMDb chart pages embed an ld+json ItemList with the ranked movies
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('IMDb chart payload not found');
  const ld = JSON.parse(m[1]);
  const items = ld?.itemListElement ?? [];
  if (!items.length) throw new Error('IMDb chart empty');

  return items.slice(0, 10).map(e => ({
    title: e?.item?.name ?? '',
    image: e?.item?.image ?? null,
  }));
}

async function fetchItunesFallback() {
  const res = await fetch('https://itunes.apple.com/us/rss/topmovies/limit=10/json', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`iTunes error: ${res.status}`);
  const entries = (await res.json())?.feed?.entry ?? [];
  return entries.map(e => ({
    title: e['im:name']?.label ?? '',
    image: e['im:image']?.[2]?.label ?? e['im:image']?.[0]?.label ?? null,
  }));
}

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
      year: json.Year !== 'N/A' ? json.Year : null,
    };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    let movies;
    let source = 'IMDb Most Popular';
    try {
      movies = await fetchImdbPopular();
    } catch (e) {
      console.error('IMDb fetch failed, falling back to iTunes:', e.message);
      movies = await fetchItunesFallback();
      source = 'Apple iTunes';
    }

    const apiKey = process.env.OMDB_API_KEY;

    const data = await Promise.all(
      movies.map(async m => {
        const ratings = apiKey ? await fetchRatings(m.title, apiKey) : null;
        const parts = [];
        if (ratings?.year) parts.push(ratings.year);
        if (ratings?.imdbRating) parts.push(`⭐ IMDb ${ratings.imdbRating}`);
        if (ratings?.metascore) parts.push(`Metascore ${ratings.metascore}`);
        return {
          title: m.title,
          subtitle: parts.join('  ·  '),
          image: m.image,
        };
      })
    );

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json({
      success: true,
      data,
      source: apiKey ? `${source} + OMDb` : `${source} (set OMDB_API_KEY for ratings)`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
