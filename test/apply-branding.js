/* BOOYAHX official branding applier (idempotent, local-only)
   - Adds favicon/apple-touch <link> tags to every page <head> (correct relative paths)
   - Normalizes page titles to "BooyahX — Page" branding
   - Replaces old BX text glyphs with the official logo image:
       .logo-icon (navbar/mobile/footer/owner navbar)
       .auth-logo (Sign In / Sign Up)
       .credits-logo (home credits hero)
       .owner-login-logo (owner login)
   Only touches HTML presentation. No backend/auth/wallet/RBAC changes. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOGO = 'assets/branding/booyahx-logo.png';

function listHtml() {
  const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  const owner = fs.readdirSync(path.join(root, 'owner'))
    .filter(f => f.endsWith('.html'))
    .map(f => 'owner/' + f);
  return [...files, ...owner].sort();
}

function faviconBlock(P) {
  return [
    `  <link rel="icon" href="${P}assets/branding/favicon.ico" sizes="any">`,
    `  <link rel="icon" type="image/png" sizes="32x32" href="${P}assets/branding/booyahx-icon.png">`,
    `  <link rel="icon" type="image/png" sizes="192x192" href="${P}assets/branding/booyahx-icon-192.png">`,
    `  <link rel="icon" type="image/png" sizes="512x512" href="${P}assets/branding/booyahx-icon-512.png">`,
    `  <link rel="apple-touch-icon" sizes="180x180" href="${P}assets/branding/apple-touch-icon.png">`
  ].join('\n');
}

function newTitle(file, title) {
  // Home: brand exactly "BooyahX" (spec example)
  if (file === 'index.html' && /^BOOYAHX\b/i.test(title)) return 'BooyahX';
  // Brand-first leftovers: "BOOYAHX — X" -> "BooyahX — X"
  let m = title.match(/^BOOYAHX(?:\s*[—–-]\s*)(.*)$/i);
  if (m) return m[1].trim() ? `BooyahX — ${m[1].trim()}` : 'BooyahX';
  // Page-first: "X — BOOYAHX[ Owner Console]"
  m = title.match(/^(.*?)(?:\s*[—–-]\s*)BOOYAHX(\s+Owner Console)?$/i);
  if (m) {
    const page = m[1].trim();
    const owner = !!m[2];
    if (!page) return 'BooyahX';
    return owner ? `BooyahX Owner Console — ${page}` : `BooyahX — ${page}`;
  }
  return null; // untouched
}

const stats = { files: 0, favicon: 0, titles: 0, logos: 0, unchanged: 0 };
const titleChanges = [];

for (const file of listHtml()) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');
  const orig = html;
  const P = file.startsWith('owner/') ? '../' : '';
  let did = false;

  // 1) Favicon / apple-touch links after viewport meta
  if (!html.includes('assets/branding/favicon.ico')) {
    const vm = html.match(/<meta name="viewport"[^>]*>\r?\n/);
    if (!vm) throw new Error(`no viewport meta in ${file}`);
    html = html.replace(vm[0], vm[0] + faviconBlock(P) + '\n');
    did = true;
    stats.favicon++;
  }

  // 2) Title branding
  const tm = html.match(/<title>([\s\S]*?)<\/title>/);
  if (tm) {
    const nt = newTitle(file, tm[1]);
    if (nt && nt !== tm[1]) {
      titleChanges.push(`${file}: "${tm[1]}" -> "${nt}"`);
      html = html.replace(tm[0], `<title>${nt}</title>`);
      did = true;
      stats.titles++;
    }
  }

  // 3) Logo glyph replacements (idempotent: old strings only match once)
  const logoImg = `<img class="LOGOCLASS" src="${P}${LOGO}" alt="BooyahX" width="LOGOW" height="LOGOW">`;
  const swaps = [
    ['<span class="logo-icon">BX</span>', logoImg.replace('LOGOCLASS', 'logo-icon').replace(/LOGOW/g, '32')],
    ['<div class="auth-logo">BX</div>', logoImg.replace('LOGOCLASS', 'auth-logo').replace(/LOGOW/g, '56')],
    ['<div class="credits-logo">BX</div>', logoImg.replace('LOGOCLASS', 'credits-logo').replace(/LOGOW/g, '80')],
    ['<div class="owner-login-logo">BX</div>', logoImg.replace('LOGOCLASS', 'owner-login-logo').replace(/LOGOW/g, '64')]
  ];
  for (const [from, to] of swaps) {
    const n = html.split(from).length - 1;
    if (n > 0) {
      html = html.split(from).join(to);
      stats.logos += n;
      did = true;
    }
  }

  if (html !== orig) {
    fs.writeFileSync(full, html);
    stats.files++;
  } else {
    stats.unchanged++;
  }
}

console.log(`BRANDING APPLY: files-changed=${stats.files} unchanged=${stats.unchanged}`);
console.log(`  favicon link blocks added: ${stats.favicon}`);
console.log(`  titles normalized: ${stats.titles}`);
console.log(`  BX glyphs replaced with official logo: ${stats.logos}`);
for (const t of titleChanges) console.log('  ' + t);

// Post-checks
let fail = 0;
for (const file of listHtml()) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const P = file.startsWith('owner/') ? '../' : '';
  if (!html.includes(`${P}assets/branding/favicon.ico`)) { console.log(`FAIL no favicon: ${file}`); fail++; }
  // Logo img required on every page that has a navbar brand (access-denied has no navbar — unchanged by design)
  if (html.includes('class="nav-brand"') && !html.includes(`${P}${LOGO}`)) { console.log(`FAIL no logo img: ${file}`); fail++; }
  if (/>BX</.test(html)) { console.log(`FAIL old BX glyph remains: ${file}`); fail++; }
}
console.log(fail === 0 ? 'POST-CHECK: ALL PAGES BRANDED OK' : `POST-CHECK: ${fail} FAILURES`);
process.exit(fail ? 1 : 0);
