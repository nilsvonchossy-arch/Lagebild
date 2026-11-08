// Datenformat eines Tages-Updates (data/JJJJ-MM-TT.json). Die Pipeline schreibt es, die App liest es.
// Bei inkompatiblen Änderungen SCHEMA_VERSION erhöhen und CLAUDE.md anpassen.
//
// Version 2: Eine Folge ist ein durchgehendes Drehbuch (script) mit drei Rollen. Fakten jeder Meldung
// liegen einzeln und geprüft vor; jede Faktzeile im Drehbuch nennt die Fakten, auf denen sie beruht.
// Version 3 (nur zusätzliche Felder): Format „fokus“, Hintergrund-Teil, mehrere Quellen, Art und Quelle
// je Fakt, Zeitleiste, Akteure und Ursache-Wirkung-Kette. Tage mit Version 2 laufen unverändert weiter.

export const SCHEMA_VERSION = 3;
/** Versionen, die die App abspielt (Version 3 ergänzt Version 2 nur um Felder) */
export const SUPPORTED_SCHEMAS: readonly number[] = [2, 3];

/** LEITUNG fragt und leitet über, LAGE berichtet, EINORDNUNG ordnet ein (Zuschreibungen, Vorbehalte). */
export type Role = 'LEITUNG' | 'LAGE' | 'EINORDNUNG';

/** Aufmacher 30–45 s, Im Fokus 60–90 s (große Enthüllung, höchstens eins pro Folge), Meldung 15–25 s, Kurz notiert 5–10 s */
export type Format = 'aufmacher' | 'fokus' | 'meldung' | 'kurz';

/** Arten von Fakten; „hintergrund“ = Vorgeschichte, Akteure, Gründe */
export const FACT_KINDS = ['kern', 'problem', 'ausblick', 'detail', 'zahl', 'zitat', 'vorbehalt', 'hintergrund', 'reaktion'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Lagezentrum: knapp; Podcast: locker; Assistent: persönlich wie ein Freund, mit Begrüßung */
export type Tone = 'lagezentrum' | 'podcast' | 'assistent';

/** Wo eine Zeile in der Audiodatei der Folge liegt. */
export interface LineAudio {
  /** Beginn in Sekunden ab Anfang der Folge */
  at: number;
  /** Länge in Sekunden */
  dur: number;
  /** Wortenden als [Sekunde ab Zeilenbeginn, Anteil am Sprechtext 0..1] für Untertitel und Bild-Beats */
  words?: [number, number][];
}

/** Art einer Zeile: Begrüßung (nur Ton „Assistent“), Frage/Überleitung, Fakt, Zusammenfassung, feste Abschlussformel */
export type LineKind = 'begruessung' | 'frage' | 'fakt' | 'zusammenfassung' | 'abschluss';

/** Stimmung, mit der eine Zeile gesprochen wird (steuert die Stimme, nicht den Inhalt) */
export const MOODS = ['neutral', 'neugierig', 'ueberrascht', 'warm', 'ernst', 'nachdenklich', 'heiter'] as const;
export type Mood = (typeof MOODS)[number];

export interface Line {
  role: Role;
  /** Untertitel */
  text: string;
  /** Abweichender Sprechtext, z. B. "S und P 500" statt "S&P 500" */
  say?: string;
  /** ID der Meldung, zu der die Zeile gehört; "maerkte" für die Marktdaten; fehlt bei Begrüßung, Zusammenfassung und Abschluss */
  story?: string;
  kind: LineKind;
  /** IDs der geprüften Fakten, auf denen die Zeile beruht (nur Faktzeilen und Zusammenfassung) */
  facts?: string[];
  /** Stimmung beim Sprechen; fehlt = neutral */
  mood?: Mood;
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
  /** Art des Fakts (ab Schema 3) */
  kind?: FactKind;
  /** Index der Quelle in story.sources (ab Schema 3; 0 = Hauptquelle) */
  source?: number;
}

/** Eintrag der Zeitleiste „Vorgeschichte“. Die Zeitangabe steht wörtlich in einem der Fakten. */
export interface TimelineEntry {
  /** Zeitangabe wie im Fakt („2019“, „März 2024“, „7. Oktober 2023“) oder „heute“ für das aktuelle Ereignis */
  date: string;
  /** Was damals geschah, kurz */
  label: string;
  facts: string[];
}

/** Beteiligter mit seiner Position („Wer steht wo“); der Name steht wörtlich in einem der Fakten. */
export interface Actor {
  name: string;
  /** Wer das ist, z. B. „Betreiber des Werks“ */
  role: string;
  /** Was er will oder sagt, mit Zuschreibung wie im Fakt; keine Einordnung in Lager */
  position: string;
  facts: string[];
}

/** Schritt einer Ursache-Wirkung-Kette; nur, wenn die Fakten den Zusammenhang ausdrücklich nennen. */
export interface ChainStep {
  label: string;
  facts: string[];
}

/** Weiterer Ort einer Meldung; bekommt einen eigenen Pin, sobald er genannt wird */
export interface Place {
  label: string;
  lon: number;
  lat: number;
  /** Von hier aus eine Linie zum Hauptort zeichnen (z. B. Flugroute), nur wenn die Quelle eine Bewegung beschreibt */
  route?: boolean;
}

/** Symbole für Meldungen ohne eigenes Bild (eigene Zeichnungen, src/icons.ts) */
export const SYMBOLS = [
  'wahl', 'parlament', 'regierung', 'diplomatie', 'gericht', 'sicherheit', 'geld', 'boerse', 'handel', 'fabrik',
  'arbeit', 'energie', 'klima', 'medizin', 'forschung', 'ki', 'chip', 'cyber', 'raumfahrt', 'verkehr', 'bildung'
] as const;
export type SymbolId = (typeof SYMBOLS)[number];

/** Vergleich von 2–4 Werten derselben Art; jeder Wert steht wörtlich in einem der genannten Fakten. */
export interface Comparison {
  /** Was verglichen wird, z. B. „Wahlbeteiligung“ */
  label: string;
  /** Einheit mit Leerzeichen davor, z. B. " %" */
  unit: string;
  dec: number;
  /** Beschriftung so, wie sie im Fakt steht („2022“, „16 Uhr“), „jetzt“ für den aktuellen Wert */
  items: { label: string; value: number }[];
  facts: string[];
}

/** Uhrzeit oder Datum aus einem Fakt, z. B. Schließung der Wahllokale */
export interface Deadline {
  /** HH:MM */
  time?: string;
  /** JJJJ-MM-TT */
  date?: string;
  label: string;
  facts: string[];
}

/** Archivbild aus Wikimedia Commons (über Wikidata); zeigt Person, Ort oder Gebäude, nicht das Ereignis selbst. */
export interface ArchiveImage {
  /** Pfad relativ zum Datenordner */
  src: string;
  w: number;
  h: number;
  /** Bezeichnung aus Wikidata, z. B. „Gadi Eisenkot“ */
  motif: string;
  /** Wort im Dialog, bei dem das Bild erscheint */
  match: string;
  author: string;
  /** z. B. „CC BY-SA 4.0“ oder „Public domain“ */
  license: string;
  licenseUrl?: string;
  /** Dateiseite auf Wikimedia Commons */
  page: string;
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
  /** Hauptquelle (= sources[0], falls sources da ist) */
  source: Source;
  /** Alle Quellen der Meldung, Hauptquelle zuerst (ab Schema 3) */
  sources?: Source[];
  /** Beruht auf einer eigenen Recherche eines Mediums (Enthüllung); redaktionelle Einschätzung, ab Schema 3 */
  investigative?: boolean;
  /** Schlagwort für die Zusammenfassung am Ende */
  short: string;
  facts: Fact[];
  /** Teil „Hintergrund“ bei Aufmacher und Fokus: IDs der Fakten mit Art „hintergrund“ (ab Schema 3) */
  background?: { facts: string[] };
  /** Einblendungen: Symbol, Vergleich, Termin und Archivbilder erscheinen beim passenden Wort */
  symbol?: SymbolId;
  comparison?: Comparison;
  deadline?: Deadline;
  images?: ArchiveImage[];
  /** Erklär-Einblendungen aus geprüften Fakten (ab Schema 3): Vorgeschichte, Wer steht wo, Ursache und Wirkung */
  timeline?: TimelineEntry[];
  actors?: Actor[];
  chain?: ChainStep[];
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
  /** Schlusskurse der letzten Handelstage, ältester zuerst (Kursverlauf) */
  series?: number[];
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
  /** Wie das Update entstanden ist (Modell, Modell je Schritt, Kosten in US-Dollar, Drehbuch von Claude oder einfache Fassung) */
  meta?: { model: string; models?: Record<string, string>; costUsd: number; script?: 'claude' | 'einfach' };
}

/** Kann die App diesen Tag abspielen? Version 2 und 3 (3 ergänzt nur Felder). */
export const isPlayable = (b: { schema?: unknown; script?: unknown } | null | undefined): boolean =>
  Boolean(b && typeof b.schema === 'number' && SUPPORTED_SCHEMAS.includes(b.schema) && Array.isArray(b.script));

export interface DayIndex {
  schema: number;
  updated: string;
  days: { date: string; count: number; top: string; episode?: number; dur?: number }[];
}
