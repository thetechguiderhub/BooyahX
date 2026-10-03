/* Quick DB recency/status probe for final report. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

console.log('--- last 8 audit actions:');
for (const r of db.prepare('SELECT action, actor_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 8').all()) {
  console.log('  ', r.created_at, r.action, r.actor_id || '-');
}
const recent = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE created_at > datetime('now','-3 minutes')").get().n;
console.log('audit rows in last 3 min:', recent);

console.log('--- users:');
for (const u of db.prepare('SELECT id, username, role FROM users ORDER BY id').all()) console.log('  ', u.id, u.username, u.role);

console.log('--- smoke probe users:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 'smoke%' OR username LIKE 'rbac_%'").get().n);
console.log('--- official team members:');
try {
  for (const m of db.prepare('SELECT user_id, display_role, active FROM official_team_members ORDER BY display_order').all()) {
    console.log('  ', JSON.stringify(m));
  }
} catch (e) { console.log('  error:', e.message); }
