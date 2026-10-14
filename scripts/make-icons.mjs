// Renders public/icon.svg into the PNG sizes iOS and the PWA manifest need.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url));
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
await sharp(svg).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('icon-512.png'));
// Maskable: full-bleed background so Android/desktop masks don't show corners.
await sharp(svg)
  .resize(410, 410)
  .extend({ top: 51, bottom: 51, left: 51, right: 51, background: '#14121a' })
  .png()
  .toFile(out('icon-512-maskable.png'));
console.log('icons written');
