/* Generates the 19 missing owner pages with real API wiring.
   EMPTY IS BETTER THAN FAKE — every page loads from the backend
   and renders an honest empty/error state when there is no data. */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'owner');

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Shared per-page JS helpers injected into every page
const HELPERS = `
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const el = id => document.getElementById(id);
    const show = (msg, type) => OwnerUI.toast(msg, type);
    function loading() {
      return OwnerUI.emptyState('LOADING...', 'Fetching data from the server.');
    }
    function failed(err) {
      const msg = err && err.message === 'BACKEND UNAVAILABLE'
        ? 'BACKEND UNAVAILABLE' : (err && err.message ? err.message : 'REQUEST FAILED');
      return OwnerUI.errorState(msg);
    }
    function emptyBox(title, sub) { return OwnerUI.emptyState(title, sub); }
    function table(cols, rowsHtml) {
      return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        cols.map(c => '<th>' + esc(c) + '</th>').join('') +
        '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    }
    function fmt(v) {
      if (v === null || v === undefined || v === '') return '—';
      return esc(v);
    }
    function fmtDate(v) { return v ? esc(String(v).slice(0, 16).replace('T', ' ')) : '—'; }
`;

function page({ title, perm, slug, content, script }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — BOOYAHX Owner Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../css/style.css">
  <link rel="stylesheet" href="../css/owner.css">
</head>
<body>

  <nav class="navbar" id="navbar">
    <div class="container-wide">
      <a href="../index.html" class="nav-brand">
        <span class="logo-icon">BX</span>
        BOOYAHX
      </a>
      <div class="nav-actions">
        <span style="font-size: 0.875rem; color: var(--text-muted);">Owner Console</span>
        <a href="../index.html" class="btn btn-outline btn-sm">View Site</a>
        <button class="btn btn-secondary btn-sm" onclick="OwnerAuth.logout(); window.location.href='login.html';">Logout</button>
      </div>
    </div>
  </nav>

  <div class="owner-layout">
    <aside class="owner-sidebar">
      <div class="sidebar-header">
        <h3>⚙️ Owner <span class="owner-badge">Admin</span></h3>
      </div>
      <nav class="sidebar-nav"></nav>
    </aside>

    <main class="owner-main">
      <div class="owner-header">
        <h1>${esc(title)}</h1>
        <div class="owner-user-info">
          <div class="user-avatar" id="owner-avatar">U</div>
          <div class="user-details">
            <h4 id="owner-name">Loading...</h4>
            <p id="owner-email">...</p>
          </div>
          <span class="owner-role-badge" id="owner-role">...</span>
        </div>
      </div>

${content}
    </main>
  </div>

  <script src="../js/data-service.js"></script>
  <script src="../js/owner-auth.js"></script>
  <script>
    OwnerAuth.requireAuth('${perm}');
    OwnerUI.initLayout('${slug}');
${HELPERS}
${script}
  </script>
</body>
</html>
`;
}

// ---------- page definitions ----------

const pages = [];

// 1. ANALYTICS
pages.push({
  slug: 'analytics.html', title: 'Analytics', perm: 'analytics.view',
  content: `      <div id="analytics-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    (async () => {
      const box = el('analytics-content');
      try {
        const data = await DataService.Owner.analytics();
        const label = k => String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const val = v => {
          if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object')
            ? Object.values(x).join(': ') : String(x)).join(', ');
          if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => label(k) + ': ' + x).join(', ');
          return v;
        };
        const groups = [
          ['Players', data.players],
          ['Tournaments', data.tournaments],
          ['Financial', data.financial]
        ].filter(([, g]) => g && Object.keys(g).length);

        if (!groups.length) {
          box.innerHTML = emptyBox('NO ANALYTICS AVAILABLE', 'Metrics appear once the platform has real activity.');
          return;
        }

        box.innerHTML = groups.map(([title, g]) => {
          const scalar = Object.entries(g).filter(([, v]) => v === null || typeof v !== 'object');
          const complex = Object.entries(g).filter(([, v]) => v !== null && typeof v === 'object');
          const body = scalar.concat(complex)
            .map(([k, v]) => '<tr><td>' + esc(label(k)) + '</td><td><strong>' + esc(val(v)) + '</strong></td></tr>')
            .join('');
          return '<h3 style="margin:24px 0 12px;">' + esc(title) + '</h3>' + table(['Metric', 'Value'], body);
        }).join('') +
        '<p class="table-note">Computed by the server from live database queries' +
        (data.computed_from ? ' — ' + esc(data.computed_from) : '') + '.</p>';
      } catch (err) { box.innerHTML = failed(err); }
    })();
`
});

// 2. TEAM (roles)
pages.push({
  slug: 'team.html', title: 'Team Roles', perm: 'staff.view',
  content: `      <div class="filter-bar">
        <div class="filter-search">
          <input type="text" id="assign-username" placeholder="Username to assign">
        </div>
        <select id="assign-role" class="filter-search" style="flex:0 0 220px;">
          <option value="">Select role...</option>
        </select>
        <button class="btn btn-primary btn-sm" id="assign-btn">Assign Role</button>
      </div>
      <div id="team-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadTeam() {
      const box = el('team-content');
      box.innerHTML = loading();
      try {
        const [data, rolesData] = await Promise.all([
          DataService.Owner.team(),
          DataService.Owner.roles().catch(() => ({ roles: [] }))
        ]);
        const rows = data.team || [];
        const roles = (rolesData.roles || []).filter(r => r.name !== 'USER');

        // Fill role select from real roles the server returns
        const sel = el('assign-role');
        if (sel && sel.options.length <= 1 && roles.length) {
          roles.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.name;
            opt.textContent = r.name + ' — ' + (r.description || '');
            sel.appendChild(opt);
          });
        }

        if (!rows.length) {
          box.innerHTML = emptyBox('NO TEAM ROLES', 'Assign a role above to build your staff team.');
          return;
        }

        const body = rows.map(r => {
          const roleName = r.role || r.name;
          const available = r.available === true;
          return '<tr>' +
            '<td><strong>' + esc(roleName) + '</strong></td>' +
            '<td>' + esc(r.description || r.display_name || '—') + '</td>' +
            '<td>' + (available
              ? '<span style="color:var(--warning,#f59e0b);font-weight:700;">Available</span>'
              : (r.members || []).map(m => esc(m.username)).join(', ')) + '</td>' +
            '<td>' + (available ? '—' : (r.members || []).map(m => fmtDate(m.assigned_at)).join(', ')) + '</td>' +
            '<td class="table-actions">' +
              (available ? '—'
                : (r.members || []).map(m =>
                    '<button class="btn btn-danger btn-sm" data-user="' + esc(m.id) +
                    '" data-role="' + esc(roleName) + '" data-act="revoke">Revoke</button>').join(' ')) +
            '</td></tr>';
        }).join('');

        box.innerHTML = table(['Role', 'Description', 'Members', 'Assigned', 'Actions'], body);

        box.querySelectorAll('[data-act="revoke"]').forEach(btn => {
          btn.addEventListener('click', () => OwnerUI.confirm({
            title: 'Revoke Role',
            message: 'Remove this role assignment? The user keeps their account.',
            type: 'danger', confirmText: 'Revoke',
            onConfirm: async () => {
              try {
                await DataService.Owner.revokeRole({ user_id: btn.dataset.user, role: btn.dataset.role });
                show('Role revoked', 'success');
                loadTeam();
              } catch (e) { show(e.message || 'Revoke failed', 'error'); }
            }
          }));
        });
      } catch (err) { box.innerHTML = failed(err); }
    }

    document.addEventListener('DOMContentLoaded', () => {
      loadTeam();
      const btn = el('assign-btn');
      if (btn) btn.addEventListener('click', async () => {
        const username = (el('assign-username').value || '').trim();
        const role = el('assign-role').value;
        if (!username || !role) { show('Enter a username and select a role', 'error'); return; }
        try {
          await DataService.Owner.assignRole({ username, role });
          show('Role assigned', 'success');
          el('assign-username').value = '';
          loadTeam();
        } catch (e) { show(e.message || 'Assign failed', 'error'); }
      });
    });
`
});

// 3. TEMPLATES
pages.push({
  slug: 'templates.html', title: 'Tournament Templates', perm: 'tournaments.templates',
  content: `      <div class="filter-bar">
        <div class="filter-search"><input type="text" id="tpl-name" placeholder="Template name"></div>
        <select id="tpl-mode" class="filter-search" style="flex:0 0 200px;">
          <option value="Clash Squad">Clash Squad</option>
          <option value="Battle Royale">Battle Royale</option>
        </select>
        <input type="number" id="tpl-entry" class="filter-search" style="flex:0 0 140px;" placeholder="Entry fee" value="20" min="0">
        <button class="btn btn-primary btn-sm" id="tpl-create">Create Template</button>
      </div>
      <div id="tpl-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadTemplates() {
      const box = el('tpl-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Templates.getAll();
        const rows = data.templates || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO TEMPLATES', 'Create a template to speed up tournament creation.');
          return;
        }
        const body = rows.map(t => '<tr>' +
          '<td><strong>' + esc(t.name) + '</strong></td>' +
          '<td>' + fmt(t.mode) + '</td>' +
          '<td>' + fmt(t.format) + '</td>' +
          '<td>' + fmt(t.entry_cost) + ' Coins</td>' +
          '<td>' + fmt(t.player_limit) + '</td>' +
          '<td>' + fmt(t.team_size) + '</td>' +
          '<td>' + fmtDate(t.created_at) + '</td>' +
          '<td class="table-actions"><button class="btn btn-danger btn-sm" data-del="' + esc(t.id) + '">Delete</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(['Name', 'Mode', 'Format', 'Entry', 'Players', 'Team', 'Created', 'Actions'], body);
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Delete Template', message: 'This cannot be undone.', type: 'danger', confirmText: 'Delete',
          onConfirm: async () => {
            try { await DataService.Templates.remove(b.dataset.del); show('Template deleted', 'success'); loadTemplates(); }
            catch (e) { show(e.message || 'Delete failed', 'error'); }
          }
        })));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadTemplates();
      const btn = el('tpl-create');
      if (btn) btn.addEventListener('click', async () => {
        const name = (el('tpl-name').value || '').trim();
        if (!name) { show('Enter a template name', 'error'); return; }
        try {
          await DataService.Templates.create({
            name, mode: el('tpl-mode').value, entry_cost: Number(el('tpl-entry').value) || 0
          });
          show('Template created', 'success');
          el('tpl-name').value = '';
          loadTemplates();
        } catch (e) { show(e.message || 'Create failed', 'error'); }
      });
    });
`
});

// 4. LEADERBOARD (owner)
pages.push({
  slug: 'leaderboard.html', title: 'Leaderboard', perm: 'leaderboard.manage',
  content: `      <div id="lb-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    (async () => {
      const box = el('lb-content');
      try {
        const data = await DataService.Leaderboard.get({ period: 'all' });
        const rows = data.leaderboard || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO LEADERBOARD DATA', 'Rankings appear after tournament results are published.');
          return;
        }
        const body = rows.map(r => '<tr>' +
          '<td>' + esc(r.rank) + '</td>' +
          '<td><strong>' + esc(r.username) + '</strong></td>' +
          '<td>' + fmt(r.wins) + '</td>' +
          '<td>' + fmt(r.tournaments) + '</td>' +
          '<td>' + fmt(r.coins_earned) + '</td>' +
          '</tr>').join('');
        box.innerHTML = table(['Rank', 'Player', 'Wins', 'Tournaments', 'Coins Earned'], body) +
          '<p class="table-note">Source: ' + esc(data.computed_from || 'published results') + '</p>';
      } catch (err) { box.innerHTML = failed(err); }
    })();
`
});

// 5. ACHIEVEMENTS (owner)
pages.push({
  slug: 'achievements.html', title: 'Achievements', perm: 'achievements.manage',
  content: `      <div class="filter-bar">
        <div class="filter-search"><input type="text" id="ach-key" placeholder="key (e.g. first_win)"></div>
        <div class="filter-search"><input type="text" id="ach-name" placeholder="Display name"></div>
        <button class="btn btn-primary btn-sm" id="ach-create">Create</button>
      </div>
      <div id="ach-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadAchievements() {
      const box = el('ach-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Achievements.all();
        const rows = data.achievements || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO ACHIEVEMENTS', 'Create an achievement definition above.');
          return;
        }
        const body = rows.map(a => '<tr>' +
          '<td>' + fmt(a.icon) + '</td>' +
          '<td><strong>' + esc(a.key) + '</strong></td>' +
          '<td>' + esc(a.name) + '</td>' +
          '<td>' + fmt(a.description) + '</td>' +
          '<td>' + fmt(a.unlocked_count) + '</td>' +
          '<td>' + (a.enabled ? 'Enabled' : 'Disabled') + '</td>' +
          '<td class="table-actions"><button class="btn btn-danger btn-sm" data-del="' + esc(a.id) + '">Delete</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(['', 'Key', 'Name', 'Description', 'Unlocked', 'State', 'Actions'], body);
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Delete Achievement', message: 'Unlocks already granted stay in the DB history? This removes the definition.',
          type: 'danger', confirmText: 'Delete',
          onConfirm: async () => {
            try { await DataService.Achievements.remove(b.dataset.del); show('Deleted', 'success'); loadAchievements(); }
            catch (e) { show(e.message || 'Delete failed', 'error'); }
          }
        })));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadAchievements();
      const btn = el('ach-create');
      if (btn) btn.addEventListener('click', async () => {
        const key = (el('ach-key').value || '').trim();
        const name = (el('ach-name').value || '').trim();
        if (!key || !name) { show('key and name are required', 'error'); return; }
        try {
          await DataService.Achievements.create({ key, name });
          show('Achievement created', 'success');
          el('ach-key').value = ''; el('ach-name').value = '';
          loadAchievements();
        } catch (e) { show(e.message || 'Create failed', 'error'); }
      });
    });
`
});

// 6. VERIFICATION
pages.push({
  slug: 'verification.html', title: 'Verification Queue', perm: 'verification.view',
  content: `      <div id="ver-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadVerifications() {
      const box = el('ver-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Owner.verifications();
        const rows = data.verifications || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO PENDING VERIFICATIONS', 'User submissions appear here for review.');
          return;
        }
        const body = rows.map(v => '<tr>' +
          '<td>' + esc(v.username || v.user_id) + '</td>' +
          '<td>' + fmt(v.document_type || v.type) + '</td>' +
          '<td>' + fmtDate(v.submitted_at || v.created_at) + '</td>' +
          '<td>' + fmt(v.status) + '</td>' +
          '<td class="table-actions">' +
            (v.status === 'pending'
              ? '<button class="btn btn-success btn-sm" data-ok="' + esc(v.id) + '">Verify</button> ' +
                '<button class="btn btn-danger btn-sm" data-no="' + esc(v.id) + '">Reject</button>'
              : '—') +
          '</td></tr>').join('');
        box.innerHTML = table(['User', 'Document', 'Submitted', 'Status', 'Actions'], body);

        box.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Verify Identity', message: 'Confirm this identity document is valid.',
          type: 'warning', confirmText: 'Verify',
          onConfirm: async () => {
            try { await DataService.Owner.reviewVerification(b.dataset.ok, { action: 'verify' }); show('Verified', 'success'); loadVerifications(); }
            catch (e) { show(e.message || 'Verify failed', 'error'); }
          }
        })));
        box.querySelectorAll('[data-no]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Reject Verification', message: 'The user can submit again.', type: 'danger', confirmText: 'Reject',
          onConfirm: async () => {
            try { await DataService.Owner.reviewVerification(b.dataset.no, { action: 'reject' }); show('Rejected', 'success'); loadVerifications(); }
            catch (e) { show(e.message || 'Reject failed', 'error'); }
          }
        })));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', loadVerifications);
`
});

// 7. EMAIL
pages.push({
  slug: 'email.html', title: 'Email Templates', perm: 'email.manage',
  content: `      <div id="email-status" style="margin-bottom:16px;"></div>
      <div id="email-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    (async () => {
      const status = el('email-status');
      const box = el('email-content');
      try {
        const data = await DataService.Owner.emailTemplates();

        // Honest configuration state — the server reports it, we never claim otherwise.
        const statusText = data.service_status || 'EMAIL STATUS UNKNOWN';
        const configured = !/NOT CONFIGURED/i.test(statusText);
        status.innerHTML = '<div class="progress-banner" style="border-color:' +
          (configured ? 'var(--success,#10b981)' : 'var(--warning,#f59e0b)') + ';">' +
          '<span>' + esc(statusText) + '</span></div>';

        const rows = data.templates || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO EMAIL TEMPLATES', 'Templates are seeded on first boot. None found.');
          return;
        }
        const body = rows.map(t => '<tr>' +
          '<td><strong>' + esc(t.event_key || t.id) + '</strong></td>' +
          '<td>' + fmt(t.subject) + '</td>' +
          '<td>' + (t.enabled ? 'Enabled' : 'Disabled') + '</td>' +
          '<td>' + fmtDate(t.updated_at) + '</td>' +
          '<td class="table-actions"><button class="btn btn-outline btn-sm" data-edit="' + esc(t.id) + '">Edit</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(['Event', 'Subject', 'State', 'Updated', 'Actions'], body);

        box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
          const t = rows.find(x => String(x.id) === b.dataset.edit);
          if (!t) return;
          const next = window.prompt('Subject for ' + (t.event_key || t.id), t.subject || '');
          if (next === null) return;
          try {
            await DataService.Owner.updateEmailTemplate(t.id, { subject: next });
            show('Template updated', 'success');
            window.location.reload();
          } catch (e) { show(e.message || 'Update failed', 'error'); }
        }));
      } catch (err) { box.innerHTML = failed(err); }
    })();
`
});

// 8. SUPPORT TICKETS
pages.push({
  slug: 'support.html', title: 'Support Tickets', perm: 'support.view',
  content: `      <div id="sup-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadTickets() {
      const box = el('sup-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Support.tickets();
        const rows = data.tickets || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO SUPPORT TICKETS', 'User tickets appear here once submitted.');
          return;
        }
        const body = rows.map(t => '<tr>' +
          '<td><strong>' + esc(t.subject || t.title || t.id) + '</strong></td>' +
          '<td>' + esc(t.username || t.user_id || '—') + '</td>' +
          '<td>' + fmt(t.status) + '</td>' +
          '<td>' + fmt(t.priority || '—') + '</td>' +
          '<td>' + fmtDate(t.created_at) + '</td>' +
          '<td class="table-actions"><button class="btn btn-outline btn-sm" data-close="' + esc(t.id) + '">Close</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(['Subject', 'User', 'Status', 'Priority', 'Created', 'Actions'], body);
        box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', async () => {
          try { await DataService.Support.close(b.dataset.close); show('Ticket closed', 'success'); loadTickets(); }
          catch (e) { show(e.message || 'Close failed', 'error'); }
        }));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', loadTickets);
`
});

// 9. FEEDBACK
pages.push({
  slug: 'feedback-view.html', title: 'Feedback', perm: 'feedback.view',
  content: `      <div id="fb-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadFeedback() {
      const box = el('fb-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Support.allFeedback();
        const rows = data.feedback || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO FEEDBACK', 'User feedback appears here once submitted.');
          return;
        }
        const body = rows.map(f => '<tr>' +
          '<td>' + esc(f.username || f.user_id || '—') + '</td>' +
          '<td>' + fmt(f.category || f.type) + '</td>' +
          '<td>' + fmt(f.message || f.body) + '</td>' +
          '<td>' + fmtDate(f.created_at) + '</td>' +
          '<td>' + (f.response ? fmt(f.response) : '—') + '</td>' +
          '<td class="table-actions"><button class="btn btn-outline btn-sm" data-respond="' + esc(f.id) + '">Respond</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(['User', 'Category', 'Message', 'Received', 'Response', 'Actions'], body);
        box.querySelectorAll('[data-respond]').forEach(b => b.addEventListener('click', async () => {
          const reply = window.prompt('Your response:');
          if (!reply) return;
          try {
            await DataService.Support.respondFeedback(b.dataset.respond, { response: reply });
            show('Response sent', 'success');
            loadFeedback();
          } catch (e) { show(e.message || 'Respond failed', 'error'); }
        }));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', loadFeedback);
`
});

// 10. POLLS
pages.push({
  slug: 'polls.html', title: 'Polls', perm: 'polls.manage',
  content: `      <div class="filter-bar">
        <div class="filter-search"><input type="text" id="poll-q" placeholder="Poll question"></div>
        <button class="btn btn-primary btn-sm" id="poll-create">Create Poll</button>
      </div>
      <div id="poll-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadPolls() {
      const box = el('poll-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Content.polls(true);
        const rows = data.polls || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO POLLS', 'Create a poll to collect player opinions.');
          return;
        }
        const body = rows.map(p => '<tr>' +
          '<td><strong>' + esc(p.question) + '</strong></td>' +
          '<td>' + fmt(p.status) + '</td>' +
          '<td>' + fmt((p.options || []).length) + '</td>' +
          '<td>' + fmt(p.total_votes) + '</td>' +
          '<td>' + fmtDate(p.created_at) + '</td>' +
          '<td class="table-actions"><button class="btn btn-danger btn-sm" data-del="' + esc(p.id) + '">Delete</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(['Question', 'Status', 'Options', 'Votes', 'Created', 'Actions'], body);
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Delete Poll', message: 'Votes are removed with the poll.', type: 'danger', confirmText: 'Delete',
          onConfirm: async () => {
            try { await DataService.Content.removePoll(b.dataset.del); show('Poll deleted', 'success'); loadPolls(); }
            catch (e) { show(e.message || 'Delete failed', 'error'); }
          }
        })));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadPolls();
      const btn = el('poll-create');
      if (btn) btn.addEventListener('click', async () => {
        const q = (el('poll-q').value || '').trim();
        if (!q) { show('Enter a question', 'error'); return; }
        try {
          await DataService.Content.createPoll({
            question: q,
            options: ['Yes', 'No'],
            status: 'draft'
          });
          show('Poll created as draft', 'success');
          el('poll-q').value = '';
          loadPolls();
        } catch (e) { show(e.message || 'Create failed', 'error'); }
      });
    });
`
});

// Generic content CRUD pages: banners, popups, sponsors, highlights
// NOTE: these tables use status CHECK ('active','inactive') — new records are
// created 'inactive' so they stay hidden on the public site until activated.
const crudPages = [
  { slug: 'banners.html', title: 'Banners', perm: 'banners.manage', table: 'banners', list: () => 'DataService.Content.banners()', nameField: 'title',
    createHint: 'Banner title', extra: { status: 'inactive' } },
  { slug: 'popups.html', title: 'Popups', perm: 'popups.manage', table: 'popups', list: () => 'DataService.Content.popups()', nameField: 'title',
    createHint: 'Popup title', extra: { status: 'inactive' }, extraExpr: '{ message: name }' },
  { slug: 'sponsors.html', title: 'Sponsors', perm: 'sponsors.manage', table: 'sponsors', list: () => 'DataService.Content.sponsors()', nameField: 'name',
    createHint: 'Sponsor name', extra: { status: 'inactive' } },
  { slug: 'highlights.html', title: 'Highlights', perm: 'highlights.manage', table: 'highlights', list: () => 'DataService.Content.highlights()', nameField: 'title',
    createHint: 'Highlight title', extra: { status: 'inactive' } }
];

for (const c of crudPages) {
  pages.push({
    slug: c.slug, title: c.title, perm: c.perm,
    content: `      <div class="filter-bar">
        <div class="filter-search"><input type="text" id="cr-name" placeholder="${esc(c.createHint)}"></div>
        <button class="btn btn-primary btn-sm" id="cr-create">Create</button>
      </div>
      <div id="cr-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
    script: `
    const crud = DataService.contentCrud('${c.table}');
    async function loadRows() {
      const box = el('cr-content');
      box.innerHTML = loading();
      try {
        const data = await crud.list();
        const rows = data.${c.table} || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO ${c.title.toUpperCase()}', 'Create the first one above. Nothing is faked.');
          return;
        }
        const skip = ['content_html', 'body_html', 'id', 'created_by', 'updated_at'];
        const cols = Object.keys(rows[0]).filter(k => !skip.includes(k)).slice(0, 6);
        if (!cols.includes('status') && rows[0].status !== undefined) cols.push('status');
        const body = rows.map(r => '<tr>' +
          cols.map(k => '<td>' + (typeof r[k] === 'string' && r[k].length > 60 ? esc(r[k].slice(0, 60)) + '…' : fmt(r[k])) + '</td>').join('') +
          '<td class="table-actions">' +
            (rows[0].status !== undefined
              ? '<button class="btn btn-outline btn-sm" data-toggle="' + esc(r.id) + '" data-status="' + esc(r.status) + '">' +
                (r.status === 'active' ? 'Deactivate' : 'Activate') + '</button> '
              : '') +
            '<button class="btn btn-danger btn-sm" data-del="' + esc(r.id) + '">Delete</button></td>' +
          '</tr>').join('');
        box.innerHTML = table(cols.concat(['Actions']), body);
        box.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
          const next = b.dataset.status === 'active' ? 'inactive' : 'active';
          try { await crud.update(b.dataset.toggle, { status: next }); show('Status → ' + next, 'success'); loadRows(); }
          catch (e) { show(e.message || 'Update failed', 'error'); }
        }));
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Delete', message: 'This removes the record from the site.', type: 'danger', confirmText: 'Delete',
          onConfirm: async () => {
            try { await crud.remove(b.dataset.del); show('Deleted', 'success'); loadRows(); }
            catch (e) { show(e.message || 'Delete failed', 'error'); }
          }
        })));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadRows();
      const btn = el('cr-create');
      if (btn) btn.addEventListener('click', async () => {
        const name = (el('cr-name').value || '').trim();
        if (!name) { show('Enter a name', 'error'); return; }
        try {
          await crud.create(Object.assign({ ${c.nameField}: name }, ${JSON.stringify(c.extra)}${c.extraExpr ? `, ${c.extraExpr}` : ''}));
          show('Created', 'success');
          el('cr-name').value = '';
          loadRows();
        } catch (e) { show(e.message || 'Create failed', 'error'); }
      });
    });
`
  });
}

// Content management: events, news, updates — owner panel -> API -> DB -> public site.
// Records are created as 'draft' (hidden publicly) and published from the list.
function contentManagePage({ slug, title, perm, table, formHtml, extractJs, buildExpr, dateField, nameCol, emptyTitle }) {
  pages.push({
    slug, title, perm,
    content: `      <div class="filter-bar" style="flex-wrap:wrap;gap:8px;align-items:center;">
        ${formHtml}
        <button class="btn btn-primary btn-sm" id="cm-create">Create (draft)</button>
      </div>
      <p class="table-note">Records are created as draft and stay hidden on the public site until you publish them.</p>
      <div id="cm-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
    script: `
    const cm = DataService.contentCrud('${table}');
    async function loadCm() {
      const box = el('cm-content');
      box.innerHTML = loading();
      try {
        const data = await cm.list();
        const rows = data.${table} || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('${emptyTitle}', 'Nothing is created yet. New records start as draft.');
          return;
        }
        const body = rows.map(r => '<tr>' +
          '<td>' + esc(r.${nameCol}) + '</td>' +
          '<td>' + esc(r.status) + '</td>' +
          '<td>' + fmt(r.${dateField} || r.created_at) + '</td>' +
          '<td class="table-actions">' +
            '<button class="btn btn-outline btn-sm" data-pub="' + esc(r.id) + '" data-status="' + esc(r.status) + '">' +
              (r.status === 'published' ? 'Unpublish' : 'Publish') + '</button> ' +
            '<button class="btn btn-danger btn-sm" data-del="' + esc(r.id) + '">Delete</button>' +
          '</td></tr>').join('');
        box.innerHTML = table(['Title', 'Status', 'Date', 'Actions'], body);
        box.querySelectorAll('[data-pub]').forEach(b => b.addEventListener('click', async () => {
          const next = b.dataset.status === 'published' ? 'draft' : 'published';
          try { await cm.update(b.dataset.pub, { status: next }); show('Status → ' + next, 'success'); loadCm(); }
          catch (e) { show(e.message || 'Update failed', 'error'); }
        }));
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => OwnerUI.confirm({
          title: 'Delete', message: 'This removes the record permanently.', type: 'danger', confirmText: 'Delete',
          onConfirm: async () => {
            try { await cm.remove(b.dataset.del); show('Deleted', 'success'); loadCm(); }
            catch (e) { show(e.message || 'Delete failed', 'error'); }
          }
        })));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadCm();
      const btn = el('cm-create');
      if (btn) btn.addEventListener('click', async () => {
        const title = (el('cm-title').value || '').trim();
        ${extractJs}
        try {
          await cm.create(${buildExpr});
          show('Created as draft', 'success');
          el('cm-title').value = '';
          loadCm();
        } catch (e) { show(e.message || 'Create failed', 'error'); }
      });
    });
`
  });
}

contentManagePage({
  slug: 'events.html', title: 'Events', perm: 'events.view', table: 'events',
  nameCol: 'title', dateField: 'start_time', emptyTitle: 'NO EVENTS',
  formHtml: `
        <input type="text" id="cm-title" placeholder="Event title" style="flex:1 1 190px;">
        <input type="datetime-local" id="cm-start" title="Start" style="flex:0 0 195px;">
        <input type="datetime-local" id="cm-end" title="End" style="flex:0 0 195px;">
        <input type="text" id="cm-desc" placeholder="Description (optional)" style="flex:1 1 200px;">`,
  extractJs: `
        const start = (el('cm-start').value || '').trim();
        const end = (el('cm-end').value || '').trim();
        const desc = (el('cm-desc').value || '').trim();
        if (!title) { show('Enter an event title', 'error'); return; }
        if (!start || !end) { show('Start and end time are required', 'error'); return; }
        if (Date.parse(end) <= Date.parse(start)) { show('End must be after start', 'error'); return; }`,
  buildExpr: `{ title, description: desc, start_time: start, end_time: end, entry: 0, status: 'draft' }`
});

contentManagePage({
  slug: 'news.html', title: 'News', perm: 'news.view', table: 'news',
  nameCol: 'title', dateField: 'published_at', emptyTitle: 'NO NEWS',
  formHtml: `
        <input type="text" id="cm-title" placeholder="News title" style="flex:1 1 190px;">
        <select id="cm-cat" style="flex:0 0 180px;">
          <option>BooyahX News</option>
          <option>Tournament News</option>
          <option>Community</option>
          <option>Competition</option>
          <option>Announcements</option>
        </select>
        <textarea id="cm-body" rows="2" placeholder="Article content" style="flex:2 1 280px;"></textarea>`,
  extractJs: `
        const cat = (el('cm-cat').value || '').trim();
        const body = (el('cm-body').value || '').trim();
        if (!title) { show('Enter a news title', 'error'); return; }
        if (!body) { show('Article content is required', 'error'); return; }`,
  buildExpr: `{ title, category: cat, content: body, status: 'draft' }`
});

contentManagePage({
  slug: 'updates.html', title: 'Updates', perm: 'updates.view', table: 'updates',
  nameCol: 'title', dateField: 'published_at', emptyTitle: 'NO UPDATES',
  formHtml: `
        <input type="text" id="cm-ver" placeholder="Version (e.g. 1.4.0)" style="flex:0 0 165px;">
        <input type="text" id="cm-title" placeholder="Update title" style="flex:1 1 190px;">
        <input type="text" id="cm-desc" placeholder="Description" style="flex:2 1 260px;">`,
  extractJs: `
        const ver = (el('cm-ver').value || '').trim();
        const desc = (el('cm-desc').value || '').trim();
        if (!ver) { show('Version is required', 'error'); return; }
        if (!title) { show('Enter a title', 'error'); return; }`,
  buildExpr: `{ version: ver, title, description: desc, status: 'draft' }`
});

// 15. MAINTENANCE
pages.push({
  slug: 'maintenance.html', title: 'Maintenance Mode', perm: 'maintenance.manage',
  content: `      <div id="mnt-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>
      <div class="filter-bar" style="margin-top:16px;">
        <button class="btn btn-danger btn-sm" id="mnt-on">Enable Maintenance</button>
        <button class="btn btn-success btn-sm" id="mnt-off">Disable Maintenance</button>
      </div>
      <p class="table-note">Maintenance is enforced by the server. Staff accounts always keep access; the Primary Owner can always sign in.</p>`,
  script: `
    async function loadMaintenance() {
      const box = el('mnt-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Owner.maintenance();
        const st = (data && data.state) || data || {};
        const on = st.active === true;
        box.innerHTML = '<div class="progress-banner" style="border-color:' + (on ? 'var(--danger,#ef4444)' : 'var(--success,#10b981)') + ';">' +
          '<span>Maintenance: ' + (on ? 'ENABLED' : 'DISABLED') + '</span></div>' +
          (st.message ? '<p class="table-note">Message: ' + esc(st.message) + '</p>' : '') +
          (st.start || st.end ? '<p class="table-note">Window: ' + fmt(st.start) + ' → ' + fmt(st.end) + '</p>' : '');
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadMaintenance();
      const set = async enabled => {
        try {
          await DataService.Owner.setMaintenance({ enabled, message: enabled ? 'Scheduled maintenance in progress.' : '' });
          show(enabled ? 'Maintenance enabled' : 'Maintenance disabled', 'success');
          loadMaintenance();
        } catch (e) { show(e.message || 'Update failed', 'error'); }
      };
      el('mnt-on').addEventListener('click', () => OwnerUI.confirm({
        title: 'Enable Maintenance', message: 'Public traffic will see a maintenance page. Staff keep access.',
        type: 'warning', confirmText: 'Enable', onConfirm: () => set(true)
      }));
      el('mnt-off').addEventListener('click', () => set(false));
    });
`
});

// 16. SYSTEM HEALTH
pages.push({
  slug: 'system-health.html', title: 'System Health', perm: 'systemhealth.view',
  content: `      <div id="sh-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    (async () => {
      const box = el('sh-content');
      try {
        const data = await DataService.Owner.systemHealth();
        const checks = data.checks || data.services || [];
        if (!Array.isArray(checks) || !checks.length) {
          // Object-shaped payload: render key/value rows
          const entries = Object.entries(data).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
          if (!entries.length) {
            box.innerHTML = emptyBox('NO HEALTH DATA', 'The server did not return any checks.');
            return;
          }
          const body = entries.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td>' + fmt(v) + '</td></tr>').join('');
          box.innerHTML = table(['Check', 'Value'], body);
          return;
        }
        const body = checks.map(c => '<tr>' +
          '<td>' + esc(c.name || c.service || c.key) + '</td>' +
          '<td>' + fmt(c.status || c.value) + '</td>' +
          '<td>' + fmt(c.detail || c.message || '—') + '</td>' +
          '</tr>').join('');
        box.innerHTML = table(['Service', 'Status', 'Detail'], body);
      } catch (err) { box.innerHTML = failed(err); }
    })();
`
});

// 17. ERROR LOGS
pages.push({
  slug: 'errors.html', title: 'Error Logs', perm: 'errors.view',
  content: `      <div id="err-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadErrors() {
      const box = el('err-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Owner.errors();
        const rows = data.errors || data.logs || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO ERRORS RECORDED', 'Server-side errors will appear here.');
          return;
        }
        const body = rows.map(e => '<tr>' +
          '<td>' + fmtDate(e.created_at) + '</td>' +
          '<td>' + fmt(e.type || e.endpoint) + '</td>' +
          '<td>' + fmt(e.endpoint || e.method) + '</td>' +
          '<td>' + fmt(e.status) + '</td>' +
          '<td>' + fmt(e.message) + '</td>' +
          '<td class="table-actions">' + (e.resolved ? 'Resolved'
            : '<button class="btn btn-outline btn-sm" data-res="' + esc(e.id) + '">Resolve</button>') + '</td>' +
          '</tr>').join('');
        box.innerHTML = table(['When', 'Type', 'Endpoint', 'Status', 'Message', 'Actions'], body);
        box.querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', async () => {
          try { await DataService.Owner.resolveError(b.dataset.res); show('Marked resolved', 'success'); loadErrors(); }
          catch (e) { show(e.message || 'Resolve failed', 'error'); }
        }));
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', loadErrors);
`
});

// 18. BACKUPS
pages.push({
  slug: 'backup.html', title: 'Backups', perm: 'backup.manage',
  content: `      <div class="filter-bar">
        <button class="btn btn-primary btn-sm" id="bk-create">Create Backup Now</button>
      </div>
      <div id="bk-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    async function loadBackups() {
      const box = el('bk-content');
      box.innerHTML = loading();
      try {
        const data = await DataService.Owner.backups();
        const rows = data.backups || [];
        if (!rows.length) {
          box.innerHTML = emptyBox('NO BACKUPS', 'Create a backup to snapshot the database.');
          return;
        }
        const body = rows.map(b => '<tr>' +
          '<td><strong>' + esc(b.name || b.file || b.id) + '</strong></td>' +
          '<td>' + fmt(b.size) + '</td>' +
          '<td>' + fmtDate(b.created_at) + '</td>' +
          '<td>' + fmt(b.status || '—') + '</td>' +
          '</tr>').join('');
        box.innerHTML = table(['Backup', 'Size', 'Created', 'Status'], body);
      } catch (err) { box.innerHTML = failed(err); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      loadBackups();
      const btn = el('bk-create');
      if (btn) btn.addEventListener('click', async () => {
        try { await DataService.Owner.createBackup(); show('Backup created', 'success'); loadBackups(); }
        catch (e) { show(e.message || 'Backup failed', 'error'); }
      });
    });
`
});

// 19. IMPORT / EXPORT
pages.push({
  slug: 'import-export.html', title: 'Import / Export', perm: 'importexport.use',
  content: `      <div id="ie-content"><div class="empty-state"><div class="empty-icon">⏳</div><h3>LOADING...</h3></div></div>`,
  script: `
    (async () => {
      const box = el('ie-content');
      try {
        const data = await DataService.Owner.exportEntities();
        const entities = data.entities || [];
        if (!entities.length) {
          box.innerHTML = emptyBox('NO EXPORTABLE ENTITIES', 'The server reported nothing to export.');
          return;
        }
        const body = entities.map(e => {
          const name = typeof e === 'string' ? e : (e.name || e.entity);
          const count = typeof e === 'object' ? (e.count !== undefined ? e.count : '—') : '—';
          const url = DataService.Owner.exportUrl(name, 'json');
          return '<tr>' +
            '<td><strong>' + esc(name) + '</strong></td>' +
            '<td>' + fmt(count) + '</td>' +
            '<td class="table-actions"><a class="btn btn-outline btn-sm" href="' + esc(url) + '" download>Download JSON</a></td>' +
            '</tr>';
        }).join('');
        box.innerHTML = table(['Entity', 'Rows', 'Export'], body) +
          '<p class="table-note">Exports are generated by the server from live database rows.</p>';
      } catch (err) { box.innerHTML = failed(err); }
    })();
`
});

// ---------- write all ----------
let written = 0;
for (const p of pages) {
  const html = page(p);
  fs.writeFileSync(path.join(OUT, p.slug), html, 'utf8');
  written++;
  console.log('created: owner/' + p.slug);
}
console.log(`\n${written} pages written`);
