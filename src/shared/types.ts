// Datenformat eines Tages-Updates (data/JJJJ-MM-TT.json). Die Pipeline schreibt es, die App liest es.
// Bei inkompatiblen Änderungen SCHEMA_VERSION erhöhen und CLAUDE.md anpassen.

export const SCHEMA_VERSION = 1;

export type Role = 'BRIEFING' | 'LAGE' | 'EINORDNUNG';

/** Vorproduzierte Sprachausgabe einer Zeile. */
export interface AudioClip {
  /** Pfad relativ zum Datenordner, z. B. "audio/2026-10-28/israel-1.mp3" */
  src: string;
  /** Länge in Sekunden */
  dur: number;
  /** Wortenden als [Sekunde, Anteil am Sprechtext 0..1] für synchrone Untertitel */
  words?: [number, number][];
}

export interface Line {
  role: Role;
  /** Untertitel */
  text: string;
  /** Abweichender Sprechtext, z. B. "S und P 500" statt "S&P 500" */
  say?: string;
  audio?: AudioClip;
}

export interface Figure {
  value: number;
  dec: number;
  prefix?: string;
  suffix?: string;
  label: string;
}

export interface Source {
  name: string;
  url: string;
  /** Veröffentlichungsdatum JJJJ-MM-TT */
  date: string;
  title?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Story {
  id: string;
  /** Category.id, bestimmt die Akzentfarbe */
  category: string;
  /** Anzeigename des Themas, z. B. "Nahost-Konflikt" */
  topic: string;
  /** Relevanz 1–5, eine redaktionelle Einschätzung, kein Fakt */
  relevance?: number;
  relevanceNote?: string;
  /** ISO-3-Code für die Hervorhebung des Landes */
  country: string;
  label: string;
  flag: string;
  lon: number;
  lat: number;
  zoom: number;
  /** [..] markiert Wörter in Akzentfarbe */
  headline: string;
  brief: string;
  figure?: Figure;
  source: Source;
  /** Kurzform für die Zusammenfassung im Outro */
  short: string;
  /** BRIEFING-Überleitung vor der Meldung */
  opener: Line;
  lines: Line[];
}

export interface Briefing {
  schema: number;
  /** JJJJ-MM-TT */
  date: string;
  /** ISO-Zeitpunkt der Erstellung */
  generated: string;
  /** Hinweis für die Startseite, z. B. bei Demo-Daten */
  note?: string;
  categories: Category[];
  /** Begrüßung je nach Tageszeit */
  intro: { morning: Line; day: Line; evening: Line };
  outro: Line[];
  stories: Story[];
  /** Wie das Update entstanden ist (Modell, Kosten in US-Dollar) */
  meta?: { model: string; costUsd: number };
}

export interface DayIndex {
  schema: number;
  updated: string;
  days: { date: string; count: number; top: string }[];
}
