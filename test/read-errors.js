/* Read the500 errors captured by the server during sync-check. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
try {
  const rows = db.prepare('SELECT id, endpoint, method, type, status, message, created_at FROM error_logs ORDER BY rowid DESC LIMIT 10').all();
  for (const r of rows) {
    console.log('---');
    console.log(r.created_at, r.method, r.endpoint, r.status, r.type);
    console.log('MSG:', r.message);
  }
  if (!rows.length) console.log('error_logs empty');
} catch (e) {
  // maybe different columns — print schema
  console.log('schema:', db.prepare('PRAGMA table_info(error_logs)').all().map(c => c.name).join(', '));
  console.log('ERR', e.message);
}
