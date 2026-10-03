/* i18n coverage audit: how many data-i18n keys each page has. */
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..'),
  path.join(__dirname, '..', 'owner')
];

let total = 0;
const zero = [];
const some = [];
for (const root of roots) {
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith('.html')) continue;
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const n = (src.match(/data-i18n(?![-\w])/g) || []).length;
    total += n;
    if (n === 0) zero.push(path.basename(root) + '/' + f);
    else some.push(`${path.basename(root)}/${f}: ${n}`);
  }
}
console.log('total data-i18n attrs:', total);
console.log('\nWITH keys (' + some.length + '):');
some.forEach(s => console.log('  ' + s));
console.log('\nWITHOUT keys (' + zero.length + '):');
zero.forEach(s => console.log('  ' + s));
