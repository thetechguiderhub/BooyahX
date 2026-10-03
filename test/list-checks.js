/* One-off: find tables with broken FK references to teams_old */
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/booyahx.db');
const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
console.log('tables referencing teams_old:');
rows.filter(r => /teams_old/.test(r.sql || '')).forEach(r => console.log('  ' + r.name));
console.log('teams* tables:');
rows.filter(r => /^teams/.test(r.name)).forEach(r => console.log('  ' + r.name));
console.log('tables referencing transactions type check:');
console.log('  transactions sql has daily_reward: ' + /daily_reward/.test((rows.find(r => r.name === 'transactions') || {}).sql || ''));
