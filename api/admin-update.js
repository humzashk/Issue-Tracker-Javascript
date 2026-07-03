// Admin rate updater — publishes new plastics rates from the daily
// Ahmed Enterprises rate-list photo (OCR) or typed lines.
//
// POST /api/admin-update
//   { key, target: "plastics", lines: "PP 125 | 207 | 11500\n..." }   — typed
//   { key, target: "plastics", image: "data:image/jpeg;base64,..." }  — photo (OCR)
//
// Security: ADMIN_KEY checked server-side; GITHUB_TOKEN (fine-grained PAT,
// Contents RW on this repo) commits data/plastics.json; Vercel redeploys.
// OCR: OCR.space — set OCR_API_KEY (free at ocr.space/ocrapi) for reliable
// service; falls back to their public demo key for light use.
const OWNER = 'humzashk';
const REPO = 'Issue-Tracker-Javascript';
const FILES = { plastics: 'data/plastics.json' };

const HEADER_WORDS = /item|price|per\s*pound|per\s*bag|enterprises|do\b|rate\s*list/i;

function toNum(v) {
  if (!v || /^(-|n\/?a)$/i.test(v)) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function classifyNumbers(nums) {
  // bag prices are thousands; per-lb rates are 100-600
  let rate = null, bag = null;
  for (const n of nums) {
    if (n > 1000 && bag == null) bag = n;
    else if (n >= 100 && n <= 600 && rate == null) rate = n;
  }
  return { rate, bag };
}

function parseTypedLines(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s*\|\s*|\s*,\s*|\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    out.push({ grade: parts[0], rate: toNum(parts[1]), bag: toNum(parts[2]) });
  }
  return out;
}

function parseOcrText(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, ' ').trim();
    if (!line || HEADER_WORDS.test(line)) continue;

    // numeric tokens with their positions in the line
    const tokens = [...line.matchAll(/(\d[\d,]*\.?\d*)/g)]
      .map(m => ({ v: toNum(m[1]), idx: m.index }))
      .filter(t => t.v != null);
    if (!tokens.length) continue;

    // last big number = bag price
    const bagTok = [...tokens].reverse().find(t => t.v >= 1500 && t.v <= 60000);
    if (!bagTok) continue; // every real row on the list has a bag price

    // candidate per-lb rate: the number immediately before the bag price.
    // Sanity checksum: a bag is ~55 lb (or 25 kg for /kg items), so the
    // rate must be consistent with bag/55.5 or bag/25 — this is what keeps
    // grade numbers like "Crystal 525" from being mistaken for prices.
    let rate = null;
    let rateTok = null;
    const before = tokens.filter(t => t.idx < bagTok.idx && t.v >= 80 && t.v <= 900);
    if (before.length) {
      const cand = before[before.length - 1];
      // 25-kg bags only apply to per-kg items (line says "kg"); everything
      // else on the list is 55-lb bags
      const divisors = /\/\s*kg|per\s*kg/i.test(line) ? [25] : [55.5];
      for (const divisor of divisors) {
        const expected = bagTok.v / divisor;
        if (Math.abs(cand.v - expected) / expected <= 0.18) {
          rate = cand.v;
          rateTok = cand;
          break;
        }
      }
    }

    // grade = text before the first consumed price token
    const cutIdx = rateTok ? rateTok.idx : bagTok.idx;
    let grade = line.slice(0, cutIdx).replace(/[|:;,\s]+$/, '').trim();
    if (grade.length < 2 || grade.length > 40) continue;

    out.push({ grade, rate, bag: bagTok.v });
  }
  return out;
}

async function runOcr(imageBase64) {
  const form = new URLSearchParams();
  form.set('base64Image', imageBase64);
  form.set('apikey', process.env.OCR_API_KEY || 'helloworld');
  form.set('OCREngine', '2');
  form.set('isTable', 'true');
  form.set('scale', 'true');

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`OCR service: ${res.status}`);
  const json = await res.json();
  if (json.IsErroredOnProcessing) {
    throw new Error(`OCR failed: ${json.ErrorMessage?.[0] ?? 'unknown error'}`);
  }
  return json?.ParsedResults?.map(r => r.ParsedText).join('\n') ?? '';
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

function normalizeGrade(g) {
  return g.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

  const { key, target, lines, image } = req.body ?? {};
  if (!key || key !== adminKey) {
    return res.status(401).json({ success: false, message: 'Wrong admin key' });
  }
  const filePath = FILES[target];
  if (!filePath) {
    return res.status(400).json({ success: false, message: 'Unknown target' });
  }

  let updates;
  try {
    if (image) {
      const text = await runOcr(image);
      updates = parseOcrText(text);
      if (!updates.length) {
        return res.status(422).json({
          success: false,
          message: 'OCR read the image but found no rate lines — try a clearer/straighter photo, or type the rates instead.',
        });
      }
    } else {
      updates = parseTypedLines(lines);
      if (!updates.length) {
        return res.status(400).json({ success: false, message: 'No valid rate lines found' });
      }
    }
  } catch (err) {
    console.error(err);
    return res.status(502).json({ success: false, message: String(err.message).slice(0, 160) });
  }

  try {
    const file = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`);
    const json = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));

    const today = new Date().toISOString().slice(0, 10);
    let matched = 0;
    const unmatched = [];

    for (const u of updates) {
      let found = false;
      const uNorm = normalizeGrade(u.grade);
      for (const sec of json.sections) {
        for (const item of sec.items) {
          const iNorm = normalizeGrade(item.grade);
          if (iNorm === uNorm || iNorm.includes(uNorm) || uNorm.includes(iNorm)) {
            if (u.rate != null) item.rate = u.rate;
            if (u.bag != null) item.bag = u.bag;
            found = true;
            matched++;
            break;
          }
        }
        if (found) break;
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
        message: `Update ${target} rates (${today}) via admin ${image ? 'photo OCR' : 'page'}`,
        content: Buffer.from(JSON.stringify(json, null, 2) + '\n').toString('base64'),
        sha: file.sha,
      }),
    });

    const summary = updates.slice(0, 6).map(u => `${u.grade}: ${u.rate ?? '—'}`).join(', ');
    res.json({
      success: true,
      message: `Read ${updates.length} items (${matched} matched${unmatched.length ? `, ${unmatched.length} new` : ''}): ${summary}${updates.length > 6 ? '…' : ''}. Site redeploys in ~1 minute.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Update failed — check GITHUB_TOKEN permissions' });
  }
};
