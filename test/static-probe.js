'use strict';
/* BooyahX — static exposure probe (§20/§21).
 * Verifies the server does NOT serve sensitive files from the web root:
 * .env, DB files, server source, tests, .git. Prints STATUS ONLY —
 * never file contents.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const PROBES = [
  ['/.env', 'block'],                 // must NOT be served
  ['/.env.example', 'block'],         // example may leak env var names — block too
  ['/data/booyahx.db', 'block'],
  ['/data/booyahx.db-wal', 'block'],
  ['/server/index.js', 'block'],
  ['/server/db.js', 'block'],
  ['/test/rbac-matrix.js', 'block'],
  ['/.git/config', 'block'],
  ['/package.json', 'block'],         // no secrets but keep private (repo-local paths)
  ['/index.html', 'allow'],           // must be served (sanity)
  ['/css/style.css', 'allow'],        // must be served (sanity)
  ['/assets/branding/bx-coin-small.png', 'allow'],
];

(async () => {
  let fail = 0;
  for (const [p, want] of PROBES) {
    let status = 0, len = 0;
    try {
      const r = await fetch(BASE + p, { redirect: 'manual' });
      status = r.status;
      const buf = Buffer.from(await r.arrayBuffer());
      len = buf.length;
      // drain without printing contents
      void buf;
    } catch (e) {
      status = -1;
    }
    const served = status === 200;
    const ok = want === 'block' ? !served : served;
    if (!ok) fail += 1;
    console.log(`[${ok ? 'v' : 'X'}] ${want} ${p} -> HTTP ${status} (${len} bytes)`);
  }
  console.log(`\nSTATIC PROBE: ${fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'}`);
  process.exitCode = fail ? 1 : 0;
})();
