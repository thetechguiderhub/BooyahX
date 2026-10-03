/* ============================================
   BOOYAHX — TEAMS PAGE (public)
   Real teams from the database only.
   ============================================ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function loadTeams() {
  const grid = document.getElementById('teams-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING…</h3></div>';

  try {
    const data = await DataService.Teams.all();
    const teams = data.teams || [];

    if (!teams.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div>
        <h3 data-i18n="empty.teams">NO TEAMS AVAILABLE</h3>
        <p data-i18n="empty.teams_sub">Teams appear here once players create them.</p></div>`;
      try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
      return;
    }

    grid.innerHTML = `<div class="teams-grid">` + teams.map(t => `
      <div class="team-card">
        <div class="team-head">
          <span class="team-logo">${esc((t.tag || t.name || '?').slice(0, 2).toUpperCase())}</span>
          <div>
            <h4>${esc(t.name)}</h4>
            <span class="team-meta">${esc(t.tag || 'NO TAG')}</span>
          </div>
        </div>
        ${t.description ? `<p class="team-desc">${esc(t.description)}</p>` : ''}
        <div class="team-stats">
          <span><strong>${esc(t.member_count || 0)}</strong> / 4 members</span>
          <span>Captain: <strong>${esc(t.captain_username || 'Available')}</strong></span>
        </div>
      </div>`).join('') + `</div>`;
  } catch (err) {
    const msg = err.message === 'BACKEND UNAVAILABLE' ? 'BACKEND UNAVAILABLE' : 'COULD NOT LOAD TEAMS';
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>${esc(msg)}</h3></div>`;
  }
}

document.addEventListener('DOMContentLoaded', loadTeams);
