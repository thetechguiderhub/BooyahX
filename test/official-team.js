/* ============================================
   BOOYAHX — OFFICIAL TEAM VERIFICATION
   ----------------------------------------
   Verifies the Official Team (operating/build team,
   NOT player clans) against a running server:

     1. Public endpoint /api/official-team exposes
        NO email addresses and NO fake members.
     2. Every assignment references a REAL user
        (official_team_members.user_id -> users.id).
     3. Developer slot = the real PRIMARY_OWNER account
        (security role must remain PRIMARY_OWNER).
     4. Owner slot = the real temporary OWNER account
        (security role must remain OWNER).
     5. All unassigned positions report Available.
     6. Deactivating an assignment immediately removes
        the member from the public page and does NOT
        touch the account's RBAC role.
     7. No fake/demo/sample accounts exist in users.

   Run with the server up:  node test/official-team.js
   PRIMARY OWNER sign-in uses PRIMARY_OWNER_PASSWORD
   or the documented default, same as rbac-matrix.js.
   ============================================ */

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const BASE = 'http://localhost:3000/api';
const PRIMARY_OWNER_EMAIL = 'itxmeshadow1234@gmail.com';
const PRIMARY_OWNER_PASSWORD = require('./_env').PRIMARY_OWNER_PASSWORD;

const failures = [];
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
};

async function main() {
  // ---------- DB-level zero fake data ----------
  const users = db.prepare('SELECT id, username, email FROM users').all();
  check('no fake/demo/sample/example accounts', !users.some(u =>
    /fake|demo|sample|test/i.test(u.username) || u.email.endsWith('@example.com')),
    users.length + ' real user(s)');

  const members = db.prepare(`
    SELECT m.id, m.display_role, m.active, u.id AS user_id, u.username, u.email
    FROM official_team_members m JOIN users u ON u.id = m.user_id
  `).all();
  const orphaned = db.prepare(`
    SELECT COUNT(*) c FROM official_team_members m
    LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL
  `).get().c;
  check('every assignment references a real user', orphaned === 0);

  const primary = users.find(u => u.email === PRIMARY_OWNER_EMAIL);
  const primaryAssignment = members.find(m => m.user_id === primary.id && m.display_role === 'DEVELOPER');
  check('Primary Owner displayed as Developer', !!primaryAssignment && primaryAssignment.active === 1);

  const tempOwner = users.find(u => u.email === 'murtaza12@gmail.com');
  const ownerAssignment = tempOwner && members.find(m => m.user_id === tempOwner.id && m.display_role === 'OWNER');
  check('Temporary Owner displayed as Owner', !!ownerAssignment && ownerAssignment.active === 1);

  const rbacPrimary = db.prepare(`
    SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?
  `).all(primary.id).map(r => r.name);
  check('Primary Owner security role is still PRIMARY_OWNER', rbacPrimary.includes('PRIMARY_OWNER'), rbacPrimary.join(','));

  const rbacOwner = db.prepare(`
    SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?
  `).all(tempOwner.id).map(r => r.name);
  check('Temporary Owner security role is still OWNER', rbacOwner.includes('OWNER'), rbacOwner.join(','));

  // ---------- API-level ----------
  const pubRes = await fetch(BASE + '/official-team');
  const pub = await pubRes.json();
  check('public official-team endpoint responds 200', pubRes.status === 200);

  const flat = [];
  for (const p of pub.positions) for (const m of p.members) flat.push({ ...m, position: p.display_role });
  check('public payload contains no email addresses', flat.every(m => m.email === undefined));

  const dev = pub.positions.find(p => p.display_role === 'DEVELOPER');
  check('public Developer slot = primary_owner (PRIMARY_OWNER)', dev && !dev.available &&
    dev.members.some(m => m.username === 'primary_owner' && m.security_roles.includes('PRIMARY_OWNER')));

  const own = pub.positions.find(p => p.display_role === 'OWNER');
  check('public Owner slot = temp_owner (OWNER)', own && !own.available &&
    own.members.some(m => m.username === 'temp_owner' && m.security_roles.includes('OWNER')));

  const mod = pub.positions.find(p => p.display_role === 'MODERATOR');
  check('public Moderator slot = real moderator (MODERATOR)', mod && !mod.available &&
    mod.members.some(m => m.username === 'bakihanma123' && m.security_roles.includes('MODERATOR')));

  const unassigned = ['ADMIN', 'STAFF', 'SUPPORT', 'TOURNAMENT_MANAGER',
    'FINANCE_MANAGER', 'CONTENT_MANAGER', 'COMMUNITY_MANAGER', 'ANALYST', 'OTHERS'];
  const allAvailable = unassigned.every(k => {
    const p = pub.positions.find(x => x.display_role === k);
    return p && p.available === true && p.members.length === 0;
  });
  check('unassigned positions show Available', allAvailable);

  // ---------- owner-authenticated lifecycle ----------
  const signin = await fetch(BASE + '/auth/signin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PRIMARY_OWNER_EMAIL, password: PRIMARY_OWNER_PASSWORD })
  });
  check('Primary Owner can still sign in (PRIMARY_OWNER authority intact)', signin.status === 200);

  const cookie = (signin.headers.getSetCookie ? signin.headers.getSetCookie() : [signin.headers.get('set-cookie')])
    .map(c => c.split(';')[0]).join('; ');
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  // PRIMARY_OWNER-only functionality probe: assigning the OWNER security role is
  // reserved to the Primary Owner by the server.
  const poProbe = await fetch(BASE + '/owner/team/assign', {
    method: 'POST', headers: H, body: JSON.stringify({ user_id: '__nobody__', role: 'OWNER' })
  });
  check('PRIMARY_OWNER-only endpoint reachable (404 for unknown user, not 403)', poProbe.status === 404, 'HTTP ' + poProbe.status);

  const otRes = await fetch(BASE + '/owner/official-team', { headers: H });
  const ot = await otRes.json();
  check('owner official-team endpoint responds 200 with emails', otRes.status === 200 &&
    ot.positions.some(p => p.members.some(m => m.email)));

  // Deactivate → public page updates immediately → reactivate
  const target = ot.positions.find(p => p.display_role === 'OWNER').members[0];
  const deact = await fetch(BASE + '/owner/official-team/set-active', {
    method: 'POST', headers: H, body: JSON.stringify({ id: target.id, active: false })
  });
  const pubAfterDeact = await (await fetch(BASE + '/official-team')).json();
  const ownAfterDeact = pubAfterDeact.positions.find(p => p.display_role === 'OWNER');
  check('deactivated assignment disappears immediately', deact.status === 200 && ownAfterDeact.available === true);

  const rbacAfterDeact = db.prepare(`
    SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?
  `).all(tempOwner.id).map(r => r.name);
  check('deactivation did NOT change the RBAC role', rbacAfterDeact.includes('OWNER'), rbacAfterDeact.join(','));

  const react = await fetch(BASE + '/owner/official-team/set-active', {
    method: 'POST', headers: H, body: JSON.stringify({ id: target.id, active: true })
  });
  const pubAfterReact = await (await fetch(BASE + '/official-team')).json();
  const ownAfterReact = pubAfterReact.positions.find(p => p.display_role === 'OWNER');
  check('reactivated assignment returns', react.status === 200 && ownAfterReact.available === false);

  console.log('');
  if (failures.length) {
    console.log('OFFICIAL TEAM CHECK: FAIL (' + failures.length + ')');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('OFFICIAL TEAM CHECK: PASS — real assignments only, RBAC untouched, zero fake data.');
}

main().catch(err => { console.error('RUNNER ERROR:', err.message); process.exit(1); });
