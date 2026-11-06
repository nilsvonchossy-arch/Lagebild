// Die redaktionellen Schritte mit Claude: Auswahl, Fakten sammeln, Faktencheck.
// Grundregel aus CLAUDE.md: Meldungen enthalten nur Fakten aus der verlinkten Quelle.
// Aus den geprüften Einzelfakten schreibt danach drehbuch.ts die ganze Folge als Dialog.
import { z } from 'zod';
import { isActive, type ThemenConfig, type Weight } from '../src/shared/config.ts';
import { FACT_KINDS, type FactKind } from '../src/shared/types.ts';
import type { Claude } from './claude.ts';
import type { Article } from './extract.ts';
import type { Candidate } from './sources.ts';

const WEIGHT_TEXT: Record<Weight, string> = { aus: 'aus', kurz: 'nur kurz', normal: 'normal', ausfuehrlich: 'ausführlich' };

/* ---------- 1. Auswahl ---------- */

export const SELECT_SYSTEM = `Du bist die Chefredaktion von „Lagebild“, einem persönlichen täglichen Nachrichtenüberblick für einen Leser in Deutschland. Die Folge wird als Gespräch gesprochen und hat Untertitel.

Deine Aufgabe: Aus einer Liste von Artikeln der letzten 24 Stunden wählst du die wichtigsten Meldungen des Tages aus und bewertest ihre Relevanz.

So wählst du aus:
- Eine Meldung ist ein Ereignis oder eine neue Entwicklung, kein einzelner Artikel. Fasse Artikel zum selben Ereignis zu einer Meldung zusammen und nenne alle zugehörigen Artikel-IDs.
- Bevorzuge harte Nachrichten mit neuen, überprüfbaren Fakten: Entscheidungen, Ereignisse, Zahlen, offizielle Ankündigungen. Nicht geeignet sind Kommentare, Meinungsbeiträge, Ratgeber, Liveticker-Übersichten ohne neue Fakten, Werbung und Clickbait.
- Halte dich an die Themen und ihre Gewichtung. Bei vergleichbarer Bedeutung gehen Themen mit Gewichtung „ausführlich“ vor. Themen mit „nur kurz“ bekommen nur eine kurze Notiz; nimm sie trotzdem auf, wenn es eine echte Nachricht gibt. Ein Thema mit „mindestens eine Meldung pro Tag“ bekommt eine, wenn es dazu eine echte Nachricht gibt.
- Höchstens zwei Meldungen pro Thema. Achte auf Abwechslung zwischen den Kategorien.
- Was gestern schon im Lagebild war, nimmst du nur bei einer wesentlichen neuen Entwicklung.
- Sortiere nach Bedeutung, die wichtigste zuerst.
- Ordne die Artikel-IDs jeder Meldung nach ihrer Eignung als Quelle: Berichte, die neben dem Ereignis auch Hintergrund, Streitpunkte und Folgen erklären, vor kurzen Tickermeldungen; ausführliche, frei lesbare Berichte zuerst (Nachrichtenagenturen, öffentlich-rechtliche Sender, Qualitätsmedien), Artikel hinter Bezahlschranken ans Ende.
- Große Enthüllungen nicht übersehen: Beruht eine Meldung auf einer eigenen Recherche eines Mediums oder Recherchenetzwerks (geleakte Dokumente, Datenrecherche, verdeckte Recherche, „Recherchen von … zeigen“), setze investigative auf true. Nicht bei Berichten über Pressekonferenzen, Agenturmeldungen oder bloßen Exklusiv-Zitaten. Eine Enthüllung mit großer Tragweite (Machtmissbrauch, Korruption, Gefahr für viele Menschen) bekommt Relevanz 4 oder 5.
- background_articles: Für Meldungen mit Relevanz 4 oder 5 nenne bis zu zwei weitere Artikel-IDs zum selben Ereignis, die Vorgeschichte, Beteiligte oder Gründe erklären (Hintergrundbericht, Analyse mit Fakten, Erklärstück), möglichst von einer anderen Quelle als dem ersten Artikel. Keine Kommentare oder Meinungsbeiträge. Sonst eine leere Liste.

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
    working_title: z.string().describe('Sachlicher Arbeitstitel auf Deutsch'),
    investigative: z.boolean().describe('true bei einer eigenen Recherche eines Mediums (Enthüllung)'),
    background_articles: z.array(z.number().int()).describe('Bis zu zwei Artikel-IDs mit Hintergrund zum selben Ereignis, nur bei Relevanz 4 oder 5')
  }))
});
export type Selection = z.infer<typeof SelectSchema>['stories'][number];

/** Große Meldung für den Fokus: Relevanz 5 oder eine Enthüllung mit Relevanz ab 4. */
export const isMajor = (s: { relevance: number; investigative?: boolean }): boolean => s.relevance >= 5 || (Boolean(s.investigative) && s.relevance >= 4);

function fmtTime(iso: string | null): string {
  if (!iso) return '?';
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export interface SelectOpts { dateLabel: string; yesterday: string[]; want: number; minutes: number }

export function selectPrompt(cfg: ThemenConfig, cands: Candidate[], opts: SelectOpts): string {
  const cat = new Map(cfg.categories.map(c => [c.id, c.name]));
  const topics = cfg.topics.filter(isActive).map(t =>
    `- ${t.id} | ${t.name} | Kategorie: ${cat.get(t.category) ?? t.category} | Gewichtung: ${WEIGHT_TEXT[t.weight]}${t.minPerDay ? ' | mindestens eine Meldung pro Tag' : ''}${t.description ? ` | ${t.description}` : ''}`
  ).join('\n');
  const arts = cands.map(c => `[${c.id}] ${c.source} | ${fmtTime(c.published)} | ${c.topics.join(',')} | ${c.title}${c.teaser ? ` — ${c.teaser}` : ''}`).join('\n');
  return `Datum: ${opts.dateLabel}
Länge der Folge: etwa ${opts.minutes} Minuten

Gib ${opts.want + 3} Meldungen zurück: die ${opts.want} besten und drei Reserven, falls eine Quelle nicht abrufbar ist. Gibt es weniger gute Meldungen, gib weniger zurück.

THEMEN DES LESERS (ID | Name | Kategorie | Gewichtung | worum es geht)
${topics}

GESTERN IM LAGEBILD
${opts.yesterday.length ? opts.yesterday.map(h => `- ${h}`).join('\n') : '- (nichts)'}

ARTIKEL (ID | Quelle | Zeit | gefunden über Thema | Titel — Teaser)
${arts}`;
}

export async function selectStories(claude: Claude, cfg: ThemenConfig, cands: Candidate[], opts: SelectOpts): Promise<Selection[]> {
  const out = await claude.ask('Auswahl', SELECT_SYSTEM, selectPrompt(cfg, cands, opts), SelectSchema);
  const ids = new Set(cands.map(c => c.id));
  const topicIds = new Set(cfg.topics.filter(isActive).map(t => t.id));
  return out.stories
    .map(s => ({
      ...s,
      articles: s.articles.filter(a => ids.has(a)),
      relevance: Math.max(1, Math.min(5, Math.round(s.relevance))),
      investigative: s.investigative === true,
      background_articles: (s.background_articles ?? []).filter(a => ids.has(a)).slice(0, 2)
    }))
    .filter(s => s.articles.length && topicIds.has(s.topic));
}

/* ---------- 2. Fakten sammeln ---------- */

export const WRITE_SYSTEM = `Du bereitest eine Meldung für „Lagebild“ vor, einen gesprochenen täglichen Nachrichtenüberblick auf Deutsch. Du ziehst aus dem QUELLTEXT einzelne, überprüfbare Fakten und schreibst die Texte für die Karte. Den gesprochenen Dialog schreibt später ein eigener Schritt aus deinen Fakten.

Die wichtigste Regel: Du verwendest ausschließlich Informationen aus dem QUELLTEXT.
- Jede Aussage, jede Zahl, jeder Name, jede Funktion und jedes Datum muss im Quelltext stehen. Ergänze nichts aus deinem Allgemeinwissen, auch wenn es stimmt: keine Amtszeiten, Vorgeschichte, Titel oder Zahlen, die nicht im Text stehen.
- Keine eigene Bewertung, Deutung, Prognose oder Spekulation. Wörter wie „überraschend“, „dramatisch“, „historisch“ oder „Rückschlag“ nur, wenn der Quelltext genau das sagt, und dann mit Zuordnung („laut …“).
- Behauptungen von Beteiligten kennzeichnest du als solche: „laut Regierung“, „nach Angaben der Polizei“, „die Hamas erklärte …“. Was der Text als unbestätigt bezeichnet, bleibt unbestätigt.
- Zahlen exakt wie im Text, ohne eigene Umrechnung oder Rundung. Englische Texte übersetzt du genau; Zahlen im deutschen Format (55,7 statt 55.7).
- Ton: ruhig und sachlich, kein Militär-Drama, keine Effekthascherei.
- Enthält der Text keine echte Nachricht (Kommentar, Bezahlschranke, Ankündigung ohne Inhalt, Sammelartikel), setze usable auf false.

Formate:
- facts: 3 bis 12 Einzelfakten wie für ein Briefing an eine Regierungschefin, die in einer Minute das Wesentliche verstehen muss: nicht die Schlagzeile, sondern die Kerninformationen und Probleme. Wähle aus dem Quelltext in dieser Reihenfolge, soweit er es hergibt:
  1. kern: was passiert ist, in einem Satz.
  2. problem: worum es eigentlich geht – der Streitpunkt, das Risiko, die Folge oder was auf dem Spiel steht, so wie der Quelltext es beschreibt.
  3. Wer beteiligt ist und wer was will (Positionen, Forderungen, Reaktionen mit Zuschreibung).
  4. zahl: die ein, zwei Zahlen, die die Größenordnung zeigen.
  5. ausblick: was als Nächstes passiert – Entscheidung, Frist, Abstimmung, nächster Schritt.
  6. vorbehalt: was unklar oder umstritten ist.
  Lass Farbe und Nebensächliches weg (Wetter, Anekdoten, Szenen, Wiederholungen), wenn dafür Substanz fehlen würde. Jeder Fakt ist genau eine Aussage als vollständiger, gut sprechbarer deutscher Hauptsatz, höchstens 160 Zeichen. Zuschreibungen gehören in den Fakt („laut Wahlkomitee …“, „Sandoz nennt …“). Vorbehalte der Quelle sind eigene Fakten („Die Ursache ist laut Polizei noch unklar.“). Wörtliche Zitate nur, wenn sie wörtlich im Quelltext stehen und nicht übersetzt werden müssen; sonst indirekte Rede. Gibt der Text nur drei Fakten her, sind es drei. Keine Fakten erfinden oder aufblähen, um auf eine Anzahl zu kommen.
  kind ist eines von: kern, problem, ausblick, detail, zahl, zitat, vorbehalt, hintergrund, reaktion.
- headline: eine Zeile für die Karte, 5–9 Wörter, höchstens 60 Zeichen, normale Schreibweise, ein bis zwei Schlüsselwörter in eckigen Klammern für die Akzentfarbe, z. B. „[Israel] wählt mit [Rekord]beteiligung“. Keine verschachtelten Klammern.
- brief („Kurz gesagt“, für den Endbildschirm): 2–3 Sätze, höchstens 380 Zeichen: was passiert ist, worin das Problem liegt, was als Nächstes kommt – mit den wichtigsten Zahlen.
- figure: die Zahl, die man sich merken soll, aus dem Text. value als Zahl, decimals = Nachkommastellen, prefix z. B. „+“ oder leer, suffix z. B. „ %“ oder „ Mrd. Dollar“ oder leer, label kurz wie „Wahlbeteiligung um 16 Uhr“. Ohne sinnvolle Zahl: null.
- short: Schlagwort für die Zusammenfassung am Ende der Folge, 2–5 Wörter, z. B. „Rekordbeteiligung in Israel“.
- place: Hauptort der Meldung für den Globus. label in Großbuchstaben (z. B. „BRÜSSEL“, „GAZA“, „SAN FRANCISCO“), country_iso3 als ISO-3166-Alpha-3-Code, lon/lat als Koordinaten dieses Ortes. Bei Firmenmeldungen ohne Ortsangabe der Firmensitz. Der Ort ist ein Metadatum für die Karte, keine Aussage in der Meldung.
- places: höchstens zwei weitere Orte, die im Quelltext ausdrücklich eine Rolle spielen (z. B. Gegenseite eines Konflikts, Herkunft einer Drohne). label so geschrieben, wie der Ort in einem deutschen Satz vorkommt („Nordkorea“, „Mailand“), route nur true, wenn der Text eine Bewegung von dort zum Hauptort beschreibt. Sonst eine leere Liste.
- source_date: Veröffentlichungsdatum des Artikels als JJJJ-MM-TT, wenn bekannt, sonst null.
- enthuellung: true nur, wenn der Quelltext ausdrücklich auf einer eigenen Recherche eines Mediums oder Recherchenetzwerks beruht (z. B. „Recherchen von NDR, WDR und SZ zeigen …“, „Dokumente, die dem SPIEGEL vorliegen“, „an investigation by …“). Dann beginnt der Kern-Fakt mit dieser Zuschreibung („Nach Recherchen von … “), und Fakten, die nur die Recherche belegt, behalten sie. Sonst false.

Einblendungen (erscheinen im Video beim passenden Wort; sie zeigen nur, was in deinen Fakten steht):
- vergleich: nur wenn der Text mindestens zwei vergleichbare Werte derselben Art nennt (z. B. Wahlbeteiligung jetzt und bei der letzten Wahl, Umsatz in zwei Jahren). label sagt, was verglichen wird („Wahlbeteiligung“), unit die Einheit mit Leerzeichen davor („ %“, „ Mrd. Euro“) oder leer, decimals die Nachkommastellen. items: 2 bis 4 Werte; jeder Wert steht genau so in einem deiner Fakten, und das label des Werts ist ein Wort aus demselben Fakt („2022“, „16 Uhr“, „Nasdaq“) oder „jetzt“ für den aktuellen Wert. Sonst null.
- termin: nur wenn ein Fakt eine konkrete Uhrzeit oder ein Datum nennt, das für die Meldung wichtig ist (Wahllokale schließen, Marktstart, Frist). time als HH:MM oder null, date als JJJJ-MM-TT oder null, label kurz („Wahllokale schließen, Ortszeit“). Sonst null.
- symbol: ein Wort für das Symbol der Meldung: wahl, parlament, regierung, diplomatie, gericht, sicherheit, geld, boerse, handel, fabrik, arbeit, energie, klima, medizin, forschung, ki, chip, cyber, raumfahrt, verkehr oder bildung.
- motive: höchstens zwei Bildmotive für ein Archivbild: Personen, Orte, Organisationen oder Bauwerke, die im Quelltext namentlich vorkommen und für die Meldung zentral sind. name so, wie er im Quelltext steht; art ist person, ort, organisation oder bauwerk; suche ist der übliche vollständige Name für ein Lexikon (z. B. „Benjamin Netanjahu“, „Sandoz“, „Kundl“). Keine Motive, die nur im Hintergrund erwähnt werden. Sonst eine leere Liste.`;

const PlaceSchema = z.object({ label: z.string(), country_iso3: z.string(), lon: z.number(), lat: z.number() });

export const WriteSchema = z.object({
  usable: z.boolean(),
  facts: z.array(z.object({ text: z.string(), kind: z.string().describe('kern, problem, ausblick, detail, zahl, zitat, vorbehalt, hintergrund oder reaktion') })),
  headline: z.string(),
  brief: z.string(),
  figure: z.object({ value: z.number(), decimals: z.number().int(), prefix: z.string(), suffix: z.string(), label: z.string() }).nullable(),
  short: z.string(),
  place: PlaceSchema,
  places: z.array(PlaceSchema.extend({ route: z.boolean() })),
  source_date: z.string().nullable(),
  enthuellung: z.boolean(),
  vergleich: z.object({ label: z.string(), unit: z.string(), decimals: z.number().int(), items: z.array(z.object({ label: z.string(), value: z.number() })) }).nullable(),
  termin: z.object({ time: z.string().nullable(), date: z.string().nullable(), label: z.string() }).nullable(),
  symbol: z.string(),
  motive: z.array(z.object({ name: z.string(), art: z.string().describe('person, ort, organisation oder bauwerk'), suche: z.string() }))
});
export type Draft = z.infer<typeof WriteSchema>;

export function writePrompt(a: Article, meta: { topic: string; category: string; title: string; source: string; date: string | null; investigative?: boolean }): string {
  return `Thema: ${meta.topic} (Kategorie ${meta.category})
Arbeitstitel der Redaktion: ${meta.title}${meta.investigative ? '\nHinweis der Auswahl: vermutlich eine eigene Recherche (Enthüllung); prüfe das am Quelltext.' : ''}
Quelle: ${meta.source} — ${a.url}
Veröffentlicht: ${a.date ?? meta.date ?? 'unbekannt'}

QUELLTEXT
<<<
${a.title ? `${a.title}\n\n` : ''}${a.text}
>>>`;
}

/** Fakten-Art vereinheitlichen; das SDK prüft Auswahlwerte erst nach der Antwort. */
export const normalizeKind = (k: string): FactKind => FACT_KINDS.find(x => k.toLowerCase().includes(x)) ?? 'detail';

export async function writeStory(claude: Claude, a: Article, meta: Parameters<typeof writePrompt>[1]): Promise<Draft> {
  const raw = await claude.ask(`Fakten „${meta.title}“`, WRITE_SYSTEM, writePrompt(a, meta), WriteSchema);
  return {
    ...raw,
    enthuellung: raw.enthuellung === true,
    facts: raw.facts.map(f => ({ text: f.text.trim(), kind: normalizeKind(f.kind) })).filter(f => f.text).slice(0, 12),
    places: raw.places.slice(0, 2),
    motive: raw.motive.filter(m => m.name.trim() && a.text.toLowerCase().includes(m.name.trim().toLowerCase())).slice(0, 2)
  };
}

/* ---------- 3. Faktencheck ---------- */

export const VERIFY_SYSTEM = `Du bist Faktenprüfer für „Lagebild“. Du bekommst einen QUELLTEXT und daraus gezogene Einzelfakten und Kartentexte. Prüfe jedes Element streng gegen den Quelltext.

Bewertung pro Element:
- belegt: Jede Tatsachenbehauptung steht so oder sinngemäß im Quelltext.
- teilweise: Ein Teil ist belegt, aber etwas ist ergänzt, zugespitzt, falsch zugeordnet, falsch übersetzt, oder eine Zahl stimmt nicht.
- nicht_belegt: Die Kernaussage steht nicht im Quelltext.

Achte besonders auf Zahlen und Einheiten, Namen und Funktionen, Zeitangaben, die Zuordnung von Aussagen (wer behauptet was), wertende oder deutende Wörter, Wissen, das nicht im Text steht, auch wenn es zutrifft, und auf Zitate: Was in Anführungszeichen steht, muss wörtlich im Text stehen.

Bei teilweise oder nicht_belegt: Nenne das Problem in "problem" und gib in "correction" eine korrigierte Fassung, die nur Belegtes enthält und dasselbe Format hat (bei der Headline mit [Akzent]-Klammern, höchstens 60 Zeichen; Fakten als ein Hauptsatz, höchstens 160 Zeichen). Lässt sich nichts Belegtes retten, ist correction null. Bei figure, vergleich und termin gibt es keine Korrektur, nur die Bewertung; prüfe dort, ob Werte, Beschriftungen und Zeiten genau so im Quelltext stehen und dasselbe meinen. Bei enthuellung prüfst du, ob der Quelltext ausdrücklich eine eigene Recherche eines Mediums oder Recherchenetzwerks als Grundlage nennt; auch hier keine Korrektur.
Bei belegt sind problem und correction null.`;

export const VerifySchema = z.object({
  items: z.array(z.object({
    id: z.string().describe('headline, brief, figure, short, vergleich, termin, enthuellung, f1, f2, … (beim Hintergrund: h1, h2, …, zeit1, akteur1, kette)'),
    verdict: z.string().describe('belegt, teilweise oder nicht_belegt'),
    problem: z.string().nullable(),
    correction: z.string().nullable()
  }))
});
export interface Verdict { id: string; verdict: 'belegt' | 'teilweise' | 'nicht_belegt'; problem: string | null; correction: string | null }

export const normalizeVerdict = (v: string): Verdict['verdict'] => (/nicht/i.test(v) ? 'nicht_belegt' : /teil/i.test(v) ? 'teilweise' : /beleg/i.test(v) ? 'belegt' : 'nicht_belegt');

async function askVerdicts(claude: Claude, label: string, system: string, prompt: string): Promise<Verdict[]> {
  const out = await claude.ask(label, system, prompt, VerifySchema);
  return out.items.map(v => ({ ...v, id: v.id.trim().toLowerCase().replace(/\s+/g, ''), verdict: normalizeVerdict(v.verdict) }));
}

const check = (claude: Claude, label: string, a: Article, d: Draft): Promise<Verdict[]> => askVerdicts(claude, label, VERIFY_SYSTEM, verifyPrompt(a, d));

export function verifyPrompt(a: Article, d: Draft): string {
  const fig = d.figure ? `${d.figure.prefix}${d.figure.value}${d.figure.suffix} (${d.figure.label})` : '(keine)';
  const cmp = d.vergleich ? `${d.vergleich.label}: ${d.vergleich.items.map(i => `${i.label} ${i.value}${d.vergleich!.unit}`).join(' · ')}` : null;
  const ter = d.termin ? `${d.termin.label}: ${[d.termin.date, d.termin.time].filter(Boolean).join(' ')}` : null;
  const facts = d.facts.map((f, i) => `f${i + 1} [${f.kind}]: ${f.text}`).join('\n');
  return `QUELLTEXT
<<<
${a.title ? `${a.title}\n\n` : ''}${a.text}
>>>

ZU PRÜFEN
headline: ${d.headline}
brief: ${d.brief}
figure: ${fig}
short: ${d.short}
${cmp ? `vergleich: ${cmp}\n` : ''}${ter ? `termin: ${ter}\n` : ''}${d.enthuellung ? 'enthuellung: Der Text beruht auf einer eigenen Recherche eines Mediums oder Recherchenetzwerks.\n' : ''}${facts}`;
}

export interface Checked { draft: Draft | null; issues: string[] }

/** Wendet das Prüfergebnis an: Korrekturen übernehmen, Unbelegtes streichen, notfalls die Meldung verwerfen. */
export function applyVerdicts(d: Draft, items: Verdict[]): Checked & { changed: boolean } {
  const issues: string[] = [];
  let changed = false;
  const next: Draft = structuredClone(d);
  const remove = new Set<number>();
  for (const v of items) {
    if (v.verdict === 'belegt') continue;
    issues.push(`${v.id}: ${v.verdict}${v.problem ? ` – ${v.problem}` : ''}`);
    const fix = v.correction?.trim() || null;
    if (v.id === 'headline' || v.id === 'brief' || v.id === 'short') {
      if (!fix) return { draft: null, issues: [...issues, `${v.id} nicht belegt, Meldung verworfen`], changed: true };
      next[v.id] = fix;
      changed = true;
    } else if (v.id === 'figure' || v.id === 'vergleich' || v.id === 'termin') {
      next[v.id] = null;
      changed = true;
    } else if (v.id === 'enthuellung') {
      next.enthuellung = false;
      changed = true;
    } else {
      const m = /^f(?:akt)?(\d+)$/.exec(v.id);
      const i = m ? Number(m[1]) - 1 : -1;
      const f = next.facts[i];
      if (!f) continue;
      if (fix) f.text = fix; else remove.add(i);
      changed = true;
    }
  }
  next.facts = next.facts.filter((_, i) => !remove.has(i));
  if (next.facts.length < 2) return { draft: null, issues: [...issues, 'zu wenige belegte Fakten, Meldung verworfen'], changed: true };
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

/* ---------- 4. Hintergrund ---------- */
// Große Meldungen (Aufmacher und Fokus, Relevanz ab 4) bekommen einen Teil „Hintergrund“: Vorgeschichte,
// Beteiligte, Gründe. Neue Fakten kommen nur aus einer zweiten Quelle zum selben Ereignis (oder, wenn es keine
// gibt, noch einmal aus der Hauptquelle) und werden gegen diesen Text geprüft wie jeder andere Fakt.
// Dazu die Erklär-Grafiken Zeitleiste, „Wer steht wo“ und Ursache-Wirkung-Kette, gebaut nur aus geprüften Fakten.

export const BACKGROUND_SYSTEM = `Du bereitest für „Lagebild“ den Teil „Hintergrund“ einer großen Meldung vor. Der Zuhörer soll verstehen, was im Hintergrund passiert: die Vorgeschichte, wer beteiligt ist und wer was will, und warum es dazu kam. Du bekommst die BEKANNTEN FAKTEN der Meldung (schon geprüft) und einen QUELLTEXT zum selben Ereignis.

Die wichtigste Regel: Neue Fakten stammen ausschließlich aus dem QUELLTEXT.
- Jede Aussage, jede Zahl, jeder Name, jede Funktion und jede Zeitangabe muss im Quelltext stehen. Ergänze nichts aus deinem Allgemeinwissen, auch wenn es stimmt.
- Keine eigene Bewertung, Deutung, Prognose oder Spekulation. Ursachen und Motive nur, wenn der Quelltext sie nennt, und dann mit Zuordnung („laut …“, „nach Angaben von …“, „X begründet das mit …“).
- Behauptungen von Beteiligten bleiben Behauptungen; was der Text als unbestätigt bezeichnet, bleibt unbestätigt.
- Zahlen exakt wie im Text. Englische Texte übersetzt du genau; Zahlen im deutschen Format.
- Behandelt der Quelltext ein anderes Ereignis oder enthält er keinen Hintergrund, setze usable auf false.

Formate:
- facts: 2 bis 8 Hintergrund-Fakten in dieser Reihenfolge, soweit der Quelltext es hergibt: Vorgeschichte (was vorher geschah, mit Zeitangabe), Beteiligte und ihre Positionen (wer will was), Gründe (warum es dazu kam, laut wem). Nur, was nicht schon in den bekannten Fakten steht. Jeder Fakt ist genau eine Aussage als vollständiger, gut sprechbarer deutscher Hauptsatz, höchstens 160 Zeichen, mit der Zuschreibung im Fakt. Gibt der Text nur zwei her, sind es zwei. Keine Fakten erfinden oder aufblähen.

Einblendungen (Erklär-Grafiken im Video; sie zeigen nur, was in den Fakten steht – den bekannten Fakten f1, f2 … oder deinen neuen h1, h2 … in deiner Reihenfolge):
- zeitleiste: 2 bis 5 Einträge der Vorgeschichte, älteste zuerst, nur wenn die Fakten mindestens zwei Zeitpunkte nennen. datum: die Zeitangabe genau so, wie sie im Fakt steht („2019“, „März 2024“, „7. Oktober 2023“), für das aktuelle Ereignis „heute“. label: was damals geschah, höchstens 40 Zeichen. fakten: die IDs der Fakten, in denen es steht. Sonst eine leere Liste.
- akteure: 2 bis 4 Beteiligte, nur wenn die Fakten ihre Position nennen. name: so, wie er im Fakt steht. rolle: wer das ist, höchstens 40 Zeichen, aus den Fakten. position: was er will, fordert oder sagt, höchstens 90 Zeichen, mit der Zuschreibung aus dem Fakt; keine Einordnung in Lager, keine Wertung. fakten: IDs. Sonst eine leere Liste.
- kette: 2 bis 4 Schritte von der Ursache zur Wirkung, nur wenn die Fakten den Zusammenhang ausdrücklich nennen („weil“, „Grund ist“, „führte zu“, „als Reaktion auf“). label: höchstens 50 Zeichen je Schritt. fakten: IDs. Sonst eine leere Liste.
Lieber eine leere Liste als eine gezwungene Grafik.`;

export const BackgroundSchema = z.object({
  usable: z.boolean(),
  facts: z.array(z.string()),
  zeitleiste: z.array(z.object({ datum: z.string(), label: z.string(), fakten: z.array(z.string()) })),
  akteure: z.array(z.object({ name: z.string(), rolle: z.string(), position: z.string(), fakten: z.array(z.string()) })),
  kette: z.array(z.object({ label: z.string(), fakten: z.array(z.string()) }))
});

/** Hintergrund einer Meldung; Verweise auf Fakten als f1 … (Hauptquelle, geprüft) und h1 … (Hintergrund) */
export interface BackgroundDraft {
  facts: { id: string; text: string }[];
  timeline: { date: string; label: string; facts: string[] }[];
  actors: { name: string; role: string; position: string; facts: string[] }[];
  chain: { label: string; facts: string[] }[];
}

export interface BackgroundMeta { title: string; mainSource: string; source: string; sameSource: boolean }

export function backgroundPrompt(a: Article, d: Draft, meta: BackgroundMeta): string {
  const known = d.facts.map((f, i) => `f${i + 1} [${f.kind}] ${f.text}`).join('\n');
  const which = meta.sameSource ? `dieselbe Quelle ${meta.source}; nimm nur Hintergrund, der noch nicht in den bekannten Fakten steht` : meta.source;
  return `Meldung: ${d.headline.replace(/[[\]]/g, '')}

BEKANNTE FAKTEN (geprüft, aus ${meta.mainSource})
${known}

QUELLTEXT (${which} — ${a.url})
<<<
${a.title ? `${a.title}\n\n` : ''}${a.text}
>>>`;
}

const MIN_ENTRIES = 2;

/** Verweise auf vorhandene Fakten beschränken, leere Einträge und zu kurze Grafiken streichen. */
export function pruneBackground(bg: BackgroundDraft, known: number): BackgroundDraft | null {
  const ok = new Set([...Array.from({ length: known }, (_, i) => `f${i + 1}`), ...bg.facts.map(f => f.id)]);
  const refs = (r: string[]): string[] => [...new Set(r.map(x => x.trim().toLowerCase()).filter(x => ok.has(x)))];
  const atLeast = <T>(xs: T[], max: number): T[] => (xs.length >= MIN_ENTRIES ? xs.slice(0, max) : []);
  const out: BackgroundDraft = {
    facts: bg.facts,
    timeline: atLeast(bg.timeline.map(e => ({ ...e, facts: refs(e.facts) })).filter(e => e.date && e.label && e.facts.length), 5),
    actors: atLeast(bg.actors.map(x => ({ ...x, facts: refs(x.facts) })).filter(x => x.name && x.role && x.position && x.facts.length), 4),
    chain: atLeast(bg.chain.map(x => ({ ...x, facts: refs(x.facts) })).filter(x => x.label && x.facts.length), 4)
  };
  // Eine Kette, deren Schritte sich alle auf denselben Fakt stützen, erklärt nichts
  if (out.chain.length && new Set(out.chain.flatMap(c => c.facts)).size < 2) out.chain = [];
  return out.facts.length || out.timeline.length || out.actors.length || out.chain.length ? out : null;
}

/** Antwort aufräumen: Fakten nummerieren (h1 …), leere streichen, Verweise vereinheitlichen. */
export function cleanBackground(raw: z.infer<typeof BackgroundSchema>, known: number): BackgroundDraft | null {
  if (!raw.usable) return null;
  const facts = raw.facts.map((t, i) => ({ id: `h${i + 1}`, text: t.trim() })).filter(f => f.text).slice(0, 8);
  return pruneBackground({
    facts,
    timeline: raw.zeitleiste.map(e => ({ date: e.datum.trim(), label: e.label.trim(), facts: e.fakten })),
    actors: raw.akteure.map(x => ({ name: x.name.trim(), role: x.rolle.trim(), position: x.position.trim(), facts: x.fakten })),
    chain: raw.kette.map(x => ({ label: x.label.trim(), facts: x.fakten }))
  }, known);
}

export async function writeBackground(claude: Claude, a: Article, d: Draft, meta: BackgroundMeta): Promise<BackgroundDraft | null> {
  const raw = await claude.ask(`Hintergrund „${meta.title}“`, BACKGROUND_SYSTEM, backgroundPrompt(a, d, meta), BackgroundSchema);
  return cleanBackground(raw, d.facts.length);
}

export const VERIFY_BACKGROUND_SYSTEM = `Du bist Faktenprüfer für „Lagebild“ und prüfst den Teil „Hintergrund“ einer Meldung. Du bekommst die BEKANNTEN FAKTEN der Meldung (schon geprüft), einen QUELLTEXT und daraus gezogene Hintergrund-Fakten (h1, h2 …) sowie Erklär-Grafiken, die sich auf diese Fakten stützen.

Bewertung pro Element: belegt, teilweise oder nicht_belegt.
- h1, h2 …: streng gegen den QUELLTEXT. belegt: steht so oder sinngemäß im Quelltext. teilweise: etwas ist ergänzt, zugespitzt, falsch zugeordnet oder übersetzt, oder eine Zahl, ein Name oder eine Zeitangabe stimmt nicht. nicht_belegt: steht nicht im Quelltext. Achte besonders auf Wissen, das nicht im Text steht, auch wenn es zutrifft, auf Ursachen und Motive ohne Zuschreibung, auf wertende Wörter und auf Zitate. Bei teilweise oder nicht_belegt nennst du das Problem in "problem" und gibst in "correction" eine korrigierte Fassung, die nur Belegtes enthält (ein Hauptsatz, höchstens 160 Zeichen), oder null.
- zeit1, zeit2 … (Zeitleiste): Steht die Zeitangabe so in den genannten Fakten, beschreibt die Beschriftung, was dort zu diesem Zeitpunkt steht, und stimmt die Reihenfolge (älteste zuerst)? „heute“ steht für das aktuelle Ereignis.
- akteur1, akteur2 …: Nennen die genannten Fakten diesen Beteiligten, und geben Rolle und Position genau wieder, was dort steht, mit Zuschreibung, ohne Zuspitzung und ohne Einordnung in Lager?
- kette: Nennen die genannten Fakten den Zusammenhang zwischen den Schritten ausdrücklich als Ursache und Wirkung, in dieser Richtung? Ein bloßes Nacheinander reicht nicht.
Bei den Grafiken gibt es keine Korrektur, nur die Bewertung; die Fakten h1, h2 … gelten dabei so, wie du sie bewertest.
Bei belegt sind problem und correction null.`;

export function verifyBackgroundPrompt(a: Article, d: Draft, bg: BackgroundDraft): string {
  const known = d.facts.map((f, i) => `f${i + 1} ${f.text}`).join('\n');
  const ids = (r: string[]): string => `[${r.join(', ')}]`;
  const rows = [
    ...bg.facts.map(f => `${f.id}: ${f.text}`),
    ...bg.timeline.map((e, i) => `zeit${i + 1}: ${e.date} – ${e.label} ${ids(e.facts)}`),
    ...bg.actors.map((x, i) => `akteur${i + 1}: ${x.name} (${x.role}): ${x.position} ${ids(x.facts)}`),
    ...(bg.chain.length ? [`kette: ${bg.chain.map(c => `${c.label} ${ids(c.facts)}`).join(' → ')}`] : [])
  ];
  return `BEKANNTE FAKTEN (geprüft)
${known}

QUELLTEXT
<<<
${a.title ? `${a.title}\n\n` : ''}${a.text}
>>>

ZU PRÜFEN
${rows.join('\n')}`;
}

/** Prüfergebnis anwenden: Hintergrund-Fakten korrigieren oder streichen, nicht belegte Grafiken weglassen. */
export function applyBackgroundVerdicts(bg: BackgroundDraft, items: Verdict[], known: number): { background: BackgroundDraft | null; issues: string[]; changed: boolean } {
  const issues: string[] = [];
  let changed = false;
  const next = structuredClone(bg);
  const dropFacts = new Set<string>();
  const dropTime = new Set<number>();
  const dropActor = new Set<number>();
  for (const v of items) {
    if (v.verdict === 'belegt') continue;
    issues.push(`${v.id}: ${v.verdict}${v.problem ? ` – ${v.problem}` : ''}`);
    const fix = v.correction?.trim() || null;
    let m: RegExpExecArray | null;
    if (/^h\d+$/.test(v.id)) {
      const f = next.facts.find(x => x.id === v.id);
      if (!f) continue;
      if (fix) f.text = fix; else dropFacts.add(f.id);
      changed = true;
    } else if ((m = /^zeit(?:leiste)?(\d*)$/.exec(v.id))) {
      if (m[1]) dropTime.add(Number(m[1]) - 1); else next.timeline = [];
    } else if ((m = /^akteure?(\d*)$/.exec(v.id))) {
      if (m[1]) dropActor.add(Number(m[1]) - 1); else next.actors = [];
    } else if (/^kette/.test(v.id)) {
      next.chain = [];
    }
  }
  next.facts = next.facts.filter(f => !dropFacts.has(f.id));
  next.timeline = next.timeline.filter((_, i) => !dropTime.has(i));
  next.actors = next.actors.filter((_, i) => !dropActor.has(i));
  return { background: pruneBackground(next, known), issues, changed };
}

/** Faktencheck des Hintergrunds; nach Korrekturen ein zweites Mal ohne weitere Korrekturen. */
export async function verifyBackground(claude: Claude, a: Article, d: Draft, bg: BackgroundDraft, label: string): Promise<{ background: BackgroundDraft | null; issues: string[] }> {
  const known = d.facts.length;
  const first = await askVerdicts(claude, `Hintergrund prüfen „${label}“`, VERIFY_BACKGROUND_SYSTEM, verifyBackgroundPrompt(a, d, bg));
  const r1 = applyBackgroundVerdicts(bg, first, known);
  if (!r1.background || !r1.changed) return r1;
  const second = await askVerdicts(claude, `Hintergrund nachprüfen „${label}“`, VERIFY_BACKGROUND_SYSTEM, verifyBackgroundPrompt(a, d, r1.background));
  const r2 = applyBackgroundVerdicts(r1.background, second.map(v => ({ ...v, correction: null })), known);
  return { background: r2.background, issues: [...r1.issues, ...r2.issues.map(i => `2. Prüfung: ${i}`)] };
}
