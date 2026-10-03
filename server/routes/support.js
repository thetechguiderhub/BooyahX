/* ============================================
   BOOYAHX — SUPPORT & MODERATION ROUTES
   Tickets, feedback, reports, notifications.
   ============================================ */

module.exports = function supportRoutes(app, ctx) {
  const { db, requireAuth, optionalAuth, requirePermission } = ctx;
  const {
    badRequest, notFound, denied, conflict, serverError,
    requireFields, asInt, cleanText, notify, sendEmail
  } = require('../helpers');

  // ============================================
  // SUPPORT TICKETS
  // ============================================

  app.post('/api/support/tickets', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const missing = requireFields(b, ['category', 'subject', 'message']);
      if (missing) return badRequest(res, missing);
      if (!['account', 'payment', 'tournament', 'technical', 'other'].includes(b.category)) {
        return badRequest(res, 'Invalid category');
      }

      const id = db.makeId('TKT');
      const code = 'BX-' + String(Date.now()).slice(-8) + '-' + Math.floor(Math.random() * 900 + 100);
      const priority = ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : 'normal';

      db.tx(() => {
        db.prepare(`
          INSERT INTO support_tickets (id, ticket_code, user_id, category, priority, subject, status)
          VALUES (?, ?, ?, ?, ?, ?, 'open')
        `).run(id, code, req.user.id, b.category, priority, cleanText(b.subject, 200));
        db.prepare('INSERT INTO ticket_messages (id, ticket_id, sender_id, message) VALUES (?, ?, ?, ?)')
          .run(db.makeId('MSG'), id, req.user.id, cleanText(b.message, 8000));
        db.audit(req.user.id, 'ticket_created', 'ticket', id, { code, category: b.category });
      });

      res.status(201).json({ message: 'Ticket created', ticket: { id, ticket_code: code, status: 'open' } });
    } catch (err) { serverError(res, err); }
  });

  app.get('/api/support/tickets', requireAuth, (req, res) => {
    try {
      const isStaff = req.perms && (req.perms.has('*') || req.perms.has('support.view'));
      let rows;
      if (isStaff) {
        let query = `
          SELECT t.*, u.username, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) as message_count
          FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE 1=1`;
        const params = [];
        if (req.query.status) { query += ' AND t.status = ?'; params.push(req.query.status); }
        if (req.query.assigned === 'mine') { query += ' AND t.assigned_to = ?'; params.push(req.user.id); }
        else if (req.query.assigned === 'unassigned') { query += ' AND t.assigned_to IS NULL'; }
        query += ' ORDER BY t.updated_at DESC LIMIT 100';
        rows = db.prepare(query).all(...params);
      } else {
        rows = db.prepare(`
          SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) as message_count
          FROM support_tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC
        `).all(req.user.id);
      }
      res.json({ tickets: rows, is_staff: Boolean(isStaff) });
    } catch (err) { serverError(res, err); }
  });

  app.get('/api/support/tickets/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT t.*, u.username FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ? OR t.ticket_code = ?')
      .get(req.params.id, req.params.id);
    if (!t) return notFound(res, 'Ticket');

    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('support.view'));
    if (t.user_id !== req.user.id && !isStaff) return denied(res);

    const messages = db.prepare(`
      SELECT m.*, u.username FROM ticket_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.ticket_id = ? AND (? = 1 OR m.is_internal = 0)
      ORDER BY m.created_at ASC
    `).all(t.id, isStaff ? 1 : 0);

    res.json({ ticket: t, messages, can_reply: t.status !== 'closed' });
  });

  app.post('/api/support/tickets/:id/messages', requireAuth, (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
      if (!t) return notFound(res, 'Ticket');

      const isStaff = req.perms && (req.perms.has('*') || req.perms.has('support.manage'));
      if (t.user_id !== req.user.id && !isStaff) return denied(res);
      if (t.status === 'closed') return conflict(res, 'Ticket is closed');

      const message = cleanText((req.body || {}).message, 8000);
      if (!message) return badRequest(res, 'Message is required');
      const isInternal = isStaff && (req.body || {}).internal === true ? 1 : 0;

      db.tx(() => {
        db.prepare('INSERT INTO ticket_messages (id, ticket_id, sender_id, message, is_internal) VALUES (?, ?, ?, ?, ?)')
          .run(db.makeId('MSG'), t.id, req.user.id, message, isInternal);
        const newStatus = t.user_id === req.user.id ? 'pending' : 'open';
        db.prepare('UPDATE support_tickets SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newStatus, t.id);
      });

      if (t.user_id !== req.user.id) {
        notify(t.user_id, 'Support Reply', `Your ticket ${t.ticket_code} has a new reply`, 'support');
        sendEmail(t.user_id, '', 'support_update', { username: 'player', ticket_code: t.ticket_code, status: 'UPDATED' });
      }
      res.status(201).json({ message: 'Reply added' });
    } catch (err) { serverError(res, err); }
  });

  app.post('/api/support/tickets/:id/close', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Ticket');
    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('support.manage'));
    if (t.user_id !== req.user.id && !isStaff) return denied(res);

    db.prepare("UPDATE support_tickets SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(t.id);
    db.audit(req.user.id, 'ticket_closed', 'ticket', t.id, { code: t.ticket_code });
    res.json({ message: 'Ticket closed' });
  });

  app.post('/api/support/tickets/:id/reopen', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Ticket');
    const isStaff = req.perms && (req.perms.has('*') || req.perms.has('support.manage'));
    if (t.user_id !== req.user.id && !isStaff) return denied(res);

    db.prepare("UPDATE support_tickets SET status = 'open', closed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(t.id);
    db.audit(req.user.id, 'ticket_reopened', 'ticket', t.id, { code: t.ticket_code });
    res.json({ message: 'Ticket reopened' });
  });

  app.post('/api/support/tickets/:id/assign', requirePermission('support.manage'), (req, res) => {
    const t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
    if (!t) return notFound(res, 'Ticket');
    const assignee = (req.body || {}).assignee_id;
    if (assignee) {
      const u = db.prepare('SELECT id FROM users WHERE id = ?').get(assignee);
      if (!u) return notFound(res, 'User');
    }
    db.prepare('UPDATE support_tickets SET assigned_to = ?, updated_at = datetime(\'now\') WHERE id = ?').run(assignee || null, t.id);
    db.audit(req.user.id, 'ticket_assigned', 'ticket', t.id, { assignee: assignee || 'unassigned' });
    res.json({ message: assignee ? 'Ticket assigned' : 'Ticket unassigned' });
  });

  // ============================================
  // FEEDBACK
  // ============================================

  app.post('/api/feedback', requireAuth, (req, res) => {
    const b = req.body || {};
    const rating = asInt(b.rating, 0);
    if (rating < 1 || rating > 5) return badRequest(res, 'Rating must be 1-5');
    const message = cleanText(b.message, 4000);
    if (!message) return badRequest(res, 'Message is required');

    const id = db.makeId('FDB');
    db.prepare('INSERT INTO feedback (id, user_id, rating, category, message) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, rating, cleanText(b.category || '', 60), message);
    db.audit(req.user.id, 'feedback_submitted', 'feedback', id, { rating });
    res.status(201).json({ message: 'Feedback submitted. Thank you!' });
  });

  app.get('/api/feedback/me', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ feedback: rows });
  });

  app.get('/api/feedback', requirePermission('feedback.view'), (req, res) => {
    let query = 'SELECT f.*, u.username FROM feedback f JOIN users u ON u.id = f.user_id WHERE 1=1';
    const params = [];
    if (req.query.status) { query += ' AND f.status = ?'; params.push(req.query.status); }
    query += ' ORDER BY f.created_at DESC LIMIT 100';
    res.json({ feedback: db.prepare(query).all(...params) });
  });

  app.post('/api/feedback/:id/respond', requirePermission('feedback.manage'), (req, res) => {
    const f = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id);
    if (!f) return notFound(res, 'Feedback');
    const b = req.body || {};
    const response = cleanText(b.response || '', 4000);
    const status = ['new', 'reviewing', 'resolved', 'rejected'].includes(b.status) ? b.status : f.status;

    db.prepare('UPDATE feedback SET response = ?, status = ?, responded_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(response || f.response, status, req.user.id, f.id);
    if (response) notify(f.user_id, 'Feedback Response', `Staff responded to your feedback: ${response.slice(0, 200)}`, 'feedback');
    db.audit(req.user.id, 'feedback_responded', 'feedback', f.id, { status });
    res.json({ message: 'Response saved' });
  });

  // ============================================
  // REPORTS / CONTENT MODERATION
  // ============================================

  app.post('/api/reports', requireAuth, (req, res) => {
    const b = req.body || {};
    const categories = ['cheating', 'player_report', 'tournament_dispute', 'payment_issue', 'withdrawal_issue', 'technical_issue', 'content', 'other'];
    if (!categories.includes(b.category)) return badRequest(res, 'Invalid category');
    const description = cleanText(b.description, 4000);
    if (!description) return badRequest(res, 'Description is required');

    const id = db.makeId('RPT');
    db.prepare('INSERT INTO reports (id, reporter_id, category, target, description) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, b.category, cleanText(b.target || '', 200), description);
    db.audit(req.user.id, 'report_submitted', 'report', id, { category: b.category });
    res.status(201).json({ message: 'Report submitted', reportId: id });
  });

  app.get('/api/reports', requirePermission('reports.view'), (req, res) => {
    let query = `
      SELECT r.*, u.username as reporter_username, a.username as assignee_username
      FROM reports r JOIN users u ON u.id = r.reporter_id
      LEFT JOIN users a ON a.id = r.assigned_to WHERE 1=1`;
    const params = [];
    if (req.query.status) { query += ' AND r.status = ?'; params.push(req.query.status); }
    query += ' ORDER BY r.created_at DESC LIMIT 100';
    res.json({ reports: db.prepare(query).all(...params) });
  });

  app.post('/api/reports/:id/handle', requirePermission('reports.manage'), (req, res) => {
    try {
      const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
      if (!r) return notFound(res, 'Report');
      const b = req.body || {};
      const action = b.action;

      if (action === 'review') {
        db.prepare("UPDATE reports SET status = 'reviewing', assigned_to = ?, updated_at = datetime('now') WHERE id = ?")
          .run(req.user.id, r.id);
      } else if (action === 'resolve' || action === 'reject') {
        const status = action === 'resolve' ? 'resolved' : 'rejected';
        db.prepare("UPDATE reports SET status = ?, resolution = ?, moderator_notes = ?, updated_at = datetime('now') WHERE id = ?")
          .run(status, cleanText(b.resolution || '', 2000), cleanText(b.notes || '', 2000), r.id);
        notify(r.reporter_id, 'Report Updated', `Your report has been ${status}`, 'moderation');
      } else if (action === 'note') {
        db.prepare('UPDATE reports SET moderator_notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(cleanText(b.notes || '', 2000), r.id);
      } else {
        return badRequest(res, 'action must be review, resolve, reject or note');
      }

      db.audit(req.user.id, `report_${action}`, 'report', r.id, { notes: b.notes || '' });
      res.json({ message: 'Report updated' });
    } catch (err) { serverError(res, err); }
  });

  // ============================================
  // NOTIFICATIONS
  // ============================================

  app.get('/api/notifications', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).c;
    res.json({ notifications: rows, unread });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
    const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!n) return notFound(res, 'Notification');
    db.prepare('UPDATE notifications SET read_at = datetime(\'now\') WHERE id = ? AND read_at IS NULL').run(n.id);
    res.json({ message: 'Read' });
  });

  app.post('/api/notifications/read-all', requireAuth, (req, res) => {
    db.prepare('UPDATE notifications SET read_at = datetime(\'now\') WHERE user_id = ? AND read_at IS NULL').run(req.user.id);
    res.json({ message: 'All marked read' });
  });

  // Broadcast (staff only) — real users only
  app.post('/api/notifications/broadcast', requirePermission('notifications.broadcast'), (req, res) => {
    try {
      const b = req.body || {};
      const title = cleanText(b.title, 200);
      const message = cleanText(b.message, 1000);
      if (!title || !message) return badRequest(res, 'Title and message are required');
      const audience = ['all', 'staff', 'user'].includes(b.audience) ? b.audience : 'all';

      let users;
      if (audience === 'all') users = db.prepare("SELECT id FROM users WHERE status = 'active'").all();
      else if (audience === 'staff') users = db.prepare(`
        SELECT DISTINCT ur.user_id as id FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id WHERE r.name != 'USER'
      `).all();
      else users = db.prepare("SELECT id FROM users WHERE role = 'USER' AND status = 'active'").all();

      db.tx(() => {
        const ins = db.prepare('INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)');
        for (const u of users) ins.run(db.makeId('NOT'), u.id, title, message, 'broadcast');
        db.audit(req.user.id, 'notifications_broadcast', 'notification', null, { audience, count: users.length });
      });

      res.json({ message: `Sent to ${users.length} user(s)`, count: users.length });
    } catch (err) { serverError(res, err); }
  });
};
