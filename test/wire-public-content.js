/* Adds <script src="js/public-content.js"></script> before main.js on every public page. Idempotent. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TAG = '  <script src="js/public-content.js"></script>\n';

let changed = 0;
for (const f of fs.readdirSync(ROOT).filter(x => x.endsWith('.html'))) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('js/public-content.js')) continue;
  let next;
  if (html.includes('<script src="js/main.js"></script>')) {
    next = html.replace(/([ \t]*)<script src="js\/main\.js"><\/script>/, `$1${TAG}$1<script src="js/main.js"></script>`);
  } else if (html.includes('</body>')) {
    next = html.replace('</body>', `${TAG}  </body>`);
  } else {
    console.log(`${f}: no insertion point — skipped`);
    continue;
  }
  if (next !== html) {
    fs.writeFileSync(p, next, 'utf8');
    changed++;
    console.log(`${f}: added`);
  }
}
console.log(`\npages updated: ${changed}`);
