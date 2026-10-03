/* Column probe for public content pages (events/news/updates). */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
for (const t of ['events', 'news', 'updates', 'banners', 'sponsors', 'highlights', 'popups']) {
  try {
    console.log(t + ': ' + db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).join(', '));
  } catch (e) { console.log(t + ': ERR ' + e.message); }
}
