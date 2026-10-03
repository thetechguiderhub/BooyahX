/* One-off: add Leaderboard + Teams links to public navbars */
const fs = require('fs');
const path = require('path');

const root = 'C:/Users/madik/Downloads/BooyahX';
const publicPages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let changed = 0;

for (const f of publicPages) {
  const p = path.join(root, f);
  let html = fs.readFileSync(p, 'utf8');
  const before = html;

  // Desktop nav: insert after the Tournaments link if Leaderboard missing
  if (!html.includes('leaderboard.html')) {
    // Desktop list
    html = html.replace(
      /(<li><a href="tournaments\.html"[^>]*>Tournaments<\/a><\/li>)/,
      '$1\n        <li><a href="leaderboard.html">Leaderboard</a></li>'
    );
    // Mobile list
    html = html.replace(
      /(<li><a href="tournaments\.html"[^>]*>Tournaments<\/a><\/li>)(?![\s\S]*leaderboard\.html)/,
      '$1\n      <li><a href="leaderboard.html">Leaderboard</a></li>'
    );
  }

  if (html !== before) {
    fs.writeFileSync(p, html, 'utf8');
    changed++;
    console.log('updated: ' + f);
  }
}
console.log(`\n${changed} files updated`);
