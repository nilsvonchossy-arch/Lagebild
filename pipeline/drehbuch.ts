// Drehbuch: Aus den geprüften Einzelfakten aller Meldungen schreibt Claude die ganze Folge als Dialog
// (LEITUNG fragt, LAGE berichtet, EINORDNUNG ordnet ein). Danach prüft ein zweiter Aufruf jede Zeile:
// Faktzeilen gegen ihre Fakten, LEITUNG-Zeilen darauf, dass sie keine Tatsachen enthalten.
// Geht etwas schief, entsteht eine einfache Fassung direkt aus den geprüften Fakten.
// Regeln: docs/video-analyse-conflictly.md, Abschnitte 10.2 und 10.5.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { TONE_TEXT } from '../src/shared/script.ts';
import type { Format, Line, Role, Tone } from '../src/shared/types.ts';
import type { Claude } from './claude.ts';

export interface ScriptFact { id: string; text: string; kind: string }

export interface ScriptStory {
  /** Buchstabe in der Folge: A, B, C … */
  key: string;
  id: string;
  format: Format;
  seconds: number;
  topic: string;
  label: string;
  /** Weitere Orte in der Schreibweise, in der sie gesagt werden sollen */
  places: string[];
  /** Hauptzahl für den Ton, z. B. „55,7 % (Wahlbeteiligung um 16 Uhr)“ */
  figure: string | null;
  facts: ScriptFact[];
}

const FORMAT_TEXT: Record<Format, string> = { aufmacher: 'Aufmacher', meldung: 'Meldung', kurz: 'Kurz notiert' };
const LINES: Record<Format, string> = { aufmacher: '7–10 Zeilen', meldung: '4–6 Zeilen', kurz: '1–2 Zeilen' };

const TONE_RULES: Record<Tone, string> = {
  lagezentrum: `TON: LAGEZENTRUM
Sachlich und knapp wie ein Briefing im Lagezentrum, aber ohne Militärjargon. LEITUNG fragt in zwei bis fünf Wörtern, ohne Füllwörter: „Ist das viel?“, „Wer tritt an?“, „Wie ernst ist das?“, „Und in Europa?“, „Was noch?“. Höchstens ein gelegentliches „Okay.“ vor einem Themenwechsel, sonst keine Reaktionen.`,
  podcast: `TON: PODCAST
Locker, aber genau. LEITUNG reagiert manchmal kurz („Okay.“, „Verstehe.“) und fragt, wie man im Gespräch nachfragt: „Und was heißt das?“, „Okay, was noch?“, „Moment – wie viele?“, „Und warum?“. Reaktionen bewerten nichts: „Wahnsinn“, „krass“, „zum Glück“ und Ähnliches sind verboten. LAGE darf locker einsteigen („Da geht es um …“).`
};

const EXAMPLE = `BEISPIEL (Ausschnitt mit Fakten einer Demo-Meldung)
Fakten: A1 Israel wählt ein neues Parlament, die Knesset. A2 Bis 16 Uhr Ortszeit lag die Wahlbeteiligung bei 55,7 Prozent. A3 Laut Wahlkomitee ist das der höchste Wert zu dieser Uhrzeit seit Beginn der Messungen 1973. A4 Netanjahus Likud tritt gegen Gadi Eisenkots Partei Yashar an. A5 Die Wahllokale schließen um 22 Uhr.
LAGE: Israel wählt – und bis 16 Uhr haben schon 55,7 Prozent abgestimmt. [A1, A2]
LEITUNG: Ist das viel?
EINORDNUNG: So viele wie noch nie um diese Uhrzeit, sagt das Wahlkomitee. [A3]
LEITUNG: Wer tritt an?
LAGE: Netanjahus Likud gegen Yashar, die Partei von Gadi Eisenkot. [A4]
EINORDNUNG: Die Wahllokale schließen um 22 Uhr. [A5]
(Nicht: „um 22 Uhr Ortszeit“, das steht nicht in A5.)`;

export function drehbuchSystem(tone: Tone): string {
  return `Du schreibst das Drehbuch für eine Folge von „Lagebild“, einem täglichen Nachrichtenüberblick auf Deutsch, den drei Stimmen als Gespräch sprechen. Du bekommst geprüfte Einzelfakten zu mehreren Meldungen in der Reihenfolge, in der sie laufen. Daraus schreibst du den Dialog, Zeile für Zeile.

DIE ROLLEN
- LEITUNG fragt und leitet über: kurze Rückfragen, so wie der Zuhörer selbst fragen würde. LEITUNG sagt nie Fakten.
- LAGE berichtet, was passiert ist: lebhaft, in Hauptsätzen, oft zwei Zeilen hintereinander.
- EINORDNUNG ordnet ein: Zuschreibungen („sagt das Wahlkomitee“), Vorbehalte („noch unklar“), Zusammenhang, Hintergrund. EINORDNUNG kommt in einem Thema nie als Erste und schließt fast jedes Thema.

DIE FAKTENREGEL (wichtiger als alles andere)
- Jede LAGE- und EINORDNUNG-Zeile beruht nur auf den Fakten der Meldung, zu der sie gehört. Nenne in "facts" die IDs der Fakten, auf denen die Zeile beruht.
- Du darfst Fakten kürzen, umstellen, in gesprochene Sprache bringen und auf zwei Zeilen verteilen. Du darfst nichts hinzufügen: keine Ortszeit, keine Ursache, kein „deshalb“ oder „damit“ zwischen Fakten, wenn der Zusammenhang nicht im Fakt steht, kein Allgemeinwissen, keine Wertung („dramatisch“, „überraschend“, „gute Nachricht“).
- Zuschreibungen bleiben erhalten: Was in einem Fakt „laut X“ ist, bleibt „laut X“ oder „sagt X“. Wörtliche Rede nur, wenn der Fakt ein wörtliches Zitat in Anführungszeichen enthält; sonst indirekte Rede („Sandoz sagt, so sei …“).
- Zahlen exakt wie im Fakt. Pro Meldung höchstens eine Zahl im Ton, möglichst die angegebene Hauptzahl; weitere Zahlen stehen auf dem Endbildschirm. Runden nur, wenn es wahr bleibt („Milliarden“ statt „95 Milliarden“). Uhrzeiten, Daten und Jahreszahlen zählen nicht als Zahl.
- Fragen, Reaktionen und Überleitungen von LEITUNG enthalten keine Tatsachen. Sie dürfen Thema oder Ort der nächsten Meldung nennen („Und in Europa?“, „Apropos KI – Apple?“), aber nichts darüber behaupten.
- Stelle nur Fragen, deren Antwort in den Fakten steht. Steht die Antwort auf „Was heißt das für uns?“ nicht in den Fakten, wird die Frage nicht gestellt.

AUFBAU DER FOLGE
- Der erste Satz ist die Kernaussage der ersten Meldung (Aufmacher), gesprochen von LAGE. Keine Begrüßung, kein Datum, keine Ankündigung wie „heute fünf Meldungen“.
- Halte die Reihenfolge der Meldungen genau ein. Jede Meldung außer der ersten beginnt mit einer Frage von LEITUNG, die überleitet; während dieser Frage fliegt die Kamera zum nächsten Ort.
- Überleitungsarten mischen: Vertiefung („Wie ernst ist das?“), geografische Brücke („Und in Europa?“), Stichwort-Brücke („Apropos KI …“), offene Weiterfrage („Okay, was noch?“), Kurz-Weiterfrage („Sonst noch was?“). Die Fragen werden zum Ende hin kürzer. Eine Stichwort-Brücke nur, wenn das Stichwort in den Fakten beider Meldungen vorkommt.
- Jede Meldung folgt einer kleinen Leiter: was passiert → Folge oder Detail → Einordnung mit Zuschreibung oder Vorbehalt. Der Aufmacher bekommt mindestens eine Vertiefungsfrage mitten im Thema.
- Rollenmuster variieren, nicht jedes Thema „LAGE, LAGE, EINORDNUNG“.
- Meldungen im Format „Kurz notiert“ laufen am Ende als Block: eine kurze Frage von LEITUNG davor (z. B. „${TONE_TEXT[tone].more}“), dann je Meldung eine oder zwei Zeilen ohne weitere Fragen.
- Länge: Halte dich an die Wortzahl jeder Meldung (etwa 2,5 Wörter pro Sekunde). Weniger ist besser als aufgebläht: Hat eine Meldung wenig Fakten, wird sie kürzer.
- Keine Zusammenfassung und keine Verabschiedung am Ende, die kommen automatisch.

SPRACHE FÜRS OHR
- Kurze Hauptsätze, aktiv, Präsens wo möglich. „Netanjahus Likud gegen …“ statt „Es tritt die Partei … an“.
- LEITUNG höchstens 6 Wörter pro Zeile. LAGE und EINORDNUNG meist 6–14 Wörter pro Zeile. Längere Sätze auf zwei Zeilen derselben Rolle verteilen; die erste endet dann mit Komma oder Gedankenstrich.
- Keine Abkürzungen, die man nicht sprechen kann. Muss die Aussprache vom Text abweichen („S&P 500“ → „S und P 500“), steht der Sprechtext in "say", sonst null.
- Weitere Orte einer Meldung nennst du genau in der angegebenen Schreibweise, damit auf der Karte ein Pin erscheint.
- Kein Militärjargon, kein Drama, keine Anrede wie „Sir“ oder „liebe Zuhörer“.

${TONE_RULES[tone]}

${EXAMPLE}

AUSGABE
lines: alle Zeilen in Sprechreihenfolge. role: LEITUNG, LAGE oder EINORDNUNG. story: Buchstabe der Meldung, zu der die Zeile gehört; eine Überleitungsfrage gehört zu der Meldung, zu der sie hinführt, die Frage vor „Kurz notiert“ zur ersten Meldung des Blocks. text: der Untertitel. say: abweichender Sprechtext oder null. facts: Fakten-IDs, bei LEITUNG eine leere Liste.`;
}

export function drehbuchPrompt(stories: ScriptStory[]): string {
  const blocks = stories.map(s => {
    const words = Math.round(s.seconds * 2.5);
    return `${s.key} · ${FORMAT_TEXT[s.format]} · etwa ${s.seconds} Sekunden (≈ ${words} Wörter, ${LINES[s.format]})
Thema: ${s.topic} · Ort: ${s.label}${s.places.length ? ` · weitere Orte: ${s.places.join(', ')}` : ''}
Hauptzahl: ${s.figure ?? '(keine)'}
Fakten:
${s.facts.map(f => `${f.id} [${f.kind}] ${f.text}`).join('\n')}`;
  }).join('\n\n');
  return `MELDUNGEN in dieser Reihenfolge\n\n${blocks}`;
}

export const DrehbuchSchema = z.object({
  lines: z.array(z.object({
    role: z.string().describe('LEITUNG, LAGE oder EINORDNUNG'),
    story: z.string().describe('Buchstabe der Meldung'),
    text: z.string(),
    say: z.string().nullable(),
    facts: z.array(z.string())
  }))
});
type RawLine = z.infer<typeof DrehbuchSchema>['lines'][number];

/** Rollen vereinheitlichen; das SDK prüft Auswahlwerte erst nach der Antwort. */
export const normalizeRole = (r: string): Role => (/leit|brief|frag|mod/i.test(r) ? 'LEITUNG' : /einord|anal/i.test(r) ? 'EINORDNUNG' : 'LAGE');

const GREETING = /^(guten (morgen|tag|abend)|willkommen|hallo|hi\b|servus|moin\b)/i;

/** Eine Zeile eines Entwurfs mit Buchstaben statt Meldungs-ID */
export interface DraftLine { role: Role; key: string; text: string; say: string | null; facts: string[] }

/**
 * Antwort aufräumen: Rollen und Buchstaben vereinheitlichen, fremde Fakten-IDs entfernen,
 * Reihenfolge der Meldungen erzwingen, Begrüßungen und Fragen vor dem ersten Fakt streichen.
 */
export function cleanDraft(raw: RawLine[], stories: ScriptStory[]): { lines: DraftLine[]; issues: string[] } {
  const issues: string[] = [];
  const keys = stories.map(s => s.key);
  const factIds = new Map(stories.map(s => [s.key, new Set(s.facts.map(f => f.id))]));
  const out: DraftLine[] = [];
  for (const r of raw) {
    const key = r.story.trim().toUpperCase().slice(0, 1);
    const text = r.text.replace(/^\s*(LEITUNG|LAGE|EINORDNUNG)\s*:\s*/i, '').trim();
    if (!keys.includes(key) || !text) { issues.push(`Zeile ohne gültige Meldung verworfen: ${r.story} ${text}`); continue; }
    if (GREETING.test(text)) { issues.push(`Begrüßung gestrichen: ${text}`); continue; }
    const role = normalizeRole(r.role);
    const facts = role === 'LEITUNG' ? [] : r.facts.map(f => f.trim().toUpperCase()).filter(f => factIds.get(key)!.has(f));
    out.push({ role, key, text, say: r.say?.trim() && r.say.trim() !== text ? r.say.trim() : null, facts });
  }
  // Reihenfolge der Meldungen erzwingen, innerhalb einer Meldung bleibt die Reihenfolge
  const rank = new Map(keys.map((k, i) => [k, i]));
  const sorted = out.map((l, i) => ({ l, i })).sort((a, b) => rank.get(a.l.key)! - rank.get(b.l.key)! || a.i - b.i).map(x => x.l);
  if (sorted.some((l, i) => l !== out[i])) issues.push('Reihenfolge der Meldungen korrigiert');
  return { lines: tidy(sorted), issues };
}

/** Fragen ohne Antwort entfernen und den Anfang auf eine Faktzeile setzen. */
export function tidy(lines: DraftLine[]): DraftLine[] {
  let out = [...lines];
  while (out.length && out[0]!.role === 'LEITUNG') out.shift();
  // LEITUNG braucht eine Antwort derselben Meldung direkt danach
  out = out.filter((l, i) => l.role !== 'LEITUNG' || (out[i + 1] !== undefined && out[i + 1]!.role !== 'LEITUNG' && out[i + 1]!.key === l.key));
  return out;
}

/* ---------- Prüfung ---------- */

export const PRUEF_SYSTEM = `Du prüfst das Drehbuch einer Folge von „Lagebild“ gegen geprüfte Einzelfakten. Die Fakten sind bereits gegen die Quellen geprüft. Du prüfst, ob der Dialog nur sagt, was in den Fakten steht.

Für jede Zeile:
- LAGE und EINORDNUNG (Faktzeilen): Jede Tatsachenbehauptung muss durch die Fakten derselben Meldung gedeckt sein, vor allem durch die genannten Fakten-IDs. Nicht erlaubt: hinzugefügte Details, auch kleine wie „Ortszeit“, Wochentage oder Titel; Ursachen oder Verknüpfungen („deshalb“, „damit“), die nicht im Fakt stehen; Wertungen; fehlende Zuschreibungen („laut X“ ist verloren gegangen); Anführungszeichen um etwas, das kein wörtliches Zitat im Fakt ist; Zahlen, die nicht stimmen. Erlaubt: Kürzen, Umstellen, gesprochene Sprache, Weglassen, Rundungen, die wahr bleiben („Milliarden“ für 95 Milliarden).
- LEITUNG: Die Zeile darf keine Tatsache behaupten oder unterstellen. Erlaubt sind Fragen, kurze neutrale Reaktionen („Okay.“) und das Nennen von Thema oder Ort der nächsten Meldung. Nicht erlaubt: Fragen mit eingebauter Behauptung („Warum ist das Werk so teuer?“), Wertungen („Was für ein Rekord!“), Fragen, deren Antwort nicht in den Fakten steht.
- Keine Begrüßung, kein Datum.

verdict ist ok, korrigieren oder streichen.
- korrigieren: In correction steht die korrigierte Zeile in derselben Rolle, die nur Gedecktes enthält und sich in den Dialog einfügt; bei LEITUNG eine neutrale Frage ohne Tatsachen.
- streichen: wenn sich nichts Gedecktes retten lässt.
Bei korrigieren und streichen nennst du das Problem in problem. Bei ok sind problem und correction null.
Gib für jede Zeile genau einen Eintrag mit ihrer Nummer zurück.`;

export const PruefSchema = z.object({
  items: z.array(z.object({
    nr: z.number().int(),
    verdict: z.string().describe('ok, korrigieren oder streichen'),
    problem: z.string().nullable(),
    correction: z.string().nullable()
  }))
});
export interface LineVerdict { nr: number; verdict: 'ok' | 'korrigieren' | 'streichen'; problem: string | null; correction: string | null }

export const normalizeLineVerdict = (v: string): LineVerdict['verdict'] => (/strei|lösch|entf/i.test(v) ? 'streichen' : /korr|änder|fix/i.test(v) ? 'korrigieren' : /^\s*ok/i.test(v) ? 'ok' : 'streichen');

export function pruefPrompt(stories: ScriptStory[], lines: DraftLine[], only?: Set<number>): string {
  const facts = stories.map(s => `${s.key} (${s.topic}, ${s.label})\n${s.facts.map(f => `${f.id} ${f.text}`).join('\n')}`).join('\n\n');
  const rows = lines.map((l, i) => (only && !only.has(i) ? null : `${i + 1} | ${l.key} | ${l.role} | [${l.facts.join(', ')}] | ${l.text}`)).filter(Boolean).join('\n');
  return `FAKTEN JE MELDUNG\n\n${facts}\n\nDREHBUCH (Nummer | Meldung | Rolle | Fakten | Text)\n${rows}`;
}

/**
 * Prüfergebnis anwenden. Erste Runde: Zeilen ohne Eintrag gelten als ungeprüft und kommen in die zweite.
 * Zweite Runde (`strict` mit den nachgeprüften Zeilen): keine Korrekturen mehr, was nicht ok ist oder
 * ohne Ergebnis bleibt, fliegt raus; alle anderen Zeilen waren schon in der ersten Runde ok.
 */
export function applyLineVerdicts(lines: DraftLine[], items: LineVerdict[], strict?: Set<number>): { lines: DraftLine[]; touched: Set<number>; issues: string[] } {
  const byNr = new Map(items.map(v => [v.nr - 1, v]));
  const issues: string[] = [];
  const touched = new Set<number>();
  const keep: (DraftLine | null)[] = lines.map((l, i) => {
    if (strict && !strict.has(i)) return l;
    const v = byNr.get(i);
    if (!v) {
      if (strict) { issues.push(`Zeile ${i + 1} ohne Prüfergebnis gestrichen: ${l.text}`); return null; }
      touched.add(i);
      return l;
    }
    if (v.verdict === 'ok') return l;
    const fix = v.correction?.trim();
    issues.push(`Zeile ${i + 1} (${l.role}) ${v.verdict}: ${v.problem ?? ''} | ${l.text}${fix && !strict && v.verdict === 'korrigieren' ? ` → ${fix}` : ''}`);
    if (v.verdict === 'korrigieren' && fix && !strict) {
      touched.add(i);
      return { ...l, text: fix, say: null };
    }
    return null;
  });
  // Indizes der berührten Zeilen auf die neue Liste umrechnen
  const map = new Map<number, number>();
  const out: DraftLine[] = [];
  keep.forEach((l, i) => { if (l) { map.set(i, out.length); out.push(l); } });
  const moved = new Set([...touched].filter(i => map.has(i)).map(i => map.get(i)!));
  return { lines: out, touched: moved, issues };
}

/* ---------- Einfache Fassung ---------- */

const EINORDNEND = new Set(['vorbehalt', 'hintergrund', 'reaktion', 'zitat']);

/** Dialog direkt aus den geprüften Fakten, ohne Umformulierung: sicher, aber hölzerner. */
export function simpleLines(stories: ScriptStory[], tone: Tone, only?: Set<string>): DraftLine[] {
  const t = TONE_TEXT[tone];
  const out: DraftLine[] = [];
  let firstKurz = true;
  stories.forEach((s, i) => {
    if (only && !only.has(s.key)) return;
    if (i > 0) {
      if (s.format === 'kurz') {
        if (firstKurz) out.push({ role: 'LEITUNG', key: s.key, text: t.more, say: null, facts: [] });
      } else out.push({ role: 'LEITUNG', key: s.key, text: t.next[i % t.next.length]!, say: null, facts: [] });
    }
    if (s.format === 'kurz') firstKurz = false;
    const n = s.format === 'aufmacher' ? 5 : s.format === 'meldung' ? 3 : 1;
    s.facts.slice(0, n).forEach((f, k) => {
      const role: Role = k === 0 ? 'LAGE' : EINORDNEND.has(f.kind) ? 'EINORDNUNG' : k % 2 ? 'EINORDNUNG' : 'LAGE';
      out.push({ role, key: s.key, text: f.text, say: null, facts: [f.id] });
    });
  });
  return out;
}

/** Fehlende Meldungen (alle Faktzeilen gestrichen) durch die einfache Fassung ersetzen. */
export function fillGaps(lines: DraftLine[], stories: ScriptStory[], tone: Tone): { lines: DraftLine[]; filled: string[] } {
  const has = new Set(lines.filter(l => l.role !== 'LEITUNG').map(l => l.key));
  const missing = stories.filter(s => !has.has(s.key)).map(s => s.key);
  if (!missing.length) return { lines, filled: [] };
  const rank = new Map(stories.map((s, i) => [s.key, i]));
  const extra = simpleLines(stories, tone, new Set(missing));
  // Fehlende Meldungen ohne eigene Überleitung bekommen eine neutrale Frage, außer am Anfang
  const merged = [...lines, ...extra].map((l, i) => ({ l, i })).sort((a, b) => rank.get(a.l.key)! - rank.get(b.l.key)! || a.i - b.i).map(x => x.l);
  return { lines: tidy(merged), filled: missing };
}

/* ---------- Ablauf ---------- */

export interface ScriptResult { lines: Line[]; source: 'claude' | 'einfach'; issues: string[] }

function toLines(draft: DraftLine[], stories: ScriptStory[]): Line[] {
  const ids = new Map(stories.map(s => [s.key, s.id]));
  return draft.map(l => ({
    role: l.role,
    text: l.text,
    ...(l.say ? { say: l.say } : {}),
    story: ids.get(l.key)!,
    kind: l.role === 'LEITUNG' ? 'frage' as const : 'fakt' as const,
    ...(l.role === 'LEITUNG' ? {} : { facts: l.facts })
  }));
}

async function check(claude: Claude, label: string, stories: ScriptStory[], lines: DraftLine[], only?: Set<number>): Promise<LineVerdict[]> {
  const out = await claude.ask(label, PRUEF_SYSTEM, pruefPrompt(stories, lines, only), PruefSchema, 16000);
  return out.items.map(v => ({ ...v, verdict: normalizeLineVerdict(v.verdict) }));
}

export async function writeScript(claude: Claude, stories: ScriptStory[], tone: Tone): Promise<ScriptResult> {
  const issues: string[] = [];
  try {
    const raw = await claude.ask('Drehbuch', drehbuchSystem(tone), drehbuchPrompt(stories), DrehbuchSchema, 20000);
    const cleaned = cleanDraft(raw.lines, stories);
    issues.push(...cleaned.issues);
    let lines = cleaned.lines;
    const first = applyLineVerdicts(lines, await check(claude, 'Drehbuch prüfen', stories, lines));
    issues.push(...first.issues);
    lines = first.lines;
    if (first.touched.size) {
      // Geänderte oder ungeprüfte Zeilen noch einmal prüfen, diesmal ohne Korrekturen
      const second = applyLineVerdicts(lines, await check(claude, 'Drehbuch nachprüfen', stories, lines, first.touched), first.touched);
      issues.push(...second.issues.map(i => `2. Prüfung: ${i}`));
      lines = second.lines;
    }
    lines = tidy(lines);
    const gaps = fillGaps(lines, stories, tone);
    if (gaps.filled.length) issues.push(`Einfache Fassung für ${gaps.filled.join(', ')}`);
    lines = gaps.lines;
    if (!lines.length || lines[0]!.key !== stories[0]!.key) throw new Error('Drehbuch beginnt nicht mit dem Aufmacher');
    return { lines: toLines(lines, stories), source: 'claude', issues };
  } catch (e) {
    // Falscher Schlüssel oder fehlendes Guthaben: nicht verstecken
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw e;
    issues.push(`Drehbuch fehlgeschlagen, einfache Fassung: ${(e as Error).message}`);
    return { lines: toLines(simpleLines(stories, tone), stories), source: 'einfach', issues };
  }
}
