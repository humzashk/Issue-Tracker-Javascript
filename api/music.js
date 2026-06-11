// Apple iTunes public RSS — no API key required
module.exports = async function handler(req, res) {
  try {
    const url = 'https://itunes.apple.com/us/rss/topsongs/limit=10/json';
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`iTunes error: ${response.status}`);

    const json = await response.json();
    const entries = json?.feed?.entry ?? [];

    const data = entries.map(e => ({
      title: e['im:name']?.label ?? '',
      subtitle: e['im:artist']?.label ?? '',
      image: e['im:image']?.[2]?.label ?? e['im:image']?.[0]?.label ?? null,
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json({ success: true, data, source: 'Apple iTunes' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
