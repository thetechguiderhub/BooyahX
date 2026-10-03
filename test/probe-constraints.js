/* Print CREATE SQL for content tables (constraints) + what owner pages send. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
for (const t of ['banners', 'popups', 'sponsors', 'highlights', 'events', 'news', 'updates', 'polls']) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t);
  console.log('=== ' + t + ' ===');
  const sql = row ? row.sql : 'MISSING';
  // only print status/start-related lines
  console.log(sql.split('\n').filter(l => /status|start_time|start_at|CHECK|NOT NULL|media_url|image/i.test(l)).join('\n'));
}
