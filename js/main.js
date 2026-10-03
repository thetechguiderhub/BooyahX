/* ============================================
   BOOYAHX — MAIN JAVASCRIPT
   Real Backend API Integration
   ============================================ */

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatCoins(amount) {
  return `${amount} Coins`;
}

function getStatusClass(status) {
  return `status-${status.replace(/\s+/g, '-').toLowerCase()}`;
}

function getStatusLabel(status) {
  const labels = {
    'upcoming': 'Upcoming',
    'waiting': 'Waiting',
    'almost_full': 'Almost Full',
    'full': 'Full',
    'starting': 'Starting',
    'live': 'Live',
    'results_pending': 'Results Pending',
    'completed': 'Completed',
    'cancelled': 'Cancelled'
  };
  return labels[status] || status;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function getToastIcon(type) {
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  return icons[type] || icons.info;
}

// ============================================
// NAVIGATION
// ============================================

function initNavigation() {
  const navbar = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 10) {
      navbar?.classList.add('scrolled');
    } else {
      navbar?.classList.remove('scrolled');
    }
  });

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      mobileMenu.classList.toggle('open');
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        mobileMenu.classList.remove('open');
      });
    });
  }
}

// ============================================
// TOURNAMENT RENDERING
// ============================================

function renderTournamentCard(tournament) {
  const fillPercent = tournament.player_limit > 0 ? (tournament.players / tournament.player_limit) * 100 : 0;
  const isFull = tournament.players >= tournament.player_limit;
  const isLive = tournament.status === 'live';
  const isCompleted = tournament.status === 'completed';

  let buttonText = 'JOIN TOURNAMENT';
  let buttonKey = 'btn.join_tournament';
  let buttonClass = 'btn-primary';
  let buttonDisabled = false;

  if (isFull) {
    buttonText = 'FULL';
    buttonKey = 'status.full';
    buttonClass = 'btn-secondary';
    buttonDisabled = true;
  } else if (isLive) {
    buttonText = 'LIVE';
    buttonKey = 'status.live';
    buttonClass = 'btn-danger';
    buttonDisabled = true;
  } else if (isCompleted) {
    buttonText = 'VIEW RESULTS';
    buttonKey = 'btn.view_results';
    buttonClass = 'btn-secondary';
  }

  return `
    <div class="tournament-card" data-id="${tournament.id}">
      <div class="card-header">
        <span class="tournament-id">${tournament.id}</span>
        <span class="status-badge ${getStatusClass(tournament.status)}">
          <span class="status-dot"></span>
          <span data-i18n="status.${tournament.status}">${getStatusLabel(tournament.status)}</span>
        </span>
      </div>
      <h3 class="tournament-title">${tournament.mode}</h3>
      <p class="tournament-mode">${tournament.format}</p>
      <div class="tournament-info">
        <div class="info-item">
          <span class="info-label" data-i18n="card.entry">Entry</span>
          <span class="info-value">${tournament.entry_cost} Coins</span>
        </div>
        <div class="info-item">
          <span class="info-label" data-i18n="card.starts">Starts</span>
          <span class="info-value">${tournament.start_time}</span>
        </div>
      </div>
      <div class="player-count">
        <span class="info-value">${tournament.players} / ${tournament.player_limit}</span>
        <div class="player-count-bar">
          <div class="player-count-fill" style="width: ${fillPercent}%"></div>
        </div>
        <span class="info-label" data-i18n="card.players">Players</span>
      </div>
      <div class="rewards-preview">
        <span class="reward-icon">🏆</span>
        <span>${tournament.reward_1st} / ${tournament.reward_2nd} / ${tournament.reward_3rd} / ${tournament.reward_other} Coins</span>
      </div>
      <div class="card-footer">
        <span></span>
        <button class="btn ${buttonClass} btn-sm" data-i18n="${buttonKey}" ${buttonDisabled ? 'disabled' : ''} onclick="handleJoinTournament('${tournament.id}')">
          ${buttonText}
        </button>
      </div>
    </div>
  `;
}

function applyI18n() {
  try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
}

function renderTournaments(tournaments, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!tournaments || tournaments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎮</div>
        <h3 data-i18n="empty.tournaments">NO TOURNAMENTS AVAILABLE</h3>
        <p data-i18n="empty.tournaments_sub">There are currently no tournaments available. Check back soon for new competitions.</p>
      </div>
    `;
    applyI18n();
    return;
  }

  container.innerHTML = `<div class="grid grid-3">${tournaments.map(renderTournamentCard).join('')}</div>`;
  applyI18n();
}

// ============================================
// API FUNCTIONS
// ============================================

async function loadTournaments() {
  const container = document.getElementById('tournaments-grid');
  if (!container) return;

  container.innerHTML = '<div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div><div class="skeleton skeleton-button"></div></div>';

  try {
    // Collect active filters from the page
    const params = {};
    const activeFilter = document.querySelector('.filter-tab.active')?.dataset.filter;
    if (activeFilter && activeFilter !== 'all') {
      if (['CS', 'BR'].includes(activeFilter)) params.mode = activeFilter === 'CS' ? 'Clash Squad' : 'Battle Royale';
      else params.status = activeFilter;
    }
    const searchInput = document.getElementById('tournament-search');
    if (searchInput && searchInput.value.trim()) params.search = searchInput.value.trim();

    const data = await DataService.Tournaments.getAll(params);
    // API responds { tournaments: [...] } — unwrap before rendering
    renderTournaments(Array.isArray(data) ? data : (data.tournaments || []), 'tournaments-grid');
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3 data-i18n="error.unable_load">UNABLE TO LOAD DATA</h3>
        <p>${error.message}</p>
        <button class="btn btn-primary" data-i18n="btn.retry" onclick="loadTournaments()">RETRY</button>
      </div>
    `;
    applyI18n();
  }
}

async function handleJoinTournament(id) {
  try {
    showToast('Joining tournament...', 'info');
    const result = await DataService.Tournaments.join(id);
    showToast(result.message || 'Successfully joined tournament!', 'success');
    loadTournaments();
  } catch (error) {
    showToast(error.message || 'Failed to join tournament', 'error');
  }
}

function handleFilterClick(filter) {
  document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelector(`[data-filter="${filter}"]`)?.classList.add('active');
  loadTournaments();
}

function handleSearch(searchValue) {
  loadTournaments();
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadTournaments();

  // Auth forms
  const signinForm = document.getElementById('signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      try {
        showToast('Signing in...', 'info');
        const result = await DataService.Auth.signin({ email, password });
        showToast('Signed in successfully!', 'success');
        setTimeout(() => window.location.href = 'index.html', 1000);
      } catch (error) {
        showToast(error.message || 'Sign in failed', 'error');
      }
    });
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = {
        name: document.getElementById('signup-name').value.trim(),
        username: document.getElementById('signup-username').value.trim(),
        email: document.getElementById('signup-email').value.trim(),
        password: document.getElementById('signup-password').value,
        confirmPassword: document.getElementById('signup-confirm-password').value,
        termsAccepted: document.getElementById('signup-terms').checked
      };

      try {
        showToast('Creating account...', 'info');
        const result = await DataService.Auth.signup(formData);
        showToast('Account created successfully!', 'success');
        setTimeout(() => window.location.href = 'index.html', 1000);
      } catch (error) {
        showToast(error.message || 'Sign up failed', 'error');
      }
    });
  }

  // Search
  const searchInput = document.getElementById('tournament-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  }
});
