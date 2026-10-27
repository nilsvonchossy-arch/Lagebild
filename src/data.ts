// Laden der Tages-Updates. data/ kommt beim Deploy aus dem Branch "daten" dazu;
// solange es dort noch nichts gibt, zeigt die App die Demo mit den Prototyp-Meldungen.
import type { Briefing, DayIndex } from './shared/types';

const BASE = import.meta.env.BASE_URL;
export const DATA_BASE = `${BASE}data/`;
const DEMO_URL = `${BASE}demo/2026-10-27.json`;

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const loadIndex = (): Promise<DayIndex | null> => getJSON<DayIndex>(`${DATA_BASE}index.json`);

export const loadDay = (date: string): Promise<Briefing | null> => getJSON<Briefing>(`${DATA_BASE}${date}.json`);

export const loadDemo = (): Promise<Briefing | null> => getJSON<Briefing>(DEMO_URL);
