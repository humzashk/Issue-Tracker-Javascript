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

function setHTML(id, html) {
  const t = el(id);
  if (t) t.innerHTML = html;
}

function showLoading(id) {
  setHTML(id, '<div class="loading-state"><div class="spinner"></div></div>');
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
          <img class="crypto-img" src="${safeUrl(c.image)}" alt="${esc(c.name)}" width="26" height="26" loading="lazy">
          <div>
            <div class="crypto-symbol">${esc(c.symbol)}</div>
            <div class="crypto-name">${esc(c.name)}</div>
          </div>
        </div>
        <div class="crypto-price-group">
          <div class="crypto-price">${c.currency === 'PKR' ? fmtPKR(c.current_price) : fmtPrice(c.current_price)}</div>
          <div class="crypto-change">${fmtChange(c.price_change_percentage_24h)}</div>
        </div>
      </div>
      ${sparklineSVG(spark, up)}
    </div>`;
  }).join('');

  setHTML('crypto-content', `<div class="crypto-grid">${items}</div>`);
}

function renderCommodities(data) {
  if (!data?.length) { showError('commodities-content', 'No data returned'); return; }

  const icons = { gold: '🥇', silver: '🥈', copper: '🟤', 'oil-brent': '🛢️', 'oil-wti': '🛢️' };

  const items = data.map(c => `
    <div class="commodity-item">
      <div class="commodity-name-group">
        <span class="commodity-icon">${icons[c.id] || '📊'}</span>
        <div>
          <div class="commodity-label">${esc(c.name)}</div>
          <div class="commodity-sub">${esc(c.unit)}</div>
        </div>
      </div>
      <div class="commodity-price-group">
        <div class="commodity-price">${c.currency === 'PKR' ? fmtPKR(c.price) : fmtPrice(c.price, 2)}</div>
        <div class="commodity-unit">${c.currency || 'USD'}</div>
      </div>
    </div>
  `).join('');

  setHTML('commodities-content', `<div class="commodity-list">${items}</div>`);
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
    </div>
  `).join('');

  setHTML(id, `<div class="ranked-list">${items}</div>`);
}

function renderConverter(data) {
  if (!data?.usdToPkr) { showError('converter-content', 'Rate unavailable'); return; }
  state.forex = data;
  setHTML('converter-content', `
    <div class="conv-wrap">
      <div class="conv-rate">1 USD = <strong>${data.usdToPkr.toFixed(2)} PKR</strong></div>
      <div class="conv-row"><label>USD</label><input class="conv-input" id="convUsd" type="number" inputmode="decimal" placeholder="1.00"></div>
      <button class="conv-swap" id="convSwap" title="Swap values">⇅</button>
      <div class="conv-row"><label>PKR</label><input class="conv-input" id="convPkr" type="number" inputmode="decimal" placeholder="${data.usdToPkr.toFixed(2)}"></div>
      ${data.updated ? `<div class="conv-updated">Rate updated: ${data.updated}</div>` : ''}
    </div>
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

const searchIndex = { crypto: [], commodities: [], movies: [], music: [] };

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

  const all = [
    ...searchIndex.crypto,
    ...searchIndex.commodities,
    ...searchIndex.movies,
    ...searchIndex.music,
  ];

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
    <div class="search-result-item" data-scroll="${r.type}-card">
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
    if (!e.target.closest('.search-bar-wrap')) box.hidden = true;
  });

  box.addEventListener('click', e => {
    const item = e.target.closest('[data-scroll]');
    if (!item) return;
    const type = item.dataset.scroll;
    const card = document.querySelector(`[id*="${type.split('-')[0]}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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

// ── 3D card tilt + cursor glow ────────────────────────────────────────────────

function initTilt() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (matchMedia('(pointer: coarse)').matches) return;

  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      const rx = (0.5 - py) * 4;
      const ry = (px - 0.5) * 4;
      card.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

// ── Modules ───────────────────────────────────────────────────────────────────

const MODULES = [
  {
    name: 'crypto',
    endpoint: '/api/crypto',
    render: data => {
      state.crypto = data;
      renderCrypto(data);
      rebuildTicker();
      indexCrypto(data);
      if (!game.active) renderGameIdle();
    },
  },
  {
    name: 'mood',
    endpoint: '/api/mood',
    render: data => renderMood(data),
  },
  {
    name: 'commodities',
    endpoint: '/api/commodities',
    render: data => { state.commodities = data; renderCommodities(data); rebuildTicker(); indexCommodities(data); },
  },
  {
    name: 'converter',
    endpoint: '/api/forex',
    render: data => renderConverter(data),
  },
  {
    name: 'movies',
    endpoint: '/api/movies',
    render: data => { renderRanked('movies-content', data); indexRanked('movies', data); },
  },
  {
    name: 'music',
    endpoint: '/api/music',
    render: data => { renderRanked('music-content', data); indexRanked('music', data); },
  },
];

async function loadModule(mod) {
  const id = `${mod.name}-content`;
  showLoading(id);
  try {
    const data = await apiFetch(mod.endpoint);
    mod.render(data);
  } catch (err) {
    console.error(`[${mod.name}]`, err);
    showError(id, err.message);
  }
}

async function loadAll() {
  const btn = el('refreshAll');
  if (btn) btn.classList.add('spinning');
  await Promise.allSettled(MODULES.map(loadModule));
  if (btn) btn.classList.remove('spinning');
  awardXP(1);
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function tickClock() {
  const t = new Date().toLocaleTimeString('en-PK', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const clock = el('pkClock');
  if (clock) clock.textContent = t + ' PKT';
  const zc = el('zenClock');
  if (zc && !el('zenOverlay').hidden) zc.textContent = t;
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

function initEasterEggs() {
  const KONAMI = 'arrowup,arrowup,arrowdown,arrowdown,arrowleft,arrowright,arrowleft,arrowright,b,a';
  let keyBuf = [];
  document.addEventListener('keydown', e => {
    keyBuf.push(e.key.toLowerCase());
    if (keyBuf.length > 12) keyBuf.shift();
    if (keyBuf.slice(-10).join(',') === KONAMI) {
      keyBuf = [];
      unlock('konami');
      matrixRain(5000);
      chime(392, 523);
    }
    if (keyBuf.slice(-4).join('') === 'moon') {
      keyBuf = [];
      unlock('moon');
      launchRocket();
      toast('🚀', 'To the moon!', 'BTC bhi khush ho gaya');
    }
  });

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
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(THEMES.includes(profile.theme) ? profile.theme : 'midnight');
  trackVisit();
  renderLevel();
  showBanter();
  renderGameIdle();
  initSearch();
  loadAll();
  tickClock();
  initTilt();
  initEasterEggs();

  setInterval(tickClock, 1000);
  setInterval(loadAll, 5 * 60 * 1000);
  setInterval(showBanter, 45 * 1000);

  el('refreshAll')?.addEventListener('click', loadAll);
  el('brand')?.addEventListener('click', () => { unlock('confetti'); burstConfetti(); });
  el('themeBtn')?.addEventListener('click', cycleTheme);
  el('zenBtn')?.addEventListener('click', enterZen);
  el('zenExit')?.addEventListener('click', exitZen);

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'r') loadAll();
    else if (k === 't') cycleTheme();
    else if (k === 'z') el('zenOverlay').hidden ? enterZen() : exitZen();
    else if (k === 'escape' && !el('zenOverlay').hidden) exitZen();
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-refresh]');
    if (!btn) return;
    const mod = MODULES.find(m => m.name === btn.dataset.refresh);
    if (mod) loadModule(mod);
  });
});
