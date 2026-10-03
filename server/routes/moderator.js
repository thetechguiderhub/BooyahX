/* ============================================
   BOOYAHX — MODERATOR DASHBOARD ROUTES
   ----------------------------------------
   Five sections: Tournament, Event, News, Coins,
   Money. Tournaments/Events/News reuse the EXISTING
   tables and endpoints (moderator.* permissions are
   aliases granted on those routes). This module adds
   what has no shared endpoint:

   - overview (real counts only)
   - event items (purchasable with Coins)
   - event item purchase (atomic wallet flow)
   - coins search + add/remove (reason required, audited)
   - money live board (real DB metrics; no fabrication)
   ============================================ */

module.exports = function moderatorRoutes(app, ctx) {
  const { db, requireAuth, requirePermission, optionalAuth } = ctx;
  const {
    badRequest, notFound, conflict, serverError,
    requireFields, asInt, cleanText, notify, applyWalletChange, isJoinable
  } = require('../helpers');

  const KINDS = ['item', 'avatar', 'frame', 'badge', 'template', 'decoration'];

  // ---------- OVERVIEW (real counts; zero means zero) ----------
  app.get('/api/moderator/overview', requirePermission('moderator.dashboard'), (req, res) => {
    try {
      const c = (sql, ...p) => db.prepare(sql).get(...p).c;
      res.json({
        tournament: {
          total: c('SELECT COUNT(*) as c FROM tournaments'),
          active: c("SELECT COUNT(*) as c FROM tournaments WHERE status IN ('upcoming','waiting','almost_full','full','live')"),
          registrations: c("SELECT COUNT(*) as c FROM tournament_registrations WHERE status = 'registered'")
        },
        event: {
          total: c('SELECT COUNT(*) as c FROM events'),
          published: c("SELECT COUNT(*) as c FROM events WHERE status = 'published'"),
          items: c('SELECT COUNT(*) as c FROM event_items WHERE active = 1'),
          purchases: c('SELECT COUNT(*) as c FROM event_purchases')
        },
        news: {
          total: c('SELECT COUNT(*) as c FROM news'),
          published: c("SELECT COUNT(*) as c FROM news WHERE status = 'published'"),
          drafts: c("SELECT COUNT(*) as c FROM news WHERE status = 'draft'")
        },
        coins: {
          total_in_circulation: db.prepare('SELECT COALESCE(SUM(balance), 0) as c FROM wallets').get().c
        }
      });
    } catch (err) { serverError(res, err); }
  });

  // ---------- EVENT ITEMS (real items; empty = none) ----------
  app.get('/api/moderator/events/:eventId/items', requirePermission('events.view', 'moderator.events.view'), (req, res) => {
    try {
      const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
      if (!ev) return notFound(res, 'Event');
      const rows = db.prepare(`
        SELECT i.*, (SELECT COUNT(*) FROM event_purchases p WHERE p.item_id = i.id) as purchased_count
        FROM event_items i WHERE i.event_id = ? ORDER BY i.created_at ASC
      `).all(ev.id);
      res.json({ event: ev, items: rows, empty: rows.length === 0 });
    } catch (err) { serverError(res, err); }
  });

  function validateItemBody(b) {
    const name = cleanText(b.name, 80);
    if (!name) return { error: 'Item name is required' };
    const kind = KINDS.includes(b.kind) ? b.kind : 'item';
    const price = Math.max(0, asInt(b.price_coins, 0));
    const stock = b.stock === undefined || b.stock === null || b.stock === '' ? null : asInt(b.stock, 0);
    if (stock !== null && stock < 0) return { error: 'Stock cannot be negative' };
    return { name, kind, price, stock, description: cleanText(b.description, 500) || null,
             asset_url: cleanText(b.asset_url, 400) || null, active: b.active === false ? 0 : 1 };
  }

  app.post('/api/moderator/events/:eventId/items', requirePermission('moderator.events.create'), (req, res) => {
    try {
      const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
      if (!ev) return notFound(res, 'Event');
      const v = validateItemBody(req.body || {});
      if (v.error) return badRequest(res, v.error);
      const id = db.makeId('EIT');
      db.prepare(`INSERT INTO event_items (id, event_id, name, description, kind, asset_url, price_coins, stock, active, created_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ev.id, v.name, v.description, v.kind, v.asset_url, v.price, v.stock, v.active, req.user.id);
      db.audit(req.user.id, 'event_item_created', 'event_item', id, { event: ev.id, name: v.name, price: v.price });
      res.status(201).json({ message: 'Item created', itemId: id });
    } catch (err) { serverError(res, err); }
  });

  app.put('/api/moderator/event-items/:id', requirePermission('moderator.events.update'), (req, res) => {
    try {
      const item = db.prepare('SELECT * FROM event_items WHERE id = ?').get(req.params.id);
      if (!item) return notFound(res, 'Event item');
      const b = req.body || {};
      const sets = []; const params = [];
      if (b.name !== undefined) { const n = cleanText(b.name, 80); if (!n) return badRequest(res, 'Name cannot be empty'); sets.push('name = ?'); params.push(n); }
      if (b.description !== undefined) { sets.push('description = ?'); params.push(cleanText(b.description, 500) || null); }
      if (b.kind !== undefined) { if (!KINDS.includes(b.kind)) return badRequest(res, 'Invalid item kind'); sets.push('kind = ?'); params.push(b.kind); }
      if (b.asset_url !== undefined) { sets.push('asset_url = ?'); params.push(cleanText(b.asset_url, 400) || null); }
      if (b.price_coins !== undefined) { const p = Math.max(0, asInt(b.price_coins, 0)); sets.push('price_coins = ?'); params.push(p); }
      if (b.stock !== undefined) { const s = b.stock === null || b.stock === '' ? null : asInt(b.stock, 0); if (s !== null && s < 0) return badRequest(res, 'Stock cannot be negative'); sets.push('stock = ?'); params.push(s); }
      if (b.active !== undefined) { sets.push('active = ?'); params.push(b.active ? 1 : 0); }
      if (!sets.length) return badRequest(res, 'Nothing to update');
      params.push(item.id);
      db.prepare(`UPDATE event_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      db.audit(req.user.id, 'event_item_updated', 'event_item', item.id, { changed: Object.keys(b) });
      res.json({ message: 'Item updated' });
    } catch (err) { serverError(res, err); }
  });

  app.delete('/api/moderator/event-items/:id', requirePermission('moderator.events.delete'), (req, res) => {
    try {
      const item = db.prepare('SELECT * FROM event_items WHERE id = ?').get(req.params.id);
      if (!item) return notFound(res, 'Event item');
      const sold = db.prepare('SELECT COUNT(*) as c FROM event_purchases WHERE item_id = ?').get(item.id).c;
      if (sold > 0) {
        // Respect real purchase records — deactivate instead of destroying history
        db.prepare('UPDATE event_items SET active = 0 WHERE id = ?').run(item.id);
        db.audit(req.user.id, 'event_item_deactivated', 'event_item', item.id, { reason: 'has real purchases', sold });
        return res.json({ message: 'Item has real purchases — deactivated instead of deleted' });
      }
      db.prepare('DELETE FROM event_items WHERE id = ?').run(item.id);
      db.audit(req.user.id, 'event_item_deleted', 'event_item', item.id, { name: item.name });
      res.json({ message: 'Item deleted' });
    } catch (err) { serverError(res, err); }
  });

  // ---------- PURCHASE (user-facing; atomic; real records only) ----------
  app.post('/api/events/:eventId/items/:itemId/purchase', requireAuth, (req, res) => {
    try {
      const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId);
      if (!ev) return notFound(res, 'Event');
      const item = db.prepare('SELECT * FROM event_items WHERE id = ? AND event_id = ?').get(req.params.itemId, ev.id);
      if (!item) return notFound(res, 'Event item');

      // 1) item active, 2) event published, 3) event not expired (server time)
      if (!item.active) return conflict(res, 'This item is not available');
      if (ev.status !== 'published') return conflict(res, 'Event is not active');
      const now = Date.now();
      const ends = Date.parse(ev.end_time);
      if (Number.isFinite(ends) && now > ends) return conflict(res, 'Event has expired');

      // 4) not already owned
      const owned = db.prepare('SELECT id FROM event_purchases WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id);
      if (owned) return conflict(res, 'You already own this item');

      // stock check
      if (item.stock !== null) {
        const sold = db.prepare('SELECT COUNT(*) as c FROM event_purchases WHERE item_id = ?').get(item.id).c;
        if (sold >= item.stock) return conflict(res, 'Item is sold out');
      }

      // 5-7) atomic coin deduction + purchase record + transaction
      const result = db.tx(() => {
        const w = applyWalletChange(req.user.id, {
          type: 'purchase', amount: -item.price_coins, reference: item.id,
          idempotencyKey: `event-purchase:${req.user.id}:${item.id}`
        });
        if (!w.ok) { const err = new Error(w.error || 'Purchase failed'); err.status = 400; throw err; }
        const pid = db.makeId('EPR');
        db.prepare(`INSERT INTO event_purchases (id, user_id, item_id, event_id, price_coins, transaction_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
          .run(pid, req.user.id, item.id, ev.id, item.price_coins, w.transactionId);
        return { purchaseId: pid, balance: w.balance, transactionId: w.transactionId };
      });

      // 8) audit + notify
      db.audit(req.user.id, 'event_item_purchased', 'event_item', item.id,
        { event: ev.id, item: item.name, price: item.price_coins, transaction: result.transactionId });
      notify(req.user.id, 'Purchase Complete', `You purchased "${item.name}" for ${item.price_coins} BX Coins`, 'wallet');

      // 9) real result
      res.status(201).json({
        message: `"${item.name}" purchased`,
        purchase: { id: result.purchaseId, item: item.name, price_coins: item.price_coins },
        balance: result.balance
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_COINS') return badRequest(res, 'Insufficient BX Coins for this purchase');
      if (err.status) return res.status(err.status).json({ error: err.message, code: 'BAD_REQUEST' });
      serverError(res, err);
    }
  });

  // Public: my purchases + event items for purchase page (real records only)
  app.get('/api/events/:eventId/items', optionalAuth, (req, res) => {
    try {
      const ev = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").get(req.params.eventId);
      if (!ev) return notFound(res, 'Event');
      const items = db.prepare('SELECT id, event_id, name, description, kind, asset_url, price_coins, stock, active FROM event_items WHERE event_id = ? AND active = 1').all(ev.id)
        .map(i => {
          const sold = db.prepare('SELECT COUNT(*) as c FROM event_purchases WHERE item_id = ?').get(i.id).c;
          return { ...i, remaining: i.stock === null ? null : Math.max(0, i.stock - sold), owned: req.user ? !!db.prepare('SELECT 1 FROM event_purchases WHERE user_id = ? AND item_id = ?').get(req.user.id, i.id) : false };
        });
      const myPurchases = req.user
        ? db.prepare(`SELECT p.id, p.item_id, p.price_coins, p.created_at, i.name as item_name FROM event_purchases p JOIN event_items i ON i.id = p.item_id WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(req.user.id)
        : [];
      res.json({ event: { id: ev.id, title: ev.title }, items, my_purchases: myPurchases });
    } catch (err) { serverError(res, err); }
  });

  // ---------- COINS (search real users; add/remove with mandatory reason) ----------
  app.get('/api/moderator/coins/users', requirePermission('moderator.coins.view'), (req, res) => {
    try {
      const q = cleanText(req.query.q, 80);
      if (!q || q.length < 2) return badRequest(res, 'Search by email, username or user ID (min 2 characters)');
      const rows = db.prepare(`
        SELECT u.id, u.username, u.name, u.email, u.status,
               COALESCE(w.balance, 0) as balance,
               (SELECT GROUP_CONCAT(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) as roles
        FROM users u LEFT JOIN wallets w ON w.user_id = u.id
        WHERE u.id = ? OR u.username LIKE ? OR u.email LIKE ? OR u.name LIKE ?
        ORDER BY u.username LIMIT 25
      `).all(q, `%${q}%`, `%${q}%`, `%${q}%`);
      res.json({ users: rows, empty: rows.length === 0 });
    } catch (err) { serverError(res, err); }
  });

  app.get('/api/moderator/coins/users/:id/history', requirePermission('moderator.coins.view'), (req, res) => {
    try {
      const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
      if (!target) return notFound(res, 'User');
      const rows = db.prepare('SELECT id, type, amount, reference, status, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(target.id);
      const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(target.id);
      res.json({ user: target, balance: wallet ? wallet.balance : 0, transactions: rows, empty: rows.length === 0 });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/moderator/coins/adjust', requirePermission('moderator.coins.adjust'), (req, res) => {
    try {
      const b = req.body || {};
      const missing = requireFields(b, ['user_id', 'action', 'amount', 'reason']);
      if (missing) return badRequest(res, missing);
      if (!['add', 'remove'].includes(b.action)) return badRequest(res, 'Action must be add or remove');

      const target = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(b.user_id, b.user_id);
      if (!target) return notFound(res, 'User');

      const amount = asInt(b.amount, 0);
      if (amount <= 0) return badRequest(res, 'Amount must be a positive number of BX Coins');
      if (amount > 1000000) return badRequest(res, 'Amount exceeds the single-adjustment limit');

      const reason = cleanText(b.reason, 300);
      if (!reason || reason.length < 5) return badRequest(res, 'A real reason (min 5 characters) is required');

      const delta = b.action === 'add' ? amount : -amount;
      const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(target.id);
      const previousBalance = wallet ? wallet.balance : 0;
      if (b.action === 'remove' && previousBalance < amount) {
        return badRequest(res, `User only has ${previousBalance} BX Coins — cannot remove ${amount}`);
      }

      const result = db.tx(() => {
        const w = applyWalletChange(target.id, {
          type: 'adjustment', amount: delta,
          reference: `mod:${req.user.id}:${reason.slice(0, 60)}`,
          idempotencyKey: `mod-adjust:${req.user.id}:${target.id}:${b.action}:${amount}:${Date.now()}`
        });
        if (!w.ok) { const err = new Error(w.error || 'Adjustment failed'); err.status = 400; throw err; }
        return w;
      });

      // Immutable audit record with full context
      db.audit(req.user.id, b.action === 'add' ? 'moderator_coins_added' : 'moderator_coins_removed',
        'user', target.id, {
          target_username: target.username,
          amount,
          action: b.action,
          reason,
          previous_balance: previousBalance,
          new_balance: result.balance,
          transaction_id: result.transactionId
        });
      notify(target.id, 'Wallet Update', `${b.action === 'add' ? '+' : '-'}${amount} BX Coins by staff. Reason: ${reason}`, 'wallet');

      res.json({
        message: `${amount} BX Coins ${b.action === 'add' ? 'added to' : 'removed from'} ${target.username}`,
        previous_balance: previousBalance,
        new_balance: result.balance,
        transaction_id: result.transactionId
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_COINS') return badRequest(res, 'Insufficient BX Coins');
      if (err.status) return res.status(err.status).json({ error: err.message, code: 'BAD_REQUEST' });
      serverError(res, err);
    }
  });

  // ---------- MONEY LIVE BOARD (real metrics only; zero = 00000) ----------
  const moneyGuard = requirePermission('moderator.money.view');

  app.get('/api/moderator/money', moneyGuard, (req, res) => {
    try {
      const g = (sql, ...p) => db.prepare(sql).get(...p);
      const verifiedDeposits = g("SELECT COALESCE(SUM(coins), 0) as c FROM deposits WHERE status = 'verified'").c;
      const completedWithdrawals = g("SELECT COALESCE(SUM(coins), 0) as c FROM withdrawals WHERE status = 'paid'").c;
      const pendingDeposits = g("SELECT COUNT(*) as c FROM deposits WHERE status IN ('pending','under_review')").c;
      const pendingWithdrawals = g("SELECT COUNT(*) as c FROM withdrawals WHERE status IN ('pending','under_review','approved','processing')").c;
      const reservedCoins = g("SELECT COALESCE(SUM(coins), 0) as c FROM withdrawals WHERE status IN ('pending','under_review','approved','processing')").c;
      const rejectedWithdrawals = g("SELECT COALESCE(SUM(coins), 0) as c FROM withdrawals WHERE status = 'rejected'").c;
      const rejectedDeposits = g("SELECT COUNT(*) as c FROM deposits WHERE status = 'rejected'").c;
      const coinsInCirculation = g('SELECT COALESCE(SUM(balance), 0) as c FROM wallets').c;

      res.json({
        // Every value below is a real database aggregate. Zero renders as 00000.
        total_deposited_coins: verifiedDeposits,
        total_withdrawn_coins: completedWithdrawals,
        pending_deposits: pendingDeposits,
        pending_withdrawals: pendingWithdrawals,
        reserved_coins: reservedCoins,
        rejected_withdrawals_coins: rejectedWithdrawals,
        rejected_deposits: rejectedDeposits,
        coins_in_circulation: coinsInCirculation,
        // Only metrics with a real DB source are returned. Real money (PKR)
        // amounts exist on deposits.amount — reported only as verified sums.
        total_deposited_pkr: g("SELECT COALESCE(SUM(amount), 0) as c FROM deposits WHERE status = 'verified'").c,
        updated_at: new Date().toISOString(),
        note: 'All values are live database aggregates. Nothing is estimated.'
      });
    } catch (err) { serverError(res, err); }
  });

  // ---------- TOURNAMENT helpers for the Moderator dashboard ----------
  app.get('/api/moderator/tournaments', requirePermission('moderator.tournaments.view'), (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT t.*,
          (SELECT COUNT(*) FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'registered') as registration_count,
          u.username as created_by_name
        FROM tournaments t LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.created_at DESC LIMIT 100
      `).all();
      res.json({
        tournaments: rows.map(t => ({ ...t, joinable: isJoinable(t) })),
        empty: rows.length === 0
      });
    } catch (err) { serverError(res, err); }
  });
};
