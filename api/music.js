// Top 10 trending songs — Apple Music "most played" chart (live streaming
// data, unlike the old iTunes RSS which reflected purchases and skewed old).
// Tries the Pakistan storefront first, falls back to global US chart.
async function fetchChart(storefront) {
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/10/songs.json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Apple Music chart (${storefront}): ${res.status}`);
  const json = await res.json();
  return json?.feed?.results ?? [];
}

module.exports = async function handler(req, res) {
  try {
    let results = [];
    let market = 'PK';
    try {
      results = await fetchChart('pk');
    } catch {}
    if (!results.length) {
      results = await fetchChart('us');
      market = 'US';
    }

    const data = results.map(s => ({
      title: s.name ?? '',
      subtitle: s.artistName ?? '',
      image: s.artworkUrl100 ?? null,
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({ success: true, data, source: `Apple Music Most Played (${market})` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
