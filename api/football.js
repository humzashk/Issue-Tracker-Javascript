// FIFA World Cup — TheSportsDB. The league ID is looked up by name at
// runtime (and cached) because hardcoded IDs proved unreliable.
let cachedLeagueId = null;

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TheSportsDB: ${res.status}`);
  return res.json();
}

async function findWorldCupId() {
  if (cachedLeagueId) return cachedLeagueId;
  const json = await getJSON('https://www.thesportsdb.com/api/v1/json/3/search_all_leagues.php?s=Soccer');
  const leagues = json?.countries ?? json?.leagues ?? [];
  const wc = leagues.find(l => /^fifa world cup$/i.test(l.strLeague?.trim() ?? ''));
  if (!wc) throw new Error('FIFA World Cup league not found on TheSportsDB');
  cachedLeagueId = wc.idLeague;
  return cachedLeagueId;
}

module.exports = async function handler(req, res) {
  try {
    const leagueId = await findWorldCupId();

    const attempts = [
      `https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=${leagueId}&s=2026`,
      `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${leagueId}`,
      `https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${leagueId}`,
    ];

    let events = [];
    for (const url of attempts) {
      try {
        events = (await getJSON(url))?.events ?? [];
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
    res.json({ success: true, data, source: 'TheSportsDB — FIFA World Cup' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
