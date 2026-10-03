/* ============================================
   i18n WIRE — annotates public pages with translation keys
   ----------------------------------------
   1. Adds #lang-toggle to .nav-actions where missing.
   2. Adds data-i18n="key" to any plain-text element whose text exactly
      matches an English value in the i18n dictionary.
   3. Adds data-i18n-placeholder="key" for matching placeholders.
   Idempotent: re-running changes nothing extra.
   The owner console intentionally stays English (internal tool).
   ============================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');

// ---- parse the EN dictionary ----
const enStart = src.indexOf('en: {');
const urStart = src.indexOf('ur: {');
if (enStart < 0 || urStart < 0) { console.error('could not locate DICT'); process.exit(1); }
const enBlock = src.slice(enStart, urStart);
const DICT = {};
const entryRe = /(?:'([^']+)'\s*:\s*'([^']*)'|"([^"]+)"\s*:\s*"([^"]*)")/g;
let m;
while ((m = entryRe.exec(enBlock)) !== null) {
  const key = m[1] || m[3];
  const val = m[2] !== undefined ? m[2] : m[4];
  if (key && val !== undefined) DICT[key] = val;
}
console.log('dictionary entries parsed:', Object.keys(DICT).length);

const norm = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const reverse = {};
for (const [k, v] of Object.entries(DICT)) {
  const n = norm(v);
  if (!(n in reverse)) reverse[n] = k; // first key wins for duplicate texts
}

const TOGGLE = '<button id="lang-toggle" class="btn btn-outline btn-sm" type="button">اردو</button>';
const SKIP_TAGS = new Set(['script', 'style', 'title', 'head', 'html', 'noscript']);

const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
let totalKeys = 0;

for (const f of files) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  let added = 0;

  // 1. language toggle in the first .nav-actions
  if (!html.includes('id="lang-toggle"') && html.includes('class="nav-actions"')) {
    html = html.replace(/(<div class="nav-actions">)/, `$1\n        ${TOGGLE}`);
    added++;
  }

  // 2. plain-text elements -> data-i18n
  html = html.replace(/<([a-z0-9]+)((?:[^<>])*)>([^<>]*)<\/\1>/gi, (full, tag, attrs, inner) => {
    const t = tag.toLowerCase();
    if (SKIP_TAGS.has(t)) return full;
    if (/data-i18n(?![-\w])/.test(attrs)) return full;
    if (!inner.trim()) return full;
    const n = norm(inner);
    const key = reverse[n];
    if (!key) return full;
    added++;
    return `<${tag}${attrs} data-i18n="${key}">${inner}</${tag}>`;
  });

  // 3. placeholders -> data-i18n-placeholder
  html = html.replace(/<(input|textarea)((?:[^<>])*)>/gi, (full, tag, attrs) => {
    if (/data-i18n-placeholder(?![-\w])/.test(attrs)) return full;
    const pm = /placeholder="([^"]*)"/.exec(attrs);
    if (!pm) return full;
    const key = reverse[norm(pm[1])];
    if (!key) return full;
    added++;
    return `<${tag}${attrs} data-i18n-placeholder="${key}">`;
  });

  if (added) {
    fs.writeFileSync(p, html, 'utf8');
    totalKeys += added;
    console.log(`${f}: +${added}`);
  }
}
console.log('\ntotal annotations added:', totalKeys);
