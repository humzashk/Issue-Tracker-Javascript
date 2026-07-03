// Pakistani plastic raw material (dana) rates — PKR per kg.
//
// There is no free public API for Pakistani polymer market rates, so this
// endpoint works in two layers:
//   1. Best-effort scrape of zaraye.co's public raw-material rate pages
//      (a Pakistani B2B raw material marketplace).
//   2. Fallback to data/plastics.json in this repo — edit that file any
//      time to publish updated rates; the site reads it on every deploy.
const fs = require('fs');
const path = require('path');

const GRADES = [
  { key: /pp[\s-]*injection|crystal/i, grade: 'PP Injection (Crystal)' },
  { key: /pp[\s-]*film/i,              grade: 'PP Film Grade' },
  { key: /raffia|pp[\s-]*tape/i,       grade: 'PP Tape / Raffia' },
  { key: /hdpe[\s-]*injection/i,       grade: 'HDPE Injection' },
  { key: /hdpe[\s-]*blow/i,            grade: 'HDPE Blow Moulding' },
  { key: /hdpe[\s-]*film/i,            grade: 'HDPE Film' },
  { key: /lldpe/i,                     grade: 'LLDPE Film' },
  { key: /ldpe/i,                      grade: 'LDPE Film' },
  { key: /pet/i,                       grade: 'PET Bottle Grade' },
  { key: /pvc/i,                       grade: 'PVC Suspension' },
];

async function scrapeZaraye() {
  const res = await fetch('https://www.zaraye.co/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`zaraye: ${res.status}`);
  const html = await res.text();

  const items = [];
  for (const g of GRADES) {
    // look for a grade keyword followed within 300 chars by "Rs 350" / "PKR 350/kg" style numbers
    const re = new RegExp(g.key.source + String.raw`[^]{0,300}?(?:Rs\.?|PKR)\s*([\d,]{2,6})`, 'i');
    const m = html.match(re);
    if (m) {
      const rate = parseInt(m[1].replace(/,/g, ''), 10);
      if (Number.isFinite(rate) && rate > 100 && rate < 2000) {
        items.push({ grade: g.grade, rate, unit: 'PKR/kg' });
      }
    }
  }
  if (items.length < 3) throw new Error('too few scraped rates');
  return items;
}

module.exports = async function handler(req, res) {
  let payload;
  try {
    const items = await scrapeZaraye();
    payload = {
      updated: new Date().toISOString().slice(0, 10),
      indicative: false,
      items,
      source: 'zaraye.co (live)',
    };
  } catch {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'plastics.json'), 'utf-8');
      const json = JSON.parse(raw);
      payload = {
        updated: json.updated,
        indicative: true,
        items: json.items,
        source: 'Indicative rates (data/plastics.json)',
      };
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: 'Plastic rates are temporarily unavailable' });
    }
  }

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.json({ success: true, data: payload, source: payload.source });
};
