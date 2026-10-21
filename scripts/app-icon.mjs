// Builds the app icon files from the pixel masters in assets/app-icon.
// Usage: node scripts/app-icon.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const SRC = path.join(ROOT, 'assets/app-icon');
const master = path.join(SRC, 'clawdeck-32.png');

// One rectangle per run of same-colored pixels, so the SVG stays sharp at any size.
function pixelSvg(png, size) {
  const rows = execFileSync('magick', [png, '-depth', '8', 'txt:-'], { encoding: 'utf8' }).split('\n').slice(1);
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  for (const line of rows) {
    const m = line.match(/^(\d+),(\d+):.*#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?/);
    if (m && (m[4] === undefined || m[4].toUpperCase() === 'FF')) grid[+m[2]][+m[1]] = `#${m[3].toLowerCase()}`;
  }
  const paths = {};
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = grid[y][x];
      if (!c) continue;
      let run = 1;
      while (x + run < size && grid[y][x + run] === c) run++;
      paths[c] = (paths[c] || '') + `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const body = Object.entries(paths).map(([c, d]) => `  <path fill="${c}" d="${d}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">\n${body}\n</svg>\n`;
}

writeFileSync(path.join(ROOT, 'assets/icon.svg'), pixelSvg(master, 32));
execFileSync('magick', [master, '-filter', 'point', '-resize', '800%', path.join(ROOT, 'assets/icon.png')]);
copyFileSync(master, path.join(ROOT, 'public/icon-32.png'));
copyFileSync(path.join(SRC, 'clawdeck-16.png'), path.join(ROOT, 'public/icon-16.png'));
console.log('Wrote assets/icon.svg, assets/icon.png (256 px), public/icon-16.png, public/icon-32.png');
