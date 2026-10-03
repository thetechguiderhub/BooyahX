/* ============================================
   BOOYAHX — TEMPORARY OWNER MIGRATION SECURITY TEST (section 9)
   ------------------------------------------
   Verifies, without ever printing a password:
   1. old email no longer authenticates
   2. new email authenticates (password from env)
   3. password comes from .env / environment
   4. stored password is a bcrypt hash (plaintext never in DB)
   5. plaintext password never appears in source files
   6. plaintext password never appears in server logs
   7. Primary Owner remains PRIMARY_OWNER
   8. Temporary Owner remains OWNER
   9. Moderator remains MODERATOR
   10. no duplicate owner account exists
   11. Team page (official team) uses the new email/account
   12. audit history remains attached to the same user ID
   13. Primary Owner protection remains enforced
   Final line reports only PASSWORD CONFIGURED VIA ENV: YES/NO
   ============================================ */

const fs = require('fs');
const path = require('path');
const { PRIMARY_OWNER_PASSWORD, TEMPORARY_OWNER_PASSWORD } = require('./_env');
const { DatabaseSync } = require('node:sqlite');

const BASE = 'http://localhost:3000/api';
const OLD_EMAIL = 'corrupt.12afree@gmail.com';
const NEW_EMAIL = 'murtaza12@gmail.com';
const PRIMARY_EMAIL = 'itxmeshadow1234@gmail.com';
const MOD_EMAIL = 'bakihanma123@gmail.com';

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function signin(email, password) {
  const res = await fetch(BASE + '/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, cookie: sc.map(c => c.split(';')[0]).join('; '), json };
}

async function get(pathName, cookie) {
  const res = await fetch(BASE + pathName, { headers: cookie ? { Cookie: cookie } : {} });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

(async () => {
  console.log('=== TEMPORARY OWNER MIGRATION — SECURITY TESTS ===');

  // 1. old email no longer authenticates
  const oldTry = await signin(OLD_EMAIL, TEMPORARY_OWNER_PASSWORD);
  check('old email no longer authenticates', oldTry.status !== 200, `status=${oldTry.status}`);

  // 2. new email authenticates using the env password
  const neu = await signin(NEW_EMAIL, TEMPORARY_OWNER_PASSWORD);
  check('new email authenticates', neu.status === 200, `status=${neu.status}`);
  const tempCookie = neu.cookie;
  check('temp owner role is OWNER', neu.json?.user?.role === 'OWNER', JSON.stringify(neu.json?.user?.role));

  // wrong password rejected (proves real hash comparison)
  const wrong = await signin(NEW_EMAIL, TEMPORARY_OWNER_PASSWORD + '_wrong');
  check('wrong password rejected', wrong.status !== 200, `status=${wrong.status}`);

  // 3. password comes from env (not source)
  check('passwords read from environment (.env loaded)', Boolean(PRIMARY_OWNER_PASSWORD && TEMPORARY_OWNER_PASSWORD));

  // 4. bcrypt in DB, plaintext never stored
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));
  const rows = db.prepare("SELECT id, email, password_hash FROM users WHERE id IN ('OWN-001','OWN-002','USR-MOD001')").all();
  for (const r of rows) {
    const isBcrypt = /^\$2[aby]\$\d{2}\$/.test(r.password_hash);
    const hasPlain = r.password_hash.includes(PRIMARY_OWNER_PASSWORD) || r.password_hash.includes(TEMPORARY_OWNER_PASSWORD);
    check(`password bcrypt-hashed (${r.id})`, isBcrypt && !hasPlain, isBcrypt ? 'bcrypt ok' : 'NOT bcrypt');
  }

  // 5. plaintext never in source
  const secrets = [PRIMARY_OWNER_PASSWORD, TEMPORARY_OWNER_PASSWORD];
  const codeRoots = ['server', 'js', 'owner', 'test'];
  const exts = new Set(['.js', '.html', '.css', '.md', '.json']);
  let sourceHits = 0;
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'data' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.has(path.extname(e.name))) {
        const txt = fs.readFileSync(p, 'utf8');
        for (const s of secrets) if (txt.includes(s)) { sourceHits++; console.log('    HIT in', p); }
      }
    }
  };
  for (const r of codeRoots) walk(path.join(__dirname, '..', r));
  check('plaintext password never appears in source files', sourceHits === 0, `${sourceHits} hits`);

  // 6. plaintext never in server logs
  let logHits = 0;
  const shellDir = 'C:/Users/madik/.local/share/opencode/shell';
  if (fs.existsSync(shellDir)) {
    for (const f of fs.readdirSync(shellDir)) {
      if (!f.endsWith('.out')) continue;
      const txt = fs.readFileSync(path.join(shellDir, f), 'utf8');
      for (const s of secrets) if (txt.includes(s)) { logHits++; console.log('    HIT in server log', f); }
    }
  }
  check('plaintext password never appears in server logs', logHits === 0, `${logHits} hits`);

  // 7. Primary Owner remains PRIMARY_OWNER
  const prim = await signin(PRIMARY_EMAIL, PRIMARY_OWNER_PASSWORD);
  check('Primary Owner remains PRIMARY_OWNER', prim.status === 200 && prim.json?.user?.role === 'PRIMARY_OWNER',
    `status=${prim.status}`);
  const primCookie = prim.cookie;

  // 8/9. moderator remains MODERATOR
  const MOD_PASSWORD = process.env.MODERATOR_PASSWORD;
  const mod = MOD_PASSWORD ? await signin(MOD_EMAIL, MOD_PASSWORD) : { status: 0, json: null };
  check('Moderator remains MODERATOR', mod.status === 200 && mod.json?.user?.role === 'MODERATOR',
    `status=${mod.status}`);

  // 10. no duplicate owner accounts / old email gone
  const oldCount = db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(OLD_EMAIL).n;
  const newCount = db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(NEW_EMAIL).n;
  const ownerCount = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'OWNER'").get().n;
  const primCount = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'PRIMARY_OWNER'").get().n;
  check('old email absent from database', oldCount === 0, `rows=${oldCount}`);
  check('new email exists exactly once', newCount === 1, `rows=${newCount}`);
  check('no duplicate owner account (1 OWNER + 1 PRIMARY_OWNER)', ownerCount === 1 && primCount === 1,
    `OWNER=${ownerCount} PRIMARY_OWNER=${primCount}`);

  // OWNER permissions unchanged (visible in signin payload)
  const perms = neu.json?.user?.permissions || [];
  const permOk = perms.includes('*') || (perms.includes('deposits.view') && perms.includes('roles.manage') && perms.length >= 50);
  check('OWNER permissions unchanged (staff scope intact)', permOk, `count=${perms.length}`);

  // 11. official team (owner console view) uses the new email/account
  const team = await get('/owner/official-team', primCookie);
  const slots = team.json?.positions || [];
  const slotOf = dr => slots.find(s => s.display_role === dr);
  const emailOf = dr => (slotOf(dr)?.members || []).map(m => m.email);
  check('Team: Developer slot = primary owner email', emailOf('DEVELOPER').includes(PRIMARY_EMAIL), JSON.stringify(emailOf('DEVELOPER')));
  check('Team: Owner slot = new temp owner email', emailOf('OWNER').includes(NEW_EMAIL), JSON.stringify(emailOf('OWNER')));
  check('Team: Moderator slot = moderator email', emailOf('MODERATOR').includes(MOD_EMAIL), JSON.stringify(emailOf('MODERATOR')));
  const others = slots.filter(s => !['DEVELOPER', 'OWNER', 'MODERATOR'].includes(s.display_role));
  check('Team: other unassigned roles show Available', others.every(s => s.available === true && (s.members || []).length === 0),
    `${others.length} slots checked`);

  // public team view must never leak emails
  const pubTeam = await get('/official-team');
  const pubJson = JSON.stringify(pubTeam.json || {});
  check('public team view exposes no email addresses', !pubJson.includes('@'), `${pubJson.length} bytes inspected`);

  // 12. audit history attached to the same user ID
  const auditRows = db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE actor_id = ?').get('OWN-002').n;
  check('audit history still attached to OWN-002', auditRows > 0, `rows=${auditRows}`);

  // 13. Primary Owner protection unchanged
  const prot = await (async () => {
    const res = await fetch(BASE + '/owner/team/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tempCookie },
      body: JSON.stringify({ user_id: 'OWN-001', role: 'PRIMARY_OWNER' })
    });
    return res.status;
  })();
  check('Primary Owner protection: temp owner cannot revoke PRIMARY_OWNER', prot === 401 || prot === 403, `status=${prot}`);

  const prot2 = await (async () => {
    const res = await fetch(BASE + '/owner/team/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tempCookie },
      body: JSON.stringify({ username: 'bakihanma123', role: 'PRIMARY_OWNER' })
    });
    return res.status;
  })();
  check('Primary Owner protection: temp owner cannot assign PRIMARY_OWNER', prot2 === 401 || prot2 === 403, `status=${prot2}`);

  // ---- verdict (no password values) ----
  const envConfigured = Boolean(
    process.env.PRIMARY_OWNER_PASSWORD && process.env.TEMPORARY_OWNER_PASSWORD &&
    rows.every(r => /^\$2[aby]\$\d{2}\$/.test(r.password_hash)) && neu.status === 200 && prim.status === 200
  );
  const failures = results.filter(x => !x).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  console.log('PASSWORD CONFIGURED VIA ENV: ' + (envConfigured ? 'YES' : 'NO'));
  console.log(failures === 0 ? 'SECURITY TESTS: PASS' : 'SECURITY TESTS: FAIL');
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('RUNNER ERROR:', err.message);
  process.exit(1);
});
