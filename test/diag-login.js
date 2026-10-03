/* Diagnostic: do current .env passwords match the bcrypt hashes in the DB?
   Read-only. Prints match booleans + hash algorithm prefix only (never secrets). */
require('./_env');
const path = require('path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const checks = [
  ['OWN-001', process.env.PRIMARY_OWNER_PASSWORD],
  ['OWN-002', process.env.TEMPORARY_OWNER_PASSWORD],
  ['USR-MOD001', process.env.MODERATOR_PASSWORD]
];

let mismatch = 0;
for (const [id, pw] of checks) {
  const row = db.prepare('SELECT id, email, role, password_hash FROM users WHERE id = ?').get(id);
  if (!row) { console.log(`${id}: USER MISSING`); mismatch++; continue; }
  if (!pw) { console.log(`${id}: PASSWORD NOT SET VIA ENV`); mismatch++; continue; }
  const ok = bcrypt.compareSync(pw, row.password_hash);
  if (!ok) mismatch++;
  console.log(`${id} (${row.role}): env-password-matches-db-hash=${ok} | hash=${row.password_hash.slice(0, 7)}...`);
}
console.log(mismatch === 0 ? 'DIAG: ALL ACCOUNTS MATCH ENV' : `DIAG: ${mismatch} ACCOUNT(S) OUT OF SYNC (restart rotates hashes from .env at startup)`);
process.exit(mismatch ? 1 : 0);
