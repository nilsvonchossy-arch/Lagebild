// Regeln für das Drehbuch, die Pipeline und App gemeinsam brauchen: Pausen zwischen den Zeilen,
// Untertitel-Blöcke, Bild-Beats (Zahl und Orte genau beim Wort), feste Formeln je Ton.
// Werte aus docs/video-analyse-conflictly.md (Abschnitte 4.3, 6 und 10).
import { MOODS, type Line, type Mood, type Role, type Story, type Tone } from './types.ts';

/* ---------- Pausen ---------- */

/** Vorlauf vor der ersten Zeile (Glitch und Titelgrafik), in Sekunden */
export const LEAD_IN = 0.8;
/** Nachlauf nach der letzten Zeile, Musikbett blendet aus */
export const TAIL = 1.8;

const endsSentence = (s: string): boolean => /[.!?…:]["“”»«)]*$/.test(s.trim());

/**
 * Pause vor einer Zeile in Sekunden: Antwort auf eine Frage schnell (0,3), Sprecherwechsel 0,5,
 * dieselbe Stimme im laufenden Satz fast ohne Pause, Themenwechsel 0,9, vor der Zusammenfassung 1,0.
 */
export function pauseBefore(prev: Line | undefined, cur: Line): number {
  if (!prev) return 0;
  if (cur.kind === 'zusammenfassung' && prev.kind !== 'zusammenfassung') return 1.0;
  if (cur.kind === 'abschluss') return prev.kind === 'abschluss' ? 0.35 : 0.6;
  if (cur.story !== prev.story) return 0.9;
  if (prev.role === 'LEITUNG' && cur.role !== 'LEITUNG' && /\?\s*$/.test(prev.text)) return 0.3;
  if (prev.role !== cur.role) return 0.5;
  return endsSentence(prev.text) ? 0.35 : 0.12;
}

/** Geschätzte Sprechdauer in Sekunden (deutsche Azure-Stimmen sprechen etwa 14–15 Zeichen pro Sekunde). */
export const estimateSec = (text: string): number => Math.max(0.6, text.trim().length / 14.5 + 0.15);

/** Geschätzte Länge der ganzen Folge in Sekunden (ohne Audiodatei). */
export function estimateScript(lines: Line[]): number {
  let t = LEAD_IN;
  lines.forEach((l, i) => { t += pauseBefore(lines[i - 1], l) + (l.audio?.dur ?? estimateSec(l.say ?? l.text)); });
  return t + TAIL;
}

/* ---------- Untertitel ---------- */

export interface Block { text: string; /** Anteil am Text, ab dem der Block gilt */ from: number; to: number }

const STRONG = /[.!?;:…]["“”»«)]*$/;
const WEAK = /[,–—]$/;
const BEFORE = /^(und|aber|oder|doch|denn|weil|dass|damit|wenn|als|während|nachdem|bevor|sondern|sowie|die|der|das|den|dem|deren|dessen|wo|wie|um|mit|nach|seit|bis|für)$/i;

/**
 * Text in Untertitel-Blöcke mit 6–10 Wörtern teilen, bevorzugt an Satzzeichen (Atempausen),
 * sonst vor Bindewörtern. Kurze Zeilen bleiben ein Block. Ein Gedankenstrich hängt am Wort davor.
 */
export function subtitleBlocks(text: string, min = 6, max = 10): Block[] {
  const t = text.trim();
  const words: { w: string; start: number; end: number }[] = [];
  for (const m of t.matchAll(/\S+/g)) {
    const w = { w: m[0], start: m.index, end: m.index + m[0].length };
    const last = words[words.length - 1];
    if (last && /^[–—-]$/.test(w.w)) { last.w += ` ${w.w}`; last.end = w.end; continue; }
    words.push(w);
  }
  const n = words.length;
  if (!n) return [];
  const cuts: number[] = [];
  let i = 0;
  while (n - i > max) {
    const rest = n - i;
    // Rest passt in zwei Blöcke: möglichst gleichmäßig teilen
    let lo = i + min, hi = i + max;
    if (rest <= max * 2) { lo = Math.max(lo, n - max); hi = Math.min(hi, n - Math.min(min, Math.ceil(rest / 2))); }
    if (hi < lo) hi = lo;
    let best = -1, bestScore = -Infinity;
    for (let j = lo; j <= hi && j < n; j++) {
      const prev = words[j - 1]!.w, next = words[j]!.w;
      let s = STRONG.test(prev) ? 3 : WEAK.test(prev) ? 2 : BEFORE.test(next) ? 1 : 0;
      s -= Math.abs(j - i - (min + max) / 2) * 0.05;
      if (s > bestScore) { bestScore = s; best = j; }
    }
    cuts.push(best);
    i = best;
  }
  const len = t.length;
  const bounds = [0, ...cuts, n];
  const out: Block[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = words[bounds[k]!]!, b = words[bounds[k + 1]! - 1]!;
    out.push({ text: t.slice(a.start, b.end), from: k === 0 ? 0 : a.start / len, to: k === bounds.length - 2 ? 1 : words[bounds[k + 1]!]!.start / len });
  }
  return out;
}

/* ---------- Bild-Beats ---------- */

export interface Cue {
  /** Anteil am Text, an dem das Wort beginnt */
  at: number;
  kind: 'figure' | 'place' | 'comparison' | 'deadline' | 'image' | 'timeline' | 'actors' | 'chain';
  /** Index in story.places */
  place?: number;
  /** Index in story.images */
  image?: number;
  /** Index des Eintrags in story.timeline, story.actors oder story.chain (hebt ihn hervor) */
  index?: number;
}

/** Einblendungen, die eine Meldung als „hat eine Grafik“ zählen (sonst zeigt sie ihr Symbol) */
export const VISUAL_CUES: ReadonlySet<Cue['kind']> = new Set(['comparison', 'deadline', 'image', 'timeline', 'actors', 'chain']);

/** Schreibweisen einer Zahl im Text: 55,7 · 2.000 und 2000 · 28 */
export function numberVariants(value: number, dec: number): string[] {
  const v = Math.abs(value);
  const grouped = v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const plain = v.toFixed(dec).replace('.', ',');
  return [...new Set([grouped, plain])];
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Position einer Zahl im Text (nicht als Teil einer längeren Zahl), sonst -1. */
export function findNumber(text: string, value: number, dec: number): number {
  for (const v of numberVariants(value, dec)) {
    const m = new RegExp(`(?<![\\d.,])${esc(v)}(?![\\d]|[.,]\\d)`).exec(text);
    if (m) return m.index;
  }
  return -1;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Muster für Uhrzeit (HH:MM) oder Datum (JJJJ-MM-TT), wie sie in einem deutschen Satz stehen. */
export function deadlinePattern(d: { time?: string; date?: string }): RegExp | null {
  const alts: string[] = [];
  const t = d.time && /^(\d{1,2}):(\d{2})$/.exec(d.time);
  if (t) {
    const h = String(Number(t[1]));
    alts.push(t[2] === '00' ? `${h}(?:[:.]00)?\\s*Uhr|${h}:00` : `${h}[:.]${t[2]}`);
  }
  const dt = d.date && /^\d{4}-(\d{2})-(\d{2})$/.exec(d.date);
  if (dt) {
    const day = Number(dt[2]), month = Number(dt[1]);
    alts.push(`${day}\\.\\s*${MONTHS[month - 1]}`, `0?${day}\\.0?${month}\\.`);
  }
  return alts.length ? new RegExp(`(?<![\\d])(?:${alts.join('|')})`, 'i') : null;
}

/** Zeitangaben für das aktuelle Ereignis in der Zeitleiste („heute“); sie lösen keine Einblendung aus. */
export const NOW_DATE = /^(heute|jetzt|aktuell|derzeit|zuletzt)$/i;

/** Muster für die Zeitangabe eines Zeitleisten-Eintrags: wörtlich, sonst die Jahreszahl darin; „heute“ hat keins. */
export function timelinePattern(date: string): RegExp | null {
  const d = date.trim();
  if (!d || NOW_DATE.test(d)) return null;
  const alts = [esc(d).replace(/\s+/g, '\\s+')];
  const y = /(?<!\d)(1\d{3}|20\d{2})(?!\d)/.exec(d);
  if (y && y[1] !== d) alts.push(y[1]!);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?!\\p{N})`, 'iu');
}

/** Muster für den Namen eines Akteurs: ganz, bei mehreren Wörtern auch das letzte („Eisenkot“ für „Gadi Eisenkot“). */
export function actorPattern(name: string): RegExp | null {
  const n = name.trim();
  if (!n) return null;
  const parts = n.split(/\s+/);
  const last = parts[parts.length - 1]!;
  const alts = [esc(n).replace(/\s+/g, '\\s+')];
  if (parts.length > 1 && last.length >= 4) alts.push(esc(last));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})`, 'iu');
}

const shares = (a: string[] | undefined, b: string[] | undefined): boolean => Boolean(a?.length && b?.some(x => a.includes(x)));

type CueStory = Pick<Story, 'figure' | 'places' | 'comparison' | 'deadline' | 'images' | 'timeline' | 'actors' | 'chain'>;

/**
 * Wo in einer Zeile die Zahl, ein weiterer Ort, ein Vergleichswert, ein Termin oder ein Bildmotiv genannt wird.
 * Der Vergleich erscheint beim Vergleichswert; nur mit `comparisonAtFigure` (der Dialog nennt keinen
 * anderen Wert) auch bei der Hauptzahl.
 * Zeitleiste und Akteure erscheinen bei Zeitangabe oder Namen; nennt die Zeile ihn nicht, aber stützt sich
 * auf einen ihrer Fakten, am Zeilenanfang. Die Ursache-Wirkung-Kette erscheint mit der Ursache (erster Schritt).
 */
export function cuesFor(story: CueStory, line: Pick<Line, 'text'> & { facts?: string[] }, opts: { comparisonAtFigure?: boolean } = {}): Cue[] {
  const text = line.text;
  const cues: Cue[] = [];
  const at = (i: number): number => i / text.length;
  const f = story.figure;
  if (f) {
    const i = findNumber(text, f.value, f.dec);
    if (i >= 0) cues.push({ at: at(i), kind: 'figure' });
  }
  story.places?.forEach((p, k) => {
    const name = p.label.trim();
    if (!name) return;
    const m = new RegExp(`(?<![\\p{L}])${esc(name)}`, 'iu').exec(text);
    if (m) cues.push({ at: at(m.index), kind: 'place', place: k });
  });
  const c = story.comparison;
  if (c) {
    // Am liebsten beim Vergleichswert, nicht bei der Zahl, die ohnehin am Pin hochzählt
    const hits = c.items.map(it => ({ i: findNumber(text, it.value, c.dec), same: Boolean(f && Math.abs(f.value - it.value) < 1e-9) })).filter(h => h.i >= 0);
    const hit = hits.find(h => !h.same) ?? (opts.comparisonAtFigure ? hits[0] : undefined);
    if (hit) cues.push({ at: at(hit.i), kind: 'comparison' });
  }
  const d = story.deadline && deadlinePattern(story.deadline);
  if (d) {
    const m = d.exec(text);
    if (m) cues.push({ at: at(m.index), kind: 'deadline' });
  }
  story.images?.forEach((img, k) => {
    const name = img.match.trim();
    if (!name) return;
    const m = new RegExp(`(?<![\\p{L}])${esc(name)}`, 'iu').exec(text);
    if (m) cues.push({ at: at(m.index), kind: 'image', image: k });
  });
  story.timeline?.forEach((e, k) => {
    const re = timelinePattern(e.date);
    if (!re) return;
    const m = re.exec(text);
    if (m) cues.push({ at: at(m.index), kind: 'timeline', index: k });
    else if (shares(e.facts, line.facts)) cues.push({ at: 0, kind: 'timeline', index: k });
  });
  story.actors?.forEach((a, k) => {
    const m = actorPattern(a.name)?.exec(text);
    if (m) cues.push({ at: at(m.index), kind: 'actors', index: k });
    else if (shares(a.facts, line.facts)) cues.push({ at: 0, kind: 'actors', index: k });
  });
  // Die Kette erscheint, wenn die Ursache (erster Schritt) erzählt wird, und läuft dann selbst bis zur Wirkung durch
  const cause = story.chain?.[0];
  if (cause && story.chain!.length >= 2) {
    const i = text.toLowerCase().indexOf(cause.label.toLowerCase());
    if (i >= 0) cues.push({ at: at(i), kind: 'chain' });
    else if (shares(cause.facts, line.facts)) cues.push({ at: 0, kind: 'chain' });
  }
  return cues.sort((a, b) => a.at - b.at);
}

/** Nennt der Dialog einer Meldung einen Vergleichswert außer der Hauptzahl? Sonst erscheint der Vergleich bei der Hauptzahl. */
export function comparisonAtFigure(story: CueStory, lines: Pick<Line, 'text'>[]): boolean {
  return Boolean(story.comparison) && !lines.some(l => cuesFor(story, l).some(c => c.kind === 'comparison'));
}

/** Sekunde ab Zeilenbeginn, zu der das Wort an Textanteil `frac` beginnt (aus den Wortenden der Stimme). */
export function fracToSec(words: [number, number][] | undefined, frac: number, dur: number): number {
  if (!words?.length) return frac * dur;
  let prevEnd = 0;
  for (const [end, f] of words) {
    if (f > frac + 1e-6) return prevEnd;
    prevEnd = end;
  }
  return prevEnd;
}

/** Textanteil, der zur Sekunde `t` ab Zeilenbeginn gesprochen ist. */
export function secToFrac(words: [number, number][] | undefined, t: number, dur: number): number {
  if (!words?.length) return dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 1;
  let prev: [number, number] = [0, 0];
  for (const w of words) {
    if (w[0] >= t) {
      // innerhalb des Wortes linear weiterrechnen
      const span = w[0] - prev[0];
      return span > 0 ? prev[1] + ((t - prev[0]) / span) * (w[1] - prev[1]) : w[1];
    }
    prev = w;
  }
  return 1;
}

/* ---------- Ton ---------- */

export interface ToneText {
  /** Einleitung der Zusammenfassung */
  summary: string;
  /** Feste Abschlussformel, in jeder Folge gleich */
  closing: [Role, string][];
  /** Frage vor den Marktdaten */
  markets: string;
  /** Neutrale Überleitungen ohne Fakten für die einfache Fassung */
  next: string[];
  /** Vor dem Block „Kurz notiert“ */
  more: string;
  /** Frage vor dem Hintergrund-Teil (einfache Fassung) */
  background: string;
}

export const TONE_TEXT: Record<Tone, ToneText> = {
  lagezentrum: {
    summary: 'Also:',
    closing: [['LEITUNG', 'Das ist die Lage.'], ['LAGE', 'Wir bleiben dran.']],
    markets: 'Und die Märkte?',
    next: ['Was noch?', 'Weiter.', 'Nächster Punkt?'],
    more: 'Was noch?',
    background: 'Wie kam es dazu?'
  },
  podcast: {
    summary: 'Das Wichtigste:',
    closing: [['LEITUNG', 'Das war es für heute.'], ['LAGE', 'Bis morgen!']],
    markets: 'Und was machen die Märkte?',
    next: ['Okay, was noch?', 'Und dann?', 'Was gibt es noch?'],
    more: 'Und sonst?',
    background: 'Und wie kam es dazu?'
  },
  // Persönlich wie ein Freund: Vorschau in der Begrüßung statt Zusammenfassung am Ende
  assistent: {
    summary: '',
    closing: [['LEITUNG', 'Das war\'s für heute{name}. Ich halt dich auf dem Laufenden.'], ['LAGE', 'Bis morgen!']],
    markets: 'Und an den Börsen?',
    next: ['Was gibt\'s noch?', 'Weiter geht\'s.', 'Und sonst?'],
    more: 'Und sonst so?',
    background: 'Und wie kam es dazu?'
  }
};

/** Schlagworte zu „A, B und C“ */
const listOf = (shorts: string[]): string => {
  const s = shorts.map(x => x.trim().replace(/[.!?]+$/, '')).filter(Boolean).slice(0, 3);
  return s.length <= 1 ? (s[0] ?? '') : `${s.slice(0, -1).join(', ')} und ${s[s.length - 1]}`;
};

/** Zusammenfassung als ein Satz mit höchstens drei Schlagworten aus den wichtigsten Meldungen (nicht im Ton „Assistent“). */
export function summaryText(shorts: string[], tone: Tone): string {
  const list = listOf(shorts);
  if (!list || !TONE_TEXT[tone].summary) return '';
  return `${TONE_TEXT[tone].summary} ${list}.`;
}

/** Name für die Anrede: nur Buchstaben, höchstens 30 Zeichen, sonst keiner */
export const cleanName = (name: string | undefined): string => {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  return n && n.length <= 30 && /^[\p{L}' .-]+$/u.test(n) ? n : '';
};

/** Stimmung aus dem Drehbuch auf die feste Liste bringen (das SDK reicht Auswahlwerte nur als Beschreibung weiter). */
export function normalizeMood(raw: string | null | undefined): Mood {
  const k = (raw ?? '').toLowerCase().trim().replace(/ü/g, 'ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe');
  return (MOODS as readonly string[]).includes(k) ? (k as Mood) : 'neutral';
}

export function closingLines(tone: Tone, name?: string): Line[] {
  const n = cleanName(name);
  return TONE_TEXT[tone].closing.map(([role, text]) => ({ role, text: text.replace('{name}', n ? `, ${n}` : ''), kind: 'abschluss' as const, mood: 'warm' as const }));
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/**
 * Begrüßung im Ton „Assistent“: Gruß mit Name und Datum, dann eine Vorschau aus den geprüften
 * Schlagworten. Enthält keine Nachricht, die nicht in den Meldungen steht; andere Töne beginnen ohne Gruß.
 */
export function introLines(tone: Tone, date: string, shorts: string[], name?: string): Line[] {
  if (tone !== 'assistent') return [];
  const n = cleanName(name);
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay();
  const when = `${WEEKDAYS[wd]}, der ${d.getUTCDate()}. ${MONTH_NAMES[d.getUTCMonth()]}`;
  const hi = `Guten Morgen${n ? `, ${n}` : ''}`;
  const and = n ? ', und' : ' und';
  const first = wd === 1 ? `${hi}${and} einen guten Start in die Woche! Heute ist ${when}.`
    : wd === 6 || wd === 0 ? `${hi}${and} ein schönes Wochenende! Heute ist ${when}.`
      : `${hi}! Heute ist ${when}.`;
  const list = listOf(shorts);
  return [
    { role: 'LEITUNG', text: first, kind: 'begruessung', mood: 'warm' },
    ...(list ? [{ role: 'LEITUNG' as const, text: `Ich hab dir das Wichtigste rausgesucht: ${list}. Los geht's.`, kind: 'begruessung' as const, mood: 'heiter' as const }] : [])
  ];
}
