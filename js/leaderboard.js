/* ============================================
   BOOYAHX — LEADERBOARD PAGE
   Real data from published tournament results.
   Empty state when no results are published.
   ============================================ */

let lbMode = 'all';
let lbPeriod = 'all';

function setLbMode(mode) {
  lbMode = mode;
  document.querySelectorAll('[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  loadLeaderboard();
}

function setLbPeriod(period) {
  lbPeriod = period;
  document.querySelectorAll('[data-period]').forEach(b =>
    b.classList.toggle('active', b.dataset.period === period));
  loadLeaderboard();
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function emptyState(title, sub, key) {
  return `<div class="empty-state"><div class="empty-icon">🏆</div>
    <h3${key ? ` data-i18n="${key}"` : ''}>${esc(title)}</h3><p${key ? ` data-i18n="${key}_sub"` : ''}>${esc(sub)}</p></div>`;
}

function errorState(message, key) {
  return `<div class="empty-state"><div class="empty-icon">⚠️</div>
    <h3${key ? ` data-i18n="${key}"` : ''}>${esc(message)}</h3>
    <p data-i18n="error.retry_sub">The server could not be reached. Please try again.</p></div>`;
}

function applyI18n() {
  try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
}

async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-content');
  if (!el) return;

  el.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING…</h3></div>';

  try {
    const params = { period: lbPeriod };
    if (lbMode !== 'all') params.mode = lbMode;
    const data = await DataService.Leaderboard.get(params);
    const rows = data.leaderboard || [];

    if (!rows.length) {
      el.innerHTML = emptyState('NO LEADERBOARD DATA AVAILABLE',
        'Rankings appear once tournament results are published.', 'lb.empty');
      applyI18n();
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th data-i18n="lb.rank">Rank</th>
              <th data-i18n="lb.player">Player</th>
              <th data-i18n="lb.wins">Wins</th>
              <th data-i18n="lb.tournaments">Tournaments</th>
              <th data-i18n="lb.win_rate">Win Rate</th>
              <th data-i18n="lb.coins_earned">Coins Earned</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><span class="rank-badge">${r.rank <= 3 ? medals[r.rank - 1] : '#' + r.rank}</span></td>
                <td><a href="player.html?u=${encodeURIComponent(r.username)}" class="player-link">${esc(r.username)}</a></td>
                <td>${esc(r.wins)}</td>
                <td>${esc(r.tournaments)}</td>
                <td>${esc(r.win_rate)}%</td>
                <td>${esc(r.coins_earned)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="table-note">Computed from published results only — ${esc(data.computed_from)}</p>`;
    applyI18n();
  } catch (err) {
    const isBackend = err.message === 'BACKEND UNAVAILABLE';
    el.innerHTML = errorState(isBackend ? 'BACKEND UNAVAILABLE' : 'COULD NOT LOAD LEADERBOARD',
      isBackend ? 'error.backend' : 'lb.error');
    applyI18n();
  }
}

document.addEventListener('DOMContentLoaded', loadLeaderboard);
