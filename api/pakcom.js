// Daily Rates — Karachi prices of everyday essentials.
//
// Prices & history: Pakistan Bureau of Statistics weekly SPI, Karachi average
//                   (api/_spi.js) — about a year of official weekly prices,
//                   read live, nothing stored.
// Petrol & diesel:  today's notified price scraped live (OGRA, PSO, …) and
//                   added as today's point on top of the weekly series.
// Fallback:         data/pak-commodities.json (saved PBS snapshot) if PBS is
//                   unreachable.
const fs = require('fs');
const path = require('path');
const { getLiveFuel } = require('./_fuel-sources.js');
const { getSpiSeries } = require('./_spi.js');

const DATA_PATH = path.join(process.cwd(), 'data', 'pak-commodities.json');

// What the card shows, mapped to PBS item names (matched on the start of the
// name, since PBS sometimes tweaks the wording).
const CATALOG = [
  { title: 'Fuel & Energy', items: [
    { name: 'Petrol (Super)', spi: /^petrol super/i, unit: 'PKR/litre' },
    { name: 'Hi-Speed Diesel', spi: /^hi-?speed diesel/i, unit: 'PKR/litre' },
    { name: 'LPG cylinder', spi: /^lpg/i, unit: 'PKR/11.67 kg' },
    { name: 'Electricity (lowest slab)', spi: /^electricity/i, unit: 'PKR/unit' },
    { name: 'Gas (lowest slab)', spi: /^gas charges/i, unit: 'PKR/MMBtu' },
  ] },
  { title: 'Meat, Dairy & Eggs', items: [
    { name: 'Chicken (live)', spi: /^chicken/i, unit: 'PKR/kg' },
    { name: 'Beef (with bone)', spi: /^beef/i, unit: 'PKR/kg' },
    { name: 'Mutton', spi: /^mutton/i, unit: 'PKR/kg' },
    { name: 'Eggs (farm)', spi: /^eggs/i, unit: 'PKR/dozen' },
    { name: 'Milk (fresh)', spi: /^milk fresh/i, unit: 'PKR/litre' },
    { name: 'Dahi', spi: /^curd/i, unit: 'PKR/kg' },
  ] },
  { title: 'Grocery Staples', items: [
    { name: 'Atta (wheat flour)', spi: /^wheat flour/i, unit: 'PKR/20 kg bag' },
    { name: 'Sugar', spi: /^sugar/i, unit: 'PKR/kg' },
    { name: 'Cooking Oil', spi: /^cooking oil/i, unit: 'PKR/5 L tin' },
    { name: 'Ghee', spi: /^vegetable ghee.*1 ?kg/i, unit: 'PKR/kg pouch' },
    { name: 'Basmati Rice (broken)', spi: /^rice basmati/i, unit: 'PKR/kg' },
    { name: 'Rice IRRI-6/9', spi: /^rice irri/i, unit: 'PKR/kg' },
    { name: 'Daal Chana', spi: /^pulse gram/i, unit: 'PKR/kg' },
    { name: 'Daal Masoor', spi: /^pulse masoor/i, unit: 'PKR/kg' },
    { name: 'Daal Moong', spi: /^pulse moong/i, unit: 'PKR/kg' },
    { name: 'Daal Mash', spi: /^pulse mash/i, unit: 'PKR/kg' },
  ] },
  { title: 'Vegetables & Fruits', items: [
    { name: 'Onion', spi: /^onions?\b/i, unit: 'PKR/kg' },
    { name: 'Tomato', spi: /^tomato/i, unit: 'PKR/kg' },
    { name: 'Potato', spi: /^potato/i, unit: 'PKR/kg' },
    { name: 'Garlic', spi: /^garlic/i, unit: 'PKR/kg' },
    { name: 'Banana', spi: /^bananas?/i, unit: 'PKR/dozen' },
  ] },
];

const round2 = v => Math.round(v * 100) / 100;

// weekly annexes (ascending) → card sections with history
function buildFromSpi(weeks) {
  return CATALOG.map(sec => ({
    title: sec.title,
    items: sec.items.map(def => {
      const history = [];
      let latest = null;
      for (const w of weeks) {
        const key = Object.keys(w.items).find(k => def.spi.test(k));
        const row = key && w.items[key];
        if (!row || !(row.avg > 0)) continue;
        history.push([w.date, round2(row.avg)]);
        latest = { ...row, date: w.date };
      }
      if (!latest) return null;
      return {
        name: def.name,
        unit: def.unit,
        rate: round2(latest.avg),
        asOf: latest.date,
        ...(latest.min != null && latest.max != null && latest.max > latest.min
          ? { range: [round2(latest.min), round2(latest.max)] } : {}),
        history,
      };
    }).filter(Boolean),
  })).filter(s => s.items.length);
}

// YYYY-MM-DD in Pakistan (UTC+5), not UTC
function karachiDate() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  const today = karachiDate();

  const [spi, fuel] = await Promise.all([
    getSpiSeries(today).catch(e => ({ weeks: [], report: { error: e.message } })),
    getLiveFuel().catch(e => ({ error: e.message })),
  ]);

  let sections, official = false, updated;
  if (spi.weeks.length >= 2) {
    sections = buildFromSpi(spi.weeks);
    official = true;
    updated = spi.weeks.at(-1).date;
  } else {
    try {
      const json = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
      sections = json.sections;
      updated = json.updated;
    } catch (err) {
      console.error('pak-commodities.json read failed:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Daily rates are temporarily unavailable',
        ...(debug ? { debug: { spi: spi.report, error: err.message } } : {}),
      });
    }
  }

  // Petrol & diesel: today's live notified price on top of the weekly series
  let liveFuel = false;
  for (const sec of sections) {
    for (const item of sec.items) {
      const key = /petrol/i.test(item.name) ? 'petrol' : /diesel/i.test(item.name) ? 'diesel' : null;
      const live = key && fuel?.[key];
      if (!live) continue;
      liveFuel = true;
      item.rate = live;
      item.liveNow = true;
      item.asOf = today;
      delete item.range;
      const h = item.history ?? (item.history = []);
      const last = h[h.length - 1];
      if (!last || last[0] < today) h.push([today, live]);
      else if (last[0] === today) last[1] = live;
    }
  }

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  res.json({
    success: true,
    data: {
      updated,
      official,
      liveFuel,
      fuelSource: liveFuel ? fuel.source : null,
      sections,
    },
    source: 'pak-commodities',
    ...(debug ? {
      debug: {
        today,
        spi: spi.report,
        fuel: fuel?.error ? fuel : { source: fuel.source, petrol: fuel.petrol, diesel: fuel.diesel },
      },
    } : {}),
  });
};

module.exports.buildFromSpi = buildFromSpi;
