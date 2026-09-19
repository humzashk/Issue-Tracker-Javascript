// Pakistani daily commodities — fuel, energy, meat, grocery, produce.
//
// Fuel layer: live multi-source scrape (OGRA, pakfuel.today, petrolrate.pk,
//             hamariweb, PSO) — first sane result wins; see /api/probe for
//             which sources are reachable from this deployment.
// Base layer: data/pak-commodities.json — editable reference source that
//             also carries per-item price history for graphs and forecasts.
const fs = require('fs');
const path = require('path');
const { getLiveFuel } = require('./_fuel-sources.js');

const DATA_PATH = path.join(process.cwd(), 'data', 'pak-commodities.json');

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  let json;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    json = JSON.parse(raw);
  } catch (err) {
    console.error('pak-commodities.json read failed:', DATA_PATH, err.message);
    return res.status(500).json({
      success: false,
      message: 'Commodity rates are temporarily unavailable',
      ...(debug ? { debug: { path: DATA_PATH, error: err.message } } : {}),
    });
  }

  let liveFuel = false;
  let fuelSource = null;
  try {
    const fuel = await getLiveFuel();
    const today = new Date().toISOString().slice(0, 10);
    const energy = json.sections.find(s => /fuel/i.test(s.title));
    if (energy) {
      for (const item of energy.items) {
        const live =
          /petrol/i.test(item.name) ? fuel.petrol :
          /diesel/i.test(item.name) ? fuel.diesel : null;
        if (live) {
          item.rate = live;
          item.liveNow = true; // this request scraped it live, right now
          liveFuel = true;
          fuelSource = fuel.source;
          // Extend history with today's point so the chart doesn't stop at
          // the last saved date. This is in-memory only — it does NOT write
          // back to data/pak-commodities.json, so it resets on every request
          // unless the daily cron (api/cron-update-history.js) has already
          // persisted today's point, in which case this just refreshes it.
          const hist = item.history ?? (item.history = []);
          const last = hist[hist.length - 1];
          if (!last || last[0] !== today) hist.push([today, live]);
          else last[1] = live;
        }
      }
    }
  } catch (e) {
    console.error('fuel scrape failed:', e.message);
  }

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.json({
    success: true,
    data: {
      updated: json.updated,
      liveFuel,
      sections: json.sections,
      source: liveFuel
        ? `Live fuel: ${fuelSource} · other items: reference (${json.updated})`
        : `Reference rates (${json.updated}) — live fuel sources unreachable, see /api/probe`,
    },
    source: 'pak-commodities',
  });
};
