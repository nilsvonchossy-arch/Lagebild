// Archivbilder: Zu den Bildmotiven einer Meldung (Personen, Orte, Organisationen, Bauwerke) wird über
// Wikidata das hinterlegte Bild (Eigenschaft P18) gesucht und von Wikimedia Commons geladen. Nur freie
// Lizenzen (CC0, CC BY, CC BY-SA, gemeinfrei); Urheber und Lizenz werden mitgespeichert und angezeigt.
// Die Bilder zeigen das Motiv, nicht das Ereignis; die App beschriftet sie deshalb als „Archivbild“.
//
//   node pipeline/bilder.ts --motive scripts/demo-motive.json --out public/demo --dir bilder
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ArchiveImage } from '../src/shared/types.ts';
import { log } from './util.ts';

export interface Motive { name: string; art: string; suche: string }

/** Wikimedia bittet um eine Kennung mit Kontakt; die Projektseite genügt. */
const UA = 'Lagebild/1.0 (personal news briefing; https://github.com/nilsvonchossy-arch/Lagebild)';
const HUMAN = 'Q5';
const DISAMBIGUATION = 'Q4167410';

export type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = url => fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });

async function json<T>(f: Fetcher, url: string): Promise<T> {
  const res = await f(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Freie Lizenz? Commons-Kurzname, z. B. „CC BY-SA 4.0“, „CC0“, „Public domain“. */
export function freeLicense(name: string): boolean {
  const n = name.trim();
  return /^CC0\b/i.test(n) || /^CC[ -]BY(?:[ -]SA)?(?:[ -]\d(?:\.\d)?)?\b/i.test(n) || /^(public domain|PD\b|gemeinfrei)/i.test(n);
}

/** HTML aus den Commons-Metadaten zu schlichtem Text */
export function plain(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]+>/g, ' ').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Wort, bei dem das Bild im Dialog erscheint: bei Personen der Nachname, sonst der Name. */
export function matchWord(m: Motive): string {
  const name = m.name.trim();
  return /person/i.test(m.art) ? name.split(/\s+/).pop()! : name;
}

interface SearchResult { search?: { id: string; label?: string; description?: string; match?: { type?: string; text?: string } }[] }

/** Für den Namensvergleich: klein, ohne Akzente, Satzzeichen und Leerzeichen */
export const nameKey = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
interface Claim { mainsnak: { datavalue?: { value: unknown } } }
interface Entities { entities?: Record<string, { labels?: Record<string, { value: string }>; claims?: Record<string, Claim[]> }> }
interface ImageInfo {
  query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; thumbwidth?: number; thumbheight?: number; descriptionurl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[] }> };
}

const ids = (claims: Claim[] | undefined): string[] =>
  (claims ?? []).map(c => (c.mainsnak.datavalue?.value as { id?: string } | undefined)?.id).filter((x): x is string => Boolean(x));

/** Wikidata-Eintrag zum Motiv mit Bild: bei Personen nur Menschen, nie Begriffsklärungen, bei Orten und Bauwerken mit Koordinaten. */
async function findEntity(m: Motive, f: Fetcher): Promise<{ label: string; file: string } | null> {
  const q = encodeURIComponent(m.suche.trim() || m.name.trim());
  const found = await json<SearchResult>(f, `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=de&uselang=de&type=item&limit=6&format=json`);
  // Nur Treffer, deren Name oder Alias genau dem Suchnamen entspricht – sonst lieber kein Bild als ein falsches
  const want = nameKey(m.suche.trim() || m.name.trim());
  const named = new Map<string, string>();
  for (const x of found.search ?? []) {
    const hit = [x.match?.text, x.label].find(t => t && nameKey(t) === want);
    if (hit) named.set(x.id, hit);
  }
  const cand = [...named.keys()];
  if (!cand.length) return null;
  const ent = await json<Entities>(f, `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cand.join('|')}&props=claims|labels&languages=de|en&format=json`);
  for (const id of cand) {
    const e = ent.entities?.[id];
    if (!e) continue;
    const types = ids(e.claims?.P31);
    if (types.includes(DISAMBIGUATION)) continue;
    if (/person/i.test(m.art) !== types.includes(HUMAN)) continue;
    if (/ort|bauwerk/i.test(m.art) && !e.claims?.P625?.length) continue;
    const file = e.claims?.P18?.[0]?.mainsnak.datavalue?.value;
    if (typeof file !== 'string') continue;
    return { label: named.get(id)!, file };
  }
  return null;
}

/** Ein Archivbild: Metadaten von Commons, Vorschaubild (960 px breit) in `outDir/dir` speichern. */
export async function resolveImage(m: Motive, outDir: string, dir: string, f: Fetcher = defaultFetch): Promise<ArchiveImage | { error: string }> {
  try {
    const ent = await findEntity(m, f);
    if (!ent) return { error: `kein Wikidata-Eintrag mit Bild für „${m.suche || m.name}“` };
    const title = encodeURIComponent(`File:${ent.file}`);
    const info = await json<ImageInfo>(f, `https://commons.wikimedia.org/w/api.php?action=query&titles=${title}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=960&format=json`);
    const ii = Object.values(info.query?.pages ?? {})[0]?.imageinfo?.[0];
    if (!ii?.thumburl || !ii.descriptionurl) return { error: `Commons ohne Vorschau: ${ent.file}` };
    const meta = ii.extmetadata ?? {};
    const license = plain(meta.LicenseShortName?.value);
    if (!freeLicense(license)) return { error: `Lizenz nicht frei: ${license || 'unbekannt'} (${ent.file})` };
    const author = plain(meta.Artist?.value) || plain(meta.Credit?.value);
    if (!author && !/^(CC0|public domain|PD)/i.test(license)) return { error: `ohne Urheberangabe: ${ent.file}` };
    const res = await f(ii.thumburl);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) return { error: `Vorschau nicht ladbar (${res.status} ${type})` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 1_500_000) return { error: `Vorschau zu groß (${bytes.length} Bytes)` };
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const name = `${createHash('sha1').update(ent.file).digest('hex').slice(0, 12)}.${ext}`;
    mkdirSync(join(outDir, dir), { recursive: true });
    writeFileSync(join(outDir, dir, name), bytes);
    return {
      src: `${dir}/${name}`,
      w: ii.thumbwidth ?? 960,
      h: ii.thumbheight ?? 640,
      motif: ent.label,
      match: matchWord(m),
      author: (author || 'unbekannt').slice(0, 90),
      license,
      ...(meta.LicenseUrl?.value ? { licenseUrl: plain(meta.LicenseUrl.value) } : {}),
      page: ii.descriptionurl
    };
  } catch (e) {
    return { error: `${m.name}: ${(e as Error).message}` };
  }
}

/** Bilder zu allen Motiven einer Meldung; Fehler landen im Protokoll, die Meldung bleibt. */
export async function resolveImages(motive: Motive[], outDir: string, dir: string, issues: string[], f: Fetcher = defaultFetch): Promise<ArchiveImage[]> {
  const out: ArchiveImage[] = [];
  for (const m of motive.slice(0, 2)) {
    const r = await resolveImage(m, outDir, dir, f);
    if ('error' in r) issues.push(`Archivbild: ${r.error}`);
    else if (!out.some(x => x.src === r.src)) out.push(r);
  }
  return out;
}

// Direkt aufgerufen: Bilder für eine Liste von Motiven holen (Demo-Folge)
if (import.meta.main) {
  const { values } = parseArgs({ options: { motive: { type: 'string' }, out: { type: 'string', default: 'bilder-out' }, dir: { type: 'string', default: 'bilder' } } });
  const list = JSON.parse(readFileSync(values.motive!, 'utf8')) as Record<string, Motive[]>;
  const result: Record<string, ArchiveImage[]> = {};
  const issues: string[] = [];
  for (const [story, motive] of Object.entries(list)) result[story] = await resolveImages(motive, values.out!, values.dir!, issues);
  writeFileSync(join(values.out!, `${values.dir}.json`), JSON.stringify({ images: result, issues }, null, 1) + '\n');
  for (const i of issues) log(i);
  log(`${Object.values(result).flat().length} Archivbilder gespeichert`);
}
