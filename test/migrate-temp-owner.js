/* ============================================
   BOOYAHX — TEMPORARY OWNER EMAIL MIGRATION
   ------------------------------------------
   Section 7 (email migration safety):
   1. Find existing account by OLD email
   2. Confirm it has the expected OWNER role
   3. Update THAT account's email to NEW (same row, same id)
   4. Preserve id / password hash / role / status / audit / wallet / relations
   5. Verify no duplicate email
   6-8. (login + permissions + protection verified by
        test/temp-owner-security.js against the running server)
   If the old account does not exist: prints
   TEMPORARY OWNER ACCOUNT NOT FOUND and exits WITHOUT creating anything.
   ============================================ */

const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const OLD_EMAIL = 'corrupt.12afree@gmail.com';
const NEW_EMAIL = 'murtaza12@gmail.com';

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const fail = msg => { console.error('MIGRATION FAILED:', msg); process.exit(1); };
const pass = msg => console.log('  PASS ', msg);

function snapshot(u) {
  const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(u.id);
  const roles = db.prepare(
    'SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?'
  ).all(u.id).map(r => r.name).sort();
  const audit = db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE actor_id = ?').get(u.id).n;
  const deposits = db.prepare('SELECT COUNT(*) n FROM deposits WHERE user_id = ?').get(u.id).n;
  const withdrawals = db.prepare('SELECT COUNT(*) n FROM withdrawals WHERE user_id = ?').get(u.id).n;
  const results = db.prepare('SELECT COUNT(*) n FROM tournament_results WHERE user_id = ?').get(u.id).n;
  return {
    id: u.id, password_hash: u.password_hash, role: u.role, status: u.status,
    username: u.username, balance: wallet ? wallet.balance : null,
    roles, audit, deposits, withdrawals, results
  };
}

console.log('=== TEMPORARY OWNER EMAIL MIGRATION ===');

const byOld = db.prepare('SELECT * FROM users WHERE email = ?').get(OLD_EMAIL);
let target = byOld;

if (!target) {
  // Idempotent re-run: is the migration already done?
  const byNew = db.prepare('SELECT * FROM users WHERE email = ?').get(NEW_EMAIL);
  if (byNew && byNew.id === 'OWN-002') {
    console.log('  NOTE  already migrated — email is', NEW_EMAIL, '(id OWN-002)');
    target = byNew;
  } else if (byNew) {
    fail(`new email already used by a DIFFERENT account (${byNew.id})`);
  } else {
    console.log('TEMPORARY OWNER ACCOUNT NOT FOUND');
    process.exit(2);
  }
} else {
  pass(`found existing account by OLD email: ${target.id}`);
}

// 2. expected role
const roleRows = db.prepare(
  "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'OWNER'"
).all(target.id);
if (target.role !== 'OWNER' || roleRows.length !== 1) {
  fail(`expected OWNER role — users.role=${target.role}, user_roles OWNER rows=${roleRows.length}`);
}
pass('expected OWNER role confirmed (users.role + user_roles)');

const before = snapshot(target);

// 3. duplicate check on NEW email
const clash = db.prepare('SELECT id FROM users WHERE email = ?').get(NEW_EMAIL);
if (clash && clash.id !== target.id) fail(`new email already used by ${clash.id} — refusing to create a duplicate`);

// 4. update the SAME row
if (target.email !== NEW_EMAIL) {
  db.prepare("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?").run(NEW_EMAIL, target.id);
  pass(`email updated: ${OLD_EMAIL} -> ${NEW_EMAIL} (row id unchanged: ${target.id})`);
} else {
  pass('email already set to ' + NEW_EMAIL);
}

// 5. verify preservation + uniqueness
const after = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
const afterSnap = snapshot(after);
const preserveChecks = [
  ['user id', before.id, afterSnap.id],
  ['password hash', before.password_hash, afterSnap.password_hash],
  ['role', before.role, afterSnap.role],
  ['status', before.status, afterSnap.status],
  ['username', before.username, afterSnap.username],
  ['wallet balance', before.balance, afterSnap.balance],
  ['roles', JSON.stringify(before.roles), JSON.stringify(afterSnap.roles)],
  ['audit rows (actor)', before.audit, afterSnap.audit],
  ['deposits', before.deposits, afterSnap.deposits],
  ['withdrawals', before.withdrawals, afterSnap.withdrawals],
  ['tournament results', before.results, afterSnap.results]
];
for (const [label, b, a] of preserveChecks) {
  if (b !== a) fail(`preserved field changed: ${label} (${b} -> ${a})`);
  pass(`preserved: ${label}`);
}
if (after.email !== NEW_EMAIL) fail('email not updated');

const dupes = db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(NEW_EMAIL).n;
if (dupes !== 1) fail(`duplicate emails for ${NEW_EMAIL}: ${dupes}`);
pass('no duplicate email (exactly 1 row)');

const owners = db.prepare("SELECT COUNT(*) n FROM users WHERE role IN ('OWNER','PRIMARY_OWNER')").get().n;
pass(`owner accounts total: ${owners} (expected 2 — primary + temporary, no second OWNER created)`);
if (owners !== 2) fail('unexpected owner account count');

// official team mapping row (same user id)
try {
  const ot = db.prepare(
    'SELECT m.id FROM official_team_members m WHERE m.user_id = ? AND m.display_role = ?'
  ).get(target.id, 'OWNER');
  if (ot) pass('official team OWNER slot already points at this account');
  else console.log('  NOTE  official team OWNER slot will be assigned by seed on next startup');
} catch (_) { console.log('  NOTE  official team tables not ready — seed will handle on startup'); }

console.log('=== MIGRATION COMPLETE ===');
