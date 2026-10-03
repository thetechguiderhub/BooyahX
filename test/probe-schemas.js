/* Schema probe for cleanup planning. */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => t.name);
console.log('ALL TABLES (' + tables.length + '): ' + tables.join(', '));

const cols = t => {
  try { return db.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name).join(', '); }
  catch (e) { return 'ERR ' + e.message; }
};

for (const t of ['audit_logs', 'deposits', 'withdrawals', 'achievements', 'achievement_unlocks',
                 'categories', 'series', 'notifications', 'tournament_registrations',
                 'user_verifications', 'login_history', 'security_alerts']) {
  console.log(t + ': ' + cols(t));
}

// Where are settings stored?
console.log('settings-like tables: ' + tables.filter(t => /setting|config|pref/i.test(t)).join(', '));
try {
  console.log('platform_settings: ' + JSON.stringify(db.prepare("SELECT key, value FROM platform_settings WHERE key LIKE 'maintenance%'").all()));
} catch (e) { console.log('platform_settings ERR: ' + e.message); }

// Seed vs smoke content
try { console.log('achievements rows: ' + JSON.stringify(db.prepare('SELECT id, key, name FROM achievements').all())); } catch (e) { console.log('achievements ERR ' + e.message); }
try { console.log('series rows: ' + JSON.stringify(db.prepare('SELECT id, name, created_by FROM series').all())); } catch (e) { console.log('series ERR ' + e.message); }
try { console.log('categories rows: ' + JSON.stringify(db.prepare('SELECT id, name FROM categories LIMIT 10').all())); } catch (e) { console.log('categories ERR ' + e.message); }
try { console.log('coin_packages rows: ' + JSON.stringify(db.prepare('SELECT id, name FROM coin_packages').all())); } catch (e) { console.log('coin_packages ERR ' + e.message); }
