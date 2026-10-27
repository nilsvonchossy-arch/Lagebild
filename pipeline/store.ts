// Ablage im Daten-Branch: ein JSON pro Tag, ein Index fürs Archiv, Audio nur für die letzten Tage.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Briefing, DayIndex, Line } from '../src/shared/types.ts';
import { SCHEMA_VERSION } from '../src/shared/types.ts';

const DAY = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function readJSON<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
}

export function writeJSON(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1) + '\n');
}

export const dayPath = (out: string, date: string): string => join(out, `${date}.json`);

/** Alle Tage im Ordner, neueste zuerst. */
export function listDays(out: string): string[] {
  if (!existsSync(out)) return [];
  return readdirSync(out).map(f => DAY.exec(f)?.[1]).filter((d): d is string => Boolean(d)).sort().reverse();
}

export function writeIndex(out: string, updated: string): DayIndex {
  const days = listDays(out).map(date => {
    const b = readJSON<Briefing>(dayPath(out, date));
    return { date, count: b?.stories.length ?? 0, top: b?.stories[0]?.headline ?? '' };
  }).filter(d => d.count > 0);
  const idx: DayIndex = { schema: SCHEMA_VERSION, updated, days };
  writeJSON(join(out, 'index.json'), idx);
  return idx;
}

/** Überschriften des letzten Updates vor `date`, damit sich Meldungen nicht wiederholen. */
export function previousHeadlines(out: string, date: string): string[] {
  const prev = listDays(out).find(d => d < date);
  const b = prev ? readJSON<Briefing>(dayPath(out, prev)) : null;
  return b?.stories.map(s => s.headline.replace(/[[\]]/g, '')) ?? [];
}

/** Alle Zeilen eines Tages (Begrüßung, Meldungen, Märkte, Schluss). */
export function allLines(b: Briefing): Line[] {
  return [b.intro.morning, b.intro.day, b.intro.evening, ...b.stories.flatMap(s => [s.opener, ...s.lines]), ...(b.markets ? [b.markets.opener, ...b.markets.lines] : []), ...b.outro];
}

/**
 * Audio älter als `keepDays` löschen. Die Texte bleiben im Archiv; die Verweise auf die MP3s werden
 * entfernt, damit die App bei alten Tagen gleich die Systemstimme nimmt.
 */
export function pruneAudio(out: string, today: string, keepDays: number): string[] {
  const dir = join(out, 'audio');
  if (!existsSync(dir)) return [];
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) - keepDays * 86400000).toISOString().slice(0, 10);
  const removed: string[] = [];
  for (const d of readdirSync(dir)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit) {
      rmSync(join(dir, d), { recursive: true, force: true });
      removed.push(d);
      const b = readJSON<Briefing>(dayPath(out, d));
      if (b) {
        for (const l of allLines(b)) delete l.audio;
        writeJSON(dayPath(out, d), b);
      }
    }
  }
  return removed;
}
