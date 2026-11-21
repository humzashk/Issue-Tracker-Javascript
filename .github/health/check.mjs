// LiveRates daily health check — runs on GitHub Actions (free for public
// repositories), stores nothing.
//
// It opens the live site the way a visitor would, asks every endpoint for its
// debug details, and checks that each rate is present, fresh and sensible.
// If anything is wrong it opens ONE GitHub issue ("🩺 LiveRates health
// check") with a plain-English list of problems and how to fix them, keeps
// that issue up to date, and closes it by itself once everything is fine
// again. GitHub emails the repository owner when the issue opens or changes.
//
// Run it by hand: Actions tab → "Site health check" → Run workflow.
// Locally (read-only, no issue): node .github/health/check.mjs

import { createHash } from 'crypto';

const SITE = process.env.SITE_URL || 'https://issue-tracker-javascript.vercel.app';
const REPO = process.env.GITHUB_REPOSITORY;       // "owner/name", set by Actions
const TOKEN = process.env.GITHUB_TOKEN;
const TITLE = '🩺 LiveRates health check';
const DAY = 86400000;

const todayPK = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
const ageDays = ymd => (ymd ? Math.floor((Date.parse(todayPK()) - Date.parse(ymd)) / DAY) : Infinity);

const problems = [];   // { level: 'broken' | 'degraded' | 'action', area, what, fix }
const okNotes = [];
const add = (level, area, what, fix) => problems.push({ level, area, what, fix });

async function getJSON(path) {
  const t = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(`${SITE}${path}${path.includes('?') ? '&' : '?'}health=${Date.now()}`, { signal: ctrl.signal });
      clearTimeout(timer);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success) return { ok: true, body, ms: Date.now() - t };
      if (attempt === 3) return { ok: false, status: res.status, body, ms: Date.now() - t };
    } catch (e) {
      if (attempt === 3) return { ok: false, status: 0, error: e.message, ms: Date.now() - t };
    }
    await new Promise(r => setTimeout(r, 15000 * attempt)); // a cold start or a blip
  }
}

const failed = (area, r) => add('broken', area,
  `The endpoint answered ${r.status || 'nothing'}${r.error ? ` (${r.error})` : ''}${r.body?.message ? ` — "${r.body.message}"` : ''}.`,
  'Usually a source website was down or changed. Wait a day; if it persists, open the endpoint with `?debug=1` (see MAINTENANCE.md).');

// ── checks ───────────────────────────────────────────────────────────────────

async function checkPage() {
  const res = await fetch(`${SITE}/?health=${Date.now()}`).catch(e => ({ ok: false, status: 0, e }));
  const html = res.ok ? await res.text() : '';
  if (!res.ok || !/js\/app\.js\?v=\d+/.test(html)) {
    add('broken', 'Website', `The home page did not load properly (HTTP ${res.status}).`,
      'Check the Vercel dashboard (vercel.com → project → Deployments) for a failed deployment; "Promote" the last good one to roll back.');
  } else okNotes.push('Home page loads');
}

async function checkDailyRates() {
  const r = await getJSON('/api/pakcom?debug=1');
  if (!r.ok) return failed('Daily Rates', r);
  const d = r.body.data, dbg = r.body.debug ?? {};
  if (!d.official) {
    add('degraded', 'Daily Rates', `PBS could not be read, so the card shows the saved snapshot from ${d.updated}.`,
      'PBS (pbs.gov.pk) may be down. If this lasts more than a few days, PBS may have renamed its weekly Excel files — see MAINTENANCE.md › Daily Rates.');
  } else {
    const age = ageDays(d.updated);
    if (age > 13) add('degraded', 'Daily Rates', `The newest PBS week is ${d.updated} (${age} days old). PBS normally publishes every Thursday/Friday.`,
      'Check pbs.gov.pk › What\'s New for the latest "Weekly Sensitive Price Indicator" post. If it exists but the site misses it, the file naming changed.');
    else okNotes.push(`Daily Rates: PBS week ${d.updated}`);
    const weeks = d.sections?.[2]?.items?.[0]?.history?.length ?? 0;
    if (weeks < 40) add('degraded', 'Daily Rates', `Only ${weeks} weeks of history were loaded (normally ~50).`, 'Usually temporary (slow PBS downloads). Ignore unless it repeats for several days.');
  }
  const items = (d.sections ?? []).flatMap(s => s.items ?? []);
  if (items.length < 24) add('degraded', 'Daily Rates', `Only ${items.length} of 26 items came back.`, 'PBS may have renamed an item. Compare the names in api/pakcom.js (CATALOG) with the latest PBS annex.');

  const fuel = dbg.fuel ?? {};
  if (!d.liveFuel) {
    add('broken', 'Fuel prices', 'No fuel website could be read — petrol and diesel show PBS\'s weekly figure instead of today\'s price.',
      'All five fuel sites changed or are down. See MAINTENANCE.md › Fuel to update a parser in api/_fuel-sources.js.');
  } else {
    const working = (fuel.results ?? []).filter(x => x.petrol && x.diesel).map(x => x.name);
    const dead = (fuel.results ?? []).filter(x => !(x.petrol && x.diesel)).map(x => `${x.name} (${x.error || 'layout changed?'})`);
    if (!fuel.effective) add('degraded', 'Fuel prices', `Only PSO answered; its page has no date and can lag a day. Not working: ${dead.join(', ')}.`,
      'The dated fuel sites changed their layout. See MAINTENANCE.md › Fuel.');
    else if (working.length < 2) add('degraded', 'Fuel prices', `Only one fuel source works (${working.join(', ')}); there is nothing to cross-check it against. Not working: ${dead.join(', ')}.`,
      'Not urgent, but the next layout change would break fuel. See MAINTENANCE.md › Fuel.');
    else okNotes.push(`Fuel: Rs ${fuel.petrol} / ${fuel.diesel} from ${fuel.effective} (${working.length} sources)`);
    if (fuel.effective && ageDays(fuel.effective) > 20) add('degraded', 'Fuel prices', `The newest fuel price found is from ${fuel.effective} (${ageDays(fuel.effective)} days ago).`,
      'Prices are normally revised at least every 2 weeks — the sources may have stopped updating.');
  }
  if ((dbg.fuelRejected ?? []).length) add('degraded', 'Fuel prices', `A live fuel price was rejected as implausible: ${JSON.stringify(dbg.fuelRejected)}.`,
    'A source may be showing a wrong number. Check the fuel sites listed in api/_fuel-sources.js.');
}

async function checkMarkets() {
  const c = await getJSON('/api/commodities?debug=1');
  if (!c.ok) failed('Gold & oil', c);
  else {
    const gold = c.body.data.find(x => x.id === 'gold');
    const oil = c.body.data.filter(x => x.id.startsWith('oil'));
    if (!gold) add('broken', 'Gold', 'No gold price at all.', 'See MAINTENANCE.md › Gold.');
    else if (gold.basis === 'spot') add('broken', 'Gold', 'Gold & silver show the converted international price — no Pakistani rate could be read.',
      'Business Recorder\'s feed and both dealer sites failed. See MAINTENANCE.md › Gold.');
    else if (gold.basis === 'dealers')
      add('degraded', 'Gold', 'Gold shows dealer boards, not the official Sarafa Association rate (none found in the last 3 days).',
        'Business Recorder may have changed how it words the daily gold story. See MAINTENANCE.md › Gold.');
    else okNotes.push(`Gold: ${gold.price} (${gold.source})`);
    if (oil.length < 2) add('degraded', 'Oil', 'Brent or WTI is missing.', 'CNBC/Yahoo/Stooq feeds may have changed. See api/commodities.js.');
  }

  const fx = await getJSON('/api/forex');
  if (!fx.ok) failed('Currency', fx);
  else {
    const usd = fx.body.data.usdToPkr;
    if (!(usd > 150 && usd < 600)) add('broken', 'Currency', `USD→PKR looks wrong: ${usd}.`, 'open.er-api.com may be returning bad data.');
    else okNotes.push(`USD/PKR ${usd.toFixed(2)}`);
  }

  const ps = await getJSON('/api/psx');
  if (!ps.ok) failed('PSX', ps);
  else if (ageDays(new Date(ps.body.data.asOf).toISOString().slice(0, 10)) > 6)
    add('degraded', 'PSX', `KSE-100 data is from ${new Date(ps.body.data.asOf).toISOString().slice(0, 10)}.`, 'PSX may have changed its data portal. See api/psx.js.');
  else okNotes.push(`KSE-100 ${ps.body.data.value}`);

  for (const [ep, name] of [['/api/crypto', 'Crypto'], ['/api/mood', 'Market mood']]) {
    const r = await getJSON(ep);
    if (!r.ok) failed(name, r); else okNotes.push(`${name} OK`);
  }
}

async function checkKarachi() {
  const k = await getJSON('/api/karachi?debug=1');
  if (!k.ok) return failed('Karachi', k);
  const p = k.body.data.prayer, w = k.body.data.weather;
  if (!p?.timings?.length) add('broken', 'Prayer times', 'No prayer times.', 'api.aladhan.com may be down.');
  else if (p.source !== 'dawateislami') add('degraded', 'Prayer times', 'Showing calculated times — the Dawat-e-Islami timetable couldn\'t be read.',
    'Their page layout may have changed (api/karachi.js › parseDawateIslami). The calculated Hanafi times are a close fallback, so this is not urgent.');
  else okNotes.push('Prayer times: Dawat-e-Islami');
  if (!w?.days?.length) add('broken', 'Weather', 'No forecast.', 'api.open-meteo.com may be down.');

  const u = await getJSON('/api/utilities?debug=1');
  if (!u.ok) return failed('Power & Gas', u);
  const power = u.body.data.power, gas = u.body.data.gas;
  if (!power) add('broken', 'Load-shedding', 'K-Electric\'s schedule couldn\'t be read and there is no saved copy.', 'See MAINTENANCE.md › Load-shedding.');
  else if (power.source !== 'live') add('degraded', 'Load-shedding', `Showing the saved K-Electric schedule (from ${power.effective}) — KE's page or PDF couldn't be read.`,
    'KE may have changed its page. Open ke.com.pk/load-shed-schedule and see MAINTENANCE.md › Load-shedding.');
  else okNotes.push(`Load-shedding: ${power.feeders.length} feeders, KE schedule from ${power.effective}`);
  if (gas?.changed) add('action', 'Gas hours', `SSGC has posted a new notice: ${gas.notice}`,
    'Open the picture, then update the times (and dates) in data/utilities.json — step by step in MAINTENANCE.md › Gas hours. Until then the card warns visitors.');
  if (gas?.validUntil && todayPK() > gas.validUntil) add('action', 'Gas hours', `The saved gas schedule ended on ${gas.validUntil}; the card now tells visitors to check SSGC.`,
    'When SSGC announces new hours, put them in data/utilities.json with a new validUntil (MAINTENANCE.md › Gas hours).');
  else if (gas?.validUntil && ageDays(gas.validUntil) > -7) add('action', 'Gas hours', `The saved gas schedule ends on ${gas.validUntil} (within a week).`,
    'Watch SSGC for the next schedule and update data/utilities.json.');
}

async function checkEntertainment() {
  for (const [ep, name] of [['/api/movies', 'Movies'], ['/api/music', 'Global music'], ['/api/music-pk', 'Pakistan music']]) {
    const r = await getJSON(ep);
    if (!r.ok) add('degraded', name, `${name} didn't load (HTTP ${r.status}).`, 'Chart sources change often; this only affects the Entertainment tab.');
  }
}

// ── GitHub issue ─────────────────────────────────────────────────────────────

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${opts.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const ICON = { broken: '🔴', degraded: '🟡', action: '🛠️' };
const LABEL = { broken: 'Broken', degraded: 'Working, but degraded', action: 'Needs a small manual update' };

function report() {
  const order = ['broken', 'action', 'degraded'];
  const sections = order.filter(l => problems.some(p => p.level === l)).map(l =>
    `### ${ICON[l]} ${LABEL[l]}\n\n` + problems.filter(p => p.level === l).map(p => `- **${p.area}** — ${p.what}\n  - 👉 ${p.fix}`).join('\n'));
  return [
    `_Checked ${new Date().toUTCString()} by the daily health check. This issue updates itself and closes automatically once everything is fine._`,
    ...sections,
    `<details><summary>✅ Working (${okNotes.length})</summary>\n\n${okNotes.map(n => `- ${n}`).join('\n')}\n</details>`,
    'How to fix things: see [MAINTENANCE.md](../blob/master/MAINTENANCE.md). Run the check again: Actions → "Site health check" → Run workflow.',
  ].join('\n\n');
}

async function updateIssue() {
  const open = (await gh(`/issues?state=open&per_page=50&creator=github-actions%5Bbot%5D`)).find(i => i.title === TITLE);
  const fingerprint = problems.map(p => `${p.level}:${p.area}:${p.what.replace(/\d[\d.,:-]*/g, '#')}`).sort().join('|');
  const marker = `<!-- fp:${createHash('sha1').update(fingerprint).digest('hex')} -->`;

  if (!problems.length) {
    if (open) {
      await gh(`/issues/${open.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ All checks pass again (${new Date().toUTCString()}). Closing.` }) });
      await gh(`/issues/${open.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      console.log(`closed #${open.number}`);
    }
    return;
  }
  const body = `${report()}\n\n${marker}`;
  if (!open) {
    const created = await gh('/issues', { method: 'POST', body: JSON.stringify({ title: TITLE, body }) });
    console.log(`opened #${created.number}`);
  } else {
    const changed = !open.body?.includes(marker);
    await gh(`/issues/${open.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    // a comment (= an email) only when the list of problems actually changes
    if (changed) await gh(`/issues/${open.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `🔄 The list of problems changed:\n\n${problems.map(p => `- ${ICON[p.level]} **${p.area}** — ${p.what}`).join('\n')}` }) });
    console.log(`updated #${open.number}${changed ? ' (changed)' : ''}`);
  }
}

// GitHub turns off scheduled workflows in public repositories after 60 days
// without a commit. Re-enabling this workflow through the API resets that
// clock, so the check keeps running while nobody is touching the code.
async function keepAlive() {
  try {
    await gh('/actions/workflows/health.yml/enable', { method: 'PUT' });
    console.log('keep-alive: workflow re-enabled');
  } catch (e) {
    console.log('keep-alive skipped:', e.message.slice(0, 120));
  }
}

await checkPage();
await checkDailyRates();
await checkMarkets();
await checkKarachi();
await checkEntertainment();

console.log(`\n${problems.length ? report() : '✅ Everything works.\n\n' + okNotes.map(n => `- ${n}`).join('\n')}\n`);
if (REPO && TOKEN) {
  await updateIssue();
  await keepAlive();
}
// a red ❌ in the Actions tab only for real breakage, not for degraded states
process.exitCode = problems.some(p => p.level === 'broken') ? 1 : 0;
