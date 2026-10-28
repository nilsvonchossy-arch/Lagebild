// Aus geprüften Fakten, Plan und Drehbuch wird das Tages-Update im Datenschema der App.
import { slugify } from '../src/shared/config.ts';
import type { ThemenConfig, Topic } from '../src/shared/config.ts';
import { closingLines, deadlinePattern, findNumber, introLines, summaryText, TONE_TEXT } from '../src/shared/script.ts';
import { normalizeSymbol } from '../src/shared/symbols.ts';
import { dateParts } from '../src/util.ts';
import type { ArchiveImage, Briefing, Comparison, Deadline, Fact, Format, Line, Markets, Place, Story, Tone } from '../src/shared/types.ts';
import { SCHEMA_VERSION } from '../src/shared/types.ts';
import type { ScriptStory } from './drehbuch.ts';
import type { Draft, Selection } from './editorial.ts';
import type { Article } from './extract.ts';
import type { ResolvedPlace } from './geo.ts';
import type { PlanItem } from './plan.ts';

export interface Built {
  sel: Selection;
  topic: Topic;
  article: Article;
  sourceName: string;
  /** Veröffentlichungszeit laut Feed */
  published: string | null;
  draft: Draft;
  place: ResolvedPlace;
  /** Weitere Orte, geprüft wie der Hauptort */
  places: Place[];
  /** Archivbilder zu den Motiven (Wikimedia Commons), erst nach dem Plan gesucht */
  images?: ArchiveImage[];
}

const NOW = /^(jetzt|heute|aktuell|zuletzt|derzeit)$/i;

/** Vergleich nur, wenn jeder Wert und seine Beschriftung wörtlich in einem geprüften Fakt stehen. */
export function checkComparison(v: Draft['vergleich'], facts: Fact[]): Comparison | null {
  if (!v || v.items.length < 2 || v.items.length > 4) return null;
  const dec = Math.max(0, Math.min(3, v.decimals));
  const ids: string[] = [];
  for (const it of v.items) {
    const label = it.label.trim();
    if (!label || !Number.isFinite(it.value)) return null;
    const f = facts.find(x => findNumber(x.text, it.value, dec) >= 0 && (NOW.test(label) || x.text.toLowerCase().includes(label.toLowerCase())));
    if (!f) return null;
    ids.push(f.id);
  }
  return { label: v.label.trim(), unit: v.unit, dec, items: v.items.map(i => ({ label: i.label.trim(), value: i.value })), facts: [...new Set(ids)] };
}

/** Termin nur, wenn Uhrzeit oder Datum genau so in einem geprüften Fakt stehen. */
export function checkDeadline(t: Draft['termin'], facts: Fact[]): Deadline | null {
  if (!t || !t.label.trim()) return null;
  const time = t.time && /^\d{1,2}:\d{2}$/.test(t.time) ? t.time.padStart(5, '0') : undefined;
  const date = t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : undefined;
  if (!time && !date) return null;
  const ids: string[] = [];
  for (const part of [time ? { time } : null, date ? { date } : null]) {
    if (!part) continue;
    const re = deadlinePattern(part)!;
    const f = facts.find(x => re.test(x.text));
    if (!f) return null;
    ids.push(f.id);
  }
  return { ...(time ? { time } : {}), ...(date ? { date } : {}), label: t.label.trim(), facts: [...new Set(ids)] };
}

/** Eckige Klammern reparieren: nur paarweise, nicht verschachtelt, höchstens zwei Akzente. */
export function cleanHeadline(h: string): string {
  let depth = 0;
  let accents = 0;
  let out = '';
  for (const ch of h.trim()) {
    if (ch === '[') {
      if (depth === 0 && accents < 2) { out += ch; accents++; }
      depth++;
    } else if (ch === ']') {
      if (depth === 1 && out.lastIndexOf('[') > out.lastIndexOf(']')) out += ch;
      depth = Math.max(0, depth - 1);
    } else out += ch;
  }
  if (out.lastIndexOf('[') > out.lastIndexOf(']')) out += ']';
  return out.replace(/\[\s*\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

const isoDate = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Eine geprüfte Meldung im App-Format; Fakten bekommen IDs aus Buchstabe und Nummer (A1, A2 …). */
export function toStory(b: Built, key: string, format: Format, date: string, taken: string[]): Story {
  const d = b.draft;
  const id = slugify(d.short || d.place.label, taken);
  const story: Story = {
    id,
    category: b.topic.category,
    topic: b.topic.name,
    relevance: b.sel.relevance,
    relevanceNote: b.sel.reason,
    format,
    country: b.place.country,
    label: d.place.label.toUpperCase().slice(0, 28),
    flag: b.place.flag,
    lon: b.place.lon,
    lat: b.place.lat,
    zoom: b.place.zoom,
    headline: cleanHeadline(d.headline),
    brief: d.brief.trim(),
    source: {
      name: b.sourceName,
      url: b.article.url,
      date: isoDate(b.article.date) ?? isoDate(d.source_date) ?? isoDate(b.published) ?? date,
      ...(b.article.title ? { title: b.article.title } : {})
    },
    short: d.short.trim(),
    facts: d.facts.map((f, i) => ({ id: `${key}${i + 1}`, text: f.text }))
  };
  if (b.places.length) story.places = b.places;
  story.symbol = normalizeSymbol(d.symbol ?? '', b.topic.category);
  const comparison = checkComparison(d.vergleich, story.facts);
  if (comparison) story.comparison = comparison;
  const deadline = checkDeadline(d.termin, story.facts);
  if (deadline) story.deadline = deadline;
  if (b.images?.length) story.images = b.images;
  if (d.figure && Number.isFinite(d.figure.value)) {
    story.figure = { value: d.figure.value, dec: Math.max(0, Math.min(3, d.figure.decimals)), label: d.figure.label, ...(d.figure.prefix ? { prefix: d.figure.prefix } : {}), ...(d.figure.suffix ? { suffix: d.figure.suffix } : {}) };
  }
  return story;
}

const de = (v: number, dec: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Hinweis fürs Drehbuch: welche Werte und Namen eine Einblendung auslösen. */
export function visualHint(s: Story): string | null {
  const parts: string[] = [];
  const c = s.comparison;
  if (c) parts.push(`Vergleich ${c.label}: ${c.items.map(i => `${i.label} ${de(i.value, c.dec)}${c.unit}`).join(', ')}`);
  const d = s.deadline;
  if (d) {
    const day = d.date ? `${dateParts(d.date).day}. ${dateParts(d.date).monthName}` : '';
    const time = d.time ? (d.time.endsWith(':00') ? `${Number(d.time.slice(0, 2))} Uhr` : `${Number(d.time.slice(0, 2))}:${d.time.slice(3)} Uhr`) : '';
    parts.push(`Termin ${d.label}: ${[day, time].filter(Boolean).join(', ')}`);
  }
  if (s.images?.length) parts.push(`Archivbild bei ${s.images.map(i => `„${i.match}“`).join(', ')}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Was das Drehbuch über eine Meldung wissen muss. */
export function toScriptStory(s: Story, b: Built, key: string, plan: PlanItem): ScriptStory {
  const f = s.figure;
  const num = f ? `${f.prefix ?? ''}${f.value.toLocaleString('de-DE', { minimumFractionDigits: f.dec, maximumFractionDigits: f.dec })}${f.suffix ?? ''} (${f.label})` : null;
  return {
    key,
    id: s.id,
    format: plan.format,
    seconds: plan.seconds,
    topic: s.topic,
    label: s.label,
    places: (s.places ?? []).map(p => p.label),
    figure: num,
    visuals: visualHint(s),
    facts: s.facts.map((x, i) => ({ id: x.id, text: x.text, kind: b.draft.facts[i]?.kind ?? 'detail' }))
  };
}

/** Marktdaten-Block: Frage von LEITUNG, dann die aus den Zahlen gebauten Sätze. */
export function marketBlock(lines: Line[], tone: Tone): Line[] {
  if (!lines.length) return [];
  return [{ role: 'LEITUNG', text: TONE_TEXT[tone].markets, story: 'maerkte', kind: 'frage' }, ...lines];
}

/** Schlagworte der drei wichtigsten Meldungen, in der Reihenfolge der Folge (geprüfte `short`). */
export function topShorts(stories: Story[]): string[] {
  const rank: Record<Format, number> = { aufmacher: 0, meldung: 1, kurz: 2 };
  const top = new Set(
    stories.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.format] - rank[b.s.format] || (b.s.relevance ?? 0) - (a.s.relevance ?? 0) || a.i - b.i).slice(0, 3).map(x => x.s)
  );
  return stories.filter(s => top.has(s)).map(s => s.short);
}

/** Zusammenfassung aus den Schlagworten der drei wichtigsten Meldungen (im Ton „Assistent“ keine, dort kommt die Vorschau zu Beginn). */
export function summaryLine(stories: Story[], tone: Tone): Line | null {
  const text = summaryText(topShorts(stories), tone);
  return text ? { role: 'LEITUNG', text, kind: 'zusammenfassung' } : null;
}

export interface BriefingParts {
  date: string;
  generated: string;
  cfg: ThemenConfig;
  episode: number;
  stories: Story[];
  /** Drehbuch der Meldungen (ohne Märkte, Zusammenfassung und Abschluss) */
  script: Line[];
  markets?: { markets: Markets; lines: Line[] } | null;
  meta: NonNullable<Briefing['meta']>;
}

export function buildBriefing(p: BriefingParts): Briefing {
  const tone = p.cfg.episode.tone;
  const summary = summaryLine(p.stories, tone);
  const usedCats = new Set(p.stories.map(s => s.category));
  if (p.markets) usedCats.add('wirtschaft');
  const name = p.cfg.episode.name;
  const script: Line[] = [
    ...introLines(tone, p.date, topShorts(p.stories), name),
    ...p.script,
    ...(p.markets ? marketBlock(p.markets.lines, tone) : []),
    ...(summary ? [summary] : []),
    ...closingLines(tone, name)
  ];
  return {
    schema: SCHEMA_VERSION,
    date: p.date,
    generated: p.generated,
    episode: p.episode,
    tone,
    categories: p.cfg.categories.filter(c => usedCats.has(c.id)),
    stories: p.stories,
    ...(p.markets ? { markets: p.markets.markets } : {}),
    script,
    meta: p.meta
  };
}
