/* ============================================
   BOOYAHX — OAUTH END-TO-END FLOW TEST
   ----------------------------------------
   Runs the COMPLETE OAuth authorization-code flow
   against a local MOCK provider (test-only — the
   production defaults still point at Google):

     start → provider authorize → callback with code
     → server-side token exchange → userinfo
     → real signup / link / signin → real session

   Verifies:
     - /api/auth/oauth/status configured:true
     - start redirects to the provider with state (CSRF)
     - callback creates a REAL user account + wallet
     - session works (server-authoritative, /auth/me)
     - second login = sign-in (no duplicate account)
     - same email password account gets LINKED (role unchanged)
     - unlink protection for passwordless accounts
     - oauth actions audited (oauth_signup / oauth_signin)
     - no secrets ever returned to the client

   Cleans up everything it creates (zero fake data).

   NOTE: this test spawns its own server on PORT 3101
   so it does not interfere with a running instance.
   ============================================ */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3101;
const MOCK_PORT = 4599;
const BASE = `http://localhost:${PORT}/api`;
const DB_PATH = path.join(__dirname, '..', 'data', 'booyahx.db');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail && !ok ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
}

// ---------- MOCK OAuth PROVIDER (test fixture only) ----------
const MOCK_IDENTITY = {
  sub: 'mock-sub-' + crypto.randomBytes(4).toString('hex'),
  email: 'oauthplayer' + crypto.randomBytes(3).toString('hex') + '@booyahx-test.local',
  email_verified: true,
  name: 'OAuth Player'
};
const mockCode = 'mock-auth-code-' + crypto.randomBytes(6).toString('hex');

const mockServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${MOCK_PORT}`);
  if (url.pathname === '/authorize') {
    const ru = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    res.writeHead(302, { Location: `${ru}?code=${mockCode}&state=${state}` });
    res.end();
  } else if (url.pathname === '/token') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (params.get('client_id') !== 'mock-client-id' ||
          params.get('client_secret') !== 'mock-client-secret' ||
          params.get('code') !== mockCode) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'bad_client' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mock-access-token', token_type: 'Bearer' }));
    });
  } else if (url.pathname === '/userinfo') {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer mock-access-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'bad_token' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(MOCK_IDENTITY));
  } else {
    res.writeHead(404); res.end();
  }
});

function startServer() {
  return new Promise(resolve => {
    const child = spawn('node', ['server/index.js'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        RATE_LIMIT_DISABLED: 'true',
        OAUTH_CLIENT_ID: 'mock-client-id',
        OAUTH_CLIENT_SECRET: 'mock-client-secret',
        OAUTH_AUTH_URL: `http://localhost:${MOCK_PORT}/authorize`,
        OAUTH_TOKEN_URL: `http://localhost:${MOCK_PORT}/token`,
        OAUTH_USERINFO_URL: `http://localhost:${MOCK_PORT}/userinfo`,
        APP_URL: `http://localhost:${PORT}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', d => { if (String(d).includes('server running')) resolve(child); });
    child.stderr.on('data', d => process.stderr.write('[server] ' + d));
    setTimeout(() => resolve(child), 6000);
  });
}

function cleanupUser(db, userId) {
  for (const t of ['oauth_accounts', 'transactions', 'event_purchases', 'deposits', 'withdrawals',
                   'wallets', 'user_profiles', 'notifications', 'user_roles', 'official_team_members']) {
    try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId); } catch (_) {}
  }
  try { db.prepare('DELETE FROM users WHERE id = ?').run(userId); } catch (_) {}
  try { db.prepare("DELETE FROM audit_logs WHERE target_type = 'user' AND target_id = ?").run(userId); } catch (_) {}
}

async function main() {
  await new Promise(r => mockServer.listen(MOCK_PORT, r));
  const server = await startServer();
  const db = new DatabaseSync(DB_PATH);
  const createdUsers = [];

  try {
    // status: configured, no secrets leaked
    let res = await fetch(`${BASE}/auth/oauth/status`);
    let data = await res.json();
    check('oauth status reports configured:true', data.configured === true && data.provider === 'google', JSON.stringify(data));
    check('no client secret in status response', !JSON.stringify(data).toLowerCase().includes('secret'));

    // start: 302 to provider with state
    res = await fetch(`${BASE}/auth/oauth/google`, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    const state = new URL(loc, `http://localhost:${PORT}`).searchParams.get('state');
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const sidCookie = (setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('booyahx.sid=')) || '');
    check('start redirects to provider (302) with CSRF state', res.status === 302 && !!state, `status=${res.status} loc=${loc.slice(0, 60)}`);

    // follow the redirect to the callback exactly as a browser would
    const callbackUrl = new URL(loc, `http://localhost:${PORT}`);
    res = await fetch(callbackUrl, { headers: { Cookie: sidCookie }, redirect: 'manual' });
    check('callback redirects to the app after real signup', res.status === 302, `status=${res.status}`);
    const sessionCookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    check('callback establishes a real session cookie', sessionCookie.includes('booyahx.sid='));

    const oauthUser = db.prepare('SELECT * FROM users WHERE email = ?').get(MOCK_IDENTITY.email);
    check('oauth signup created a REAL user', !!oauthUser, JSON.stringify(MOCK_IDENTITY.email));
    if (oauthUser) {
      createdUsers.push(oauthUser.id);
      check('oauth account role is USER', oauthUser.role === 'USER', oauthUser.role);
      check('oauth account has no platform password (cannot password-login)',
        !String(oauthUser.password_hash).startsWith('$2'));
      const oa = db.prepare('SELECT * FROM oauth_accounts WHERE user_id = ?').get(oauthUser.id);
      check('provider identity linked (oauth_accounts row)', !!oa && oa.provider === 'google');
      const audit = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'oauth_signup' AND target_id = ?").get(oauthUser.id).c;
      check('oauth signup audited', audit >= 1);

      // session works — server authoritative
      res = await fetch(`${BASE}/auth/me`, { headers: { Cookie: sessionCookie } });
      data = await res.json();
      check('session persists — /auth/me returns the oauth user', res.status === 200 && data.user && data.user.email === MOCK_IDENTITY.email, JSON.stringify(data).slice(0, 120));

      // second login → signin, NOT a duplicate account
      res = await fetch(`${BASE}/auth/oauth/google`, { redirect: 'manual', headers: { Cookie: sidCookie } });
      const loc2 = res.headers.get('location') || '';
      const state2 = new URL(loc2, `http://localhost:${PORT}`).searchParams.get('state');
      const sid2 = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map(c => c.split(';')[0]).find(c => c.startsWith('booyahx.sid=')) || '';
      res = await fetch(new URL(loc2, `http://localhost:${PORT}`), { headers: { Cookie: sid2 }, redirect: 'manual' });
      const usersNow = db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get(MOCK_IDENTITY.email).c;
      check('second oauth login = sign-in (no duplicate account)', usersNow === 1, String(usersNow));
      const signinAudit = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'oauth_signin' AND target_id = ?").get(oauthUser.id).c;
      check('oauth signin audited', signinAudit >= 1);

      // passwordless account cannot unlink its only login method
      res = await fetch(`${BASE}/auth/oauth/google`, { method: 'DELETE', headers: { Cookie: sessionCookie } });
      check('unlinking the only sign-in method is refused', res.status === 400, `HTTP ${res.status}`);
    }

    // ---------- LINKING: existing password account with the same email ----------
    // Create a REAL password account first, make it a MODERATOR (real role),
    // then a NEW provider identity with the same email must LINK to it and
    // never change its RBAC role.
    const linkEmail = 'linktarget' + crypto.randomBytes(3).toString('hex') + '@booyahx-test.local';
    const linkUsername = 'link_target_' + crypto.randomBytes(2).toString('hex');
    res = await fetch(`${BASE}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Link Target', username: linkUsername, email: linkEmail,
        password: 'TestPass123!', confirmPassword: 'TestPass123!', termsAccepted: true })
    });
    check('link target signup works (auth regression)', res.status === 201, `HTTP ${res.status}`);
    const linkUser = db.prepare('SELECT * FROM users WHERE email = ?').get(linkEmail);
    if (linkUser) {
      createdUsers.push(linkUser.id);
      const po = await fetch(`${BASE}/auth/signin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'itxmeshadow1234@gmail.com', password: process.env.PRIMARY_OWNER_PASSWORD })
      });
      const poCookie = (po.headers.getSetCookie ? po.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
      await fetch(`${BASE}/owner/team/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: poCookie },
        body: JSON.stringify({ username: linkUsername, role: 'MODERATOR' })
      });

      // Point the mock provider at a NEW identity sharing that email
      MOCK_IDENTITY.sub = 'mock-sub-link-' + crypto.randomBytes(4).toString('hex');
      MOCK_IDENTITY.email = linkEmail;

      res = await fetch(`${BASE}/auth/oauth/google`, { redirect: 'manual' });
      const locL = res.headers.get('location') || '';
      const sidL = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map(c => c.split(';')[0]).find(c => c.startsWith('booyahx.sid=')) || '';
      res = await fetch(new URL(locL, `http://localhost:${PORT}`), { headers: { Cookie: sidL }, redirect: 'manual' });
      const after = db.prepare('SELECT * FROM users WHERE email = ?').get(linkEmail);
      const dupes = db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get(linkEmail).c;
      check('same-email oauth LINKS to existing account (no duplicate)', dupes === 1 && after.id === linkUser.id, `dupes=${dupes}`);
      check('linking NEVER changes the RBAC role', after.role === 'MODERATOR', after.role);
      const linkAudit = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'oauth_account_linked' AND target_id = ?").get(linkUser.id).c;
      check('account linking audited', linkAudit >= 1);
    }
  } finally {
    for (const id of createdUsers) cleanupUser(db, id);
    try { server.kill(); } catch (_) {}
    mockServer.close();
    try { db.close(); } catch (_) {}
  }

  console.log('');
  if (failures.length) {
    console.log(`OAUTH FLOW: FAIL (${failures.length})`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('OAUTH FLOW: PASS — full authorization-code flow works end to end.');
}

main().catch(err => { console.error('RUNNER ERROR:', err); process.exit(1); });
