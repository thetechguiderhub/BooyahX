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

// ============================================
// SECURITY MIDDLEWARE
// ============================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
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
// SESSIONS
// ============================================

app.use(session({
  name: 'booyahx.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
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
// STATIC FILES
// ============================================

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
