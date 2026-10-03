/* ============================================
   BOOYAHX — OFFICIAL TEAM MODERATOR ACCOUNT
   ------------------------------------------
   Creates/ensures the REAL account for the Official Team Moderator slot:
     bakihanma123@gmail.com -> RBAC role MODERATOR + team display MODERATOR
   - Password: MODERATOR_PASSWORD from env (.env, gitignored).
     If missing, a strong random value is generated and appended to .env
     SILENTLY (never printed to console, never stored in plaintext in DB —
     only a bcrypt hash goes into the database).
   - Never creates duplicates; idempotent.
   ============================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const EMAIL = process.env.MODERATOR_EMAIL || 'bakihanma123@gmail.com';
const ENV_PATH = path.join(__dirname, '..', '.env');
const pass = m => console.log('  PASS ', m);

// --- ensure MODERATOR_PASSWORD exists in .env (value never printed) ---
let envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
let pw = (envText.match(/^MODERATOR_PASSWORD=(.*)$/m) || [])[1];
let generated = false;
if (!pw) {
  pw = crypto.randomBytes(18).toString('base64url');
  envText = envText.replace(/\s*$/, '') + `\nMODERATOR_PASSWORD=${pw}\n`;
  fs.writeFileSync(ENV_PATH, envText, { mode: 0o600 });
  generated = true;
}

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

let user = db.prepare('SELECT * FROM users WHERE email = ?').get(EMAIL);
const MOD_ID = 'USR-MOD001';

if (user && user.email !== EMAIL) { console.error('UNEXPECTED'); process.exit(1); }

if (!user) {
  const local = EMAIL.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase() || 'moderator';
  let username = local;
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) username = local + '_' + crypto.randomBytes(2).toString('hex');
  const hash = bcrypt.hashSync(pw, 12);
  db.prepare(
    "INSERT INTO users (id, name, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, 'MODERATOR', 'active')"
  ).run(MOD_ID, local, username, EMAIL, hash);
  pass(`real account created: ${MOD_ID} (${EMAIL}) — role MODERATOR, status active`);
} else {
  if (user.role !== 'MODERATOR') {
    db.prepare("UPDATE users SET role = 'MODERATOR', updated_at = datetime('now') WHERE id = ?").run(user.id);
    pass('existing account role set to MODERATOR');
  } else pass('account already exists with role MODERATOR');
}

const id = user ? user.id : MOD_ID;

// rotate hash if env password differs from stored (env is the source of truth)
const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
if (!bcrypt.compareSync(pw, row.password_hash)) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(bcrypt.hashSync(pw, 12), id);
  pass('password hash rotated to value from env');
} else pass('password hash matches env value (bcrypt)');

// wallet + profile + RBAC role row
db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)').run(id);
db.prepare('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)').run(id);
db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, 'role_moderator', NULL)").run(id);
pass('wallet + profile + RBAC role row ensured');

// official team slot (idempotent)
try {
  const pos = db.prepare("SELECT display_role FROM official_team_positions WHERE display_role = 'MODERATOR'").get();
  const member = db.prepare('SELECT id FROM official_team_members WHERE user_id = ? AND display_role = ?').get(id, 'MODERATOR');
  if (!member) {
    const order = db.prepare("SELECT display_order FROM official_team_positions WHERE display_role = 'MODERATOR'").get();
    if (pos && order) {
      db.prepare('INSERT INTO official_team_members (id, user_id, display_role, display_order, active) VALUES (?, ?, ?, ?, 1)')
        .run('OTM-' + crypto.randomBytes(4).toString('hex').toUpperCase(), id, 'MODERATOR', order.display_order);
      pass('official team MODERATOR slot assigned to this account');
    } else pass('official team MODERATOR position missing — seed will create it on next startup');
  } else pass('official team MODERATOR slot already assigned');
} catch (e) { pass('official team tables pending (seed will assign on startup): ' + e.message); }

const dupes = db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(EMAIL).n;
if (dupes !== 1) { console.error('DUPLICATE ACCOUNTS:', dupes); process.exit(1); }
pass('no duplicate account (exactly 1 row)');

console.log('MODERATOR ACCOUNT: READY');
console.log('MODERATOR PASSWORD CONFIGURED VIA ENV: YES' + (generated ? ' (random value generated into .env just now — value not displayed)' : ''));
