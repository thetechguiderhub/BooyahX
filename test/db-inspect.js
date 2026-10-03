/* ============================================
   BOOYAHX — PRODUCTION DB PREPARATION (§4)
   ----------------------------------------
   Code-level only (no server started). Safe sequence:
   1. Copy db + wal + shm to data/backups/pre-railway-<stamp>/
   2. Open the ORIGINAL (recovers/checkpoints WAL), run
      integrity_check + schema/table inventory + verify the real
      users/RBAC/config rows (NEVER selects password hashes)
   3. Create a verified seed copy at seed/booyahx.db
      (gitignored; uploaded once to the Railway volume on first boot)
   Exits non-zero on any integrity failure.
   ============================================ */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DB_PATH = path.join(root, 'data', 'booyahx.db');
const BACKUP_DIR = path.join(root, 'data', 'backups', 'pre-railway-' + new Date().toISOString().replace(/[:.]/g, '-'));
const SEED_PATH = path.join(root, 'seed', 'booyahx.db');

function fail(msg) { console.error('[DB-PREP] FAIL: ' + msg); process.exit(1); }

if (!fs.existsSync(DB_PATH)) fail('data/booyahx.db not found');

// ---- 1. full-trio backup (db + wal + shm move together) ----
fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const src = DB_PATH + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BACKUP_DIR, 'booyahx.db' + suffix));
}
const backupFiles = fs.readdirSync(BACKUP_DIR);
console.log('[DB-PREP] backup written: ' + path.relative(root, BACKUP_DIR) + ' (' + backupFiles.join(', ') + ')');

// ---- 2. inspect + integrity on the original ----
const db = new DatabaseSync(DB_PATH);
const summary = {};
try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  summary.integrity_check = integrity.integrity_check;
  if (integrity.integrity_check !== 'ok') fail('integrity_check: ' + integrity.integrity_check);

  summary.tables = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
  summary.tables_list = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);

  // RBAC core tables must exist
  for (const t of ['users', 'roles', 'permissions', 'role_permissions', 'coin_packages',
                   'user_sessions', 'backups', 'audit_logs', 'achievements', 'email_templates']) {
    if (!summary.tables_list.includes(t)) fail('missing table: ' + t);
  }

  // Real users: id + role only (never password/hash columns)
  summary.users = db.prepare('SELECT id, username, role FROM users ORDER BY id').all();
  summary.user_count = summary.users.length;

  const need = ['OWN-001', 'OWN-002', 'USR-MOD001'];
  const have = new Set(summary.users.map(u => u.id));
  for (const id of need) if (!have.has(id)) fail('required real user missing: ' + id);

  summary.roles = db.prepare('SELECT id FROM roles ORDER BY id').all().map(r => r.id);
  summary.role_count = db.prepare('SELECT COUNT(*) c FROM roles').get().c;
  summary.permission_count = db.prepare('SELECT COUNT(*) c FROM permissions').get().c;
  summary.role_permission_count = db.prepare('SELECT COUNT(*) c FROM role_permissions').get().c;
  summary.coin_packages = db.prepare('SELECT id, coins, price_pkr FROM coin_packages ORDER BY coins').all();
  summary.achievement_count = db.prepare('SELECT COUNT(*) c FROM achievements').get().c;
  summary.email_template_count = db.prepare('SELECT COUNT(*) c FROM email_templates').get().c;

  // zero-fake-data counters (expected0/real only)
  summary.counts = {
    tournaments: db.prepare('SELECT COUNT(*) c FROM tournaments').get().c,
    transactions: db.prepare('SELECT COUNT(*) c FROM transactions').get().c,
    event_items: db.prepare('SELECT COUNT(*) c FROM event_items').get().c,
    events: db.prepare('SELECT COUNT(*) c FROM events').get().c,
    audit_logs: db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c
  };
} catch (err) {
  fail(err.message);
} finally {
  try { db.close(); } catch (_) {}
}

// ---- 3. seed copy (post-checkpoint, standalone-verified) ----
fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true });
fs.copyFileSync(DB_PATH, SEED_PATH);
const seed = new DatabaseSync(SEED_PATH);
try {
  const i = seed.prepare('PRAGMA integrity_check').get();
  if (i.integrity_check !== 'ok') fail('seed integrity: ' + i.integrity_check);
  const u = seed.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (u !== summary.user_count) fail(`seed user mismatch ${u} != ${summary.user_count}`);
} finally {
  try { seed.close(); } catch (_) {}
}
summary.backup_dir = path.relative(root, BACKUP_DIR);
summary.seed = { path: 'seed/booyahx.db', size: fs.statSync(SEED_PATH).size };

console.log('[DB-PREP] tables (' + summary.tables + '): ' + summary.tables_list.join(', '));
delete summary.tables_list; // printed above; keep the JSON summary short
console.log('[DB-PREP] RESULT ' + JSON.stringify(summary, null, 2));
process.exit(0);
