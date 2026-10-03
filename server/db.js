/* ============================================
   BOOYAHX — DATABASE LAYER
   SQLite with node:sqlite (Node.js 24+)
   Full schema: RBAC, tournaments, economy,
   content, support, ops.
   EMPTY IS BETTER THAN FAKE.
   ============================================ */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'booyahx.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node:sqlite rejects `undefined` bind values ("Provided value cannot be
// bound"). Request handlers routinely pass optional body fields, so coerce
// undefined -> NULL at the statement boundary instead of crashing the query.
const rawPrepare = db.prepare.bind(db);
db.prepare = function prepare(sql) {
  const stmt = rawPrepare(sql);
  for (const method of ['get', 'run', 'all', 'iterate']) {
    const fn = stmt[method];
    if (typeof fn !== 'function') continue;
    stmt[method] = function boundWithNulls(...args) {
      return fn.apply(stmt, args.map(a => (a === undefined ? null : a)));
    };
  }
  return stmt;
};

// ============================================
// TRANSACTION HELPER
// node:sqlite has no db.transaction() — provide one.
// ============================================

let txDepth = 0;
db.tx = function tx(fn) {
  if (txDepth > 0) {
    // Nested: run inline (outer transaction governs)
    return fn();
  }
  db.exec('BEGIN');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    txDepth--;
  }
};

// ============================================
// ID HELPERS
// ============================================

function makeId(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
db.makeId = makeId;

// ============================================
// AUDIT HELPER (server-side, never trusts client)
// ============================================

function audit(actorId, action, targetType, targetId, metadata) {
  try {
    db.prepare('INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?)')
      .run(makeId('LOG'), actorId || null, action, targetType || null, targetId || null, metadata ? JSON.stringify(metadata) : null);
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}
db.audit = audit;

// ============================================
// SCHEMA
// ============================================

function initializeDatabase() {
  db.exec(`
    -- ---------- CORE IDENTITY ----------
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'restricted', 'disabled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      avatar TEXT,
      bio TEXT,
      preferences TEXT DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- RBAC ----------
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general'
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      assigned_by TEXT REFERENCES users(id),
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role_id)
    );

    -- ---------- SESSIONS / SECURITY ----------
    CREATE TABLE IF NOT EXISTS login_history (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      login_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip TEXT,
      user_agent TEXT,
      device TEXT,
      browser TEXT,
      status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS security_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
      resolved_by TEXT REFERENCES users(id),
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('phone', 'identity')),
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected')),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- TOURNAMENTS ----------
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      game TEXT NOT NULL,
      mode TEXT NOT NULL,
      format TEXT NOT NULL,
      entry_cost INTEGER NOT NULL DEFAULT 0,
      player_limit INTEGER NOT NULL,
      team_size INTEGER NOT NULL DEFAULT 1,
      start_time TEXT NOT NULL,
      ends_at TEXT,
      registration_opens_at TEXT,
      registration_closes_at TEXT,
      duration_minutes INTEGER,
      category_id TEXT,
      tags TEXT DEFAULT '[]',
      template_id TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'waiting', 'almost_full', 'full', 'starting', 'live', 'results_pending', 'completed', 'cancelled')),
      rules TEXT,
      description TEXT,
      banner TEXT,
      reward_1st INTEGER NOT NULL DEFAULT 0,
      reward_2nd INTEGER NOT NULL DEFAULT 0,
      reward_3rd INTEGER NOT NULL DEFAULT 0,
      reward_other INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournament_registrations (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered', 'cancelled', 'disqualified')),
      UNIQUE(tournament_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tag TEXT,
      logo TEXT,
      captain_id TEXT REFERENCES users(id),
      description TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by TEXT REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'revoked')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      round_name TEXT NOT NULL,
      match_number INTEGER NOT NULL,
      slot1_label TEXT,
      slot1_ref TEXT,
      slot2_label TEXT,
      slot2_ref TEXT,
      winner_slot INTEGER CHECK(winner_slot IN (1, 2)),
      score1 INTEGER,
      score2 INTEGER,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'live', 'completed', 'cancelled')),
      scheduled_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tournament_id, round_number, match_number)
    );

    CREATE TABLE IF NOT EXISTS tournament_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      game TEXT NOT NULL,
      mode TEXT NOT NULL,
      format TEXT NOT NULL,
      entry_cost INTEGER NOT NULL DEFAULT 0,
      player_limit INTEGER NOT NULL,
      team_size INTEGER NOT NULL DEFAULT 1,
      duration_minutes INTEGER,
      schedule TEXT,
      category TEXT,
      tags TEXT DEFAULT '[]',
      rewards TEXT DEFAULT '{}',
      rules TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'tournament' CHECK(type IN ('tournament', 'event', 'news')),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournament_tags (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (tournament_id, tag_id)
    );

    -- ---------- SERIES / LEAGUES ----------
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      season TEXT,
      description TEXT,
      start_at TEXT,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed')),
      points_config TEXT DEFAULT '{}',
      champion_user_id TEXT REFERENCES users(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS series_tournaments (
      series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (series_id, tournament_id)
    );

    -- ---------- ECONOMY ----------
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('deposit', 'tournament_entry', 'reward', 'withdrawal', 'bonus', 'adjustment', 'daily_reward', 'refund', 'purchase')),
      amount INTEGER NOT NULL,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'processing', 'rejected', 'cancelled')),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coin_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      coins INTEGER NOT NULL,
      price_pkr REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id TEXT REFERENCES coin_packages(id),
      package_name TEXT NOT NULL,
      amount REAL NOT NULL,
      coins INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('easypaisa', 'jazzcash', 'bank')),
      reference TEXT NOT NULL,
      proof TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'under_review', 'verified', 'rejected')),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      review_notes TEXT,
      transaction_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coins INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('easypaisa', 'jazzcash', 'bank')),
      destination_info TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'under_review', 'approved', 'processing', 'paid', 'rejected')),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      paid_at TEXT,
      review_notes TEXT,
      transaction_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      coins INTEGER NOT NULL,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id TEXT PRIMARY KEY,
      promo_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(promo_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS daily_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      claim_date TEXT NOT NULL,
      coins INTEGER NOT NULL,
      streak INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, claim_date)
    );

    CREATE TABLE IF NOT EXISTS vip_tiers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      level INTEGER NOT NULL,
      benefits TEXT DEFAULT '[]',
      price_coins INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_vip (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier_id TEXT NOT NULL REFERENCES vip_tiers(id),
      source TEXT NOT NULL DEFAULT 'manual',
      payment_ref TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked')),
      starts_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'qualified', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      qualified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS referral_commissions (
      id TEXT PRIMARY KEY,
      referral_id TEXT NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
      referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'payable', 'paid', 'rejected')),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- RESULTS / COMPETITIVE ----------
    CREATE TABLE IF NOT EXISTS tournament_results (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      result TEXT NOT NULL,
      reward INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      reward_transaction_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tournament_id, user_id, team_id, position)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      criteria TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, achievement_id)
    );

    -- ---------- CONTENT ----------
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      banner TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      entry INTEGER NOT NULL DEFAULT 0,
      reward TEXT,
      rules TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      thumbnail TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
      published_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS updates (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      features TEXT DEFAULT '[]',
      improvements TEXT DEFAULT '[]',
      fixes TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
      published_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS banners (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      image TEXT,
      button_text TEXT,
      link TEXT,
      start_at TEXT,
      end_at TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS popups (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'announcement',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      button_text TEXT,
      link TEXT,
      start_at TEXT,
      end_at TEXT,
      frequency TEXT NOT NULL DEFAULT 'once' CHECK(frequency IN ('once', 'every_visit', 'daily')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sponsors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,
      website TEXT,
      description TEXT,
      start_at TEXT,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sponsor_tournaments (
      sponsor_id TEXT NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      PRIMARY KEY (sponsor_id, tournament_id)
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'tournament' CHECK(type IN ('tournament', 'match', 'player')),
      title TEXT NOT NULL,
      description TEXT,
      media_url TEXT,
      tournament_id TEXT REFERENCES tournaments(id) ON DELETE SET NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      description TEXT,
      start_at TEXT,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'closed')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(poll_id, user_id)
    );

    -- ---------- SUPPORT / FEEDBACK / MODERATION ----------
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      ticket_code TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'pending', 'resolved', 'closed')),
      assigned_to TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      category TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewing', 'resolved', 'rejected')),
      response TEXT,
      responded_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('cheating', 'player_report', 'tournament_dispute', 'payment_issue', 'withdrawal_issue', 'technical_issue', 'content', 'other')),
      target TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewing', 'resolved', 'rejected')),
      assigned_to TEXT REFERENCES users(id),
      resolution TEXT,
      moderator_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- NOTIFICATIONS / EMAIL ----------
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY,
      event_key TEXT UNIQUE NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      to_address TEXT NOT NULL,
      event_key TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL DEFAULT 'not_configured' CHECK(status IN ('queued', 'sent', 'failed', 'not_configured')),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- OPS ----------
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      size_bytes INTEGER,
      type TEXT NOT NULL DEFAULT 'full',
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'failed')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS error_logs (
      id TEXT PRIMARY KEY,
      endpoint TEXT,
      method TEXT,
      type TEXT,
      status INTEGER,
      message TEXT NOT NULL,
      request_id TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- EVENTS: PURCHASABLE ITEMS (real purchases only) ----------
    CREATE TABLE IF NOT EXISTS event_items (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL DEFAULT 'item' CHECK(kind IN ('item','avatar','frame','badge','template','decoration')),
      asset_url TEXT,
      price_coins INTEGER NOT NULL DEFAULT 0 CHECK(price_coins >= 0),
      stock INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES event_items(id) ON DELETE CASCADE,
      event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      price_coins INTEGER NOT NULL,
      transaction_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, item_id)
    );

    -- ---------- OAUTH ACCOUNT LINKING (real provider identities) ----------
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('google')),
      provider_account_id TEXT NOT NULL,
      email TEXT,
      linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, provider_account_id)
    );

    -- ---------- PERSISTENT SESSIONS (survive restarts; server-authoritative) ----------
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires);

    -- ---------- OFFICIAL TEAM (real assignments only) ----------
    -- Position catalog: definitions only (like roles). No fake members seeded.
    CREATE TABLE IF NOT EXISTS official_team_positions (
      display_role TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 100
    );

    -- Assignments: user_id MUST reference a real user. Available = no active row.
    CREATE TABLE IF NOT EXISTS official_team_members (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_role TEXT NOT NULL REFERENCES official_team_positions(display_role),
      display_order INTEGER NOT NULL DEFAULT 100,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, display_role)
    );

    -- ---------- INDEXES ----------
    CREATE INDEX IF NOT EXISTS idx_official_team_user ON official_team_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
    CREATE INDEX IF NOT EXISTS idx_tournaments_start_time ON tournaments(start_time);
    CREATE INDEX IF NOT EXISTS idx_registrations_tournament ON tournament_registrations(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_user ON tournament_registrations(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_results_tournament ON tournament_results(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_results_user ON tournament_results(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_matches_tournament ON tournament_matches(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
  `);

  // ---- COLUMN MIGRATIONS for pre-existing databases ----
  const migrations = [
    ['transactions', 'idempotency_key', 'TEXT'],
    ['teams', 'tag', 'TEXT'],
    ['teams', 'logo', 'TEXT'],
    ['teams', 'captain_id', 'TEXT'],
    ['teams', 'description', 'TEXT'],
    ['reports', 'moderator_notes', 'TEXT'],
    ['deposits', 'package_id', 'TEXT'],
    ['deposits', 'review_notes', 'TEXT'],
    ['deposits', 'transaction_id', 'TEXT'],
    ['withdrawals', 'review_notes', 'TEXT'],
    ['withdrawals', 'transaction_id', 'TEXT'],
    ['tournaments', 'ends_at', 'TEXT'],
    ['tournaments', 'registration_opens_at', 'TEXT'],
    ['tournaments', 'registration_closes_at', 'TEXT'],
    ['tournaments', 'duration_minutes', 'INTEGER'],
    ['tournaments', 'category_id', 'TEXT'],
    ['tournaments', 'tags', 'TEXT DEFAULT \'[]\''],
    ['tournaments', 'template_id', 'TEXT'],
    ['tournaments', 'featured', 'INTEGER NOT NULL DEFAULT 0'],
    ['tournament_results', 'reward_transaction_id', 'TEXT'],
    ['withdrawals', 'payout_reference', 'TEXT'],
    ['news', 'event_id', 'TEXT'],
    ['news', 'banner', 'TEXT'],
    ['news', 'expires_at', 'TEXT']
  ];
  for (const [table, column, type] of migrations) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); }
      catch (err) { console.error(`Migration failed ${table}.${column}:`, err.message); }
    }
  }

  // ---- TABLE REBUILDS for stale CHECK/FK definitions ----
  // SQLite cannot ALTER a CHECK constraint or repair a broken FK reference,
  // so rebuild affected tables while preserving their rows.
  function tableSql(name) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return row ? row.sql : '';
  }

  function rebuildTable(name, fixFn, filterFn) {
    const orig = tableSql(name);
    if (!orig) return false;
    const fixed = fixFn(orig);
    if (!fixed || fixed === orig) return false;

    const cols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
    const colList = cols.join(', ');
    const wasOn = db.prepare('PRAGMA foreign_keys').get();
    let legacyWasOn = null;
    try { legacyWasOn = db.prepare('PRAGMA legacy_alter_table').get(); } catch (_) {}
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      // Prevent RENAME from rewriting FK references in OTHER tables —
      // that is exactly what broke "teams_old" references before.
      try { db.exec('PRAGMA legacy_alter_table = ON'); } catch (_) {}
      db.exec(`ALTER TABLE ${name} RENAME TO ${name}_rebuild_tmp`);
      db.exec(fixed);
      const where = filterFn ? ` WHERE ${filterFn}` : '';
      db.exec(`INSERT INTO ${name} (${colList}) SELECT ${colList} FROM ${name}_rebuild_tmp${where}`);
      db.exec(`DROP TABLE ${name}_rebuild_tmp`);
      console.log(`[MIGRATE] rebuilt table ${name}`);
      return true;
    } catch (err) {
      console.error(`[MIGRATE] rebuild of ${name} failed:`, err.message);
      try {
        const tmp = tableSql(`${name}_rebuild_tmp`);
        if (tmp) {
          db.exec(`DROP TABLE IF EXISTS ${name}`);
          db.exec(`ALTER TABLE ${name}_rebuild_tmp RENAME TO ${name}`);
        }
      } catch (_) { /* keep original if rollback fails */ }
      return false;
    } finally {
      try { db.exec('PRAGMA legacy_alter_table = OFF'); } catch (_) {}
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // 1) transactions: older databases lack 'refund'/'daily_reward'/'purchase' types
  const rebuilt = [];
  if (rebuildTable('transactions',
    sql => sql.includes("'purchase'") ? null : sql.replace(
      "'daily_reward')",
      "'daily_reward', 'purchase')"
    ),
    "type IN ('deposit','tournament_entry','reward','withdrawal','bonus','adjustment','refund','daily_reward','purchase')"
  )) rebuilt.push('transactions');

  // 2) tables whose FK still points at the dropped "teams_old"
  //    (created by the earlier teams-nullable rename migration)
  for (const t of ['team_members', 'team_invites', 'tournament_results']) {
    if (rebuildTable(t, sql => /teams_old/.test(sql) ? sql.replace(/"teams_old"/g, '"teams"') : null)) {
      rebuilt.push(t);
    }
  }

  // 3) payment methods: add 'bank' (owner-config-gated, disabled by default)
  //    to the payment_method CHECK on deposits and withdrawals.
  for (const t of ['deposits', 'withdrawals']) {
    if (rebuildTable(t, sql => sql.includes("'bank'") ? null : sql.replace(
      "CHECK(payment_method IN ('easypaisa', 'jazzcash'))",
      "CHECK(payment_method IN ('easypaisa', 'jazzcash', 'bank'))"
    ))) rebuilt.push(t);
  }

  if (rebuilt.length) {
    // Rebuild drops indices defined on the old tables — recreate them.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
      CREATE INDEX IF NOT EXISTS idx_results_tournament ON tournament_results(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_results_user ON tournament_results(user_id);
      CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
      CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
    `);
  }

  // teams.tournament_id must be nullable for persistent CS teams.
  // Rebuild teams in place (does NOT rewrite inbound FK references,
  // unlike ALTER TABLE ... RENAME which breaks other tables' FKs).
  const teamsInfo = db.prepare(`SELECT "notnull" FROM pragma_table_info('teams') WHERE name='tournament_id'`).get();
  if (teamsInfo && teamsInfo.notnull === 1) {
    rebuildTable('teams', sql =>
      sql.replace('tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE',
                  'tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE')
    );
  }

  console.log('Database schema initialized');
}

// ============================================
// RBAC SEED: ROLES, PERMISSIONS, MAPPINGS
// (configuration, not fake data)
// ============================================

const ROLES = [
  ['PRIMARY_OWNER', 'Primary Owner', 'Highest authority. Cannot be removed or demoted by anyone else.'],
  ['OWNER', 'Owner', 'Platform owner with broad authority.'],
  ['DEVELOPER', 'Developer', 'Developer console and system tooling access.'],
  ['ADMIN', 'Admin', 'Full day-to-day management.'],
  ['MODERATOR', 'Moderator', 'Content moderation and reports.'],
  ['SUPPORT', 'Support', 'Support tickets and payment review assistance.'],
  ['TOURNAMENT_MANAGER', 'Tournament Manager', 'Tournaments, brackets, templates, series.'],
  ['FINANCE_MANAGER', 'Finance Manager', 'Deposits, withdrawals, wallet oversight.'],
  ['CONTENT_MANAGER', 'Content Manager', 'News, events, updates, banners, popups.'],
  ['COMMUNITY_MANAGER', 'Community Manager', 'Polls, feedback, highlights, sponsors.'],
  ['ANALYST', 'Analyst', 'Read-only analytics access.'],
  ['STAFF', 'Staff', 'Basic staff access.'],
  ['USER', 'User', 'Regular platform user.']
];

const PERMISSIONS = [
  // [key, description, category]
  ['dashboard.view', 'View owner dashboard', 'dashboard'],
  ['users.view', 'View users', 'users'],
  ['users.edit', 'Edit users', 'users'],
  ['users.suspend', 'Suspend/restore users', 'users'],
  ['users.bulk', 'Bulk user actions', 'users'],
  ['users.delete', 'Delete users', 'users'],
  ['roles.view', 'View roles and permissions', 'roles'],
  ['roles.manage', 'Assign/remove roles', 'roles'],
  ['staff.view', 'View staff team page', 'roles'],
  ['staff.manage', 'Manage staff accounts', 'roles'],
  ['tournaments.view', 'View tournaments', 'tournaments'],
  ['tournaments.create', 'Create tournaments', 'tournaments'],
  ['tournaments.edit', 'Edit tournaments', 'tournaments'],
  ['tournaments.cancel', 'Cancel tournaments', 'tournaments'],
  ['tournaments.publish', 'Publish tournaments', 'tournaments'],
  ['tournaments.templates', 'Manage tournament templates', 'tournaments'],
  ['tournaments.categories', 'Manage categories and tags', 'tournaments'],
  ['tournaments.brackets', 'Manage brackets', 'tournaments'],
  ['tournaments.series', 'Manage series/leagues', 'tournaments'],
  ['results.view', 'View results', 'results'],
  ['results.manage', 'Enter results', 'results'],
  ['results.publish', 'Publish results and rewards', 'results'],
  ['wallet.view', 'View wallets', 'wallet'],
  ['wallet.manage', 'Adjust wallets', 'wallet'],
  ['deposits.view', 'View deposits', 'wallet'],
  ['deposits.verify', 'Approve deposits', 'wallet'],
  ['deposits.reject', 'Reject deposits', 'wallet'],
  ['withdrawals.view', 'View withdrawals', 'wallet'],
  ['withdrawals.approve', 'Approve withdrawals', 'wallet'],
  ['withdrawals.reject', 'Reject withdrawals', 'wallet'],
  ['verification.view', 'View verifications', 'wallet'],
  ['verification.review', 'Review verifications', 'wallet'],
  ['events.view', 'View events', 'content'],
  ['events.manage', 'Manage events', 'content'],
  ['news.view', 'View news drafts', 'content'],
  ['news.manage', 'Manage news', 'content'],
  ['updates.view', 'View updates drafts', 'content'],
  ['updates.manage', 'Manage updates', 'content'],
  ['banners.manage', 'Manage banners', 'content'],
  ['popups.manage', 'Manage popups', 'content'],
  ['sponsors.manage', 'Manage sponsors', 'content'],
  ['highlights.manage', 'Manage highlights', 'content'],
  ['polls.manage', 'Manage polls', 'content'],
  ['reports.view', 'View reports', 'moderation'],
  ['reports.manage', 'Handle reports', 'moderation'],
  ['support.view', 'View all tickets', 'support'],
  ['support.manage', 'Reply/assign/close tickets', 'support'],
  ['feedback.view', 'View feedback', 'support'],
  ['feedback.manage', 'Respond to feedback', 'support'],
  ['leaderboard.manage', 'Manage leaderboard settings', 'competitive'],
  ['achievements.manage', 'Manage achievements', 'competitive'],
  ['teams.manage', 'Manage CS teams', 'competitive'],
  ['teams.view', 'View teams', 'competitive'],
  ['analytics.view', 'View analytics', 'analytics'],
  ['developer.view', 'View developer console', 'developer'],
  ['developer.manage', 'Developer console actions', 'developer'],
  ['apikeys.manage', 'Manage API keys', 'developer'],
  ['systemhealth.view', 'View system health', 'developer'],
  ['errors.view', 'View error logs', 'developer'],
  ['errors.manage', 'Resolve error logs', 'developer'],
  ['backup.manage', 'Create/restore backups', 'developer'],
  ['importexport.use', 'Import/export data', 'developer'],
  ['settings.view', 'View settings', 'settings'],
  ['settings.manage', 'Change settings', 'settings'],
  ['maintenance.manage', 'Control maintenance mode', 'settings'],
  ['email.manage', 'Manage email templates', 'settings'],
  ['audit.view', 'View audit logs', 'settings'],
  ['notifications.broadcast', 'Send broadcast notifications', 'settings'],
  ['promos.manage', 'Manage promo codes', 'wallet'],
  ['economy.manage', 'Manage packages, daily rewards, VIP', 'wallet'],
  ['affiliate.manage', 'Manage affiliate program', 'wallet'],

  // ---- Moderator dashboard permissions (explicit, scoped; no Owner/Developer powers) ----
  ['moderator.dashboard', 'Access the Moderator dashboard', 'moderator'],
  ['moderator.tournaments.view', 'View tournaments (Moderator)', 'moderator'],
  ['moderator.tournaments.create', 'Create tournaments (Moderator)', 'moderator'],
  ['moderator.tournaments.update', 'Edit/publish/close tournaments (Moderator)', 'moderator'],
  ['moderator.tournaments.delete', 'Cancel/delete tournaments (Moderator)', 'moderator'],
  ['moderator.events.view', 'View events (Moderator)', 'moderator'],
  ['moderator.events.create', 'Create events (Moderator)', 'moderator'],
  ['moderator.events.update', 'Edit events (Moderator)', 'moderator'],
  ['moderator.events.delete', 'Delete events (Moderator)', 'moderator'],
  ['moderator.news.view', 'View news (Moderator)', 'moderator'],
  ['moderator.news.create', 'Create news (Moderator)', 'moderator'],
  ['moderator.news.update', 'Edit news (Moderator)', 'moderator'],
  ['moderator.news.delete', 'Delete news (Moderator)', 'moderator'],
  ['moderator.coins.view', 'Search users/wallets (Moderator)', 'moderator'],
  ['moderator.coins.adjust', 'Add/remove BX Coins with reason (Moderator)', 'moderator'],
  ['moderator.money.view', 'View the Money live board', 'moderator']
];

// Role → permission keys. PRIMARY_OWNER gets '*' (all, including future).
const ROLE_PERMISSION_MAP = {
  PRIMARY_OWNER: ['*'],
  OWNER: ['*'],
  DEVELOPER: [
    'dashboard.view', 'developer.view', 'developer.manage', 'apikeys.manage',
    'systemhealth.view', 'errors.view', 'errors.manage', 'backup.manage',
    'importexport.use', 'settings.view', 'audit.view', 'tournaments.view',
    'users.view', 'roles.view', 'moderator.money.view'
  ],
  ADMIN: [
    'dashboard.view', 'users.view', 'users.edit', 'users.suspend', 'users.bulk',
    'roles.view', 'roles.manage', 'staff.view',
    'tournaments.view', 'tournaments.create', 'tournaments.edit', 'tournaments.cancel',
    'tournaments.publish', 'tournaments.templates', 'tournaments.categories',
    'tournaments.brackets', 'tournaments.series',
    'results.view', 'results.manage', 'results.publish',
    'wallet.view', 'deposits.view', 'deposits.verify', 'deposits.reject',
    'withdrawals.view', 'withdrawals.approve', 'withdrawals.reject',
    'verification.view', 'verification.review',
    'events.view', 'events.manage', 'news.view', 'news.manage',
    'updates.view', 'updates.manage', 'banners.manage', 'popups.manage',
    'sponsors.manage', 'highlights.manage', 'polls.manage',
    'reports.view', 'reports.manage', 'support.view', 'support.manage',
    'feedback.view', 'feedback.manage',
    'leaderboard.manage', 'achievements.manage', 'teams.view', 'teams.manage',
    'settings.view', 'audit.view', 'notifications.broadcast', 'promos.manage'
  ],
  MODERATOR: [
    'dashboard.view', 'users.view', 'tournaments.view', 'results.view',
    'reports.view', 'reports.manage', 'support.view', 'feedback.view',
    'feedback.manage', 'teams.view', 'polls.manage',
    // Moderator dashboard (scoped — no Owner/Developer administration)
    'moderator.dashboard',
    'moderator.tournaments.view', 'moderator.tournaments.create',
    'moderator.tournaments.update', 'moderator.tournaments.delete',
    'moderator.events.view', 'moderator.events.create',
    'moderator.events.update', 'moderator.events.delete',
    'moderator.news.view', 'moderator.news.create',
    'moderator.news.update', 'moderator.news.delete',
    'moderator.coins.view', 'moderator.coins.adjust',
    'moderator.money.view'
  ],
  SUPPORT: [
    'dashboard.view', 'users.view', 'deposits.view', 'withdrawals.view',
    'support.view', 'support.manage', 'feedback.view', 'verification.view'
  ],
  TOURNAMENT_MANAGER: [
    'dashboard.view', 'tournaments.view', 'tournaments.create', 'tournaments.edit',
    'tournaments.cancel', 'tournaments.publish', 'tournaments.templates',
    'tournaments.categories', 'tournaments.brackets', 'tournaments.series',
    'results.view', 'results.manage', 'teams.view', 'teams.manage'
  ],
  FINANCE_MANAGER: [
    'dashboard.view', 'wallet.view', 'deposits.view', 'deposits.verify',
    'deposits.reject', 'withdrawals.view', 'withdrawals.approve',
    'withdrawals.reject', 'verification.view', 'verification.review',
    'analytics.view', 'promos.manage', 'economy.manage'
  ],
  CONTENT_MANAGER: [
    'dashboard.view', 'events.view', 'events.manage', 'news.view', 'news.manage',
    'updates.view', 'updates.manage', 'banners.manage', 'popups.manage',
    'sponsors.manage', 'highlights.manage'
  ],
  COMMUNITY_MANAGER: [
    'dashboard.view', 'polls.manage', 'feedback.view', 'feedback.manage',
    'reports.view', 'highlights.manage', 'sponsors.manage', 'notifications.broadcast'
  ],
  ANALYST: ['dashboard.view', 'analytics.view', 'tournaments.view', 'users.view'],
  STAFF: ['dashboard.view', 'support.view', 'reports.view'],
  USER: []
};

function seedRbac() {
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (id, name, display_name, description) VALUES (?, ?, ?, ?)');
  const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (key, description, category) VALUES (?, ?, ?)');
  const insertRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const [name, display, desc] of ROLES) insertRole.run('role_' + name.toLowerCase(), name, display, desc);
  for (const [key, desc, cat] of PERMISSIONS) insertPerm.run(key, desc, cat);

  const getPermId = db.prepare('SELECT id FROM permissions WHERE key = ?');
  for (const [roleName, keys] of Object.entries(ROLE_PERMISSION_MAP)) {
    const roleId = 'role_' + roleName.toLowerCase();
    for (const key of keys) {
      if (key === '*') {
        // PRIMARY_OWNER/OWNER: grant every permission (dynamic, covers future keys)
        const all = db.prepare('SELECT id FROM permissions').all();
        for (const p of all) insertRolePerm.run(roleId, p.id);
      } else {
        const p = getPermId.get(key);
        if (p) insertRolePerm.run(roleId, p.id);
      }
    }
  }
}

// ============================================
// SEED PLATFORM CONFIG (definitions, not fake data)
// ============================================

function seedPlatformConfig() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)');
  const defaults = {
    platform_name: 'BOOYAHX',
    maintenance_mode: 'false',
    maintenance_message: 'BOOYAHX IS CURRENTLY UNDER MAINTENANCE',
    maintenance_start: '',
    maintenance_end: '',
    withdrawal_min_coins: '100',
    daily_reward_base: '5',
    daily_reward_streak_bonus: '2',
    referral_bonus_coins: '25',
    withdrawal_requires_verification: 'false',
    support_email: '',
    locale: 'en',

    // ---- Payment method availability (owner-configurable; no fake data) ----
    // JazzCash is the only currently configured method. Easypaisa and Bank are
    // COMING SOON until the owner configures them — enabled flags stay false.
    deposit_jazzcash_enabled: 'true',
    deposit_easypaisa_enabled: 'false',
    deposit_bank_enabled: 'false',
    withdraw_jazzcash_enabled: 'true',
    withdraw_easypaisa_enabled: 'false',
    withdraw_bank_enabled: 'false',

    // Real receiving account for JazzCash deposits (public information by
    // design — players must see where to send payment).
    jazzcash_account_name: 'Rubina Imran',
    jazzcash_account_number: '0322 4936337',

    // Status messages (pure display text; nothing auto-enables on a timer).
    easypaisa_status_message: 'Coming Soon',
    bank_status_message: 'Coming in 3 days'
  };
  for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

  // Coin packages (owner-configurable price list, not transactions)
  const pkgCount = db.prepare('SELECT COUNT(*) as c FROM coin_packages').get().c;
  if (pkgCount === 0) {
    const ins = db.prepare('INSERT INTO coin_packages (id, name, coins, price_pkr, sort_order) VALUES (?, ?, ?, ?, ?)');
    ins.run(makeId('PKG'), 'Starter Pack', 50, 200, 1);
    ins.run(makeId('PKG'), 'Standard Pack', 100, 450, 2);
    ins.run(makeId('PKG'), 'Pro Pack', 150, 700, 3);
    ins.run(makeId('PKG'), 'Elite Pack', 200, 1000, 4);
  }

  // Achievement definitions (definitions only — no fake unlocks)
  const achCount = db.prepare('SELECT COUNT(*) as c FROM achievements').get().c;
  if (achCount === 0) {
    const ins = db.prepare('INSERT INTO achievements (id, key, name, description, icon, criteria) VALUES (?, ?, ?, ?, ?, ?)');
    const defs = [
      ['first_win', 'First Win', 'Win your first tournament', '🥇', { type: 'wins', target: 1 }],
      ['wins_5', '5 Wins', 'Win 5 tournaments', '🏅', { type: 'wins', target: 5 }],
      ['wins_10', '10 Wins', 'Win 10 tournaments', '🏆', { type: 'wins', target: 10 }],
      ['wins_25', '25 Wins', 'Win 25 tournaments', '👑', { type: 'wins', target: 25 }],
      ['wins_50', '50 Wins', 'Win 50 tournaments', '💎', { type: 'wins', target: 50 }],
      ['first_tournament', 'First Tournament', 'Play your first tournament', '🎯', { type: 'tournaments', target: 1 }],
      ['tournaments_10', '10 Tournaments', 'Play 10 tournaments', '🎮', { type: 'tournaments', target: 10 }],
      ['tournaments_25', '25 Tournaments', 'Play 25 tournaments', '⚡', { type: 'tournaments', target: 25 }],
      ['cs_champion', 'CS Champion', 'Win a Clash Squad tournament', '🔫', { type: 'mode_win', mode: 'Clash Squad' }],
      ['br_champion', 'BR Champion', 'Win a Battle Royale tournament', '🪂', { type: 'mode_win', mode: 'Battle Royale' }],
      ['veteran', 'Tournament Veteran', 'Play 50 tournaments', '🎖️', { type: 'tournaments', target: 50 }],
      ['streak_3', 'Winning Streak', 'Win 3 tournaments in a row', '🔥', { type: 'win_streak', target: 3 }]
    ];
    for (const [key, name, desc, icon, criteria] of defs) {
      ins.run(makeId('ACH'), key, name, desc, icon, JSON.stringify(criteria));
    }
  }

  // Default email templates (enabled flags exist; sending reports NOT CONFIGURED)
  const emailCount = db.prepare('SELECT COUNT(*) as c FROM email_templates').get().c;
  if (emailCount === 0) {
    const ins = db.prepare('INSERT INTO email_templates (id, event_key, subject, body) VALUES (?, ?, ?, ?)');
    const defs = [
      ['signup', 'Welcome to BOOYAHX', 'Hi {{username}},\n\nYour BOOYAHX account is ready.'],
      ['tournament_joined', 'Tournament Joined: {{tournament_name}}', 'Hi {{username}},\n\nYou joined {{tournament_name}}.'],
      ['tournament_starting', 'Tournament Starting: {{tournament_name}}', 'Hi {{username}},\n\n{{tournament_name}} starts soon.'],
      ['tournament_completed', 'Tournament Completed: {{tournament_name}}', 'Hi {{username}},\n\n{{tournament_name}} has completed.'],
      ['result_published', 'Results Published: {{tournament_name}}', 'Hi {{username}},\n\nResults for {{tournament_name}} are live.'],
      ['deposit_update', 'Deposit {{status}}', 'Hi {{username}},\n\nYour deposit of {{amount}} BX Coins is {{status}}.'],
      ['withdrawal_update', 'Withdrawal {{status}}', 'Hi {{username}},\n\nYour withdrawal of {{amount}} BX Coins is {{status}}.'],
      ['security_alert', 'Security Alert', 'Hi {{username}},\n\nA security-relevant change occurred on your account.'],
      ['support_update', 'Support Ticket {{status}}', 'Hi {{username}},\n\nYour ticket {{ticket_code}} is {{status}}.']
    ];
    for (const [key, subject, body] of defs) ins.run(makeId('EML'), key, subject, body);
  }
}

// ============================================
// OWNER ACCOUNT SEED (real accounts, env-configured)
// Passwords come ONLY from environment variables.
// No hardcoded passwords anywhere in source.
// ============================================

function seedOwnerAccounts() {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, username, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWallet = db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, ?)');
  const insertUserRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)');
  const ensureProfile = db.prepare('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)');

  function upsertOwner(id, name, username, email, password, roleName) {
    const existing = db.prepare('SELECT id, password_hash FROM users WHERE id = ? OR email = ?').get(id, email);
    if (!existing) {
      if (!password) {
        // No password configured: generate a random one (never printed — set
        // PRIMARY_OWNER_PASSWORD / TEMPORARY_OWNER_PASSWORD in .env to regain access).
        password = crypto.randomBytes(18).toString('base64url');
        console.log(`[FIRST RUN] No password configured for ${email}. Set the matching *_OWNER_PASSWORD in .env — it will be applied on next startup.`);
      }
      const hash = bcrypt.hashSync(password, 12);
      insertUser.run(id, name, username, email, hash, roleName, 'active');
    } else if (password && !bcrypt.compareSync(password, existing.password_hash)) {
      // Env password differs from stored hash: rotate to the env value.
      const hash = bcrypt.hashSync(password, 12);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, existing.id);
      console.log(`[ENV] Rotated password for ${email} to value from environment.`);
    }
    const userId = existing ? existing.id : id;
    insertWallet.run(userId, 0);
    ensureProfile.run(userId);
    insertUserRole.run(userId, 'role_' + roleName.toLowerCase(), null);
  }

  upsertOwner(
    'OWN-001', 'Primary Owner', 'primary_owner',
    process.env.PRIMARY_OWNER_EMAIL || 'itxmeshadow1234@gmail.com',
    process.env.PRIMARY_OWNER_PASSWORD || '',
    'PRIMARY_OWNER'
  );
  upsertOwner(
    'OWN-002', 'Temporary Owner', 'temp_owner',
    process.env.TEMPORARY_OWNER_EMAIL || 'murtaza12@gmail.com',
    process.env.TEMPORARY_OWNER_PASSWORD || '',
    'OWNER'
  );
}

// ============================================
// OFFICIAL TEAM SEED (real accounts only)
// --------------------------------------------
// The Official Team is the BooyahX operating/build team — NOT player clans.
// - Display roles (Developer/Owner/Moderator/...) are presentation only and
//   NEVER replace the security RBAC role on the user account.
// - Only REAL users are ever assigned. If a real account does not exist yet,
//   its position simply stays "Available" — no fake/demo/sample users are
//   created and no fabricated assignments are stored.
// ============================================

const OFFICIAL_TEAM_POSITIONS = [
  ['DEVELOPER', 'Developer', 10],
  ['OWNER', 'Owner', 20],
  ['MODERATOR', 'Moderator', 30],
  ['ADMIN', 'Admin', 40],
  ['STAFF', 'Staff', 50],
  ['SUPPORT', 'Support', 60],
  ['TOURNAMENT_MANAGER', 'Tournament Manager', 70],
  ['FINANCE_MANAGER', 'Finance Manager', 80],
  ['CONTENT_MANAGER', 'Content Manager', 90],
  ['COMMUNITY_MANAGER', 'Community Manager', 100],
  ['ANALYST', 'Analyst', 110],
  ['OTHERS', 'Others', 120]
];

function seedOfficialTeam() {
  const insertPos = db.prepare('INSERT OR IGNORE INTO official_team_positions (display_role, title, display_order) VALUES (?, ?, ?)');
  for (const [role, title, order] of OFFICIAL_TEAM_POSITIONS) insertPos.run(role, title, order);

  // Official account-to-role mapping. Each entry resolves an EXISTING user by
  // email; if the user does not exist the position is left Available.
  const officialAssignments = [
    { email: process.env.PRIMARY_OWNER_EMAIL || 'itxmeshadow1234@gmail.com', display_role: 'DEVELOPER' },
    { email: process.env.TEMPORARY_OWNER_EMAIL || 'murtaza12@gmail.com', display_role: 'OWNER' },
    { email: process.env.MODERATOR_EMAIL || 'bakihanma123@gmail.com', display_role: 'MODERATOR' }
  ];

  const orderOf = role => (OFFICIAL_TEAM_POSITIONS.find(p => p[0] === role) || [null, null, 100])[2];
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO official_team_members (id, user_id, display_role, display_order, active)
    VALUES (?, ?, ?, ?, 1)
  `);

  for (const { email, display_role } of officialAssignments) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) {
      console.log(`[OFFICIAL TEAM] ${email} has no user account yet; ${display_role} slot left Available.`);
      continue;
    }
    insertMember.run(makeId('OTM'), user.id, display_role, orderOf(display_role));
  }
}

// ============================================
// INIT
// ============================================

initializeDatabase();
seedRbac();
seedPlatformConfig();
seedOwnerAccounts();
seedOfficialTeam();

module.exports = db;
module.exports.OFFICIAL_TEAM_POSITIONS = OFFICIAL_TEAM_POSITIONS;
