// Die redaktionellen Schritte mit Claude: Auswahl, Schreiben, Faktencheck.
// Grundregel aus CLAUDE.md: Meldungen enthalten nur Fakten aus der verlinkten Quelle.
import { z } from 'zod';
import type { ThemenConfig } from '../src/shared/config.ts';
import type { Claude } from './claude.ts';
import type { Article } from './extract.ts';
import type { Candidate } from './sources.ts';

const PRIO: Record<number, string> = { 3: 'hoch', 2: 'mittel', 1: 'niedrig' };

/* ---------- 1. Auswahl ---------- */

export const SELECT_SYSTEM = `Du bist die Chefredaktion von „Lagebild“, einem persönlichen täglichen Nachrichtenüberblick für einen Leser in Deutschland. Das Update dauert 2–3 Minuten, wird gesprochen und hat Untertitel.

Deine Aufgabe: Aus einer Liste von Artikeln der letzten 24 Stunden wählst du die wichtigsten Meldungen des Tages aus und bewertest ihre Relevanz.

So wählst du aus:
- Eine Meldung ist ein Ereignis oder eine neue Entwicklung, kein einzelner Artikel. Fasse Artikel zum selben Ereignis zu einer Meldung zusammen und nenne alle zugehörigen Artikel-IDs.
- Bevorzuge harte Nachrichten mit neuen, überprüfbaren Fakten: Entscheidungen, Ereignisse, Zahlen, offizielle Ankündigungen. Nicht geeignet sind Kommentare, Meinungsbeiträge, Ratgeber, Liveticker-Übersichten ohne neue Fakten, Werbung und Clickbait.
- Halte dich an die Themen und Prioritäten des Lesers. Bei vergleichbarer Bedeutung gehen Themen mit Priorität „hoch“ vor. Ein Thema mit „mindestens eine Meldung pro Tag“ bekommt eine, wenn es dazu eine echte Nachricht gibt.
- Höchstens zwei Meldungen pro Thema. Achte auf Abwechslung zwischen den Kategorien.
- Was gestern schon im Lagebild war, nimmst du nur bei einer wesentlichen neuen Entwicklung.
- Sortiere nach Bedeutung, die wichtigste zuerst.
- Ordne die Artikel-IDs jeder Meldung nach ihrer Eignung als Quelle: ausführliche, frei lesbare Berichte zuerst (Nachrichtenagenturen, öffentlich-rechtliche Sender, Qualitätsmedien), Artikel hinter Bezahlschranken ans Ende.

Relevanz (1–5) ist eine redaktionelle Einschätzung, wie wichtig die Meldung für einen allgemein informierten Leser mit diesen Interessen ist:
5 = große Tragweite: betrifft sehr viele Menschen oder Staaten, Krieg und Frieden, historische Weichenstellung
4 = wichtige Entwicklung, breit berichtet, mit klaren Folgen
3 = relevante Neuigkeit in einem Thema des Lesers
2 = interessant, aber mit begrenzter Tragweite
1 = Randnotiz
Begründe die Relevanz in "reason" mit einem kurzen Satz (höchstens 15 Wörter), sachlich und ohne Wertung der Beteiligten.`;

export const SelectSchema = z.object({
  stories: z.array(z.object({
    topic: z.string().describe('Themen-ID aus der Themenliste'),
    articles: z.array(z.number().int()).describe('Artikel-IDs zu dieser Meldung, beste Quelle zuerst'),
    relevance: z.number().int().describe('Relevanz von 1 bis 5'),
    reason: z.string().describe('Begründung der Relevanz, höchstens 15 Wörter'),
    working_title: z.string().describe('Sachlicher Arbeitstitel auf Deutsch')
  }))
});
export type Selection = z.infer<typeof SelectSchema>['stories'][number];

function fmtTime(iso: string | null): string {
  if (!iso) return '?';
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function selectPrompt(cfg: ThemenConfig, cands: Candidate[], opts: { dateLabel: string; yesterday: string[]; want: number }): string {
  const cat = new Map(cfg.categories.map(c => [c.id, c.name]));
  const topics = cfg.topics.filter(t => t.active).map(t =>
    `- ${t.id} | ${t.name} | Kategorie: ${cat.get(t.category) ?? t.category} | Priorität: ${PRIO[t.priority]}${t.minPerDay ? ' | mindestens eine Meldung pro Tag' : ''}${t.description ? ` | ${t.description}` : ''}`
  ).join('\n');
  const arts = cands.map(c => `[${c.id}] ${c.source} | ${fmtTime(c.published)} | ${c.topics.join(',')} | ${c.title}${c.teaser ? ` — ${c.teaser}` : ''}`).join('\n');
  return `Datum: ${opts.dateLabel}

Gib ${opts.want + 3} Meldungen zurück: die ${opts.want} besten und drei Reserven, falls eine Quelle nicht abrufbar ist. Gibt es weniger gute Meldungen, gib weniger zurück.

THEMEN DES LESERS (ID | Name | Kategorie | Priorität | worum es geht)
${topics}

GESTERN IM LAGEBILD
${opts.yesterday.length ? opts.yesterday.map(h => `- ${h}`).join('\n') : '- (nichts)'}

ARTIKEL (ID | Quelle | Zeit | gefunden über Thema | Titel — Teaser)
${arts}`;
}

export async function selectStories(claude: Claude, cfg: ThemenConfig, cands: Candidate[], opts: { dateLabel: string; yesterday: string[]; want: number }): Promise<Selection[]> {
  const out = await claude.ask('Auswahl', SELECT_SYSTEM, selectPrompt(cfg, cands, opts), SelectSchema);
  const ids = new Set(cands.map(c => c.id));
  const topicIds = new Set(cfg.topics.map(t => t.id));
  return out.stories
    .map(s => ({ ...s, articles: s.articles.filter(a => ids.has(a)), relevance: Math.max(1, Math.min(5, Math.round(s.relevance))) }))
    .filter(s => s.articles.length && topicIds.has(s.topic));
}

/* ---------- 2. Schreiben ---------- */

export const WRITE_SYSTEM = `Du schreibst eine Meldung für „Lagebild“, einen gesprochenen täglichen Nachrichtenüberblick auf Deutsch. Jede Meldung hat eine Karte (Headline, „Kurz gesagt“, eine Zahl) und 3–4 gesprochene Zeilen mit Untertiteln. Zwei Rollen sprechen: LAGE sagt, was passiert ist; EINORDNUNG liefert Hintergrund und Zusammenhang. Davor leitet BRIEFING mit wenigen Worten über.

Die wichtigste Regel: Du verwendest ausschließlich Informationen aus dem QUELLTEXT.
- Jede Aussage, jede Zahl, jeder Name, jede Funktion und jedes Datum muss im Quelltext stehen. Ergänze nichts aus deinem Allgemeinwissen, auch wenn es stimmt: keine Amtszeiten, Vorgeschichte, Titel oder Zahlen, die nicht im Text stehen.
- Keine eigene Bewertung, Deutung, Prognose oder Spekulation. Wörter wie „überraschend“, „dramatisch“, „historisch“ oder „Rückschlag“ nur, wenn der Quelltext genau das sagt, und dann mit Zuordnung („laut …“).
- Behauptungen von Beteiligten kennzeichnest du als solche: „laut Regierung“, „nach Angaben der Polizei“, „die Hamas erklärte …“. Was der Text als unbestätigt bezeichnet, bleibt unbestätigt.
- EINORDNUNG heißt: Hintergrund, Zusammenhang, Reaktionen oder Zahlen, die im Quelltext stehen. Nicht deine Analyse.
- Zahlen exakt wie im Text, ohne eigene Umrechnung oder Rundung. Englische Texte übersetzt du genau; Zahlen im deutschen Format (55,7 statt 55.7).
- Ton: ruhig und sachlich, kein Militär-Drama, keine Effekthascherei.
- Enthält der Text keine echte Nachricht (Kommentar, Bezahlschranke, Ankündigung ohne Inhalt, Sammelartikel), setze usable auf false.

Formate:
- headline: höchstens 60 Zeichen, ein bis zwei Schlüsselwörter in eckigen Klammern für die Akzentfarbe, z. B. „[Israel] wählt mit [Rekord]beteiligung“. Keine verschachtelten Klammern.
- brief („Kurz gesagt“): 2–3 Sätze, höchstens 380 Zeichen, die wichtigsten Fakten mit Zahlen.
- figure: die aussagekräftigste Zahl aus dem Text. value als Zahl, decimals = Nachkommastellen, prefix z. B. „+“ oder leer, suffix z. B. „ %“ oder „ Mrd. Dollar“ oder leer, label kurz wie „Wahlbeteiligung um 16 Uhr“. Ohne sinnvolle Zahl: null.
- lines: 3 oder 4 Zeilen, zusammen 45–65 Wörter, die erste Zeile ist LAGE. Jede Zeile höchstens 120 Zeichen, gut sprechbar, ein Gedanke pro Zeile. say nur, wenn die Aussprache vom Text abweichen muss (z. B. „S&P 500“ → „S und P 500“, Symbole, lange Zahlenketten), sonst null.
- opener: BRIEFING-Überleitung in drei Varianten mit höchstens 6 Wörtern, je nachdem ob die Meldung die erste, eine mittlere oder die letzte ist. Beispiele: first „Wir starten in Israel.“, mid „Blick nach Israel.“ oder „Und an den Märkten?“, last „Zum Schluss nach Israel.“
- short: Kurzform für die Zusammenfassung am Ende, 2–6 Wörter, klein beginnend außer bei Namen, z. B. „Rekordbeteiligung in Israel“.
- place: Ort der Meldung für den Globus. label in Großbuchstaben (z. B. „BRÜSSEL“, „GAZA“, „SAN FRANCISCO“), country_iso3 als ISO-3166-Alpha-3-Code, lon/lat als Koordinaten dieses Ortes. Bei Firmenmeldungen ohne Ortsangabe der Firmensitz. Der Ort ist ein Metadatum für die Karte, keine Aussage in der Meldung.
- source_date: Veröffentlichungsdatum des Artikels als JJJJ-MM-TT, wenn bekannt, sonst null.`;

export const WriteSchema = z.object({
  usable: z.boolean(),
  headline: z.string(),
  brief: z.string(),
  figure: z.object({ value: z.number(), decimals: z.number().int(), prefix: z.string(), suffix: z.string(), label: z.string() }).nullable(),
  lines: z.array(z.object({ role: z.string().describe('LAGE oder EINORDNUNG'), text: z.string(), say: z.string().nullable() })),
  opener: z.object({ first: z.string(), mid: z.string(), last: z.string() }),
  short: z.string(),
  place: z.object({ label: z.string(), country_iso3: z.string(), lon: z.number(), lat: z.number() }),
  source_date: z.string().nullable()
});
type RawDraft = z.infer<typeof WriteSchema>;
export type Draft = Omit<RawDraft, 'lines'> & { lines: { role: 'LAGE' | 'EINORDNUNG'; text: string; say: string | null }[] };

/** Rollen vereinheitlichen („Lage“, „Einordnung:“ …); das SDK prüft Auswahlwerte erst nach der Antwort. */
export const normalizeRole = (r: string): 'LAGE' | 'EINORDNUNG' => (/einord/i.test(r) ? 'EINORDNUNG' : 'LAGE');

export function writePrompt(a: Article, meta: { topic: string; category: string; title: string; source: string; date: string | null }): string {
  return `Thema: ${meta.topic} (Kategorie ${meta.category})
Arbeitstitel der Redaktion: ${meta.title}
Quelle: ${meta.source} — ${a.url}
Veröffentlicht: ${a.date ?? meta.date ?? 'unbekannt'}

QUELLTEXT
<<<
${a.title ? `${a.title}\n\n` : ''}${a.text}
>>>`;
}

export async function writeStory(claude: Claude, a: Article, meta: Parameters<typeof writePrompt>[1]): Promise<Draft> {
  const raw = await claude.ask(`Schreiben „${meta.title}“`, WRITE_SYSTEM, writePrompt(a, meta), WriteSchema);
  return { ...raw, lines: raw.lines.map(l => ({ ...l, role: normalizeRole(l.role) })) };
}

/* ---------- 3. Faktencheck ---------- */

export const VERIFY_SYSTEM = `Du bist Faktenprüfer für „Lagebild“. Du bekommst einen QUELLTEXT und eine daraus geschriebene MELDUNG. Prüfe jedes Element der Meldung streng gegen den Quelltext.

Bewertung pro Element:
- belegt: Jede Tatsachenbehauptung steht so oder sinngemäß im Quelltext.
- teilweise: Ein Teil ist belegt, aber etwas ist ergänzt, zugespitzt, falsch zugeordnet, falsch übersetzt, oder eine Zahl stimmt nicht.
- nicht_belegt: Die Kernaussage steht nicht im Quelltext.

Achte besonders auf Zahlen und Einheiten, Namen und Funktionen, Zeitangaben, die Zuordnung von Aussagen (wer behauptet was), wertende oder deutende Wörter und Wissen, das nicht im Text steht, auch wenn es zutrifft.

Bei teilweise oder nicht_belegt: Nenne das Problem in "problem" und gib in "correction" eine korrigierte Fassung, die nur Belegtes enthält und dasselbe Format hat (bei der Headline mit [Akzent]-Klammern, höchstens 60 Zeichen; Zeilen höchstens 120 Zeichen). Lässt sich nichts Belegtes retten, ist correction null. Bei figure gibt es keine Korrektur, nur die Bewertung.
Bei belegt sind problem und correction null.`;

export const VerifySchema = z.object({
  items: z.array(z.object({
    id: z.string().describe('headline, brief, figure, short, line1, line2, …'),
    verdict: z.string().describe('belegt, teilweise oder nicht_belegt'),
    problem: z.string().nullable(),
    correction: z.string().nullable()
  }))
});
export interface Verdict { id: string; verdict: 'belegt' | 'teilweise' | 'nicht_belegt'; problem: string | null; correction: string | null }

export const normalizeVerdict = (v: string): Verdict['verdict'] => (/nicht/i.test(v) ? 'nicht_belegt' : /teil/i.test(v) ? 'teilweise' : /beleg/i.test(v) ? 'belegt' : 'nicht_belegt');

async function check(claude: Claude, label: string, a: Article, d: Draft): Promise<Verdict[]> {
  const out = await claude.ask(label, VERIFY_SYSTEM, verifyPrompt(a, d), VerifySchema);
  return out.items.map(v => ({ ...v, id: v.id.trim().toLowerCase(), verdict: normalizeVerdict(v.verdict) }));
}

export function verifyPrompt(a: Article, d: Draft): string {
  const fig = d.figure ? `${d.figure.prefix}${d.figure.value}${d.figure.suffix} (${d.figure.label})` : '(keine)';
  const lines = d.lines.map((l, i) => `line${i + 1} [${l.role}]: ${l.text}`).join('\n');
  return `QUELLTEXT
<<<
${a.title ? `${a.title}\n\n` : ''}${a.text}
>>>

MELDUNG
headline: ${d.headline}
brief: ${d.brief}
figure: ${fig}
short: ${d.short}
${lines}`;
}

export interface Checked { draft: Draft | null; issues: string[] }

/** Wendet das Prüfergebnis an: Korrekturen übernehmen, Unbelegtes streichen, notfalls die Meldung verwerfen. */
export function applyVerdicts(d: Draft, items: Verdict[]): Checked & { changed: boolean } {
  const issues: string[] = [];
  let changed = false;
  const next: Draft = structuredClone(d);
  const bad = (v: Verdict): boolean => v.verdict !== 'belegt';
  const removeLines = new Set<number>();
  for (const v of items) {
    if (!bad(v)) continue;
    issues.push(`${v.id}: ${v.verdict}${v.problem ? ` – ${v.problem}` : ''}`);
    const fix = v.correction?.trim() || null;
    if (v.id === 'headline' || v.id === 'brief' || v.id === 'short') {
      if (!fix) return { draft: null, issues: [...issues, `${v.id} nicht belegt, Meldung verworfen`], changed: true };
      next[v.id] = fix;
      changed = true;
    } else if (v.id === 'figure') {
      next.figure = null;
      changed = true;
    } else {
      const m = /^line(\d+)$/.exec(v.id);
      const i = m ? Number(m[1]) - 1 : -1;
      const line = next.lines[i];
      if (!line) continue;
      if (fix) { line.text = fix; line.say = null; } else removeLines.add(i);
      changed = true;
    }
  }
  next.lines = next.lines.filter((_, i) => !removeLines.has(i));
  if (next.lines.length < 2) return { draft: null, issues: [...issues, 'zu wenige belegte Zeilen, Meldung verworfen'], changed: true };
  if (next.lines[0]!.role !== 'LAGE') next.lines[0]!.role = 'LAGE';
  return { draft: next, issues, changed };
}

/** Faktencheck; nach Korrekturen wird ein zweites Mal geprüft, was dann noch fehlt, fliegt raus. */
export async function verifyStory(claude: Claude, a: Article, d: Draft, label: string): Promise<Checked> {
  const first = await check(claude, `Prüfen „${label}“`, a, d);
  const r1 = applyVerdicts(d, first);
  if (!r1.draft || !r1.changed) return r1;
  const second = await check(claude, `Nachprüfen „${label}“`, a, r1.draft);
  // Beim zweiten Durchgang keine weiteren Korrekturen: Unbelegtes wird gestrichen
  const strict = second.map(v => ({ ...v, correction: null }));
  const r2 = applyVerdicts(r1.draft, strict);
  return { draft: r2.draft, issues: [...r1.issues, ...r2.issues.map(i => `2. Prüfung: ${i}`)] };
}
