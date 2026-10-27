// Erzeugt src/geo/countries.json: ISO-3 → [Zahlencode in world-atlas, ISO-2, deutscher Name].
// world-atlas führt Länder unter dem numerischen ISO-Code, unser Datenschema unter ISO-3.
// Aufruf: npm run gen:countries (nur nötig, wenn i18n-iso-countries aktualisiert wird).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const iso = require('i18n-iso-countries');
iso.registerLocale(require('i18n-iso-countries/langs/de.json'));

const out = {};
for (const a3 of Object.keys(iso.getAlpha3Codes()).sort()) {
  out[a3] = [iso.alpha3ToNumeric(a3), iso.alpha3ToAlpha2(a3), iso.getName(a3, 'de', { select: 'official' })];
}
// Kosovo hat keinen offiziellen ISO-Code; world-atlas führt es ohne Zahlencode unter dem Namen.
out.XKX = [null, 'XK', 'Kosovo'];

writeFileSync(new URL('../src/geo/countries.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(Object.keys(out).length, 'Länder geschrieben');
