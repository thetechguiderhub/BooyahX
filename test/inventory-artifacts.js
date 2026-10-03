/* Inventory of smoke-test artifacts left in the DB (pre-cleanup report). */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const q = (label, sql) => {
  try { console.log(label + ': ' + JSON.stringify(db.prepare(sql).all())); }
  catch (e) { console.log(label + ': ERR ' + e.message); }
};

q('users', "SELECT username, email, status FROM users ORDER BY created_at");
q('tournaments', "SELECT id, name, status FROM tournaments");
q('news', "SELECT id, title, status FROM news");
q('banners', "SELECT id, title, status FROM banners");
q('events', "SELECT id, title, status FROM events");
q('updates', "SELECT id, title, status FROM updates");
q('api_keys', "SELECT id, name, created_by FROM api_keys");
q('promo_codes', "SELECT code, created_by FROM promo_codes");
q('deposits', "SELECT id, user_id, amount_coins, status FROM deposits");
q('withdrawals', "SELECT id, user_id, amount_coins, status FROM withdrawals");
q('results', "SELECT id, tournament_id FROM tournament_results");
q('audit_tail', "SELECT action, entity, entity_id FROM audit_logs ORDER BY rowid DESC LIMIT 8");
q('settings_maint', "SELECT key, value FROM settings WHERE key LIKE 'maintenance%'");
q('error_logs', "SELECT id, endpoint FROM error_logs");
q('notifications', "SELECT COUNT(*) AS c FROM notifications");
q('wallets', "SELECT user_id, balance FROM wallets");
q('transactions', "SELECT id, user_id, type, amount, status FROM transactions");
q('polls', "SELECT id, question, status FROM polls");
q('support_tickets', "SELECT id, subject FROM support_tickets");
q('feedback', "SELECT id, rating, category FROM feedback");
