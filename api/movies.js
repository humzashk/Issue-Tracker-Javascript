// Top 10 movies — IMDb "Most Popular Movies" chart (live popularity data).
// Falls back to the iTunes top-movies RSS if the IMDb fetch fails.
// No API keys: both are public pages/feeds.

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

    const data = movies.map(m => ({ title: m.title, subtitle: '', image: m.image }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=43200');
    res.json({
      success: true,
      data,
      source,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
