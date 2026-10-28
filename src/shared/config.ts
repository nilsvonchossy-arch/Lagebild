// Themen-Konfiguration (config/themen.json). Die App bearbeitet sie, die Pipeline recherchiert danach.
//
// Version 2: Jedes Thema hat eine Gewichtung in vier Stufen statt Priorität und Ein/Aus-Schalter.
// Dazu kommen Länge und Ton der Folge. Version 1 wird beim Laden übersetzt (migrateConfig).
import type { Tone } from './types.ts';

export type Weight = 'aus' | 'kurz' | 'normal' | 'ausfuehrlich';

export const WEIGHTS: Weight[] = ['aus', 'kurz', 'normal', 'ausfuehrlich'];
export const WEIGHT_LABEL: Record<Weight, string> = { aus: 'Aus', kurz: 'Nur kurz', normal: 'Normal', ausfuehrlich: 'Ausführlich' };

export const MINUTES = [3, 5, 8] as const;
export const TONES: Tone[] = ['assistent', 'lagezentrum', 'podcast'];
export const TONE_LABEL: Record<Tone, string> = { assistent: 'Assistent', lagezentrum: 'Lagezentrum', podcast: 'Podcast' };
/** Wer die Folge spricht: offenes Modell VoxCPM2 (kostenlos auf dem GitHub-Server) oder Azure (Gratis-Kontingent) */
export type VoiceEngine = 'voxcpm2' | 'azure';
export const VOICE_ENGINES: VoiceEngine[] = ['voxcpm2', 'azure'];
export const VOICE_LABEL: Record<VoiceEngine, string> = { voxcpm2: 'VoxCPM2', azure: 'Azure' };

export interface ConfigCategory {
  id: string;
  name: string;
  color: string;
}

export interface Topic {
  id: string;
  name: string;
  category: string;
  /** aus = wird nicht recherchiert, kurz = höchstens „Kurz notiert“, ausfuehrlich = darf vertieft werden */
  weight: Weight;
  /** Worum es geht; hilft Claude bei der Auswahl */
  description?: string;
  /** Suchbegriffe für die Stichwortsuche */
  search: string[];
  /** Feed-IDs aus config/quellen.json */
  feeds: string[];
  /** Mindestens so viele Meldungen pro Tag, wenn es passende gibt */
  minPerDay?: number;
  /** Im Interface angelegt */
  custom?: boolean;
}

export interface ThemenConfig {
  version: 2;
  /** Länge in Minuten, Ton und Stimme der Folge (ohne Angabe: VoxCPM2); name: wie der Assistent dich anspricht */
  episode: { minutes: number; tone: Tone; voice?: VoiceEngine; name?: string };
  categories: ConfigCategory[];
  topics: Topic[];
}

export const LIMITS = { topics: 40, search: 12, term: 60, name: 40, description: 200 };

export const isActive = (t: Topic): boolean => t.weight !== 'aus';

interface TopicV1 extends Omit<Topic, 'weight'> { priority?: number; active?: boolean }

/** Version 1 (Priorität 1–3 und aktiv) in Version 2 übersetzen; Version 2 bleibt unverändert. */
export function migrateConfig(raw: unknown): ThemenConfig {
  const c = raw as { version?: number; stories?: { max?: number }; episode?: ThemenConfig['episode']; categories?: ConfigCategory[]; topics?: (Topic | TopicV1)[] } | null;
  if (!c || typeof c !== 'object' || c.version !== 1) return raw as ThemenConfig;
  const toWeight = (t: TopicV1): Weight => (t.active === false ? 'aus' : t.priority === 3 ? 'ausfuehrlich' : t.priority === 1 ? 'kurz' : 'normal');
  return {
    version: 2,
    episode: { minutes: 3, tone: 'assistent', voice: 'voxcpm2' },
    categories: c.categories ?? [],
    topics: (c.topics ?? []).map(t => {
      const { priority: _p, active: _a, ...rest } = t as TopicV1;
      return { ...rest, weight: toWeight(t as TopicV1) } as Topic;
    })
  };
}

/** Prüft eine Konfiguration und liefert verständliche Fehlermeldungen (leer = in Ordnung). */
export function validateConfig(c: unknown): string[] {
  const errs: string[] = [];
  const cfg = c as Partial<ThemenConfig> | null;
  if (!cfg || typeof cfg !== 'object') return ['Konfiguration fehlt'];
  if (cfg.version !== 2) errs.push('version muss 2 sein');
  const ep = cfg.episode;
  if (!ep || !Number.isInteger(ep.minutes) || ep.minutes < 2 || ep.minutes > 12) errs.push('episode.minutes muss 2–12 sein');
  if (!ep || !TONES.includes(ep.tone)) errs.push('episode.tone ungültig');
  if (ep?.voice !== undefined && !VOICE_ENGINES.includes(ep.voice)) errs.push('episode.voice ungültig');
  if (ep?.name !== undefined && (typeof ep.name !== 'string' || ep.name.length > 30 || !/^[\p{L}' .-]*$/u.test(ep.name))) errs.push('episode.name: höchstens 30 Zeichen, nur Buchstaben');
  const cats = Array.isArray(cfg.categories) ? cfg.categories : [];
  if (!cats.length) errs.push('Keine Kategorien');
  const catIds = new Set(cats.map(k => k.id));
  for (const k of cats) {
    if (!/^[a-z0-9-]+$/.test(k.id ?? '')) errs.push(`Kategorie-ID ungültig: ${k.id}`);
    if (!/^#[0-9a-f]{6}$/i.test(k.color ?? '')) errs.push(`Farbe ungültig bei ${k.id}`);
  }
  const topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  if (topics.length > LIMITS.topics) errs.push(`Höchstens ${LIMITS.topics} Themen`);
  const ids = new Set<string>();
  for (const t of topics) {
    const where = `Thema „${t.name ?? t.id}“`;
    if (!/^[a-z0-9-]+$/.test(t.id ?? '')) errs.push(`${where}: ID ungültig`);
    if (ids.has(t.id)) errs.push(`${where}: ID doppelt`);
    ids.add(t.id);
    if (!t.name?.trim() || t.name.length > LIMITS.name) errs.push(`${where}: Name fehlt oder ist zu lang`);
    if (!catIds.has(t.category)) errs.push(`${where}: unbekannte Kategorie ${t.category}`);
    if (!WEIGHTS.includes(t.weight)) errs.push(`${where}: Gewichtung muss aus, kurz, normal oder ausfuehrlich sein`);
    if (!Array.isArray(t.search) || t.search.length > LIMITS.search || t.search.some(s => typeof s !== 'string' || !s.trim() || s.length > LIMITS.term)) errs.push(`${where}: Suchbegriffe ungültig`);
    if (!Array.isArray(t.feeds)) errs.push(`${where}: feeds fehlt`);
    if (t.description && t.description.length > LIMITS.description) errs.push(`${where}: Beschreibung zu lang`);
    if (!t.search?.length && !t.feeds?.length) errs.push(`${where}: braucht Suchbegriffe oder Feeds`);
  }
  if (topics.length && !topics.some(t => t.weight !== 'aus')) errs.push('Mindestens ein Thema muss eingeschaltet sein');
  return errs;
}

/** ID aus einem Namen: „KI & Arbeit“ → „ki-arbeit“ (eindeutig gegenüber vorhandenen IDs). */
export function slugify(name: string, taken: Iterable<string> = []): string {
  const base = name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'thema';
  const used = new Set(taken);
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}
