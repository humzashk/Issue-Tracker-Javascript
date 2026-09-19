// Daily persistence job for Pakistan Daily Rates history.
//
// Why this exists: api/pakcom.js scrapes live petrol/diesel prices on every
// request and appends "today" to the chart data in memory, but it never
// writes that back to data/pak-commodities.json — the file on disk (and in
// the next deployment) still ends at whatever date it was last committed.
// That's what produced the gap in the chart: a sparse, months-old history
// followed by a single live dot bolted on right at "now". This job is what
// actually closes that gap, once a day, for real.
//
// It is meant to run on a Vercel Cron schedule (see vercel.json → "crons").
// Each run:
//   1. Reads the current data/pak-commodities.json straight from GitHub
//      (so it always commits on top of the latest version, not a stale
//      local copy).
//   2. Scrapes live petrol/diesel via the same multi-source scraper the
//      live card uses.
//   3. Appends (or, if already run today, overwrites) today's point in
//      each item's history, trims history to a sane length, and bumps the
//      "updated" date.
//   4. Commits the result back via the GitHub Contents API — only if
//      something actually changed, so a day with no reachable fuel source
//      doesn't create an empty commit.
//
// Auth: requires CRON_SECRET (Vercel automatically sends it as
// `Authorization: Bearer <CRON_SECRET>` for scheduled invocations) and
// GITHUB_TOKEN (a fine-grained PAT scoped to Contents: Read & write on this
// repo only). Neither is ever exposed to the browser. Without both set,
// this endpoint refuses to run rather than silently doing nothing.
const OWNER = 'humzashk';
const REPO = 'Issue-Tracker-Javascript';
const FILE_PATH = 'data/pak-commodities.json';
const MAX_HISTORY_POINTS = 400; // ~13 months of daily points, plenty for a 30-day forecast

const { getLiveFuel } = require('./_fuel-sources.js');

async function gh(pathname, opts) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LiveRates-Cron',
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization;
  if (header === `Bearer ${secret}`) return true;
  // manual-test convenience: allow ?secret=... from a browser, which can't
  // set a custom Authorization header
  return req.query?.secret === secret;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. This endpoint only runs for Vercel Cron or a matching ?secret=.',
    });
  }
  if (!process.env.GITHUB_TOKEN) {
    return res.status(503).json({
      success: false,
      message: 'GITHUB_TOKEN is not configured — cannot commit history updates.',
    });
  }

  try {
    const file = await gh(`/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`);
    const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));

    const today = new Date().toISOString().slice(0, 10);
    const fuel = await getLiveFuel();

    const energy = json.sections?.find(s => /fuel/i.test(s.title));
    const changes = [];

    if (energy) {
      for (const item of energy.items) {
        const live =
          /petrol/i.test(item.name) ? fuel.petrol :
          /diesel/i.test(item.name) ? fuel.diesel : null;
        if (!live) continue;

        const hist = item.history ?? (item.history = []);
        const last = hist[hist.length - 1];
        const before = item.rate;
        item.rate = live;

        if (!last || last[0] !== today) {
          hist.push([today, live]);
          changes.push(`${item.name}: added ${today} = Rs ${live} (was Rs ${before})`);
        } else if (last[1] !== live) {
          last[1] = live;
          changes.push(`${item.name}: updated ${today} = Rs ${live} (was Rs ${before})`);
        }

        if (hist.length > MAX_HISTORY_POINTS) {
          item.history = hist.slice(hist.length - MAX_HISTORY_POINTS);
        }
      }
    }

    if (!changes.length) {
      return res.json({
        success: true,
        changed: false,
        message: `No new fuel data to persist (fuel source: ${fuel.source ?? 'none reachable'}).`,
      });
    }

    json.updated = today;

    await gh(`/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Daily rate history: ${changes.join('; ')}`,
        content: Buffer.from(JSON.stringify(json, null, 2) + '\n').toString('base64'),
        sha: file.sha,
      }),
    });

    res.json({ success: true, changed: true, changes, fuelSource: fuel.source });
  } catch (err) {
    console.error('cron-update-history failed:', err);
    res.status(500).json({ success: false, message: String(err.message).slice(0, 300) });
  }
};
