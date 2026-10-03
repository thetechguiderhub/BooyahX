/* BOOYAHX — build assets/branding/favicon.ico (PNG entries:16/32/48)
   Reads the generated cropped PNGs and wraps them in a standard ICO container. */
const fs = require('fs');
const path = require('path');

const brand = path.join(__dirname, '..', 'assets', 'branding');
const entries = [
  { file: '.tmp-icon-16.png', size: 16 },
  { file: 'booyahx-icon.png', size: 32 },
  { file: '.tmp-icon-48.png', size: 48 }
];

const parts = entries.map(e => {
  const data = fs.readFileSync(path.join(brand, e.file));
  if (data.toString('ascii', 1, 4) !== 'PNG') throw new Error(e.file + ' is not a PNG');
  return { ...e, data };
});

// ICO header: reserved(0), type(1), count
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(parts.length, 4);

let offset = 6 + parts.length * 16;
const dir = [];
for (const p of parts) {
  const e = Buffer.alloc(16);
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 0); // width (0 = 256)
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 1); // height
  e.writeUInt8(0, 2);  // palette
  e.writeUInt8(0, 3);  // reserved
  e.writeUInt16LE(1, 4);  // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(p.data.length, 8);
  e.writeUInt32LE(offset, 12);
  dir.push(e);
  offset += p.data.length;
}

const out = Buffer.concat([header, ...dir, ...parts.map(p => p.data)]);
const outPath = path.join(brand, 'favicon.ico');
fs.writeFileSync(outPath, out);

// validate
const head = fs.readFileSync(outPath);
const ok = head.readUInt16LE(0) === 0 && head.readUInt16LE(2) === 1 && head.readUInt16LE(4) === 3;
console.log(`favicon.ico written: ${out.length} bytes, entries=${head.readUInt16LE(4)}, header-ok=${ok}`);

// remove temp PNGs (kept only inside the .ico — no duplicate loose assets)
for (const f of ['.tmp-icon-16.png', '.tmp-icon-48.png']) {
  const p = path.join(brand, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log('temp entries cleaned; final assets:');
for (const f of fs.readdirSync(brand)) {
  console.log('  assets/branding/' + f + ' (' + fs.statSync(path.join(brand, f)).size + ' bytes)');
}
if (!ok) process.exit(1);
