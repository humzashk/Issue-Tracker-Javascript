// Pakistani daily commodities — fuel, energy, meat, grocery, produce.
//
// Layer 1: best-effort scrape of PSO's official fuel price page to pull
//          live petrol/diesel (updated fortnightly by OGRA).
// Layer 2: data/pak-commodities.json — the editable reference source that
//          also carries per-item price history for graphs and forecasts.
const fs = require('fs');
const path = require('path');

async function scrapePsoFuel() {
  const res = await fetch('https://psopk.com/en/fuels/fuel-prices', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`PSO: ${res.status}`);
  const html = await res.text();

  const grab = re => {
    const m = html.match(re);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(v) && v > 100 && v < 1000 ? v : null;
  };

  return {
    petrol: grab(/premier|petrol|pmg[^]{0,200}?([\d,]+\.?\d*)/i),
    diesel: grab(/diesel|hsd[^]{0,200}?([\d,]+\.?\d*)/i),
  };
}

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
  try {
    const fuel = await scrapePsoFuel();
    const energy = json.sections.find(s => /fuel/i.test(s.title));
    if (energy) {
      for (const item of energy.items) {
        if (fuel.petrol && /petrol/i.test(item.name)) { item.rate = fuel.petrol; liveFuel = true; }
        if (fuel.diesel && /diesel/i.test(item.name)) { item.rate = fuel.diesel; liveFuel = true; }
      }
    }
  } catch {}

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.json({
    success: true,
    data: {
      updated: json.updated,
      liveFuel,
      sections: json.sections,
      source: liveFuel
        ? 'PSO (live fuel) + reference rates (data/pak-commodities.json)'
        : 'Reference rates — updated via data/pak-commodities.json',
    },
    source: 'pak-commodities',
  });
};
