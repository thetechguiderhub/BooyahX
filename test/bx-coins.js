'use strict';
/* BooyahX — BX COINS audit.
 * Verifies the currency rebrand: required user-facing strings present,
 * forbidden forms absent, internal API/DB/CSS names preserved,
 * coin icon assets wired up, i18n (EN+UR) updated, DB package prices real.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`[v] ${label}`); }
  else { fail += 1; failures.push(label); console.log(`[X] ${label}`); }
}

/* ----------1. Forbidden forms (repo-wide, user-facing files) ---------- */
const scanFiles = [
  'index.html', 'wallet.html', 'rules.html', 'support.html', 'profile.html',
  'settings.html', 'notifications.html', 'my-tournaments.html', 'leaderboard.html',
  'events.html', 'tournaments.html',
  'js/main.js', 'js/i18n.js', 'js/leaderboard.js', 'js/player.js', 'js/public-content.js',
  'server/routes/economy.js', 'server/routes/moderator.js', 'server/routes/tournaments.js',
  'server/db.js',
];
const forbidden = ["Coin's", 'BX Coin\'s', 'BX Coinses', "coin's"];
for (const f of scanFiles) {
  const s = read(f);
  const hit = forbidden.find(w => s.includes(w));
  ok(!hit, `forbidden form absent: ${f}${hit ? ` (found ${hit})` : ''}`);
}

/* ----------2. Homepage (§2) ---------- */
{
  const s = read('index.html');
  ok(s.includes('<h2>BX COINS</h2>'), 'index: heading "BX COINS"');
  ok(s.includes("BX Coins are the platform's tournament currency used for tournament entries and eligible rewards."),
    'index: currency description');
  ok(s.includes('Standard reference: 1 BX Coin = Rs. 5'), 'index: standard reference line');
  ok(s.includes('>GET BX COINS<'), 'index: package buttons');
  for (const n of [50, 100, 150, 200]) ok(s.includes(`>${n} BX Coins<`) || s.includes(`">${n} BX Coins<`) || s.includes(`${n} BX Coins`), `index: package ${n} BX Coins`);
  ok(!/>COINS<\/h2>/.test(s), 'index: old COINS heading gone');
}

/* ----------3. Wallet (§5) ---------- */
{
  const s = read('wallet.html');
  ok(s.includes('BX COINS BALANCE'), 'wallet: balance heading');
  ok(s.includes('ADD BX COINS'), 'wallet: ADD BX COINS button');
  ok(s.includes('Deposit BX Coins'), 'wallet: deposit section');
  ok(s.includes('Withdraw BX Coins'), 'wallet: withdraw section');
  ok(s.includes('Amount (BX Coins)'), 'wallet: amount label');
  ok(s.includes('BX Coins</div>'), 'wallet: balance unit');
  ok(!s.includes('ADD COINS<'), 'wallet: old ADD COINS gone');
  ok(!/<span class="coin-icon">C<\/span>/.test(s), 'wallet: glyph chip replaced with img');
  ok(s.includes('alt="BX Coin"'), 'wallet: icon alt text');
}

/* ----------4. Navbar chips (5 pages) ---------- */
for (const f of ['wallet.html', 'my-tournaments.html', 'notifications.html', 'profile.html', 'settings.html']) {
  const s = read(f);
  ok(s.includes('class="coin-icon coin-ic-nav"') && s.includes('alt="BX Coin"'), `${f}: nav coin icon img`);
}

/* ----------5. i18n EN + UR ---------- */
{
  const s = read('js/i18n.js');
  ok(/'wallet\.coins':\s*'BX Coins'/.test(s), 'i18n: wallet.coins EN');
  ok(/'lb\.coins_earned':\s*'BX Coins Earned'/.test(s), 'i18n: lb.coins_earned EN');
  ok(/'error\.insufficient':\s*'Insufficient BX Coins'/.test(s), 'i18n: error.insufficient EN');
  const urWallet = s.match(/'wallet\.coins':\s*'([^']*)'/g) || [];
  ok(urWallet.length === 2 && urWallet[1].includes('BX'), `i18n: wallet.coins UR has BX (${urWallet[1] || 'missing'})`);
  const urErr = s.match(/'error\.insufficient':\s*'([^']*)'/g) || [];
  ok(urErr.length === 2 && urErr[1].includes('BX'), `i18n: error.insufficient UR has BX`);
}

/* ----------6. JS formatting ---------- */
{
  const s = read('js/main.js');
  ok(s.includes('`${amount} BX Coins`'), 'main.js: formatCoins -> BX Coins');
  ok(s.includes('entry_cost} BX Coins'), 'main.js: entry cost unit');
  ok(s.includes('reward_other} BX Coins'), 'main.js: reward unit');
  ok(s.includes('class="coin-ic"'), 'main.js: coin icon in cards');
}

/* ----------7. Server messages (user-facing only) ---------- */
{
  const eco = read('server/routes/economy.js');
  ok(eco.includes("'Insufficient BX Coins'"), 'economy: insufficient message');
  ok(eco.includes('BX Coins added to your wallet'), 'economy: deposit verified notify');
  ok(eco.includes('BX Coins reserved pending review'), 'economy: withdrawal requested');
  ok(eco.includes('BX Coins restored'), 'economy: rejection restore messages');
  ok(eco.includes('BX Coins from promo code') || eco.includes('+${result.coins} BX Coins'), 'economy: promo redeem');
  ok(eco.includes('BX Coins (streak day'), 'economy: daily reward');
  ok(!/badRequest\(res, 'Insufficient coins'\)/.test(eco), 'economy: old insufficient string gone');
  const mod = read('server/routes/moderator.js');
  ok(mod.includes("badRequest(res, 'Insufficient BX Coins')"), 'moderator: insufficient message');
  ok(mod.includes('BX Coins by staff'), 'moderator: adjust notify');
  ok(mod.includes('positive number of BX Coins'), 'moderator: amount validation');
  const tn = read('server/routes/tournaments.js');
  ok(!tn.includes("new Error('Insufficient coins')"), 'tournaments: old insufficient gone');
  ok(tn.includes("new Error('Insufficient BX Coins')"), 'tournaments: new insufficient present');
  const h = read('server/helpers.js');
  ok(h.includes("new Error('Insufficient BX Coins')"), 'helpers: insufficient message');
  ok(h.includes("err.code = 'INSUFFICIENT_COINS'"), 'helpers: internal code preserved');
}

/* ----------8. Internal names preserved (§14 no breakage) ---------- */
{
  const eco = read('server/routes/economy.js');
  ok(eco.includes("app.get('/api/coin-packages'"), 'API route /api/coin-packages intact');
  ok(eco.includes('INSERT INTO coin_packages'), 'DB table coin_packages intact');
  ok(eco.includes('withdrawal_min_coins'), 'setting key withdrawal_min_coins intact');
  const dbjs = read('server/db.js');
  ok(dbjs.includes('price_coins INTEGER'), 'column price_coins intact');
  ok(dbjs.includes("'moderator.coins.view'"), 'permission key moderator.coins.view intact');
  ok(dbjs.includes('coins INTEGER NOT NULL'), 'coins column intact');
  const idx = read('index.html');
  ok(idx.includes('id="coins"'), 'anchor id="coins" preserved');
  ok(idx.includes('class="coins-grid"'), 'CSS class coins-grid preserved');
  ok(idx.includes('class="coin-package'), 'CSS class coin-package preserved');
  ok(idx.includes('class="package-coins"'), 'CSS class package-coins preserved');
  const ds = read('js/data-service.js');
  ok(ds.includes("/coin-packages"), 'data-service /coin-packages intact');
  ok(ds.includes('/moderator/coins/adjust'), 'data-service /moderator/coins/adjust intact');
}

/* ----------9. Icon assets ---------- */
for (const f of ['bx-coin.png', 'bx-coin-small.png', 'bx-coin-192.png', 'bx-coin-512.png']) {
  const p = path.join(root, 'assets', 'branding', f);
  ok(fs.existsSync(p) && fs.statSync(p).size > 1000, `asset exists: assets/branding/${f}`);
}
{
  const css = read('css/style.css');
  ok(css.includes('.coin-ic'), 'css: .coin-ic rule');
  ok(css.includes('coin-ic-nav'), 'css: .coin-ic-nav rule');
  const idx = read('index.html');
  ok(idx.includes('src="assets/branding/bx-coin-small.png"'), 'index: package icon wired');
}

/* ----------10. DB package prices (spec, real values) ---------- */
{
  const dbPath = path.join(root, 'data', 'booyahx.db');
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('SELECT coins, price_pkr FROM coin_packages ORDER BY coins').all();
    db.close();
    const got = rows.map(r => `${r.coins}/${r.price_pkr}`).join(',');
    const want = '50/200,100/450,150/700,200/1000';
    ok(got === want, `DB prices exact: ${got} (want ${want})`);
  } else ok(false, 'DB file present for price check');
}

/* ----------11. No user-facing bare unit left in reviewed spots ---------- */
{
  const leftovers = [];
  const check = (f, patterns) => {
    const s = read(f);
    for (const p of patterns) if (p.test(s)) leftovers.push(`${f}: ${p}`);
  };
  check('index.html', [/>GET COINS</, /<h2>COINS<\/h2>/]);
  check('wallet.html', [/ADD COINS</, />Coins<\/div>/, /Amount \(coins\)/]);
  check('js/main.js', [/\} Coins`;/]);
  check('owner/dashboard.html', [/>Coins Issued</]);
  check('owner/wallet.html', [/>Total Coins Issued</]);
  check('owner/promo-codes.html', [/Reward \(Coins\)/, />Coins Distributed</]);
  check('owner/settings.html', [/Minimum Withdrawal \(Coins\)/]);
  check('owner/withdrawals.html', [/'User', 'Coins', 'Method'/, /processing\? Coins stay reserved/]);
  check('owner/deposits.html', [/'Package', 'Coins', 'Amount'/]);
  check('js/leaderboard.js', [/>Coins Earned<\/th>/]);
  check('js/player.js', [/statTile\('Coins Earned'/]);
  ok(leftovers.length === 0, `no reviewed leftovers${leftovers.length ? ' -> ' + leftovers.join(' | ') : ''}`);
}

/* ----------12. Moderator console + Money Board (BX Coins labels) ---------- */
{
  const problems = [];
  const need = (f, arr) => {
    const s = read(f);
    for (const lit of arr) if (!s.includes(lit)) problems.push(`${f}: missing "${lit}"`);
  };
  const forbid = (f, patterns) => {
    const s = read(f);
    for (const p of patterns) if (p.test(s)) problems.push(`${f}: forbidden/leftover ${p}`);
  };

  const mod = 'moderator/moderator.html';
  need(mod, [
    '<title>BooyahX - Moderator Dashboard</title>',
    'rel="icon" href="../assets/branding/favicon.ico"',
    '</span>BX Coins</a>',                      // sidebar entry
    '</span>Money Board</a>',                   // sidebar money board
    'Entry price (BX Coins) *',
    'Price in BX Coins (0 = free)',
    'Price in BX Coins *',
    'Adjust BX Coins',                          // coins panel heading
    '</strong> BX Coins</p>',                   // current balance unit
    'ADD BX COINS',
    'REMOVE BX COINS',
    'Amount (BX Coins) *',
    'Total Deposited (BX Coins)',
    'Total Withdrawn (BX Coins)',
    'Reserved (BX Coins)',
    'BX Coins in Circulation',
    'Verified Deposits (PKR)',                  // PKR stays PKR
    "coins: 'BX Coins',",                       // section title
    "'Money Live Board'",                       // spec §9 name (no em-dash variant)
    '${esc(i.price_coins)} BX Coins',           // item price cell
    '${esc(u.balance)} BX Coins',               // search balance cell
    '${esc(t.amount)} BX Coins',                // history amount cell
    "'Add BX Coins' : 'Remove BX Coins'",
    "${amount} BX Coins ${action === 'add'",
    '${r.new_balance} BX Coins)',
    'NOT CONFIGURED',                           // money() empty-value rule
    "'Amount must be a positive number of BX Coins'",
  ]);
  forbid(mod, [
    /Coin's/, /BX Coinses/, /BX BX/,
    />Coins<\/a>/, /Price in Coins[^)]/, /Adjust Coins/, /ADD COINS</,
    />Coins<\/div>/, /\(Coins\)/, /coins: 'Coins'/,
    /Money\s*[—–-]\s*Live Board/, /<\/strong> coins<\/p>/,
    /padStart\(5/,                              // mangled non-zero values
  ]);

  const money = 'owner/money.html';
  need(money, [
    '<title>BooyahX Owner Console - Money Board</title>',
    'rel="icon" href="../assets/branding/favicon.ico"',
    '<h1>Money Live Board</h1>',
    'Total Deposited (BX Coins)',
    'Total Withdrawn (BX Coins)',
    'Reserved (BX Coins)',
    'Rejected Withdrawals (BX Coins)',
    'BX Coins in Circulation',
    'Verified Deposits (PKR)',
    'NOT CONFIGURED',
  ]);
  forbid(money, [
    /Coin's/, /BX Coinses/, /BX BX/,
    /\(Coins\)/, />Coins</, /Money\s*[—–-]\s*Live Board/,
    /padStart\(5/,
  ]);

  ok(problems.length === 0, `panel pages (moderator + money board)${problems.length ? ' -> ' + problems.join(' | ') : ''}`);
}

/* ----------13. Event store / purchase UI (spec §7) ---------- */
{
  const problems = [];
  const pc = read('js/public-content.js');
  const i18n = read('js/i18n.js');
  const ev = read('events.html');
  const need = (name, hay, lits) => {
    for (const lit of lits) if (!hay.includes(lit)) problems.push(`${name}: missing "${lit}"`);
  };
  need('i18n EN', i18n, ["'store.buy': 'BUY WITH BX COINS'", "'unit.coins': 'BX Coins'", "'store.price': 'Price'", "'store.owned': 'OWNED'", "'store.sold_out': 'SOLD OUT'"]);
  need('i18n UR', i18n, ["'BX کوینز'", "'BX کوینز خریدیں'"]);
  need('public-content', pc, ['data-buy-item', 'price_coins', 'my_purchases', 'ACCESS DENIED', 'err && err.message']);
  need('events.html', ev, ['event-store-modal', 'data-i18n="store.title"']);
  const forbid = (name, hay, pats) => {
    for (const p of pats) if (p.test(hay)) problems.push(`${name}: forbidden ${p}`);
  };
  forbid('i18n', i18n, [/Coin's/, /BX Coinses/, /BX BX/]);
  forbid('public-content', pc, [/Coin's/, /BX Coinses/, /BX BX/, /Math\.random/]);
  // server-side purchase texts stay official (real strings, not invented)
  const srv = read('server/routes/moderator.js');
  if (!srv.includes('Insufficient BX Coins for this purchase')) problems.push('server: insufficient message missing');
  ok(problems.length === 0, `event store UI (spec §7)${problems.length ? ' -> ' + problems.join(' | ') : ''}`);
}

console.log(`\n===== BX COINS AUDIT: ${pass} passed, ${fail} failed =====`);
if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
process.exitCode = fail ? 1 : 0;
