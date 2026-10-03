/* ============================================
   BOOYAHX — MAIN SERVER
   Express API + static frontend
   LOCAL DEVELOPMENT
   ============================================ */

const fs = require('fs');
const path = require('path');

// ---------- Environment bootstrap ----------
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}
if (!process.env.SESSION_SECRET) {
  // Generate a per-install session secret; never a shared hardcoded value.
  const crypto = require('crypto');
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  try {
    fs.appendFileSync(envPath, `\n# Generated ${new Date().toISOString()}\nSESSION_SECRET=${process.env.SESSION_SECRET}\n`);
  } catch (_) { /* .env may be read-only; in-memory secret still works for this process */ }
  console.log('[BOOT] SESSION_SECRET generated and stored in .env');
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const db = require('./db');
const {
  requireAuth, optionalAuth, requirePermission, requireRole,
  requireOwner, requirePrimaryOwner, checkPrimaryOwnerProtection,
  getUserAccess, invalidateUser
} = require('./middleware/auth');
const {
  getMaintenanceState, logError, serverError, denied
} = require('./helpers');

const app = express();
const PORT = process.env.PORT || 3000;
const RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED === 'true';

// Trust the reverse proxy (Vercel/production) so req.protocol/req.ip and
// secure cookies reflect the REAL public https request, not the internal hop.
app.set('trust proxy', 1);

// Same-site origin allowlist for credentialed requests. No localhost is
// hardcoded for production: APP_URL defines the public origin; localhost
// origins are allowed only for local development convenience.
function corsOrigin(origin, cb) {
  const allow = new Set([
    process.env.APP_URL || '',
    process.env.CORS_ORIGIN || '',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ].filter(Boolean));
  // Same-origin browser requests send no Origin header — always allowed.
  if (!origin) return cb(null, true);
  if (allow.has(origin)) return cb(null, true);
  return cb(null, false);
}

// ============================================
// SECURITY MIDDLEWARE
// ============================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

if (!RATE_LIMIT_DISABLED) {
  app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' }
  }));
  app.use('/api/auth/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later', code: 'RATE_LIMITED' }
  }));
}

// ============================================
// BODY PARSING
// ============================================

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================
// SESSIONS (persistent store — survives restarts;
// server stays the single source of auth truth)
// ============================================

const SqliteSessionStore = require('./session-store');

app.use(session({
  name: 'booyahx.sid',
  secret: process.env.SESSION_SECRET,
  store: new SqliteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Secure automatically on https (uses APP_URL as authority when set)
    secure: (process.env.NODE_ENV === 'production') || (process.env.APP_URL || '').startsWith('https://'),
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE_MS || String(8 * 60 * 60 * 1000), 10),
    sameSite: 'lax'
  }
}));

// Request ID for error correlation
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(6).toString('hex').toUpperCase();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// ============================================
// MAINTENANCE MODE (server-authoritative)
// Public users are blocked; staff with panel
// permissions and PRIMARY_OWNER keep access.
// ============================================

app.use('/api', optionalAuth, (req, res, next) => {
  const state = getMaintenanceState();
  if (!state.active) return next();
  if (req.user) {
    const access = getUserAccess(req.user.id);
    if (access.permissions.length > 0) return next(); // staff/owner emergency access
  }
  // Allow auth endpoints so owners can sign in during maintenance
  if (req.path.startsWith('/auth/')) return next();
  return res.status(503).json({
    error: state.message,
    code: 'MAINTENANCE'
  });
});

// Public HTML maintenance gate (API serves the flag; page renders it)
app.get('/api/system/maintenance', (req, res) => {
  res.json({ maintenance: getMaintenanceState() });
});

// ============================================
// STATIC FILES (hardened)
// ----------------------------------------
// express.static serves the repo ROOT. That must never expose the
// database, server source, tests, git metadata, env files, node
// modules or dependency manifests (§20/§21). Deny-list runs BEFORE
// static and returns 404 (no existence disclosure).
// ============================================
const STATIC_DENY = new RegExp(
  '^/(data|server|test|node_modules)(/|$)' +   // DB files, backend source, tests, deps
  '|^/\\.' +                                  // .env, .env.example, .git/*, .gitignore, .vercel/*
  '|^/package(-lock)?\\.json$' +               // dependency manifests
  '|^/start\\.bat$' +                          // local launcher (env paths)
  '|\\.(md|db|db-shm|db-wal|sqlite|sqlite3|log|bak)$', // data files + internal docs, anywhere
  'i'
);
app.use((req, res, next) => {
  let p = req.path;
  try { p = decodeURIComponent(p); } catch (_) { /* malformed encoding -> deny */ }
  if (STATIC_DENY.test(p)) return res.status(404).send('Not Found');
  next();
});

app.use(express.static(path.join(__dirname, '..'), { extensions: ['html'] }));

// ============================================
// API ROUTES — auto-loaded from server/routes/
// ============================================

const routesDir = path.join(__dirname, 'routes');
const routeFiles = fs.existsSync(routesDir)
  ? fs.readdirSync(routesDir).filter(f => f.endsWith('.js')).sort()
  : [];

// Shared context for route modules
const ctx = {
  db, requireAuth, optionalAuth, requirePermission, requireRole,
  requireOwner, requirePrimaryOwner, checkPrimaryOwnerProtection,
  getUserAccess, invalidateUser
};

for (const file of routeFiles) {
  try {
    const mod = require(path.join(routesDir, file));
    if (typeof mod === 'function') {
      mod(app, ctx);
      console.log(`[ROUTE] loaded ${file}`);
    }
  } catch (err) {
    console.error(`[ROUTE] failed to load ${file}:`, err.message);
    logError({ endpoint: `/api (${file})`, method: 'LOAD', type: 'route_load', status: 500, message: err.message });
  }
}

// ============================================
// HEALTH (public, honest statuses)
// ============================================

app.get('/api/health', (req, res) => {
  let database = 'DISCONNECTED';
  try {
    db.prepare('SELECT 1 as t').get();
    database = 'CONNECTED';
  } catch (err) {
    database = 'ERROR';
  }
  res.json({
    status: database === 'CONNECTED' ? 'ok' : 'degraded',
    environment: process.env.NODE_ENV || 'LOCAL_DEVELOPMENT',
    database,
    // Required configuration status — booleans/labels only, never secret values
    config: {
      session_store: 'sqlite-persistent',
      oauth: (process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) ? 'configured' : 'OAUTH NOT CONFIGURED',
      rate_limit: process.env.RATE_LIMIT_DISABLED === 'true' ? 'disabled' : 'enabled',
      auto_backup: (process.env.NODE_ENV === 'production' && process.env.BACKUP_AUTO !== '0') ? 'daily' : 'off'
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'NOT FOUND', code: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logError({
    endpoint: req.originalUrl || req.url,
    method: req.method,
    type: err.name || 'error',
    status,
    message: err.message,
    requestId: req.requestId
  });
  if (res.headersSent) return next(err);
  if (status >= 500) return serverError(res, err);
  res.status(status).json({ error: err.message || 'Request failed', code: 'REQUEST_ERROR' });
});

// ============================================
// AUTO BACKUP (production, real files on the persistent volume)
// ----------------------------------------
// Daily VACUUM INTO <data>/backups/ (non-destructive), keeps 14 days
// of files. Records are inserted into the backups table (created_by
// NULL = system job). Manual backups still live at /api/owner/backups.
// ============================================
function autoBackup() {
  try {
    const dataDir = path.dirname(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'booyahx.db'));
    const backupDir = path.join(dataDir, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `booyahx-auto-${stamp}.db`;
    const dest = path.join(backupDir, filename);

    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    const size = fs.statSync(dest).size;

    const id = db.makeId('BKP');
    db.prepare('INSERT INTO backups (id, filename, size_bytes, type, status, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, filename, size, 'full', 'completed', null);

    // Prune backup FILES older than 14 days (table records are kept)
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(backupDir)) {
      try {
        const p = path.join(backupDir, f);
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch (_) { /* ignore single prune failure */ }
    }
    console.log(`[BACKUP] auto backup ok: ${filename} (${size} bytes)`);
  } catch (err) {
    console.error('[BACKUP] auto backup FAILED:', err.message);
  }
}

if (process.env.NODE_ENV === 'production' && process.env.BACKUP_AUTO !== '0') {
  setTimeout(autoBackup, 5000); // first backup shortly after boot
  const backupTimer = setInterval(autoBackup, 24 * 60 * 60 * 1000);
  if (backupTimer.unref) backupTimer.unref();
}

// ============================================
// START
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('  BOOYAHX server running');
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Owner:   http://localhost:${PORT}/owner/login.html`);
  console.log(`  API:     http://localhost:${PORT}/api`);
  console.log(`  Env:     ${process.env.NODE_ENV || 'LOCAL_DEVELOPMENT'}`);
  console.log(`  Routes:  ${routeFiles.length} modules loaded`);
  console.log('');
});

module.exports = app;
