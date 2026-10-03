'use strict';
/* BooyahX — BX COINS: update USER-FACING label text in existing DB rows.
 * - email_templates bodies ({{amount}} coins -> {{amount}} BX Coins)
 * - permissions descriptions (coins -> BX Coins wording)
 * Touches NO financial rows: no wallets, transactions, deposits, withdrawals,
 * promo balances, coin_packages, event prices. Idempotent.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const candidates = [
  path.join(root, 'data', 'booyah.db'),
  path.join(root, 'data', 'app.db'),
  path.join(root, 'data', 'booyahx.db'),
  path.join(root, 'data.db'),
];
const dbPath = candidates.find(p => fs.existsSync(p));
if (!dbPath) {
  console.error('DB not found. Looked at:\n' + candidates.join('\n'));
  process.exit(2);
}
console.log('DB: ' + dbPath);

const db = new DatabaseSync(dbPath);
let total = 0;

function run(label, sql, ...params) {
  const info = db.prepare(sql).run(...params);
  const n = Number(info.changes || 0);
  total += n;
  console.log(`[v] ${label} :: ${n} row(s)`);
}

// 1) Email templates (user-facing notification bodies)
run('email_templates deposit/withdrawal body unit',
  `UPDATE email_templates
   SET body = REPLACE(REPLACE(body, '{{amount}} coins', '{{amount}} BX Coins'), 'coins is', 'BX Coins is')
   WHERE body LIKE '%{{amount}} coins%'`,
);

// 2) Permission descriptions (shown in roles/permission UI)
run('permissions moderator.coins.adjust description',
  `UPDATE permissions
   SET description = REPLACE(description, 'Add/remove coins', 'Add/remove BX Coins')
   WHERE key = 'moderator.coins.adjust' AND description LIKE '%Add/remove coins%'`,
);

db.close();

// Verify
const db2 = new DatabaseSync(dbPath);
const tpl = db2.prepare(`SELECT id, body FROM email_templates WHERE body LIKE '%coins%'`).all();
const perm = db2.prepare(`SELECT key, description FROM permissions WHERE key LIKE 'moderator.coins%'`).all();
db2.close();

console.log('\n--- verify ---');
tpl.forEach(t => console.log(`  template ${t.id}: ${JSON.stringify(t.body)}`));
perm.forEach(p => console.log(`  perm ${p.key}: ${p.description}`));
const leftover = tpl.filter(t => /\{\{amount\}\} coins/.test(t.body));
console.log(`\nTOTAL updates: ${total}, leftover old units: ${leftover.length}`);
process.exitCode = leftover.length ? 1 : 0;
