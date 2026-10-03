/* ============================================
   BOOYAHX — PAYMENTS & CONSOLE SWITCH TESTS
   ----------------------------------------
   Requires the server running at localhost:3000
   (start with RATE_LIMIT_DISABLED=true for the
   signup-heavy parts, like the RBAC matrix).

   PAYMENTS (config-driven, real records only):
     - JazzCash deposit/withdraw AVAILABLE
     - Easypaisa deposit/withdraw disabled
     - Bank deposit/withdraw disabled
     - deposit starts PENDING, never auto-approved
     - withdrawal reserves coins
     - rejected withdrawal restores coins (with required reason)
     - completion requires a real payout reference
     - insufficient balance / below-minimum / duplicates rejected
     - every payment action audited

   CONSOLE (interface mode only, PRIMARY_OWNER only):
     - PRIMARY_OWNER can switch DEVELOPER <-> OWNER
     - RBAC role + permissions remain PRIMARY_OWNER
     - OWNER / MODERATOR / USER cannot switch
     - session persists across switches
     - every switch is audited (PRIMARY_OWNER_CONSOLE_SWITCH)

   Cleans up every record it creates (zero fake data).
   ============================================ */

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const BASE = 'http://localhost:3000/api';
const PRIMARY_OWNER_EMAIL = 'itxmeshadow1234@gmail.com';
const PRIMARY_OWNER_PASSWORD = require('./_env').PRIMARY_OWNER_PASSWORD;
// NOTE: the real temporary owner's password is never known to tests.
// The OWNER-role denial check uses a real account created through the
// actual signup + role-assignment flow, then cleans it up.

const failures = [];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail && !ok ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
}

function client() {
  let cookie = '';
  return {
    async req(method, p, body) {
      const res = await fetch(BASE + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      let data = null;
      try { data = await res.json(); } catch (_) {}
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, data };
    }
  };
}

async function signUp(username) {
  const email = username + '@booyahx-test.local';
  const c = client();
  const r = await c.req('POST', '/auth/signup', {
    name: username, username, email, password: 'TestPass123!', confirmPassword: 'TestPass123!',
    termsAccepted: true
  });
  if (r.status !== 201 && r.status !== 200) throw new Error('signup failed for ' + username + ': HTTP ' + r.status + ' ' + JSON.stringify(r.data));
  // Signup does not establish a session — sign in to get one.
  const s = await c.req('POST', '/auth/signin', { email, password: 'TestPass123!' });
  if (s.status !== 200) throw new Error('signin failed for ' + username + ': HTTP ' + s.status);
  return { client: c, username, email };
}

async function main() {
  // ================= PAYMENT METHOD CONFIG =================
  let r = await client().req('GET', '/payment-methods');
  const pm = r.data || {};
  check('payment-methods endpoint public', r.status === 200);
  check('deposit JazzCash AVAILABLE', pm.deposit && pm.deposit.find(m => m.method === 'jazzcash' && m.enabled === true));
  check('deposit Easypaisa disabled', pm.deposit && pm.deposit.find(m => m.method === 'easypaisa' && m.enabled === false));
  check('deposit Bank disabled', pm.deposit && pm.deposit.find(m => m.method === 'bank' && m.enabled === false));
  check('withdraw JazzCash AVAILABLE', pm.withdraw && pm.withdraw.find(m => m.method === 'jazzcash' && m.enabled === true));
  check('withdraw Easypaisa disabled', pm.withdraw && pm.withdraw.find(m => m.method === 'easypaisa' && m.enabled === false));
  check('withdraw Bank disabled', pm.withdraw && pm.withdraw.find(m => m.method === 'bank' && m.enabled === false));
  check('Easypaisa display text present (no fake account details)',
    pm.deposit.find(m => m.method === 'easypaisa').message === 'Coming Soon' &&
    pm.deposit.find(m => m.method === 'bank').message === 'Coming in 3 days' &&
    !JSON.stringify(pm.deposit.find(m => m.method === 'easypaisa')).includes('account'));
  check('JazzCash receiving account configured', pm.jazzcash &&
    pm.jazzcash.account_name === 'Rubina Imran' && pm.jazzcash.account_number === '0322 4936337',
    JSON.stringify(pm.jazzcash));

  // ================= DEPOSITS =================
  const uName = 'smoke_pay_' + Date.now().toString(36);
  const user = await signUp(uName);
  const owner = client();
  r = await owner.req('POST', '/auth/signin', { email: PRIMARY_OWNER_EMAIL, password: PRIMARY_OWNER_PASSWORD });
  check('Primary Owner signs in', r.status === 200);

  r = await owner.req('GET', '/coin-packages');
  const pkgs = (r.data && r.data.packages) || [];
  check('coin packages from DB', r.status === 200 && pkgs.length > 0);

  // Fund through a package large enough for withdrawal tests (>= 100 coins)
  const depPkg = pkgs.find(p => p.coins >= 100) || pkgs[pkgs.length - 1];

  // Disabled methods must be rejected
  r = await user.client.req('POST', '/deposits', { package_id: depPkg.id, payment_method: 'easypaisa', reference: 'EASY-1' });
  check('Easypaisa deposit rejected (disabled)', r.status === 400, JSON.stringify(r.data));
  r = await user.client.req('POST', '/deposits', { package_id: depPkg.id, payment_method: 'bank', reference: 'BANK-1' });
  check('Bank deposit rejected (disabled)', r.status === 400, JSON.stringify(r.data));

  const ref = 'PAY' + Date.now();
  r = await user.client.req('POST', '/deposits', { package_id: depPkg.id, payment_method: 'jazzcash', reference: ref, proof: 'test proof note' });
  check('JazzCash deposit accepted', r.status === 201, JSON.stringify(r.data));

  r = await user.client.req('GET', '/deposits/me');
  const myDep = (r.data.deposits || []).find(d => d.reference === ref);
  check('deposit starts as PENDING (never auto-approved)', myDep && myDep.status === 'pending', JSON.stringify(myDep));

  r = await user.client.req('GET', '/wallet');
  const walletBefore = (r.data.wallet || {}).balance || 0;
  check('no automatic crediting after deposit submit', walletBefore === 0, 'balance=' + walletBefore);

  // Staff sees it and verifies it (real review flow)
  r = await owner.req('GET', '/deposits?status=pending');
  const depRow = (r.data.deposits || []).find(d => d.username === uName);
  check('staff sees pending deposit', r.status === 200 && !!depRow);

  r = await owner.req('POST', `/deposits/${depRow.id}/approve`, { notes: 'verified via test' });
  check('deposit verified by staff', r.status === 200, JSON.stringify(r.data));
  r = await user.client.req('GET', '/wallet');
  const balance = r.data.wallet.balance;
  check('verified deposit credits real coins', balance === depRow.coins, `balance=${balance} coins=${depRow.coins}`);
  check('funding package covers withdrawal minimum', balance >= 100, `balance=${balance}`);

  // ================= WITHDRAWALS =================
  r = await user.client.req('POST', '/withdrawals', { coins: 100, payment_method: 'easypaisa', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  check('Easypaisa withdrawal rejected (disabled)', r.status === 400);
  r = await user.client.req('POST', '/withdrawals', { coins: 100, payment_method: 'bank', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  check('Bank withdrawal rejected (disabled)', r.status === 400);

  r = await user.client.req('POST', '/withdrawals', { coins: 50, payment_method: 'jazzcash', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  check('withdrawal below 100 coins rejected', r.status === 400, JSON.stringify(r.data));

  r = await user.client.req('POST', '/withdrawals', { coins: 100, payment_method: 'jazzcash', destination_info: 'x', account_holder_name: 'Test User' });
  check('withdrawal without account number rejected', r.status === 400);

  r = await user.client.req('POST', '/withdrawals', { coins: balance + 5000, payment_method: 'jazzcash', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  check('insufficient balance withdrawal rejected', r.status === 400, JSON.stringify(r.data));

  r = await user.client.req('POST', '/withdrawals', { coins: 100, payment_method: 'jazzcash', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  check('JazzCash withdrawal accepted', r.status === 201, JSON.stringify(r.data));
  const wId = r.data && r.data.withdrawalId;

  r = await user.client.req('GET', '/wallet');
  check('withdrawal reserves coins immediately', r.data.wallet.balance === balance - 100, `balance=${r.data.wallet.balance}`);
  check('reserved coins reported', r.data.reserved_coins === 100, `reserved=${r.data.reserved_coins}`);

  r = await user.client.req('POST', '/withdrawals', { coins: 100, payment_method: 'jazzcash', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  check('duplicate/conflicting withdrawal rejected', r.status === 409, JSON.stringify(r.data));

  // Rejection requires a reason, then restores the reserved coins
  r = await owner.req('POST', `/withdrawals/${wId}/reject`, {});
  check('withdrawal rejection without reason rejected', r.status === 400, JSON.stringify(r.data));
  r = await owner.req('POST', `/withdrawals/${wId}/reject`, { notes: 'test rejection reason' });
  check('withdrawal rejected with reason', r.status === 200, JSON.stringify(r.data));
  r = await user.client.req('GET', '/wallet');
  check('rejected withdrawal restores reserved coins', r.data.wallet.balance === balance && r.data.reserved_coins === 0,
    `balance=${r.data.wallet.balance} reserved=${r.data.reserved_coins}`);

  // Full lifecycle: request -> approve -> completed only with real payout reference
  r = await user.client.req('POST', '/withdrawals', { coins: 100, payment_method: 'jazzcash', destination_info: 'x', account_number: '03004455667', account_holder_name: 'Test User' });
  const wId2 = r.data && r.data.withdrawalId;
  check('second withdrawal accepted', r.status === 201);

  r = await owner.req('POST', `/withdrawals/${wId2}/approve`, { to: 'approved' });
  check('withdrawal approved (coins still reserved)', r.status === 200, JSON.stringify(r.data));

  r = await owner.req('POST', `/withdrawals/${wId2}/approve`, { to: 'paid' });
  check('completion without real payout reference rejected', r.status === 400, JSON.stringify(r.data));

  r = await owner.req('POST', `/withdrawals/${wId2}/approve`, { to: 'paid', payout_reference: 'JC-PAYOUT-TEST-1' });
  check('withdrawal completed with recorded payout', r.status === 200, JSON.stringify(r.data));

  r = await user.client.req('GET', '/wallet');
  check('completed payout permanently deducted', r.data.wallet.balance === balance - 100 && r.data.reserved_coins === 0,
    `balance=${r.data.wallet.balance}`);

  // ================= AUDIT (payment actions) =================
  r = await owner.req('GET', '/owner/audit-logs');
  const actions = (r.data.logs || []).map(l => l.action);
  const needed = ['deposit_submitted', 'deposit_approved', 'withdrawal_requested', 'withdrawal_rejected', 'withdrawal_paid'];
  const missingAudit = needed.filter(a => !actions.includes(a));
  check('all payment actions audited', missingAudit.length === 0, 'missing: ' + missingAudit.join(','));

  // ================= CONSOLE SWITCH =================
  const po = client();
  await po.req('POST', '/auth/signin', { email: PRIMARY_OWNER_EMAIL, password: PRIMARY_OWNER_PASSWORD });

  r = await po.req('GET', '/console');
  check('console endpoint reports can_switch for PRIMARY_OWNER', r.status === 200 && r.data.can_switch === true, JSON.stringify(r.data));
  check('default console is DEVELOPER', r.data.console_mode === 'DEVELOPER');

  r = await po.req('POST', '/console/switch', { console: 'OWNER' });
  check('PRIMARY_OWNER switches Developer -> Owner', r.status === 200 && r.data.console_mode === 'OWNER', JSON.stringify(r.data));

  r = await po.req('GET', '/auth/me');
  check('session persists after switch (no logout)', r.status === 200);
  check('RBAC role still PRIMARY_OWNER after switch', r.data.user.role === 'PRIMARY_OWNER' && r.data.user.roles.includes('PRIMARY_OWNER'), JSON.stringify(r.data.user && r.data.user.roles));
  check('permissions remain PRIMARY_OWNER (full authority)',
    Array.isArray(r.data.user.permissions) && r.data.user.permissions.length > 50 &&
    r.data.user.permissions.includes('deposits.verify') && r.data.user.permissions.includes('roles.manage'),
    'count=' + (r.data.user.permissions || []).length);

  r = await po.req('POST', '/owner/team/assign', { user_id: '__nobody__', role: 'OWNER' });
  check('PRIMARY_OWNER-only action still allowed in OWNER console', r.status === 404, 'HTTP ' + r.status);

  r = await po.req('POST', '/console/switch', { console: 'DEVELOPER' });
  check('PRIMARY_OWNER switches Owner -> Developer', r.status === 200 && r.data.console_mode === 'DEVELOPER');

  r = await po.req('POST', '/console/switch', { console: 'MODERATOR' });
  check('invalid console value rejected', r.status === 400);

  // OWNER must not switch (real OWNER account created via the actual
  // signup + role-assignment flow — no guessed credentials)
  const ownerAcct = await signUp('smoke_console_owner');
  await po.req('POST', '/owner/team/assign', { username: ownerAcct.username, role: 'OWNER' });
  const ownerClient = client();
  await ownerClient.req('POST', '/auth/signin', { email: ownerAcct.email, password: 'TestPass123!' });
  r = await ownerClient.req('GET', '/console');
  check('OWNER cannot access console switch', r.status === 200 && r.data.can_switch === false, JSON.stringify(r.data));
  r = await ownerClient.req('POST', '/console/switch', { console: 'OWNER' });
  check('OWNER switch attempt denied', r.status === 403, 'HTTP ' + r.status);

  // MODERATOR and USER must not switch
  const mod = await signUp('smoke_console_mod');
  const modRow = db.prepare('SELECT id FROM users WHERE username = ?').get(mod.username);
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(modRow.id, 'role_moderator');
  const modClient = client();
  await modClient.req('POST', '/auth/signin', { email: mod.email, password: 'TestPass123!' });
  r = await modClient.req('POST', '/console/switch', { console: 'OWNER' });
  check('MODERATOR cannot switch console', r.status === 403, 'HTTP ' + r.status);

  const plain = await signUp('smoke_console_user');
  const plainClient = client();
  await plainClient.req('POST', '/auth/signin', { email: plain.email, password: 'TestPass123!' });
  r = await plainClient.req('POST', '/console/switch', { console: 'OWNER' });
  check('USER cannot switch console', r.status === 403, 'HTTP ' + r.status);

  // DB invariants: role column never touched by console switching
  const poRow = db.prepare('SELECT role FROM users WHERE email = ?').get(PRIMARY_OWNER_EMAIL);
  check('database role column still PRIMARY_OWNER', poRow.role === 'PRIMARY_OWNER', poRow.role);

  // Console switch audit entries
  r = await po.req('GET', '/owner/audit-logs');
  const switches = (r.data.logs || []).filter(l => l.action === 'PRIMARY_OWNER_CONSOLE_SWITCH');
  check('console switches audited', switches.length >= 2, 'count=' + switches.length);
  const meta = switches.map(l => JSON.parse(l.metadata || '{}'));
  check('audit records previous/new console + role',
    meta.some(m => m.actual_role === 'PRIMARY_OWNER' && m.previous_console === 'DEVELOPER' && m.new_console === 'OWNER') &&
    meta.some(m => m.previous_console === 'OWNER' && m.new_console === 'DEVELOPER'),
    JSON.stringify(meta));
  check('audit does not log credentials',
    switches.every(l => !/password|secret|session/i.test(l.metadata || '')));

  // ================= CLEANUP (zero fake data) =================
  const testUsers = db.prepare("SELECT id FROM users WHERE username LIKE 'smoke_pay_%' OR username LIKE 'smoke_console_%'").all();
  const ids = testUsers.map(u => u.id);
  for (const id of ids) {
    for (const t of ['transactions', 'deposits', 'withdrawals', 'wallets', 'user_profiles', 'notifications', 'user_roles', 'official_team_members']) {
      try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch (_) {}
    }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (_) {}
  }
  // audit rows referencing removed test users
  db.prepare("DELETE FROM audit_logs WHERE target_id IN (SELECT id FROM users WHERE 0) OR (target_type = 'deposit' AND target_id LIKE 'DEP-%' AND target_id NOT IN (SELECT id FROM deposits))").run();
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'withdrawal' AND target_id NOT IN (SELECT id FROM withdrawals)").run();
  const remaining = db.prepare("SELECT COUNT(*) c FROM users WHERE username LIKE 'smoke_pay_%' OR username LIKE 'smoke_console_%'").get().c;
  check('test accounts removed (zero fake data)', remaining === 0);

  console.log('');
  if (failures.length) {
    console.log(`PAYMENTS/CONSOLE: FAIL (${failures.length})`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('PAYMENTS/CONSOLE: PASS — all checks green.');
}

main().catch(err => { console.error('RUNNER ERROR:', err); process.exit(1); });
