// Weltkarte aus world-atlas (Natural Earth). 110m für den ganzen Globus, 50m wird nachgeladen
// und beim Heranzoomen gezeichnet. Beides liegt als eigene Datei im Build, nicht auf einem CDN.
import { geoCentroid, geoDistance } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import url110 from 'world-atlas/countries-110m.json?url';
import url50 from 'world-atlas/countries-50m.json?url';
import CODES from './countries.json';

type CountryGeometry = Polygon | MultiPolygon;
type CountryProps = { name: string };

export interface Country {
  id: string | undefined;
  name: string;
  feature: Feature<CountryGeometry, CountryProps>;
  /** Mittelpunkt und Radius (Bogenmaß) eines umschließenden Kreises, zum Aussortieren unsichtbarer Länder */
  center: [number, number];
  radius: number;
}

/** Einzelne Fläche (Festland, Insel) mit eigenem Hüllkreis: so fällt z. B. Französisch-Guayana
 *  beim Blick auf Europa nicht mehr ins Gewicht. */
export interface Part {
  geometry: Polygon;
  center: [number, number];
  radius: number;
}

export interface WorldLayer {
  countries: Country[];
  parts: Part[];
}

const codes = CODES as unknown as Record<string, [string | null, string, string]>;

/** ISO-3 → [Zahlencode, ISO-2, deutscher Name] */
export function countryInfo(iso3: string): { numeric: string | null; iso2: string; name: string } | null {
  const c = codes[iso3.toUpperCase()];
  return c ? { numeric: c[0], iso2: c[1], name: c[2] } : null;
}

/** Flaggen-Emoji aus ISO-3 */
export function flagEmoji(iso3: string): string {
  const info = countryInfo(iso3);
  if (!info) return '';
  return [...info.iso2.toUpperCase()].map(ch => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65)).join('');
}

function hull(obj: Polygon | Feature<CountryGeometry>, polys: Position[][][]): { center: [number, number]; radius: number } {
  const center = geoCentroid(obj) as [number, number];
  let radius = 0;
  for (const poly of polys) for (const ring of poly) for (const p of ring) radius = Math.max(radius, geoDistance(center, p as [number, number]));
  return { center, radius };
}

export function buildLayer(topo: Topology): WorldLayer {
  const fc = feature(topo, topo.objects.countries as GeometryCollection<CountryProps>);
  const countries: Country[] = [];
  const parts: Part[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const feat = f as Feature<CountryGeometry, CountryProps>;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    countries.push({ id: f.id == null ? undefined : String(f.id), name: f.properties.name, feature: feat, ...hull(feat, polys) });
    for (const coordinates of polys) {
      const geometry: Polygon = { type: 'Polygon', coordinates };
      parts.push({ geometry, ...hull(geometry, [coordinates]) });
    }
  }
  return { countries, parts };
}

/** Alle Teilflächen eines Landes (manche Länder bestehen in 50m aus mehreren Einträgen). */
export function findCountry(layer: WorldLayer, iso3: string): Feature<MultiPolygon> | null {
  const info = countryInfo(iso3);
  if (!info) return null;
  const parts = layer.countries.filter(c => (info.numeric ? c.id === info.numeric : c.name === info.name));
  if (!parts.length) return null;
  const coordinates: Position[][][] = [];
  for (const p of parts) {
    const g = p.feature.geometry;
    if (g.type === 'Polygon') coordinates.push(g.coordinates);
    else coordinates.push(...g.coordinates);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } };
}

async function loadTopo(url: string): Promise<Topology> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weltkarte ${url}: HTTP ${res.status}`);
  return (await res.json()) as Topology;
}

export const loadWorld110 = async (): Promise<WorldLayer> => buildLayer(await loadTopo(url110));
export const loadWorld50 = async (): Promise<WorldLayer> => buildLayer(await loadTopo(url50));
