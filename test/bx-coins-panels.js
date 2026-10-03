'use strict';
/* BooyahX — BX COINS rebrand for the Moderator console + Money Board pages
 * (owner/money.html, moderator/moderator.html). User-facing labels only;
 * internal IDs (coins-search, panel-coins, ca-*, mv-*) stay unchanged.
 * Idempotent: re-running reports ALREADY instead of double-applying.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const results = [];

function applyLiteral(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  const orig = s;
  for (const [from, to] of pairs) {
    if (s.includes(to)) { results.push([rel, from.slice(0, 54), 'ALREADY']); continue; }
    const hits = s.split(from).length - 1;
    if (hits > 0) { s = s.split(from).join(to); results.push([rel, from.slice(0, 54), `OK (${hits})`]); }
    else results.push([rel, from.slice(0, 54), 'NOT FOUND']);
  }
  if (s !== orig) fs.writeFileSync(p, s, 'utf8');
}

function applyRegex(rel, ops) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  const orig = s;
  for (const op of ops) {
    let hits = 0;
    s = s.replace(op.re, (...a) => { hits += 1; return op.to(...a); });
    if (hits > 0) results.push([rel, String(op.re).slice(0, 54), `OK (${hits})`]);
    else if (op.check && op.check.test(s)) results.push([rel, String(op.re).slice(0, 54), 'ALREADY']);
    else results.push([rel, String(op.re).slice(0, 54), 'NOT FOUND']);
  }
  if (s !== orig) fs.writeFileSync(p, s, 'utf8');
}

const MONEY_HELPER_FROM = "const money = v => String(v == null ? 0 : v).padStart(5, '0'); // 00000 when genuinely zero";
const MONEY_HELPER_TO =
  "const money = v => (v === null || v === undefined) ? 'NOT CONFIGURED' : (Number(v) === 0 ? '00000' : Number(v).toLocaleString()); // spec: NOT CONFIGURED / 00000 / real value";

const FAVICON = [
  '  <link rel="icon" href="../assets/branding/favicon.ico" sizes="any">',
  '  <link rel="icon" type="image/png" sizes="32x32" href="../assets/branding/booyahx-icon.png">',
  '  <link rel="icon" type="image/png" sizes="192x192" href="../assets/branding/booyahx-icon-192.png">',
  '  <link rel="icon" type="image/png" sizes="512x512" href="../assets/branding/booyahx-icon-512.png">',
  '  <link rel="apple-touch-icon" sizes="180x180" href="../assets/branding/apple-touch-icon.png">',
].join('\n');

/* ---------------- owner/money.html ---------------- */
applyLiteral('owner/money.html', [
  ['Total Deposited (Coins)', 'Total Deposited (BX Coins)'],
  ['Total Withdrawn (Coins)', 'Total Withdrawn (BX Coins)'],
  ['Reserved Coins', 'Reserved (BX Coins)'],
  ['Rejected Withdrawals (Coins)', 'Rejected Withdrawals (BX Coins)'],
  ['Coins in Circulation', 'BX Coins in Circulation'],
  [MONEY_HELPER_FROM, MONEY_HELPER_TO],
]);
applyRegex('owner/money.html', [
  { re: /<title>[^<]*<\/title>/, check: /<title>BooyahX Owner Console - Money Board<\/title>/,
    to: () => '<title>BooyahX Owner Console - Money Board</title>' },
  { re: /(?<!rel="icon"[^>]{0,200})<meta name="viewport"[^>]*>\r?\n(?!  <link rel="icon")/,
    check: /rel="icon" href="\.\.\/assets\/branding\/favicon\.ico"/,
    to: (m) => m + FAVICON + '\n' },
  { re: /Money\s*[—–-]\s*Live Board/g, check: /<h1>Money Live Board<\/h1>/,
    to: () => 'Money Live Board' },
]);

/* ---------------- moderator/moderator.html ---------------- */
applyLiteral('moderator/moderator.html', [
  ['<span class="nav-icon">¢</span>Coins</a>', '<span class="nav-icon">¢</span>BX Coins</a>'],
  ['</span>Money</a>', '</span>Money Board</a>'],
  ['Entry price (Coins) *', 'Entry price (BX Coins) *'],
  ['Price in Coins (0 = free)', 'Price in BX Coins (0 = free)'],
  ['Price in Coins *', 'Price in BX Coins *'],
  ['<h3 style="margin-bottom:12px;">Adjust Coins', '<h3 style="margin-bottom:12px;">Adjust BX Coins'],
  ['</strong> coins</p>', '</strong> BX Coins</p>'],
  ['<option value="add">ADD COINS</option><option value="remove">REMOVE COINS</option>',
   '<option value="add">ADD BX COINS</option><option value="remove">REMOVE BX COINS</option>'],
  ['<label class="form-label">Amount *</label><input type="number" class="form-input" id="ca-amount"',
   '<label class="form-label">Amount (BX Coins) *</label><input type="number" class="form-input" id="ca-amount"'],
  ["coins: 'Coins',", "coins: 'BX Coins',"],
  ['Total Deposited (Coins)', 'Total Deposited (BX Coins)'],
  ['Total Withdrawn (Coins)', 'Total Withdrawn (BX Coins)'],
  ['Reserved Coins', 'Reserved (BX Coins)'],
  ['Coins in Circulation', 'BX Coins in Circulation'],
  ['<td>${esc(i.kind)}</td><td>${esc(i.price_coins)}</td>',
   '<td>${esc(i.kind)}</td><td>${esc(i.price_coins)} BX Coins</td>'],
  ['<td>${esc(u.email)}</td><td><strong>${esc(u.balance)}</strong></td>',
   '<td>${esc(u.email)}</td><td><strong>${esc(u.balance)} BX Coins</strong></td>'],
  ['${esc(t.amount)}</td>', '${esc(t.amount)} BX Coins</td>'],
  ["'Amount must be a positive number'", "'Amount must be a positive number of BX Coins'"],
  ["'Add Coins' : 'Remove Coins'", "'Add BX Coins' : 'Remove BX Coins'"],
  ["${amount} coins ${action === 'add'", "${amount} BX Coins ${action === 'add'"],
  ['${r.new_balance})', '${r.new_balance} BX Coins)'],
  [MONEY_HELPER_FROM, MONEY_HELPER_TO],
]);
applyRegex('moderator/moderator.html', [
  { re: /<title>[^<]*<\/title>/, check: /<title>BooyahX - Moderator Dashboard<\/title>/,
    to: () => '<title>BooyahX - Moderator Dashboard</title>' },
  { re: /(?<!rel="icon"[^>]{0,200})<meta name="viewport"[^>]*>\r?\n(?!  <link rel="icon")/,
    check: /rel="icon" href="\.\.\/assets\/branding\/favicon\.ico"/,
    to: (m) => m + FAVICON + '\n' },
  { re: /Money\s*[—–-]\s*Live Board/g, check: /money: 'Money Live Board'/,
    to: () => 'Money Live Board' },
]);

/* ---------------- report ---------------- */
let bad = 0;
for (const [f, rule, st] of results) {
  const problem = st === 'NOT FOUND';
  if (problem) bad += 1;
  console.log(`[${problem ? 'X' : 'v'}] ${f} :: ${rule} :: ${st}`);
}
console.log(`\nTOTAL: ${results.length}, problems: ${bad}`);
process.exitCode = bad ? 1 : 0;
