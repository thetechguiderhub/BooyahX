/* ============================================
   BOOYAHX — ECONOMY ROUTES
   Wallet, transactions, deposits, withdrawals,
   packages, promo codes, daily rewards, VIP,
   referrals.
   Server-side validation + idempotency only.
   ============================================ */

module.exports = function economyRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, requirePermission } = ctx;
  const {
    badRequest, notFound, conflict, serverError,
    requireFields, asInt, cleanText, notify, applyWalletChange,
    getSetting, emailConfigured, sendEmail
  } = require('../helpers');

  // ---------- WALLET ----------

  app.get('/api/wallet', requireAuth, (req, res) => {
    const wallet = db.prepare('SELECT balance, updated_at FROM wallets WHERE user_id = ?').get(req.user.id);
    // Coins currently reserved by active (not yet completed/rejected) withdrawals.
    const reserved = db.prepare("SELECT COALESCE(SUM(coins), 0) as c FROM withdrawals WHERE user_id = ? AND status IN ('pending','under_review','approved','processing')").get(req.user.id).c;
    res.json({
      wallet: wallet || { balance: 0, updated_at: null },
      reserved_coins: reserved
    });
  });

  app.get('/api/wallet/transactions', requireAuth, (req, res) => {
    const limit = Math.min(asInt(req.query.limit, 50), 200);
    const offset = Math.max(0, asInt(req.query.offset, 0));
    const rows = db.prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(req.user.id, limit, offset);
    const total = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE user_id = ?').get(req.user.id).c;
    res.json({ transactions: rows, total });
  });

  // ---------- COIN PACKAGES (public, owner-configurable) ----------

  app.get('/api/coin-packages', (req, res) => {
    const rows = db.prepare("SELECT id, name, coins, price_pkr, sort_order FROM coin_packages WHERE status = 'active' ORDER BY sort_order ASC").all();
    res.json({
      packages: rows,
      payment_status: emailConfigured() ? 'manual_review' : 'PAYMENT INTEGRATION NOT CONFIGURED',
      note: 'Deposits are manually reviewed by staff. No automatic payment confirmation.'
    });
  });

  app.post('/api/coin-packages', requirePermission('economy.manage'), (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 60);
    const coins = asInt(b.coins, 0);
    const price = Number(b.price_pkr);
    if (!name || coins <= 0 || !Number.isFinite(price) || price <= 0) {
      return badRequest(res, 'Name, positive coins and positive price are required');
    }
    const id = db.makeId('PKG');
    db.prepare('INSERT INTO coin_packages (id, name, coins, price_pkr, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, coins, price, asInt(b.sort_order, 0));
    db.audit(req.user.id, 'package_created', 'package', id, { name, coins, price });
    res.status(201).json({ message: 'Package created', packageId: id });
  });

  app.put('/api/coin-packages/:id', requirePermission('economy.manage'), (req, res) => {
    const p = db.prepare('SELECT * FROM coin_packages WHERE id = ?').get(req.params.id);
    if (!p) return notFound(res, 'Package');
    const b = req.body || {};
    const fields = [];
    const params = [];
    if (b.name !== undefined) { fields.push('name = ?'); params.push(cleanText(b.name, 60)); }
    if (b.coins !== undefined) { const c = asInt(b.coins, 0); if (c <= 0) return badRequest(res, 'Coins must be positive'); fields.push('coins = ?'); params.push(c); }
    if (b.price_pkr !== undefined) { const pr = Number(b.price_pkr); if (!Number.isFinite(pr) || pr <= 0) return badRequest(res, 'Price must be positive'); fields.push('price_pkr = ?'); params.push(pr); }
    if (b.status !== undefined) { if (!['active', 'inactive'].includes(b.status)) return badRequest(res, 'Invalid status'); fields.push('status = ?'); params.push(b.status); }
    if (b.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(asInt(b.sort_order, 0)); }
    if (!fields.length) return badRequest(res, 'Nothing to update');
    params.push(p.id);
    db.prepare(`UPDATE coin_packages SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    db.audit(req.user.id, 'package_updated', 'package', p.id, { changed: Object.keys(b) });
    res.json({ message: 'Package updated' });
  });

  app.delete('/api/coin-packages/:id', requirePermission('economy.manage'), (req, res) => {
    const p = db.prepare('SELECT * FROM coin_packages WHERE id = ?').get(req.params.id);
    if (!p) return notFound(res, 'Package');
    db.prepare('DELETE FROM coin_packages WHERE id = ?').run(p.id);
    db.audit(req.user.id, 'package_deleted', 'package', p.id, { name: p.name });
    res.json({ message: 'Package deleted' });
  });

  // ---------- PAYMENT METHODS (backend-configured, never hardcoded in frontend) ----------
  // Availability comes from platform_settings. Nothing auto-enables on a timer.
  const PAYMENT_METHODS = ['jazzcash', 'easypaisa', 'bank'];

  function methodStatus(kind, method) {
    // kind: 'deposit' | 'withdraw'; method: jazzcash | easypaisa | bank
    const enabled = getSetting(`${kind}_${method}_enabled`, method === 'jazzcash' ? 'true' : 'false') === 'true';
    const message = getSetting(`${method}_status_message`, method === 'bank' ? 'Coming in 3 days' : 'Coming Soon');
    return { method, enabled, message: enabled ? 'AVAILABLE' : message };
  }

  app.get('/api/payment-methods', (req, res) => {
    const methods = kind => PAYMENT_METHODS.map(m => methodStatus(kind, m));
    const jazzEnabled = getSetting('deposit_jazzcash_enabled', 'true') === 'true';
    res.json({
      deposit: methods('deposit'),
      withdraw: methods('withdraw'),
      jazzcash: jazzEnabled ? {
        provider: 'JazzCash',
        account_name: getSetting('jazzcash_account_name', ''),
        account_number: getSetting('jazzcash_account_number', '')
      } : null,
      note: 'Deposits and withdrawals are reviewed by staff. Nothing is ever auto-approved.'
    });
  });

  // ---------- DEPOSITS (user submits; staff reviews) ----------

  app.post('/api/deposits', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const missing = requireFields(b, ['package_id', 'payment_method', 'reference']);
      if (missing) return badRequest(res, missing);
      if (!PAYMENT_METHODS.includes(b.payment_method)) {
        return badRequest(res, 'Payment method must be jazzcash, easypaisa or bank');
      }
      const depStatus = methodStatus('deposit', b.payment_method);
      if (!depStatus.enabled) {
        return badRequest(res, `${depStatus.method.toUpperCase()} deposits are not available: ${depStatus.message}`);
      }

      const pkg = db.prepare("SELECT * FROM coin_packages WHERE id = ? AND status = 'active'").get(b.package_id);
      if (!pkg) return notFound(res, 'Package');

      const reference = cleanText(b.reference, 80);
      if (reference.length < 4) return badRequest(res, 'Payment reference is too short');

      // Duplicate reference protection
      const dup = db.prepare(
        "SELECT id FROM deposits WHERE reference = ? AND payment_method = ? AND status NOT IN ('rejected')"
      ).get(reference, b.payment_method);
      if (dup) return conflict(res, 'This payment reference has already been submitted');

      const id = db.makeId('DEP');
      db.prepare(`
        INSERT INTO deposits (id, user_id, package_id, package_name, amount, coins, payment_method, reference, proof, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(id, req.user.id, pkg.id, pkg.name, pkg.price_pkr, pkg.coins,
             b.payment_method, reference, cleanText(b.proof || '', 300));

      db.audit(req.user.id, 'deposit_submitted', 'deposit', id, { package: pkg.name, coins: pkg.coins, method: b.payment_method });
      notify(req.user.id, 'Deposit Submitted', `Your deposit of ${pkg.coins} coins is pending review`, 'wallet');

      res.status(201).json({
        message: 'Deposit submitted for review',
        deposit: { id, status: 'pending', coins: pkg.coins, package_name: pkg.name },
        note: 'Deposits are verified manually. Coins are added only after approval.'
      });
    } catch (err) { serverError(res, err); }
  });

  app.get('/api/deposits/me', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT id, package_name, amount, coins, payment_method, reference, status, review_notes, created_at, reviewed_at FROM deposits WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ deposits: rows });
  });

  // Staff list (owner/finance)
  app.get('/api/deposits', requirePermission('deposits.view'), (req, res) => {
    try {
      const status = req.query.status;
      const limit = Math.min(asInt(req.query.limit, 50), 200);
      let query = `
        SELECT d.*, u.username, u.name as user_name, r.username as reviewer_name
        FROM deposits d JOIN users u ON u.id = d.user_id
        LEFT JOIN users r ON r.id = d.reviewed_by WHERE 1=1`;
      const params = [];
      if (status) { query += ' AND d.status = ?'; params.push(status); }
      query += ' ORDER BY d.created_at DESC LIMIT ?';
      params.push(limit);
      const rows = db.prepare(query).all(...params);
      const counts = {
        pending: db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'pending'").get().c,
        under_review: db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'under_review'").get().c,
        verified: db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'verified'").get().c,
        rejected: db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'rejected'").get().c
      };
      res.json({ deposits: rows, counts });
    } catch (err) { serverError(res, err); }
  });

  // Approve → verified + credit coins (atomic, idempotent)
  app.post('/api/deposits/:id/approve', requirePermission('deposits.verify'), (req, res) => {
    try {
      const d = db.prepare('SELECT * FROM deposits WHERE id = ?').get(req.params.id);
      if (!d) return notFound(res, 'Deposit');
      if (d.status === 'verified') return conflict(res, 'Deposit already verified');
      if (d.status === 'rejected') return conflict(res, 'Deposit was rejected');

      const notes = cleanText((req.body || {}).notes, 500);

      const result = db.tx(() => {
        const upd = db.prepare(
          "UPDATE deposits SET status = 'verified', reviewed_by = ?, reviewed_at = datetime('now'), review_notes = ? WHERE id = ? AND status != 'verified'"
        ).run(req.user.id, notes, d.id);
        if (upd.changes !== 1) {
          const err = new Error('Deposit already processed');
          err.status = 409; throw err;
        }
        const w = applyWalletChange(d.user_id, {
          type: 'deposit', amount: d.coins, reference: d.id,
          idempotency_key: `deposit:${d.id}`
        });
        db.prepare('UPDATE deposits SET transaction_id = ? WHERE id = ?').run(w.transactionId, d.id);
        return w;
      });

      notify(d.user_id, 'Deposit Verified', `${d.coins} coins added to your wallet`, 'wallet');
      sendEmail(d.user_id, '', 'deposit_update', { username: 'player', amount: d.coins, status: 'VERIFIED' });
      db.audit(req.user.id, 'deposit_approved', 'deposit', d.id, { coins: d.coins, user: d.user_id });

      res.json({ message: 'Deposit verified and coins credited', balance: result.balance });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: 'CONFLICT' });
      serverError(res, err);
    }
  });

  app.post('/api/deposits/:id/reject', requirePermission('deposits.reject'), (req, res) => {
    const d = db.prepare('SELECT * FROM deposits WHERE id = ?').get(req.params.id);
    if (!d) return notFound(res, 'Deposit');
    if (d.status === 'verified') return conflict(res, 'Deposit already verified — cannot reject');

    const notes = cleanText((req.body || {}).notes, 500);
    if (!notes) return badRequest(res, 'A rejection reason is required');
    db.prepare("UPDATE deposits SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), review_notes = ? WHERE id = ?")
      .run(req.user.id, notes, d.id);

    notify(d.user_id, 'Deposit Rejected', `Your deposit was rejected.${notes ? ' Reason: ' + notes : ''}`, 'wallet');
    sendEmail(d.user_id, '', 'deposit_update', { username: 'player', amount: d.coins, status: 'REJECTED' });
    db.audit(req.user.id, 'deposit_rejected', 'deposit', d.id, { user: d.user_id, notes });
    res.json({ message: 'Deposit rejected. No coins were added.' });
  });

  // ---------- WITHDRAWALS ----------

  const MIN_WITHDRAWAL = () => asInt(getSetting('withdrawal_min_coins', '100'), 100);

  app.post('/api/withdrawals', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const missing = requireFields(b, ['coins', 'payment_method', 'destination_info']);
      if (missing) return badRequest(res, missing);
      if (!PAYMENT_METHODS.includes(b.payment_method)) {
        return badRequest(res, 'Payment method must be jazzcash, easypaisa or bank');
      }
      const wdStatus = methodStatus('withdraw', b.payment_method);
      if (!wdStatus.enabled) {
        return badRequest(res, `${wdStatus.method.toUpperCase()} withdrawals are not available: ${wdStatus.message}`);
      }

      // Validate destination details per method. For JazzCash the user must
      // supply a real account number and account holder name.
      let destination = cleanText(b.destination_info, 200);
      if (b.payment_method === 'jazzcash') {
        const acct = cleanText(b.account_number || '', 30).replace(/[\s-]/g, '');
        const holder = cleanText(b.account_holder_name || '', 60);
        if (!/^[0-9]{10,15}$/.test(acct)) {
          return badRequest(res, 'A valid JazzCash account number (10-15 digits) is required');
        }
        if (holder.length < 3) {
          return badRequest(res, 'Account holder name is required');
        }
        destination = JSON.stringify({
          provider: 'JazzCash',
          account_number: acct,
          account_holder_name: holder,
          extra: cleanText(b.reference_info || '', 120) || undefined
        });
      }
      if (destination.length < 5) return badRequest(res, 'Valid destination details are required');

      const coins = asInt(b.coins, 0);
      const min = MIN_WITHDRAWAL();
      if (coins < min) return badRequest(res, `Minimum withdrawal is ${min} coins`);

      // Optional verification requirement (owner-configured)
      if (getSetting('withdrawal_requires_verification', 'false') === 'true') {
        const verified = db.prepare(
          "SELECT id FROM user_verifications WHERE user_id = ? AND status = 'verified'"
       	).get(req.user.id);
        if (!verified) return conflict(res, 'Account verification is required for withdrawals');
      }

      // One active withdrawal at a time (prevents double-spending the same coins)
      const active = db.prepare(
        "SELECT id FROM withdrawals WHERE user_id = ? AND status IN ('pending', 'under_review', 'approved', 'processing')"
      ).get(req.user.id);
      if (active) return conflict(res, 'You already have an active withdrawal request');

      const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(req.user.id);
      if (!wallet || wallet.balance < coins) return badRequest(res, 'Insufficient coins');

      const id = db.makeId('WDR');
      const created = db.tx(() => {
        // Reserve the coins atomically so they cannot be double-spent
        const upd = db.prepare(
          "UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?"
        ).run(coins, req.user.id, coins);
        if (upd.changes !== 1) {
          const err = new Error('Insufficient coins');
          err.status = 400; throw err;
        }
        db.prepare('INSERT INTO transactions (id, user_id, type, amount, reference, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(db.makeId('TXN'), req.user.id, 'withdrawal', -coins, id, 'pending', `withdrawal:${id}`);
        db.prepare(`
          INSERT INTO withdrawals (id, user_id, coins, payment_method, destination_info, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(id, req.user.id, coins, b.payment_method, destination);
        return true;
      });

      notify(req.user.id, 'Withdrawal Requested', `${coins} coins withdrawal submitted for review`, 'wallet');
      db.audit(req.user.id, 'withdrawal_requested', 'withdrawal', id, { coins, method: b.payment_method });
      res.status(201).json({ message: 'Withdrawal requested. Coins reserved pending review.', withdrawalId: id });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: 'BAD_REQUEST' });
      serverError(res, err);
    }
  });

  app.get('/api/withdrawals/me', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT id, coins, payment_method, status, review_notes, created_at, reviewed_at, paid_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ withdrawals: rows, minimum: MIN_WITHDRAWAL() });
  });

  app.get('/api/withdrawals', requirePermission('withdrawals.view'), (req, res) => {
    try {
      const status = req.query.status;
      const limit = Math.min(asInt(req.query.limit, 50), 200);
      let query = `
        SELECT w.*, u.username, u.name as user_name, r.username as reviewer_name
        FROM withdrawals w JOIN users u ON u.id = w.user_id
        LEFT JOIN users r ON r.id = w.reviewed_by WHERE 1=1`;
      const params = [];
      if (status) { query += ' AND w.status = ?'; params.push(status); }
      query += ' ORDER BY w.created_at DESC LIMIT ?';
      params.push(limit);
      const rows = db.prepare(query).all(...params);
      const counts = {
        pending: db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'").get().c,
        approved: db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'approved'").get().c,
        processing: db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'processing'").get().c,
        paid: db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'paid'").get().c,
        rejected: db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'rejected'").get().c
      };
      // Coins currently held (reserved) across all unfinished withdrawals.
      const reserved_coins = db.prepare("SELECT COALESCE(SUM(coins), 0) as c FROM withdrawals WHERE status IN ('pending','under_review','approved','processing')").get().c;
      res.json({ withdrawals: rows, counts, reserved_coins });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/withdrawals/:id/approve', requirePermission('withdrawals.approve'), (req, res) => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
    if (!w) return notFound(res, 'Withdrawal');
    if (['paid', 'rejected'].includes(w.status)) return conflict(res, `Withdrawal already ${w.status}`);

    const b = req.body || {};
    const notes = cleanText(b.notes, 500);
    const nextStatus = ['approved', 'processing', 'paid'].includes(b.to) ? b.to : 'approved';

    // COMPLETED (paid) may only be recorded when the owner records the REAL
    // payout that actually happened. A payout reference is mandatory.
    const payoutReference = cleanText(b.payout_reference, 100);
    if (nextStatus === 'paid' && !payoutReference && !w.payout_reference) {
      return badRequest(res, 'A real payout reference is required to mark this withdrawal completed');
    }

    db.prepare('UPDATE withdrawals SET status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?, payout_reference = COALESCE(?, payout_reference) WHERE id = ?')
      .run(nextStatus, req.user.id, new Date().toISOString(), notes, payoutReference || null, w.id);

    if (nextStatus === 'paid') {
      // Coins were already reserved at request time; finalize the transaction record.
      db.tx(() => {
        db.prepare("UPDATE transactions SET status = 'completed', reference = ? WHERE idempotency_key = ?")
          .run(w.id, `withdrawal:${w.id}`);
        db.prepare('UPDATE withdrawals SET paid_at = datetime(\'now\'), transaction_id = (SELECT id FROM transactions WHERE idempotency_key = ?) WHERE id = ?')
          .run(`withdrawal:${w.id}`, w.id);
      });
      db.audit(req.user.id, 'withdrawal_paid', 'withdrawal', w.id, { coins: w.coins, user: w.user_id, payout_reference: payoutReference || w.payout_reference });
      notify(w.user_id, 'Withdrawal Paid', `Your withdrawal of ${w.coins} coins has been paid`, 'wallet');
      sendEmail(w.user_id, '', 'withdrawal_update', { username: 'player', amount: w.coins, status: 'PAID' });
    } else {
      db.audit(req.user.id, `withdrawal_${nextStatus}`, 'withdrawal', w.id, { coins: w.coins });
      notify(w.user_id, 'Withdrawal Update', `Your withdrawal is now: ${nextStatus.toUpperCase()}`, 'wallet');
    }
    res.json({ message: `Withdrawal ${nextStatus}`, status: nextStatus });
  });

  app.post('/api/withdrawals/:id/reject', requirePermission('withdrawals.reject'), (req, res) => {
    try {
      const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
      if (!w) return notFound(res, 'Withdrawal');
      if (w.status === 'paid') return conflict(res, 'Withdrawal already paid — cannot reject');

      const notes = cleanText((req.body || {}).notes, 500);
      if (!notes) return badRequest(res, 'A rejection reason is required');

      db.tx(() => {
        db.prepare("UPDATE withdrawals SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), review_notes = ? WHERE id = ?")
          .run(req.user.id, notes, w.id);
        // Restore reserved coins through a recorded transaction
        const r = applyWalletChange(w.user_id, {
          type: 'refund', amount: w.coins, reference: w.id,
          idempotency_key: `withdrawal-reject:${w.id}`
        });
        db.prepare('UPDATE withdrawals SET transaction_id = ? WHERE id = ?').run(r.transactionId, w.id);
      });

      notify(w.user_id, 'Withdrawal Rejected', `Your withdrawal was rejected and ${w.coins} coins restored.${notes ? ' Reason: ' + notes : ''}`, 'wallet');
      sendEmail(w.user_id, '', 'withdrawal_update', { username: 'player', amount: w.coins, status: 'REJECTED' });
      db.audit(req.user.id, 'withdrawal_rejected', 'withdrawal', w.id, { coins: w.coins, user: w.user_id, notes });
      res.json({ message: 'Withdrawal rejected and coins restored' });
    } catch (err) { serverError(res, err); }
  });

  // ---------- PROMO CODES ----------

  app.post('/api/promo-codes', requirePermission('promos.manage'), (req, res) => {
    const b = req.body || {};
    const code = cleanText(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const coins = asInt(b.coins, 0);
    if (!code || coins <= 0) return badRequest(res, 'Code and positive coins are required');
    if (db.prepare('SELECT id FROM promo_codes WHERE code = ?').get(code)) return conflict(res, 'Code already exists');

    const id = db.makeId('PRM');
    db.prepare('INSERT INTO promo_codes (id, code, coins, max_uses, expires_at, enabled, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(id, code, coins, b.max_uses ? asInt(b.max_uses, 0) : null, b.expires_at || null, req.user.id);
    db.audit(req.user.id, 'promo_created', 'promo', id, { code, coins });
    res.status(201).json({ message: 'Promo code created', promoId: id });
  });

  app.get('/api/promo-codes', requirePermission('promos.manage'), (req, res) => {
    const rows = db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all();
    res.json({ promoCodes: rows });
  });

  app.delete('/api/promo-codes/:id', requirePermission('promos.manage'), (req, res) => {
    const p = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id);
    if (!p) return notFound(res, 'Promo code');
    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(p.id);
    db.audit(req.user.id, 'promo_deleted', 'promo', p.id, { code: p.code });
    res.json({ message: 'Promo code deleted' });
  });

  app.post('/api/promo-codes/redeem', requireAuth, (req, res) => {
    try {
      const code = cleanText((req.body || {}).code, 30).toUpperCase();
      if (!code) return badRequest(res, 'Code is required');

      const result = db.tx(() => {
        const p = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND enabled = 1').get(code);
        if (!p) { const err = new Error('Invalid promo code'); err.status = 404; err.code = 'NOT_FOUND'; throw err; }
        if (p.expires_at && Date.parse(p.expires_at) < Date.now()) {
          const err = new Error('Promo code has expired'); err.status = 409; err.code = 'EXPIRED'; throw err;
        }
        if (p.max_uses && p.used_count >= p.max_uses) {
          const err = new Error('Promo code has reached its usage limit'); err.status = 409; err.code = 'LIMIT_REACHED'; throw err;
        }
        const already = db.prepare('SELECT id FROM promo_redemptions WHERE promo_id = ? AND user_id = ?').get(p.id, req.user.id);
        if (already) { const err = new Error('You already redeemed this code'); err.status = 409; err.code = 'ALREADY_USED'; throw err; }

        db.prepare('INSERT INTO promo_redemptions (id, promo_id, user_id) VALUES (?, ?, ?)')
          .run(db.makeId('RDM'), p.id, req.user.id);
        db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?').run(p.id);

        const w = applyWalletChange(req.user.id, {
          type: 'bonus', amount: p.coins, reference: p.id, idempotency_key: `promo:${p.id}:${req.user.id}`
        });
        return { coins: p.coins, balance: w.balance };
      });

      notify(req.user.id, 'Promo Redeemed', `+${result.coins} coins from promo code`, 'wallet');
      db.audit(req.user.id, 'promo_redeemed', 'promo', code, { coins: result.coins });
      res.json({ message: `Redeemed! +${result.coins} coins`, balance: result.balance });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      serverError(res, err);
    }
  });

  // ---------- DAILY REWARDS ----------

  app.get('/api/daily-reward', requireAuth, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const claimed = db.prepare('SELECT * FROM daily_claims WHERE user_id = ? AND claim_date = ?').get(req.user.id, today);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const claimedYesterday = db.prepare('SELECT streak FROM daily_claims WHERE user_id = ? AND claim_date = ?').get(req.user.id, yesterday);
    const lastClaim = db.prepare('SELECT claim_date, streak FROM daily_claims WHERE user_id = ? ORDER BY claim_date DESC LIMIT 1').get(req.user.id);

    const base = asInt(getSetting('daily_reward_base', '5'), 5);
    const bonus = asInt(getSetting('daily_reward_streak_bonus', '2'), 2);
    const projectedStreak = claimedYesterday ? (claimedYesterday.streak + 1) : 1;
    const projectedReward = base + (projectedStreak - 1) * bonus;

    res.json({
      claimed_today: Boolean(claimed),
      today: today,
      current_streak: lastClaim ? lastClaim.streak : 0,
      next_reward: claimed ? null : projectedReward,
      next_streak: claimed ? null : projectedStreak,
      config: { base, bonus }
    });
  });

  app.post('/api/daily-reward/claim', requireAuth, (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const result = db.tx(() => {
        // Duplicate protection: UNIQUE(user_id, claim_date) + explicit check
        const existing = db.prepare('SELECT id FROM daily_claims WHERE user_id = ? AND claim_date = ?').get(req.user.id, today);
        if (existing) {
          const err = new Error('Daily reward already claimed today');
          err.status = 409; err.code = 'ALREADY_CLAIMED';
          throw err;
        }

        const claimedYesterday = db.prepare('SELECT streak FROM daily_claims WHERE user_id = ? AND claim_date = ?').get(req.user.id, yesterday);
        const streak = claimedYesterday ? claimedYesterday.streak + 1 : 1;

        const base = asInt(getSetting('daily_reward_base', '5'), 5);
        const bonus = asInt(getSetting('daily_reward_streak_bonus', '2'), 2);
        const coins = base + (streak - 1) * bonus;

        db.prepare('INSERT INTO daily_claims (id, user_id, claim_date, coins, streak) VALUES (?, ?, ?, ?, ?)')
          .run(db.makeId('DLY'), req.user.id, today, coins, streak);

        const w = applyWalletChange(req.user.id, {
          type: 'daily_reward', amount: coins, reference: today,
          idempotency_key: `daily:${req.user.id}:${today}`
        });
        return { coins, streak, balance: w.balance };
      });

      notify(req.user.id, 'Daily Reward', `+${result.coins} coins (streak day ${result.streak})`, 'wallet');
      res.json({ message: `Claimed ${result.coins} coins`, ...result });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      serverError(res, err);
    }
  });

  // ---------- VIP ----------

  app.get('/api/vip/tiers', optionalAuth, (req, res) => {
    const rows = db.prepare("SELECT * FROM vip_tiers WHERE status = 'active' ORDER BY level ASC").all();
    res.json({ tiers: rows });
  });

  app.get('/api/vip/me', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT uv.*, vt.name, vt.level, vt.benefits
      FROM user_vip uv JOIN vip_tiers vt ON vt.id = uv.tier_id
      WHERE uv.user_id = ? AND uv.status = 'active'
      ORDER BY vt.level DESC
    `).all(req.user.id);
    res.json({ memberships: rows });
  });

  app.post('/api/vip/tiers', requirePermission('economy.manage'), (req, res) => {
    const b = req.body || {};
    if (!b.name) return badRequest(res, 'Name is required');
    const id = db.makeId('VIP');
    db.prepare('INSERT INTO vip_tiers (id, name, level, benefits, price_coins, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, cleanText(b.name, 60), asInt(b.level, 1),
           JSON.stringify(Array.isArray(b.benefits) ? b.benefits : []),
           Math.max(0, asInt(b.price_coins, 0)),
           ['active', 'inactive'].includes(b.status) ? b.status : 'active');
    db.audit(req.user.id, 'vip_tier_created', 'vip_tier', id, { name: b.name });
    res.status(201).json({ message: 'VIP tier created', tierId: id });
  });

  app.put('/api/vip/tiers/:id', requirePermission('economy.manage'), (req, res) => {
    const t = db.prepare('SELECT * FROM vip_tiers WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'VIP tier');
    const b = req.body || {};
    const fields = [];
    const params = [];
    if (b.name !== undefined) { fields.push('name = ?'); params.push(cleanText(b.name, 60)); }
    if (b.level !== undefined) { fields.push('level = ?'); params.push(asInt(b.level, 1)); }
    if (b.benefits !== undefined) { fields.push('benefits = ?'); params.push(JSON.stringify(Array.isArray(b.benefits) ? b.benefits : [])); }
    if (b.price_coins !== undefined) { fields.push('price_coins = ?'); params.push(Math.max(0, asInt(b.price_coins, 0))); }
    if (b.status !== undefined) { if (!['active', 'inactive'].includes(b.status)) return badRequest(res, 'Invalid status'); fields.push('status = ?'); params.push(b.status); }
    if (!fields.length) return badRequest(res, 'Nothing to update');
    params.push(t.id);
    db.prepare(`UPDATE vip_tiers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    db.audit(req.user.id, 'vip_tier_updated', 'vip_tier', t.id, { changed: Object.keys(b) });
    res.json({ message: 'VIP tier updated' });
  });

  // Grant VIP — only against a REAL payment/subscription record
  app.post('/api/vip/grant', requirePermission('economy.manage'), (req, res) => {
    const b = req.body || {};
    const tier = db.prepare('SELECT * FROM vip_tiers WHERE id = ?').get(b.tier_id);
    if (!tier) return notFound(res, 'VIP tier');
    const userId = cleanText(b.user_id, 40);
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return notFound(res, 'User');
    const paymentRef = cleanText(b.payment_ref || '', 100);

    if (tier.price_coins > 0 && !paymentRef) {
      return badRequest(res, 'A real payment reference is required to grant a paid VIP tier');
    }

    const id = db.makeId('USV');
    db.prepare('INSERT INTO user_vip (id, user_id, tier_id, source, payment_ref, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, tier.id, paymentRef ? 'payment' : 'manual', paymentRef || null, 'active', b.expires_at || null);
    notify(userId, 'VIP Activated', `Your ${tier.name} membership is active`, 'vip');
    db.audit(req.user.id, 'vip_granted', 'user_vip', id, { user: userId, tier: tier.name, payment_ref: paymentRef || 'none' });
    res.status(201).json({ message: 'VIP granted', membershipId: id });
  });

  app.delete('/api/vip/grant/:id', requirePermission('economy.manage'), (req, res) => {
    const m = db.prepare('SELECT * FROM user_vip WHERE id = ?').get(req.params.id);
    if (!m) return notFound(res, 'VIP membership');
    db.prepare("UPDATE user_vip SET status = 'revoked' WHERE id = ?").run(m.id);
    db.audit(req.user.id, 'vip_revoked', 'user_vip', m.id, { user: m.user_id });
    res.json({ message: 'VIP revoked' });
  });

  // ---------- REFERRALS / AFFILIATE ----------

  app.get('/api/referrals/me', requireAuth, (req, res) => {
    let code = db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').get(req.user.id);
    if (!code) {
      const generated = (req.user.username || req.user.id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10) + Math.floor(Math.random() * 900 + 100);
      db.prepare('INSERT INTO referral_codes (code, user_id) VALUES (?, ?)').run(generated, req.user.id);
      code = db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').get(req.user.id);
    }

    const referrals = db.prepare(`
      SELECT r.id, r.status, r.created_at, r.qualified_at, u.username as referred_username
      FROM referrals r JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = ? ORDER BY r.created_at DESC
    `).all(req.user.id);

    const commissions = db.prepare(`
      SELECT rc.*, r.status as referral_status FROM referral_commissions rc
      JOIN referrals r ON r.id = rc.referral_id
      WHERE rc.referrer_id = ? ORDER BY rc.created_at DESC
    `).all(req.user.id);

    const payable = commissions.filter(c => c.status === 'payable').reduce((s, c) => s + c.amount, 0);
    res.json({ code: code.code, enabled: Boolean(code.enabled), referrals, commissions, payable_coins: payable });
  });

  app.post('/api/referrals/apply', requireAuth, (req, res) => {
    try {
      const codeStr = cleanText((req.body || {}).code, 30);
      if (!codeStr) return badRequest(res, 'Code is required');

      const refCode = db.prepare('SELECT * FROM referral_codes WHERE code = ? AND enabled = 1').get(codeStr);
      if (!refCode) return notFound(res, 'Referral code');
      if (refCode.user_id === req.user.id) return badRequest(res, 'You cannot use your own referral code');
      if (db.prepare('SELECT id FROM referrals WHERE referred_id = ?').get(req.user.id)) {
        return conflict(res, 'A referral is already linked to your account');
      }

      const id = db.makeId('REF');
      db.tx(() => {
        db.prepare('INSERT INTO referrals (id, referrer_id, referred_id, code, status) VALUES (?, ?, ?, ?, ?)')
          .run(id, refCode.user_id, req.user.id, codeStr, 'pending');
        // Commission stays pending until eligibility (real activity) is met
        const bonus = asInt(getSetting('referral_bonus_coins', '25'), 25);
        if (bonus > 0) {
          db.prepare('INSERT INTO referral_commissions (id, referral_id, referrer_id, amount, status, reason) VALUES (?, ?, ?, ?, ?, ?)')
            .run(db.makeId('COM'), id, refCode.user_id, bonus, 'pending', 'Awaiting referred user eligibility (first completed tournament)');
        }
        db.audit(req.user.id, 'referral_applied', 'referral', id, { referrer: refCode.user_id });
      });

      res.json({ message: 'Referral code applied. Commission pending eligibility.' });
    } catch (err) { serverError(res, err); }
  });

  // Qualify commissions after real activity (called by results publishing)
  db.qualifyReferrals = function qualifyReferrals(userId) {
    const rows = db.prepare("SELECT * FROM referrals WHERE referred_id = ? AND status = 'pending'").all(userId);
    for (const ref of rows) {
      db.prepare("UPDATE referrals SET status = 'qualified', qualified_at = datetime('now') WHERE id = ?").run(ref.id);
      db.prepare("UPDATE referral_commissions SET status = 'payable' WHERE referral_id = ? AND status = 'pending'").run(ref.id);
      const comm = db.prepare('SELECT amount FROM referral_commissions WHERE referral_id = ?').get(ref.id);
      notify(ref.referrer_id, 'Referral Qualified',
        `Your referral earned a commission of ${comm ? comm.amount : 0} coins (pending payout rules)`, 'affiliate');
    }
    return rows.length;
  };
};
