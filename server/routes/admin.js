/* ============================================
   BOOYAHX — ADMIN ROUTES
   Users, roles, team, bulk actions, audit,
   settings, maintenance, email templates,
   verification review, API keys, backups,
   import/export, analytics, system health,
   error logs.
   ============================================ */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

module.exports = function adminRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, requirePermission, requirePrimaryOwner,
          checkPrimaryOwnerProtection, getUserAccess, invalidateUser } = ctx;
  const {
    badRequest, notFound, denied, conflict, serverError,
    requireFields, asInt, cleanText, notify,
    getSetting, setSetting, getMaintenanceState, logError,
    emailConfigured, renderTemplate
  } = require('../helpers');

  // ============================================
  // DASHBOARD STATS (real counts only)
  // ============================================

  app.get('/api/owner/stats', requirePermission('dashboard.view'), (req, res) => {
    try {
      const c = (sql, ...p) => db.prepare(sql).get(...p).c;
      const stats = {
        totalUsers: c("SELECT COUNT(*) as c FROM users"),
        activeUsers: c("SELECT COUNT(*) as c FROM users WHERE status = 'active'"),
        liveTournaments: c("SELECT COUNT(*) as c FROM tournaments WHERE status = 'live'"),
        upcomingTournaments: c("SELECT COUNT(*) as c FROM tournaments WHERE status IN ('upcoming','waiting','almost_full','full')"),
        completedTournaments: c("SELECT COUNT(*) as c FROM tournaments WHERE status = 'completed'"),
        pendingDeposits: c("SELECT COUNT(*) as c FROM deposits WHERE status IN ('pending','under_review')"),
        pendingWithdrawals: c("SELECT COUNT(*) as c FROM withdrawals WHERE status IN ('pending','under_review','approved','processing')"),
        coinsIssued: db.prepare("SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type IN ('deposit','reward','bonus','daily_reward') AND status = 'completed'").get().v,
        coinsWithdrawn: Math.abs(db.prepare("SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type = 'withdrawal' AND status = 'completed'").get().v),
        activeEvents: c("SELECT COUNT(*) as c FROM events WHERE status = 'published'"),
        openReports: c("SELECT COUNT(*) as c FROM reports WHERE status IN ('new','reviewing')"),
        openTickets: c("SELECT COUNT(*) as c FROM support_tickets WHERE status IN ('open','pending')"),
        pendingVerifications: c("SELECT COUNT(*) as c FROM user_verifications WHERE status = 'pending'")
      };
      res.json({ stats });
    } catch (err) { serverError(res, err); }
  });

  // Recent activity (real audit records)
  app.get('/api/owner/activity', requirePermission('dashboard.view'), (req, res) => {
    const rows = db.prepare(`
      SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
             u.username as actor_username
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC LIMIT 25
    `).all();
    res.json({ activity: rows, empty: rows.length === 0 });
  });

  // ============================================
  // USERS
  // ============================================

  app.get('/api/owner/users', requirePermission('users.view'), (req, res) => {
    try {
      const { search, status, role, limit } = req.query;
      let query = `
        SELECT u.id, u.name, u.username, u.email, u.role, u.status, u.created_at,
               COALESCE(w.balance, 0) as balance,
               (SELECT GROUP_CONCAT(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) as role_list
        FROM users u LEFT JOIN wallets w ON w.user_id = u.id WHERE 1=1`;
      const params = [];
      if (search) { query += ' AND (u.username LIKE ? OR u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (status) { query += ' AND u.status = ?'; params.push(status); }
      if (role) { query += ' AND u.role = ?'; params.push(role); }
      query += ' ORDER BY u.created_at DESC LIMIT ?';
      params.push(Math.min(asInt(limit, 100), 500));

      const rows = db.prepare(query).all(...params).map(u => ({
        ...u,
        roles: u.role_list ? u.role_list.split(',') : [u.role]
      }));
      const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      res.json({ users: rows, total });
    } catch (err) { serverError(res, err); }
  });

  app.put('/api/owner/users/:id', requirePermission('users.edit'), (req, res) => {
    try {
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
      if (!target) return notFound(res, 'User');

      const protectedErr = checkPrimaryOwnerProtection(req, target.id, (req.body || {}).status === 'disabled' ? 'disable' : 'edit');
      if (protectedErr) return denied(res, protectedErr);

      const b = req.body || {};
      const sets = [];
      const params = [];
      if (b.name !== undefined) { sets.push('name = ?'); params.push(cleanText(b.name, 80)); }
      if (b.status !== undefined) {
        if (!['active', 'suspended', 'restricted', 'disabled'].includes(b.status)) return badRequest(res, 'Invalid status');
        sets.push('status = ?'); params.push(b.status);
      }
      if (b.email !== undefined) {
        const email = cleanText(b.email, 120).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest(res, 'Invalid email');
        const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, target.id);
        if (dup) return conflict(res, 'Email already in use');
        sets.push('email = ?'); params.push(email);
      }
      if (!sets.length) return badRequest(res, 'Nothing to update');
      sets.push("updated_at = datetime('now')");
      params.push(target.id);
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      if (b.status && b.status !== 'active') {
        db.prepare('INSERT INTO security_alerts (id, user_id, type, message, severity) VALUES (?, ?, ?, ?, ?)')
          .run(db.makeId('SEC'), target.id, 'account_status_change', `Account status changed to ${b.status}`, 'warning');
      }
      db.audit(req.user.id, 'user_updated', 'user', target.id, { changed: Object.keys(b) });
      invalidateUser(target.id);
      res.json({ message: 'User updated' });
    } catch (err) { serverError(res, err); }
  });

  // ---------- BULK ACTIONS (validated server-side, audited) ----------

  app.post('/api/owner/users/bulk', requirePermission('users.bulk'), (req, res) => {
    try {
      const b = req.body || {};
      const ids = Array.isArray(b.user_ids) ? b.user_ids.map(String).slice(0, 500) : [];
      if (!ids.length) return badRequest(res, 'user_ids array is required');
      const action = b.action;

      const allowed = ['enable', 'suspend', 'disable', 'assign_role', 'remove_role', 'notify'];
      if (!allowed.includes(action)) return badRequest(res, `action must be one of: ${allowed.join(', ')}`);

      let roleRow = null;
      if (action === 'assign_role' || action === 'remove_role') {
        roleRow = db.prepare('SELECT * FROM roles WHERE name = ? OR id = ?').get(b.role, b.role);
        if (!roleRow) return notFound(res, 'Role');
        if (action === 'assign_role' && roleRow.name === 'PRIMARY_OWNER') {
          return denied(res, 'PRIMARY_OWNER can only be held by the Primary Owner account');
        }
      }
      if (action === 'notify' && !cleanText(b.title, 200)) return badRequest(res, 'Notification title required');

      const results = { processed: 0, skipped: 0, blocked: [] };

      db.tx(() => {
        for (const id of ids) {
          const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
          if (!target) { results.skipped++; continue; }

          const protection = checkPrimaryOwnerProtection(req, target.id, action === 'enable' ? 'edit' : action);
          if (protection) { results.blocked.push({ user: target.username, reason: protection }); continue; }

          if (action === 'enable') db.prepare("UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
          else if (action === 'suspend') db.prepare("UPDATE users SET status = 'suspended', updated_at = datetime('now') WHERE id = ?").run(id);
          else if (action === 'disable') db.prepare("UPDATE users SET status = 'disabled', updated_at = datetime('now') WHERE id = ?").run(id);
          else if (action === 'assign_role') {
            db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(id, roleRow.id, req.user.id);
          } else if (action === 'remove_role') {
            if (roleRow.name === 'PRIMARY_OWNER') {
              results.blocked.push({ user: target.username, reason: 'PRIMARY_OWNER removal via bulk is not allowed' });
              continue;
            }
            db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(id, roleRow.id);
          } else if (action === 'notify') {
            notify(id, cleanText(b.title, 200), cleanText(b.message, 1000), 'broadcast');
          }
          invalidateUser(id);
          results.processed++;
        }
        db.audit(req.user.id, `users_bulk_${action}`, 'user', null, { count: results.processed, ids: ids.slice(0, 20) });
      });

      res.json({ message: `Bulk action processed: ${results.processed}`, ...results });
    } catch (err) { serverError(res, err); }
  });

  app.delete('/api/owner/users/:id', requirePermission('users.delete'), (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return notFound(res, 'User');
    const protection = checkPrimaryOwnerProtection(req, target.id, 'delete');
    if (protection) return denied(res, protection);
    if (target.id === req.user.id) return denied(res, 'You cannot delete your own account');

    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    invalidateUser(target.id);
    db.audit(req.user.id, 'user_deleted', 'user', target.id, { username: target.username });
    res.json({ message: 'User deleted' });
  });

  // ============================================
  // ROLES & TEAM (RBAC management)
  // ============================================

  app.get('/api/roles', requirePermission('roles.view'), (req, res) => {
    const roles = db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as member_count,
        (SELECT GROUP_CONCAT(p.key) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id) as permission_list
      FROM roles r ORDER BY CASE r.name
        WHEN 'PRIMARY_OWNER' THEN 0 WHEN 'OWNER' THEN 1 WHEN 'DEVELOPER' THEN 2
        WHEN 'ADMIN' THEN 3 WHEN 'MODERATOR' THEN 4 WHEN 'SUPPORT' THEN 5
        ELSE 10 END, r.name
    `).all().map(r => ({ ...r, permissions: r.permission_list ? r.permission_list.split(',') : [] }));
    const permissions = db.prepare('SELECT * FROM permissions ORDER BY category, key').all();
    res.json({ roles, permissions });
  });

  // TEAM PAGE: role roster with real assignments (Available = no assigned user)
  app.get('/api/owner/team', requirePermission('staff.view'), (req, res) => {
    try {
      const roles = db.prepare('SELECT * FROM roles ORDER BY CASE name WHEN \'PRIMARY_OWNER\' THEN 0 WHEN \'OWNER\' THEN 1 WHEN \'DEVELOPER\' THEN 2 WHEN \'ADMIN\' THEN 3 WHEN \'MODERATOR\' THEN 4 ELSE 10 END, name').all();

      const team = roles.map(r => {
        const members = db.prepare(`
          SELECT u.id, u.username, u.name, u.email, u.status,
            ur.assigned_at, ur.assigned_by,
            (SELECT MAX(login_at) FROM login_history lh WHERE lh.user_id = u.id AND lh.status = 'success') as last_activity
          FROM user_roles ur JOIN users u ON u.id = ur.user_id
          WHERE ur.role_id = ? ORDER BY ur.assigned_at ASC
        `).all(r.id);
        return {
          role: r.name,
          display_name: r.display_name,
          description: r.description,
          available: members.length === 0,
          members
        };
      });

      // Audit history for role changes
      const roleAudit = db.prepare(`
        SELECT a.*, u.username as actor_username FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.action LIKE '%role%' OR a.action LIKE '%staff%' OR a.action LIKE '%permission%'
        ORDER BY a.created_at DESC LIMIT 50
      `).all();

      res.json({ team, audit: roleAudit, empty: team.every(t => t.available) });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/owner/team/assign', requirePermission('roles.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const target = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(b.user_id, b.username);
      if (!target) return notFound(res, 'User');
      const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(b.role);
      if (!role) return notFound(res, 'Role');
      if (role.name === 'PRIMARY_OWNER') return denied(res, 'PRIMARY_OWNER cannot be assigned to another account');
      if (role.name === 'OWNER' && !req.roles.has('PRIMARY_OWNER')) {
        return denied(res, 'Only the Primary Owner can assign the OWNER role');
      }

      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)')
        .run(target.id, role.id, req.user.id);
      invalidateUser(target.id);
      db.audit(req.user.id, 'role_assigned', 'user_role', `${target.id}:${role.name}`, { user: target.username, role: role.name });
      res.json({ message: `${role.display_name} assigned to ${target.username}` });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/owner/team/revoke', requirePermission('roles.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const target = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(b.user_id, b.username);
      if (!target) return notFound(res, 'User');
      const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(b.role);
      if (!role) return notFound(res, 'Role');

      const protection = checkPrimaryOwnerProtection(req, target.id, 'remove_role');
      if (protection) return denied(res, protection);
      if (role.name === 'OWNER' && !req.roles.has('PRIMARY_OWNER')) {
        return denied(res, 'Only the Primary Owner can revoke the OWNER role');
      }

      db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(target.id, role.id);
      invalidateUser(target.id);
      db.audit(req.user.id, 'role_revoked', 'user_role', `${target.id}:${role.name}`, { user: target.username, role: role.name });
      res.json({ message: `${role.display_name} revoked from ${target.username}` });
    } catch (err) { serverError(res, err); }
  });

  // Disable a staff account (with protection)
  app.post('/api/owner/team/disable', requirePermission('staff.manage'), (req, res) => {
    const b = req.body || {};
    const target = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(b.user_id, b.username);
    if (!target) return notFound(res, 'User');
    const protection = checkPrimaryOwnerProtection(req, target.id, 'disable');
    if (protection) return denied(res, protection);

    const status = b.enable ? 'active' : 'disabled';
    db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, target.id);
    invalidateUser(target.id);
    db.audit(req.user.id, b.enable ? 'staff_enabled' : 'staff_disabled', 'user', target.id, { user: target.username });
    res.json({ message: `Account ${b.enable ? 'enabled' : 'disabled'}` });
  });

  // Permission overview for a role
  app.get('/api/roles/:name/permissions', requirePermission('roles.view'), (req, res) => {
    const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(req.params.name);
    if (!role) return notFound(res, 'Role');
    const perms = db.prepare(`
      SELECT p.key, p.description, p.category FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?
      ORDER BY p.category, p.key
    `).all(role.id);
    const members = db.prepare(`
      SELECT u.id, u.username, u.name FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role_id = ?
    `).all(role.id);
    res.json({ role, permissions: perms, members });
  });

  // ============================================
  // AUDIT LOGS
  // ============================================

  app.get('/api/owner/audit-logs', requirePermission('audit.view'), (req, res) => {
    const { action, actor, limit } = req.query;
    let query = `
      SELECT a.*, u.username as actor_username, u.email as actor_email
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE 1=1`;
    const params = [];
    if (action) { query += ' AND a.action LIKE ?'; params.push(`%${action}%`); }
    if (actor) { query += ' AND u.username = ?'; params.push(actor); }
    query += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(Math.min(asInt(limit, 100), 500));
    const rows = db.prepare(query).all(...params);
    res.json({ logs: rows, empty: rows.length === 0 });
  });

  // ============================================
  // SETTINGS (persistent)
  // ============================================

  const MANAGEABLE_SETTINGS = [
    'platform_name', 'support_email', 'locale',
    'withdrawal_min_coins', 'withdrawal_requires_verification',
    'daily_reward_base', 'daily_reward_streak_bonus', 'referral_bonus_coins',
    // Payment method availability + receiving account (backend-configured;
    // the frontend only renders what the backend reports).
    'deposit_jazzcash_enabled', 'deposit_easypaisa_enabled', 'deposit_bank_enabled',
    'withdraw_jazzcash_enabled', 'withdraw_easypaisa_enabled', 'withdraw_bank_enabled',
    'jazzcash_account_name', 'jazzcash_account_number',
    'easypaisa_status_message', 'bank_status_message'
  ];

  app.get('/api/settings', optionalAuth, (req, res) => {
    const canManage = req.user && req.perms && (req.perms.has('*') || req.perms.has('settings.manage'));
    const keys = canManage
      ? [...MANAGEABLE_SETTINGS, 'maintenance_mode', 'maintenance_message', 'maintenance_start', 'maintenance_end']
      : ['platform_name', 'support_email', 'locale', 'withdrawal_min_coins'];
    const settings = {};
    for (const k of keys) settings[k] = getSetting(k, '');
    res.json({ settings, can_manage: Boolean(canManage) });
  });

  app.put('/api/settings', requirePermission('settings.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const saved = [];
      const allowed = new Set([...MANAGEABLE_SETTINGS, 'maintenance_mode', 'maintenance_message', 'maintenance_start', 'maintenance_end']);
      for (const [k, v] of Object.entries(b)) {
        if (!allowed.has(k)) continue;
        let value = cleanText(String(v), 2000);
        if (['withdrawal_min_coins', 'daily_reward_base', 'daily_reward_streak_bonus', 'referral_bonus_coins'].includes(k)) {
          const n = asInt(v, -1);
          if (n < 0) return badRequest(res, `${k} must be a non-negative number`);
          value = String(n);
        }
        if (k === 'maintenance_mode') {
          if (!['true', 'false'].includes(value)) return badRequest(res, 'maintenance_mode must be true or false');
          if (value === 'true') {
            db.audit(req.user.id, 'maintenance_enabled', 'setting', 'maintenance_mode', { message: b.maintenance_message || '' });
          } else {
            db.audit(req.user.id, 'maintenance_disabled', 'setting', 'maintenance_mode', {});
          }
        }
        setSetting(k, value, req.user.id);
        saved.push(k);
      }
      if (!saved.length) return badRequest(res, 'No valid settings provided');
      db.audit(req.user.id, 'settings_changed', 'setting', null, { keys: saved });
      res.json({ message: 'Settings saved', saved });
    } catch (err) { serverError(res, err); }
  });

  // Maintenance scheduling (separate endpoint for clarity)
  app.post('/api/owner/maintenance', requirePermission('maintenance.manage'), (req, res) => {
    const b = req.body || {};
    if (b.enabled !== undefined) {
      const val = b.enabled ? 'true' : 'false';
      setSetting('maintenance_mode', val, req.user.id);
      db.audit(req.user.id, val === 'true' ? 'maintenance_enabled' : 'maintenance_disabled', 'setting', 'maintenance_mode', {
        message: b.message || '', start: b.start || '', end: b.end || ''
      });
    }
    if (b.message !== undefined) setSetting('maintenance_message', cleanText(b.message, 500) || 'BOOYAHX IS CURRENTLY UNDER MAINTENANCE', req.user.id);
    if (b.start !== undefined) setSetting('maintenance_start', cleanText(b.start, 40), req.user.id);
    if (b.end !== undefined) setSetting('maintenance_end', cleanText(b.end, 40), req.user.id);
    res.json({ message: 'Maintenance configuration saved', state: getMaintenanceState() });
  });

  app.get('/api/owner/maintenance', requirePermission('settings.view'), (req, res) => {
    res.json({ state: getMaintenanceState() });
  });

  // ============================================
  // EMAIL TEMPLATES
  // ============================================

  const EMAIL_VARS = ['username', 'tournament_name', 'amount', 'status', 'ticket_code', 'reset_link'];

  app.get('/api/owner/email/templates', requirePermission('email.manage'), (req, res) => {
    const templates = db.prepare('SELECT * FROM email_templates ORDER BY event_key ASC').all();
    const recentLogs = db.prepare('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 50').all();
    res.json({
      templates,
      variables: EMAIL_VARS,
      service_status: emailConfigured() ? 'CONFIGURED' : 'EMAIL SERVICE NOT CONFIGURED',
      recent_logs: recentLogs
    });
  });

  app.put('/api/owner/email/templates/:id', requirePermission('email.manage'), (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Template');
      const b = req.body || {};
      const subject = b.subject !== undefined ? cleanText(b.subject, 200) : t.subject;
      const body = b.body !== undefined ? cleanText(b.body, 10000) : t.body;
      const enabled = b.enabled !== undefined ? (b.enabled ? 1 : 0) : t.enabled;

      // Validate: unknown variables are rejected before saving
      const varRe = /\{\{\s*(\w+)\s*\}\}/g;
      const found = [];
      let m;
      const combined = subject + '\n' + body;
      while ((m = varRe.exec(combined)) !== null) found.push(m[1]);
      const unknown = found.filter(v => !EMAIL_VARS.includes(v));
      if (unknown.length) return badRequest(res, `Unknown variables: ${[...new Set(unknown)].join(', ')}. Allowed: ${EMAIL_VARS.join(', ')}`);

      db.prepare('UPDATE email_templates SET subject = ?, body = ?, enabled = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(subject, body, enabled, req.user.id, t.id);
      db.audit(req.user.id, 'email_template_updated', 'email_template', t.id, { event_key: t.event_key });
      res.json({ message: 'Template saved', rendered_preview: renderTemplate(body, { username: 'player', tournament_name: 'Example', amount: 0, status: 'PENDING', ticket_code: 'BX-000', reset_link: '...' }) });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // VERIFICATION REVIEW (sensitive, restricted)
  // ============================================

  app.get('/api/owner/verifications', requirePermission('verification.view'), (req, res) => {
    const rows = db.prepare(`
      SELECT v.id, v.user_id, v.type, v.data, v.status, v.notes, v.created_at, v.reviewed_at,
             u.username, u.name, r.username as reviewer_username
      FROM user_verifications v
      JOIN users u ON u.id = v.user_id
      LEFT JOIN users r ON r.id = v.reviewed_by
      WHERE 1=1 ${req.query.status ? 'AND v.status = ?' : ''}
      ORDER BY v.created_at DESC LIMIT 100
    `).all(...(req.query.status ? [req.query.status] : []));

    // Sensitive data is only returned to authorized reviewers; masked by default
    const canSeeDetails = req.perms.has('*') || req.perms.has('verification.review');
    const masked = rows.map(v => {
      let data = {};
      try { data = JSON.parse(v.data); } catch (_) {}
      if (canSeeDetails) return { ...v, data };
      const maskedData = {};
      for (const k of Object.keys(data)) {
        const s = String(data[k]);
        maskedData[k] = s.length > 4 ? s.slice(0, 2) + '***' + s.slice(-2) : '***';
      }
      return { ...v, data: maskedData };
    });
    res.json({ verifications: masked, can_review: canSeeDetails });
  });

  app.post('/api/owner/verifications/:id/review', requirePermission('verification.review'), (req, res) => {
    const v = db.prepare('SELECT * FROM user_verifications WHERE id = ?').get(req.params.id);
    if (!v) return notFound(res, 'Verification');
    if (v.status !== 'pending') return conflict(res, `Already ${v.status}`);

    const action = (req.body || {}).action;
    if (!['verify', 'reject'].includes(action)) return badRequest(res, 'action must be verify or reject');
    const notes = cleanText((req.body || {}).notes, 500);
    const status = action === 'verify' ? 'verified' : 'rejected';

    db.prepare('UPDATE user_verifications SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\'), notes = ? WHERE id = ?')
      .run(status, req.user.id, notes, v.id);
    notify(v.user_id, 'Verification Update', `Your ${v.type} verification is ${status.toUpperCase()}${notes ? `: ${notes}` : ''}`, 'verification');
    db.audit(req.user.id, `verification_${status}`, 'verification', v.id, { user: v.user_id, type: v.type });
    res.json({ message: `Verification ${status}` });
  });

  // ============================================
  // API KEYS (secret shown once, never again)
  // ============================================

  app.get('/api/owner/api-keys', requirePermission('apikeys.manage'), (req, res) => {
    const rows = db.prepare(`
      SELECT k.id, k.name, k.key_prefix, k.expires_at, k.last_used_at, k.revoked_at, k.created_at,
             u.username as created_by_username
      FROM api_keys k JOIN users u ON u.id = k.created_by
      ORDER BY k.created_at DESC
    `).all();
    res.json({ keys: rows.map(k => ({ ...k, masked: `bx_${k.key_prefix}_****` })) });
  });

  app.post('/api/owner/api-keys', requirePermission('apikeys.manage'), (req, res) => {
    try {
      const name = cleanText((req.body || {}).name, 80);
      if (!name) return badRequest(res, 'Name is required');
      const secret = 'bx_' + crypto.randomBytes(24).toString('hex');
      const prefix = secret.slice(3, 11);
      const id = db.makeId('KEY');

      db.prepare('INSERT INTO api_keys (id, name, key_prefix, key_hash, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, name, prefix, crypto.createHash('sha256').update(secret).digest('hex'), req.user.id, (req.body || {}).expires_at || null);
      db.audit(req.user.id, 'api_key_created', 'api_key', id, { name });

      res.status(201).json({
        message: 'API key created. Copy it now — it will never be shown again.',
        key: { id, name, secret },
        warning: 'Store this securely. The secret cannot be retrieved later.'
      });
    } catch (err) { serverError(res, err); }
  });

  app.delete('/api/owner/api-keys/:id', requirePermission('apikeys.manage'), (req, res) => {
    const k = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
    if (!k) return notFound(res, 'API key');
    db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ?').run(k.id);
    db.audit(req.user.id, 'api_key_revoked', 'api_key', k.id, { name: k.name });
    res.json({ message: 'API key revoked' });
  });

  // ============================================
  // BACKUPS
  // ============================================

  app.get('/api/owner/backups', requirePermission('backup.manage'), (req, res) => {
    const rows = db.prepare(`
      SELECT b.*, u.username as created_by_username FROM backups b
      LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC
    `).all();
    res.json({ backups: rows });
  });

  app.post('/api/owner/backups', requirePermission('backup.manage'), (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const dataDir = path.join(__dirname, '..', '..', 'data');
      const backupDir = path.join(dataDir, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `booyahx-${stamp}.db`;
      const dest = path.join(backupDir, filename);

      // SQLite backup via VACUUM INTO (safe, non-destructive)
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      const size = fs.statSync(dest).size;

      const id = db.makeId('BKP');
      db.prepare('INSERT INTO backups (id, filename, size_bytes, type, status, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, filename, size, 'full', 'completed', req.user.id);
      db.audit(req.user.id, 'backup_created', 'backup', id, { filename, size });

      res.status(201).json({ message: 'Backup created', backup: { id, filename, size_bytes: size } });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/owner/backups/:id/restore', requirePrimaryOwner, (req, res) => {
    try {
      const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
      if (!b) return notFound(res, 'Backup');
      const confirm = (req.body || {}).confirm;
      if (confirm !== 'RESTORE') {
        return badRequest(res, 'Restoration requires confirm: "RESTORE". This prevents accidental overwrites.');
      }
      // Restore is intentionally conservative: verify the file exists and
      // require an explicit restart step rather than silently swapping a live DB.
      const fs = require('fs');
      const path = require('path');
      const src = path.join(__dirname, '..', '..', 'data', 'backups', b.filename);
      if (!fs.existsSync(src)) return notFound(res, 'Backup file');

      db.audit(req.user.id, 'backup_restore_requested', 'backup', b.id, { filename: b.filename });
      res.json({
        message: 'Restore validated. Stop the server and replace data/booyahx.db with the backup file, then restart.',
        file: b.filename,
        path: src,
        note: 'Restore never overwrites the live database automatically.'
      });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // IMPORT / EXPORT (CSV & JSON)
  // ============================================

  const EXPORTABLE = {
    users: "SELECT id, name, username, email, role, status, created_at FROM users",
    tournaments: 'SELECT id, name, game, mode, format, entry_cost, player_limit, start_time, status, created_at FROM tournaments',
    results: 'SELECT id, tournament_id, user_id, position, result, reward, verified, published_at FROM tournament_results',
    transactions: 'SELECT id, user_id, type, amount, reference, status, created_at FROM transactions',
    events: 'SELECT id, title, start_time, end_time, status, created_at FROM events',
    news: 'SELECT id, title, category, status, published_at, created_at FROM news',
    updates: 'SELECT id, version, title, status, published_at, created_at FROM updates',
    reports: 'SELECT id, reporter_id, category, target, status, created_at FROM reports'
  };

  function toCsv(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  }

  app.get('/api/owner/export/:entity', requirePermission('importexport.use'), (req, res) => {
    const entity = req.params.entity;
    const sql = EXPORTABLE[entity];
    if (!sql) return notFound(res, 'Entity');
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const rows = db.prepare(sql).all();

    db.audit(req.user.id, 'data_exported', 'export', entity, { format, rows: rows.length });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="booyahx-${entity}.csv"`);
      return res.send(toCsv(rows));
    }
    res.setHeader('Content-Disposition', `attachment; filename="booyahx-${entity}.json"`);
    res.json({ entity, count: rows.length, exported_at: new Date().toISOString(), rows });
  });

  app.get('/api/owner/export-entities', requirePermission('importexport.use'), (req, res) => {
    res.json({ entities: Object.keys(EXPORTABLE), formats: ['csv', 'json'] });
  });

  // Import: validates fully before any write; dry-run by default
  app.post('/api/owner/import/:entity', requirePermission('importexport.use'), (req, res) => {
    try {
      const entity = req.params.entity;
      const b = req.body || {};
      const rows = Array.isArray(b.rows) ? b.rows : null;
      if (!rows) return badRequest(res, 'rows array is required');
      if (rows.length > 1000) return badRequest(res, 'Maximum 1000 rows per import');
      const dryRun = b.dry_run !== false;

      const errors = [];
      const valid = [];

      if (entity === 'news') {
        rows.forEach((r, i) => {
          if (!r.title || !r.content) errors.push(`Row ${i + 1}: title and content are required`);
          else valid.push({ title: cleanText(r.title, 200), category: cleanText(r.category || 'general', 60), content: cleanText(r.content, 50000), status: ['draft', 'published'].includes(r.status) ? r.status : 'draft' });
        });
      } else if (entity === 'events') {
        rows.forEach((r, i) => {
          if (!r.title) errors.push(`Row ${i + 1}: title is required`);
          else if (!Number.isFinite(Date.parse(r.start_time))) errors.push(`Row ${i + 1}: invalid start_time`);
          else if (!Number.isFinite(Date.parse(r.end_time))) errors.push(`Row ${i + 1}: invalid end_time`);
          else valid.push({ title: cleanText(r.title, 200), description: cleanText(r.description || '', 4000), start_time: r.start_time, end_time: r.end_time, status: ['draft', 'published'].includes(r.status) ? r.status : 'draft' });
        });
      } else {
        return badRequest(res, `Import not supported for '${entity}'. Supported: news, events`);
      }

      if (dryRun) {
        return res.json({ dry_run: true, valid: valid.length, errors, rows: valid.slice(0, 20) });
      }

      if (errors.length) return res.status(400).json({ error: 'Validation failed — nothing was imported', details: errors });

      let inserted = 0;
      db.tx(() => {
        for (const row of valid) {
          if (entity === 'news') {
            db.prepare('INSERT INTO news (id, title, category, content, status, created_by) VALUES (?, ?, ?, ?, ?, ?)')
              .run(db.makeId('NEW'), row.title, row.category, row.content, row.status, req.user.id);
          } else if (entity === 'events') {
            db.prepare('INSERT INTO events (id, title, description, start_time, end_time, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(db.makeId('EVT'), row.title, row.description, row.start_time, row.end_time, row.status, req.user.id);
          }
          inserted++;
        }
        db.audit(req.user.id, 'data_imported', 'import', entity, { inserted });
      });

      res.json({ message: `Imported ${inserted} record(s)`, inserted });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // ANALYTICS (real queries only)
  // ============================================

  app.get('/api/owner/analytics', requirePermission('analytics.view'), (req, res) => {
    try {
      const players = {
        new_users_7d: db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-7 days')").get().c,
        new_users_30d: db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-30 days')").get().c,
        total_users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        active_users: db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM login_history WHERE status = 'success' AND login_at >= datetime('now', '-7 days')").get().c,
        returning_users: db.prepare(`
          SELECT COUNT(*) as c FROM (
            SELECT user_id FROM login_history WHERE status = 'success'
            GROUP BY user_id HAVING COUNT(DISTINCT date(login_at)) > 1
          )`).get().c,
        tournament_participants: db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM tournament_registrations WHERE status = 'registered'").get().c,
        retention_d30: db.prepare(`
          SELECT COUNT(*) as c FROM (
            SELECT user_id FROM login_history WHERE status = 'success' AND login_at >= datetime('now', '-30 days')
            INTERSECT
            SELECT user_id FROM login_history WHERE status = 'success' AND login_at <= datetime('now', '-30 days') AND login_at >= datetime('now', '-60 days')
          )`).get().c
      };

      const tournaments = {
        total: db.prepare('SELECT COUNT(*) as c FROM tournaments').get().c,
        registrations: db.prepare("SELECT COUNT(*) as c FROM tournament_registrations WHERE status = 'registered'").get().c,
        completed: db.prepare("SELECT COUNT(*) as c FROM tournaments WHERE status = 'completed'").get().c,
        cancelled: db.prepare("SELECT COUNT(*) as c FROM tournaments WHERE status = 'cancelled'").get().c,
        completion_rate: (() => {
          const total = db.prepare("SELECT COUNT(*) as c FROM tournaments WHERE status IN ('completed', 'cancelled')").get().c;
          const done = db.prepare("SELECT COUNT(*) as c FROM tournaments WHERE status = 'completed'").get().c;
          return total ? Math.round((done / total) * 1000) / 10 : 0;
        })(),
        mode_breakdown: db.prepare('SELECT mode, COUNT(*) as count FROM tournaments GROUP BY mode ORDER BY count DESC').all()
      };

      const financial = {
        deposits_total: db.prepare("SELECT COALESCE(SUM(coins), 0) as v FROM deposits WHERE status = 'verified'").get().v,
        deposits_pending: db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status IN ('pending', 'under_review')").get().c,
        withdrawals_total: db.prepare("SELECT COALESCE(SUM(coins), 0) as v FROM withdrawals WHERE status IN ('approved', 'processing', 'paid')").get().v,
        withdrawals_paid: db.prepare("SELECT COALESCE(SUM(coins), 0) as v FROM withdrawals WHERE status = 'paid'").get().v,
        entry_fees_collected: db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) as v FROM transactions WHERE type = 'tournament_entry' AND status = 'completed'").get().v,
        rewards_paid: db.prepare("SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type = 'reward' AND status = 'completed'").get().v,
        daily_rewards_paid: db.prepare("SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type = 'daily_reward' AND status = 'completed'").get().v,
        coin_flow: db.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_in,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) as total_out
          FROM transactions WHERE status = 'completed'`).get(),
        balances_held: db.prepare('SELECT COALESCE(SUM(balance), 0) as v FROM wallets').get().v,
        daily_volume: db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) as v FROM transactions WHERE status = 'completed' AND created_at >= datetime('now', '-7 days')").get().v
      };

      res.json({ players, tournaments, financial, computed_from: 'database_queries' });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // SYSTEM HEALTH (honest statuses)
  // ============================================

  app.get('/api/owner/system-health', requirePermission('systemhealth.view'), (req, res) => {
    const checks = [];

    // Database
    try {
      db.prepare('SELECT 1 as t').get();
      const integrity = db.prepare('PRAGMA quick_check').get();
      checks.push({ name: 'Database', status: integrity && Object.values(integrity)[0] === 'ok' ? 'CONNECTED' : 'ERROR', detail: 'SQLite via node:sqlite' });
    } catch (err) {
      checks.push({ name: 'Database', status: 'ERROR', detail: err.message });
    }

    // API (this request succeeded if you're reading it)
    checks.push({ name: 'API', status: 'CONNECTED', detail: `Express on port ${process.env.PORT || 3000}` });

    // Authentication
    try {
      const sessions = db.prepare('SELECT COUNT(*) as c FROM login_history WHERE status = \'success\' AND login_at >= datetime(\'now\', \'-1 day\')').get().c;
      checks.push({ name: 'Authentication', status: 'CONNECTED', detail: `${sessions} successful logins in last 24h` });
    } catch (err) {
      checks.push({ name: 'Authentication', status: 'ERROR', detail: err.message });
    }

    // Payments
    const paymentsConfigured = Boolean(process.env.EPAYPAISA_API_KEY || process.env.JAZZCASH_API_KEY);
    checks.push({
      name: 'Payments',
      status: paymentsConfigured ? 'CONNECTED' : 'NOT CONFIGURED',
      detail: paymentsConfigured ? 'Provider credentials present' : 'Manual deposit review workflow active. No provider API credentials set.'
    });

    // Email
    checks.push({
      name: 'Email',
      status: emailConfigured() ? 'CONNECTED' : 'NOT CONFIGURED',
      detail: emailConfigured() ? `SMTP via ${process.env.EMAIL_HOST}` : 'SMTP credentials missing'
    });

    // Storage
    try {
      const fs = require('fs');
      const path = require('path');
      const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      checks.push({ name: 'Storage', status: 'CONNECTED', detail: uploadDir });
    } catch (err) {
      checks.push({ name: 'Storage', status: 'ERROR', detail: err.message });
    }

    // Real-time service (WebSocket/SSE not configured — never claim otherwise)
    checks.push({
      name: 'Real-time Service',
      status: process.env.REALTIME_ENABLED === 'true' ? 'CONNECTED' : 'NOT CONFIGURED',
      detail: process.env.REALTIME_ENABLED === 'true' ? 'WebSocket enabled' : 'Polling only. No WebSocket/SSE configured.'
    });

    res.json({
      environment: process.env.NODE_ENV || 'LOCAL DEVELOPMENT',
      checks,
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  // ============================================
  // ERROR LOGS
  // ============================================

  app.get('/api/owner/errors', requirePermission('errors.view'), (req, res) => {
    const rows = db.prepare(`
      SELECT e.*, u.username as resolved_by_username FROM error_logs e
      LEFT JOIN users u ON u.id = e.resolved_by
      ORDER BY e.created_at DESC LIMIT 100
    `).all();
    const unresolved = db.prepare('SELECT COUNT(*) as c FROM error_logs WHERE resolved = 0').get().c;
    res.json({ errors: rows, unresolved, empty: rows.length === 0 });
  });

  app.post('/api/owner/errors/:id/resolve', requirePermission('errors.manage'), (req, res) => {
    const e = db.prepare('SELECT * FROM error_logs WHERE id = ?').get(req.params.id);
    if (!e) return notFound(res, 'Error log');
    db.prepare('UPDATE error_logs SET resolved = 1, resolved_by = ? WHERE id = ?').run(req.user.id, e.id);
    db.audit(req.user.id, 'error_resolved', 'error_log', e.id, {});
    res.json({ message: 'Marked resolved' });
  });

  // Client-side error reports (sanitized)
  app.post('/api/errors', optionalAuth, (req, res) => {
    const b = req.body || {};
    logError({
      endpoint: cleanText(b.endpoint, 200),
      method: cleanText(b.method, 10),
      type: 'client_' + cleanText(b.type || 'error', 40),
      status: asInt(b.status, 0) || null,
      message: cleanText(b.message, 500),
      requestId: req.requestId
    });
    res.status(202).json({ message: 'Logged' });
  });

  // ============================================
  // LOGIN HISTORY ADMIN (restricted)
  // ============================================

  app.get('/api/owner/login-history/:userId', requirePermission('users.view'), (req, res) => {
    const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
    if (!u) return notFound(res, 'User');
    const rows = db.prepare(`
      SELECT id, login_at, ip, device, browser, status FROM login_history
      WHERE user_id = ? ORDER BY login_at DESC LIMIT 50
    `).all(u.id);
    res.json({ user: u, history: rows });
  });

  // ============================================
  // SECURITY ALERTS (admin)
  // ============================================

  app.get('/api/owner/security-alerts', requirePermission('users.view'), (req, res) => {
    const rows = db.prepare(`
      SELECT s.*, u.username FROM security_alerts s
      LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT 100
    `).all();
    res.json({ alerts: rows, empty: rows.length === 0 });
  });

  app.post('/api/owner/security-alerts/:id/resolve', requirePermission('users.edit'), (req, res) => {
    const a = db.prepare('SELECT * FROM security_alerts WHERE id = ?').get(req.params.id);
    if (!a) return notFound(res, 'Alert');
    db.prepare("UPDATE security_alerts SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
      .run(req.user.id, a.id);
    db.audit(req.user.id, 'security_alert_resolved', 'security_alert', a.id, {});
    res.json({ message: 'Alert resolved' });
  });

  // Password change by user (self-service, audited)
  app.post('/api/auth/change-password', requireAuth, (req, res) => {
    const b = req.body || {};
    const { currentPassword, newPassword, confirmPassword } = b;
    if (!currentPassword || !newPassword) return badRequest(res, 'Current and new password are required');
    if (newPassword.length < 8) return badRequest(res, 'New password must be at least 8 characters');
    if (newPassword !== confirmPassword) return badRequest(res, 'Passwords do not match');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(currentPassword), user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect', code: 'INVALID_CREDENTIALS' });
    }

    db.tx(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(bcrypt.hashSync(String(newPassword), 12), user.id);
      db.audit(user.id, 'password_changed', 'user', user.id, {});
      db.prepare('INSERT INTO security_alerts (id, user_id, type, message, severity) VALUES (?, ?, ?, ?, ?)')
        .run(db.makeId('SEC'), user.id, 'password_change', 'Password changed from your account', 'warning');
    });
    res.json({ message: 'Password changed' });
  });
};
