/* Creates/deletes the temporary SUPPORT account used for the
   browser-side RBAC check (direct URL block + nav filtering).
   Usage: node test/browser-rbac-user.js create | delete */
const BASE = 'http://localhost:3000';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'booyahx.db'));

const USERNAME = 'rbac_support';
const EMAIL = 'rbac_support@example.com';
const PASSWORD = 'TestPass123!';

async function api(method, p, cookie, body) {
  const res = await fetch(BASE + '/api' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body)
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, cookie: sc.map(c => c.split(';')[0]).join('; '), json: await res.json().catch(() => null) };
}

(async () => {
  const cmd = process.argv[2];

  if (cmd === 'create') {
    const owner = await api('POST', '/auth/signin', null, {
      email: 'itxmeshadow1234@gmail.com',
      password: require('./_env').PRIMARY_OWNER_PASSWORD
    });
    if (owner.status !== 200) throw new Error('owner signin failed: ' + owner.status);

    let user = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
    if (!user) {
      const su = await api('POST', '/auth/signup', null, {
        name: 'RBAC Support', username: USERNAME, email: EMAIL,
        password: PASSWORD, confirmPassword: PASSWORD, termsAccepted: true
      });
      if (su.status !== 201) throw new Error('signup failed: ' + su.status);
      user = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
    }
    const assign = await api('POST', '/owner/team/assign', owner.cookie, { username: USERNAME, role: 'SUPPORT' });
    console.log(JSON.stringify({ user: user.id, assign: assign.status, email: EMAIL, password: PASSWORD }));
  } else if (cmd === 'delete') {
    const owner = await api('POST', '/auth/signin', null, {
      email: 'itxmeshadow1234@gmail.com',
      password: require('./_env').PRIMARY_OWNER_PASSWORD
    });
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
    if (user) {
      const del = await api('DELETE', '/owner/users/' + encodeURIComponent(user.id), owner.cookie);
      if (del.status !== 200) {
        db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      }
      db.prepare('DELETE FROM users WHERE username = ?').run(USERNAME);
      console.log('deleted (api status ' + del.status + ')');
    } else {
      console.log('nothing to delete');
    }
  } else {
    console.log('usage: create | delete');
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
