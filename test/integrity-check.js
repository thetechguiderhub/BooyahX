/* Post-cleanup integrity check: remaining audit rows + orphan scan. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

console.log('audit actions remaining:');
for (const r of db.prepare('SELECT action, COUNT(*) c FROM audit_logs GROUP BY action ORDER BY c DESC').all()) {
  console.log('  ' + r.action.padEnd(28), r.c);
}
console.log('\nsample audit metadata:');
for (const r of db.prepare('SELECT action, target_type, target_id, metadata FROM audit_logs ORDER BY rowid DESC LIMIT 6').all()) {
  console.log('  ', JSON.stringify(r));
}

// Orphan scan: any row still pointing at a nonexistent user
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
let orphans = 0;
for (const t of tables) {
  if (t === 'users') continue;
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    for (const c of cols) {
      if (!/_id$/.test(c) || c === 'id') continue;
      if (!cols.includes(c)) continue;
      const n = db.prepare(
        `SELECT COUNT(*) c FROM ${t} x WHERE x.${c} IS NOT NULL AND x.${c} LIKE 'USR-%' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.${c})`
      ).get().c;
      if (n > 0) { console.log(`ORPHAN: ${t}.${c} -> ${n} rows`); orphans += n; }
    }
  } catch (e) { /* table without that column */ }
}
console.log(orphans === 0 ? '\nno orphaned user references' : `\n${orphans} orphaned references`);

// Tournament refs
for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    if (!cols.includes('tournament_id')) continue;
    const n = db.prepare(
      `SELECT COUNT(*) c FROM ${t} x WHERE x.tournament_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tournaments w WHERE w.id = x.tournament_id)`
    ).get().c;
    if (n > 0) console.log(`ORPHAN: ${t}.tournament_id -> ${n} rows`);
  } catch (e) { /* ignore */ }
}
console.log('done');
