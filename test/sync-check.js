/* ============================================
   BOOYAHX — WEBSITE SYNC + LOCALE PREFERENCES CHECK
   ----------------------------------------
   1. Locale preference: guest 401, signed-in GET/PUT, persists
      across sessions (server is the authority), invalid rejected.
   2. Owner content -> DB -> public API sync for events, news,
      updates, banners, popups, sponsors, highlights:
      - published/active content is visible publicly
      - draft/inactive content is NOT visible publicly
      - deleting removes it publicly again (no leftover artifacts)
   All records created here are deleted before exit.
   ============================================ */

const BASE = 'http://localhost:3000';

const OWNER_EMAIL = 'itxmeshadow1234@gmail.com';
const OWNER_PASSWORD = require('./_env').PRIMARY_OWNER_PASSWORD;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(method, p, cookie, body) {
  const res = await fetch(BASE + '/api' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body ?? {})
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return {
    status: res.status,
    cookie: sc.map(c => c.split(';')[0]).join('; '),
    json
  };
}

const created = []; // ids to delete at the end

async function cleanup(ownerCookie) {
  for (const path of created) {
    try { await api('DELETE', path, ownerCookie); } catch (_) {}
  }
}

(async () => {
  let failures = 0;

  console.log('\n=== A. LOCALE PREFERENCE (server authority) ===');
  const guest = await api('GET', '/auth/preferences');
  check('guest GET /auth/preferences -> 401', guest.status === 401, `got ${guest.status}`);

  const owner = await api('POST', '/auth/signin', null, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  check('owner signin -> 200', owner.status === 200, `got ${owner.status}`);
  const oc = owner.cookie;

  const g1 = await api('GET', '/auth/preferences', oc);
  check('signed-in GET preferences -> 200 with locale', g1.status === 200 && !!g1.json?.preferences?.locale,
    JSON.stringify(g1.json));

  const p1 = await api('PUT', '/auth/preferences', oc, { locale: 'ur' });
  check('PUT {locale:"ur"} -> 200', p1.status === 200, `got ${p1.status}`);

  const g2 = await api('GET', '/auth/preferences', oc);
  check('locale now ur', g2.json?.preferences?.locale === 'ur', JSON.stringify(g2.json));

  const bad = await api('PUT', '/auth/preferences', oc, { locale: 'xx' });
  check('PUT invalid locale -> 400', bad.status === 400, `got ${bad.status}`);

  // persistence across sessions
  await api('POST', '/auth/signout', oc);
  const signin2 = await api('POST', '/auth/signin', null, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  const g3 = await api('GET', '/auth/preferences', signin2.cookie);
  check('locale persists across sessions -> ur', g3.json?.preferences?.locale === 'ur', JSON.stringify(g3.json));

  // restore en
  await api('PUT', '/auth/preferences', signin2.cookie, { locale: 'en' });
  const oc2 = signin2.cookie;
  const g4 = await api('GET', '/auth/preferences', oc2);
  check('locale restored to en', g4.json?.preferences?.locale === 'en', JSON.stringify(g4.json));

  console.log('\n=== B. OWNER -> PUBLIC CONTENT SYNC ===');

  // helper: create via owner, assert public visibility, delete
  async function syncCase(label, createPath, createBody, publicPath, publicKey, shouldBePublic) {
    const r = await api('POST', createPath, oc2, createBody);
    if (r.status !== 201 && r.status !== 200) {
      check(`${label}: create`, false, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
      return;
    }
    const id = r.json.id;
    created.push(`${createPath}/${id}`);

    const pub = await api('GET', publicPath);
    const rows = (pub.json && pub.json[publicKey]) || [];
    const found = rows.some(x => x.id === id);
    if (shouldBePublic) {
      check(`${label}: visible on public API`, found, `${publicPath} returned ${rows.length} rows`);
    } else {
      check(`${label}: hidden from public API`, !found, `${publicPath} returned ${rows.length} rows`);
    }
  }

  // published content appears publicly
  await syncCase('published event', '/events', {
    title: 'Sync Probe Event', description: 'probe', status: 'published',
    start_time: new Date(Date.now() + 3600000).toISOString(), end_time: new Date(Date.now() + 7200000).toISOString()
  }, '/events', 'events', true);

  await syncCase('draft event', '/events', {
    title: 'Sync Probe Draft Event', description: 'probe', status: 'draft',
    start_time: new Date(Date.now() + 3600000).toISOString(), end_time: new Date(Date.now() + 7200000).toISOString()
  }, '/events', 'events', false);

  await syncCase('published news', '/news', {
    title: 'Sync Probe News', content: 'probe content', category: 'Community', status: 'published'
  }, '/news', 'news', true);

  await syncCase('draft news', '/news', {
    title: 'Sync Probe Draft News', content: 'probe', category: 'Community', status: 'draft'
  }, '/news', 'news', false);

  await syncCase('published update', '/updates', {
    title: 'Sync Probe Update', description: 'probe', version: '0.0.0-probe', status: 'published'
  }, '/updates', 'updates', true);

  await syncCase('active banner', '/banners', {
    title: 'Sync Probe Banner', status: 'active', display_order: 99
  }, '/banners/active', 'banners', true);

  await syncCase('inactive banner', '/banners', {
    title: 'Sync Probe Inactive Banner', status: 'inactive', display_order: 99
  }, '/banners/active', 'banners', false);

  await syncCase('active popup', '/popups', {
    title: 'Sync Probe Popup', message: 'probe message', status: 'active'
  }, '/popups/active', 'popups', true);

  await syncCase('inactive popup', '/popups', {
    title: 'Sync Probe Inactive Popup', message: 'probe', status: 'inactive'
  }, '/popups/active', 'popups', false);

  await syncCase('active sponsor', '/sponsors', {
    name: 'Sync Probe Sponsor', status: 'active'
  }, '/sponsors/active', 'sponsors', true);

  await syncCase('inactive sponsor', '/sponsors', {
    name: 'Sync Probe Inactive Sponsor', status: 'inactive'
  }, '/sponsors/active', 'sponsors', false);

  await syncCase('active highlight', '/highlights', {
    type: 'tournament', title: 'Sync Probe Highlight', status: 'active', display_order: 99
  }, '/highlights/active', 'highlights', true);

  await syncCase('inactive highlight', '/highlights', {
    type: 'tournament', title: 'Sync Probe Inactive Highlight', status: 'inactive', display_order: 99
  }, '/highlights/active', 'highlights', false);

  // constraint violations must be honest 400s, never500 crashes
  const badStatus = await api('POST', '/banners', oc2, { title: 'Bad Status Banner', status: 'draft' });
  check('invalid status rejected with 400 (not 500)', badStatus.status === 400, `got ${badStatus.status}`);
  const missing = await api('POST', '/events', oc2, { title: 'No Times Event' });
  check('missing required fields rejected with 400 (not 500)', missing.status === 400, `got ${missing.status}`);

  // popup frequency value sanity (owner form default)
  const pops = await api('GET', '/popups/active');
  const probe = (pops.json?.popups || []).find(x => x.title === 'Sync Probe Popup');
  check('active popup exposes frequency field', probe ? ('frequency' in probe) : false,
    probe ? `frequency=${JSON.stringify(probe.frequency)}` : 'popup not found');

  console.log('\n=== C. CLEANUP (remove probe records) ===');
  await cleanup(oc2);
  created.length = 0;

  let leftover = 0;
  for (const [p, key, needle] of [
    ['/events', 'events', 'Sync Probe'],
    ['/news', 'news', 'Sync Probe'],
    ['/updates', 'updates', 'Sync Probe'],
    ['/banners/active', 'banners', 'Sync Probe'],
    ['/popups/active', 'popups', 'Sync Probe'],
    ['/sponsors/active', 'sponsors', 'Sync Probe'],
    ['/highlights/active', 'highlights', 'Sync Probe']
  ]) {
    const r = await api('GET', p);
    const rows = (r.json && r.json[key]) || [];
    leftover += rows.filter(x => String(x.title || x.name || '').includes(needle)).length;
  }
  check('no probe records left publicly', leftover === 0, `${leftover} left`);

  // final public state = empty
  const fin = await api('GET', '/events');
  check('public events list empty again', (fin.json?.events || []).length === 0,
    `${(fin.json?.events || []).length} rows`);

  failures = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  console.log(failures === 0 ? 'SYNC CHECK: PASS' : 'SYNC CHECK: FAIL');
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('SYNC CHECK RUNNER ERROR:', err);
  process.exit(1);
});
