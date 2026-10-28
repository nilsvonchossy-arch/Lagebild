// Aus geprüften Fakten, Plan und Drehbuch wird das Tages-Update im Datenschema der App.
import { slugify } from '../src/shared/config.ts';
import type { ThemenConfig, Topic } from '../src/shared/config.ts';
import { closingLines, summaryText, TONE_TEXT } from '../src/shared/script.ts';
import type { Briefing, Format, Line, Markets, Place, Story, Tone } from '../src/shared/types.ts';
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
  if (d.figure && Number.isFinite(d.figure.value)) {
    story.figure = { value: d.figure.value, dec: Math.max(0, Math.min(3, d.figure.decimals)), label: d.figure.label, ...(d.figure.prefix ? { prefix: d.figure.prefix } : {}), ...(d.figure.suffix ? { suffix: d.figure.suffix } : {}) };
  }
  return story;
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
    facts: s.facts.map((x, i) => ({ id: x.id, text: x.text, kind: b.draft.facts[i]?.kind ?? 'detail' }))
  };
}

/** Marktdaten-Block: Frage von LEITUNG, dann die aus den Zahlen gebauten Sätze. */
export function marketBlock(lines: Line[], tone: Tone): Line[] {
  if (!lines.length) return [];
  return [{ role: 'LEITUNG', text: TONE_TEXT[tone].markets, story: 'maerkte', kind: 'frage' }, ...lines];
}

/** Zusammenfassung aus den Schlagworten der drei wichtigsten Meldungen, in der Reihenfolge der Folge. */
export function summaryLine(stories: Story[], tone: Tone): Line | null {
  const rank: Record<Format, number> = { aufmacher: 0, meldung: 1, kurz: 2 };
  const top = new Set(
    stories.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.format] - rank[b.s.format] || (b.s.relevance ?? 0) - (a.s.relevance ?? 0) || a.i - b.i).slice(0, 3).map(x => x.s)
  );
  const text = summaryText(stories.filter(s => top.has(s)).map(s => s.short), tone);
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
  const script: Line[] = [
    ...p.script,
    ...(p.markets ? marketBlock(p.markets.lines, tone) : []),
    ...(summary ? [summary] : []),
    ...closingLines(tone)
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
