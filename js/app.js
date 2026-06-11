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

// Latest data kept around so the ticker tape can rebuild from it
const state = { crypto: null, commodities: null };

// ── Sparklines ────────────────────────────────────────────────────────────────

function sparklineSVG(prices, up) {
  if (!prices?.length) return '';
  // Downsample to ~40 points
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
  // Content duplicated so the -50% translate loops seamlessly
  const half = ticks.join('');
  track.innerHTML = half + half;
}

// ── Modules ───────────────────────────────────────────────────────────────────

const MODULES = [
  {
    name: 'crypto',
    endpoint: '/api/crypto',
    render: data => { state.crypto = data; renderCrypto(data); rebuildTicker(); },
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
  const upd = el('lastUpdated');
  if (upd) upd.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ── Pakistan clock & greeting ─────────────────────────────────────────────────

function tickClock() {
  const now = new Date();
  const clock = el('pkClock');
  if (clock) {
    clock.textContent = now.toLocaleTimeString('en-PK', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + ' PKT';
  }

  const greet = el('greeting');
  if (greet && !greet.textContent) {
    const hour = parseInt(
      now.toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', hour12: false }),
      10
    );
    greet.textContent =
      hour < 5 ? '🌙 Working late?' :
      hour < 12 ? '☀️ Subah bakhair!' :
      hour < 17 ? '👋 Good afternoon!' :
      hour < 21 ? '🌆 Good evening!' :
      '🌙 Shab bakhair!';
  }
}

// ── Confetti easter egg (click the logo) ──────────────────────────────────────

function burstConfetti() {
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
  loadAll();
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(loadAll, 5 * 60 * 1000);

  el('refreshAll')?.addEventListener('click', loadAll);
  el('brand')?.addEventListener('click', burstConfetti);

  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const tag = document.activeElement?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') loadAll();
    }
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-refresh]');
    if (!btn) return;
    const mod = MODULES.find(m => m.name === btn.dataset.refresh);
    if (mod) loadModule(mod);
  });
});
