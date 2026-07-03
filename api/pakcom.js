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

module.exports = async function handler(req, res) {
  let json;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'pak-commodities.json'), 'utf-8');
    json = JSON.parse(raw);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: 'Commodity rates are temporarily unavailable' });
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
          liveFuel = true;
          fuelSource = fuel.source;
          // extend history with today's live point so charts stay current
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
