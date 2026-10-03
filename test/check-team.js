/* Diagnose current team role assignments + recent role audit. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
const rows = db.prepare(
  "SELECT u.username, u.status, ur.assigned_at FROM user_roles ur " +
  "JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id " +
  "WHERE r.name = 'MODERATOR'"
).all();
console.log('MODERATOR members:', JSON.stringify(rows));
const all = db.prepare(
  "SELECT r.name, COUNT(*) n FROM user_roles ur JOIN roles r ON r.id = ur.role_id GROUP BY r.name"
).all();
console.log('role counts:', JSON.stringify(all));
const a = db.prepare(
  "SELECT action, target_id, metadata, created_at FROM audit_logs " +
  "WHERE action LIKE '%role%' ORDER BY rowid DESC LIMIT 8"
).all();
for (const r of a) console.log(r.created_at, '|', r.action, '|', r.target_id, '|', r.metadata);
