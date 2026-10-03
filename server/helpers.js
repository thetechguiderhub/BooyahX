/* ============================================
   BOOYAHX — SERVER HELPERS
   Validation, responses, notifications,
   maintenance state, idempotency.
   ============================================ */

const db = require('./db');

// ---------- Response helpers ----------

function badRequest(res, message) {
  return res.status(400).json({ error: message, code: 'BAD_REQUEST' });
}
function notFound(res, what = 'Resource') {
  return res.status(404).json({ error: `${what.toUpperCase()} NOT FOUND`, code: 'NOT_FOUND' });
}
function denied(res, message = 'ACCESS DENIED') {
  return res.status(403).json({ error: message, code: 'ACCESS_DENIED' });
}
function conflict(res, message) {
  return res.status(409).json({ error: message, code: 'CONFLICT' });
}
function serverError(res, err) {
  console.error('API error:', err && err.message);
  return res.status(500).json({ error: 'INTERNAL SERVER ERROR', code: 'SERVER_ERROR' });
}

// ---------- Validation ----------

function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) return `Missing required fields: ${missing.join(', ')}`;
  return null;
}

function asInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, maxLen = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

const SLUG_RE = /^[a-z0-9-]+$/;
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------- Settings ----------

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value, updatedBy = null) {
  db.prepare(`
    INSERT INTO platform_settings (key, value, updated_by, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')
  `).run(key, String(value), updatedBy);
}

/**
 * Server-authoritative maintenance state.
 * Returns { active, message, start, end }.
 * Emergency access: PRIMARY_OWNER / OWNER sessions bypass (checked by caller).
 */
function getMaintenanceState() {
  const enabled = getSetting('maintenance_mode', 'false') === 'true';
  const message = getSetting('maintenance_message', 'BOOYAHX IS CURRENTLY UNDER MAINTENANCE');
  const start = getSetting('maintenance_start', '');
  const end = getSetting('maintenance_end', '');

  if (!enabled) return { active: false, message, start, end };

  const now = Date.now();
  if (start && now < Date.parse(start)) return { active: false, message, start, end };
  if (end && now > Date.parse(end)) return { active: false, message, start, end };
  return { active: true, message, start, end };
}

// ---------- Notifications ----------

function notify(userId, title, message, type = 'info') {
  try {
    db.prepare('INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)')
      .run(db.makeId('NOT'), userId, cleanText(title, 200), cleanText(message, 1000), type);
  } catch (err) {
    console.error('Notification failed:', err.message);
  }
}

// ---------- Wallet (server-side, atomic) ----------

/**
 * Change a wallet balance inside a transaction and record it.
 * Never trust client-provided balances.
 * opts: { type, amount, reference, status, idempotencyKey, allowNegative }
 * Returns { ok, transactionId, balance } or { ok:false, error }.
 */
function applyWalletChange(userId, opts) {
  const { type, amount, reference = null, status = 'completed', idempotencyKey = null, allowNegative = false } = opts;

  return db.tx(() => {
    if (idempotencyKey) {
      const existing = db.prepare('SELECT id FROM transactions WHERE idempotency_key = ?').get(idempotencyKey);
      if (existing) return { ok: true, duplicate: true, transactionId: existing.id };
    }

    const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found for user');

    const newBalance = wallet.balance + amount;
    if (newBalance < 0 && !allowNegative) {
      const err = new Error('Insufficient coins');
      err.code = 'INSUFFICIENT_COINS';
      throw err;
    }

    const txnId = db.makeId('TXN');
    db.prepare('UPDATE wallets SET balance = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(newBalance, userId);
    db.prepare('INSERT INTO transactions (id, user_id, type, amount, reference, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(txnId, userId, type, amount, reference, status, idempotencyKey);

    return { ok: true, transactionId: txnId, balance: newBalance };
  });
}

// ---------- Tournament status (server time authoritative) ----------

const STATUS_FLOW = {
  open: ['upcoming', 'waiting', 'almost_full', 'full'],
  closedForJoin: ['starting', 'live', 'results_pending', 'completed', 'cancelled']
};

function isJoinable(tournament) {
  if (!STATUS_FLOW.open.includes(tournament.status)) return false;
  const now = Date.now();
  if (tournament.registration_opens_at) {
    const opens = Date.parse(tournament.registration_opens_at);
    if (Number.isFinite(opens) && now < opens) return false;
  }
  if (tournament.registration_closes_at) {
    const closes = Date.parse(tournament.registration_closes_at);
    if (Number.isFinite(closes) && now > closes) return false;
  }
  return true;
}

/**
 * Automatic status transitions based on server time.
 * Returns true if the row was updated.
 */
function transitionTournamentStatus(t) {
  const now = Date.now();
  const start = Date.parse(t.start_time);
  const end = t.ends_at ? Date.parse(t.ends_at) : NaN;

  let next = null;
  if (['completed', 'cancelled', 'results_pending', 'live'].includes(t.status)) return false;

  if (Number.isFinite(start)) {
    if (now >= start && t.status !== 'starting' && t.status !== 'live') {
      next = 'starting';
    }
  }
  if (Number.isFinite(end) && now >= end && (t.status === 'starting' || t.status === 'live')) {
    next = 'results_pending';
  }

  if (next && next !== t.status) {
    db.prepare('UPDATE tournaments SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, t.id);
    return true;
  }
  return false;
}

/** Recompute open-status tournaments for real capacity (never hardcode counts). */
function refreshTournamentCapacity(tournamentId) {
  const t = db.prepare('SELECT id, status, player_limit FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t) return;
  if (!STATUS_FLOW.open.includes(t.status)) return;

  const count = db.prepare(
    'SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ? AND status = \'registered\''
  ).get(tournamentId).c;

  let next = 'upcoming';
  if (count >= t.player_limit) next = 'full';
  else if (t.player_limit > 0 && count >= Math.ceil(t.player_limit * 0.8)) next = 'almost_full';
  else if (count > 0) next = 'waiting';

  if (next !== t.status) {
    db.prepare('UPDATE tournaments SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, tournamentId);
  }
}

// ---------- Error logging (safe — never logs secrets) ----------

function logError({ endpoint, method, type, status, message, requestId }) {
  try {
    const safe = cleanText(String(message), 500)
      .replace(/password["']?\s*[:=]\s*[^,\s}]+/gi, 'password=[REDACTED]')
      .replace(/token["']?\s*[:=]\s*[^,\s}]+/gi, 'token=[REDACTED]')
      .replace(/secret["']?\s*[:=]\s*[^,\s}]+/gi, 'secret=[REDACTED]');
    db.prepare('INSERT INTO error_logs (id, endpoint, method, type, status, message, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(db.makeId('ERR'), cleanText(endpoint, 200), cleanText(method, 10), cleanText(type, 50), status || null, safe, requestId || null);
  } catch (_) { /* never throw from logging */ }
}

// ---------- Email abstraction ----------

function emailConfigured() {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
}

/**
 * Queue an email event. If SMTP is not configured, records
 * status 'not_configured' and returns { sent:false, reason }.
 * Never claims an email was sent when it was not.
 */
function sendEmail(userId, toAddress, eventKey, variables = {}) {
  const tpl = db.prepare('SELECT subject, body, enabled FROM email_templates WHERE event_key = ?').get(eventKey);
  const subject = tpl ? tpl.subject : eventKey;
  const body = tpl ? tpl.body : '';

  if (!tpl || !tpl.enabled) {
    return { sent: false, reason: 'Template disabled or missing' };
  }
  if (!emailConfigured()) {
    db.prepare('INSERT INTO email_logs (id, user_id, to_address, event_key, subject, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(db.makeId('EML'), userId || null, toAddress || '', eventKey, subject, 'not_configured', 'EMAIL SERVICE NOT CONFIGURED');
    return { sent: false, reason: 'EMAIL SERVICE NOT CONFIGURED' };
  }

  // Real SMTP delivery would go here when credentials exist.
  db.prepare('INSERT INTO email_logs (id, user_id, to_address, event_key, subject, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(db.makeId('EML'), userId || null, toAddress, eventKey, subject, 'queued');
  return { sent: false, reason: 'Queued for delivery' };
}

function renderTemplate(text, variables) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    variables[key] !== undefined ? String(variables[key]) : m
  );
}

module.exports = {
  badRequest, notFound, denied, conflict, serverError,
  requireFields, asInt, cleanText, slugify,
  getSetting, setSetting, getMaintenanceState,
  notify, applyWalletChange,
  isJoinable, transitionTournamentStatus, refreshTournamentCapacity,
  logError, emailConfigured, sendEmail, renderTemplate
};
