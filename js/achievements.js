/* ============================================
   BOOYAHX — ACHIEVEMENTS PAGE
   Definitions from DB; unlocks come from the
   signed-in account only (or nothing for guests).
   ============================================ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function parseCriteria(raw) {
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

function criteriaLabel(c) {
  if (c.type === 'wins') return `Win ${c.target} tournament${c.target === 1 ? '' : 's'}`;
  if (c.type === 'tournaments') return `Play ${c.target} tournament${c.target === 1 ? '' : 's'}`;
  if (c.type === 'mode_win') return `Win a ${c.mode} tournament`;
  if (c.type === 'deposits') return `Make ${c.target} deposits`;
  return 'Complete matches to unlock';
}

async function loadAchievements() {
  const grid = document.getElementById('achievements-grid');
  const progress = document.getElementById('my-progress');
  if (!grid) return;

  grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING…</h3></div>';

  try {
    const data = await DataService.Achievements.all();
    const defs = data.achievements || [];
    const unlocked = new Set((data.my_unlocks || []).map(u => u.key));

    let signedIn = Boolean(data.authenticated);

    if (!signedIn) {
      progress.innerHTML = '';
    } else {
      const unlockedCount = defs.filter(a => unlocked.has(a.key)).length;
      progress.innerHTML = `<div class="progress-banner">
        <span>${unlockedCount} of ${defs.length} unlocked</span>
      </div>`;
    }

    if (!defs.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎖️</div>
        <h3 data-i18n="empty.achievements_available">NO ACHIEVEMENTS AVAILABLE</h3>
        <p data-i18n="empty.achievements_sub">Achievement definitions appear here once configured.</p></div>`;
      try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
      return;
    }

    grid.innerHTML = defs.map(a => {
      const isUnlocked = unlocked.has(a.key);
      const criteria = parseCriteria(a.criteria);
      return `<div class="achievement-card${isUnlocked ? ' unlocked' : ''}">
        <div class="achievement-icon">${esc(a.icon || '🎖️')}</div>
        <div class="achievement-body">
          <h4>${esc(a.name)}</h4>
          <p>${esc(a.description)}</p>
          <span class="achievement-criteria">${esc(criteriaLabel(criteria))}</span>
        </div>
        <div class="achievement-state" data-i18n="${isUnlocked ? 'ach.unlocked' : 'ach.locked'}">${isUnlocked ? 'UNLOCKED' : 'LOCKED'}</div>
      </div>`;
    }).join('');
    try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
  } catch (err) {
    const isBackend = err.message === 'BACKEND UNAVAILABLE';
    const msg = isBackend ? 'BACKEND UNAVAILABLE' : 'COULD NOT LOAD ACHIEVEMENTS';
    const key = isBackend ? 'error.backend' : 'achievements.error';
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3 data-i18n="${key}">${esc(msg)}</h3></div>`;
    try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
  }
}

document.addEventListener('DOMContentLoaded', loadAchievements);
