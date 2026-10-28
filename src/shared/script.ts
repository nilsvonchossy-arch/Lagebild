// Regeln für das Drehbuch, die Pipeline und App gemeinsam brauchen: Pausen zwischen den Zeilen,
// Untertitel-Blöcke, Bild-Beats (Zahl und Orte genau beim Wort), feste Formeln je Ton.
// Werte aus docs/video-analyse-conflictly.md (Abschnitte 4.3, 6 und 10).
import type { Line, Role, Story, Tone } from './types.ts';

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
  kind: 'figure' | 'place' | 'comparison' | 'deadline' | 'image';
  /** Index in story.places */
  place?: number;
  /** Index in story.images */
  image?: number;
}

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

type CueStory = Pick<Story, 'figure' | 'places' | 'comparison' | 'deadline' | 'images'>;

/**
 * Wo in einer Zeile die Zahl, ein weiterer Ort, ein Vergleichswert, ein Termin oder ein Bildmotiv genannt wird.
 * Der Vergleich erscheint beim Vergleichswert; nur mit `comparisonAtFigure` (der Dialog nennt keinen
 * anderen Wert) auch bei der Hauptzahl.
 */
export function cuesFor(story: CueStory, line: Pick<Line, 'text'>, opts: { comparisonAtFigure?: boolean } = {}): Cue[] {
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
}

export const TONE_TEXT: Record<Tone, ToneText> = {
  lagezentrum: {
    summary: 'Also:',
    closing: [['LEITUNG', 'Das ist die Lage.'], ['LAGE', 'Wir bleiben dran.']],
    markets: 'Und die Märkte?',
    next: ['Was noch?', 'Weiter.', 'Nächster Punkt?'],
    more: 'Was noch?'
  },
  podcast: {
    summary: 'Das Wichtigste:',
    closing: [['LEITUNG', 'Das war es für heute.'], ['LAGE', 'Bis morgen!']],
    markets: 'Und was machen die Märkte?',
    next: ['Okay, was noch?', 'Und dann?', 'Was gibt es noch?'],
    more: 'Und sonst?'
  },
  // Persönlich wie ein Freund: Vorschau in der Begrüßung statt Zusammenfassung am Ende
  assistent: {
    summary: '',
    closing: [['LEITUNG', 'Das war\'s für heute{name}. Ich halt dich auf dem Laufenden.'], ['LAGE', 'Bis morgen!']],
    markets: 'Und an den Börsen?',
    next: ['Was gibt\'s noch?', 'Weiter geht\'s.', 'Und sonst?'],
    more: 'Und sonst so?'
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

export function closingLines(tone: Tone, name?: string): Line[] {
  const n = cleanName(name);
  return TONE_TEXT[tone].closing.map(([role, text]) => ({ role, text: text.replace('{name}', n ? `, ${n}` : ''), kind: 'abschluss' as const }));
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
    { role: 'LEITUNG', text: first, kind: 'begruessung' },
    ...(list ? [{ role: 'LEITUNG' as const, text: `Ich hab dir das Wichtigste rausgesucht: ${list}. Los geht's.`, kind: 'begruessung' as const }] : [])
  ];
}
