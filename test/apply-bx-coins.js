'use strict';
/* BooyahX — BX COINS currency rebrand (idempotent).
 * User-facing labels/messages ONLY. Internal DB fields, API routes, SQL,
 * permission keys, CSS classes and audit action keys stay unchanged.
 * Every replacement below was reviewed line-by-line from coin-audit.txt (279 matches).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IC = '<img class="coin-ic" src="assets/branding/bx-coin-small.png" alt="BX Coin">';
const IC_BIG = '<img class="coin-ic" src="assets/branding/bx-coin.png" alt="BX Coin">';
const NAV_IC = '<img class="coin-icon coin-ic-nav" src="assets/branding/bx-coin-small.png" alt="BX Coin" width="16" height="16">';

const results = [];

function applyFile(rel, rules) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { results.push({ file: rel, rule: '*', status: 'FILE MISSING' }); return; }
  let s = fs.readFileSync(p, 'utf8');
  const orig = s;
  for (const r of rules) {
    const id = r.id || (typeof r.from === 'string' ? r.from.slice(0, 56) : String(r.from).slice(0, 56));
    if (typeof r.from === 'string') {
      // Idempotency: when 'to' = prefix + 'from' (e.g. 'Coins x' -> 'BX Coins x'),
      // a naive re-run would match the already-converted text and double-prefix.
      // Replace only occurrences NOT already preceded by the added prefix.
      if (r.to.includes(r.from)) {
        const pre = r.to.endsWith(r.from) ? r.to.slice(0, r.to.length - r.from.length) : null;
        if (pre !== null) {
          const esc = pre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(?<!${esc})${r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
          let hits = 0;
          s = s.replace(re, () => { hits += 1; return r.to; });
          results.push({ file: rel, rule: id, status: hits > 0 ? `OK (${hits})` : 'ALREADY' });
          continue;
        }
      }
      const hits = s.split(r.from).length - 1;
      if (hits > 0) {
        s = s.split(r.from).join(r.to);
        results.push({ file: rel, rule: id, status: `OK (${hits})` });
      } else if (s.includes(r.to)) {
        results.push({ file: rel, rule: id, status: 'ALREADY' });
      } else {
        results.push({ file: rel, rule: id, status: 'NOT FOUND' });
      }
    } else if (r.from instanceof RegExp) {
      let hits = 0;
      const re = new RegExp(r.from.source, r.from.flags.includes('g') ? r.from.flags : r.from.flags + 'g');
      s = s.replace(re, (...args) => { hits += 1; return r.to(...args); });
      if (hits > 0) results.push({ file: rel, rule: id, status: `OK (${hits})` });
      else if (r.check && r.check.test(s)) results.push({ file: rel, rule: id, status: 'ALREADY' });
      else results.push({ file: rel, rule: id, status: 'NOT FOUND' });
    }
  }
  if (s !== orig) fs.writeFileSync(p, s, 'utf8');
}

/* i18n: rewrite value of a key for the EN dict (1st match) and UR dict (2nd match).
 * applyFile calls r.to(...args) and expects the returned STRING. */
function i18nRule(key, enVal, urVal) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let n = 0;
  return {
    id: `i18n ${key}`,
    from: new RegExp(`'${esc}':\\s*'[^']*'`, 'g'),
    check: new RegExp(`'${esc}':\\s*'[^']*${enVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    to: () => { const v = n++ === 0 ? enVal : urVal; return `'${key}': '${v}'`; },
  };
}

/* ============================ PUBLIC PAGES ============================ */

applyFile('index.html', [
  { from: '<h4>Get Coins</h4>', to: '<h4>Get BX Coins</h4>' },
  { from: 'Add Coins using available payment methods.', to: 'Add BX Coins using available payment methods.' },
  { from: '<!-- Coins Section -->', to: '<!-- BX Coins Section -->' },
  { from: '<h2>COINS</h2>', to: '<h2>BX COINS</h2>' },
  { from: "Coins are the platform's tournament currency used for tournament entries and eligible rewards.",
    to: "BX Coins are the platform's tournament currency used for tournament entries and eligible rewards." },
  { from: 'Standard reference: 1 Coin = Rs. 5', to: 'Standard reference: 1 BX Coin = Rs. 5' },
  { from: '<div class="package-coins">50 Coins</div>', to: `<div class="package-coins">${IC}50 BX Coins</div>` },
  { from: '<div class="package-coins">100 Coins</div>', to: `<div class="package-coins">${IC}100 BX Coins</div>` },
  { from: '<div class="package-coins">150 Coins</div>', to: `<div class="package-coins">${IC}150 BX Coins</div>` },
  { from: '<div class="package-coins">200 Coins</div>', to: `<div class="package-coins">${IC}200 BX Coins</div>` },
  { from: '>GET COINS<', to: '>GET BX COINS<' },
]);

for (const f of ['my-tournaments.html', 'notifications.html', 'profile.html', 'settings.html', 'wallet.html']) {
  applyFile(f, [{ from: '<span class="coin-icon">C</span>', to: NAV_IC }]);
}

applyFile('rules.html', [
  { from: 'deducted from your coin balance upon joining', to: 'deducted from your BX Coins balance upon joining' },
  { from: 'Minimum withdrawal is 100 Coins.', to: 'Minimum withdrawal is 100 BX Coins.' },
]);

applyFile('support.html', [
  { from: 'sufficient coins in your wallet', to: 'sufficient BX Coins in your wallet' },
  { from: 'How do I add coins to my account?', to: 'How do I add BX Coins to my account?' },
  { from: 'select a coin package', to: 'select a BX Coins package' },
  { from: 'The minimum withdrawal amount is 100 Coins.', to: 'The minimum withdrawal amount is 100 BX Coins.' },
]);

applyFile('wallet.html', [
  { from: '<div class="balance-label">Available Balance</div>', to: '<div class="balance-label">BX COINS BALANCE</div>' },
  {
    id: 'balance amount unit + icon',
    from: /(<span id="wallet-balance">[^<]*<\/span>) Coins/,
    check: /<span id="wallet-balance">[^<]*<\/span> BX Coins/,
    to: (m, p1) => `${IC_BIG}${p1} BX Coins`,
  },
  { from: 'id="btn-show-deposit">ADD COINS</button>', to: 'id="btn-show-deposit">ADD BX COINS</button>' },
  { from: 'Sign in to deposit or withdraw coins.', to: 'Sign in to deposit or withdraw BX Coins.' },
  { from: 'Deposit Coins</h3>', to: 'Deposit BX Coins</h3>' },
  { from: 'Coins are added only after verification', to: 'BX Coins are added only after verification' },
  { from: 'Package / Coins', to: 'Package / BX Coins' },
  { from: 'Withdraw Coins</h3>', to: 'Withdraw BX Coins</h3>' },
  { from: 'Amount (coins)', to: 'Amount (BX Coins)' },
  { from: 'Coins are <strong>reserved</strong> immediately.', to: 'BX Coins are <strong>reserved</strong> immediately.' },
  { from: 'coins (pending withdrawals)', to: 'BX Coins (pending withdrawals)' },
  { from: '${esc(p.coins)} Coins', to: '${esc(p.coins)} BX Coins' },
  { from: '<th>Package</th><th>Coins</th>', to: '<th>Package</th><th>BX Coins</th>' },
  { from: '${minimumWithdrawal} coins. Coins are reserved', to: '${minimumWithdrawal} BX Coins. BX Coins are reserved' },
  { from: '<tr><th>Coins</th><th>Method</th>', to: '<tr><th>BX Coins</th><th>Method</th>' },
  { from: 'withdrawal is ${minimumWithdrawal} coins', to: 'withdrawal is ${minimumWithdrawal} BX Coins' },
  { from: 'coins reserved, status PENDING', to: 'BX Coins reserved, status PENDING' },
  { from: 'font-weight:700;">${t.amount > 0', to: 'font-weight:700;">' + IC + '${t.amount > 0' },
  { from: '${esc(t.amount)}</td>', to: '${esc(t.amount)} BX Coins</td>' },
]);

/* ============================ OWNER CONSOLE ============================ */

applyFile('owner/dashboard.html', [
  { from: '<div class="stat-label">Coins Issued</div>', to: '<div class="stat-label">BX Coins Issued</div>' },
  { from: "'Coins Issued': s.coinsIssued,", to: "'BX Coins Issued': s.coinsIssued," },
]);

applyFile('owner/index.html', [
  { from: '<div class="stat-label">Coins Issued</div>', to: '<div class="stat-label">BX Coins Issued</div>' },
]);

applyFile('owner/deposits.html', [
  { from: "'Package', 'Coins', 'Amount'", to: "'Package', 'BX Coins', 'Amount'" },
  { from: 'Coins will be credited to the user.', to: 'BX Coins will be credited to the user.' },
  { from: "'Deposit verified and coins credited'", to: "'Deposit verified and BX Coins credited'" },
]);

applyFile('owner/leaderboard.html', [
  { from: "'Tournaments', 'Coins Earned'", to: "'Tournaments', 'BX Coins Earned'" },
]);

applyFile('owner/promo-codes.html', [
  { from: '<div class="stat-label">Coins Distributed</div>', to: '<div class="stat-label">BX Coins Distributed</div>' },
  { from: 'Reward (Coins)', to: 'Reward (BX Coins)' },
]);

applyFile('owner/settings.html', [
  { from: 'Minimum Withdrawal (Coins)', to: 'Minimum Withdrawal (BX Coins)' },
]);

applyFile('owner/templates.html', [
  { from: "fmt(t.entry_cost) + ' Coins</td>'", to: "fmt(t.entry_cost) + ' BX Coins</td>'" },
]);

applyFile('owner/tournament-create.html', [
  { from: '(Coins)', to: '(BX Coins)' },
]);

applyFile('owner/wallet.html', [
  { from: '<div class="stat-label">Total Coins Issued</div>', to: '<div class="stat-label">Total BX Coins Issued</div>' },
]);

applyFile('owner/withdrawals.html', [
  { from: '${esc(w.coins)} coins to ${esc(w.username)}', to: '${esc(w.coins)} BX Coins to ${esc(w.username)}' },
  { from: 'reserved coins: ${esc(reserved)}', to: 'reserved BX Coins: ${esc(reserved)}' },
  { from: "'User', 'Coins', 'Method'", to: "'User', 'BX Coins', 'Method'" },
  { from: 'Coins stay reserved until the payout is recorded.', to: 'BX Coins stay reserved until the payout is recorded.' },
  { from: 'Reserved coins will be restored', to: 'Reserved BX Coins will be restored' },
  { from: "'Withdrawal rejected and coins restored'", to: "'Withdrawal rejected and BX Coins restored'" },
]);

/* ============================ FRONTEND JS ============================ */

applyFile('js/main.js', [
  { from: '`${amount} Coins`;', to: '`${amount} BX Coins`;' },
  { from: '<span class="info-value">${tournament.entry_cost} Coins</span>',
    to: '<span class="info-value">' + IC + '${tournament.entry_cost} BX Coins</span>' },
  { from: '<span>${tournament.reward_1st} / ${tournament.reward_2nd} / ${tournament.reward_3rd} / ${tournament.reward_other} Coins</span>',
    to: '<span>' + IC + '${tournament.reward_1st} / ${tournament.reward_2nd} / ${tournament.reward_3rd} / ${tournament.reward_other} BX Coins</span>' },
]);

applyFile('js/leaderboard.js', [
  { from: '>Coins Earned</th>', to: '>BX Coins Earned</th>' },
]);

applyFile('js/player.js', [
  { from: "statTile('Coins Earned', s.coins_earned)", to: "statTile('BX Coins Earned', s.coins_earned)" },
]);

applyFile('js/i18n.js', [
  i18nRule('wallet.coins', 'BX Coins', 'BX کوینز'),
  i18nRule('lb.coins_earned', 'BX Coins Earned', 'کمائے گئے BX کوینز'),
  i18nRule('error.insufficient', 'Insufficient BX Coins', 'ناکافی BX کوینز'),
]);

applyFile('js/public-content.js', [
  { from: '<span data-i18n="card.entry">Entry</span>: ${esc(ev.entry || \'0\')}</span>',
    to: '<span data-i18n="card.entry">Entry</span>: ' + IC + "${esc(ev.entry || '0')} BX Coins</span>" },
]);

/* ============================ SERVER (messages only) ============================ */

applyFile('server/db.js', [
  { from: "'Add/remove coins with reason (Moderator)'", to: "'Add/remove BX Coins with reason (Moderator)'" },
  { from: '{{amount}} coins is {{status}}', to: '{{amount}} BX Coins is {{status}}' },
]);

applyFile('server/helpers.js', [
  { from: "new Error('Insufficient coins')", to: "new Error('Insufficient BX Coins')" },
]);

applyFile('server/routes/competitive.js', [
  { from: '+${r.reward} coins', to: '+${r.reward} BX Coins' },
]);

applyFile('server/routes/economy.js', [
  { from: "'Name, positive coins and positive price are required'", to: "'Name, positive BX Coins amount and positive price are required'" },
  { from: "'Coins must be positive'", to: "'BX Coins must be positive'" },
  { from: 'coins is pending review', to: 'BX Coins is pending review' },
  { from: 'Coins are added only after approval.', to: 'BX Coins are added only after approval.' },
  { from: 'coins added to your wallet', to: 'BX Coins added to your wallet' },
  { from: "'Deposit verified and coins credited'", to: "'Deposit verified and BX Coins credited'" },
  { from: "'Deposit rejected. No coins were added.'", to: "'Deposit rejected. No BX Coins were added.'" },
  { from: 'withdrawal is ${min} coins', to: 'withdrawal is ${min} BX Coins' },
  { from: "'Insufficient coins'", to: "'Insufficient BX Coins'" },
  { from: 'coins withdrawal submitted for review', to: 'BX Coins withdrawal submitted for review' },
  { from: "'Withdrawal requested. Coins reserved pending review.'", to: "'Withdrawal requested. BX Coins reserved pending review.'" },
  { from: 'coins has been paid', to: 'BX Coins has been paid' },
  { from: "'Withdrawal rejected and coins restored'", to: "'Withdrawal rejected and BX Coins restored'" },
  { from: 'coins restored.', to: 'BX Coins restored.' },
  { from: "'Code and positive coins are required'", to: "'Code and positive BX Coins are required'" },
  { from: '+${result.coins} coins', to: '+${result.coins} BX Coins' },
  { from: 'coins (streak day', to: 'BX Coins (streak day' },
  { from: 'Claimed ${result.coins} coins', to: 'Claimed ${result.coins} BX Coins' },
  { from: 'coins (pending payout rules)', to: 'BX Coins (pending payout rules)' },
]);

applyFile('server/routes/moderator.js', [
  { from: 'for ${item.price_coins} coins', to: 'for ${item.price_coins} BX Coins' },
  { from: "'Insufficient coins for this purchase'", to: "'Insufficient BX Coins for this purchase'" },
  { from: "'Amount must be a positive number of coins'", to: "'Amount must be a positive number of BX Coins'" },
  { from: '${previousBalance} coins', to: '${previousBalance} BX Coins' },
  { from: 'coins by staff. Reason:', to: 'BX Coins by staff. Reason:' },
  { from: '${amount} coins ${b.action', to: '${amount} BX Coins ${b.action' },
  { from: "'Insufficient coins'", to: "'Insufficient BX Coins'" },
]);

applyFile('server/routes/tournaments.js', [
  { from: "'Insufficient coins'", to: "'Insufficient BX Coins'" },
]);

/* ============================ REPORT ============================ */

const bad = results.filter(r => r.status === 'NOT FOUND' || r.status === 'FILE MISSING');
for (const r of results) {
  const mark = r.status === 'NOT FOUND' || r.status === 'FILE MISSING' ? 'X' : 'v';
  console.log(`[${mark}] ${r.file} :: ${r.rule} :: ${r.status}`);
}
console.log(`\nTOTAL rules: ${results.length}, problems: ${bad.length}`);
if (bad.length) { console.log('PROBLEMS:'); bad.forEach(b => console.log('  ' + JSON.stringify(b))); }
process.exitCode = bad.length ? 1 : 0;
