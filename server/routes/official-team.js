/* ============================================
   BOOYAHX — OFFICIAL TEAM ROUTES
   The Official Team is the BooyahX operating/build
   team. Every assignment references a REAL user
   (official_team_members.user_id -> users.id).
   Display roles are presentation only and NEVER
   replace the security RBAC role of the account.
   No fake/demo/sample users exist here.
   ============================================ */

const crypto = require('crypto');

module.exports = function officialTeamRoutes(app, ctx) {
  const { db, requirePermission, checkPrimaryOwnerProtection } = ctx;
  const { badRequest, notFound, serverError } = require('../helpers');

  const PUBLIC_COLUMNS = `
    SELECT p.display_role, p.title, p.display_order,
           m.id AS member_id, m.active, m.created_at AS assigned_at,
           u.id AS user_id, u.name AS user_name, u.username
    FROM official_team_positions p
    LEFT JOIN official_team_members m ON m.display_role = p.display_role
    LEFT JOIN users u ON u.id = m.user_id
  `;

  function shapePositions(rows, { includeEmail, includeInactive }) {
    // includeEmail: only the owner console exposes emails; the public view never does.
    const byRole = new Map();
    for (const p of db.prepare('SELECT * FROM official_team_positions ORDER BY display_order, title').all()) {
      byRole.set(p.display_role, {
        display_role: p.display_role,
        title: p.title,
        display_order: p.display_order,
        members: [],
        available: true
      });
    }

    for (const r of rows) {
      const slot = byRole.get(r.display_role);
      if (!slot) continue;
      if (!includeInactive && !r.active) continue;
      if (!r.user_id) continue;
      slot.members.push({
        id: r.member_id,
        user_id: r.user_id,
        name: r.user_name || r.username,
        username: r.username,
        email: includeEmail ? (db.prepare('SELECT email FROM users WHERE id = ?').get(r.user_id) || {}).email : undefined,
        active: !!r.active,
        assigned_at: r.assigned_at,
        // Security/RBAC roles come straight from user_roles — display role never replaces them.
        security_roles: db.prepare(`
          SELECT ro.name FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.user_id = ?
        `).all(r.user_id).map(x => x.name)
      });
    }

    const positions = [...byRole.values()];
    for (const p of positions) {
      p.available = p.members.length === 0;
      if (!includeEmail) for (const m of p.members) delete m.email;
    }
    return positions;
  }

  // ---------- PUBLIC: Official Team (privacy-safe) ----------
  // No email addresses are exposed publicly; only real display names/usernames.
  app.get('/api/official-team', (req, res) => {
    try {
      const positions = shapePositions(db.prepare(PUBLIC_COLUMNS).all(), { includeEmail: false, includeInactive: false });
      res.json({ positions, empty: positions.every(p => p.available) });
    } catch (err) { serverError(res, err); }
  });

  // ---------- OWNER: full detail (emails visible to permitted staff) ----------
  app.get('/api/owner/official-team', requirePermission('staff.view'), (req, res) => {
    try {
      const rows = db.prepare(PUBLIC_COLUMNS).all();
      const positions = shapePositions(rows, { includeEmail: true, includeInactive: true });
      res.json({ positions, empty: positions.every(p => p.members.filter(m => m.active).length === 0) });
    } catch (err) { serverError(res, err); }
  });

  // ---------- OWNER: assign a REAL user to a display position ----------
  app.post('/api/owner/official-team/assign', requirePermission('roles.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const displayRole = String(b.display_role || '').trim();
      if (!displayRole) return badRequest(res, 'display_role is required');

      const pos = db.prepare('SELECT * FROM official_team_positions WHERE display_role = ?').get(displayRole);
      if (!pos) return notFound(res, 'Official team position');

      const target = db.prepare('SELECT * FROM users WHERE id = ? OR email = ? OR username = ?')
        .get(b.user_id || b.user, b.email || b.user, b.username || b.user);
      if (!target) return notFound(res, 'User');

      const existing = db.prepare('SELECT * FROM official_team_members WHERE user_id = ? AND display_role = ?')
        .get(target.id, displayRole);

      if (existing) {
        db.prepare("UPDATE official_team_members SET active = 1, display_order = ?, updated_at = datetime('now') WHERE id = ?")
          .run(pos.display_order, existing.id);
      } else {
        db.prepare(`
          INSERT INTO official_team_members (id, user_id, display_role, display_order, active)
          VALUES (?, ?, ?, ?, 1)
        `).run('OTM-' + crypto.randomBytes(8).toString('hex'), target.id, displayRole, pos.display_order);
      }

      db.audit(req.user.id, 'official_team_assigned', 'official_team_member', `${target.id}:${displayRole}`,
        { user: target.username, display_role: displayRole });
      res.json({ message: `${target.username} assigned to Official Team position ${pos.title}` });
    } catch (err) { serverError(res, err); }
  });

  // ---------- OWNER: deactivate / re-activate an assignment ----------
  app.post('/api/owner/official-team/set-active', requirePermission('roles.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const member = db.prepare('SELECT * FROM official_team_members WHERE id = ?').get(b.id);
      if (!member) return notFound(res, 'Official team assignment');

      const protection = checkPrimaryOwnerProtection(req, member.user_id, 'official_team_change');
      if (protection) return res.status(403).json({ error: protection, code: 'FORBIDDEN' });

      const active = b.active ? 1 : 0;
      db.prepare("UPDATE official_team_members SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active, member.id);
      db.audit(req.user.id, active ? 'official_team_activated' : 'official_team_deactivated',
        'official_team_member', member.id, { active: !!active });
      res.json({ message: `Official Team assignment ${active ? 'activated' : 'deactivated'}` });
    } catch (err) { serverError(res, err); }
  });

  // ---------- OWNER: remove an assignment (deletes the row) ----------
  app.post('/api/owner/official-team/revoke', requirePermission('roles.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const member = db.prepare('SELECT * FROM official_team_members WHERE id = ?').get(b.id);
      if (!member) return notFound(res, 'Official team assignment');

      const protection = checkPrimaryOwnerProtection(req, member.user_id, 'official_team_change');
      if (protection) return res.status(403).json({ error: protection, code: 'FORBIDDEN' });

      db.prepare('DELETE FROM official_team_members WHERE id = ?').run(member.id);
      db.audit(req.user.id, 'official_team_revoked', 'official_team_member', member.id, {});
      res.json({ message: 'Official Team assignment removed' });
    } catch (err) { serverError(res, err); }
  });
};
