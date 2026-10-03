/* Dump every non-public (draft/inactive) content row to find leftovers. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
const tables = ['events', 'news', 'updates', 'banners', 'popups', 'sponsors', 'highlights', 'polls'];
for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM ${t}`).all();
  const hidden = rows.filter(r => !['published', 'active'].includes(r.status));
  const shown = rows.filter(r => ['published', 'active'].includes(r.status));
  if (rows.length) {
    console.log(`=== ${t}: ${rows.length} total | ${shown.length} public | ${hidden.length} hidden ===`);
    for (const r of hidden) console.log(`  HIDDEN [${r.status}] ${r.id} :: ${r.title || r.name || r.question || ''}`);
    for (const r of shown) console.log(`  PUBLIC [${r.status}] ${r.id} :: ${r.title || r.name || r.question || ''}`);
  }
}
console.log('done');
