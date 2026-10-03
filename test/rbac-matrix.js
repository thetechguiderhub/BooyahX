/* ============================================
   BOOYAHX — 13-ROLE RBAC SECURITY MATRIX
   ----------------------------------------
   For every role in the spec (PRIMARY_OWNER, OWNER, DEVELOPER, ADMIN,
   MODERATOR, SUPPORT, TOURNAMENT_MANAGER, FINANCE_MANAGER,
   CONTENT_MANAGER, COMMUNITY_MANAGER, ANALYST, STAFF, USER):

     1. A real account gets that role (fresh signup + role assignment,
        except PRIMARY_OWNER which uses the seeded account).
     2. ~60 guarded endpoints are probed with that account's session.
     3. Expected access is computed EXACTLY like the server middleware
        (user_roles -> roles -> role_permissions, OWNER/PRIMARY_OWNER '*').
     4. Assert: permitted endpoint  -> status NOT in {401, 403}
                denied endpoint     -> status in {401, 403}
     5. Anonymous session          -> every probe must be 401
     6. Static check: every sidebar NAV permission exists in the
        permissions table (frontend nav matches backend permissions).
     7. Teardown deletes the test accounts.

   No fake data is created: test accounts are removed at the end.
   ============================================ */

const BASE = 'http://localhost:3000';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const ROLES = [
  'PRIMARY_OWNER', 'OWNER', 'DEVELOPER', 'ADMIN', 'MODERATOR', 'SUPPORT',
  'TOURNAMENT_MANAGER', 'FINANCE_MANAGER', 'CONTENT_MANAGER',
  'COMMUNITY_MANAGER', 'ANALYST', 'STAFF', 'USER'
];

const PRIMARY_OWNER_EMAIL = 'itxmeshadow1234@gmail.com';
const PRIMARY_OWNER_PASSWORD = require('./_env').PRIMARY_OWNER_PASSWORD;
const TEST_PASSWORD = 'TestPass123!';

/* Probes: [method, apiPath, permissionKey | '@auth']
   '@auth' = any authenticated active user (requireAuth only).
   Bodies default to {} — handlers fail validation (400) or look up a
   nonexistent id (404) AFTER the permission middleware, so a non-401/403
   status proves the permission check passed without mutating anything. */
const PROBES = [
  ['GET',    '/owner/stats',                              'dashboard.view'],
  ['GET',    '/owner/activity',                           'dashboard.view'],
  ['GET',    '/owner/analytics',                          'analytics.view'],
  ['GET',    '/owner/users',                              'users.view'],
  ['GET',    '/owner/login-history/NONEXIST',             'users.view'],
  ['GET',    '/owner/security-alerts',                    'users.view'],
  ['PUT',    '/owner/users/NONEXIST',                     'users.edit'],
  ['POST',   '/owner/users/bulk',                         'users.bulk'],
  ['POST',   '/owner/security-alerts/NONEXIST/resolve',   'users.edit'],
  ['DELETE', '/owner/users/NONEXIST',                     'users.delete'],
  ['GET',    '/roles',                                    'roles.view'],
  ['POST',   '/owner/team/assign',                        'roles.manage'],
  ['POST',   '/owner/team/revoke',                        'roles.manage'],
  ['GET',    '/owner/team',                               'staff.view'],
  ['POST',   '/owner/team/disable',                       'staff.manage'],
  ['GET',    '/owner/audit-logs',                         'audit.view'],
  ['GET',    '/owner/maintenance',                        'settings.view'],
  ['POST',   '/owner/maintenance',                        'maintenance.manage'],
  ['PUT',    '/settings',                                 'settings.manage'],
  ['GET',    '/owner/email/templates',                    'email.manage'],
  ['PUT',    '/owner/email/templates/NONEXIST',           'email.manage'],
  ['GET',    '/owner/verifications',                      'verification.view'],
  ['POST',   '/owner/verifications/NONEXIST/review',      'verification.review'],
  ['GET',    '/owner/api-keys',                           'apikeys.manage'],
  ['GET',    '/owner/backups',                            'backup.manage'],
  ['GET',    '/owner/export-entities',                    'importexport.use'],
  ['GET',    '/owner/system-health',                      'systemhealth.view'],
  ['GET',    '/owner/errors',                             'errors.view'],
  ['POST',   '/owner/errors/NONEXIST/resolve',            'errors.manage'],
  ['GET',    '/deposits',                                 'deposits.view'],
  ['POST',   '/deposits/NONEXIST/approve',                'deposits.verify'],
  ['POST',   '/deposits/NONEXIST/reject',                 'deposits.reject'],
  ['GET',    '/withdrawals',                              'withdrawals.view'],
  ['POST',   '/withdrawals/NONEXIST/approve',             'withdrawals.approve'],
  ['POST',   '/withdrawals/NONEXIST/reject',              'withdrawals.reject'],
  ['GET',    '/promo-codes',                              'promos.manage'],
  ['DELETE', '/coin-packages/NONEXIST',                   'economy.manage'],
  ['POST',   '/tournament-results',                       'results.manage'],
  ['POST',   '/tournament-results/NONEXIST/publish',       'results.publish'],
  ['PUT',    '/achievements/NONEXIST',                    'achievements.manage'],
  ['DELETE', '/achievements/NONEXIST',                    'achievements.manage'],
  ['POST',   '/tournaments',                              'tournaments.create'],
  ['PUT',    '/tournaments/NONEXIST',                     'tournaments.edit'],
  ['DELETE', '/tournaments/NONEXIST',                     'tournaments.cancel'],
  ['PUT',    '/tournaments/NONEXIST/bracket',             'tournaments.brackets'],
  ['GET',    '/tournament-templates',                     'tournaments.templates'],
  ['PUT',    '/tournament-templates/NONEXIST',            'tournaments.templates'],
  ['DELETE', '/tournament-templates/NONEXIST',            'tournaments.templates'],
  ['POST',   '/categories',                               'tournaments.categories'],
  ['POST',   '/series',                                   'tournaments.series'],
  ['PUT',    '/events/NONEXIST',                          'events.manage'],
  ['PUT',    '/news/NONEXIST',                            'news.manage'],
  ['PUT',    '/updates/NONEXIST',                         'updates.manage'],
  ['PUT',    '/banners/NONEXIST',                         'banners.manage'],
  ['PUT',    '/popups/NONEXIST',                          'popups.manage'],
  ['PUT',    '/sponsors/NONEXIST',                        'sponsors.manage'],
  ['PUT',    '/highlights/NONEXIST',                      'highlights.manage'],
  ['POST',   '/polls',                                    'polls.manage'],
  ['POST',   '/feedback/NONEXIST/respond',                'feedback.manage'],
  ['GET',    '/feedback',                                 'feedback.view'],
  ['POST',   '/reports/NONEXIST/handle',                  'reports.manage'],
  ['GET',    '/reports',                                  'reports.view'],
  ['POST',   '/support/tickets/NONEXIST/assign',          'support.manage'],
  ['GET',    '/support/tickets',                          '@auth'],
  ['POST',   '/notifications/broadcast',                  'notifications.broadcast']
];

// ---------- HTTP helpers ----------

async function api(method, apiPath, cookie, body) {
  const res = await fetch(BASE + '/api' + apiPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    // GET/HEAD must never carry a body (fetch would throw)
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body ?? {})
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookieHeader = setCookies
    .map(c => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
  return { status: res.status, cookie: cookieHeader };
}

function extractCookie(res) {
  return res.cookie || '';
}

async function signIn(email, password) {
  const r = await api('POST', '/auth/signin', null, { email, password });
  if (r.status !== 200 || !r.cookie) {
    throw new Error(`signin failed for ${email}: HTTP ${r.status}`);
  }
  return r.cookie;
}

async function signUp(username, email) {
  const r = await api('POST', '/auth/signup', null, {
    name: username.replace(/_/g, ' '),
    username,
    email,
    password: TEST_PASSWORD,
    confirmPassword: TEST_PASSWORD,
    termsAccepted: true
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`signup failed for ${username}: HTTP ${r.status}`);
  }
}

// ---------- Expected permission set (mirror of middleware loadAccess) ----------

function expectedPermsForUser(userId) {
  let roles = db.prepare(`
    SELECT r.name FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ?
  `).all(userId).map(r => r.name);

  if (roles.length === 0) {
    const legacy = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (legacy) roles = [legacy.role];
  }

  if (roles.includes('PRIMARY_OWNER') || roles.includes('OWNER')) {
    return new Set(['*']);
  }

  const rows = db.prepare(`
    SELECT DISTINCT p.key FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ?
  `).all(userId);
  return new Set(rows.map(r => r.key));
}

function shouldAllow(perms, permission) {
  if (permission === '@auth') return true; // signed in during probes
  return perms.has('*') || perms.has(permission);
}

// ---------- Probe runner ----------

async function runProbes(cookie, perms) {
  const results = [];
  for (const [method, apiPath, permission] of PROBES) {
    let status;
    try {
      const r = await api(method, apiPath, cookie, {});
      status = r.status;
    } catch (err) {
      status = -1;
    }
    const expected = shouldAllow(perms, permission);
    const denied = status === 401 || status === 403;
    // status -1 = request itself failed (test error, never a pass)
    const ok = status === -1 || status === 429 ? false : (expected ? !denied : denied);
    results.push({ method, apiPath, permission, status, expected, ok });
  }
  return results;
}

// ---------- Static NAV <-> permissions check ----------

function checkNavPermissions() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'owner-auth.js'), 'utf8');
  const permKeys = new Set(db.prepare('SELECT key FROM permissions').all().map(p => p.key));
  const navRe = /\{\s*page:\s*'([^']+)'[^}]*permission:\s*'([^']+)'/g;
  const problems = [];
  const navItems = [];
  let m;
  while ((m = navRe.exec(src)) !== null) {
    navItems.push({ page: m[1], permission: m[2] });
    if (!permKeys.has(m[2])) problems.push(`nav ${m[1]} -> unknown permission ${m[2]}`);
  }
  return { navItems, problems };
}

// ---------- Main ----------

(async () => {
  const failures = [];
  const summary = [];
  const createdUsers = []; // { id, username } for teardown

  // 1. Sign in as the Primary Owner (assignment + teardown)
  const ownerCookie = await signIn(PRIMARY_OWNER_EMAIL, PRIMARY_OWNER_PASSWORD);
  const ownerRow = db.prepare("SELECT id FROM users WHERE email = ?").get(PRIMARY_OWNER_EMAIL);

  // 2. PRIMARY_OWNER row: probe with the seeded account
  {
    const perms = expectedPermsForUser(ownerRow.id);
    const results = await runProbes(ownerCookie, perms);
    const bad = results.filter(r => !r.ok);
    summary.push({ role: 'PRIMARY_OWNER', total: results.length, allowed: results.filter(r => r.expected).length, bad: bad.length });
    bad.forEach(b => failures.push(`PRIMARY_OWNER  ${b.method} ${b.apiPath} [${b.permission}] -> HTTP ${b.status} (expected ${b.expected ? 'allowed' : 'denied'})`));
  }

  // 3. Remaining 12 roles: fresh account each
  for (const role of ROLES) {
    if (role === 'PRIMARY_OWNER') continue;
    const username = 'rbac_' + role.toLowerCase();
    const email = username + '@example.com';

    let existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!existing) {
      await signUp(username, email);
      existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (!existing) throw new Error(`signup did not create ${username}`);
    }
    createdUsers.push({ id: existing.id, username });

    // Assign the role as the Primary Owner (DB row + permission-cache invalidation)
    const assign = await api('POST', '/owner/team/assign', ownerCookie, { username, role });
    if (assign.status !== 200) {
      failures.push(`${role}: role assignment returned HTTP ${assign.status}`);
    }

    // Fresh session as that user
    const cookie = await signIn(email, TEST_PASSWORD);
    const perms = expectedPermsForUser(existing.id);
    const results = await runProbes(cookie, perms);
    const bad = results.filter(r => !r.ok);
    summary.push({ role, total: results.length, allowed: results.filter(r => r.expected).length, bad: bad.length });
    bad.forEach(b => failures.push(`${role}  ${b.method} ${b.apiPath} [${b.permission}] -> HTTP ${b.status} (expected ${b.expected ? 'allowed' : 'denied'})`));
  }

  // 4. Anonymous session: every probe endpoint must be 401
  {
    let anonBad = 0;
    for (const [method, apiPath] of PROBES) {
      let status;
      try { status = (await api(method, apiPath, null, {})).status; } catch (e) { status = -1; }
      if (status !== 401) {
        anonBad++;
        failures.push(`ANONYMOUS  ${method} ${apiPath} -> HTTP ${status} (expected 401)`);
      }
    }
    summary.push({ role: '(anonymous)', total: PROBES.length, allowed: 0, bad: anonBad });
  }

  // 5. Frontend nav permissions must all exist in the backend permission table
  const nav = checkNavPermissions();
  nav.problems.forEach(p => failures.push(`NAV: ${p}`));
  summary.push({ role: '(nav static)', total: nav.navItems.length, allowed: nav.navItems.length, bad: nav.problems.length });

  // 6. Teardown — remove test accounts (also exercises users.delete)
  for (const u of createdUsers) {
    try {
      const del = await api('DELETE', '/owner/users/' + encodeURIComponent(u.id), ownerCookie);
      if (del.status !== 200) {
        // fall back to direct cleanup so the DB never keeps test rows
        db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(u.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        failures.push(`teardown: DELETE /owner/users/${u.username} -> HTTP ${del.status} (cleaned directly)`);
      }
    } catch (e) {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }
  }
  db.prepare('DELETE FROM users WHERE username LIKE ?').run('rbac_%');

  // ---------- Report ----------
  console.log('\n=== 13-ROLE RBAC SECURITY MATRIX ===\n');
  console.log(
    'ROLE'.padEnd(22),
    'PROBES'.padStart(7),
    'EXP.ALLOW'.padStart(10),
    'FAILS'.padStart(7)
  );
  for (const s of summary) {
    console.log(
      s.role.padEnd(22),
      String(s.total).padStart(7),
      String(s.allowed).padStart(10),
      String(s.bad).padStart(7)
    );
  }

  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    failures.forEach(f => console.log('  ✗ ' + f));
    console.log('\nRBAC MATRIX: FAIL');
    process.exit(1);
  } else {
    console.log(`\nAll roles enforced correctly: allowed endpoints work, denied endpoints return 401/403,`);
    console.log(`anonymous access is rejected, and every sidebar NAV permission exists in the backend.`);
    console.log('RBAC MATRIX: PASS');
    process.exit(0);
  }
})().catch(err => {
  console.error('RBAC MATRIX RUNNER ERROR:', err);
  process.exit(1);
});
