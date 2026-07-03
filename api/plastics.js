// Pakistani plastic raw material (dana) rates — PKR per kg.
//
// Research note: there is no free, publicly scrapeable source for Pakistani
// grade-level dana rates. Zaraye's rate page is behind Cloudflare bot
// protection, Polymerupdate is subscription-only, and Plastic4trade covers
// India/INR. The authoritative source is therefore data/plastics.json in
// this repo — edit it on GitHub (even from a phone) and Vercel redeploys
// the new rates automatically within about a minute.
//
// A best-effort scrape of zaraye.co still runs first so that if they ever
// open up their pages, live rates take over automatically.
const fs = require('fs');
const path = require('path');

const GRADES = [
  { key: /lldpe[\s-]*119/i,            grade: 'LLDPE 119' },
  { key: /lldpe[\s-]*118/i,            grade: 'LLDPE 118' },
  { key: /lldpe[\s-]*122/i,            grade: 'LLDPE 122' },
  { key: /lldpe[\s-]*153/i,            grade: 'LLDPE 153' },
  { key: /lldpe[\s-]*1018|ll[\s-]*1018/i, grade: 'LLDPE 1018' },
  { key: /7080/i,                      grade: 'LLDPE 7080' },
  { key: /7087/i,                      grade: 'LLDPE 7087' },
  { key: /1001\s*bu/i,                 grade: 'LLDPE 1001BU' },
  { key: /pp[\s-]*injection|crystal/i, grade: 'PP Injection (Crystal)' },
  { key: /pp[\s-]*film/i,              grade: 'PP Film Grade' },
  { key: /raffia|pp[\s-]*tape/i,       grade: 'PP Tape / Raffia' },
  { key: /hdpe[\s-]*injection/i,       grade: 'HDPE Injection' },
  { key: /hdpe[\s-]*blow/i,            grade: 'HDPE Blow Moulding' },
  { key: /hdpe[\s-]*film/i,            grade: 'HDPE Film' },
  { key: /ldpe/i,                      grade: 'LDPE Film' },
  { key: /pet/i,                       grade: 'PET Bottle Grade' },
  { key: /pvc/i,                       grade: 'PVC Suspension' },
];

async function scrapeZaraye() {
  const res = await fetch('https://www.zaraye.co/plastic-dana-rate-today', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`zaraye: ${res.status}`);
  const html = await res.text();

  const items = [];
  for (const g of GRADES) {
    const re = new RegExp(g.key.source + String.raw`[^]{0,300}?(?:Rs\.?|PKR)\s*([\d,]{2,6})`, 'i');
    const m = html.match(re);
    if (m) {
      const rate = parseInt(m[1].replace(/,/g, ''), 10);
      if (Number.isFinite(rate) && rate > 50 && rate < 2000) {
        items.push({ grade: g.grade, rate, unit: 'PKR/kg' });
      }
    }
  }
  if (items.length < 4) throw new Error('too few scraped rates');
  return items;
}

function readLocalRates() {
  const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'plastics.json'), 'utf-8');
  return JSON.parse(raw);
}

module.exports = async function handler(req, res) {
  let payload;
  try {
    const items = await scrapeZaraye();
    payload = {
      updated: new Date().toISOString().slice(0, 10),
      indicative: false,
      sections: [{ title: 'Live Market Rates', items }],
      source: 'zaraye.co (live)',
    };
  } catch {
    try {
      const json = readLocalRates();
      payload = {
        updated: json.updated,
        indicative: true,
        sections: json.sections,
        source: 'Market reference rates — updated via data/plastics.json',
      };
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: 'Plastic rates are temporarily unavailable' });
    }
  }

  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.json({ success: true, data: payload, source: payload.source });
};
