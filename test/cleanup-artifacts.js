/* ============================================
   BOOYAHX — SMOKE-ARTIFACT CLEANUP
   ----------------------------------------
   Removes every row the automated smoke/RBAC tests created so the
   site shows honest empty states (EMPTY IS BETTER THAN FAKE).

   Keeps: the two real owner accounts, platform seed data
   (roles, permissions, email templates, coin packages, achievement
   definitions, settings defaults, admin login history/audit).

   Removes: smoke and rbac test users and everything referencing them,
   "Smoke CS Cup" tournaments (+ registrations/results/matches),
   Smoke/Draft news, Smoke banners, smoke API keys, Smoke polls
   (+ options/votes), all notifications (only smoke ever sent any),
   and audit rows referencing the removed entities.
   ============================================ */

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const deleted = {};
const mark = (label, info) => {
  const n = typeof info === 'number' ? info : (info.changes | 0);
  if (n > 0) deleted[label] = (deleted[label] || 0) + n;
};

db.exec('PRAGMA foreign_keys = OFF');

// ---------- collect smoke entity ids ----------
const smokeUsers = db.prepare(
  "SELECT id, username FROM users WHERE username LIKE 'smoke%' OR username LIKE 'rbac_%'"
).all();
const smokeIds = new Set(smokeUsers.map(u => u.id));

const smokeTournaments = db.prepare(
  "SELECT id FROM tournaments WHERE (name LIKE 'Smoke%' OR name LIKE 'MOD Test%' OR name LIKE 'MOD Bad%')"
).all().map(t => t.id);
const smokeTourIds = new Set(smokeTournaments);

const idList = [...smokeIds];
const tourList = [...smokeTourIds];

const idsOf = (table, where, params = []) => {
  try { return db.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...params).map(r => r.id); }
  catch (e) { return []; }
};

const smokeDeposits = idsOf('deposits', 'user_id IN (SELECT id FROM users WHERE username LIKE \'smoke%\' OR username LIKE \'rbac_%\')');
const smokeWithdrawals = idsOf('withdrawals', 'user_id IN (SELECT id FROM users WHERE username LIKE \'smoke%\' OR username LIKE \'rbac_%\')');
const smokeTransactions = idsOf('transactions', 'user_id IN (SELECT id FROM users WHERE username LIKE \'smoke%\' OR username LIKE \'rbac_%\')');
const smokeResults = idsOf('tournament_results', 'tournament_id IN (SELECT id FROM tournaments WHERE name LIKE \'Smoke%\')');
const smokeNews = db.prepare("SELECT id FROM news WHERE title LIKE 'Smoke%' OR title LIKE 'Draft News%'").all().map(r => r.id);
const smokeBanners = db.prepare("SELECT id FROM banners WHERE title LIKE 'Smoke%'").all().map(r => r.id);
const smokeKeys = db.prepare("SELECT id FROM api_keys WHERE name LIKE 'smoke%'").all().map(r => r.id);
const smokePolls = db.prepare("SELECT id FROM polls WHERE question LIKE 'Smoke%'").all().map(r => r.id);
const smokeBackups = (() => {
  try { return db.prepare("SELECT id FROM backups").all().map(r => r.id); } catch (e) { return []; }
})();

const auditTargets = [
  ...idList, ...tourList,
  ...smokeDeposits, ...smokeWithdrawals, ...smokeTransactions, ...smokeResults,
  ...smokeNews, ...smokeBanners, ...smokeKeys, ...smokePolls, ...smokeBackups
];

console.log('collected:', JSON.stringify({
  users: smokeUsers.length, tournaments: smokeTournaments.length,
  deposits: smokeDeposits.length, withdrawals: smokeWithdrawals.length,
  transactions: smokeTransactions.length, results: smokeResults.length,
  news: smokeNews.length, banners: smokeBanners.length, apiKeys: smokeKeys.length,
  polls: smokePolls.length, backups: smokeBackups.length
}));

// ---------- 1. audit rows referencing smoke entities ----------
try {
  const conditions = ['metadata LIKE \'%smoke%\'', 'metadata LIKE \'%rbac%\'', 'metadata LIKE \'%Smoke%\'',
                      "action = 'notifications_broadcast'"];
  for (const t of auditTargets) conditions.push('target_id = ?');
  for (const sid of idList) conditions.push('actor_id = ?');
  const stmt = db.prepare(`DELETE FROM audit_logs WHERE ${conditions.join(' OR ')}`);
  mark('audit_logs', stmt.run(...auditTargets, ...idList));
} catch (e) { console.log('audit cleanup ERR:', e.message); }

// ---------- 2. every table: rows referencing a smoke user id ----------
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('users','sqlite_sequence')"
).all().map(t => t.name);

for (const table of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const refCols = cols.filter(c => /(_id|_by|_to)$/.test(c) && c !== 'id');
    const conditions = [];
    const params = [];
    for (const c of refCols) for (const sid of idList) { conditions.push(`${c} = ?`); params.push(sid); }
    if (!conditions.length) continue;
    mark(table, db.prepare(`DELETE FROM ${table} WHERE ${conditions.join(' OR ')}`).run(...params));
  } catch (e) { console.log(`user-ref cleanup ${table} ERR:`, e.message); }
}

// ---------- 3. rows referencing a smoke tournament id ----------
for (const table of tables) {
  if (table === 'tournaments') continue;
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes('tournament_id')) continue;
    if (!tourList.length) continue;
    const cond = tourList.map(() => 'tournament_id = ?').join(' OR ');
    mark(table, db.prepare(`DELETE FROM ${table} WHERE ${cond}`).run(...tourList));
  } catch (e) { console.log(`tournament-ref cleanup ${table} ERR:`, e.message); }
}

// ---------- 4. rows referencing a smoke poll id ----------
try {
  const pollIds = db.prepare("SELECT id FROM polls").all().map(r => r.id);
  const smokePollSet = new Set(smokePolls);
  for (const table of ['poll_options', 'poll_votes']) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes('poll_id')) continue;
      const cond = pollIds.filter(p => smokePollSet.has(p)).map(() => 'poll_id = ?').join(' OR ');
      const ids = pollIds.filter(p => smokePollSet.has(p));
      if (ids.length) mark(table, db.prepare(`DELETE FROM ${table} WHERE ${cond}`).run(...ids));
    } catch (e) { console.log(`poll cleanup ${table} ERR:`, e.message); }
  }
} catch (e) { console.log('poll cleanup ERR:', e.message); }

// ---------- 5. named smoke content ----------
const delBy = (label, sql, ...params) => {
  try { mark(label, db.prepare(sql).run(...params)); }
  catch (e) { console.log(`${label} ERR:`, e.message); }
};

delBy('tournaments', "DELETE FROM tournaments WHERE (name LIKE 'Smoke%' OR name LIKE 'MOD Test%' OR name LIKE 'MOD Bad%')");delBy('news', "DELETE FROM news WHERE title LIKE 'Smoke%' OR title LIKE 'Draft News%' OR title LIKE 'Sync Probe%'");
delBy('banners', "DELETE FROM banners WHERE title LIKE 'Smoke%' OR title LIKE 'Sync Probe%' OR title LIKE 'Dbg%'");
delBy('popups', "DELETE FROM popups WHERE title LIKE 'Smoke%' OR title LIKE 'Sync Probe%'");
delBy('sponsors', "DELETE FROM sponsors WHERE (name LIKE 'Smoke%' OR name LIKE 'MOD Test%' OR name LIKE 'MOD Bad%') OR name LIKE 'Sync Probe%'");
delBy('highlights', "DELETE FROM highlights WHERE title LIKE 'Smoke%' OR title LIKE 'Sync Probe%'");
delBy('events', "DELETE FROM events WHERE title LIKE 'Smoke%' OR title LIKE 'Sync Probe%' OR title LIKE 'No Times%'");
delBy('updates', "DELETE FROM updates WHERE title LIKE 'Smoke%' OR title LIKE 'Sync Probe%'");
delBy('api_keys', "DELETE FROM api_keys WHERE name LIKE 'smoke%'");
delBy('polls', "DELETE FROM polls WHERE question LIKE 'Smoke%'");
delBy('backups', "DELETE FROM backups");

// ---------- 6. notifications (only smoke ever sent any) ----------
delBy('notifications', 'DELETE FROM notifications');

// ---------- 7. the smoke/rbac accounts themselves ----------
delBy('users', "DELETE FROM users WHERE username LIKE 'smoke%' OR username LIKE 'rbac_%'");

// ---------- 7b. audit rows for deleted accounts + smoke maintenance toggles ----------
delBy('audit_logs(orphaned)', "DELETE FROM audit_logs WHERE target_type = 'user' AND target_id NOT IN (SELECT id FROM users)");
delBy('audit_logs(maintenance)', "DELETE FROM audit_logs WHERE action IN ('maintenance_enabled', 'maintenance_disabled')");

// ---------- 8. remaining orphans from removed content ----------
for (const table of tables) {
  if (table === 'users') continue;
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const refCols = cols.filter(c => /(_id|_by|_to)$/.test(c) && c !== 'id');
    const conditions = [];
    const params = [];
    for (const c of refCols) for (const sid of idList) { conditions.push(`${c} = ?`); params.push(sid); }
    if (!conditions.length) continue;
    mark(table + ' (pass2)', db.prepare(`DELETE FROM ${table} WHERE ${conditions.join(' OR ')}`).run(...params));
  } catch (e) { /* ignore */ }
}

db.exec('PRAGMA foreign_keys = ON');
try { db.exec('VACUUM'); } catch (e) { console.log('VACUUM skipped:', e.message); }

// ---------- report ----------
console.log('\nDELETED ROWS:');
for (const [k, v] of Object.entries(deleted)) console.log('  ' + k.padEnd(30), v);
if (!Object.keys(deleted).length) console.log('  (nothing)');

const count = sql => { try { return db.prepare(sql).get().c; } catch (e) { return 'ERR'; } };
console.log('\nREMAINING:');
console.log('  users:', JSON.stringify(db.prepare('SELECT username FROM users').all().map(u => u.username)));
console.log('  tournaments:', count('SELECT COUNT(*) c FROM tournaments'));
console.log('  tournament_results:', count('SELECT COUNT(*) c FROM tournament_results'));
console.log('  transactions:', count('SELECT COUNT(*) c FROM transactions'));
console.log('  deposits:', count('SELECT COUNT(*) c FROM deposits'));
console.log('  withdrawals:', count('SELECT COUNT(*) c FROM withdrawals'));
console.log('  notifications:', count('SELECT COUNT(*) c FROM notifications'));
console.log('  news:', count('SELECT COUNT(*) c FROM news'));
console.log('  banners:', count('SELECT COUNT(*) c FROM banners'));
console.log('  polls:', count('SELECT COUNT(*) c FROM polls'));
console.log('  api_keys:', count('SELECT COUNT(*) c FROM api_keys'));
console.log('  audit_logs:', count('SELECT COUNT(*) c FROM audit_logs'));
console.log('  achievements:', count('SELECT COUNT(*) c FROM achievements'));
console.log('  coin_packages:', count('SELECT COUNT(*) c FROM coin_packages'));
console.log('  email_templates:', count('SELECT COUNT(*) c FROM email_templates'));
