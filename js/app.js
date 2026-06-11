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
  return 'Rs ' + Math.round(n).toLocaleString('en-US');
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

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderCrypto(data) {
  if (!data?.length) { showError('crypto-content', 'No data returned'); return; }

  const items = data.map(c => `
    <div class="crypto-item">
      <div class="crypto-info">
        <span class="crypto-rank">${c.market_cap_rank}</span>
        <img class="crypto-img" src="${c.image}" alt="${c.name}" width="22" height="22" loading="lazy">
        <div class="crypto-name-group">
          <div class="crypto-symbol">${c.symbol}</div>
          <div class="crypto-name">${c.name}</div>
        </div>
      </div>
      <div class="crypto-price-group">
        <div class="crypto-price">${fmtPrice(c.current_price)}</div>
        <div class="crypto-change">${fmtChange(c.price_change_percentage_24h)}</div>
      </div>
    </div>
  `).join('');

  setHTML('crypto-content', `<div class="crypto-grid">${items}</div>`);
}

function renderCommodities(data) {
  if (!data?.length) { showError('commodities-content', 'No data returned'); return; }

  const icons = { gold: '🥇', silver: '🥈', copper: '🟤', oil: '🛢️' };

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

// ── Modules ───────────────────────────────────────────────────────────────────

const MODULES = [
  {
    name: 'crypto',
    endpoint: '/api/crypto',
    render: data => renderCrypto(data),
  },
  {
    name: 'commodities',
    endpoint: '/api/commodities',
    render: data => renderCommodities(data),
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

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadAll();

  setInterval(loadAll, 5 * 60 * 1000);

  el('refreshAll')?.addEventListener('click', loadAll);

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-refresh]');
    if (!btn) return;
    const mod = MODULES.find(m => m.name === btn.dataset.refresh);
    if (mod) loadModule(mod);
  });
});
