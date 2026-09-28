// Daily recorder for the Daily Rates card.
//
// Runs once a day from GitHub Actions (.github/workflows/record-daily-rates.yml).
// It fetches live petrol and diesel prices with the same scraper the site
// uses, appends today's point to each item's history in
// data/pak-commodities.json, and the workflow commits the file — which
// redeploys the site. This is what makes the charts fill in day by day:
// the site itself has no storage, so without this every live price is
// forgotten as soon as the page is closed.
//
// Only items with a live source are recorded. Nothing is carried forward
// or estimated for the others — a gap in the chart means no new data.
//
//   node scripts/record-daily-rates.js           # update the file
//   node scripts/record-daily-rates.js --dry-run # print what would change
const fs = require('fs');
const path = require('path');
const { getLiveFuel } = require('../api/_fuel-sources.js');

const FILE = path.join(__dirname, '..', 'data', 'pak-commodities.json');
const MAX_POINTS = 400;

const karachiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

// Pure: apply live values to the data, return a list of what changed.
function recordLive(json, live, today) {
  const changes = [];
  for (const sec of json.sections ?? []) {
    for (const item of sec.items ?? []) {
      const value =
        /petrol/i.test(item.name) ? live.petrol :
        /diesel/i.test(item.name) ? live.diesel : null;
      if (value == null) continue;

      const hist = item.history ?? (item.history = []);
      const last = hist[hist.length - 1];
      if (last && last[0] === today) {
        if (last[1] === value) continue;
        last[1] = value;
      } else {
        hist.push([today, value]);
      }
      if (hist.length > MAX_POINTS) hist.splice(0, hist.length - MAX_POINTS);
      item.rate = value;
      item.updated = today;
      changes.push(`${item.name}: ${value}`);
    }
  }
  return changes;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const fuel = await getLiveFuel();
  console.log('sources:', fuel.results.map(r => `${r.name}=${r.error ?? `${r.petrol}/${r.diesel}`}`).join(' | '));

  const changes = recordLive(json, fuel, karachiToday());
  if (!changes.length) {
    console.log('nothing to record (no live value, or unchanged today)');
    return;
  }
  console.log(`recorded via ${fuel.source}: ${changes.join(', ')}`);
  if (!dryRun) fs.writeFileSync(FILE, JSON.stringify(json, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { recordLive };
