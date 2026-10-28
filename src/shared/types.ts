// Datenformat eines Tages-Updates (data/JJJJ-MM-TT.json). Die Pipeline schreibt es, die App liest es.
// Bei inkompatiblen Änderungen SCHEMA_VERSION erhöhen und CLAUDE.md anpassen.
//
// Version 2: Eine Folge ist ein durchgehendes Drehbuch (script) mit drei Rollen. Fakten jeder Meldung
// liegen einzeln und geprüft vor; jede Faktzeile im Drehbuch nennt die Fakten, auf denen sie beruht.

export const SCHEMA_VERSION = 2;

/** LEITUNG fragt und leitet über, LAGE berichtet, EINORDNUNG ordnet ein (Zuschreibungen, Vorbehalte). */
export type Role = 'LEITUNG' | 'LAGE' | 'EINORDNUNG';

/** Aufmacher 30–45 s, Meldung 15–25 s, Kurz notiert 5–10 s */
export type Format = 'aufmacher' | 'meldung' | 'kurz';

export type Tone = 'lagezentrum' | 'podcast';

/** Wo eine Zeile in der Audiodatei der Folge liegt. */
export interface LineAudio {
  /** Beginn in Sekunden ab Anfang der Folge */
  at: number;
  /** Länge in Sekunden */
  dur: number;
  /** Wortenden als [Sekunde ab Zeilenbeginn, Anteil am Sprechtext 0..1] für Untertitel und Bild-Beats */
  words?: [number, number][];
}

/** Art einer Zeile: Frage/Überleitung, Fakt, Zusammenfassung, feste Abschlussformel */
export type LineKind = 'frage' | 'fakt' | 'zusammenfassung' | 'abschluss';

export interface Line {
  role: Role;
  /** Untertitel */
  text: string;
  /** Abweichender Sprechtext, z. B. "S und P 500" statt "S&P 500" */
  say?: string;
  /** ID der Meldung, zu der die Zeile gehört; "maerkte" für die Marktdaten; fehlt bei Zusammenfassung und Abschluss */
  story?: string;
  kind: LineKind;
  /** IDs der geprüften Fakten, auf denen die Zeile beruht (nur Faktzeilen und Zusammenfassung) */
  facts?: string[];
  audio?: LineAudio;
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

/** Geprüfter Einzelfakt aus der Quelle */
export interface Fact {
  /** z. B. "A3": Buchstabe der Meldung in der Folge, Nummer des Fakts */
  id: string;
  text: string;
}

/** Weiterer Ort einer Meldung; bekommt einen eigenen Pin, sobald er genannt wird */
export interface Place {
  label: string;
  lon: number;
  lat: number;
  /** Von hier aus eine Linie zum Hauptort zeichnen (z. B. Flugroute), nur wenn die Quelle eine Bewegung beschreibt */
  route?: boolean;
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
  format: Format;
  /** ISO-3-Code für die Hervorhebung des Landes */
  country: string;
  label: string;
  flag: string;
  lon: number;
  lat: number;
  zoom: number;
  places?: Place[];
  /** Eine Zeile für die Karte, 5–9 Wörter; [..] markiert Wörter in Akzentfarbe */
  headline: string;
  /** „Kurz gesagt“ für Details und Endbildschirm */
  brief: string;
  figure?: Figure;
  source: Source;
  /** Schlagwort für die Zusammenfassung am Ende */
  short: string;
  facts: Fact[];
}

export interface MarketItem {
  id: string;
  name: string;
  value: number;
  dec: number;
  unit: string;
  /** Veränderung zum Vortag in Prozent */
  changePct: number;
  /** Handelstag JJJJ-MM-TT */
  date: string;
}

/** Marktdaten; die gesprochenen Sätze (Zeilen mit story "maerkte") werden ohne KI aus den Zahlen gebaut. */
export interface Markets {
  asOf: string;
  source: Source;
  items: MarketItem[];
}

export interface Briefing {
  schema: number;
  /** JJJJ-MM-TT */
  date: string;
  /** ISO-Zeitpunkt der Erstellung */
  generated: string;
  /** Hinweis für die Startseite, z. B. bei Demo-Daten */
  note?: string;
  /** Laufende Nummer der Folge */
  episode: number;
  tone: Tone;
  categories: Category[];
  stories: Story[];
  markets?: Markets;
  /** Die ganze Folge in Sprechreihenfolge */
  script: Line[];
  /** Gemischte Audiodatei der Folge: src mit Musikbett, voice nur Stimmen (Pfade relativ zum Datenordner) */
  audio?: { src: string; voice: string; dur: number };
  /** Wie das Update entstanden ist (Modell, Kosten in US-Dollar, Drehbuch von Claude oder einfache Fassung) */
  meta?: { model: string; costUsd: number; script?: 'claude' | 'einfach' };
}

export interface DayIndex {
  schema: number;
  updated: string;
  days: { date: string; count: number; top: string; episode?: number; dur?: number }[];
}
