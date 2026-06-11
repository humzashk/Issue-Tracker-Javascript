// FIFA World Cup 2026 — TheSportsDB (league ID 4480)
const FIFA_WC_ID = '4480';

async function fetchEvents(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TheSportsDB: ${res.status}`);
  const json = await res.json();
  return json?.events ?? [];
}

module.exports = async function handler(req, res) {
  try {
    // Try 2026 season first, then fall back to upcoming/past
    const attempts = [
      `https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=${FIFA_WC_ID}&s=2026`,
      `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${FIFA_WC_ID}`,
      `https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${FIFA_WC_ID}`,
    ];

    let events = [];
    for (const url of attempts) {
      try {
        events = await fetchEvents(url);
        if (events.length) break;
      } catch {}
    }

    const sorted = events
      .filter(e => e.dateEvent)
      .sort((a, b) => new Date(b.dateEvent) - new Date(a.dateEvent))
      .slice(0, 8);

    const data = sorted.map(e => ({
      competition: 'FIFA World Cup 2026',
      date: e.dateEvent,
      homeTeam: e.strHomeTeam,
      awayTeam: e.strAwayTeam,
      score:
        e.intHomeScore != null && e.intAwayScore != null
          ? `${e.intHomeScore} – ${e.intAwayScore}`
          : null,
      status: e.strStatus ?? null,
    }));

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');
    res.json({ success: true, data, source: 'TheSportsDB — FIFA World Cup 2026' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
