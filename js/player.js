/* ============================================
   BOOYAHX — PLAYER PROFILE PAGE
   Stats computed by the server from published
   results only. No data → honest empty state.
   ============================================ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function statTile(label, value) {
  return `<div class="stat-card"><span class="stat-value">${esc(value)}</span>
    <span class="stat-label">${esc(label)}</span></div>`;
}

async function loadPlayer() {
  const el = document.getElementById('player-content');
  if (!el) return;

  const username = new URLSearchParams(window.location.search).get('u');
  if (!username) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>
      <h3>NO PLAYER SPECIFIED</h3>
      <p>Pick a player from the <a href="leaderboard.html">leaderboard</a>.</p></div>`;
    return;
  }

  try {
    const data = await DataService.Players.stats(username);
    const p = data.player;
    const s = data.stats;
    const achs = data.achievements || [];

    const noData = !s.has_data;

    el.innerHTML = `
      <div class="section-header">
        <h2>${esc(p.name || p.username)}</h2>
        <p>@${esc(p.username)} · Member since ${esc((p.member_since || '').slice(0, 10))}</p>
      </div>

      ${noData ? `<div class="empty-state"><div class="empty-icon">📊</div>
        <h3>NO PUBLISHED RESULTS YET</h3>
        <p>Statistics appear after tournament results are published.</p></div>` : `
      <div class="stats-grid">
        ${statTile('Tournaments', s.total_tournaments)}
        ${statTile('Wins', s.wins)}
        ${statTile('Win Rate', s.win_rate + '%')}
        ${statTile('BX Coins Earned', s.coins_earned)}
        ${statTile('2nd Place', s.second_place)}
        ${statTile('3rd Place', s.third_place)}
        ${statTile('Best Streak', s.best_streak)}
        ${statTile('CS Wins', s.cs.wins + ' / ' + s.cs.tournaments)}
        ${statTile('BR Wins', s.br.wins + ' / ' + s.br.tournaments)}
      </div>`}

      <div class="section-header" style="margin-top:48px;">
        <h3>ACHIEVEMENTS</h3>
      </div>
      ${achs.length ? `<div class="achievements-grid">${achs.map(a => `
        <div class="achievement-card unlocked">
          <div class="achievement-icon">${esc(a.icon || '🎖️')}</div>
          <div class="achievement-body">
            <h4>${esc(a.name)}</h4>
            <p>${esc(a.description)}</p>
          </div>
          <div class="achievement-state">UNLOCKED</div>
        </div>`).join('')}</div>` : `
        <div class="empty-state"><div class="empty-icon">🎖️</div>
          <h3>NO ACHIEVEMENTS UNLOCKED</h3>
          <p>Achievements unlock automatically from real results.</p></div>`}
    `;
  } catch (err) {
    const msg = err.message === 'NOT FOUND' || (err.message || '').includes('Player')
      ? 'PLAYER NOT FOUND'
      : err.message === 'BACKEND UNAVAILABLE' ? 'BACKEND UNAVAILABLE' : 'COULD NOT LOAD PLAYER';
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>
      <h3>${esc(msg)}</h3>
      <p><a href="leaderboard.html">Back to leaderboard</a></p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', loadPlayer);
