// Erzeugt docs/icon.svg: Globus im Look der App (echte Ländergrenzen aus world-atlas),
// Blick auf Europa, oranger Pin auf Berlin. Die PNGs fürs iPad werden daraus gerendert
// (scripts/render-icons.mjs, braucht Playwright mit Chromium).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-110m.json');
const land = feature(topo, topo.objects.countries);

const S = 512, cx = 256, cy = 262, R = 176;
const proj = geoOrthographic().translate([cx, cy]).scale(R).rotate([-12, -38, 0]).clipAngle(90).precision(0.3);
const path = geoPath(proj);
const pin = proj([13.4, 52.52]);
const f = n => n.toFixed(1);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<defs>
  <radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#0b1422"/><stop offset="1" stop-color="#05070a"/></radialGradient>
  <radialGradient id="sea" cx="${f(cx - R * 0.35)}" cy="${f(cy - R * 0.4)}" r="${f(R * 1.4)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#13233a"/><stop offset=".6" stop-color="#0a1220"/><stop offset="1" stop-color="#04070c"/></radialGradient>
  <radialGradient id="glow" cx="${cx}" cy="${cy}" r="${f(R * 1.3)}" gradientUnits="userSpaceOnUse"><stop offset=".72" stop-color="#4690ff" stop-opacity=".55"/><stop offset="1" stop-color="#4690ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="glow2" cx="${f(cx + R * 0.22)}" cy="${f(cy + R * 0.2)}" r="${f(R * 1.2)}" gradientUnits="userSpaceOnUse"><stop offset=".66" stop-color="#ff3c3c" stop-opacity=".3"/><stop offset="1" stop-color="#ff3c3c" stop-opacity="0"/></radialGradient>
  <linearGradient id="rim" x1="${cx - R}" y1="${cy - R}" x2="${cx + R}" y2="${cy + R}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#78afff"/><stop offset=".55" stop-color="#78afff" stop-opacity=".2"/><stop offset="1" stop-color="#ff5050" stop-opacity=".85"/></linearGradient>
</defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>
<circle cx="${cx}" cy="${cy}" r="${f(R * 1.3)}" fill="url(#glow)"/>
<circle cx="${f(cx + R * 0.22)}" cy="${f(cy + R * 0.2)}" r="${f(R * 1.2)}" fill="url(#glow2)"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#sea)"/>
<path d="${path(geoGraticule10())}" fill="none" stroke="#8caad7" stroke-opacity=".12" stroke-width="1"/>
<path d="${path(land)}" fill="#1c2735" stroke="#9bb4d7" stroke-opacity=".45" stroke-width="1.2" stroke-linejoin="round"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="url(#rim)" stroke-width="3"/>
<circle cx="${f(pin[0])}" cy="${f(pin[1])}" r="22" fill="none" stroke="#ff7a3d" stroke-opacity=".55" stroke-width="3"/>
<circle cx="${f(pin[0])}" cy="${f(pin[1])}" r="9" fill="#fff" stroke="#ff7a3d" stroke-width="4"/>
</svg>
`;
writeFileSync(new URL('../docs/icon.svg', import.meta.url), svg);
console.log('docs/icon.svg geschrieben', (svg.length / 1024).toFixed(0), 'KB');
