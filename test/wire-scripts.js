/* One-off: insert data-service/i18n script tags before existing main scripts */
const fs = require('fs');
const path = require('path');

const root = 'C:/Users/madik/Downloads/BooyahX';
let changed = 0;

function process(dir, prefix) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) continue;
    if (!f.endsWith('.html')) continue;

    let html = fs.readFileSync(p, 'utf8');
    const before = html;

    const mainTag = `<script src="${prefix}js/main.js"></script>`;
    const ownerTag = `<script src="${prefix}js/owner-auth.js"></script>`;

    const needsI18n = !html.includes('js/i18n.js');
    const needsData = !html.includes('js/data-service.js');

    if (html.includes(mainTag)) {
      const inject = [
        needsI18n ? `<script src="${prefix}js/i18n.js"></script>` : '',
        needsData ? `<script src="${prefix}js/data-service.js"></script>` : '',
        mainTag
      ].filter(Boolean).join('\n  ');
      html = html.replace(mainTag, inject);
    } else if (html.includes(ownerTag)) {
      const inject = [
        needsData ? `<script src="${prefix}js/data-service.js"></script>` : '',
        ownerTag
      ].filter(Boolean).join('\n  ');
      html = html.replace(ownerTag, inject);
    }

    if (html !== before) {
      fs.writeFileSync(p, html, 'utf8');
      changed++;
      console.log('updated: ' + path.relative(root, p));
    }
  }
}

process(root, '');            // public pages: js/...
process(path.join(root, 'owner'), '../');  // owner pages: ../js/...
console.log(`\n${changed} files updated`);
