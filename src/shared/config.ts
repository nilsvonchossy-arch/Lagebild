// Themen-Konfiguration (config/themen.json). Die App bearbeitet sie, die Pipeline recherchiert danach.

export type Priority = 1 | 2 | 3;

export const PRIORITY_LABEL: Record<Priority, string> = { 3: 'Hoch', 2: 'Mittel', 1: 'Niedrig' };

export interface ConfigCategory {
  id: string;
  name: string;
  color: string;
}

export interface Topic {
  id: string;
  name: string;
  category: string;
  /** 3 = hoch, 2 = mittel, 1 = niedrig */
  priority: Priority;
  active: boolean;
  /** Worum es geht; hilft Claude bei der Auswahl */
  description?: string;
  /** Suchbegriffe für die Stichwortsuche (GDELT) */
  search: string[];
  /** Feed-IDs aus config/quellen.json */
  feeds: string[];
  /** Mindestens so viele Meldungen pro Tag, wenn es passende gibt */
  minPerDay?: number;
  /** Im Interface angelegt */
  custom?: boolean;
}

export interface ThemenConfig {
  version: 1;
  stories: { min: number; max: number };
  categories: ConfigCategory[];
  topics: Topic[];
}

export const LIMITS = { topics: 40, search: 12, term: 60, name: 40, description: 200 };

/** Prüft eine Konfiguration und liefert verständliche Fehlermeldungen (leer = in Ordnung). */
export function validateConfig(c: unknown): string[] {
  const errs: string[] = [];
  const cfg = c as Partial<ThemenConfig> | null;
  if (!cfg || typeof cfg !== 'object') return ['Konfiguration fehlt'];
  if (cfg.version !== 1) errs.push('version muss 1 sein');
  const st = cfg.stories;
  if (!st || !(st.min >= 1) || !(st.max >= st.min) || st.max > 10) errs.push('stories: min/max ungültig');
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
    if (![1, 2, 3].includes(t.priority)) errs.push(`${where}: Priorität muss 1, 2 oder 3 sein`);
    if (typeof t.active !== 'boolean') errs.push(`${where}: active fehlt`);
    if (!Array.isArray(t.search) || t.search.length > LIMITS.search || t.search.some(s => typeof s !== 'string' || !s.trim() || s.length > LIMITS.term)) errs.push(`${where}: Suchbegriffe ungültig`);
    if (!Array.isArray(t.feeds)) errs.push(`${where}: feeds fehlt`);
    if (t.description && t.description.length > LIMITS.description) errs.push(`${where}: Beschreibung zu lang`);
    if (!t.search?.length && !t.feeds?.length) errs.push(`${where}: braucht Suchbegriffe oder Feeds`);
  }
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
