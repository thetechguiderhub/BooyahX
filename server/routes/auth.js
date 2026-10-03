/* ============================================
   BOOYAHX — AUTH ROUTES
   Signup, signin, signout, session, password
   reset, login history, security alerts,
   user verification.
   ============================================ */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

module.exports = function authRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, getUserAccess, invalidateUser } = ctx;
  const {
    badRequest, notFound, denied, conflict, serverError,
    requireFields, cleanText, notify, sendEmail, logError
  } = require('../helpers');

  // ---------- SIGN UP ----------

  app.post('/api/auth/signup', (req, res) => {
    try {
      const body = req.body || {};
      const missing = requireFields(body, ['name', 'username', 'email', 'password', 'confirmPassword']);
      if (missing) return badRequest(res, missing);

      const name = cleanText(body.name, 80);
      const username = cleanText(body.username, 30).toLowerCase();
      const email = cleanText(body.email, 120).toLowerCase();
      const password = String(body.password);

      if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        return badRequest(res, 'Username must be 3-30 characters (letters, numbers, underscore)');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return badRequest(res, 'Invalid email address');
      }
      if (password.length < 8) return badRequest(res, 'Password must be at least 8 characters');
      if (password !== String(body.confirmPassword)) return badRequest(res, 'Passwords do not match');
      if (body.termsAccepted !== true && body.termsAccepted !== 'true') {
        return badRequest(res, 'You must accept the terms and conditions');
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
      if (existing) return conflict(res, 'Email or username already exists');

      const userId = db.makeId('USR');
      const hash = bcrypt.hashSync(password, 12);

      db.tx(() => {
        db.prepare(`INSERT INTO users (id, name, username, email, password_hash, role, status)
                    VALUES (?, ?, ?, ?, ?, 'USER', 'active')`)
          .run(userId, name, username, email, hash);
        db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, 0)').run(userId);
        db.prepare('INSERT INTO user_profiles (user_id) VALUES (?)').run(userId);
        db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, \'role_user\', NULL)').run(userId);
        db.audit(userId, 'user_registered', 'user', userId, { email });
      });

      invalidateUser(userId);
      sendEmail(userId, email, 'signup', { username });

      res.status(201).json({ message: 'Account created successfully', userId });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ---------- SIGN IN ----------

  app.post('/api/auth/signin', (req, res) => {
    try {
      const body = req.body || {};
      const identifier = cleanText(body.email, 120);
      const password = String(body.password || '');
      if (!identifier || !password) return badRequest(res, 'Email and password are required');

      const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(identifier.toLowerCase(), identifier);
      const ip = req.ip || req.headers['x-forwarded-for'] || '';
      const ua = req.headers['user-agent'] || '';

      const recordLogin = (status, userId) => {
        db.prepare('INSERT INTO login_history (id, user_id, ip, user_agent, device, browser, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(db.makeId('LOG'), userId || null, cleanText(String(ip), 60), cleanText(ua, 300),
               cleanText(ua, 60), cleanText(ua, 60), status);
      };

      if (!user) {
        recordLogin('failed', null);
        return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      if (!bcrypt.compareSync(password, user.password_hash)) {
        // Failed login threshold security alert
        const recentFails = db.prepare(
          "SELECT COUNT(*) as c FROM login_history WHERE user_id = ? AND status = 'failed' AND login_at > datetime('now', '-15 minutes')"
        ).get(user.id).c;
        recordLogin('failed', user.id);
        if (recentFails >= 4) {
          const already = db.prepare(
            "SELECT id FROM security_alerts WHERE user_id = ? AND type = 'failed_login_threshold' AND status = 'open' AND created_at > datetime('now', '-1 hour')"
          ).get(user.id);
          if (!already) {
            db.prepare('INSERT INTO security_alerts (id, user_id, type, message, severity) VALUES (?, ?, ?, ?, ?)')
              .run(db.makeId('SEC'), user.id, 'failed_login_threshold',
                   `${recentFails + 1} failed login attempts in the last 15 minutes`, 'warning');
          }
        }
        return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      if (user.status !== 'active') {
        recordLogin('failed', user.id);
        return res.status(403).json({ error: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
      }

      // Fresh session (prevents fixation)
      req.session.regenerate((err) => {
        if (err) {
          logError({ endpoint: '/api/auth/signin', method: 'POST', type: 'session', status: 500, message: err.message });
          return serverError(res, err);
        }
        req.session.userId = user.id;
        recordLogin('success', user.id);
        db.audit(user.id, 'user_login', 'user', user.id, {});

        const access = getUserAccess(user.id);
        res.json({
          message: 'Signed in successfully',
          user: {
            id: user.id, name: user.name, username: user.username, email: user.email,
            role: user.role, status: user.status,
            roles: access.roles, permissions: access.permissions,
            isPrimaryOwner: access.isPrimaryOwner,
            console_mode: ['OWNER', 'DEVELOPER'].includes(req.session.consoleMode) ? req.session.consoleMode : 'DEVELOPER'
          }
        });
      });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ---------- SIGN OUT ----------

  app.post('/api/auth/signout', requireAuth, (req, res) => {
    const userId = req.user.id;
    req.session.destroy(() => {
      db.audit(userId, 'user_logout', 'user', userId, {});
      res.json({ message: 'Signed out successfully' });
    });
  });

  // ---------- CURRENT USER (roles + permissions for dynamic nav) ----------

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(req.user.id);
    const access = getUserAccess(req.user.id);
    res.json({
      user: {
        ...req.user,
        roles: access.roles,
        permissions: access.permissions,
        isPrimaryOwner: access.isPrimaryOwner,
        // Interface/workspace mode (session-scoped, Primary Owner only).
        // NEVER a substitute for the actual RBAC role.
        console_mode: ['OWNER', 'DEVELOPER'].includes(req.session.consoleMode) ? req.session.consoleMode : 'DEVELOPER'
      },
      balance: wallet ? wallet.balance : 0
    });
  });

  // ---------- PREFERENCES (server-stored locale; server is authority when signed in) ----------

  app.get('/api/auth/preferences', requireAuth, (req, res) => {
    let prefs = {};
    try {
      const row = db.prepare('SELECT preferences FROM user_profiles WHERE user_id = ?').get(req.user.id);
      prefs = (row && row.preferences) ? JSON.parse(row.preferences) : {};
    } catch (_) { prefs = {}; }
    res.json({ preferences: { locale: prefs.locale === 'ur' ? 'ur' : 'en' } });
  });

  app.put('/api/auth/preferences', requireAuth, (req, res) => {
    const b = req.body || {};
    if (b.locale !== undefined && !['en', 'ur'].includes(b.locale)) {
      return badRequest(res, 'locale must be en or ur');
    }
    let prefs = {};
    try {
      const row = db.prepare('SELECT preferences FROM user_profiles WHERE user_id = ?').get(req.user.id);
      prefs = (row && row.preferences) ? JSON.parse(row.preferences) : {};
    } catch (_) { prefs = {}; }
    if (b.locale !== undefined) prefs.locale = b.locale;
    db.prepare("UPDATE user_profiles SET preferences = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(JSON.stringify(prefs), req.user.id);
    res.json({ message: 'Preferences saved', preferences: { locale: prefs.locale === 'ur' ? 'ur' : 'en' } });
  });

  // ---------- FORGOT PASSWORD (honest about email config) ----------

  app.post('/api/auth/forgot-password', (req, res) => {
    const email = cleanText((req.body || {}).email, 120).toLowerCase();
    if (!email) return badRequest(res, 'Email is required');

    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

    // Always respond the same to avoid account enumeration;
    // but never claim an email was sent when it wasn't.
    const emailReady = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD;
    if (!user || !emailReady) {
      return res.json({
        message: 'If an account exists, a reset link will be sent.',
        email_status: 'EMAIL SERVICE NOT CONFIGURED'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare('INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(db.makeId('RST'), user.id, tokenHash, expires);

    const result = sendEmail(user.id, user.email, 'security_alert', {
      username: user.username, reset_link: `http://localhost:${process.env.PORT || 3000}/reset-password.html?token=${token}`
    });
    res.json({
      message: 'If an account exists, a reset link will be sent.',
      email_status: result.sent ? 'sent' : 'EMAIL SERVICE NOT CONFIGURED'
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { token, password, confirmPassword } = req.body || {};
    if (!token || !password || !confirmPassword) return badRequest(res, 'Token and password fields are required');
    if (String(password).length < 8) return badRequest(res, 'Password must be at least 8 characters');
    if (password !== confirmPassword) return badRequest(res, 'Passwords do not match');

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const row = db.prepare(
      'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime(\'now\')'
    ).get(tokenHash);
    if (!row) return res.status(400).json({ error: 'Reset link is invalid or expired', code: 'INVALID_TOKEN' });

    db.tx(() => {
      const hash = bcrypt.hashSync(String(password), 12);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, row.user_id);
      db.prepare('UPDATE password_resets SET used_at = datetime(\'now\') WHERE id = ?').run(row.id);
      db.audit(row.user_id, 'password_reset', 'user', row.user_id, {});
      db.prepare('INSERT INTO security_alerts (id, user_id, type, message, severity) VALUES (?, ?, ?, ?, ?)')
        .run(db.makeId('SEC'), row.user_id, 'password_change', 'Password was reset via email link', 'warning');
    });
    invalidateUser(row.user_id);

    res.json({ message: 'Password has been reset. You can now sign in.' });
  });

  // ---------- LOGIN HISTORY ----------

  app.get('/api/auth/login-history', requireAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const rows = db.prepare(
      'SELECT id, login_at, ip, device, browser, status FROM login_history WHERE user_id = ? ORDER BY login_at DESC LIMIT ?'
    ).all(req.user.id, limit);
    res.json({ history: rows });
  });

  // ---------- SECURITY ALERTS (own) ----------

  app.get('/api/auth/security-alerts', requireAuth, (req, res) => {
    const rows = db.prepare(
      'SELECT id, type, message, severity, status, created_at FROM security_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.user.id);
    res.json({ alerts: rows });
  });

  // ---------- USER VERIFICATION (own) ----------

  app.get('/api/verification/me', requireAuth, (req, res) => {
    const rows = db.prepare(
      'SELECT id, type, status, notes, created_at, reviewed_at FROM user_verifications WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    const current = rows.find(r => r.status === 'verified') || rows.find(r => r.status === 'pending') || null;
    res.json({ verifications: rows, current });
  });

  app.post('/api/verification', requireAuth, (req, res) => {
    try {
      const { type, data } = req.body || {};
      if (!['phone', 'identity'].includes(type)) return badRequest(res, 'Type must be phone or identity');
      if (!data || typeof data !== 'object') return badRequest(res, 'Verification data is required');

      const pending = db.prepare(
        "SELECT id FROM user_verifications WHERE user_id = ? AND type = ? AND status = 'pending'"
      ).get(req.user.id, type);
      if (pending) return conflict(res, 'A pending verification of this type already exists');

      // Store sensitive data; only authorized roles may read it later.
      const payload = {};
      if (type === 'phone') {
        const phone = cleanText(data.phone, 30);
        if (!/^\+?[0-9-]{7,20}$/.test(phone)) return badRequest(res, 'Invalid phone number');
        payload.phone = phone;
      } else {
        payload.document_type = cleanText(data.document_type, 40);
        payload.document_number = cleanText(data.document_number, 60);
        payload.full_name = cleanText(data.full_name, 120);
        if (!payload.document_type || !payload.document_number) {
          return badRequest(res, 'Document type and number are required');
        }
      }

      const id = db.makeId('VFY');
      db.prepare('INSERT INTO user_verifications (id, user_id, type, data, status) VALUES (?, ?, ?, ?, ?)')
        .run(id, req.user.id, type, JSON.stringify(payload), 'pending');
      db.audit(req.user.id, 'verification_submitted', 'verification', id, { type });
      res.status(201).json({ message: 'Verification submitted for review', id, status: 'pending' });
    } catch (err) {
      serverError(res, err);
    }
  });
};
