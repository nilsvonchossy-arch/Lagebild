// Baut eine Vorschau der App ohne Service Worker (für eine claude.ai-Vorschauseite) nach vorschau/:
// lagebild.html ohne eigene html/head/body-Tags (die Seite bekommt beim Veröffentlichen ein Gerüst)
// und files.json mit den Dateien, die mitveröffentlicht werden. Aufruf: npm run vorschau
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const out = resolve('vorschau');
execSync(`npx vite build --outDir ${out} --emptyOutDir`, { stdio: 'inherit', env: { ...process.env, LAGEBILD_PREVIEW: '1' } });

let html = readFileSync(join(out, 'index.html'), 'utf8')
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?(?:html|head|body)\b[^>]*>\s*/gi, '')
  .replace(/<meta charset="utf-8">\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<link rel="(?:apple-touch-icon|icon)"[^>]*>\s*/g, '')
  // Seitenränder nutzen schon max(16px, env(safe-area-inset-*)) auf #app
  .replace('<title>Lagebild</title>', '<title>Lagebild</title>\n<meta name="claude:viewport-fit-sides" content="cover">');
writeFileSync(join(out, 'lagebild.html'), html);

const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = {};
for (const p of walk(out)) {
  const rel = relative(out, p).split('\\').join('/');
  if (!/^(assets|demo)\//.test(rel)) continue;
  // nur woff2 in lateinischen Schnitten; die CSS fordert für deutsche Texte nichts anderes an
  if (rel.endsWith('.woff') || (rel.endsWith('.woff2') && !/-latin(-ext)?-\d+-normal/.test(rel))) continue;
  files[rel] = p;
}
writeFileSync(join(out, 'files.json'), JSON.stringify(files, null, 1) + '\n');
console.log(`vorschau/lagebild.html und ${Object.keys(files).length} Dateien`);
