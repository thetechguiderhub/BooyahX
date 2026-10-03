/* ============================================
   BOOYAHX — OFFICIAL SOCIAL/COMMUNITY LINKS TEST
   ------------------------------------------
   1. Exact official URLs present on every public footer + community areas
   2. Every official link: target=_blank + rel=noopener noreferrer + aria-label
   3. No placeholder/fake social links remain (href="#", Instagram/Discord/etc.)
   4. No fake social statistics (followers/subscribers/likes)
   5. Existing internal navigation intact
   6. i18n keys exist (en + ur)
   7. Keyboard accessibility (anchors focusable)
   ============================================ */

const fs = require('fs');
const path = require('path');

const WA = 'https://whatsapp.com/channel/0029Vb9Ify09WtC892wVPa30';
const YT = 'https://www.youtube.com/@thetechguider01';

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const root = path.join(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

console.log('=== OFFICIAL SOCIAL LINKS ===');

// --- anchor-level assertions on official links ---
const anchorRe = new RegExp(`<a\\s[^>]*href="${WA.replace(/[/.:]/g, '\\$&')}"[^>]*>`, 'g');
const anchorReYT = new RegExp(`<a\\s[^>]*href="${YT.replace(/[/.:@]/g, '\\$&')}"[^>]*>`, 'g');

let totalOfficial = 0, badAttrs = 0, badAria = 0, noBlank = 0, noRel = 0, noTabindex = 0;
for (const f of htmlFiles) {
  const src = read(f);
  const anchors = [...src.matchAll(new RegExp('<a\\s[^>]*?>', 'g'))].map(m => m[0])
    .filter(a => a.includes(WA) || a.includes(YT));
  for (const a of anchors) {
    totalOfficial++;
    if (!a.includes('target="_blank"')) { noBlank++; console.log('    no target:', f); }
    if (!/rel="[^"]*noopener[^"]*"/.test(a) || !/rel="[^"]*noreferrer[^"]*"/.test(a)) { noRel++; console.log('    bad rel:', f); }
    if (!/aria-label="[^"]+"/.test(a)) { badAria++; console.log('    no aria-label:', f); }
    if (/tabindex="-1"/.test(a)) { noTabindex++; console.log('    not focusable:', f); }
  }
}
check(`official links found across pages: ${totalOfficial}`, totalOfficial >= 17, `found=${totalOfficial} (expected index3 + about2 + support2 + news2 + updates2 + other8 footer pages*1 =19+)`);
check('every official link has target="_blank"', noBlank === 0, `${noBlank} missing`);
check('every official link has rel="noopener noreferrer"', noRel === 0, `${noRel} missing`);
check('every official link has an aria-label', badAria === 0, `${badAria} missing`);
check('no official link is removed from keyboard order', noTabindex === 0, `${noTabindex} tabindex=-1`);

// --- exact URL values (no typos / trailing junk) ---
const idx = read('index.html');
check('index: WhatsApp URL exact', idx.includes(`href="${WA}"`));
check('index: YouTube URL exact', idx.includes(`href="${YT}"`));
check('index: WhatsApp card + footer + Channels (3+ appearances)',
  (idx.split(WA).length - 1) >= 3, `count=${idx.split(WA).length - 1}`);
check('index: YouTube card + footer + Channels (3+ appearances)',
  (idx.split(YT).length - 1) >= 3, `count=${idx.split(YT).length - 1}`);
check('index: display label "BooyahX WhatsApp Channel"', idx.includes('BooyahX WhatsApp Channel'));
check('index: display label "The Tech Guider 01"', idx.includes('The Tech Guider 01'));

// --- every page with a footer carries both links ---
const footerPages = htmlFiles.filter(f => read(f).includes('<footer class="footer">'));
const missingFooterLinks = footerPages.filter(f => !read(f).includes(WA) || !read(f).includes(YT));
check(`all ${footerPages.length} public footer pages carry both official links`, missingFooterLinks.length === 0,
  missingFooterLinks.join(', '));

// --- no placeholder / fake social links ---
let placeholderHits = [];
for (const f of htmlFiles) {
  const src = read(f);
  // fake social anchors: href="#" with a social aria-label or inside footer-social
  for (const m of src.matchAll(/<a\s[^>]*href="#"[^>]*>/g)) {
    const a = m[0];
    if (/aria-label="(YouTube|Instagram|Discord|TikTok|Facebook|X|WhatsApp)/i.test(a)) placeholderHits.push(`${f}: ${a}`);
  }
  // social-looking fake links to other platforms
  for (const m of src.matchAll(/<a\s[^>]*href="(?:https?:\/\/)?(?:www\.)?(?:instagram|discord|tiktok|facebook|twitter|x)\.[^"]*"/gi)) {
    placeholderHits.push(`${f}: ${m[0]}`);
  }
}
check('no placeholder/fake social links (href="#" or non-official platforms)', placeholderHits.length === 0,
  placeholderHits.slice(0, 3).join(' | '));

check('old "OFFICIAL CHANNELS" fake cards removed', !idx.includes('OFFICIAL CHANNELS') && !idx.includes('href="#" class="btn btn-outline btn-sm btn-block"'));

// --- no fake social statistics ---
let statsHits = [];
for (const f of htmlFiles) {
  const src = read(f);
  for (const m of src.matchAll(/[^<>]{0,40}(?:followers|subscribers|likes count|like count)[^<>]{0,40}/gi)) {
    statsHits.push(`${f}: ${m[0].trim()}`);
  }
}
check('no fake social statistics (followers/subscribers/likes)', statsHits.length === 0, statsHits.slice(0, 3).join(' | '));

// --- internal navigation intact ---
const navChecks = [
  ['index.html', ['href="tournaments.html"', 'href="events.html"', 'href="news.html"', 'href="about.html"', 'href="support.html"', 'href="index.html"']],
  ['about.html', ['nav-links', 'href="index.html"', 'href="tournaments.html"', 'href="support.html"']],
  ['support.html', ['nav-links', 'href="index.html"', 'href="about.html"', 'id="support-form"']],
  ['news.html', ['nav-links', 'id="news-list"', 'href="updates.html"']]
];
let navOk = true;
for (const [f, needles] of navChecks) {
  const src = read(f);
  for (const n of needles) if (!src.includes(n)) { navOk = false; console.log(`    missing in ${f}: ${n}`); }
}
check('existing internal navigation/pages intact', navOk);

// footer bottom preserved on every footer page
const lostFooter = footerPages.filter(f => !read(f).includes('footer-bottom') || !read(f).includes('All rights reserved'));
check('footer bottom/credits not broken', lostFooter.length === 0, lostFooter.join(', '));

// --- i18n keys ---
const i18n = read('js/i18n.js');
const keys = ['community.title', 'community.sub', 'community.whatsapp_btn', 'community.youtube_btn', 'community.whatsapp_desc', 'community.youtube_desc'];
const missingKeys = keys.filter(k => !i18n.includes(`'${k}'`));
check('i18n: all community keys defined (en + ur = twice each)', missingKeys.length === 0, missingKeys.join(', '));
const keyCounts = keys.map(k => (i18n.match(new RegExp(`'${k.replace(/\./g, '\\.')}':`, 'g')) || []).length);
check('i18n: each key present in BOTH dictionaries', keyCounts.every(c => c === 2), JSON.stringify(keyCounts));

// --- icons present (recognizable brand icons) ---
check('index: WhatsApp SVG icon present', idx.includes('viewBox="0 0 24 24"') && idx.includes('#25D366'));
check('index: YouTube SVG icon present', idx.includes('#FF0000'));

// --- responsive safety (no fixed widths that break small screens) ---
const css = read('css/style.css');
check('css: footer social row wraps on small screens', css.includes('.footer-social-page') && css.includes('flex-wrap: wrap'));
check('css: grid-2 collapses to 1 column on mobile', /\.grid-2,\s*\.grid-3,\s*\.grid-4\s*\{\s*grid-template-columns:\s*1fr/.test(css));

// --- remaining href="#" are pre-existing non-social placeholders (Privacy/Terms) only ---
const remainingHash = [];
for (const f of htmlFiles) {
  const src = read(f);
  for (const m of src.matchAll(/<a\s[^>]*href="#"[^>]*>([^<]{0,40})</g)) {
    remainingHash.push(`${f}: ${m[1].trim()}`);
  }
}
const socialHash = remainingHash.filter(x => /youtube|instagram|discord|tiktok|facebook|whatsapp|channel/i.test(x));
check('remaining href="#" are not social links (Privacy/Terms only, pre-existing)', socialHash.length === 0, socialHash.join(' | '));
if (remainingHash.length) console.log('    note: pre-existing non-social placeholders kept:', remainingHash.join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'SOCIAL LINKS: PASS' : 'SOCIAL LINKS: FAIL');
process.exit(fail === 0 ? 0 : 1);
