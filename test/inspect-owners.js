/* Inspect owner accounts + official team state for migration planning. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

console.log('--- users (id, email, username, role, status):');
for (const u of db.prepare('SELECT id, email, username, role, status FROM users').all()) {
  console.log('  ', JSON.stringify(u));
}
console.log('--- user_roles:');
for (const r of db.prepare('SELECT ur.user_id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id').all()) {
  console.log('  ', JSON.stringify(r));
}
try {
  console.log('--- official_team_positions:');
  for (const p of db.prepare('SELECT id, display_role, title, display_order FROM official_team_positions ORDER BY display_order').all()) console.log('  ', JSON.stringify(p));
  console.log('--- official_team_members:');
  for (const m of db.prepare('SELECT m.id, m.user_id, u.email, m.display_role, m.active FROM official_team_members m LEFT JOIN users u ON u.id = m.user_id').all()) console.log('  ', JSON.stringify(m));
} catch (e) { console.log('official team tables error:', e.message); }
console.log('--- wallets for owners:');
for (const w of db.prepare("SELECT user_id, balance FROM wallets WHERE user_id IN ('OWN-001','OWN-002')").all()) console.log('  ', JSON.stringify(w));
