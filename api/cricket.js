// CricAPI v1 — free tier (100 req/day)
// Add CRICKET_API_KEY in Vercel → Project Settings → Environment Variables
// Get a free key at: https://cricapi.com
module.exports = async function handler(req, res) {
  const apiKey = process.env.CRICKET_API_KEY;

  if (!apiKey) {
    return res.json({
      success: false,
      message:
        'Cricket data requires an API key. Add CRICKET_API_KEY to your Vercel environment variables. Get a free key (100 req/day) at cricapi.com',
    });
  }

  try {
    const url = `https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`CricAPI error: ${response.status}`);

    const json = await response.json();
    if (json.status !== 'success') throw new Error(json.reason || 'CricAPI returned an error');

    const matches = json?.data ?? [];

    const data = matches.slice(0, 8).map(m => {
      const homeTeam = m.teams?.[0] ?? '';
      const awayTeam = m.teams?.[1] ?? '';

      let scoreLines = null;
      if (m.score?.length) {
        scoreLines = m.score.map(s => {
          const team = s.inning?.replace(/ Inning \d+$/, '') ?? '';
          return `${team}: ${s.r}/${s.w} (${parseFloat(s.o).toFixed(1)} ov)`;
        });
      }

      return {
        matchType: (m.matchType ?? '').toUpperCase(),
        date: m.date ?? '',
        homeTeam,
        awayTeam,
        scoreLines,
        status: m.status ?? null,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.json({ success: true, data, source: 'CricAPI' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
