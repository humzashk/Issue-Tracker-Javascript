// Pakistani daily commodities — fuel, energy, meat, grocery, produce.
//
// Fuel layer: live multi-source scrape (OGRA, pakfuel.today, petrolrate.pk,
//             hamariweb, PSO) — first sane result wins.
// History:    petrol/diesel charts use the full dated price list read live
//             from public fuel-history pages (api/_fuel-history.js), checked
//             against today's live price. Nothing is stored.
// Base layer: data/pak-commodities.json — editable reference source that
//             also carries per-item price history for graphs and forecasts.
const fs = require('fs');
const path = require('path');
const { getLiveFuel } = require('./_fuel-sources.js');
const { getFuelHistory } = require('./_fuel-history.js');

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
  let historyReport = null;
  const today = karachiDate();
  try {
    const fuelP = getLiveFuel();
    const histP = getFuelHistory(fuelP.then(f => ({ petrol: f.petrol, diesel: f.diesel })), today)
      .catch(e => ({ error: e.message }));
    const fuel = await fuelP;
    const hist = await histP;
    historyReport = hist.error
      ? hist
      : { petrol: hist.petrol?.url ?? null, diesel: hist.diesel?.url ?? null, pages: hist.report };
    const energy = json.sections.find(s => /fuel/i.test(s.title));
    if (energy) {
      for (const item of energy.items) {
        const key = /petrol/i.test(item.name) ? 'petrol' : /diesel/i.test(item.name) ? 'diesel' : null;
        const live = key ? fuel[key] : null;
        if (live) {
          const full = hist?.[key];
          if (full) {
            // Verified dated list: keep our older points before it starts,
            // then every official revision from there on.
            // Capped at about a year so the chart stays readable.
            const start = full.series[0][0];
            const from = new Date(Date.parse(today) - 366 * 86400000).toISOString().slice(0, 10);
            const series = [...(item.history ?? []).filter(p => p[0] < start), ...full.series];
            const cut = series.findLastIndex(p => p[0] <= from); // price in force on `from`
            item.history = cut > 0 ? series.slice(cut) : series;
            item.historySource = new URL(full.url).hostname.replace(/^www\./, '');
            item.historyFrom = start; // complete list from here on
          }
          item.rate = live;
          item.liveNow = true; // this request scraped it live, right now
          liveFuel = true;
          fuelSource = fuel.source;
          // Extend history with today's live point (in memory only) so the
          // chart runs up to today instead of stopping at the last saved date.
          // Fuel prices are notified and hold until the next revision, so the
          // chart draws them as steps.
          item.stepped = true;
          const h = item.history ?? (item.history = []);
          const last = h[h.length - 1];
          if (!last || last[0] < today) h.push([today, live]);
          else if (last[0] === today) last[1] = live;
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
        : `Reference rates (${json.updated}) — live fuel sources unreachable`,
    },
    source: 'pak-commodities',
    ...(debug ? { debug: { today, history: historyReport } } : {}),
  });
};

// YYYY-MM-DD in Pakistan (UTC+5), not UTC
function karachiDate() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}
