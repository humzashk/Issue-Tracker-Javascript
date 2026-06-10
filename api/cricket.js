// TheSportsDB free tier (API key "3") — IPL league ID 4512
const LEAGUES = ['4512', '4515'];

async function fetchLeagueEvents(leagueId) {
  const url = `https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${leagueId}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TheSportsDB: ${res.status}`);
  const json = await res.json();
  return json?.events ?? [];
}

module.exports = async function handler(req, res) {
  try {
    const results = await Promise.allSettled(LEAGUES.map(fetchLeagueEvents));
    const allEvents = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Sort by date descending, take 8 most recent
    const sorted = allEvents
      .filter(e => e.dateEvent)
      .sort((a, b) => new Date(b.dateEvent) - new Date(a.dateEvent))
      .slice(0, 8);

    const data = sorted.map(e => ({
      competition: e.strLeague,
      date: e.dateEvent,
      homeTeam: e.strHomeTeam,
      awayTeam: e.strAwayTeam,
      score:
        e.intHomeScore != null && e.intAwayScore != null
          ? `${e.intHomeScore} – ${e.intAwayScore}`
          : null,
      status: e.strStatus || null,
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ success: true, data, source: 'TheSportsDB' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
