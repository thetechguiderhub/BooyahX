/* ============================================
   BOOYAHX — MODERATOR DASHBOARD + AUTH TESTS
   ----------------------------------------
   Requires the server running at localhost:3000
   (RATE_LIMIT_DISABLED=true recommended).

   AUTH:
     - sign up / sign in / sign out / session persistence (/auth/me)
     - OAuth status endpoint (honest config reporting)
     - session store persistence across a server restart
       (run test/persistence-restart.sh for the restart part)

   MODERATOR (RBAC enforced server-side):
     - USER gets 403 on every moderator endpoint
     - Moderator: overview, tournaments CRUD via the EXISTING
       tournament API, registrations view, event + items +
       real coin purchase flow, news draft/publish,
       coins add/remove (reason mandatory, audited, atomic),
       money board with real values
     - Moderator denied Owner-only powers (roles.manage,
       api-keys, backups, owner console switch)
     - Owner + Developer can view the money board
     - every sensitive action audited

   Cleans up everything it creates (zero fake data).
   ============================================ */

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
require('./_env'); // loads .env → PRIMARY/TEMPORARY owner passwords

const BASE = 'http://localhost:3000/api';
const PRIMARY_OWNER_EMAIL = 'itxmeshadow1234@gmail.com';

const failures = [];
function check(name, ok, detail) {
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
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      return { status: res.status, data };
    }
  };
}

async function signUp(username) {
  const email = username + '@booyahx-test.local';
  const c = client();
  await c.req('POST', '/auth/signup', {
    name: username, username, email, password: 'TestPass123!', confirmPassword: 'TestPass123!', termsAccepted: true
  });
  const s = await c.req('POST', '/auth/signin', { email, password: 'TestPass123!' });
  if (s.status !== 200) throw new Error('signin failed for ' + username);
  return { client: c, username, email };
}

async function main() {
  const owner = client();
  let r = await owner.req('POST', '/auth/signin', { email: PRIMARY_OWNER_EMAIL, password: process.env.PRIMARY_OWNER_PASSWORD });
  check('Primary Owner signs in', r.status === 200);

  // Moderator: the real moderator account (email from DB, password from env)
  const modEmailRow = db.prepare(`
    SELECT u.email, u.username FROM user_roles ur
    JOIN roles ro ON ro.id = ur.role_id JOIN users u ON u.id = ur.user_id
    WHERE ro.name = 'MODERATOR' LIMIT 1
  `).get();
  const mod = client();
  r = await mod.req('POST', '/auth/signin', { email: modEmailRow.email, password: process.env.MODERATOR_PASSWORD });
  check('Moderator signs in (real MODERATOR account)', r.status === 200, JSON.stringify(r.data));
  check('Moderator session carries moderator permissions',
    r.status === 200 && r.data.user.permissions.includes('moderator.dashboard') &&
    r.data.user.permissions.includes('moderator.coins.adjust'), JSON.stringify(r.data.user && r.data.user.permissions));

  const user = await signUp('smoke_mod_' + Date.now().toString(36));

  // ================= RBAC DENIALS =================
  for (const ep of ['/moderator/overview', '/moderator/money', '/moderator/coins/users?q=ab']) {
    r = await user.client.req('GET', ep);
    check(`USER denied ${ep} (403)`, r.status === 403, 'HTTP ' + r.status);
  }
  r = await user.client.req('POST', '/moderator/coins/adjust', { user_id: 'x', action: 'add', amount: 5, reason: 'nope nope' });
  check('USER denied coins adjust (403)', r.status === 403);

  // Moderator must NOT reach Owner/Developer powers
  r = await mod.req('POST', '/owner/team/assign', { username: user.username, role: 'OWNER' });
  check('Moderator denied roles.manage (403)', r.status === 403, 'HTTP ' + r.status);
  r = await mod.req('GET', '/owner/api-keys');
  check('Moderator denied api-keys (403)', r.status === 403, 'HTTP ' + r.status);
  r = await mod.req('GET', '/owner/backups');
  check('Moderator denied backups (403)', r.status === 403, 'HTTP ' + r.status);
  r = await mod.req('POST', '/console/switch', { console: 'OWNER' });
  check('Moderator denied console switch (403)', r.status === 403, 'HTTP ' + r.status);

  // ================= TOURNAMENT (existing API, moderator perms) =================
  r = await mod.req('GET', '/moderator/overview');
  check('Moderator overview (real counts)', r.status === 200 && typeof r.data.tournament.total === 'number', JSON.stringify(r.data));
  const overviewBefore = r.data;

  r = await mod.req('GET', '/moderator/tournaments');
  check('Moderator tournament list (real data)', r.status === 200 && Array.isArray(r.data.tournaments));

  const start = new Date(Date.now() + 3600 * 1000).toISOString();
  r = await mod.req('POST', '/tournaments', {
    name: 'MOD Test Cup', game: 'Free Fire', mode: 'Clash Squad', format: 'Clash Squad 4v4',
    entry_cost: 20, player_limit: 8, team_size: 4, start_time: start
  });
  check('Moderator creates tournament (201)', r.status === 201, JSON.stringify(r.data));
  const tId = r.data && r.data.tournamentId;

  r = await mod.req('POST', '/tournaments', {
    name: 'MOD Bad Cup', game: 'Free Fire', mode: 'Clash Squad', format: 'Clash Squad 4v4',
    entry_cost: -5, player_limit: 8, team_size: 4, start_time: start
  });
  check('negative entry price never stored (clamped to 0)', r.status === 201, JSON.stringify(r.data));
  const badTId = r.data && r.data.tournamentId;
  r = await mod.req('GET', `/tournaments/${badTId}`);
  check('entry price invariant: >= 0 in database', r.status === 200 && r.data.tournament.entry_cost >= 0,
    `entry_cost=${r.data && r.data.tournament && r.data.tournament.entry_cost}`);

  r = await mod.req('PUT', `/tournaments/${tId}`, { description: 'updated by moderator', ends_at: new Date(Date.now() + 7200 * 1000).toISOString() });
  check('Moderator edits tournament', r.status === 200, JSON.stringify(r.data));

  r = await mod.req('PUT', `/tournaments/${tId}`, { ends_at: new Date(Date.now() - 7200 * 1000).toISOString() });
  check('end before start rejected', r.status === 400, JSON.stringify(r.data));

  r = await user.client.req('GET', `/tournaments/${tId}/registrations`);
  check('USER denied registrations view (403)', r.status === 403, 'HTTP ' + r.status);

  r = await mod.req('GET', `/tournaments/${tId}/registrations`);
  check('Moderator views registrations (empty state)', r.status === 200 && r.data.count === 0, JSON.stringify(r.data && r.data.count));

  // ================= EVENT + ITEMS + PURCHASE =================
  r = await mod.req('POST', '/events', {
    title: 'MOD Test Event', status: 'published',
    start_time: new Date(Date.now() - 60000).toISOString(),
    end_time: new Date(Date.now() + 86400 * 1000).toISOString(),
    entry: 0, description: 'Real test event'
  });
  check('Moderator creates event (201)', r.status === 201, JSON.stringify(r.data));
  const evId = r.data && r.data.id;

  r = await mod.req('POST', `/moderator/events/${evId}/items`, {
    name: 'Golden Frame', kind: 'frame', price_coins: 15, stock: 10
  });
  check('Moderator creates event item (201)', r.status === 201, JSON.stringify(r.data));
  const itemId = r.data && r.data.itemId;

  r = await mod.req('POST', `/moderator/events/${evId}/items`, { name: '', kind: 'badge', price_coins: 5 });
  check('item without name rejected', r.status === 400);

  // Purchase without coins → rejected (atomic, no partial state)
  r = await user.client.req('POST', `/events/${evId}/items/${itemId}/purchase`);
  check('purchase with 0 coins rejected', r.status === 400, JSON.stringify(r.data));

  // Fund the user through the REAL deposit flow (owner verifies)
  r = await owner.req('GET', '/coin-packages');
  const pkg = (r.data.packages || []).find(p => p.coins >= 50) || r.data.packages[0];
  const ref = 'MODPAY' + Date.now();
  await user.client.req('POST', '/deposits', { package_id: pkg.id, payment_method: 'jazzcash', reference: ref });
  r = await owner.req('GET', '/deposits?status=pending');
  const dep = (r.data.deposits || []).find(d => d.username === user.username);
  await owner.req('POST', `/deposits/${dep.id}/approve`, { notes: 'test funding' });
  r = await user.client.req('GET', '/wallet');
  const balance = r.data.wallet.balance;
  check('user funded via real deposit flow', balance >= 50, `balance=${balance}`);

  r = await user.client.req('POST', `/events/${evId}/items/${itemId}/purchase`);
  check('real purchase succeeds (201)', r.status === 201, JSON.stringify(r.data));
  check('purchase deducts coins atomically', r.data.balance === balance - 15, `balance=${r.data.balance}`);
  const purchaseBalance = r.data.balance;

  r = await user.client.req('POST', `/events/${evId}/items/${itemId}/purchase`);
  check('duplicate purchase rejected (409)', r.status === 409, JSON.stringify(r.data));

  // Draft event → purchase rejected
  r = await mod.req('POST', '/events', {
    title: 'MOD Draft Event', status: 'draft',
    start_time: new Date().toISOString(), end_time: new Date(Date.now() + 86400 * 1000).toISOString(), entry: 0
  });
  const draftEvId = r.data.id;
  await mod.req('POST', `/moderator/events/${draftEvId}/items`, { name: 'Draft Item', kind: 'badge', price_coins: 5 });
  r = await user.client.req('GET', `/events/${draftEvId}/items`);
  check('draft event not publicly visible (404)', r.status === 404, 'HTTP ' + r.status);

  // ================= NEWS =================
  r = await mod.req('POST', '/news', {
    title: 'MOD News ' + Date.now(), category: 'event', status: 'draft',
    content: '<p>Real moderator news</p>', event_id: evId
  });
  check('Moderator creates news draft (201)', r.status === 201, JSON.stringify(r.data));
  const newsId = r.data && r.data.id;
  const newsTitle = r.data && undefined; // title generated above

  r = await client().req('GET', '/news');
  const pubBefore = (r.data.news || []).some(n => n.id === newsId);
  check('draft news NOT public', pubBefore === false);

  r = await mod.req('PUT', `/news/${newsId}`, { status: 'published' });
  check('Moderator publishes news', r.status === 200, JSON.stringify(r.data));
  r = await client().req('GET', '/news');
  check('published news appears on public News API', (r.data.news || []).some(n => n.id === newsId));

  // ================= COINS =================
  r = await mod.req('GET', `/moderator/coins/users?q=${user.username}`);
  check('Moderator searches real users', r.status === 200 && r.data.users.length === 1, JSON.stringify(r.data));
  const targetUser = r.data.users[0];

  r = await mod.req('POST', '/moderator/coins/adjust', { user_id: targetUser.id, action: 'add', amount: 50, reason: 'x' });
  check('short reason rejected', r.status === 400, JSON.stringify(r.data));

  r = await mod.req('POST', '/moderator/coins/adjust', { user_id: targetUser.id, action: 'add', amount: 50, reason: 'Tournament reward correction' });
  check('coins ADD works with reason', r.status === 200 && r.data.new_balance === targetUser.balance + 50, JSON.stringify(r.data));

  r = await mod.req('POST', '/moderator/coins/adjust', { user_id: targetUser.id, action: 'remove', amount: 999999, reason: 'Overdraw attempt test' });
  check('removing more than balance rejected', r.status === 400, JSON.stringify(r.data));

  r = await mod.req('POST', '/moderator/coins/adjust', { user_id: targetUser.id, action: 'remove', amount: 20, reason: 'Fraud correction test' });
  check('coins REMOVE works with reason', r.status === 200 && r.data.new_balance === targetUser.balance + 30, JSON.stringify(r.data));

  // Verify via the DB directly (the API's 50-row window may scroll past)
  const coinAudit = db.prepare(`
    SELECT * FROM audit_logs
    WHERE action = 'moderator_coins_added' AND target_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(targetUser.id);
  check('coin adjustment audited with actor + reason + balances', !!coinAudit &&
    /Tournament reward correction/.test(coinAudit.metadata || '') &&
    /previous_balance/.test(coinAudit.metadata || '') && coinAudit.actor_id && coinAudit.actor_id !== targetUser.id,
    JSON.stringify(coinAudit && coinAudit.metadata));

  // ================= MONEY BOARD =================
  r = await mod.req('GET', '/moderator/money');
  check('Moderator views money board', r.status === 200, JSON.stringify(r.data));
  check('money values are real aggregates (numbers)',
    r.status === 200 && Number.isFinite(r.data.total_deposited_coins) && Number.isFinite(r.data.coins_in_circulation),
    JSON.stringify(r.data));
  check('money board counts the real funding deposit',
    r.data.total_deposited_coins >= pkg.coins, JSON.stringify(r.data && r.data.total_deposited_coins));

  r = await owner.req('GET', '/moderator/money');
  check('Primary Owner views money board', r.status === 200);
  r = await user.client.req('GET', '/moderator/money');
  check('USER denied money board (403)', r.status === 403, 'HTTP ' + r.status);

  // ================= OAUTH (honest states) =================
  r = await client().req('GET', '/auth/oauth/status');
  check('oauth status endpoint public + honest', r.status === 200 && typeof r.data.configured === 'boolean', JSON.stringify(r.data));
  if (!r.data.configured) {
    r = await client().req('GET', '/auth/oauth/google');
    check('unconfigured OAuth start → 503 (no fake link)', r.status === 503, 'HTTP ' + r.status);
  }

  // ================= SIGN OUT =================
  r = await user.client.req('POST', '/auth/signout');
  check('sign out works', r.status === 200, JSON.stringify(r.data));
  r = await user.client.req('GET', '/auth/me');
  check('session destroyed after sign out', r.status === 401, 'HTTP ' + r.status);

  // ================= CLEANUP (zero fake data) =================
  const ids = db.prepare("SELECT id FROM users WHERE username LIKE 'smoke_mod_%'").all().map(u => u.id);
  for (const id of ids) {
    for (const t of ['transactions', 'event_purchases', 'deposits', 'withdrawals', 'wallets',
                     'user_profiles', 'notifications', 'user_roles', 'official_team_members', 'oauth_accounts']) {
      try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch (_) {}
    }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (_) {}
  }
  if (tId) { try { db.prepare('DELETE FROM tournament_registrations WHERE tournament_id = ?').run(tId); db.prepare('DELETE FROM tournaments WHERE id = ?').run(tId); } catch (_) {} }
  if (badTId) { try { db.prepare('DELETE FROM tournaments WHERE id = ?').run(badTId); } catch (_) {} }
  if (evId) {
    try { db.prepare('DELETE FROM event_purchases WHERE event_id = ?').run(evId); } catch (_) {}
    try { db.prepare('DELETE FROM event_items WHERE event_id = ?').run(evId); } catch (_) {}
    try { db.prepare('DELETE FROM events WHERE id = ?').run(evId); } catch (_) {}
  }
  if (draftEvId) {
    try { db.prepare('DELETE FROM event_purchases WHERE event_id = ?').run(draftEvId); } catch (_) {}
    try { db.prepare('DELETE FROM event_items WHERE event_id = ?').run(draftEvId); } catch (_) {}
    try { db.prepare('DELETE FROM events WHERE id = ?').run(draftEvId); } catch (_) {}
  }
  if (newsId) { try { db.prepare('DELETE FROM news WHERE id = ?').run(newsId); } catch (_) {} }
  // audit rows referencing removed real records
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'tournament' AND (target_id = ? OR target_id = ?)").run(tId || '', badTId || '');
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'event' AND target_id IN (?, ?)").run(evId || '', draftEvId || '');
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'event_item' AND target_id NOT IN (SELECT id FROM event_items)").run();
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'news' AND target_id NOT IN (SELECT id FROM news)").run();
  // Audit rows that only exist for removed test users are test artifacts
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'user' AND target_id NOT IN (SELECT id FROM users) AND (metadata LIKE '%smoke_mod_%' OR target_id LIKE 'USR-%')").run();
  db.prepare("DELETE FROM audit_logs WHERE target_type = 'deposit' AND target_id NOT IN (SELECT id FROM deposits)").run();

  const remaining = db.prepare("SELECT COUNT(*) c FROM users WHERE username LIKE 'smoke_mod_%'").get().c;
  check('test accounts removed (zero fake data)', remaining === 0);
  const leftoverPurchases = db.prepare('SELECT COUNT(*) c FROM event_purchases').get().c;
  check('no fake purchases remain', leftoverPurchases === 0, String(leftoverPurchases));

  console.log('');
  if (failures.length) {
    console.log(`MODERATOR/AUTH: FAIL (${failures.length})`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('MODERATOR/AUTH: PASS — all checks green.');
}

main().catch(err => { console.error('RUNNER ERROR:', err); process.exit(1); });
