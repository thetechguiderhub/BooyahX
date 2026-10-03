/* ============================================
   BOOYAHX — add official community links to
   the minimal public footer of every page that
   has one (idempotent; skips the full index
   footer which already carries them).
   Official links only — no placeholders.
   ============================================ */

const fs = require('fs');
const path = require('path');

const WA = 'https://whatsapp.com/channel/0029Vb9Ify09WtC892wVPa30';
const YT = 'https://www.youtube.com/@thetechguider01';

const WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
const YT_PATH = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z';

const BLOCK = [
  '      <div class="footer-social footer-social-page">',
  `        <a href="${WA}" target="_blank" rel="noopener noreferrer" aria-label="BooyahX WhatsApp Channel (opens in a new tab)"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;"><path d="${WA_PATH}"/></svg></a>`,
  `        <a href="${YT}" target="_blank" rel="noopener noreferrer" aria-label="The Tech Guider 01 on YouTube (opens in a new tab)"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;"><path d="${YT_PATH}"/></svg></a>`,
  '      </div>'
].join('\n');

const root = path.join(__dirname, '..');
let added = 0, skipped = 0, noFooter = 0;

for (const f of fs.readdirSync(root)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(root, f);
  const src = fs.readFileSync(p, 'utf8');
  if (!src.includes('<footer class="footer">')) { noFooter++; continue; }
  if (src.includes('footer-social-page')) { skipped++; continue; }

  const re = /(<footer class="footer">\s*<div class="container">)(\s*<div class="footer-bottom">)/;
  if (!re.test(src)) { console.log('  SKIP (pattern not found):', f); skipped++; continue; }
  const out = src.replace(re, `$1\n${BLOCK}$2`);
  fs.writeFileSync(p, out);
  added++;
  console.log('  ADDED footer social:', f);
}

console.log(`\nfooter social rows added: ${added}, already present: ${skipped}, pages without footer: ${noFooter}`);
