/* ============================================
   BOOYAHX — TOURNAMENT ROUTES
   CRUD, joining, brackets, templates,
   categories/tags, series, matches.
   Server validates everything.
   ============================================ */

module.exports = function tournamentRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, requirePermission } = ctx;
  const {
    badRequest, notFound, denied, conflict, serverError,
    requireFields, asInt, cleanText, notify, applyWalletChange,
    isJoinable, refreshTournamentCapacity, transitionTournamentStatus
  } = require('../helpers');

  // CS = 4v4 = 8 players total; BR lobby = 48/49. Enforced server-side.
  const FORMAT_RULES = {
    'Clash Squad': { teamSize: 4, playerLimit: 8, entry: 20, r: [30, 20, 10, 5] },
    'Battle Royale': { teamSize: 1, playerLimit: 49, entry: 50, r: [100, 50, 25, 10] }
  };

  function validateFormat(format, mode, playerLimit, teamSize) {
    const rule = FORMAT_RULES[mode];
    if (!rule) return null; // custom mode: generic validation only
    if (mode === 'Clash Squad') {
      if (teamSize !== 4) return 'Clash Squad is 4v4 — team size must be 4';
      if (playerLimit !== 8) return 'Clash Squad tournaments must have exactly 8 players (2 teams of 4)';
    }
    if (mode === 'Battle Royale') {
      if (playerLimit < 1 || playerLimit > 49) return 'Battle Royale supports up to 49 players';
    }
    return null;
  }

  function serializeTournament(t, extra = {}) {
    const players = db.prepare(
      "SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ? AND status = 'registered'"
    ).get(t.id).c;
    const teams = db.prepare('SELECT COUNT(DISTINCT team_id) as c FROM tournament_registrations WHERE tournament_id = ? AND team_id IS NOT NULL').get(t.id).c;
    transitionTournamentStatus(t);
    let status = t.status;
    if (['upcoming', 'waiting', 'almost_full', 'full'].includes(status)) {
      if (players >= t.player_limit) status = 'full';
    }
    let tags = [];
    try { tags = JSON.parse(t.tags || '[]'); } catch (_) {}
    return {
      ...t,
      tags,
      players,
      team_count: teams,
      is_full: players >= t.player_limit,
      status,
      ...extra
    };
  }

  // ---------- LIST (public) ----------

  app.get('/api/tournaments', optionalAuth, (req, res) => {
    try {
      const { status, game, mode, search, category, tag, featured } = req.query;
      let query = 'SELECT t.*, c.name as category_name FROM tournaments t LEFT JOIN categories c ON c.id = t.category_id WHERE 1=1';
      const params = [];

      if (status) { query += ' AND t.status = ?'; params.push(status); }
      if (game) { query += ' AND t.game = ?'; params.push(game); }
      if (mode) { query += ' AND t.mode = ?'; params.push(mode); }
      if (category) { query += ' AND c.slug = ?'; params.push(category); }
      if (featured === '1') query += ' AND t.featured = 1';
      if (search) { query += ' AND (t.name LIKE ? OR t.mode LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
      if (tag) {
        query += ` AND EXISTS (SELECT 1 FROM tournament_tags tt JOIN tags g ON g.id = tt.tag_id
                  WHERE tt.tournament_id = t.id AND g.slug = ?)`;
        params.push(tag);
      }
      query += ' ORDER BY t.start_time ASC';

      const rows = db.prepare(query).all(...params);
      res.json({ tournaments: rows.map(t => serializeTournament(t)) });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ---------- DETAIL (public) ----------

  app.get('/api/tournaments/:id', optionalAuth, (req, res) => {
    try {
      const t = db.prepare(
        'SELECT t.*, c.name as category_name, u.name as creator_name FROM tournaments t ' +
        'LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ?'
      ).get(req.params.id);
      if (!t) return notFound(res, 'Tournament');

      const regs = db.prepare(`
        SELECT r.id, r.joined_at, r.status, u.id as user_id, u.username, u.name, r.team_id,
               tm.name as team_name
        FROM tournament_registrations r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN teams tm ON tm.id = r.team_id
        WHERE r.tournament_id = ? ORDER BY r.joined_at ASC
      `).all(t.id);

      const matches = db.prepare(
        'SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round_number, match_number'
      ).all(t.id);

      const results = db.prepare(`
        SELECT tr.*, u.username, u.name, tm.name as team_name
        FROM tournament_results tr
        LEFT JOIN users u ON u.id = tr.user_id
        LEFT JOIN teams tm ON tm.id = tr.team_id
        WHERE tr.tournament_id = ? AND tr.published_at IS NOT NULL
        ORDER BY tr.position ASC
      `).all(t.id);

      const registered = req.user
        ? db.prepare("SELECT id FROM tournament_registrations WHERE tournament_id = ? AND user_id = ? AND status = 'registered'").get(t.id, req.user.id)
        : null;

      res.json({
        tournament: serializeTournament(t),
        registrations: regs.map(r => ({
          user_id: r.user_id, username: r.username, name: r.name,
          team_id: r.team_id, team_name: r.team_name, joined_at: r.joined_at, status: r.status
        })),
        matches,
        results,
        viewer_registered: Boolean(registered)
      });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ---------- CREATE ----------

  app.post('/api/tournaments', requirePermission('tournaments.create'), (req, res) => {
    try {
      const b = req.body || {};
      const missing = requireFields(b, ['name', 'game', 'mode', 'format', 'player_limit', 'start_time']);
      if (missing) return badRequest(res, missing);

      const name = cleanText(b.name, 120);
      const game = cleanText(b.game, 60);
      const mode = cleanText(b.mode, 60);
      const format = cleanText(b.format, 60);
      const playerLimit = asInt(b.player_limit, 0);
      const teamSize = asInt(b.team_size, 1);
      const entryCost = Math.max(0, asInt(b.entry_cost, 0));
      const start = Date.parse(b.start_time);
      if (!Number.isFinite(start)) return badRequest(res, 'Invalid start time');
      if (playerLimit < 2) return badRequest(res, 'Player limit must be at least 2');

      const formatError = validateFormat(format, mode, playerLimit, teamSize);
      if (formatError) return badRequest(res, formatError);

      // Registration/scheduling window validation (server time authoritative)
      const regOpens = b.registration_opens_at ? Date.parse(b.registration_opens_at) : null;
      const regCloses = b.registration_closes_at ? Date.parse(b.registration_closes_at) : null;
      const ends = b.ends_at ? Date.parse(b.ends_at) : null;
      if (regOpens !== null && !Number.isFinite(regOpens)) return badRequest(res, 'Invalid registration opening time');
      if (regCloses !== null && !Number.isFinite(regCloses)) return badRequest(res, 'Invalid registration closing time');
      if (ends !== null && !Number.isFinite(ends)) return badRequest(res, 'Invalid end time');
      if (regCloses !== null && regCloses > start) return badRequest(res, 'Registration must close before start time');
      if (ends !== null && ends < start) return badRequest(res, 'End time cannot be before start time');

      // Default rewards per platform rules when not provided
      const rule = FORMAT_RULES[mode];
      const rewards = rule ? rule.r : [0, 0, 0, 0];
      const id = db.makeId('TRN');

      db.tx(() => {
        db.prepare(`
          INSERT INTO tournaments (id, name, game, mode, format, entry_cost, player_limit, team_size,
            start_time, ends_at, registration_opens_at, registration_closes_at, duration_minutes,
            category_id, tags, template_id, status, rules, description, banner,
            reward_1st, reward_2nd, reward_3rd, reward_other, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, name, game, mode, format, entryCost, playerLimit, teamSize,
          b.start_time,
          b.ends_at || null,
          b.registration_opens_at || null,
          b.registration_closes_at || null,
          asInt(b.duration_minutes, 0) || null,
          b.category_id || null,
          JSON.stringify(Array.isArray(b.tags) ? b.tags.map(t => cleanText(t, 40)).slice(0, 10) : []),
          b.template_id || null,
          'upcoming',
          cleanText(b.rules, 8000), cleanText(b.description, 4000), cleanText(b.banner, 500),
          asInt(b.reward_1st, rewards[0]), asInt(b.reward_2nd, rewards[1]),
          asInt(b.reward_3rd, rewards[2]), asInt(b.reward_other, rewards[3]),
          req.user.id
        );

        if (Array.isArray(b.tag_ids)) {
          const insTag = db.prepare('INSERT OR IGNORE INTO tournament_tags (tournament_id, tag_id) VALUES (?, ?)');
          for (const tagId of b.tag_ids.slice(0, 15)) insTag.run(id, cleanText(String(tagId), 40));
        }
        db.audit(req.user.id, 'tournament_created', 'tournament', id, { name, mode, playerLimit });
      });

      res.status(201).json({ message: 'Tournament created', tournamentId: id });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ---------- UPDATE ----------

  app.put('/api/tournaments/:id', requirePermission('tournaments.edit'), (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Tournament');
      if (['completed', 'cancelled'].includes(t.status)) {
        return conflict(res, `Cannot edit a ${t.status} tournament`);
      }

      const b = req.body || {};
      const fields = [];
      const params = [];
      const editable = {
        name: v => cleanText(v, 120),
        game: v => cleanText(v, 60),
        mode: v => cleanText(v, 60),
        format: v => cleanText(v, 60),
        entry_cost: v => Math.max(0, asInt(v, 0)),
        player_limit: v => asInt(v, 0),
        team_size: v => asInt(v, 1),
        start_time: v => { if (!Number.isFinite(Date.parse(v))) throw new Error('Invalid start time'); return v; },
        ends_at: v => v || null,
        registration_opens_at: v => v || null,
        registration_closes_at: v => v || null,
        duration_minutes: v => asInt(v, 0) || null,
        rules: v => cleanText(v, 8000),
        description: v => cleanText(v, 4000),
        banner: v => cleanText(v, 500),
        reward_1st: v => Math.max(0, asInt(v, 0)),
        reward_2nd: v => Math.max(0, asInt(v, 0)),
        reward_3rd: v => Math.max(0, asInt(v, 0)),
        reward_other: v => Math.max(0, asInt(v, 0)),
        category_id: v => v || null,
        featured: v => (v ? 1 : 0),
        status: v => {
          const allowed = ['upcoming', 'waiting', 'live', 'results_pending', 'completed', 'cancelled'];
          if (!allowed.includes(v)) throw new Error('Invalid status');
          return v;
        }
      };

      for (const [key, fn] of Object.entries(editable)) {
        if (b[key] !== undefined) {
          fields.push(`${key} = ?`);
          params.push(fn(b[key]));
        }
      }
      if (!fields.length && !Array.isArray(b.tag_ids)) return badRequest(res, 'Nothing to update');

      db.tx(() => {
        if (fields.length) {
          fields.push("updated_at = datetime('now')");
          params.push(t.id);
          db.prepare(`UPDATE tournaments SET ${fields.join(', ')} WHERE id = ?`).run(...params);
        }
        if (Array.isArray(b.tag_ids)) {
          db.prepare('DELETE FROM tournament_tags WHERE tournament_id = ?').run(t.id);
          const insTag = db.prepare('INSERT OR IGNORE INTO tournament_tags (tournament_id, tag_id) VALUES (?, ?)');
          for (const tagId of b.tag_ids.slice(0, 15)) insTag.run(t.id, cleanText(String(tagId), 40));
        }
        db.audit(req.user.id, 'tournament_edited', 'tournament', t.id, { changed: Object.keys(b) });
      });

      res.json({ message: 'Tournament updated' });
    } catch (err) {
      if (err.message && err.message.startsWith('Invalid')) return badRequest(res, err.message);
      serverError(res, err);
    }
  });

  // ---------- DELETE / CANCEL ----------

  app.delete('/api/tournaments/:id', requirePermission('tournaments.cancel'), (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Tournament');

      const registrations = db.prepare(
        "SELECT * FROM tournament_registrations WHERE tournament_id = ? AND status = 'registered'"
      ).all(t.id);

      if (t.status === 'completed') return conflict(res, 'Cannot delete a completed tournament');

      db.tx(() => {
        // Refund entry fees atomically when cancelling
        for (const reg of registrations) {
          if (t.entry_cost > 0) {
            const r = applyWalletChange(reg.user_id, {
              type: 'refund', amount: t.entry_cost, reference: t.id, idempotency_key: `refund:${t.id}:${reg.user_id}`
            });
            if (r.ok) notify(reg.user_id, 'Entry Refunded', `Entry fee refunded for ${t.name}`, 'wallet');
          }
          db.prepare("UPDATE tournament_registrations SET status = 'cancelled' WHERE id = ?").run(reg.id);
        }
        if (req.query.purge === '1' && req.perms && (req.perms.has('*'))) {
          db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id);
          db.audit(req.user.id, 'tournament_deleted', 'tournament', t.id, { name: t.name });
        } else {
          db.prepare("UPDATE tournaments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(t.id);
          db.audit(req.user.id, 'tournament_cancelled', 'tournament', t.id, { name: t.name, refunded: registrations.length });
        }
      });

      res.json({ message: 'Tournament cancelled. Registrations refunded.', refunded: registrations.length });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ---------- JOIN (atomic, server-validated) ----------

  app.post('/api/tournaments/:id/join', requireAuth, (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Tournament');
      if (!isJoinable(t)) return conflict(res, `Tournament is not open for registration (status: ${t.status})`);

      const userId = req.user.id;

      const result = db.tx(() => {
        // Re-read inside transaction to prevent duplicate joins under concurrency
        const existing = db.prepare(
          "SELECT id FROM tournament_registrations WHERE tournament_id = ? AND user_id = ? AND status = 'registered'"
        ).get(t.id, userId);
        if (existing) {
          const err = new Error('You have already joined this tournament');
          err.status = 409; err.code = 'ALREADY_JOINED';
          throw err;
        }

        const count = db.prepare(
          "SELECT COUNT(*) as c FROM tournament_registrations WHERE tournament_id = ? AND status = 'registered'"
        ).get(t.id).c;
        if (count >= t.player_limit) {
          const err = new Error('Tournament is full');
          err.status = 409; err.code = 'FULL';
          throw err;
        }

        if (t.entry_cost > 0) {
          const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId);
          if (!wallet || wallet.balance < t.entry_cost) {
            const err = new Error('Insufficient coins');
            err.status = 400; err.code = 'INSUFFICIENT_COINS';
            throw err;
          }

          const walletUpdate = db.prepare(
            "UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?"
          ).run(t.entry_cost, userId, t.entry_cost);
          if (walletUpdate.changes !== 1) {
            const err = new Error('Insufficient coins');
            err.status = 400; err.code = 'INSUFFICIENT_COINS';
            throw err;
          }

          db.prepare('INSERT INTO transactions (id, user_id, type, amount, reference, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(db.makeId('TXN'), userId, 'tournament_entry', -t.entry_cost, t.id, 'completed', `entry:${t.id}:${userId}`);
        }

        const regId = db.makeId('REG');
        db.prepare('INSERT INTO tournament_registrations (id, tournament_id, user_id, status) VALUES (?, ?, ?, ?)')
          .run(regId, t.id, userId, 'registered');

        notify(userId, 'Tournament Joined', `You have successfully joined ${t.name}`, 'tournament');
        return { registrationId: regId };
      });

      refreshTournamentCapacity(t.id);
      db.audit(userId, 'tournament_joined', 'tournament', t.id, { entry_cost: t.entry_cost });

      res.json({ message: 'Successfully joined tournament', registrationId: result.registrationId });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      serverError(res, err);
    }
  });

  // ---------- LEAVE ----------

  app.post('/api/tournaments/:id/leave', requireAuth, (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Tournament');
      if (['live', 'starting', 'results_pending', 'completed'].includes(t.status)) {
        return conflict(res, 'Tournament already started — leaving is not possible');
      }

      db.tx(() => {
        const reg = db.prepare(
          "SELECT * FROM tournament_registrations WHERE tournament_id = ? AND user_id = ? AND status = 'registered'"
        ).get(t.id, req.user.id);
        if (!reg) {
          const err = new Error('You are not registered for this tournament');
          err.status = 404; err.code = 'NOT_REGISTERED';
          throw err;
        }
        db.prepare("UPDATE tournament_registrations SET status = 'cancelled' WHERE id = ?").run(reg.id);
        if (t.entry_cost > 0) {
          const r = applyWalletChange(req.user.id, {
            type: 'refund', amount: t.entry_cost, reference: t.id,
            idempotency_key: `leave-refund:${t.id}:${req.user.id}`
          });
          if (r.ok) notify(req.user.id, 'Entry Refunded', `Entry fee refunded for ${t.name}`, 'wallet');
        }
      });

      refreshTournamentCapacity(t.id);
      res.json({ message: 'Left tournament. Entry fee refunded if applicable.' });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      serverError(res, err);
    }
  });

  // ---------- MY TOURNAMENTS ----------

  app.get('/api/tournaments/me/registrations', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT t.*, r.joined_at, r.status as registration_status
      FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.user_id = ? ORDER BY r.joined_at DESC
    `).all(req.user.id);
    res.json({ tournaments: rows.map(t => serializeTournament(t)) });
  });

  // ============================================
  // BRACKETS
  // ============================================

  app.get('/api/tournaments/:id/bracket', optionalAuth, (req, res) => {
    const t = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Tournament');
    const matches = db.prepare(
      'SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round_number, match_number'
    ).all(t.id);
    if (!matches.length) return res.json({ matches: [], empty: true });
    res.json({ matches });
  });

  app.put('/api/tournaments/:id/bracket', requirePermission('tournaments.brackets'), (req, res) => {
    try {
      const t = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Tournament');
      const matches = Array.isArray((req.body || {}).matches) ? req.body.matches : null;
      if (!matches) return badRequest(res, 'matches array is required');
      if (matches.length > 255) return badRequest(res, 'Too many matches');

      db.tx(() => {
        db.prepare('DELETE FROM tournament_matches WHERE tournament_id = ?').run(t.id);
        const ins = db.prepare(`
          INSERT INTO tournament_matches (id, tournament_id, round_number, round_name, match_number,
            slot1_label, slot1_ref, slot2_label, slot2_ref, winner_slot, score1, score2, status, scheduled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const m of matches) {
          const round = asInt(m.round_number, 1);
          const num = asInt(m.match_number, 1);
          if (round < 1 || num < 1) return badRequest(res, 'round_number and match_number must be >= 1');
          const status = ['planned', 'live', 'completed', 'cancelled'].includes(m.status) ? m.status : 'planned';
          const winner = m.winner_slot === 1 || m.winner_slot === 2 ? m.winner_slot : null;
          ins.run(
            db.makeId('MTC'), t.id, round, cleanText(m.round_name || `Round ${round}`, 40), num,
            cleanText(m.slot1_label || '', 80), m.slot1_ref || null,
            cleanText(m.slot2_label || '', 80), m.slot2_ref || null,
            winner,
            m.score1 === undefined || m.score1 === null ? null : asInt(m.score1, 0),
            m.score2 === undefined || m.score2 === null ? null : asInt(m.score2, 0),
            status, m.scheduled_at || null
          );
        }
        db.audit(req.user.id, 'bracket_updated', 'tournament', t.id, { matches: matches.length });
      });
      res.json({ message: 'Bracket saved' });
    } catch (err) {
      serverError(res, err);
    }
  });

  // ============================================
  // TEMPLATES
  // ============================================

  app.get('/api/tournament-templates', requirePermission('tournaments.templates'), (req, res) => {
    const rows = db.prepare('SELECT * FROM tournament_templates ORDER BY created_at DESC').all();
    res.json({ templates: rows });
  });

  app.post('/api/tournament-templates', requirePermission('tournaments.templates'), (req, res) => {
    try {
      const b = req.body || {};
      const missing = requireFields(b, ['name', 'game', 'mode', 'format', 'player_limit']);
      if (missing) return badRequest(res, missing);

      const id = db.makeId('TPL');
      db.tx(() => {
        db.prepare(`
          INSERT INTO tournament_templates (id, name, game, mode, format, entry_cost, player_limit,
            team_size, duration_minutes, schedule, category, tags, rewards, rules, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, cleanText(b.name, 120), cleanText(b.game, 60), cleanText(b.mode, 60), cleanText(b.format, 60),
          Math.max(0, asInt(b.entry_cost, 0)), asInt(b.player_limit, 2), asInt(b.team_size, 1),
          asInt(b.duration_minutes, 0) || null, cleanText(b.schedule, 200), cleanText(b.category, 60),
          JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 10) : []),
          JSON.stringify(b.rewards || {}), cleanText(b.rules, 8000), req.user.id
        );
        db.audit(req.user.id, 'template_created', 'template', id, { name: b.name });
      });
      res.status(201).json({ message: 'Template created', templateId: id });
    } catch (err) { serverError(res, err); }
  });

  app.put('/api/tournament-templates/:id', requirePermission('tournaments.templates'), (req, res) => {
    const t = db.prepare('SELECT id FROM tournament_templates WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Template');
    const b = req.body || {};
    const fields = [];
    const params = [];
    const map = {
      name: v => cleanText(v, 120), game: v => cleanText(v, 60), mode: v => cleanText(v, 60),
      format: v => cleanText(v, 60), entry_cost: v => Math.max(0, asInt(v, 0)),
      player_limit: v => asInt(v, 2), team_size: v => asInt(v, 1),
      duration_minutes: v => asInt(v, 0) || null, schedule: v => cleanText(v, 200),
      category: v => cleanText(v, 60), rules: v => cleanText(v, 8000)
    };
    for (const [k, fn] of Object.entries(map)) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); params.push(fn(b[k])); }
    }
    if (b.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 10) : [])); }
    if (b.rewards !== undefined) { fields.push('rewards = ?'); params.push(JSON.stringify(b.rewards || {})); }
    if (!fields.length) return badRequest(res, 'Nothing to update');

    fields.push("updated_at = datetime('now')");
    params.push(t.id);
    db.prepare(`UPDATE tournament_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    db.audit(req.user.id, 'template_edited', 'template', t.id, { changed: Object.keys(b) });
    res.json({ message: 'Template updated' });
  });

  app.delete('/api/tournament-templates/:id', requirePermission('tournaments.templates'), (req, res) => {
    const t = db.prepare('SELECT id, name FROM tournament_templates WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Template');
    db.prepare('DELETE FROM tournament_templates WHERE id = ?').run(t.id);
    db.audit(req.user.id, 'template_deleted', 'template', t.id, { name: t.name });
    res.json({ message: 'Template deleted' });
  });

  app.post('/api/tournament-templates/:id/duplicate', requirePermission('tournaments.templates'), (req, res) => {
    const t = db.prepare('SELECT * FROM tournament_templates WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Template');
    const newId = db.makeId('TPL');
    db.prepare(`
      INSERT INTO tournament_templates (id, name, game, mode, format, entry_cost, player_limit,
        team_size, duration_minutes, schedule, category, tags, rewards, rules, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId, `${t.name} (Copy)`, t.game, t.mode, t.format, t.entry_cost, t.player_limit,
           t.team_size, t.duration_minutes, t.schedule, t.category, t.tags, t.rewards, t.rules, req.user.id);
    db.audit(req.user.id, 'template_duplicated', 'template', newId, { from: t.id });
    res.status(201).json({ message: 'Template duplicated', templateId: newId });
  });

  // Create a real tournament FROM a template
  app.post('/api/tournament-templates/:id/create-tournament', requirePermission('tournaments.create'), (req, res) => {
    try {
      const tpl = db.prepare('SELECT * FROM tournament_templates WHERE id = ?').get(req.params.id);
      if (!tpl) return notFound(res, 'Template');
      const b = req.body || {};
      const start = b.start_time;
      if (!start || !Number.isFinite(Date.parse(start))) return badRequest(res, 'start_time is required');

      let rewards = {};
      try { rewards = JSON.parse(tpl.rewards || '{}'); } catch (_) {}

      const id = db.makeId('TRN');
      db.tx(() => {
        db.prepare(`
          INSERT INTO tournaments (id, name, game, mode, format, entry_cost, player_limit, team_size,
            start_time, duration_minutes, tags, template_id, status, rules,
            reward_1st, reward_2nd, reward_3rd, reward_other, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?, ?)
        `).run(
          id, cleanText(b.name || tpl.name, 120), tpl.game, tpl.mode, tpl.format,
          tpl.entry_cost, tpl.player_limit, tpl.team_size, start, tpl.duration_minutes,
          tpl.tags, tpl.id, tpl.rules,
          asInt(rewards.first, 0), asInt(rewards.second, 0), asInt(rewards.third, 0), asInt(rewards.other, 0),
          req.user.id
        );
        db.audit(req.user.id, 'tournament_created_from_template', 'tournament', id, { template: tpl.id });
      });
      res.status(201).json({ message: 'Tournament created from template', tournamentId: id });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // CATEGORIES & TAGS
  // ============================================

  app.get('/api/categories', optionalAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json({ categories: rows });
  });

  app.post('/api/categories', requirePermission('tournaments.categories'), (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 60);
    if (!name) return badRequest(res, 'Name is required');
    const slug = cleanText(b.slug, 60) || require('../helpers').slugify(name);
    if (!/^[a-z0-9-]+$/.test(slug)) return badRequest(res, 'Invalid slug');
    const exists = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (exists) return conflict(res, 'Category slug already exists');
    const id = db.makeId('CAT');
    db.prepare('INSERT INTO categories (id, name, slug, type, description) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, slug, ['tournament', 'event', 'news'].includes(b.type) ? b.type : 'tournament', cleanText(b.description, 500));
    db.audit(req.user.id, 'category_created', 'category', id, { name });
    res.status(201).json({ message: 'Category created', categoryId: id });
  });

  app.delete('/api/categories/:id', requirePermission('tournaments.categories'), (req, res) => {
    const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!c) return notFound(res, 'Category');
    db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
    db.audit(req.user.id, 'category_deleted', 'category', c.id, { name: c.name });
    res.json({ message: 'Category deleted' });
  });

  app.get('/api/tags', optionalAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
    res.json({ tags: rows });
  });

  app.post('/api/tags', requirePermission('tournaments.categories'), (req, res) => {
    const name = cleanText((req.body || {}).name, 40);
    if (!name) return badRequest(res, 'Name is required');
    const slug = require('../helpers').slugify(name);
    const exists = db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug);
    if (exists) return conflict(res, 'Tag already exists');
    const id = db.makeId('TAG');
    db.prepare('INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);
    db.audit(req.user.id, 'tag_created', 'tag', id, { name });
    res.status(201).json({ message: 'Tag created', tagId: id });
  });

  app.delete('/api/tags/:id', requirePermission('tournaments.categories'), (req, res) => {
    const t = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Tag');
    db.prepare('DELETE FROM tags WHERE id = ?').run(t.id);
    db.audit(req.user.id, 'tag_deleted', 'tag', t.id, { name: t.name });
    res.json({ message: 'Tag deleted' });
  });

  // ============================================
  // SERIES / LEAGUES
  // ============================================

  app.get('/api/series', optionalAuth, (req, res) => {
    let rows = db.prepare('SELECT * FROM series ORDER BY created_at DESC').all();
    if (!req.user || !(req.perms && (req.perms.has('*') || req.perms.has('tournaments.series')))) {
      rows = rows.filter(s => s.status !== 'draft');
    }
    res.json({ series: rows });
  });

  app.post('/api/series', requirePermission('tournaments.series'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return badRequest(res, 'Name is required');
      const id = db.makeId('SER');
      db.tx(() => {
        db.prepare(`
          INSERT INTO series (id, name, season, description, start_at, end_at, status, points_config, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, cleanText(b.name, 120), cleanText(b.season, 60), cleanText(b.description, 2000),
               b.start_at || null, b.end_at || null,
               ['draft', 'active', 'completed'].includes(b.status) ? b.status : 'draft',
               JSON.stringify(b.points_config || {}), req.user.id);
        if (Array.isArray(b.tournament_ids)) {
          const ins = db.prepare('INSERT OR IGNORE INTO series_tournaments (series_id, tournament_id, points) VALUES (?, ?, ?)');
          for (const tid of b.tournament_ids) ins.run(id, cleanText(String(tid), 40), asInt(b.points, 0));
        }
        db.audit(req.user.id, 'series_created', 'series', id, { name: b.name });
      });
      res.status(201).json({ message: 'Series created', seriesId: id });
    } catch (err) { serverError(res, err); }
  });

  app.put('/api/series/:id', requirePermission('tournaments.series'), (req, res) => {
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
    if (!s) return notFound(res, 'Series');
    const b = req.body || {};
    const fields = [];
    const params = [];
    const map = {
      name: v => cleanText(v, 120), season: v => cleanText(v, 60),
      description: v => cleanText(v, 2000), start_at: v => v || null, end_at: v => v || null
    };
    for (const [k, fn] of Object.entries(map)) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); params.push(fn(b[k])); }
    }
    if (b.status !== undefined) {
      if (!['draft', 'active', 'completed'].includes(b.status)) return badRequest(res, 'Invalid status');
      fields.push('status = ?'); params.push(b.status);
    }
    if (b.points_config !== undefined) { fields.push('points_config = ?'); params.push(JSON.stringify(b.points_config)); }

    db.tx(() => {
      if (fields.length) {
        fields.push("updated_at = datetime('now')");
        params.push(s.id);
        db.prepare(`UPDATE series SET ${fields.join(', ')} WHERE id = ?`).run(...params);
      }
      if (Array.isArray(b.tournament_ids)) {
        db.prepare('DELETE FROM series_tournaments WHERE series_id = ?').run(s.id);
        const ins = db.prepare('INSERT OR IGNORE INTO series_tournaments (series_id, tournament_id, points) VALUES (?, ?, ?)');
        for (const tid of b.tournament_ids) ins.run(s.id, cleanText(String(tid), 40), asInt(b.points, 0));
      }
      db.audit(req.user.id, 'series_edited', 'series', s.id, { changed: Object.keys(b) });
    });
    res.json({ message: 'Series updated' });
  });

  app.delete('/api/series/:id', requirePermission('tournaments.series'), (req, res) => {
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
    if (!s) return notFound(res, 'Series');
    db.prepare('DELETE FROM series WHERE id = ?').run(s.id);
    db.audit(req.user.id, 'series_deleted', 'series', s.id, { name: s.name });
    res.json({ message: 'Series deleted' });
  });

  // Standings calculated from REAL published results only
  app.get('/api/series/:id/standings', optionalAuth, (req, res) => {
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
    if (!s) return notFound(res, 'Series');

    const tourneys = db.prepare('SELECT tournament_id, points FROM series_tournaments WHERE series_id = ?').all(s.id);
    const standings = new Map();

    for (const st of tourneys) {
      const results = db.prepare(`
        SELECT user_id, team_id, position, reward FROM tournament_results
        WHERE tournament_id = ? AND published_at IS NOT NULL AND user_id IS NOT NULL
      `).all(st.tournament_id);
      for (const r of results) {
        const key = r.user_id;
        const row = standings.get(key) || { user_id: r.user_id, points: 0, tournaments: 0, wins: 0, earnings: 0 };
        row.tournaments++;
        if (r.position === 1) row.wins++;
        row.earnings += r.reward || 0;
        // Points: per-tournament override or position-based default
        let points = st.points;
        if (!points) {
          const cfg = JSON.parse(s.points_config || '{}');
          points = cfg[String(r.position)] !== undefined ? cfg[String(r.position)] : Math.max(0, 20 - r.position * 2);
        }
        row.points += (r.position === 1 ? points : Math.round(points / Math.max(1, r.position)));
        standings.set(key, row);
      }
    }

    const list = [...standings.values()].sort((a, b) => b.points - a.points);
    const enriched = list.map((row, i) => {
      const u = db.prepare('SELECT username, name FROM users WHERE id = ?').get(row.user_id);
      return { rank: i + 1, username: u ? u.username : 'unknown', name: u ? u.name : 'unknown', ...row };
    });

    res.json({ series: s, standings: enriched, computed_from: 'published_results' });
  });
};
