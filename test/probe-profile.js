const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
console.log('user_profiles:', db.prepare('PRAGMA table_info(user_profiles)').all().map(c => c.name).join(', '));
console.log('locale setting value:', JSON.stringify(db.prepare("SELECT value FROM platform_settings WHERE key = 'locale'").get()));
