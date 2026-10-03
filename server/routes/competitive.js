/* ============================================
   BOOYAHX — RESULTS, LEADERBOARD, STATS,
   ACHIEVEMENTS, TEAMS
   All computed from real database records.
   ============================================ */

module.exports = function competitiveRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, requirePermission } = ctx;
  const {
    badRequest, notFound, conflict, serverError,
    requireFields, asInt, cleanText, notify, applyWalletChange
  } = require('../helpers');

  // ============================================
  // RESULTS
  // ============================================

  app.get('/api/tournament-results', optionalAuth, (req, res) => {
    try {
      const { tournament_id, published, user_id } = req.query;
      let query = `
        SELECT tr.*, t.name as tournament_name, t.mode, u.username, u.name as player_name, tm.name as team_name
        FROM tournament_results tr
        JOIN tournaments t ON t.id = tr.tournament_id
        LEFT JOIN users u ON u.id = tr.user_id
        LEFT JOIN teams tm ON tm.id = tr.team_id
        WHERE 1=1`;
      const params = [];
      if (tournament_id) { query += ' AND tr.tournament_id = ?'; params.push(tournament_id); }
      if (user_id) { query += ' AND tr.user_id = ?'; params.push(user_id); }
      if (published === '1') query += ' AND tr.published_at IS NOT NULL';
      if (published === '0') query += ' AND tr.published_at IS NULL';
      query += ' ORDER BY tr.created_at DESC, tr.position ASC LIMIT 200';
      const rows = db.prepare(query).all(...params);

      // Draft results are staff-only
      const canSeeDrafts = req.user && req.perms && (req.perms.has('*') || req.perms.has('results.view'));
      const visible = canSeeDrafts ? rows : rows.filter(r => r.published_at);
      res.json({ results: visible, can_manage: Boolean(canSeeDrafts) });
    } catch (err) { serverError(res, err); }
  });

  // Enter/replace draft results for a tournament
  app.post('/api/tournament-results', requirePermission('results.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const tournamentId = cleanText(b.tournament_id, 40);
      if (!tournamentId) return badRequest(res, 'tournament_id is required');
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
      if (!t) return notFound(res, 'Tournament');
      if (!Array.isArray(b.results) || !b.results.length) return badRequest(res, 'results array is required');
      if (b.results.length > 200) return badRequest(res, 'Too many results');

      // Validate every entry against real registrations
      const registrations = new Map(
        db.prepare("SELECT user_id, team_id FROM tournament_registrations WHERE tournament_id = ? AND status = 'registered'")
          .all(tournamentId)
          .map(r => [r.user_id, r.team_id])
      );

      for (const r of b.results) {
        const pos = asInt(r.position, 0);
        if (pos < 1) return badRequest(res, 'Every result needs a position >= 1');
        if (!r.user_id && !r.team_id) return badRequest(res, 'Every result needs user_id or team_id');
        if (r.user_id && !registrations.has(r.user_id)) {
          const u = db.prepare('SELECT username FROM users WHERE id = ?').get(r.user_id);
          return badRequest(res, `${u ? u.username : r.user_id} is not registered for this tournament`);
        }
      }

      db.tx(() => {
        db.prepare('DELETE FROM tournament_results WHERE tournament_id = ? AND published_at IS NULL').run(tournamentId);
        const ins = db.prepare(`
          INSERT INTO tournament_results (id, tournament_id, user_id, team_id, position, result, reward, verified)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `);
        const seen = new Set();
        for (const r of b.results) {
          const pos = asInt(r.position, 0);
          const key = `${pos}:${r.user_id || ''}:${r.team_id || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ins.run(
            db.makeId('RES'), tournamentId,
            r.user_id || null, r.team_id || null, pos,
            cleanText(r.result || `Position ${pos}`, 200),
            Math.max(0, asInt(r.reward, 0))
          );
        }
        db.prepare("UPDATE tournaments SET status = 'results_pending', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('completed', 'cancelled')")
          .run(tournamentId);
        db.audit(req.user.id, 'results_entered', 'tournament', tournamentId, { count: b.results.length });
      });

      res.status(201).json({ message: 'Draft results saved. Publish to distribute rewards.' });
    } catch (err) { serverError(res, err); }
  });

  // Publish results → verify + distribute rewards atomically (once)
  app.post('/api/tournament-results/:tournamentId/publish', requirePermission('results.publish'), (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.tournamentId);
      if (!t) return notFound(res, 'Tournament');

      const drafts = db.prepare(
        'SELECT * FROM tournament_results WHERE tournament_id = ? AND published_at IS NULL ORDER BY position ASC'
      ).all(t.id);
      if (!drafts.length) return conflict(res, 'No draft results to publish');

      const alreadyPublished = db.prepare(
        'SELECT COUNT(*) as c FROM tournament_results WHERE tournament_id = ? AND published_at IS NOT NULL'
      ).get(t.id).c;
      if (alreadyPublished > 0 && !req.query.force) {
        return conflict(res, 'Results were already published for this tournament');
      }

      let distributed = 0;
      db.tx(() => {
        for (const r of drafts) {
          const idempotencyKey = `reward:${t.id}:${r.user_id || r.team_id}:${r.position}`;
          let txnId = null;

          if (r.reward > 0 && r.user_id) {
            const w = applyWalletChange(r.user_id, {
              type: 'reward', amount: r.reward, reference: t.id, idempotencyKey
            });
            txnId = w.transactionId;
            if (!w.duplicate) distributed += r.reward;
          }

          db.prepare(
            "UPDATE tournament_results SET verified = 1, published_at = datetime('now'), reward_transaction_id = ? WHERE id = ?"
          ).run(txnId, r.id);

          if (r.user_id) {
            notify(r.user_id, 'Results Published',
              `${t.name}: Position ${r.position}${r.reward > 0 ? ` — +${r.reward} BX Coins` : ''}`, 'results');
          }
        }

        db.prepare("UPDATE tournaments SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(t.id);

        // Referral eligibility from real completed activity
        for (const r of drafts) {
          if (r.user_id && db.qualifyReferrals) db.qualifyReferrals(r.user_id);
        }

        // Achievement checks from real results
        for (const r of drafts) {
          if (r.user_id) checkAchievements(r.user_id);
        }

        db.audit(req.user.id, 'results_published', 'tournament', t.id, {
          results: drafts.length, coins_distributed: distributed
        });
      });

      res.json({ message: 'Results published. Rewards recorded in wallets.', coins_distributed: distributed, results: drafts.length });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // LEADERBOARD (computed from real results)
  // ============================================

  function computeLeaderboard({ mode = null, period = 'all', limit = 100 }) {
    let where = "tr.published_at IS NOT NULL AND tr.user_id IS NOT NULL";
    const params = [];

    if (mode) { where += ' AND t.mode = ?'; params.push(mode); }
    if (period === 'weekly') where += " AND tr.published_at >= datetime('now', '-7 days')";
    else if (period === 'monthly') where += " AND tr.published_at >= datetime('now', '-30 days')";

    const rows = db.prepare(`
      SELECT tr.user_id,
             u.username, u.name,
             COUNT(*) as tournaments,
             SUM(CASE WHEN tr.position = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN tr.position = 2 THEN 1 ELSE 0 END) as seconds,
             SUM(CASE WHEN tr.position = 3 THEN 1 ELSE 0 END) as thirds,
             COALESCE(SUM(tr.reward), 0) as coins_earned
      FROM tournament_results tr
      JOIN tournaments t ON t.id = tr.tournament_id
      JOIN users u ON u.id = tr.user_id
      WHERE ${where}
      GROUP BY tr.user_id
      ORDER BY wins DESC, coins_earned DESC, tournaments DESC
      LIMIT ?
    `).all(...params, Math.min(limit, 200));

    return rows.map((r, i) => ({
      rank: i + 1,
      user_id: r.user_id,
      username: r.username,
      name: r.name,
      wins: r.wins,
      matches: r.tournaments,
      tournaments: r.tournaments,
      seconds: r.seconds,
      thirds: r.thirds,
      coins_earned: r.coins_earned,
      win_rate: r.tournaments > 0 ? Math.round((r.wins / r.tournaments) * 1000) / 10 : 0,
      score: r.wins * 100 + r.seconds * 60 + r.thirds * 30 + Math.min(r.coins_earned, 500) / 10
    }));
  }

  app.get('/api/leaderboard', optionalAuth, (req, res) => {
    try {
      const { mode, period, search, limit } = req.query;
      const validModes = ['Clash Squad', 'Battle Royale'];
      const validPeriods = ['weekly', 'monthly', 'all'];
      const safeMode = validModes.includes(mode) ? mode : null;
      const safePeriod = validPeriods.includes(period) ? period : 'all';

      let rows = computeLeaderboard({ mode: safeMode, period: safePeriod, limit: asInt(limit, 100) });

      if (search) {
        const q = String(search).toLowerCase();
        rows = rows.filter(r => r.username.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
        rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
      }

      res.json({
        leaderboard: rows,
        period: safePeriod,
        mode: safeMode || 'all',
        computed_from: 'published_tournament_results',
        empty: rows.length === 0
      });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // PLAYER STATISTICS
  // ============================================

  function computePlayerStats(userId) {
    const totals = db.prepare(`
      SELECT COUNT(*) as tournaments,
             SUM(CASE WHEN tr.position = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN tr.position = 2 THEN 1 ELSE 0 END) as seconds,
             SUM(CASE WHEN tr.position = 3 THEN 1 ELSE 0 END) as thirds,
             COALESCE(SUM(tr.reward), 0) as coins_earned
      FROM tournament_results tr
      WHERE tr.user_id = ? AND tr.published_at IS NOT NULL
    `).get(userId);

    const byMode = (mode) => db.prepare(`
      SELECT COUNT(*) as tournaments,
             SUM(CASE WHEN tr.position = 1 THEN 1 ELSE 0 END) as wins
      FROM tournament_results tr JOIN tournaments t ON t.id = tr.tournament_id
      WHERE tr.user_id = ? AND tr.published_at IS NOT NULL AND t.mode = ?
    `).get(userId, mode);

    const cs = byMode('Clash Squad');
    const br = byMode('Battle Royale');

    // Streaks from real chronological results
    const history = db.prepare(`
      SELECT tr.position FROM tournament_results tr
      WHERE tr.user_id = ? AND tr.published_at IS NOT NULL
      ORDER BY tr.published_at ASC
    `).all(userId).map(r => r.position);

    let currentStreak = 0, bestStreak = 0, run = 0;
    for (const pos of history) {
      if (pos === 1) { run++; if (run > bestStreak) bestStreak = run; }
      else { run = 0; }
    }
    // Current streak counts trailing wins
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === 1) currentStreak++;
      else break;
    }

    const tournaments = totals.tournaments || 0;
    return {
      total_tournaments: tournaments,
      matches: tournaments,
      wins: totals.wins || 0,
      losses: tournaments - (totals.wins || 0),
      win_rate: tournaments > 0 ? Math.round(((totals.wins || 0) / tournaments) * 1000) / 10 : 0,
      first_place: totals.wins || 0,
      second_place: totals.seconds || 0,
      third_place: totals.thirds || 0,
      coins_earned: totals.coins_earned || 0,
      cs: { tournaments: cs.tournaments || 0, wins: cs.wins || 0 },
      br: { tournaments: br.tournaments || 0, wins: br.wins || 0 },
      current_streak: currentStreak,
      best_streak: bestStreak,
      has_data: tournaments > 0
    };
  }

  app.get('/api/players/:username/stats', optionalAuth, (req, res) => {
    const user = db.prepare('SELECT id, username, name, created_at, status FROM users WHERE username = ?').get(req.params.username);
    if (!user) return notFound(res, 'Player');
    if (user.status !== 'active' && !(req.user && req.perms && req.perms.has('users.view'))) {
      return notFound(res, 'Player');
    }

    const stats = computePlayerStats(user.id);
    const achievements = db.prepare(`
      SELECT a.key, a.name, a.description, a.icon, ua.unlocked_at
      FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
      WHERE ua.user_id = ? AND a.enabled = 1
      ORDER BY ua.unlocked_at DESC
    `).all(user.id);

    res.json({
      player: { username: user.username, name: user.name, member_since: user.created_at },
      stats,
      achievements
    });
  });

  // ============================================
  // ACHIEVEMENTS
  // ============================================

  function checkAchievements(userId) {
    const stats = computePlayerStats(userId);
    const defs = db.prepare('SELECT * FROM achievements WHERE enabled = 1').all();
    const owned = new Set(
      db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').all(userId)
        .map(r => r.achievement_id)
    );

    const unlocked = [];
    for (const def of defs) {
      if (owned.has(def.id)) continue;
      let criteria = {};
      try { criteria = JSON.parse(def.criteria || '{}'); } catch (_) {}

      let met = false;
      if (criteria.type === 'wins') met = stats.wins >= criteria.target;
      else if (criteria.type === 'tournaments') met = stats.total_tournaments >= criteria.target;
      else if (criteria.type === 'mode_win') {
        const bucket = criteria.mode === 'Clash Squad' ? stats.cs : criteria.mode === 'Battle Royale' ? stats.br : null;
        met = bucket ? bucket.wins >= 1 : false;
      } else if (criteria.type === 'win_streak') met = stats.best_streak >= criteria.target;

      if (met) {
        db.prepare('INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id) VALUES (?, ?, ?)')
          .run(db.makeId('UAC'), userId, def.id);
        notify(userId, 'Achievement Unlocked', `${def.icon || '🏅'} ${def.name}`, 'achievement');
        unlocked.push(def.key);
      }
    }
    return unlocked;
  }
  db.checkAchievements = checkAchievements;

  app.get('/api/achievements', optionalAuth, (req, res) => {
    const defs = db.prepare('SELECT id, key, name, description, icon, criteria, enabled FROM achievements ORDER BY rowid ASC').all()
      .map(a => ({ ...a, unlocked_count: db.prepare('SELECT COUNT(*) as c FROM user_achievements WHERE achievement_id = ?').get(a.id).c }));

    let mine = [];
    if (req.user) {
      mine = db.prepare(`
        SELECT a.key, ua.unlocked_at FROM user_achievements ua
        JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?
      `).all(req.user.id);
    }
    res.json({ achievements: defs, my_unlocks: mine, authenticated: Boolean(req.user), can_manage: Boolean(req.perms && (req.perms.has('*') || req.perms.has('achievements.manage'))) });
  });

  app.post('/api/achievements', requirePermission('achievements.manage'), (req, res) => {
    const b = req.body || {};
    const key = cleanText(b.key, 40).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key || !b.name) return badRequest(res, 'key and name are required');
    if (db.prepare('SELECT id FROM achievements WHERE key = ?').get(key)) return conflict(res, 'Achievement key already exists');
    const id = db.makeId('ACH');
    db.prepare('INSERT INTO achievements (id, key, name, description, icon, criteria, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, key, cleanText(b.name, 80), cleanText(b.description, 300), cleanText(b.icon || '', 10),
           JSON.stringify(b.criteria || {}), b.enabled === false ? 0 : 1);
    db.audit(req.user.id, 'achievement_created', 'achievement', id, { key });
    res.status(201).json({ message: 'Achievement created', achievementId: id });
  });

  app.put('/api/achievements/:id', requirePermission('achievements.manage'), (req, res) => {
    const a = db.prepare('SELECT * FROM achievements WHERE id = ?').get(req.params.id);
    if (!a) return notFound(res, 'Achievement');
    const b = req.body || {};
    const fields = [];
    const params = [];
    if (b.name !== undefined) { fields.push('name = ?'); params.push(cleanText(b.name, 80)); }
    if (b.description !== undefined) { fields.push('description = ?'); params.push(cleanText(b.description, 300)); }
    if (b.icon !== undefined) { fields.push('icon = ?'); params.push(cleanText(b.icon, 10)); }
    if (b.criteria !== undefined) { fields.push('criteria = ?'); params.push(JSON.stringify(b.criteria || {})); }
    if (b.enabled !== undefined) { fields.push('enabled = ?'); params.push(b.enabled ? 1 : 0); }
    if (!fields.length) return badRequest(res, 'Nothing to update');
    params.push(a.id);
    db.prepare(`UPDATE achievements SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    db.audit(req.user.id, 'achievement_updated', 'achievement', a.id, { changed: Object.keys(b) });
    res.json({ message: 'Achievement updated' });
  });

  app.delete('/api/achievements/:id', requirePermission('achievements.manage'), (req, res) => {
    const a = db.prepare('SELECT * FROM achievements WHERE id = ?').get(req.params.id);
    if (!a) return notFound(res, 'Achievement');
    db.prepare('DELETE FROM achievements WHERE id = ?').run(a.id);
    db.audit(req.user.id, 'achievement_deleted', 'achievement', a.id, { key: a.key });
    res.json({ message: 'Achievement deleted' });
  });

  // ============================================
  // TEAMS (CS: 4v4 = 8 total players)
  // ============================================

  const CS_TEAM_SIZE = 4;

  app.get('/api/teams', optionalAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT t.*, u.username as captain_username,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
      FROM teams t LEFT JOIN users u ON u.id = t.captain_id
      ORDER BY t.created_at DESC LIMIT 100
    `).all();
    res.json({ teams: rows });
  });

  app.get('/api/teams/:id', optionalAuth, (req, res) => {
    const t = db.prepare(`
      SELECT t.*, u.username as captain_username FROM teams t
      LEFT JOIN users u ON u.id = t.captain_id WHERE t.id = ?
    `).get(req.params.id);
    if (!t) return notFound(res, 'Team');

    const members = db.prepare(`
      SELECT tm.user_id, tm.role, tm.joined_at, u.username, u.name
      FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?
      ORDER BY tm.role = 'captain' DESC, tm.joined_at ASC
    `).all(t.id);

    const invites = (req.user && (req.user.id === t.captain_id || (req.perms && req.perms.has('teams.manage')))
      ? db.prepare(`
          SELECT ti.id, ti.status, ti.created_at, u.username FROM team_invites ti
          JOIN users u ON u.id = ti.user_id WHERE ti.team_id = ?
        `).all(t.id)
      : []);

    // Team history: tournaments this team registered for
    const history = db.prepare(`
      SELECT t2.id, t2.name, t2.mode, t2.status, r.joined_at
      FROM tournament_registrations r
      JOIN tournaments t2 ON t2.id = r.tournament_id
      WHERE r.team_id = ? ORDER BY r.joined_at DESC
    `).all(t.id);

    res.json({ team: t, members, invites, history });
  });

  app.post('/api/teams', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const name = cleanText(b.name, 50);
      if (!name) return badRequest(res, 'Team name is required');
      if (db.prepare('SELECT id FROM teams WHERE lower(name) = lower(?)').get(name)) {
        return conflict(res, 'Team name already exists');
      }

      const id = db.makeId('TEM');
      db.tx(() => {
        db.prepare('INSERT INTO teams (id, tournament_id, name, tag, logo, captain_id, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, b.tournament_id || null, name, cleanText(b.tag || '', 8), cleanText(b.logo || '', 500),
               req.user.id, cleanText(b.description || '', 1000), req.user.id);
        db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'captain')").run(id, req.user.id);
        db.audit(req.user.id, 'team_created', 'team', id, { name });
      });
      res.status(201).json({ message: 'Team created', teamId: id });
    } catch (err) { serverError(res, err); }
  });

  app.put('/api/teams/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Team');
    const isCaptain = t.captain_id === req.user.id;
    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('teams.manage'));
    if (!isCaptain && !isStaff) return denied(res);

    const b = req.body || {};
    const fields = [];
    const params = [];
    if (b.name !== undefined) { fields.push('name = ?'); params.push(cleanText(b.name, 50)); }
    if (b.tag !== undefined) { fields.push('tag = ?'); params.push(cleanText(b.tag, 8)); }
    if (b.logo !== undefined) { fields.push('logo = ?'); params.push(cleanText(b.logo, 500)); }
    if (b.description !== undefined) { fields.push('description = ?'); params.push(cleanText(b.description, 1000)); }
    if (b.captain_id !== undefined && isStaff) {
      const cap = db.prepare('SELECT id FROM users WHERE id = ?').get(b.captain_id);
      if (!cap) return notFound(res, 'User');
      const isMember = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(t.id, b.captain_id);
      if (!isMember) return badRequest(res, 'New captain must be a team member');
      fields.push('captain_id = ?'); params.push(b.captain_id);
      db.prepare("UPDATE team_members SET role = 'member' WHERE team_id = ?").run(t.id);
      db.prepare("UPDATE team_members SET role = 'captain' WHERE team_id = ? AND user_id = ?").run(t.id, b.captain_id);
    }
    if (!fields.length) return badRequest(res, 'Nothing to update');
    params.push(t.id);
    db.prepare(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    db.audit(req.user.id, 'team_updated', 'team', t.id, { changed: Object.keys(b) });
    res.json({ message: 'Team updated' });
  });

  app.delete('/api/teams/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Team');
    const isCaptain = t.captain_id === req.user.id;
    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('teams.manage'));
    if (!isCaptain && !isStaff) return denied(res);
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
    db.audit(req.user.id, 'team_deleted', 'team', t.id, { name: t.name });
    res.json({ message: 'Team deleted' });
  });

  // Invite a player (captain or staff only; max 4 members for CS)
  app.post('/api/teams/:id/invites', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Team');
    const isCaptain = t.captain_id === req.user.id;
    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('teams.manage'));
    if (!isCaptain && !isStaff) return denied(res);

    const username = cleanText((req.body || {}).username, 30);
    if (!username) return badRequest(res, 'Username is required');
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
    if (!target) return notFound(res, 'User');

    const memberCount = db.prepare('SELECT COUNT(*) as c FROM team_members WHERE team_id = ?').get(t.id).c;
    if (memberCount >= CS_TEAM_SIZE) return conflict(res, `CS teams are limited to ${CS_TEAM_SIZE} players (4v4 = 8 total)`);
    if (db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(t.id, target.id)) {
      return conflict(res, 'User is already on this team');
    }
    const pending = db.prepare("SELECT id FROM team_invites WHERE team_id = ? AND user_id = ? AND status = 'pending'").get(t.id, target.id);
    if (pending) return conflict(res, 'Invite already pending');

    const id = db.makeId('INV');
    db.prepare('INSERT INTO team_invites (id, team_id, user_id, invited_by, status) VALUES (?, ?, ?, ?, ?)')
      .run(id, t.id, target.id, req.user.id, 'pending');
    notify(target.id, 'Team Invite', `You are invited to join ${t.name}`, 'team');
    db.audit(req.user.id, 'team_invite_sent', 'team', t.id, { invited: target.username });
    res.status(201).json({ message: `Invite sent to ${target.username}` });
  });

  app.post('/api/teams/invites/:id/respond', requireAuth, (req, res) => {
    const inv = db.prepare('SELECT * FROM team_invites WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!inv) return notFound(res, 'Invite');
    if (inv.status !== 'pending') return conflict(res, `Invite already ${inv.status}`);
    const accept = (req.body || {}).action === 'accept';

    if (accept) {
      const memberCount = db.prepare('SELECT COUNT(*) as c FROM team_members WHERE team_id = ?').get(inv.team_id).c;
      if (memberCount >= CS_TEAM_SIZE) return conflict(res, `Team is full (${CS_TEAM_SIZE} max for CS)`);
      db.tx(() => {
        db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(inv.team_id, req.user.id, 'member');
        db.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").run(inv.id);
      });
      db.audit(req.user.id, 'team_invite_accepted', 'team', inv.team_id, {});
      res.json({ message: 'You joined the team' });
    } else {
      db.prepare("UPDATE team_invites SET status = 'declined' WHERE id = ?").run(inv.id);
      res.json({ message: 'Invite declined' });
    }
  });

  app.delete('/api/teams/:id/members/:userId', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Team');
    const isCaptain = t.captain_id === req.user.id;
    const isSelf = req.user.id === req.params.userId;
    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('teams.manage'));
    if (!isCaptain && !isSelf && !isStaff) return denied(res);
    if (req.params.userId === t.captain_id && !isStaff) {
      return conflict(res, 'Transfer captaincy before removing the captain');
    }
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(t.id, req.params.userId);
    db.audit(req.user.id, 'team_member_removed', 'team', t.id, { user: req.params.userId });
    res.json({ message: 'Member removed' });
  });

  // Team members viewing own private ticket-free zone guard
  function denied(res) { return res.status(403).json({ error: 'ACCESS DENIED', code: 'ACCESS_DENIED' }); }
};
