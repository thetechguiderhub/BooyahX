/* ============================================
   BOOYAHX — AUTHENTICATION & RBAC MIDDLEWARE
   Server-side authorization driven by the
   roles / permissions / role_permissions /
   user_roles tables. The frontend is never
   trusted for permissions.
   ============================================ */

const db = require('../db');

// In-memory permission cache (invalidated on role changes)
let permCache = new Map(); // userId -> { roles: Set, perms: Set, loadedAt }
const CACHE_TTL_MS = 15000;

function invalidateUser(userId) {
  if (userId) permCache.delete(userId);
  else permCache.clear();
}
db.invalidateRbacCache = invalidateUser;

/**
 * Load a user's roles and permissions from the database.
 * PRIMARY_OWNER implicitly holds every permission ('*').
 */
function loadAccess(userId) {
  const cached = permCache.get(userId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  const roles = new Set(
    db.prepare(`
      SELECT r.name FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `).all(userId).map(r => r.name)
  );

  // Fallback: legacy users with users.role but no user_roles rows
  if (roles.size === 0) {
    const legacy = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (legacy) roles.add(legacy.role);
  }

  const perms = new Set();
  if (roles.has('PRIMARY_OWNER') || roles.has('OWNER')) {
    perms.add('*');
  } else {
    const rows = db.prepare(`
      SELECT DISTINCT p.key FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?
    `).all(userId);
    for (const r of rows) perms.add(r.key);
  }

  const entry = { roles, perms, loadedAt: Date.now() };
  permCache.set(userId, entry);
  return entry;
}

// ============================================
// MIDDLEWARE
// ============================================

/** Require an authenticated, active user. Attaches req.user, req.roles, req.perms. */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
  }

  const user = db.prepare(
    'SELECT id, name, username, email, role, status, created_at FROM users WHERE id = ?'
  ).get(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
  }

  const access = loadAccess(user.id);
  req.user = user;
  req.roles = access.roles;
  req.perms = access.perms;
  next();
}

/** Optional auth: attaches user/roles/perms when a session exists. */
function optionalAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare(
      'SELECT id, name, username, email, role, status FROM users WHERE id = ?'
    ).get(req.session.userId);
    if (user && user.status === 'active') {
      const access = loadAccess(user.id);
      req.user = user;
      req.roles = access.roles;
      req.perms = access.perms;
    }
  }
  next();
}

function hasPerm(req, permission) {
  if (!req.perms) return false;
  return req.perms.has('*') || req.perms.has(permission);
}

/** Require ANY one of the listed permission keys (alias support: e.g.
 *  tournaments.create OR moderator.tournaments.create). DB-driven; the first
 *  key is reported on deny. */
function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
    }
    if (!permissions.some(p => hasPerm(req, p))) {
      return res.status(403).json({ error: 'ACCESS DENIED', code: 'PERMISSION_DENIED', permission: permissions[0] });
    }
    next();
  };
}

/** Require any one of several permission keys. */
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
    }
    if (permissions.some(p => hasPerm(req, p))) return next();
    return res.status(403).json({ error: 'ACCESS DENIED', code: 'PERMISSION_DENIED' });
  };
}

/** Require one of the given role names. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
    }
    if (!roles.some(r => req.roles.has(r))) {
      return res.status(403).json({ error: 'ACCESS DENIED', code: 'ROLE_DENIED' });
    }
    next();
  };
}

/** OWNER or PRIMARY_OWNER. */
function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
  if (!req.roles.has('OWNER') && !req.roles.has('PRIMARY_OWNER')) {
    return res.status(403).json({ error: 'ACCESS DENIED', code: 'ROLE_DENIED' });
  }
  next();
}

/** PRIMARY_OWNER only. */
function requirePrimaryOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'ACCESS DENIED', code: 'AUTH_REQUIRED' });
  if (!req.roles.has('PRIMARY_OWNER')) {
    return res.status(403).json({ error: 'ACCESS DENIED', code: 'ROLE_DENIED' });
  }
  next();
}

/**
 * PRIMARY OWNER PROTECTION.
 * The Primary Owner account (and the PRIMARY_OWNER role grant) can never be
 * altered by anyone other than the Primary Owner themselves.
 * Returns an error message string when blocked, null when allowed.
 */
function checkPrimaryOwnerProtection(actor, targetUserId, action) {
  const targetRoles = db.prepare(`
    SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?
  `).all(targetUserId).map(r => r.name);

  const targetIsPrimary = targetRoles.includes('PRIMARY_OWNER');
  const actorIsPrimary = actor.roles && actor.roles.has('PRIMARY_OWNER');

  if (targetIsPrimary && !actorIsPrimary) {
    return 'PRIMARY_OWNER is protected. This action requires the Primary Owner account.';
  }
  if (targetIsPrimary && actorIsPrimary && ['remove_role', 'demote', 'disable', 'delete'].includes(action)) {
    return 'The Primary Owner cannot remove or disable their own primary authority.';
  }
  return null;
}

/** Get the full permission list for a user (for frontend navigation). */
function getUserAccess(userId) {
  const access = loadAccess(userId);
  const allPerms = db.prepare('SELECT key FROM permissions').all().map(p => p.key);
  return {
    roles: [...access.roles],
    permissions: access.perms.has('*') ? allPerms : [...access.perms],
    isPrimaryOwner: access.roles.has('PRIMARY_OWNER')
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireOwner,
  requirePrimaryOwner,
  checkPrimaryOwnerProtection,
  getUserAccess,
  hasPerm,
  invalidateUser
};
