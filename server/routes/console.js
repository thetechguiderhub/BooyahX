/* ============================================
   BOOYAHX — CONSOLE MODE ROUTES
   ----------------------------------------
   The console switcher is an INTERFACE/WORKSPACE
   mode for the Primary Owner only. It is stored in
   the session — NEVER as the user's RBAC role.

   Invariants enforced here:
   - Only PRIMARY_OWNER may switch (no permission
     grants console switching to anyone else yet).
   - Allowed values: 'OWNER' | 'DEVELOPER' only.
   - The database role of the user is NEVER changed.
   - Every switch is audited (no credentials logged).
   ============================================ */

const ALLOWED_CONSOLES = ['OWNER', 'DEVELOPER'];
const DEFAULT_CONSOLE = 'DEVELOPER';

module.exports = function consoleRoutes(app, ctx) {
  const { db, requireAuth, requireRole } = ctx;
  const { badRequest, serverError } = require('../helpers');

  // Current console mode for the signed-in user.
  app.get('/api/console', requireAuth, (req, res) => {
    try {
      const canSwitch = req.roles.has('PRIMARY_OWNER');
      const mode = ALLOWED_CONSOLES.includes(req.session.consoleMode)
        ? req.session.consoleMode
        : DEFAULT_CONSOLE;
      res.json({
        console_mode: canSwitch ? mode : null,
        can_switch: canSwitch,
        role: [...req.roles][0] || (req.user.role || 'USER'),
        allowed: ALLOWED_CONSOLES
      });
    } catch (err) { serverError(res, err); }
  });

  // Switch console (Primary Owner only). Session-scoped: signing out clears it.
  app.post('/api/console/switch', requireAuth, requireRole('PRIMARY_OWNER'), (req, res) => {
    try {
      const target = String((req.body || {}).console || '').trim().toUpperCase();
      if (!ALLOWED_CONSOLES.includes(target)) {
        return badRequest(res, 'Console must be OWNER or DEVELOPER');
      }

      const previous = ALLOWED_CONSOLES.includes(req.session.consoleMode)
        ? req.session.consoleMode
        : DEFAULT_CONSOLE;

      if (previous !== target) {
        req.session.consoleMode = target;
        // Audit: user id, actual RBAC role, previous console, new console,
        // timestamp (audit helper), IP and user agent. No credentials logged.
        db.audit(req.user.id, 'PRIMARY_OWNER_CONSOLE_SWITCH', 'user', req.user.id, {
          actual_role: 'PRIMARY_OWNER',
          previous_console: previous,
          new_console: target,
          ip: req.ip || null,
          user_agent: (req.headers['user-agent'] || '').slice(0, 200)
        });
      }

      res.json({
        message: `Console switched to ${target}`,
        console_mode: target,
        role: 'PRIMARY_OWNER',
        note: 'Interface mode only. The database RBAC role remains PRIMARY_OWNER.'
      });
    } catch (err) { serverError(res, err); }
  });
};
