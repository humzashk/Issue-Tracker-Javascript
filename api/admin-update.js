// Admin rate updater — lets the owner publish new plastic/commodity rates
// from a phone in under a minute, without touching GitHub's UI.
//
// Security: requires ADMIN_KEY env var (choose any strong secret) — the key
// is checked server-side. Commits go through GITHUB_TOKEN (fine-grained PAT
// with Contents read/write on this repo only). Neither is ever sent to the
// browser. Vercel auto-redeploys after the commit (~1 minute).
//
// POST /api/admin-update
//   { key: "...", target: "plastics", lines: "PP 125 | 207 | 11500\n..." }
//
// Line format (flexible separators |, comma, or 2+ spaces):
//   <grade name> | <rate per lb> | <bag price>
//   Rate or bag may be "-" / "na" for not available.
//   Grades are matched case-insensitively against existing entries; matched
//   entries update in place, unknown grades are added to an "Others" section.
const OWNER = 'humzashk';
const REPO = 'Issue-Tracker-Javascript';
const FILES = { plastics: 'data/plastics.json' };

function parseLines(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s*\|\s*|\s*,\s*|\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const grade = parts[0];
    const num = v => {
      if (!v || /^(-|n\/?a)$/i.test(v)) return null;
      const n = parseFloat(v.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    out.push({ grade, rate: num(parts[1]), bag: num(parts[2]) });
  }
  return out;
}

async function gh(pathname, opts) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LiveRates-Admin',
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'POST only' });
  }
  const adminKey = process.env.ADMIN_KEY;
  const token = process.env.GITHUB_TOKEN;
  if (!adminKey || !token) {
    return res.status(503).json({
      success: false,
      message: 'Admin updates not configured. Set ADMIN_KEY and GITHUB_TOKEN in Vercel env vars.',
    });
  }

  const { key, target, lines } = req.body ?? {};
  if (!key || key !== adminKey) {
    return res.status(401).json({ success: false, message: 'Wrong admin key' });
  }
  const filePath = FILES[target];
  if (!filePath) {
    return res.status(400).json({ success: false, message: 'Unknown target' });
  }

  const updates = parseLines(lines);
  if (!updates.length) {
    return res.status(400).json({ success: false, message: 'No valid rate lines found' });
  }

  try {
    // read current file (content + sha) from GitHub
    const file = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`);
    const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));

    const today = new Date().toISOString().slice(0, 10);
    let matched = 0;
    const unmatched = [];

    for (const u of updates) {
      let found = false;
      for (const sec of json.sections) {
        for (const item of sec.items) {
          if (item.grade.toLowerCase().replace(/\s+/g, ' ') === u.grade.toLowerCase().replace(/\s+/g, ' ')) {
            if (u.rate != null) item.rate = u.rate;
            if (u.bag != null) item.bag = u.bag;
            found = true;
            matched++;
          }
        }
      }
      if (!found) unmatched.push(u);
    }

    if (unmatched.length) {
      let others = json.sections.find(s => /^others$/i.test(s.title));
      if (!others) { others = { title: 'Others', items: [] }; json.sections.push(others); }
      for (const u of unmatched) {
        others.items.push({ grade: u.grade, rate: u.rate, unit: 'PKR/lb', bag: u.bag });
      }
    }

    json.updated = today;

    await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update ${target} rates (${today}) via admin page`,
        content: Buffer.from(JSON.stringify(json, null, 2) + '\n').toString('base64'),
        sha: file.sha,
      }),
    });

    res.json({
      success: true,
      message: `Updated ${matched} grade(s)${unmatched.length ? `, added ${unmatched.length} new` : ''}. Site redeploys in ~1 minute.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Update failed — check GITHUB_TOKEN permissions' });
  }
};
