// Turns the 16×16 1-bit PNGs in assets/icons into SVG paths in src/icons.js.
// Usage: node scripts/icons.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const DIR = path.join(ROOT, 'assets/icons');
const out = {};

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.png') && !f.startsWith('_')).sort()) {
  const png = path.join(DIR, file);
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', png], { encoding: 'utf8' }).split(' ').map(Number);
  if (w !== 16 || h !== 16) throw new Error(`${file} is ${w}×${h}, not 16×16`);
  const alpha = execFileSync('magick', [png, '-alpha', 'extract', '-depth', '8', 'gray:-']);
  let d = '';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (alpha[y * 16 + x] < 128) continue;
      let run = 1;
      while (x + run < 16 && alpha[y * 16 + x + run] >= 128) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  out[path.basename(file, '.png')] = d;
}

const body = Object.entries(out).map(([k, v]) => `  '${k}': '${v}',`).join('\n');
writeFileSync(path.join(ROOT, 'src/icons.js'), `// Made by scripts/icons.mjs from assets/icons. Do not edit by hand.\nexport default {\n${body}\n};\n`);
console.log(`${Object.keys(out).length} icons written to src/icons.js`);
