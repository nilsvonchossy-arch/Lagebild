// Ort einer Meldung prüfen und die Zoomstufe für die Kamerafahrt bestimmen (aus world-atlas 50m,
// derselben Karte wie in der App).
import { geoCentroid, geoContains, geoDistance } from 'd3-geo';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import topo50 from 'world-atlas/countries-50m.json' with { type: 'json' };
import CODES from '../src/geo/countries.json' with { type: 'json' };

const codes = CODES as unknown as Record<string, [string | null, string, string]>;
type Geo = Polygon | MultiPolygon;
const world = feature(topo50 as unknown as Topology, (topo50 as unknown as Topology).objects.countries as GeometryCollection<{ name: string }>);

export function countryInfo(iso3: string): { numeric: string | null; iso2: string; name: string } | null {
  const c = codes[iso3.toUpperCase()];
  return c ? { numeric: c[0], iso2: c[1], name: c[2] } : null;
}

export function flagEmoji(iso3: string): string {
  const info = countryInfo(iso3);
  if (!info) return '';
  return [...info.iso2.toUpperCase()].map(ch => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65)).join('');
}

/** Alle Flächen eines Landes als einzelne Polygone. */
function polygons(iso3: string): Feature<Polygon>[] {
  const info = countryInfo(iso3);
  if (!info) return [];
  const out: Feature<Polygon>[] = [];
  for (const f of world.features) {
    if (info.numeric ? String(f.id) !== info.numeric : f.properties.name !== info.name) continue;
    const g = f.geometry as Geo | null;
    if (!g) continue;
    const polys: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const coordinates of polys) out.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } });
  }
  return out;
}

function radiusOf(p: Feature<Polygon>, center: [number, number]): number {
  let r = 0;
  for (const ring of p.geometry.coordinates) for (const v of ring) r = Math.max(r, geoDistance(center, v as [number, number]));
  return r;
}

export interface Place { lon: number; lat: number; zoom: number; country: string; flag: string; moved: boolean }

/**
 * Prüft die von Claude genannten Koordinaten: Liegen sie im Land (oder nah dran, z. B. Küstenstädte)?
 * Sonst Mittelpunkt der größten Landfläche. Zoom: die größte Landfläche soll gut ins Bild passen.
 */
export function resolvePlace(iso3: string, lon: number, lat: number): Place | null {
  const iso = iso3.toUpperCase();
  const polys = polygons(iso);
  if (!polys.length) return null;
  const pt: [number, number] = [lon, lat];
  const valid = Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  // größte Fläche des Landes (meist das Festland) bestimmt die Zoomstufe,
  // sonst würde z. B. New York auf Long Island viel zu nah herangeholt
  const main = polys.reduce((a, b) => (radiusOf(b, geoCentroid(b) as [number, number]) > radiusOf(a, geoCentroid(a) as [number, number]) ? b : a));
  const nearKm = 150;
  const inside = valid && polys.some(p => geoContains(p, pt));
  const close = valid && !inside && polys.some(p => p.geometry.coordinates[0]!.some(v => geoDistance(pt, v as [number, number]) * 6371 < nearKm));
  let moved = false;
  let at = pt;
  if (!inside && !close) {
    at = geoCentroid(main) as [number, number];
    moved = true;
  }
  const r = radiusOf(main, geoCentroid(main) as [number, number]);
  const zoom = Math.min(10, Math.max(2.6, 0.45 / Math.sin(Math.max(r, 0.01))));
  return { lon: +at[0].toFixed(2), lat: +at[1].toFixed(2), zoom: +zoom.toFixed(1), country: iso, flag: flagEmoji(iso), moved };
}
