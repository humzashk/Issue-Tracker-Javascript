'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

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
  setHTML(id, `<div class="error-state"><span class="error-icon">⚠️</span><p class="error-message">${msg}</p></div>`);
}

async function apiFetch(endpoint) {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'API error');
  return json.data;
}

const state = { crypto: null, commodities: null };

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
          <img class="crypto-img" src="${c.image}" alt="${c.name}" width="26" height="26" loading="lazy">
          <div>
            <div class="crypto-symbol">${c.symbol}</div>
            <div class="crypto-name">${c.name}</div>
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
          <div class="commodity-label">${c.name}</div>
          <div class="commodity-sub">${c.unit}</div>
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
      <div class="mood-label" style="color:${color}">${data.label}</div>
      ${delta != null ? `<div class="mood-delta">${delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} ${Math.abs(delta)} vs yesterday</div>` : ''}
    </div>
  `);
}

function renderMatches(id, data) {
  if (!data?.length) {
    setHTML(id, '<p class="empty-message">No recent matches found.</p>');
    return;
  }

  const items = data.map(m => `
    <div class="match-item">
      <div class="match-meta">${m.competition || ''}${m.competition && m.date ? ' · ' : ''}${m.date || ''}</div>
      <div class="match-score">
        <span class="match-team home">${m.homeTeam}</span>
        <span class="match-result">${m.score || 'vs'}</span>
        <span class="match-team away">${m.awayTeam}</span>
      </div>
      ${m.status ? `<div class="match-status${m.status === 'In Progress' ? ' live' : ''}">${m.status}</div>` : ''}
    </div>
  `).join('');

  setHTML(id, `<div class="match-list">${items}</div>`);
}

function renderCricket(data) {
  if (!data?.length) {
    setHTML('cricket-content', '<p class="empty-message">No live matches at the moment.</p>');
    return;
  }

  const items = data.map(m => `
    <div class="match-item">
      <div class="match-meta">${m.matchType || ''}${m.matchType && m.date ? ' · ' : ''}${m.date || ''}</div>
      <div class="match-score">
        <span class="match-team home">${m.homeTeam}</span>
        <span class="match-result">vs</span>
        <span class="match-team away">${m.awayTeam}</span>
      </div>
      ${m.scoreLines?.length ? `<div class="cricket-score">${m.scoreLines.join('<br>')}</div>` : ''}
      ${m.status ? `<div class="match-status">${m.status}</div>` : ''}
    </div>
  `).join('');

  setHTML('cricket-content', `<div class="match-list">${items}</div>`);
}

function renderRanked(id, data) {
  if (!data?.length) { setHTML(id, '<p class="empty-message">No data available.</p>'); return; }

  const items = data.map((item, i) => `
    <div class="ranked-item">
      <span class="ranked-num${i < 3 ? ' top3' : ''}">${i + 1}</span>
      ${item.image ? `<img class="ranked-thumb" src="${item.image}" alt="" width="36" height="36" loading="lazy">` : ''}
      <div class="ranked-info">
        <div class="ranked-title">${item.title}</div>
        ${item.subtitle ? `<div class="ranked-sub">${item.subtitle}</div>` : ''}
      </div>
    </div>
  `).join('');

  setHTML(id, `<div class="ranked-list">${items}</div>`);
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
      `<span class="tick"><span class="tick-sym">${(c.symbol || '').toUpperCase()}</span>` +
      `<span class="tick-price">${fmtPKR(c.current_price)}</span>` +
      `<span class="${cls}">${pct != null ? (pct > 0 ? '▲' : pct < 0 ? '▼' : '') + Math.abs(pct).toFixed(2) + '%' : ''}</span></span>`
    );
  }

  for (const c of state.commodities ?? []) {
    ticks.push(
      `<span class="tick"><span class="tick-sym">${c.name.toUpperCase()}</span>` +
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
];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function showBanter() {
  const b = el('banter');
  if (b) {
    const line = pick(BANTER);
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
    render: data => { state.commodities = data; renderCommodities(data); rebuildTicker(); },
  },
  {
    name: 'cricket',
    endpoint: '/api/cricket',
    render: data => renderCricket(data),
  },
  {
    name: 'football',
    endpoint: '/api/football',
    render: data => renderMatches('football-content', data),
  },
  {
    name: 'movies',
    endpoint: '/api/movies',
    render: data => renderRanked('movies-content', data),
  },
  {
    name: 'music',
    endpoint: '/api/music',
    render: data => renderRanked('music-content', data),
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

function burstConfetti() {
  unlock('confetti');
  let canvas = el('confettiCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    document.body.appendChild(canvas);
  }
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#7c5cfc', '#22d3a4', '#fbbf24', '#f43f5e', '#38bdf8', '#a78bfa'];
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

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(THEMES.includes(profile.theme) ? profile.theme : 'midnight');
  trackVisit();
  renderLevel();
  showBanter();
  renderGameIdle();
  loadAll();
  tickClock();
  initTilt();

  setInterval(tickClock, 1000);
  setInterval(loadAll, 5 * 60 * 1000);

  el('refreshAll')?.addEventListener('click', loadAll);
  el('brand')?.addEventListener('click', burstConfetti);
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
