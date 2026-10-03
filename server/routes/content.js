/* ============================================
   BOOYAHX — CONTENT ROUTES
   Events, news, updates, banners, popups,
   sponsors, highlights, polls.
   Public sees only published/active records.
   ============================================ */

module.exports = function contentRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, requirePermission } = ctx;
  const {
    badRequest, notFound, conflict, serverError,
    requireFields, asInt, cleanText, slugify, notify
  } = require('../helpers');

  function jsonArr(v, fallback = []) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : fallback; }
    catch (_) { return fallback; }
  }

  // Helper: generic draft CRUD registration to avoid repetition
  // aliasCreate/aliasUpdate/aliasDelete/aliasView: extra permission keys that
  // also grant access (e.g. scoped moderator.* permissions reuse this CRUD).
  function contentCrud(opts) {
    const { table, permView, permManage, publicWhere, orderField = 'created_at', searchCols = [], jsonCols = [],
            aliasView = null, aliasCreate = null, aliasUpdate = null, aliasDelete = null } = opts;

    // SQLite constraint violations are client input problems → honest 400, not a 500 crash
    const constraintError = err => {
      const m = String((err && err.message) || '');
      let match = m.match(/NOT NULL constraint failed: (\S+)/);
      if (match) return `Missing required field: ${match[1]}`;
      match = m.match(/CHECK constraint failed: (.+)/);
      if (match) return `Invalid value for: ${match[1]}`;
      match = m.match(/UNIQUE constraint failed: (.+)/);
      if (match) return `Already exists: ${match[1]}`;
      return null;
    };

    // Public list
    app.get(`/api/${table}`, optionalAuth, (req, res) => {
      try {
        const canSeeDrafts = req.user && req.perms && (req.perms.has('*') || req.perms.has(permView) || req.perms.has(permManage) || (aliasView && req.perms.has(aliasView)));
        const includeDrafts = canSeeDrafts && req.query.include_drafts === '1';

        let query = `SELECT * FROM ${table} WHERE 1=1`;
        if (!includeDrafts) query += ` AND ${publicWhere}`;
        const params = [];

        if (req.query.search && searchCols.length) {
          query += ` AND (${searchCols.map(c => `${c} LIKE ?`).join(' OR ')})`;
          searchCols.forEach(() => params.push(`%${req.query.search}%`));
        }
        if (req.query.status && canSeeDrafts) { query += ' AND status = ?'; params.push(req.query.status); }
        query += ` ORDER BY ${orderField} DESC LIMIT 100`;

        let rows = db.prepare(query).all(...params);
        rows = rows.map(r => {
          const out = { ...r };
          for (const jc of jsonCols) out[jc] = jsonArr(out[jc]);
          return out;
        });
        res.json({ [table]: rows, can_manage: Boolean(canSeeDrafts) });
      } catch (err) { serverError(res, err); }
    });

    // Create
    app.post(`/api/${table}`, requirePermission(permManage, aliasCreate), (req, res) => {
      try {
        const b = req.body || {};
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        const skip = ['id', 'created_at', 'updated_at', 'created_by', 'published_at'];
        const fields = [];
        const params = [];
        const values = {};

        for (const col of cols) {
          if (skip.includes(col)) continue;
          if (b[col] === undefined) continue;
          let v = b[col];
          if (jsonCols.includes(col)) v = JSON.stringify(Array.isArray(v) ? v : []);
          else if (['description', 'content', 'message', 'body', 'rules', 'title', 'subject'].includes(col)) v = cleanText(v, 20000);
          else v = cleanText(String(v), 500);
          fields.push(col); params.push(v); values[col] = v;
        }

        if (!fields.includes('title') && !fields.includes('question') && cols.includes('title')) {
          return badRequest(res, 'Title is required');
        }

        const id = db.makeId(table.slice(0, 3).toUpperCase());
        const allCols = ['id', ...fields, 'created_by'];
        const placeholders = allCols.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${placeholders})`)
          .run(id, ...params, req.user.id);

        // Set published_at for published content
        if (values.status === 'published') {
          const pubField = table === 'news' ? 'published_at' : table === 'updates' ? 'published_at' : null;
          if (pubField && cols.includes(pubField)) {
            db.prepare(`UPDATE ${table} SET ${pubField} = datetime('now') WHERE id = ?`).run(id);
          }
        }

        db.audit(req.user.id, `${table.slice(0, -1)}_created`, table, id, { title: values.title || values.question || id });
        res.status(201).json({ message: `${table.slice(0, -1)} created`, id });
      } catch (err) {
        const friendly = constraintError(err);
        if (friendly) return badRequest(res, friendly);
        serverError(res, err);
      }
    });

    // Update
    app.put(`/api/${table}/:id`, requirePermission(permManage, aliasUpdate), (req, res) => {
      try {
        const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
        if (!existing) return notFound(res, table.slice(0, -1));

        const b = req.body || {};
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        const skip = ['id', 'created_at', 'created_by'];
        const sets = [];
        const params = [];

        for (const col of cols) {
          if (skip.includes(col) || b[col] === undefined) continue;
          let v = b[col];
          if (jsonCols.includes(col)) v = JSON.stringify(Array.isArray(v) ? v : []);
          else if (['description', 'content', 'message', 'body', 'rules', 'title', 'subject'].includes(col)) v = cleanText(v, 20000);
          else v = cleanText(String(v), 500);
          sets.push(`${col} = ?`); params.push(v);
          if (col === 'status' && v === 'published' && cols.includes('published_at') && !existing.published_at) {
            sets.push('published_at = datetime(\'now\')');
          }
        }
        if (b.status === 'archived' && cols.includes('published_at') && ['news', 'updates'].includes(table)) {
          // archived keeps history; no extra handling needed
        }
        if (!sets.length) return badRequest(res, 'Nothing to update');
        if (cols.includes('updated_at')) sets.push("updated_at = datetime('now')");
        params.push(existing.id);
        db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        db.audit(req.user.id, `${table.slice(0, -1)}_updated`, table, existing.id, { changed: Object.keys(b) });
        res.json({ message: 'Updated' });
      } catch (err) {
        const friendly = constraintError(err);
        if (friendly) return badRequest(res, friendly);
        serverError(res, err);
      }
    });

    // Delete
    app.delete(`/api/${table}/:id`, requirePermission(permManage, aliasDelete), (req, res) => {
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!existing) return notFound(res, table.slice(0, -1));
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(existing.id);
      db.audit(req.user.id, `${table.slice(0, -1)}_deleted`, table, existing.id, {});
      res.json({ message: 'Deleted' });
    });
  }

  // ---------- EVENTS ----------
  contentCrud({
    table: 'events', permView: 'events.view', permManage: 'events.manage',
    publicWhere: "status = 'published'", orderField: 'start_time', searchCols: ['title', 'description'],
    aliasView: 'moderator.events.view', aliasCreate: 'moderator.events.create',
    aliasUpdate: 'moderator.events.update', aliasDelete: 'moderator.events.delete'
  });

  // ---------- NEWS ----------
  contentCrud({
    table: 'news', permView: 'news.view', permManage: 'news.manage',
    publicWhere: "status = 'published'", orderField: 'published_at', searchCols: ['title', 'content', 'category'],
    aliasView: 'moderator.news.view', aliasCreate: 'moderator.news.create',
    aliasUpdate: 'moderator.news.update', aliasDelete: 'moderator.news.delete'
  });

  // ---------- UPDATES ----------
  contentCrud({
    table: 'updates', permView: 'updates.view', permManage: 'updates.manage',
    publicWhere: "status = 'published'", orderField: 'published_at', searchCols: ['title', 'version'],
    jsonCols: ['features', 'improvements', 'fixes']
  });

  // ---------- BANNERS (homepage) ----------
  contentCrud({
    table: 'banners', permView: 'banners.manage', permManage: 'banners.manage',
    publicWhere: "status = 'active'", orderField: 'display_order'
  });

  app.get('/api/banners/active', (req, res) => {
    const now = new Date().toISOString();
    const rows = db.prepare(`
      SELECT id, title, description, image, button_text, link, display_order
      FROM banners WHERE status = 'active'
        AND (start_at IS NULL OR start_at <= ?)
        AND (end_at IS NULL OR end_at >= ?)
      ORDER BY display_order ASC
    `).all(now, now);
    res.json({ banners: rows, empty: rows.length === 0 });
  });

  // ---------- POPUPS ----------
  contentCrud({
    table: 'popups', permView: 'popups.manage', permManage: 'popups.manage',
    publicWhere: "status = 'active'", orderField: 'created_at'
  });

  app.get('/api/popups/active', optionalAuth, (req, res) => {
    const now = new Date().toISOString();
    const rows = db.prepare(`
      SELECT id, type, title, message, button_text, link, frequency
      FROM popups WHERE status = 'active'
        AND (start_at IS NULL OR start_at <= ?)
        AND (end_at IS NULL OR end_at >= ?)
      ORDER BY created_at DESC
    `).all(now, now);
    res.json({ popups: rows, empty: rows.length === 0 });
  });

  // ---------- SPONSORS ----------
  contentCrud({
    table: 'sponsors', permView: 'sponsors.manage', permManage: 'sponsors.manage',
    publicWhere: "status = 'active'", orderField: 'created_at'
  });

  app.get('/api/sponsors/active', (req, res) => {
    const now = new Date().toISOString();
    const rows = db.prepare(`
      SELECT id, name, logo, website, description FROM sponsors
      WHERE status = 'active'
        AND (start_at IS NULL OR start_at <= ?)
        AND (end_at IS NULL OR end_at >= ?)
      ORDER BY created_at DESC
    `).all(now, now);
    res.json({ sponsors: rows, empty: rows.length === 0 });
  });

  app.post('/api/sponsors/:id/tournaments', requirePermission('sponsors.manage'), (req, res) => {
    const s = db.prepare('SELECT id FROM sponsors WHERE id = ?').get(req.params.id);
    if (!s) return notFound(res, 'Sponsor');
    const tid = cleanText((req.body || {}).tournament_id, 40);
    if (!db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tid)) return notFound(res, 'Tournament');
    db.prepare('INSERT OR IGNORE INTO sponsor_tournaments (sponsor_id, tournament_id) VALUES (?, ?)').run(s.id, tid);
    db.audit(req.user.id, 'sponsor_assigned', 'sponsor', s.id, { tournament: tid });
    res.json({ message: 'Tournament assigned to sponsor' });
  });

  // ---------- HIGHLIGHTS ----------
  contentCrud({
    table: 'highlights', permView: 'highlights.manage', permManage: 'highlights.manage',
    publicWhere: "status = 'active'", orderField: 'display_order'
  });

  app.get('/api/highlights/active', (req, res) => {
    const rows = db.prepare(`
      SELECT h.id, h.type, h.title, h.description, h.media_url, h.tournament_id, t.name as tournament_name
      FROM highlights h LEFT JOIN tournaments t ON t.id = h.tournament_id
      WHERE h.status = 'active' ORDER BY h.display_order ASC, h.created_at DESC
    `).all();
    res.json({ highlights: rows, empty: rows.length === 0 });
  });

  // ---------- POLLS ----------
  app.get('/api/polls', optionalAuth, (req, res) => {
    try {
      const canManage = req.user && req.perms && (req.perms.has('*') || req.perms.has('polls.manage'));
      let polls;
      if (canManage && req.query.include_drafts === '1') {
        polls = db.prepare('SELECT * FROM polls ORDER BY created_at DESC').all();
      } else {
        polls = db.prepare("SELECT * FROM polls WHERE status = 'active' ORDER BY created_at DESC").all();
      }

      const enriched = polls.map(p => {
        const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY rowid ASC').all(p.id);
        const totalVotes = db.prepare('SELECT COUNT(*) as c FROM poll_votes WHERE poll_id = ?').get(p.id).c;
        const myVote = req.user
          ? db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(p.id, req.user.id)
          : null;
        return {
          ...p,
          options: options.map(o => {
            const votes = db.prepare('SELECT COUNT(*) as c FROM poll_votes WHERE option_id = ?').get(o.id).c;
            return { ...o, votes, percentage: totalVotes ? Math.round((votes / totalVotes) * 100) : 0 };
          }),
          total_votes: totalVotes,
          my_vote: myVote ? myVote.option_id : null
        };
      });
      res.json({ polls: enriched, can_manage: Boolean(canManage) });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/polls', requirePermission('polls.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.question) return badRequest(res, 'Question is required');
      if (!Array.isArray(b.options) || b.options.length < 2) return badRequest(res, 'At least 2 options are required');
      if (b.options.length > 10) return badRequest(res, 'Maximum 10 options');

      const id = db.makeId('POL');
      db.tx(() => {
        db.prepare('INSERT INTO polls (id, question, description, start_at, end_at, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, cleanText(b.question, 300), cleanText(b.description || '', 1000),
               b.start_at || null, b.end_at || null,
               ['draft', 'active', 'closed'].includes(b.status) ? b.status : 'draft', req.user.id);
        const ins = db.prepare('INSERT INTO poll_options (id, poll_id, text) VALUES (?, ?, ?)');
        for (const opt of b.options.slice(0, 10)) {
          const text = cleanText(String(opt), 200);
          if (text) ins.run(db.makeId('OPT'), id, text);
        }
        db.audit(req.user.id, 'poll_created', 'poll', id, { question: b.question });
      });
      res.status(201).json({ message: 'Poll created', pollId: id });
    } catch (err) { serverError(res, err); }
  });

  app.put('/api/polls/:id', requirePermission('polls.manage'), (req, res) => {
    const p = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id);
    if (!p) return notFound(res, 'Poll');
    const b = req.body || {};
    const fields = [];
    const params = [];
    if (b.question !== undefined) { fields.push('question = ?'); params.push(cleanText(b.question, 300)); }
    if (b.description !== undefined) { fields.push('description = ?'); params.push(cleanText(b.description, 1000)); }
    if (b.start_at !== undefined) { fields.push('start_at = ?'); params.push(b.start_at || null); }
    if (b.end_at !== undefined) { fields.push('end_at = ?'); params.push(b.end_at || null); }
    if (b.status !== undefined) {
      if (!['draft', 'active', 'closed'].includes(b.status)) return badRequest(res, 'Invalid status');
      fields.push('status = ?'); params.push(b.status);
    }
    if (!fields.length) return badRequest(res, 'Nothing to update');
    fields.push("updated_at = datetime('now')");
    params.push(p.id);
    db.prepare(`UPDATE polls SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    db.audit(req.user.id, 'poll_updated', 'poll', p.id, { changed: Object.keys(b) });
    res.json({ message: 'Poll updated' });
  });

  app.delete('/api/polls/:id', requirePermission('polls.manage'), (req, res) => {
    const p = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id);
    if (!p) return notFound(res, 'Poll');
    db.prepare('DELETE FROM polls WHERE id = ?').run(p.id);
    db.audit(req.user.id, 'poll_deleted', 'poll', p.id, {});
    res.json({ message: 'Poll deleted' });
  });

  // One vote per user per poll (DB-enforced unique constraint)
  app.post('/api/polls/:id/vote', requireAuth, (req, res) => {
    try {
      const p = db.prepare('SELECT * FROM polls WHERE id = ? AND status = ?').get(req.params.id, 'active');
      if (!p) return notFound(res, 'Active poll');
      const optionId = cleanText((req.body || {}).option_id, 40);
      const opt = db.prepare('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?').get(optionId, p.id);
      if (!opt) return badRequest(res, 'Invalid option');

      db.prepare('INSERT INTO poll_votes (id, poll_id, option_id, user_id) VALUES (?, ?, ?, ?)')
        .run(db.makeId('VOT'), p.id, optionId, req.user.id);
      res.json({ message: 'Vote recorded' });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return conflict(res, 'You have already voted in this poll');
      serverError(res, err);
    }
  });

  // ---------- HOMEPAGE AGGREGATE (single request, all real data) ----------

  app.get('/api/site/home', optionalAuth, (req, res) => {
    try {
      const now = new Date().toISOString();

      const banners = db.prepare(`
        SELECT id, title, description, image, button_text, link, display_order FROM banners
        WHERE status = 'active' AND (start_at IS NULL OR start_at <= ?) AND (end_at IS NULL OR end_at >= ?)
        ORDER BY display_order ASC
      `).all(now, now);

      const popups = db.prepare(`
        SELECT id, type, title, message, button_text, link, frequency FROM popups
        WHERE status = 'active' AND (start_at IS NULL OR start_at <= ?) AND (end_at IS NULL OR end_at >= ?)
        ORDER BY created_at DESC
      `).all(now, now);

      const sponsors = db.prepare(`
        SELECT id, name, logo, website, description FROM sponsors
        WHERE status = 'active' AND (start_at IS NULL OR start_at <= ?) AND (end_at IS NULL OR end_at >= ?)
      `).all(now, now);

      const highlights = db.prepare(`
        SELECT h.id, h.type, h.title, h.description, h.media_url, h.tournament_id, t.name as tournament_name
        FROM highlights h LEFT JOIN tournaments t ON t.id = h.tournament_id
        WHERE h.status = 'active' ORDER BY h.display_order ASC LIMIT 6
      `).all();

      const upcoming = db.prepare(`
        SELECT id, name, mode, format, entry_cost, player_limit, start_time, status
        FROM tournaments WHERE status IN ('upcoming', 'waiting', 'almost_full', 'full')
        ORDER BY start_time ASC LIMIT 6
      `).all();

      const featured = db.prepare(`
        SELECT id, name, mode, format, entry_cost, player_limit, start_time, status
        FROM tournaments WHERE featured = 1 AND status NOT IN ('completed', 'cancelled')
        ORDER BY start_time ASC LIMIT 3
      `).all();

      const maintenance = require('../helpers').getMaintenanceState();

      res.json({ banners, popups, sponsors, highlights, upcoming_tournaments: upcoming, featured_tournaments: featured, maintenance });
    } catch (err) { serverError(res, err); }
  });
};
