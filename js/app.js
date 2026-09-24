'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

// Escape any external/API-sourced string before it goes into innerHTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Only allow https URLs in src attributes
function safeUrl(u) {
  return typeof u === 'string' && /^https:\/\//i.test(u) ? esc(u) : '';
}

function fmtPrice(n, digits) {
  if (n == null) return '—';
  const d = digits != null ? digits : n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPKR(n) {
  if (n == null) return '—';
  const d = n < 1000 ? 2 : 0;
  return 'Rs ' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtChange(pct) {
  if (pct == null) return '';
  const cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
  return `<span class="${cls}">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>`;
}

// Shared ▲/▼ delta badge. Rounds to 2dp first (raw floating-point subtraction
// like 389.14 - 299.5 produces 89.63999999999999, which must not reach the
// screen). `invert` flips the color meaning for cost-of-living items, where
// a price going UP is bad for the buyer (red) rather than good (green) —
// crypto/gold/oil use invert:false (up = green, the usual market convention);
// Pakistan Daily Rates uses invert:true (up = red).
function fmtDeltaBadge(delta, { pct = null, invert = false } = {}) {
  if (delta == null || !Number.isFinite(delta)) return '';
  const rounded = Math.round(delta * 100) / 100;
  if (Math.abs(rounded) < 0.005) return '<span class="neutral">— 0</span>';
  const up = rounded > 0;
  const cls = (invert ? !up : up) ? 'positive' : 'negative';
  const arrow = up ? '▲' : '▼';
  const shown = Math.abs(rounded) % 1 === 0 ? Math.abs(rounded).toFixed(0) : Math.abs(rounded).toFixed(2);
  const pctStr = pct != null && Number.isFinite(pct) ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)` : '';
  return `<span class="${cls}">${arrow} ${shown}${pctStr}</span>`;
}

function setHTML(id, html) {
  const t = el(id);
  if (t) t.innerHTML = html;
}

function showLoading(id) {
  setHTML(id, '<div class="skeleton"><span></span><span></span><span></span></div>');
}

function showError(id, msg) {
  setHTML(id, `<div class="error-state"><span class="error-icon">⚠️</span><p class="error-message">${esc(msg)}</p></div>`);
}

async function apiFetch(endpoint) {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'API error');
  return json.data;
}

const state = { crypto: null, commodities: null, forex: null };

// ── Profile / gamification engine ─────────────────────────────────────────────

const PROFILE_KEY = 'liverates_profile';

const LEVELS = [
  { xp: 0,    name: 'Rookie' },
  { xp: 50,   name: 'Trader' },
  { xp: 150,  name: 'Analyst' },
  { xp: 300,  name: 'Strategist' },
  { xp: 500,  name: 'Whale' },
  { xp: 800,  name: 'Oracle' },
  { xp: 1200, name: 'Legend' },
];

const ACHIEVEMENTS = {
  firstWin:   { emoji: '🩸', title: 'First Blood',   sub: 'Your first correct prediction' },
  streak3:    { emoji: '🔥', title: 'On Fire',       sub: '3 correct predictions in a row' },
  streak7:    { emoji: '🧙', title: 'Market Oracle', sub: '7 correct predictions in a row' },
  points100:  { emoji: '💯', title: 'Centurion',     sub: 'Reached 100 points' },
  nightOwl:   { emoji: '🦉', title: 'Night Owl',     sub: 'Checking markets after midnight' },
  visits3:    { emoji: '📅', title: 'Regular',       sub: '3-day visit streak' },
  zen:        { emoji: '🧘', title: 'Zen Master',    sub: 'Found your inner peace' },
  themer:     { emoji: '🎨', title: 'Decorator',     sub: 'Changed the theme' },
  confetti:   { emoji: '🎉', title: 'Party Animal',  sub: 'Found the hidden confetti' },
  konami:     { emoji: '🕹️', title: 'Cheat Code',    sub: '↑↑↓↓←→←→BA — old school respect' },
  moon:       { emoji: '🚀', title: 'To The Moon',   sub: 'You typed the magic word' },
  patriot:    { emoji: '🇵🇰', title: 'Pakistan Zindabad', sub: 'Searched for the homeland' },
  diamond:    { emoji: '💎', title: 'Diamond Hands', sub: 'Tapped BTC 5 times — never selling' },
  chai:       { emoji: '☕', title: 'Chai Lover',     sub: 'Kaam se pehle chai — priorities sahi hain' },
  biryani:    { emoji: '🍛', title: 'Biryani Ka Baap', sub: 'Aloo wali ya bina aloo? Jang chhir gayi' },
  paisa:      { emoji: '💸', title: 'Paisa Paisa',   sub: 'Paisa hi paisa hoga — khwaab mein' },
  impatient:  { emoji: '😮‍💨', title: 'Sabar Ka Phal',  sub: 'Refresh spam kiya — rate phir bhi wahi' },
  sleepy:     { emoji: '😴', title: 'So Gaye?',      sub: 'Screen khuli chhor ke ghayab ho gaye' },
  roasted:    { emoji: '🔥', title: 'Bezti Collector', sub: 'Banter pe click kar ke apni bezti mangi' },
  boom:       { emoji: '💥', title: 'Boom Boom',     sub: 'Shahid Afridi vibes' },
};

function loadProfile() {
  try {
    return Object.assign(
      {
        xp: 0, points: 0, wins: 0, losses: 0,
        winStreak: 0, bestStreak: 0,
        lastVisit: null, visitStreak: 0,
        achievements: [], theme: 'midnight',
      },
      JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}')
    );
  } catch {
    return { xp: 0, points: 0, wins: 0, losses: 0, winStreak: 0, bestStreak: 0, lastVisit: null, visitStreak: 0, achievements: [], theme: 'midnight' };
  }
}

const profile = loadProfile();

function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
}

function levelFor(xp) {
  let lvl = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) lvl = i;
  return lvl;
}

function renderLevel() {
  const lvl = levelFor(profile.xp);
  const cur = LEVELS[lvl];
  const next = LEVELS[lvl + 1];
  el('levelLabel').textContent = `Lv ${lvl + 1} · ${cur.name}`;
  const pct = next ? Math.min(100, ((profile.xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100;
  el('xpFill').style.width = pct + '%';
  el('streakCount').textContent = profile.visitStreak || 1;
  el('gamePoints').textContent = `${profile.points} pts`;
}

function awardXP(n) {
  const before = levelFor(profile.xp);
  profile.xp += n;
  const after = levelFor(profile.xp);
  saveProfile();
  renderLevel();
  if (after > before) {
    toast('⬆️', 'Level Up!', `You are now a ${LEVELS[after].name}`);
    chime(660, 880);
  }
}

function unlock(id) {
  if (profile.achievements.includes(id)) return;
  profile.achievements.push(id);
  saveProfile();
  const a = ACHIEVEMENTS[id];
  if (a) {
    toast(a.emoji, `Achievement: ${a.title}`, a.sub);
    chime(523, 784);
  }
}

function trackVisit() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  if (profile.lastVisit !== today) {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
    profile.visitStreak = profile.lastVisit === yesterday ? (profile.visitStreak || 0) + 1 : 1;
    profile.lastVisit = today;
    saveProfile();
    awardXP(5);
    if (profile.visitStreak >= 3) unlock('visits3');
  }
  const hour = parseInt(new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', hour12: false }), 10);
  if (hour >= 0 && hour < 5) unlock('nightOwl');
}

// ── Toasts & sound ────────────────────────────────────────────────────────────

function toast(emoji, title, sub) {
  const stack = el('toastStack');
  if (!stack) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="toast-emoji">${emoji}</span><div><div class="toast-title">${title}</div><div class="toast-sub">${sub}</div></div>`;
  stack.appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 400);
  }, 4200);
}

function chime(f1, f2) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [f1, f2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.55);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}

// ── Sparklines ────────────────────────────────────────────────────────────────

function sparklineSVG(prices, up) {
  if (!prices?.length) return '';
  const step = Math.max(1, Math.floor(prices.length / 40));
  const pts = prices.filter((_, i) => i % step === 0);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const W = 100, H = 30;
  const coords = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - 2 - ((p - min) / range) * (H - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = up ? 'var(--green)' : 'var(--red)';
  return `
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polygon class="spark-fill" fill="${color}" points="0,${H} ${coords.join(' ')} ${W},${H}"/>
      <polyline stroke="${color}" points="${coords.join(' ')}"/>
    </svg>`;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderCrypto(data) {
  if (!data?.length) { showError('crypto-content', 'No data returned'); return; }

  const items = data.map(c => {
    const spark = c.sparkline_in_7d?.price;
    const up = spark?.length ? spark[spark.length - 1] >= spark[0] : (c.price_change_percentage_24h ?? 0) >= 0;
    return `
    <div class="crypto-item">
      <div class="crypto-top">
        <div class="crypto-info">
          <img class="crypto-img" src="${safeUrl(c.image)}" alt="" width="30" height="30" loading="lazy">
          <div>
            <div class="crypto-symbol">${esc(c.symbol)}</div>
            <div class="crypto-name">${esc(c.name)}</div>
          </div>
        </div>
        <div class="crypto-price-group">
          <div class="crypto-price">${c.currency === 'PKR' ? fmtPKR(c.current_price) : fmtPrice(c.current_price)}</div>
          ${c.usd_price != null ? `<div class="crypto-price-usd">${fmtPrice(c.usd_price, 2)}</div>` : ''}
          <div class="crypto-change">${fmtChange(c.price_change_percentage_24h)}</div>
        </div>
      </div>
      ${sparklineSVG(spark, up)}
    </div>`;
  }).join('');

  setHTML('crypto-content', `<div class="crypto-grid">${items}</div>`);
}

// Gold/Silver/Copper/Oil have no server-side history (unlike Pakistan Daily
// Rates, which is backed by a committed JSON file), so day-over-day change
// is tracked client-side: one price point per calendar day (Asia/Karachi),
// kept in localStorage. This needs no backend, no secrets, and no cron —
// it just quietly builds up a real day-over-day record in each visitor's
// own browser, and shows nothing extra until there are at least two days
// of data to compare.
const COMMODITY_HISTORY_KEY = 'lr_commodity_history';
const COMMODITY_HISTORY_MAX = 120;

function karachiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

function loadCommodityHistory() {
  try { return JSON.parse(localStorage.getItem(COMMODITY_HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function saveCommodityHistory(hist) {
  try { localStorage.setItem(COMMODITY_HISTORY_KEY, JSON.stringify(hist)); } catch {}
}

// Records today's price (once per day, per id) and returns the previous
// day's recorded price for that id, or null if there isn't one yet.
function trackCommodityDay(id, price) {
  if (price == null) return null;
  const hist = loadCommodityHistory();
  const arr = hist[id] ?? (hist[id] = []);
  const today = karachiToday();
  const last = arr[arr.length - 1];

  let prev = null;
  if (!last || last[0] !== today) {
    prev = last ? last[1] : null;
    arr.push([today, price]);
    if (arr.length > COMMODITY_HISTORY_MAX) hist[id] = arr.slice(arr.length - COMMODITY_HISTORY_MAX);
    saveCommodityHistory(hist);
  } else {
    prev = arr.length > 1 ? arr[arr.length - 2][1] : null;
  }
  return prev;
}

function renderCommodities(data) {
  if (!data?.length) { showError('commodities-content', 'No data returned'); return; }

  const icons = { gold: '🥇', silver: '🥈', copper: '🟤', 'oil-brent': '🛢️', 'oil-wti': '🛢️' };

  let anyDelta = false;
  const items = data.map(c => {
    const prev = trackCommodityDay(c.id, c.price);
    const delta = prev != null && c.price != null ? c.price - prev : null;
    const pct = delta != null && prev ? (delta / prev) * 100 : null;
    if (delta != null) anyDelta = true;
    return `
    <div class="row">
      <div class="row-main">
        <span class="row-icon">${icons[c.id] || '📊'}</span>
        <div>
          <div class="row-label">${esc(c.name)}</div>
          <div class="row-sub">${esc(c.unit)}${c.source ? ` · ${esc(c.source)}` : ''}</div>
        </div>
      </div>
      <div class="row-value">
        <div class="row-price">${c.currency === 'PKR' ? fmtPKR(c.price) : fmtPrice(c.price, 2)}</div>
        ${delta != null ? `<div class="row-change">${fmtDeltaBadge(delta, { pct })}</div>` : ''}
      </div>
    </div>
  `;
  }).join('');

  const goldLive = data.find(c => c.id === 'gold')?.live;
  const note = goldLive
    ? '<span class="badge-live">●</span>Gold &amp; silver: gold.pk local market (per tola, PKR)'
    : '<span class="badge-indicative">◆</span>gold.pk unreachable — gold &amp; silver from international spot, converted';
  const deltaNote = anyDelta ? ' · ▲▼ vs the last day this browser saw' : '';

  setHTML('commodities-content', `<div class="list">${items}</div><div class="meta">${note}${deltaNote}</div>`);
}

function renderMood(data) {
  if (!data || data.value == null) { showError('mood-content', 'No index data'); return; }

  const v = data.value;
  const angle = (v / 100) * 180 - 90;
  const color = v < 25 ? 'var(--red)' : v < 45 ? '#fb923c' : v < 55 ? 'var(--yellow)' : v < 75 ? '#a3e635' : 'var(--green)';
  const emoji = v < 25 ? '😨' : v < 45 ? '😟' : v < 55 ? '😐' : v < 75 ? '🙂' : '🤑';
  const delta = data.yesterdayValue != null ? v - data.yesterdayValue : null;

  setHTML('mood-content', `
    <div class="mood-wrap">
      <div class="gauge">
        <div class="gauge-dial"></div>
        <div class="gauge-needle" style="transform: rotate(${angle}deg)"></div>
        <div class="gauge-hub"></div>
      </div>
      <div class="mood-value" style="color:${color}">${v} ${emoji}</div>
      <div class="mood-label" style="color:${color}">${esc(data.label)}</div>
      ${delta != null ? `<div class="mood-delta">${delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} ${Math.abs(delta)} vs yesterday</div>` : ''}
    </div>
  `);
}

function renderRanked(id, data) {
  if (!data?.length) { setHTML(id, '<p class="empty-message">No data available.</p>'); return; }

  const items = data.map((item, i) => `
    <div class="ranked-item">
      <span class="ranked-num${i < 3 ? ' top3' : ''}">${i + 1}</span>
      ${safeUrl(item.image) ? `<img class="ranked-thumb" src="${safeUrl(item.image)}" alt="" width="36" height="36" loading="lazy">` : ''}
      <div class="ranked-info">
        <div class="ranked-title">${esc(item.title)}</div>
        ${item.subtitle ? `<div class="ranked-sub">${esc(item.subtitle)}</div>` : ''}
      </div>
      ${safeUrl(item.preview) ? `<button class="play-btn" data-preview="${safeUrl(item.preview)}" aria-label="Play 30s preview">▶</button>` : ''}
    </div>
  `).join('');

  setHTML(id, `<div class="ranked-list">${items}</div>`);
}

// Converter sits on top of the currency list. On a background refresh the
// inputs are left alone (so a half-typed amount isn't wiped) — only the rate
// and the computed side are updated.
function renderCurrency(data) {
  if (!data?.usdToPkr) { showError('currency-content', 'Rates unavailable'); return; }
  state.forex = data;

  const rows = (data.currencies ?? []).map(c => `
    <div class="row">
      <div class="row-main">
        <span class="row-icon">${c.flag || '💱'}</span>
        <div>
          <div class="row-label">${esc(c.code)}</div>
          <div class="row-sub">${esc(c.name)}</div>
        </div>
      </div>
      <div class="row-value"><div class="row-price">${fmtPKR(c.pkr)}</div></div>
    </div>`).join('');

  const rateLine = `1 USD = <strong>${data.usdToPkr.toFixed(2)} PKR</strong>`;

  if (el('convUsd')) {
    el('convRate').innerHTML = rateLine;
    el('currencyList').innerHTML = rows;
    el('convUsd').dispatchEvent(new Event('input'));
    return;
  }

  setHTML('currency-content', `
    <div class="conv">
      <div class="conv-field"><label for="convUsd">USD</label><input class="conv-input" id="convUsd" type="number" inputmode="decimal" value="1"></div>
      <button class="conv-swap" id="convSwap" title="Swap" aria-label="Swap">⇄</button>
      <div class="conv-field"><label for="convPkr">PKR</label><input class="conv-input" id="convPkr" type="number" inputmode="decimal"></div>
    </div>
    <div class="conv-rate" id="convRate">${rateLine}</div>
    <div class="list" id="currencyList">${rows}</div>
  `);

  const usd = el('convUsd'), pkr = el('convPkr');
  usd.addEventListener('input', () => {
    const v = parseFloat(usd.value);
    pkr.value = Number.isFinite(v) ? (v * state.forex.usdToPkr).toFixed(2) : '';
  });
  pkr.addEventListener('input', () => {
    const v = parseFloat(pkr.value);
    usd.value = Number.isFinite(v) ? (v * state.forex.pkrToUsd).toFixed(4) : '';
  });
  el('convSwap').addEventListener('click', () => {
    const a = usd.value;
    usd.value = pkr.value;
    pkr.value = a;
    usd.dispatchEvent(new Event('input'));
  });
  usd.dispatchEvent(new Event('input'));
}

// ── Audio previews (30s) ─────────────────────────────────────────────────────

let audioEl = null;
let playingBtn = null;

function stopPreview() {
  if (audioEl) audioEl.pause();
  if (playingBtn) { playingBtn.textContent = '▶'; playingBtn.classList.remove('playing'); }
  playingBtn = null;
}

function togglePreview(btn) {
  if (playingBtn === btn) { stopPreview(); return; }
  stopPreview();
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.volume = 0.85;
    audioEl.addEventListener('ended', stopPreview);
  }
  audioEl.src = btn.dataset.preview;
  audioEl.play().catch(() => {});
  btn.textContent = '⏸';
  btn.classList.add('playing');
  playingBtn = btn;
}

// ── Pakistan daily commodities (with graphs + forecast) ─────────────────────

let pakcomData = null;

const SECTION_ICONS = {
  'Fuel & Energy': '⛽', 'Meat & Poultry': '🍗',
  'Grocery Staples': '🌾', 'Vegetables & Fruits': '🥬',
};

function linearForecast(history, daysAhead) {
  // simple least-squares fit over (dayIndex, rate)
  if (!history || history.length < 3) return null;
  const pts = history.map(h => [new Date(h[0]).getTime() / 86400000, h[1]]);
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0);
  const sy = pts.reduce((a, p) => a + p[1], 0);
  const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const lastX = pts[n - 1][0];
  const value = slope * (lastX + daysAhead) + intercept;
  return { value: Math.max(0, value), slopePerDay: slope };
}

function renderPakCom(data) {
  if (!data?.sections?.length) { showError('pakcom-content', 'No rates available'); return; }
  pakcomData = data;

  const sections = data.sections.map((sec, si) => `
    <div class="section-title">${SECTION_ICONS[sec.title] || '📦'} ${esc(sec.title)}</div>
    <div class="pakcom-grid">
      ${(sec.items ?? []).map((i, ii) => {
        const hist = i.history ?? [];
        const prev = hist.length > 1 ? hist[hist.length - 2][1] : null;
        const delta = prev != null ? i.rate - prev : null;
        return `
        <button class="pakcom-item" data-si="${si}" data-ii="${ii}" title="Chart & 30-day forecast">
          <div class="pakcom-name">${esc(i.name)}</div>
          <div class="pakcom-rate">${fmtPKR(i.rate)}</div>
          <div class="pakcom-foot">
            <span class="pakcom-unit">${esc(i.unit || '')}</span>
            ${fmtDeltaBadge(delta, { invert: true })}
          </div>
        </button>`;
      }).join('')}
    </div>
  `).join('');

  setHTML('pakcom-content', `
    ${sections}
    <div class="meta">
      ${data.liveFuel ? '<span class="badge-live">●</span>Petrol &amp; diesel live' : '<span class="badge-indicative">◆</span>Fuel sources unreachable'}
      · other items are reference rates (updated ${esc(data.updated || '—')})
    </div>
  `);
}

// Consecutive history points more than this many days apart get drawn as a
// dashed "no data recorded" segment instead of a solid trend line, so a
// sparse or stale series never reads as smooth continuous data.
const CHART_GAP_DAYS = 10;

function lineChartSVG(history, forecast, liveNow) {
  const W = 560, H = 220, PAD = 34;
  const pts = history.map(h => ({ t: new Date(h[0]).getTime(), v: h[1] }));
  const fT = forecast ? pts[pts.length - 1].t + 30 * 86400000 : null;
  const allV = pts.map(p => p.v).concat(forecast ? [forecast.value] : []);
  const allT = pts.map(p => p.t).concat(fT ? [fT] : []);
  const minV = Math.min(...allV) * 0.97, maxV = Math.max(...allV) * 1.03;
  const minT = Math.min(...allT), maxT = Math.max(...allT);
  const x = t => PAD + ((t - minT) / (maxT - minT || 1)) * (W - PAD * 2);
  const y = v => H - PAD - ((v - minV) / (maxV - minV || 1)) * (H - PAD * 2);

  const last = pts[pts.length - 1];
  const DAY = 86400000;

  // Build one polyline per run of closely-spaced points; a run breaks (and
  // gets bridged with a dashed "gap" line) wherever two real points are more
  // than CHART_GAP_DAYS apart.
  const segments = [];
  let current = [pts[0]];
  const gapLines = [];
  for (let i = 1; i < pts.length; i++) {
    const gapDays = (pts[i].t - pts[i - 1].t) / DAY;
    if (gapDays > CHART_GAP_DAYS) {
      segments.push(current);
      gapLines.push([pts[i - 1], pts[i], Math.round(gapDays)]);
      current = [pts[i]];
    } else {
      current.push(pts[i]);
    }
  }
  segments.push(current);

  const solidLines = segments
    .filter(seg => seg.length > 1)
    .map(seg => `<polyline class="chart-line" points="${seg.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>`)
    .join('');

  const dashedLines = gapLines.map(([a, b, days]) => `
    <line x1="${x(a.t).toFixed(1)}" y1="${y(a.v).toFixed(1)}" x2="${x(b.t).toFixed(1)}" y2="${y(b.v).toFixed(1)}" class="chart-gap-line"/>
    <text x="${((x(a.t) + x(b.t)) / 2).toFixed(1)}" y="${(Math.min(y(a.v), y(b.v)) - 8).toFixed(1)}" class="chart-axis chart-gap-label" text-anchor="middle">${days}d gap</text>
  `).join('');

  const gridLines = [0, 0.5, 1].map(f => {
    const v = minV + (maxV - minV) * f;
    return `<line x1="${PAD}" y1="${y(v)}" x2="${W - PAD}" y2="${y(v)}" class="chart-grid"/>
            <text x="${PAD - 6}" y="${y(v) + 4}" class="chart-axis" text-anchor="end">${Math.round(v)}</text>`;
  }).join('');

  const dateLabels = [pts[0], last].map(p =>
    `<text x="${x(p.t)}" y="${H - 10}" class="chart-axis" text-anchor="middle">${new Date(p.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>`
  ).join('');

  const forecastLine = forecast
    ? `<line x1="${x(last.t)}" y1="${y(last.v)}" x2="${x(fT)}" y2="${y(forecast.value)}" class="chart-forecast-line"/>
       <circle cx="${x(fT)}" cy="${y(forecast.value)}" r="4" class="chart-forecast-dot"/>
       <text x="${x(fT) - 6}" y="${y(forecast.value) - 10}" class="chart-axis" text-anchor="end">${Math.round(forecast.value)}</text>`
    : '';

  const dots = pts
    .map((p, i) => {
      const isLast = i === pts.length - 1;
      const cls = isLast && liveNow ? 'chart-dot chart-dot-live' : 'chart-dot';
      return `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${isLast && liveNow ? 4 : 3}" class="${cls}"/>`;
    })
    .join('');

  const liveLabel = liveNow
    ? `<text x="${x(last.t).toFixed(1)}" y="${(y(last.v) - 12).toFixed(1)}" class="chart-axis chart-live-label" text-anchor="middle">live now</text>`
    : '';

  return `
    <svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${gridLines}
      ${dateLabels}
      ${dashedLines}
      ${solidLines}
      ${dots}
      ${liveLabel}
      ${forecastLine}
    </svg>`;
}

function openChart(si, ii) {
  const item = pakcomData?.sections?.[si]?.items?.[ii];
  if (!item?.history?.length) return;

  const fc = linearForecast(item.history, 30);
  el('chartTitle').textContent = item.name;
  el('chartSub').textContent = `${item.unit} · current ${fmtPKR(item.rate)}`;
  el('chartBody').innerHTML = lineChartSVG(item.history, fc, item.liveNow);

  if (fc) {
    const diff = fc.value - item.rate;
    const dir = diff > 1 ? `▲ likely to RISE to ~${fmtPKR(fc.value)}` : diff < -1 ? `▼ likely to EASE to ~${fmtPKR(fc.value)}` : `→ likely to stay near ${fmtPKR(item.rate)}`;
    el('chartForecast').innerHTML =
      `<strong>30-day forecast:</strong> ${dir}` +
      `<span class="chart-caveat">Simple trend projection from recorded history — not financial advice.</span>`;
  } else {
    el('chartForecast').innerHTML = '<span class="chart-caveat">Not enough history for a forecast yet.</span>';
  }

  el('chartModal').hidden = false;
}

function closeChart() { el('chartModal').hidden = true; }

// ── PSX KSE-100 ───────────────────────────────────────────────────────────────

function fmtWhen(ms) {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function renderPSX(d) {
  if (!d?.value) { showError('psx-content', 'KSE-100 unavailable'); return; }
  const fmtIdx = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const up = d.change == null || d.change >= 0;
  const spark = d.series?.length > 1
    ? sparklineSVG(d.series, up).replace('class="sparkline"', 'class="sparkline psx-spark"')
    : '';

  setHTML('psx-content', `
    <div class="psx-value">${fmtIdx(d.value)}</div>
    ${d.change != null ? `<div class="psx-change">${fmtDeltaBadge(d.change, { pct: d.changePct })} today</div>` : ''}
    ${d.live
      ? '<div class="psx-status live"><span class="status-dot"></span>Market live</div>'
      : `<div class="psx-status">Market closed${d.asOf ? ` · as of ${esc(fmtWhen(d.asOf))}` : ''}</div>`}
    ${d.high != null && d.low != null
      ? `<div class="psx-range"><span><b>High</b>${fmtIdx(d.high)}</span><span><b>Low</b>${fmtIdx(d.low)}</span></div>`
      : ''}
    ${spark}
    <div class="meta">${esc(d.source || '')} · 30-day trend</div>
  `);
}

function indexPSX(d) {
  searchIndex.psx = d?.value ? [{
    type: 'psx', emoji: '🏛️', img: null,
    name: 'KSE-100 Index', sub: 'Pakistan Stock Exchange',
    value: d.value.toLocaleString('en-US', { maximumFractionDigits: 0 }),
    change: d.changePct,
    keys: 'psx kse 100 kse100 stock exchange shares index',
  }] : [];
}

// ── Karachi: prayer times ─────────────────────────────────────────────────────

let prayerData = null;
let prayerKey = null;

function karachiNowSec() {
  const [h, m, sec] = new Date()
    .toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour12: false })
    .split(':').map(Number);
  return (h % 24) * 3600 + m * 60 + sec;
}

const hhmmToSec = t => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtWait(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

// Mosque azan offsets. The calculated times are when each prayer's time
// *begins*; Karachi mosques call the azan later, by their own convention
// (e.g. Dhuhr begins ~12:26 but the azan is ~12:55). Offsets are minutes
// after the start time, so they track the seasons instead of going stale
// like fixed clock times would. Editable on the card, saved per browser.
const AZAN_KEY = 'lr_azan_offsets';
const AZAN_PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const AZAN_DEFAULTS = { Fajr: 0, Dhuhr: 29, Asr: 0, Maghrib: 0, Isha: 0 };

function loadAzanOffsets() {
  try { return { ...AZAN_DEFAULTS, ...JSON.parse(localStorage.getItem(AZAN_KEY) || '{}') }; }
  catch { return { ...AZAN_DEFAULTS }; }
}

let azanOffsets = loadAzanOffsets();
let azanEditing = false;

const secToHHMM = sec => {
  const m = Math.round(((sec % 86400) + 86400) % 86400 / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Each timing with its mosque azan time applied (Sunrise has no azan)
function withAzan(timings) {
  return timings.map(t => {
    const off = t.info ? 0 : (azanOffsets[t.name] ?? 0);
    return { ...t, off, azan: secToHHMM(hhmmToSec(t.time) + off * 60) };
  });
}

// Next azan after "now"; after Isha it wraps to tomorrow's Fajr.
function nextPrayer(timings, now) {
  const prayers = timings.filter(t => !t.info);
  const next = prayers.find(t => hhmmToSec(t.azan) > now);
  if (next) return { next, wait: hhmmToSec(next.azan) - now };
  return { next: prayers[0], wait: hhmmToSec(prayers[0].azan) + 86400 - now };
}

function renderPrayer(p) {
  if (!p?.timings?.length) { showError('prayer-content', 'Prayer times unavailable right now'); return; }
  prayerData = p;
  prayerKey = null;
  el('hijriDate').textContent = p.hijri ?? '';
  drawPrayer();
}

// Called every second from the clock: cheap countdown update, full redraw
// only when the upcoming prayer or the offsets change. Paused while editing.
function drawPrayer() {
  const p = prayerData;
  if (!p || azanEditing) return;
  const now = karachiNowSec();
  const timings = withAzan(p.timings);
  const { next, wait } = nextPrayer(timings, now);
  const key = next.name + JSON.stringify(azanOffsets);

  if (prayerKey === key && el('prayerCountdown')) {
    el('prayerCountdown').textContent = fmtWait(wait);
    return;
  }
  prayerKey = key;

  const rows = timings.map(t => {
    const cls = t.name === next.name && !t.info ? 'next' : t.info ? 'info' : hhmmToSec(t.azan) <= now ? 'past' : '';
    const start = t.off ? `<span class="prayer-start">starts ${fmt12(t.time)}</span>` : '';
    return `<div class="prayer-row ${cls}"><span>${esc(t.name)}${start}</span><span>${fmt12(t.azan)}</span></div>`;
  }).join('');

  setHTML('prayer-content', `
    <div class="prayer-next">
      <div class="prayer-next-label">Next azan</div>
      <div class="prayer-next-name">${esc(next.name)}</div>
      <div class="prayer-next-time">${fmt12(next.azan)} · in <span class="prayer-countdown" id="prayerCountdown">${fmtWait(wait)}</span></div>
    </div>
    <div class="prayer-list">${rows}</div>
    <div class="meta prayer-meta">
      <span>Azan = start time + your mosque's delay · ${esc(p.method || '')}</span>
      <button class="link-btn" id="azanEdit">Adjust to my mosque</button>
    </div>
  `);
  el('azanEdit').addEventListener('click', openAzanEditor);
}

function openAzanEditor() {
  const p = prayerData;
  azanEditing = true;
  const rows = AZAN_PRAYERS.map(name => {
    const t = p.timings.find(x => x.name === name);
    return `
      <label class="azan-row">
        <span class="azan-name">${name}<small>starts ${fmt12(t.time)}</small></span>
        <span class="azan-input">+<input type="number" inputmode="numeric" min="0" max="120" data-prayer="${name}" value="${azanOffsets[name] ?? 0}"> min</span>
        <span class="azan-preview" data-preview="${name}"></span>
      </label>`;
  }).join('');

  setHTML('prayer-content', `
    <p class="azan-help">Set how many minutes after each prayer's start time your mosque calls the azan. Saved on this device.</p>
    <div class="azan-form">${rows}</div>
    <div class="azan-actions">
      <button class="link-btn" id="azanReset">Reset</button>
      <button class="btn-primary" id="azanSave">Save</button>
    </div>
  `);

  const preview = () => document.querySelectorAll('[data-prayer]').forEach(inp => {
    const t = p.timings.find(x => x.name === inp.dataset.prayer);
    const off = Math.max(0, Math.min(120, parseInt(inp.value, 10) || 0));
    document.querySelector(`[data-preview="${inp.dataset.prayer}"]`).textContent =
      '→ ' + fmt12(secToHHMM(hhmmToSec(t.time) + off * 60));
  });
  preview();
  el('prayer-content').addEventListener('input', preview);

  el('azanReset').addEventListener('click', () => {
    document.querySelectorAll('[data-prayer]').forEach(inp => { inp.value = AZAN_DEFAULTS[inp.dataset.prayer]; });
    preview();
  });
  el('azanSave').addEventListener('click', () => {
    document.querySelectorAll('[data-prayer]').forEach(inp => {
      azanOffsets[inp.dataset.prayer] = Math.max(0, Math.min(120, parseInt(inp.value, 10) || 0));
    });
    try { localStorage.setItem(AZAN_KEY, JSON.stringify(azanOffsets)); } catch {}
    azanEditing = false;
    prayerKey = null;
    drawPrayer();
    toast('🕌', 'Azan times saved', 'Matched to your mosque');
  });
}

// ── Karachi: weather + air quality ────────────────────────────────────────────

// WMO weather codes (Open-Meteo)
function wxInfo(code, isDay = true) {
  if (code === 0) return [isDay ? '☀️' : '🌙', 'Clear'];
  if (code === 1) return [isDay ? '🌤️' : '🌙', 'Mainly clear'];
  if (code === 2) return ['⛅', 'Partly cloudy'];
  if (code === 3) return ['☁️', 'Overcast'];
  if (code === 45 || code === 48) return ['🌫️', 'Fog / haze'];
  if (code >= 51 && code <= 57) return ['🌦️', 'Drizzle'];
  if (code >= 61 && code <= 67) return ['🌧️', 'Rain'];
  if (code >= 71 && code <= 77) return ['❄️', 'Snow'];
  if (code >= 80 && code <= 82) return ['🌦️', 'Showers'];
  if (code >= 85 && code <= 86) return ['🌨️', 'Snow showers'];
  if (code >= 95) return ['⛈️', 'Thunderstorm'];
  return ['🌡️', '—'];
}

function aqiInfo(aqi) {
  if (aqi <= 50) return ['Good', 'var(--green)'];
  if (aqi <= 100) return ['Moderate', 'var(--yellow)'];
  if (aqi <= 150) return ['Unhealthy for sensitive groups', '#fb923c'];
  if (aqi <= 200) return ['Unhealthy', 'var(--red)'];
  if (aqi <= 300) return ['Very unhealthy', '#a855f7'];
  return ['Hazardous', '#9f1239'];
}

function renderWeather(w, air) {
  if (!w?.current) { showError('weather-content', 'Weather unavailable right now'); return; }
  const c = w.current;
  const [icon, modelLabel] = wxInfo(c.code, c.isDay);
  const label = c.label || modelLabel;
  const r = n => Math.round(n);

  let aqiChip = '';
  if (air?.aqi != null) {
    const [aqiLabel, color] = aqiInfo(air.aqi);
    aqiChip = `<span class="chip">AQI <b style="color:${color}">${air.aqi}</b> ${esc(aqiLabel)}</span>`;
  }

  const days = w.days.map((d, i) => {
    const name = i === 0 ? 'Today'
      : new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return `
      <div class="wx-day${i === 0 ? ' today' : ''}">
        <span class="wx-day-name">${name}</span>
        <span class="wx-day-icon" title="${esc(wxInfo(d.code)[1])}">${wxInfo(d.code)[0]}</span>
        <span class="wx-day-max">${r(d.max)}°</span>
        <span class="wx-day-min">${r(d.min)}°</span>
        <span class="wx-day-rain">${d.rain >= 10 ? `💧${d.rain}%` : ''}</span>
      </div>`;
  }).join('');

  setHTML('weather-content', `
    <div class="wx">
      <div>
        <div class="wx-now">
          <span class="wx-now-icon">${icon}</span>
          <div>
            <div class="wx-temp">${r(c.temp)}°</div>
            <div class="wx-desc">${esc(label)} · feels ${r(c.feelsLike)}°</div>
          </div>
        </div>
        <div class="wx-facts">
          ${c.humidity != null ? `<span class="chip">💧 <b>${r(c.humidity)}%</b></span>` : ''}
          ${c.wind != null ? `<span class="chip">💨 <b>${r(c.wind)}</b> km/h</span>` : ''}
          ${w.days[0]?.uv != null ? `<span class="chip">UV <b>${r(w.days[0].uv)}</b></span>` : ''}
          ${aqiChip}
        </div>
      </div>
      <div class="wx-days">${days}</div>
    </div>
    <div class="meta">${c.source === 'observed' && c.observedAt
      ? `Now: observed at Jinnah Airport, ${esc(new Date(c.observedAt).toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' }))} · Forecast: Open-Meteo`
      : 'Open-Meteo model for Karachi'}</div>
  `);
}

// ── Ticker tape ───────────────────────────────────────────────────────────────

function rebuildTicker() {
  const track = el('tickerTrack');
  if (!track) return;

  const ticks = [];

  for (const c of state.crypto ?? []) {
    const pct = c.price_change_percentage_24h;
    const cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
    ticks.push(
      `<span class="tick"><span class="tick-sym">${esc((c.symbol || '').toUpperCase())}</span>` +
      `<span class="tick-price">${fmtPKR(c.current_price)}</span>` +
      `<span class="${cls}">${pct != null ? (pct > 0 ? '▲' : pct < 0 ? '▼' : '') + Math.abs(pct).toFixed(2) + '%' : ''}</span></span>`
    );
  }

  for (const c of state.commodities ?? []) {
    ticks.push(
      `<span class="tick"><span class="tick-sym">${esc(c.name.toUpperCase())}</span>` +
      `<span class="tick-price">${c.currency === 'PKR' ? fmtPKR(c.price) : fmtPrice(c.price, 2)}</span></span>`
    );
  }

  if (!ticks.length) return;
  const half = ticks.join('');
  track.innerHTML = half + half;
}

// ── Prediction game ───────────────────────────────────────────────────────────

const ROUND_SECONDS = 60;
const game = { active: false, lockPrice: null, direction: null, timer: null };

async function freshBTC() {
  const data = await apiFetch(`/api/crypto?cb=${Date.now()}`);
  const btc = data.find(c => c.symbol?.toLowerCase() === 'btc' || c.id === 'bitcoin');
  if (!btc) throw new Error('BTC price unavailable');
  return btc.current_price;
}

function gameStatsHTML() {
  const total = profile.wins + profile.losses;
  const acc = total ? Math.round((profile.wins / total) * 100) : 0;
  return `
    <div class="game-stats">
      <div class="game-stat"><div class="game-stat-value">${profile.winStreak}🔥</div><div class="game-stat-label">Streak</div></div>
      <div class="game-stat"><div class="game-stat-value">${profile.bestStreak}</div><div class="game-stat-label">Best</div></div>
      <div class="game-stat"><div class="game-stat-value">${acc}%</div><div class="game-stat-label">Accuracy</div></div>
    </div>`;
}

function renderGameIdle(message, cls) {
  const btc = state.crypto?.find(c => c.id === 'bitcoin' || c.symbol?.toLowerCase() === 'btc');
  setHTML('game-content', `
    <div class="game-wrap">
      <div class="game-price-row">
        <div>
          <div class="game-price-label">Bitcoin now</div>
          <div class="game-price">${btc ? fmtPKR(btc.current_price) : '—'}</div>
        </div>
      </div>
      <div class="game-question">Will BTC be higher or lower in ${ROUND_SECONDS} seconds?</div>
      <div class="game-buttons">
        <button class="game-btn up" id="betUp">⬆ Higher</button>
        <button class="game-btn down" id="betDown">⬇ Lower</button>
      </div>
      <div class="game-status ${cls || ''}">${message || 'Win: +10 pts & +10 XP'}</div>
      ${gameStatsHTML()}
    </div>
  `);
  el('betUp')?.addEventListener('click', () => startRound('up'));
  el('betDown')?.addEventListener('click', () => startRound('down'));
}

async function startRound(direction) {
  if (game.active) return;
  game.active = true;
  game.direction = direction;

  setHTML('game-content', `
    <div class="game-wrap">
      <div class="game-status">Locking in BTC price…</div>
    </div>
  `);

  try {
    game.lockPrice = await freshBTC();
  } catch (err) {
    game.active = false;
    renderGameIdle('Could not lock price — try again', 'loss');
    return;
  }

  let remaining = ROUND_SECONDS;

  const renderCountdown = () => {
    setHTML('game-content', `
      <div class="game-wrap">
        <div class="game-price-row">
          <div>
            <div class="game-price-label">Locked at</div>
            <div class="game-price">${fmtPKR(game.lockPrice)}</div>
          </div>
          <div style="text-align:right">
            <div class="game-price-label">Your call</div>
            <div class="game-price">${direction === 'up' ? '⬆️' : '⬇️'}</div>
          </div>
        </div>
        <div class="game-countdown"><span class="game-countdown-fill" id="cdFill" style="width:${(remaining / ROUND_SECONDS) * 100}%"></span></div>
        <div class="game-status">Resolving in ${remaining}s…</div>
        ${gameStatsHTML()}
      </div>
    `);
  };

  renderCountdown();

  game.timer = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      const fill = el('cdFill');
      if (fill) fill.style.width = (remaining / ROUND_SECONDS) * 100 + '%';
      const status = document.querySelector('#game-content .game-status');
      if (status) status.textContent = `Resolving in ${remaining}s…`;
    } else {
      clearInterval(game.timer);
      resolveRound();
    }
  }, 1000);
}

async function resolveRound() {
  let endPrice;
  try {
    endPrice = await freshBTC();
  } catch {
    game.active = false;
    renderGameIdle('Could not fetch final price — round void', '');
    return;
  }

  const diff = endPrice - game.lockPrice;
  game.active = false;

  if (Math.abs(diff) < 1e-9) {
    renderGameIdle('Flat! Market didn\'t move — round void', '');
    return;
  }

  const wentUp = diff > 0;
  const won = (wentUp && game.direction === 'up') || (!wentUp && game.direction === 'down');
  const deltaStr = `${wentUp ? '▲' : '▼'} ${fmtPKR(Math.abs(diff))}`;

  if (won) {
    profile.wins++;
    profile.points += 10;
    profile.winStreak++;
    profile.bestStreak = Math.max(profile.bestStreak, profile.winStreak);
    saveProfile();
    awardXP(10);
    unlock('firstWin');
    if (profile.winStreak >= 3) unlock('streak3');
    if (profile.winStreak >= 7) unlock('streak7');
    if (profile.points >= 100) unlock('points100');
    chime(523, 659);
    renderGameIdle(`${pick(GAME_WIN_LINES)} ${deltaStr} · +10 pts`, 'win');
  } else {
    profile.losses++;
    profile.winStreak = 0;
    saveProfile();
    awardXP(2);
    renderGameIdle(`${pick(GAME_LOSS_LINES)} (${wentUp ? '▲' : '▼'} ${deltaStr.replace(/^[▲▼] /, '')}) · +2 XP`, 'loss');
  }
  renderLevel();
}

// ── Search ────────────────────────────────────────────────────────────────────

// type → [tab, card] so a result can open the right section
const SEARCH_TARGETS = {
  crypto: ['markets', 'card-crypto'],
  commodity: ['markets', 'card-commodities'],
  psx: ['markets', 'card-psx'],
  currency: ['pakistan', 'card-currency'],
  pakcom: ['pakistan', 'card-pakcom'],
  movies: ['entertainment', 'card-movies'],
  music: ['entertainment', 'card-music'],
  musicpk: ['entertainment', 'card-musicpk'],
};

const searchIndex = { crypto: [], commodities: [], psx: [], currency: [], pakcom: [], movies: [], music: [], musicpk: [] };

function indexCurrency(data) {
  searchIndex.currency = (data?.currencies ?? []).map(c => ({
    type: 'currency', emoji: c.flag || '💱', img: null,
    name: `${c.code} — ${c.name}`,
    sub: 'per 1 ' + c.code,
    value: fmtPKR(c.pkr),
    keys: [c.code, c.name, 'dollar', 'rate'].join(' ').toLowerCase(),
  }));
}

function indexPakCom(data) {
  searchIndex.pakcom = (data?.sections ?? []).flatMap(sec => (sec.items ?? []).map(i => ({
    type: 'pakcom', emoji: SECTION_ICONS[sec.title] || '📦', img: null,
    name: i.name,
    sub: i.unit,
    value: fmtPKR(i.rate),
    keys: [i.name, sec.title].join(' ').toLowerCase(),
  })));
}

function indexCrypto(data) {
  searchIndex.crypto = (data ?? []).map(c => ({
    type: 'crypto', emoji: null,
    img: c.image,
    name: c.name,
    sub: (c.symbol ?? '').toUpperCase(),
    value: c.currency === 'PKR' ? fmtPKR(c.current_price) : fmtPrice(c.current_price),
    change: c.price_change_percentage_24h,
    keys: [c.name, c.symbol, c.id].join(' ').toLowerCase(),
  }));
}

function indexCommodities(data) {
  const icons = { gold: '🥇', silver: '🥈', copper: '🟤', 'oil-brent': '🛢️', 'oil-wti': '🛢️' };
  searchIndex.commodities = (data ?? []).map(c => ({
    type: 'commodity', emoji: icons[c.id] || '📊', img: null,
    name: c.name,
    sub: c.unit,
    value: c.currency === 'PKR' ? fmtPKR(c.price) : fmtPrice(c.price, 2),
    keys: c.name.toLowerCase(),
  }));
}

function indexRanked(type, data) {
  searchIndex[type] = (data ?? []).map((item, i) => ({
    type, emoji: type === 'movies' ? '🎬' : '🎵', img: item.image,
    name: item.title,
    sub: item.subtitle || '',
    rank: i + 1,
    keys: [item.title, item.subtitle].join(' ').toLowerCase(),
  }));
}

function highlight(text, q) {
  if (!q) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${esc})`, 'gi'), '<mark class="search-highlight">$1</mark>');
}

function runSearch(q) {
  const box = el('searchResults');
  if (!box) return;
  const raw = q.trim().toLowerCase();
  if (!raw) { box.hidden = true; return; }
  if (raw === 'pakistan') pakistanSurprise();

  const all = Object.values(searchIndex).flat();

  const hits = all.filter(item => item.keys.includes(raw) || item.keys.split(' ').some(w => w.startsWith(raw)));
  const hits2 = hits.length ? hits : all.filter(item => item.keys.includes(raw.slice(0, 3)));
  const results = (hits.length ? hits : hits2).slice(0, 12);

  if (!results.length) {
    box.innerHTML = `<div class="search-empty">Kuch nahi mila bhai 🤷 — try another term</div>`;
    box.hidden = false;
    return;
  }

  const pct = v => v != null ? `<span class="${v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral'}">${v > 0 ? '+' : ''}${v.toFixed(2)}%</span>` : '';

  box.innerHTML = results.map(r => `
    <div class="search-result-item" data-type="${r.type}">
      ${safeUrl(r.img) ? `<img class="sri-thumb" src="${safeUrl(r.img)}" alt="">` : `<span class="sri-emoji">${r.emoji}</span>`}
      <div class="sri-info">
        <div class="sri-name">${highlight(esc(r.name), q.trim())}</div>
        ${r.sub ? `<div class="sri-sub">${esc(r.sub)}</div>` : ''}
      </div>
      <div class="sri-value">
        ${r.value ? r.value : r.rank ? `#${r.rank}` : ''}
        ${r.change != null ? '<br>' + pct(r.change) : ''}
      </div>
    </div>
  `).join('');

  box.hidden = false;
}

function initSearch() {
  const input = el('searchInput');
  const clearBtn = el('searchClear');
  const box = el('searchResults');
  if (!input) return;

  let debounce;
  input.addEventListener('input', () => {
    clearBtn.classList.toggle('visible', input.value.length > 0);
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(input.value), 160);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.remove('visible');
    box.hidden = true;
    input.focus();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#search')) box.hidden = true;
  });

  box.addEventListener('click', e => {
    const item = e.target.closest('[data-type]');
    if (!item) return;
    const [tab, cardId] = SEARCH_TARGETS[item.dataset.type] ?? [];
    if (tab) {
      switchTab(tab);
      requestAnimationFrame(() => el(cardId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    box.hidden = true;
    input.value = '';
    clearBtn.classList.remove('visible');
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { box.hidden = true; input.blur(); }
  });
}

// ── Roman Urdu banter (rotates every reload) ──────────────────────────────────

const BANTER = [
  'Bhenchod itna rate kyun dekh raha hai, paisa hai tere paas? 💀',
  'Oye chutiye, gold rate dekhne se sona nahi milta.',
  'Madarchod market phir gir gayi, aur tu phir yahan? 😂',
  'Randi k tattay, itna refresh kar ke kya milega?',
  'Jhanton kay nayi, pehle kaam dhanda kar phir rates dekh.',
  'Bhen kay loray, BTC phir pump hoga — bas 10 saal ruk.',
  'Lund kay kassayi, dollar itna mehnga aur tu abhi bhi chai pi raha hai?',
  'Bosri kay, portfolio green hai ya phir wahi loser vibes?',
  'Bakray kay muh walay, gold khareeda ya sirf dekha?',
  'Kaali chuchiyon walay burger, itna analysis kar ke bhi zero profit?',
  'Maa k barway, market ne phir thapa maara tujhe.',
  'Baaliyon walay tattay walay, ek baar invest kar de bhai.',
  'Oye maa k laadle, rates dekh ke neend aa gayi kya?',
  'Tu itna tharki investor hai — sab kuch dekhta hai, kuch karta nahi. 🤡',
  'Chal nikal yahan se, screen ghoor ke dollar nahi badlega tere liye.',
  'Choot ky shehzaday, aaj phir khaali jeb ke saath rates dekhne aa gaya?',
  'Barway ki nasal, kabhi kuch khareed bhi liya kar, sirf dekhta hi rehta hai.',
  'Chooton k piyassey, market teri wajah se nahi sudhri.',
  'Lund jaise shakal walay, tera portfolio bhi teri shakal jaisa hai.',
  'Kaali tatton key sharabi barway, hosh mein aa ke trade kiya kar.',
  'Chuchiyon chhatney key expert, kabhi candlestick chart bhi chhaat le.',
  'Oye choot ky shehzaday, BTC tere baap ka nahi jo roz check karta hai.',
  'Barway ki nasal, itni mehnat naukri pe karta to CEO hota ab tak.',
];

const GAME_WIN_LINES = [
  'Wah bhenchod! Tukka kya zabardast laga 🎯',
  'Oye chutiye sahi nikla — Warren Buffett ke baap!',
  'Teri phati kismat bhi kaam aayi aaj 😂',
  'Maan gaye ustad, aaj crystal ball saath laye the kya? 🔮',
];

const GAME_LOSS_LINES = [
  'Hogaya na nuqsan, madarchod? Isi liye investing mat kar.',
  'Bhai tu randi k tattay jaisi trading karta hai — har baar loss 💀',
  'Market ne tujhe phir school bheja, chutiye.',
  'Lund kay kassayi, agli baar coin uchal ke decide karna — zyada accurate hoga.',
  'Choot ky shehzaday, phir loss? Wah, consistency to hai teri mein.',
  'Barway ki nasal, tujhse behtar to tossed coin predict karta hai.',
  'Chooton k piyassey, trading chhor de, tere bas ki nahi.',
  'Kaali tatton key sharabi barway, nasha utaar ke khela kar.',
];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function showBanter() {
  const b = el('banter');
  if (!b) return;
  const line = '💬 ' + pick(BANTER);
  if (b.textContent) {
    b.classList.add('fading');
    setTimeout(() => {
      b.textContent = line;
      b.title = line;
      b.classList.remove('fading');
    }, 400);
  } else {
    b.textContent = line;
    b.title = line;
  }
}

// ── Zen mode ──────────────────────────────────────────────────────────────────

const ZEN_QUOTES = [
  '“The stock market is a device for transferring money from the impatient to the patient.” — Warren Buffett',
  '“In the midst of movement and chaos, keep stillness inside of you.” — Deepak Chopra',
  '“He who is not contented with what he has, would not be contented with what he would like to have.” — Socrates',
  '“Patience is bitter, but its fruit is sweet.” — Rumi',
  '“The best time to plant a tree was 20 years ago. The second best time is now.”',
  '“Wealth consists not in having great possessions, but in having few wants.” — Epictetus',
  '“Calm mind brings inner strength and self-confidence.” — Dalai Lama',
];

let zenPhaseTimer = null;

function enterZen() {
  stopPreview();
  const overlay = el('zenOverlay');
  overlay.hidden = false;
  el('zenQuote').textContent = ZEN_QUOTES[(Math.random() * ZEN_QUOTES.length) | 0];
  unlock('zen');

  // Phase text synced to the 11s breathing cycle (4 in · 3 hold · 4 out)
  const phases = [
    { label: 'Breathe in', at: 0 },
    { label: 'Hold', at: 4000 },
    { label: 'Breathe out', at: 7000 },
  ];
  const cycle = () => {
    for (const p of phases) {
      setTimeout(() => {
        if (!overlay.hidden) el('zenPhase').textContent = p.label;
      }, p.at);
    }
  };
  cycle();
  zenPhaseTimer = setInterval(cycle, 11000);
}

function exitZen() {
  el('zenOverlay').hidden = true;
  clearInterval(zenPhaseTimer);
}

// ── Themes ────────────────────────────────────────────────────────────────────

const THEMES = ['midnight', 'ocean', 'forest', 'dawn'];

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  profile.theme = name;
  saveProfile();
}

function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(profile.theme) + 1) % THEMES.length];
  applyTheme(next);
  unlock('themer');
  toast('🎨', 'Theme changed', next.charAt(0).toUpperCase() + next.slice(1));
}

// ── Modules & tabs ────────────────────────────────────────────────────────────

const TABS = { markets: 'Markets', pakistan: 'Pakistan', karachi: 'Karachi', entertainment: 'Entertainment' };
const TAB_KEY = 'lr_tab';
const MODULE_TTL = 5 * 60 * 1000;
let activeTab = 'markets';
let lastUpdated = null;

// Each module belongs to a tab and only loads when that tab is shown (then
// quietly in the background, so search can find everything). Once a card
// has data, refreshes swap it in place — no skeleton flash, and a failed
// refresh keeps the last good data instead of replacing it with an error.
const MODULES = [
  {
    name: 'crypto', tab: 'markets', endpoint: '/api/crypto', targets: ['crypto-content'],
    render: data => {
      state.crypto = data;
      renderCrypto(data);
      rebuildTicker();
      indexCrypto(data);
      if (!game.active) renderGameIdle();
    },
  },
  { name: 'mood', tab: 'markets', endpoint: '/api/mood', targets: ['mood-content'], render: renderMood },
  {
    name: 'commodities', tab: 'markets', endpoint: '/api/commodities', targets: ['commodities-content'],
    render: data => { state.commodities = data; renderCommodities(data); rebuildTicker(); indexCommodities(data); },
  },
  { name: 'psx', tab: 'markets', endpoint: '/api/psx', targets: ['psx-content'], render: d => { renderPSX(d); indexPSX(d); } },
  { name: 'currency', tab: 'pakistan', endpoint: '/api/forex', targets: ['currency-content'], render: d => { renderCurrency(d); indexCurrency(d); } },
  { name: 'pakcom', tab: 'pakistan', endpoint: '/api/pakcom', targets: ['pakcom-content'], render: d => { renderPakCom(d); indexPakCom(d); } },
  {
    name: 'karachi', tab: 'karachi', endpoint: '/api/karachi', targets: ['prayer-content', 'weather-content'],
    render: d => { renderPrayer(d.prayer); renderWeather(d.weather, d.air); },
  },
  { name: 'movies', tab: 'entertainment', endpoint: '/api/movies', targets: ['movies-content'], render: d => { renderRanked('movies-content', d); indexRanked('movies', d); } },
  { name: 'music', tab: 'entertainment', endpoint: '/api/music', targets: ['music-content'], render: d => { renderRanked('music-content', d); indexRanked('music', d); } },
  { name: 'musicpk', tab: 'entertainment', endpoint: '/api/music-pk', targets: ['musicpk-content'], render: d => { renderRanked('musicpk-content', d); indexRanked('musicpk', d); } },
];

async function loadModule(mod, force = false) {
  if (mod.loading) return;
  if (!force && mod.loadedAt && Date.now() - mod.loadedAt < MODULE_TTL) return;
  mod.loading = true;
  if (!mod.loadedAt) mod.targets.forEach(showLoading);
  try {
    mod.render(await apiFetch(mod.endpoint));
    mod.loadedAt = Date.now();
    lastUpdated = Date.now();
    updateStamp();
  } catch (err) {
    console.error(`[${mod.name}]`, err);
    if (!mod.loadedAt) mod.targets.forEach(id => showError(id, err.message));
  } finally {
    mod.loading = false;
  }
}

function loadTab(tab, force = false) {
  return Promise.allSettled(MODULES.filter(m => m.tab === tab).map(m => loadModule(m, force)));
}

async function refreshNow() {
  const btn = el('refreshAll');
  btn?.classList.add('spinning');
  await loadTab(activeTab, true);
  btn?.classList.remove('spinning');
  awardXP(1);
}

function switchTab(tab, { scroll = false } = {}) {
  if (!TABS[tab]) tab = 'markets';
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  el('pageTitle').textContent = TABS[tab];
  document.title = `${TABS[tab]} · LiveRates`;
  try { localStorage.setItem(TAB_KEY, tab); } catch {}
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  loadTab(tab);
}

function initialTab() {
  const fromHash = location.hash.slice(1);
  if (TABS[fromHash]) return fromHash;
  try { const saved = localStorage.getItem(TAB_KEY); if (TABS[saved]) return saved; } catch {}
  return 'markets';
}

function updateStamp() {
  if (!lastUpdated) return;
  el('updatedAt').textContent = 'Updated ' + new Date(lastUpdated).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit',
  });
  el('updatedSep').hidden = false;
}

function updateNetStatus() {
  const online = navigator.onLine;
  el('netStatus').classList.toggle('offline', !online);
  el('netLabel').textContent = online ? 'Live' : 'Offline · showing saved data';
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function tickClock() {
  const t = new Date().toLocaleTimeString('en-US', {
    timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
  el('pkClock').textContent = t + ' PKT';
  if (!el('zenOverlay').hidden) el('zenClock').textContent = t;
  drawPrayer();
}

// ── PWA: service worker + install button ──────────────────────────────────────

function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  let installEvt = null;
  const btn = el('installBtn');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvt = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    toast('📲', 'Installed!', 'LiveRates is on your home screen');
  });
}

// Keys written by features that no longer exist
function cleanupStorage() {
  try { ['lr_admin_key'].forEach(k => localStorage.removeItem(k)); } catch {}
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function burstConfetti(palette) {
  let canvas = el('confettiCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    document.body.appendChild(canvas);
  }
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = Array.isArray(palette) && palette.length ? palette : ['#7c5cfc', '#22d3a4', '#fbbf24', '#f43f5e', '#38bdf8', '#a78bfa'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: 70,
    vx: (Math.random() - 0.5) * 14,
    vy: Math.random() * -11 - 3,
    size: Math.random() * 7 + 3,
    color: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    life: 1,
  }));

  let frame;
  const step = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 0.008;
      if (p.life <= 0 || p.y > canvas.height + 20) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive) frame = requestAnimationFrame(step);
    else { cancelAnimationFrame(frame); canvas.remove(); }
  };
  step();
}

// ── Easter eggs ─────────────────────────────────────────────────────────────

function matrixRain(duration) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:998;pointer-events:none;';
  document.body.appendChild(canvas);
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const ctx = canvas.getContext('2d');
  const cols = Math.floor(innerWidth / 16);
  const drops = Array(cols).fill(0);
  const glyphs = 'アイウエオ01₿$R₨XRPETH';
  const iv = setInterval(() => {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#22d3a4';
    ctx.font = '15px monospace';
    for (let i = 0; i < drops.length; i++) {
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      ctx.fillText(ch, i * 16, drops[i] * 16);
      drops[i] = drops[i] * 16 > canvas.height && Math.random() > 0.975 ? 0 : drops[i] + 1;
    }
  }, 50);
  setTimeout(() => { clearInterval(iv); canvas.remove(); }, duration || 5000);
}

function launchRocket() {
  const r = document.createElement('div');
  r.textContent = '🚀';
  r.style.cssText = 'position:fixed;left:-70px;bottom:-70px;font-size:3.2rem;z-index:998;pointer-events:none;transition:transform 2.2s ease-in;';
  document.body.appendChild(r);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    r.style.transform = `translate(${innerWidth + 180}px, -${innerHeight + 180}px)`;
  }));
  setTimeout(() => r.remove(), 2600);
}

let pakCooldown = false;
function pakistanSurprise() {
  if (pakCooldown) return;
  pakCooldown = true;
  setTimeout(() => { pakCooldown = false; }, 60000);
  unlock('patriot');
  burstConfetti(['#01411C', '#ffffff', '#2ecc71', '#01411C', '#ffffff']);
  toast('🇵🇰', 'Pakistan Zindabad!', 'Dil dil Pakistan ❤️');
  chime(392, 523);
}

// Rain a burst of emoji down the screen (chai, biryani, paisa…)
function emojiRain(emoji, count) {
  const layer = document.createElement('div');
  layer.className = 'emoji-rain';
  document.body.appendChild(layer);

  for (let i = 0; i < (count || 26); i++) {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.style.left = Math.random() * 100 + 'vw';
    span.style.fontSize = (Math.random() * 22 + 20) + 'px';
    span.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
    span.style.animationDuration = (Math.random() * 1.6 + 2.4).toFixed(2) + 's';
    layer.appendChild(span);
  }
  setTimeout(() => layer.remove(), 5200);
}

function shakeScreen() {
  document.body.classList.add('shaking');
  setTimeout(() => document.body.classList.remove('shaking'), 700);
}

function initEasterEggs() {
  const KONAMI = 'arrowup,arrowup,arrowdown,arrowdown,arrowleft,arrowright,arrowleft,arrowright,b,a';

  // typed words → surprise. Each entry fires once per typing, then clears.
  const WORDS = [
    { word: 'moon',    run: () => { unlock('moon'); launchRocket(); toast('🚀', 'To the moon!', 'BTC bhi khush ho gaya'); } },
    { word: 'chai',    run: () => { unlock('chai'); emojiRain('☕', 24); toast('☕', 'Chai break!', 'Rates baad mein, pehle chai'); chime(440, 587); } },
    { word: 'biryani', run: () => { unlock('biryani'); emojiRain('🍛', 26); toast('🍛', 'Biryani time!', 'Aloo wali hi asli hai, larai mat karo'); chime(392, 523); } },
    { word: 'paisa',   run: () => { unlock('paisa'); emojiRain('💸', 34); toast('💸', 'Paisa hi paisa!', 'Sirf screen pe — asli wala kahan hai?'); chime(523, 784); } },
    { word: 'boom',    run: () => { unlock('boom'); shakeScreen(); toast('💥', 'BOOM BOOM!', 'Afridi ne chakka mara'); chime(330, 440); } },
  ];

  let keyBuf = [];
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    keyBuf.push(e.key.toLowerCase());
    if (keyBuf.length > 14) keyBuf.shift();

    if (keyBuf.slice(-10).join(',') === KONAMI) {
      keyBuf = [];
      unlock('konami');
      matrixRain(5000);
      chime(392, 523);
      return;
    }
    for (const w of WORDS) {
      if (keyBuf.slice(-w.word.length).join('') === w.word) {
        keyBuf = [];
        w.run();
        return;
      }
    }
  });

  // tap BTC five times → diamond hands
  let btcClicks = 0, btcTimer;
  document.addEventListener('click', e => {
    const item = e.target.closest('.crypto-item');
    if (!item) return;
    const sym = item.querySelector('.crypto-symbol')?.textContent?.trim().toLowerCase();
    if (sym !== 'btc') return;
    btcClicks++;
    clearTimeout(btcTimer);
    btcTimer = setTimeout(() => { btcClicks = 0; }, 3000);
    if (btcClicks >= 5) {
      btcClicks = 0;
      unlock('diamond');
      toast('💎🙌', 'Diamond Hands', 'HODL till death!');
      chime(523, 659);
    }
  });

  // click the banter line → instant fresh roast
  el('banter')?.addEventListener('click', () => {
    showBanter();
    unlock('roasted');
  });

  // spam the refresh button → get roasted for it
  let refreshHits = 0, refreshTimer;
  el('refreshAll')?.addEventListener('click', () => {
    refreshHits++;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshHits = 0; }, 12000);
    if (refreshHits === 8) {
      unlock('impatient');
      toast('😮‍💨', 'Sabar karo!', 'Itna refresh karne se rate nahi badlega');
      shakeScreen();
    }
  });

  // walk away for a while → the site notices
  let idleTimer;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.visibilityState === 'visible' && el('zenOverlay')?.hidden !== false) {
        unlock('sleepy');
        toast('😴', 'So gaye kya?', 'Screen khuli hai, tum ghayab ho');
      }
    }, 120000);
  };
  ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(ev =>
    document.addEventListener(ev, resetIdle, { passive: true })
  );
  resetIdle();
}

// ── Init ──────────────────────────────────────────────────────────────────────

// External artwork (coin logos, album art) that fails to load is hidden
// rather than left as a broken-image icon.
document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
}, true);

document.addEventListener('DOMContentLoaded', () => {
  cleanupStorage();
  applyTheme(THEMES.includes(profile.theme) ? profile.theme : 'midnight');
  trackVisit();
  renderLevel();
  showBanter();
  renderGameIdle();
  initSearch();
  initEasterEggs();
  initPWA();
  updateNetStatus();

  switchTab(initialTab());
  tickClock();

  // other tabs load in the background so search finds everything and
  // switching tabs is instant
  setTimeout(() => Object.keys(TABS).filter(t => t !== activeTab).forEach(t => loadTab(t)), 2500);

  setInterval(tickClock, 1000);
  setInterval(() => loadTab(activeTab), 60 * 1000); // reloads only what's stale
  setInterval(showBanter, 45 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadTab(activeTab);
  });
  window.addEventListener('online', () => { updateNetStatus(); loadTab(activeTab, true); });
  window.addEventListener('offline', updateNetStatus);
  window.addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (TABS[t] && t !== activeTab) switchTab(t);
  });

  el('tabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab, { scroll: true });
  });

  el('refreshAll').addEventListener('click', refreshNow);
  el('brand').addEventListener('click', () => { unlock('confetti'); burstConfetti(); });
  el('themeBtn').addEventListener('click', cycleTheme);
  el('zenBtn').addEventListener('click', enterZen);
  el('zenExit').addEventListener('click', exitZen);
  el('chartClose').addEventListener('click', closeChart);
  el('chartBackdrop').addEventListener('click', closeChart);

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    const tabKeys = Object.keys(TABS);
    if (k >= '1' && k <= String(tabKeys.length)) switchTab(tabKeys[+k - 1], { scroll: true });
    else if (k === 'r') refreshNow();
    else if (k === 't') cycleTheme();
    else if (k === 'z') el('zenOverlay').hidden ? enterZen() : exitZen();
    else if (k === 'escape') {
      if (!el('chartModal').hidden) closeChart();
      else if (!el('zenOverlay').hidden) exitZen();
    }
  });

  document.addEventListener('click', e => {
    const play = e.target.closest('.play-btn');
    if (play) { togglePreview(play); return; }
    const pk = e.target.closest('.pakcom-item');
    if (pk) openChart(+pk.dataset.si, +pk.dataset.ii);
  });
});
