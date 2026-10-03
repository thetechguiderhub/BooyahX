/* Final DB inventory for the report. */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
const c = q => db.prepare(q).get().n;
const line = (label, value) => console.log(String(label).padEnd(30), value);

line('users', c('SELECT COUNT(*) n FROM users'));
line('roles', c('SELECT COUNT(*) n FROM roles'));
line('permissions', c('SELECT COUNT(*) n FROM permissions'));
line('user_roles', c('SELECT COUNT(*) n FROM user_roles'));
line('tournaments', c('SELECT COUNT(*) n FROM tournaments'));
line('tournament_results', c('SELECT COUNT(*) n FROM tournament_results'));
line('deposits', c('SELECT COUNT(*) n FROM deposits'));
line('withdrawals', c('SELECT COUNT(*) n FROM withdrawals'));
line('transactions', c('SELECT COUNT(*) n FROM transactions'));
line('events (public)', c("SELECT COUNT(*) n FROM events WHERE status='published'"));
line('news (public)', c("SELECT COUNT(*) n FROM news WHERE status='published'"));
line('updates (public)', c("SELECT COUNT(*) n FROM updates WHERE status='published'"));
line('banners (active)', c("SELECT COUNT(*) n FROM banners WHERE status='active'"));
line('popups (active)', c("SELECT COUNT(*) n FROM popups WHERE status='active'"));
line('sponsors (active)', c("SELECT COUNT(*) n FROM sponsors WHERE status='active'"));
line('highlights (active)', c("SELECT COUNT(*) n FROM highlights WHERE status='active'"));
line('polls', c('SELECT COUNT(*) n FROM polls'));
line('notifications', c('SELECT COUNT(*) n FROM notifications'));
line('api_keys', c('SELECT COUNT(*) n FROM api_keys'));
line('audit_logs', c('SELECT COUNT(*) n FROM audit_logs'));
line('seeds: achievements', c('SELECT COUNT(*) n FROM achievements'));
line('seeds: coin_packages', c('SELECT COUNT(*) n FROM coin_packages'));
line('seeds: email_templates', c('SELECT COUNT(*) n FROM email_templates'));
try { line('official_team positions', c('SELECT COUNT(*) n FROM official_team_members')); } catch (e) { line('official_team_positions', 'table missing'); }
const tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
line('total tables', tables);
