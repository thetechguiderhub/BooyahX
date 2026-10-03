/* ============================================
   BOOYAHX — PERSISTENT SESSION STORE (SQLite)
   ----------------------------------------
   express-session's default MemoryStore loses all
   sessions on restart and does NOT persist across
   serverless instances. This store keeps sessions
   in the project database (user_sessions table) so
   sign-in state survives restarts and navigation.

   NOTE (deployment honesty): the database file lives
   on a persistent Railway volume (/app/data), so
   sessions genuinely survive backend restarts,
   redeploys and cold starts. Auth state is always
   served by the server (never localStorage).
   ============================================ */

const { Store } = require('express-session');
const crypto = require('crypto');

class SqliteSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db;
    // Sweep expired sessions roughly every 10 minutes (real cleanup, not fake data)
    this._timer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  sweep() {
    try {
      this.db.prepare('DELETE FROM user_sessions WHERE expires < ?').run(Date.now());
    } catch (_) { /* non-fatal */ }
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires FROM user_sessions WHERE sid = ?').get(sid);
      if (!row || row.expires < Date.now()) {
        if (row) { try { this.db.prepare('DELETE FROM user_sessions WHERE sid = ?').run(sid); } catch (_) {} }
        return cb();
      }
      let sess;
      try { sess = JSON.parse(row.data); } catch (_) { return cb(); }
      cb(null, sess);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      // Default expiry mirrors the cookie maxAge (8h) when absent
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 8 * 60 * 60 * 1000;
      const expires = (sess.cookie && sess.cookie.expires && Date.parse(sess.cookie.expires)) || (Date.now() + maxAge);
      this.db.prepare(`
        INSERT INTO user_sessions (sid, data, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires
      `).run(sid, JSON.stringify(sess), expires);
      if (cb) cb();
    } catch (err) { if (cb) cb(err); }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM user_sessions WHERE sid = ?').run(sid);
      if (cb) cb();
    } catch (err) { if (cb) cb(err); }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = SqliteSessionStore;
