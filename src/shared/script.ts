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
  kind: 'figure' | 'place';
  /** Index in story.places */
  place?: number;
}

/** Schreibweisen einer Zahl im Text: 55,7 · 2.000 und 2000 · 28 */
export function numberVariants(value: number, dec: number): string[] {
  const v = Math.abs(value);
  const grouped = v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const plain = v.toFixed(dec).replace('.', ',');
  return [...new Set([grouped, plain])];
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wo in einer Zeile die Zahl der Meldung oder ein weiterer Ort genannt wird. */
export function cuesFor(story: Pick<Story, 'figure' | 'places'>, line: Pick<Line, 'text'>): Cue[] {
  const text = line.text;
  const cues: Cue[] = [];
  const f = story.figure;
  if (f) {
    for (const v of numberVariants(f.value, f.dec)) {
      const m = new RegExp(`(?<![\\d.,])${esc(v)}(?![\\d]|[.,]\\d)`).exec(text);
      if (m) { cues.push({ at: m.index / text.length, kind: 'figure' }); break; }
    }
  }
  story.places?.forEach((p, k) => {
    const name = p.label.trim();
    if (!name) return;
    const m = new RegExp(`(?<![\\p{L}])${esc(name)}`, 'iu').exec(text);
    if (m) cues.push({ at: m.index / text.length, kind: 'place', place: k });
  });
  return cues.sort((a, b) => a.at - b.at);
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
  }
};

/** Zusammenfassung als ein Satz mit höchstens drei Schlagworten aus den wichtigsten Meldungen. */
export function summaryText(shorts: string[], tone: Tone): string {
  const s = shorts.map(x => x.trim().replace(/[.!?]+$/, '')).filter(Boolean).slice(0, 3);
  if (!s.length) return '';
  const list = s.length === 1 ? s[0]! : `${s.slice(0, -1).join(', ')} und ${s[s.length - 1]}`;
  return `${TONE_TEXT[tone].summary} ${list}.`;
}

export function closingLines(tone: Tone): Line[] {
  return TONE_TEXT[tone].closing.map(([role, text]) => ({ role, text, kind: 'abschluss' as const }));
}
