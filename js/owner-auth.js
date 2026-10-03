/* ============================================
   BOOYAHX — OWNER AUTHENTICATION & AUTHORIZATION
   Real Backend Integration
   Roles and permissions come from the server.
   The frontend NEVER decides access — it only
   reflects what the backend reports.
   ============================================ */

const OwnerAuth = (() => {
  'use strict';

  let currentUser = null;
  let accessLoaded = false;

  async function fetchMe() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.status === 401) return null;
      if (!response.ok) return null;
      const data = await response.json();
      currentUser = data.user;
      accessLoaded = true;
      return currentUser;
    } catch (_) {
      accessLoaded = true;
      return null;
    }
  }

  async function checkAuth() {
    if (!accessLoaded) await fetchMe();
    return currentUser;
  }

  /**
   * Sign in and cache the session user.
   * Returns the /api/auth/signin payload ({ user, ... }).
   */
  async function authenticate(email, password) {
    const response = await fetch('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
      throw new Error((data && data.error) || 'Authentication failed');
    }
    currentUser = data.user;
    accessLoaded = true;
    return data;
  }

  /**
   * Sign out WITHOUT redirecting (callers navigate themselves).
   */
  async function logout() {
    try { await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' }); } catch (_) {}
    currentUser = null;
    accessLoaded = false;
  }

  /**
   * True when the backend grants any console permission at all.
   * Permission source is the server — never a hardcoded role list here.
   */
  function canAccessConsole() {
    if (!currentUser) return false;
    if (currentUser.isPrimaryOwner) return true;
    return Array.isArray(currentUser.permissions) && currentUser.permissions.length > 0;
  }

  function getUser() { return currentUser; }

  function hasRole(role) {
    if (!currentUser) return false;
    return Array.isArray(currentUser.roles) && currentUser.roles.includes(role);
  }

  function hasPermission(permission) {
    if (!currentUser) return false;
    if (currentUser.isPrimaryOwner) return true;
    return Array.isArray(currentUser.permissions) && currentUser.permissions.includes(permission);
  }

  /**
   * Require authentication + a permission.
   * Redirects to access-denied.html when the backend says no.
   */
  async function requireAuth(permission) {
    const user = await checkAuth();
    if (!user) {
      window.location.href = 'login.html';
      return false;
    }
    if (permission && !hasPermission(permission)) {
      window.location.href = 'access-denied.html';
      return false;
    }
    return true;
  }

  async function signout() {
    await logout();
    window.location.href = 'login.html';
  }

  return {
    checkAuth, getUser, hasRole, hasPermission, requireAuth, signout,
    authenticate, logout, canAccessConsole,
    refresh: fetchMe
  };
})();

/* ============================================
   OWNER UI — shared layout, dynamic sidebar
   Sidebar items are filtered by permissions
   reported by the backend (role-based nav).
   ============================================ */

const OwnerUI = (() => {
  'use strict';

  // Full owner navigation. Each item declares its permission;
  // items are hidden when the backend session lacks it.
  // console: 'owner' | 'developer' | 'both' — the console mode only affects
  // which UI workspace is shown; permissions always come from the backend.
  const NAV = [
    { section: 'Overview' },
    { page: 'dashboard.html', label: 'Dashboard', icon: '◧', permission: 'dashboard.view', console: 'both' },
    { page: 'analytics.html', label: 'Analytics', icon: '◫', permission: 'analytics.view', console: 'owner' },
    { page: 'money.html', label: 'Money Board', icon: '$', permission: 'moderator.money.view', console: 'both' },
    { page: '../moderator/moderator.html', label: 'Moderator Dashboard', icon: '🛡', permission: 'moderator.dashboard', console: 'both' },

    { section: 'Management' },
    { page: 'tournaments.html', label: 'Tournaments', icon: '◈', permission: 'tournaments.view' },
    { page: 'tournament-create.html', label: 'Create Tournament', icon: '＋', permission: 'tournaments.create' },
    { page: 'templates.html', label: 'Templates', icon: '▤', permission: 'tournaments.templates' },
    { page: 'results.html', label: 'Results', icon: '◎', permission: 'results.view' },
    { page: 'leaderboard.html', label: 'Leaderboard', icon: '▲', permission: 'leaderboard.manage' },
    { page: 'achievements.html', label: 'Achievements', icon: '★', permission: 'achievements.manage' },

    { section: 'People' },
    { page: 'users.html', label: 'Users', icon: '◉', permission: 'users.view' },
    { page: 'team.html', label: 'Team', icon: '⬡', permission: 'staff.view' },
    { page: 'roles.html', label: 'Roles', icon: '⚿', permission: 'roles.view' },
    { page: 'staff.html', label: 'Staff', icon: '☍', permission: 'staff.view' },
    { page: 'verification.html', label: 'Verification', icon: '✔', permission: 'verification.view' },

    { section: 'Finance' },
    { page: 'wallet.html', label: 'Wallets', icon: '◈', permission: 'wallet.view' },
    { page: 'deposits.html', label: 'Deposits', icon: '↓', permission: 'deposits.view' },
    { page: 'withdrawals.html', label: 'Withdrawals', icon: '↑', permission: 'withdrawals.view' },
    { page: 'promo-codes.html', label: 'Promo Codes', icon: '%', permission: 'promos.manage' },

    { section: 'Content' },
    { page: 'events.html', label: 'Events', icon: '◔', permission: 'events.view' },
    { page: 'news.html', label: 'News', icon: '◆', permission: 'news.view' },
    { page: 'updates.html', label: 'Updates', icon: '◈', permission: 'updates.view' },
    { page: 'banners.html', label: 'Banners', icon: '▭', permission: 'banners.manage' },
    { page: 'popups.html', label: 'Popups', icon: '▣', permission: 'popups.manage' },
    { page: 'sponsors.html', label: 'Sponsors', icon: '✪', permission: 'sponsors.manage' },
    { page: 'highlights.html', label: 'Highlights', icon: '▷', permission: 'highlights.manage' },
    { page: 'polls.html', label: 'Polls', icon: '☰', permission: 'polls.manage' },
    { page: 'email.html', label: 'Email', icon: '✉', permission: 'email.manage' },

    { section: 'Support' },
    { page: 'support.html', label: 'Tickets', icon: '☎', permission: 'support.view' },
    { page: 'reports.html', label: 'Reports', icon: '⚑', permission: 'reports.view' },
    { page: 'feedback-view.html', label: 'Feedback', icon: '✎', permission: 'feedback.view' },

    { section: 'System' },
    { page: 'settings.html', label: 'Settings', icon: '⚙', permission: 'settings.view', console: 'owner' },
    { page: 'maintenance.html', label: 'Maintenance', icon: '⚠', permission: 'maintenance.manage', console: 'developer' },
    { page: 'system-health.html', label: 'System Health', icon: '♥', permission: 'systemhealth.view', console: 'developer' },
    { page: 'errors.html', label: 'Error Logs', icon: '⊗', permission: 'errors.view', console: 'developer' },
    { page: 'audit.html', label: 'Audit Logs', icon: '☰', permission: 'audit.view', console: 'both' },
    { page: 'developer.html', label: 'Developer', icon: '⌘', permission: 'developer.view', console: 'developer' },
    { page: 'backup.html', label: 'Backups', icon: '⛁', permission: 'backup.manage', console: 'developer' },
    { page: 'import-export.html', label: 'Import / Export', icon: '⇄', permission: 'importexport.use', console: 'developer' }
  ];

  // Everything not tagged defaults to the owner (business) console.
  NAV.forEach(item => { if (item.page && !item.console) item.console = 'owner'; });

  function consoleModeOf(user) {
    return user && user.console_mode === 'OWNER' ? 'OWNER' : 'DEVELOPER';
  }

  function visibleInConsole(item, mode) {
    return !item.console || item.console === 'both' || item.console === mode.toLowerCase();
  }

  function renderSidebar(activePage, container) {
    const user = OwnerAuth.getUser();
    const el = container || document.querySelector('.owner-sidebar .sidebar-nav') || document.querySelector('.sidebar-nav');
    if (!el || !user) return;

    const mode = consoleModeOf(user);
    const canSee = item => (!item.permission || OwnerAuth.hasPermission(item.permission)) && visibleInConsole(item, mode);
    const html = NAV.filter(item => item.section || canSee(item)).map(item => {
      if (item.section) return `<div class="sidebar-section">${item.section}</div>`;
      const active = item.page === activePage ? ' active' : '';
      return `<a href="${item.page}" class="sidebar-link${active}"><span class="nav-icon">${item.icon}</span>${item.label}</a>`;
    }).join('');

    el.innerHTML = html;
  }

  /**
   * Console switcher (PRIMARY OWNER only — the backend enforces this).
   * Switches the interface/workspace mode (OWNER <-> DEVELOPER) without
   * signing out. NEVER changes the user's actual RBAC role: the role stays
   * PRIMARY_OWNER in the database and all permissions stay PRIMARY_OWNER.
   * Server endpoint: POST /api/console/switch (audited).
   */
  function consoleSwitcherHtml(currentMode) {
    const options = [
      ['DEVELOPER', 'Developer Console'],
      ['OWNER', 'Owner Console']
    ].map(([v, label]) =>
      `<option value="${v}"${v === currentMode ? ' selected' : ''}>${label}</option>`).join('');
    return `<div style="margin-top:10px;">
      <div style="font-size:.65rem;letter-spacing:.12em;color:#9a9ab5;margin-bottom:6px;">CURRENT CONSOLE</div>
      <select id="console-switcher" style="width:100%;background:#1e1e33;border:1px solid #2a2a45;color:#f0f0f5;border-radius:8px;padding:8px 10px;font-family:inherit;font-weight:600;font-size:.85rem;cursor:pointer;">
        ${options}
      </select>
    </div>`;
  }

  function wireConsoleSwitcher(activePage) {
    const sel = document.getElementById('console-switcher');
    if (!sel) return;
    sel.addEventListener('change', async () => {
      const target = sel.value;
      try {
        const res = await fetch('/api/console/switch', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ console: target })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'SWITCH FAILED');
        // Reload the session user (server remains the authority) and re-render nav.
        await OwnerAuth.refresh();
        const user = OwnerAuth.getUser();
        const mode = consoleModeOf(user);
        document.querySelectorAll('#console-switcher').forEach(s => { s.value = mode; });
        renderSidebar(activePage);
        OwnerUI.toast(`Console switched to ${target === 'OWNER' ? 'Owner' : 'Developer'} Console (RBAC role unchanged)`, 'success');
        // If the current page is not part of the new console workspace, go to the dashboard.
        const current = NAV.find(i => i.page === activePage);
        if (current && !visibleInConsole(current, mode)) {
          window.location.href = 'dashboard.html';
        }
      } catch (e) {
        sel.value = consoleModeOf(OwnerAuth.getUser());
        OwnerUI.toast(e.message || 'Console switch failed', 'error');
      }
    });
  }

  async function initLayout(activePage) {
    const user = await OwnerAuth.checkAuth();
    if (!user) { window.location.href = 'login.html'; return; }

    renderSidebar(activePage);

    // Console switcher — sidebar header (Primary Owner only; backend-enforced).
    if (user.isPrimaryOwner) {
      const header = document.querySelector('.owner-sidebar .sidebar-header');
      if (header && !header.querySelector('#console-switcher')) {
        header.insertAdjacentHTML('beforeend', consoleSwitcherHtml(consoleModeOf(user)));
      }
      wireConsoleSwitcher(activePage);
    }

    // Header user chip — owner pages use #owner-name / #owner-email / #owner-role
    const nameEl = document.getElementById('owner-name');
    const emailEl = document.getElementById('owner-email');
    const roleEl = document.getElementById('owner-role');
    const avatarEl = document.getElementById('owner-avatar');

    if (nameEl) nameEl.textContent = user.name || user.username;
    if (emailEl) emailEl.textContent = user.email || '';
    if (avatarEl) avatarEl.textContent = (user.username || '?').slice(0, 1).toUpperCase();
    if (roleEl) {
      const roleLabels = (user.roles || []).filter(r => r !== 'USER');
      roleEl.textContent = roleLabels.length ? roleLabels[0].replace('_', ' ') : 'USER';
    }

    // Fallback chip selectors
    const chip = document.querySelector('.owner-user-chip') || document.querySelector('.user-menu');
    if (chip) {
      const roleLabels = (user.roles || []).filter(r => r !== 'USER');
      chip.innerHTML = `<span class="user-name">${escapeHtml(user.username)}</span>` +
        (roleLabels.length ? `<span class="user-role">${escapeHtml(roleLabels[0].replace('_', ' '))}</span>` : '');
    }

    // Logout buttons
    document.querySelectorAll('[data-action="signout"]').forEach(btn => {
      btn.addEventListener('click', e => { e.preventDefault(); OwnerAuth.signout(); });
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Shared empty-state helper (EMPTY IS BETTER THAN FAKE)
  function emptyState(message, sub) {
    return `<div class="empty-state"><div class="empty-icon">∅</div><h3>${escapeHtml(message)}</h3>` +
      (sub ? `<p>${escapeHtml(sub)}</p>` : '') + `</div>`;
  }

  function errorState(message) {
    return `<div class="empty-state"><div class="empty-icon">⚠</div><h3>${escapeHtml(message)}</h3></div>`;
  }

  // Toast — only for real outcomes
  function toast(message, type) {
    let el = document.getElementById('bx-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bx-toast';
      el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:14px 20px;border-radius:8px;font-weight:600;font-size:14px;max-width:360px;';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = type === 'error' ? '#3a1020' : type === 'success' ? '#10261a' : '#151527';
    el.style.border = `1px solid ${type === 'error' ? '#ff4d6d' : type === 'success' ? '#3ddc84' : '#6c5ce7'}`;
    el.style.color = '#fff';
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  /**
   * Confirmation modal.
   * opts: { title, message, confirmText, cancelText, type, onConfirm }
   * Runs opts.onConfirm() only when the user confirms.
   */
  function confirm(opts) {
    const o = opts || {};
    const overlay = document.createElement('div');
    overlay.className = 'bx-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#151527;border:1px solid #2a2a45;border-radius:12px;padding:24px;max-width:420px;width:100%;';

    const accent = o.type === 'danger' ? '#ff4d6d' : o.type === 'warning' ? '#f59e0b' : '#6c5ce7';

    box.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:1.05rem;color:#f0f0f5;">${escapeHtml(o.title || 'Confirm')}</h3>
      <p style="margin:0 0 20px;font-size:.9rem;color:#9a9ab5;line-height:1.5;">${escapeHtml(o.message || 'Are you sure?')}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button data-act="cancel" style="background:#1e1e33;color:#f0f0f5;border:1px solid #2a2a45;border-radius:8px;padding:9px 16px;font-weight:600;cursor:pointer;">${escapeHtml(o.cancelText || 'Cancel')}</button>
        <button data-act="ok" style="background:${accent};color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;">${escapeHtml(o.confirmText || 'Confirm')}</button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    box.querySelector('[data-act="cancel"]').addEventListener('click', close);
    box.querySelector('[data-act="ok"]').addEventListener('click', () => {
      close();
      if (typeof o.onConfirm === 'function') o.onConfirm();
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

  return { initLayout, renderSidebar, emptyState, errorState, toast, confirm, escapeHtml, NAV };
})();
