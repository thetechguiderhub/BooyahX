/* ============================================
   BOOYAHX — OAUTH (GOOGLE) ROUTES
   ----------------------------------------
   Environment-driven — works identically for:

     LOCAL:      APP_URL=http://localhost:3000
                 callback: http://localhost:3000/api/auth/oauth/google/callback
     PRODUCTION: APP_URL=https://booyahx.vercel.app
                 callback: https://booyahx.vercel.app/api/auth/oauth/google/callback

   Required env:
     OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET
     OAUTH_CALLBACK_URL (optional — derived from APP_URL when absent)
     APP_URL, SESSION_SECRET

   Secrets NEVER reach the frontend. The frontend only
   sees /api/auth/oauth/status → { configured: true|false }.

   Behaviour (all audited, all real):
   - New identity + unregistered email  → real signup (USER role)
   - Existing email                     → account LINKED (no role change)
   - Known provider identity            → sign-in
   - "link" flow while signed in        → links to the signed-in account
   ============================================ */

const crypto = require('crypto');

// Google endpoints by default; env overrides exist so the full flow can be
// integration-tested locally against a mock provider (never used in production
// unless explicitly configured).
const GOOGLE_AUTH_URL = process.env.OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = process.env.OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = process.env.OAUTH_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';

function oauthConfig(req) {
  const clientId = process.env.OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';
  const configured = Boolean(clientId && clientSecret);
  // Callback: explicit env wins; otherwise derive from APP_URL or the actual
  // request host (trust proxy makes this the real public domain in production).
  const callback = process.env.OAUTH_CALLBACK_URL ||
    `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/api/auth/oauth/google/callback`;
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  return { configured, clientId, clientSecret, callback, appUrl };
}

module.exports = function oauthRoutes(app, ctx) {
  const { db, requireAuth } = ctx;
  const { badRequest, notFound, serverError } = require('../helpers');

  // Honest status — no secrets exposed
  app.get('/api/auth/oauth/status', (req, res) => {
    const cfg = oauthConfig(req);
    res.json({ configured: cfg.configured, provider: 'google', callback_url: cfg.callback });
  });

  // ---------- START ----------
  app.get('/api/auth/oauth/google', (req, res) => {
    const cfg = oauthConfig(req);
    if (!cfg.configured) {
      return res.status(503).json({ error: 'OAUTH NOT CONFIGURED', code: 'OAUTH_NOT_CONFIGURED' });
    }
    const linking = Boolean(req.session && req.session.userId && req.query.link === '1');
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    req.session.oauthLinking = linking;

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.callback,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account'
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // ---------- CALLBACK ----------
  app.get('/api/auth/oauth/google/callback', async (req, res) => {
    const cfg = oauthConfig(req);
    if (!cfg.configured) {
      return res.redirect('/signin.html?oauth=not_configured');
    }
    const { code, state } = req.query || {};
    if (!code || !state || !req.session || req.session.oauthState !== state) {
      db.audit(req.session && req.session.userId, 'oauth_failed', 'auth', 'google', { reason: 'state_mismatch_or_missing_code' });
      return res.redirect('/signin.html?oauth=error');
    }
    const linking = req.session.oauthLinking === true;
    delete req.session.oauthState;
    delete req.session.oauthLinking;

    try {
      // --- token exchange (server-side only; secrets never leave the server) ---
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.callback,
          grant_type: 'authorization_code'
        })
      });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.access_token) {
        db.audit(req.session && req.session.userId, 'oauth_failed', 'auth', 'google', { reason: 'token_exchange_failed' });
        return res.redirect('/signin.html?oauth=error');
      }

      const infoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const info = await infoRes.json().catch(() => ({}));
      if (!infoRes.ok || !info.sub || !info.email) {
        db.audit(req.session && req.session.userId, 'oauth_failed', 'auth', 'google', { reason: 'userinfo_failed' });
        return res.redirect('/signin.html?oauth=error');
      }
      if (info.email_verified === false) {
        db.audit(null, 'oauth_failed', 'auth', 'google', { reason: 'email_not_verified', email: info.email });
        return res.redirect('/signin.html?oauth=unverified');
      }

      const provider = 'google';
      const providerAccountId = String(info.sub);
      const email = String(info.email).toLowerCase();
      let user = null;
      let action = null;

      // 1) Known provider identity → sign in
      const link = db.prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?')
        .get(provider, providerAccountId);
      if (link) {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(link.user_id);
        action = 'signin';
      }

      // 2) Signed-in user linking their account
      if (!user && linking && req.session.userId) {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
        if (user) action = 'link';
      }

      // 3) Same email exists → LINK to that real account (role never changes)
      if (!user && !linking) {
        const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (byEmail) { user = byEmail; action = 'link'; }
      }

      // 4) Real signup for a genuinely new user
      if (!user) {
        let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
        if (username.length < 3) username = 'player';
        while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
          username = `${username.slice(0, 16)}${crypto.randomBytes(2).toString('hex')}`;
        }
        const id = db.makeId('USR');
        // OAuth accounts have no platform password. The stored value is NOT a
        // bcrypt hash, so password sign-in honestly fails for these accounts
        // while the '!' prefix lets us detect "no real password set".
        const hash = '!oauth-no-password-' + crypto.randomBytes(24).toString('hex');
        db.tx(() => {
          db.prepare(`INSERT INTO users (id, name, username, email, password_hash, role, status)
                      VALUES (?, ?, ?, ?, ?, 'USER', 'active')`)
            .run(id, info.name || username, username, email, hash);
          db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)').run(id);
          db.prepare('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)').run(id);
          db.prepare(`INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id, email)
                      VALUES (?, ?, ?, ?, ?)`)
            .run(db.makeId('OA'), id, provider, providerAccountId, email);
        });
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        action = 'signup';
      } else if (action === 'link' && !link) {
        db.prepare(`INSERT OR IGNORE INTO oauth_accounts (id, user_id, provider, provider_account_id, email)
                    VALUES (?, ?, ?, ?, ?)`)
          .run(db.makeId('OA'), user.id, provider, providerAccountId, email);
      }

      if (user.status !== 'active') {
        db.audit(user.id, 'oauth_denied', 'auth', 'google', { reason: `account_${user.status}` });
        return res.redirect('/signin.html?oauth=account_disabled');
      }

      // --- real session (server-authoritative; same store as password sign-in) ---
      req.session.regenerate(err => {
        if (err) { console.error('OAuth session error:', err.message); return res.redirect('/signin.html?oauth=error'); }
        req.session.userId = user.id;
        const auditAction = action === 'signup' ? 'oauth_signup' : action === 'link' ? 'oauth_account_linked' : 'oauth_signin';
        db.audit(user.id, auditAction, 'user', user.id, { provider, email, ip: req.ip || null });
        db.audit(user.id, 'user_login', 'user', user.id, { via: 'oauth' });
        const target = `${cfg.appUrl}/index.html`;
        res.redirect(target);
      });
    } catch (err) {
      console.error('OAuth callback error:', err.message);
      serverError(res, err);
    }
  });

  // ---------- UNLINK (only if the account can still sign in another way) ----------
  app.delete('/api/auth/oauth/google', requireAuth, (req, res) => {
    try {
      const row = db.prepare('SELECT id FROM oauth_accounts WHERE user_id = ? AND provider = ?').get(req.user.id, 'google');
      if (!row) return notFound(res, 'Linked Google account');
      const hasOtherOAuth = db.prepare('SELECT COUNT(*) as c FROM oauth_accounts WHERE user_id = ? AND id != ?')
        .get(req.user.id, row.id).c > 0;
      const hasRealPassword = String(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id).password_hash || '').startsWith('$2');
      if (!hasOtherOAuth && !hasRealPassword) {
        return badRequest(res, 'Cannot unlink the only sign-in method for this account');
      }
      db.prepare('DELETE FROM oauth_accounts WHERE id = ?').run(row.id);
      db.audit(req.user.id, 'oauth_account_unlinked', 'user', req.user.id, { provider: 'google' });
      res.json({ message: 'Google account unlinked' });
    } catch (err) { serverError(res, err); }
  });
};
