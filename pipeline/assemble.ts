// Aus geprüften Entwürfen wird das Tages-Update im Datenschema der App.
import { slugify } from '../src/shared/config.ts';
import type { ThemenConfig, Topic } from '../src/shared/config.ts';
import type { Briefing, Line, Story } from '../src/shared/types.ts';
import { SCHEMA_VERSION } from '../src/shared/types.ts';
import { dateParts } from '../src/util.ts';
import type { Draft, Selection } from './editorial.ts';
import type { Article } from './extract.ts';
import type { Place } from './geo.ts';

export interface Built {
  sel: Selection;
  topic: Topic;
  article: Article;
  sourceName: string;
  /** Veröffentlichungszeit laut Feed */
  published: string | null;
  draft: Draft;
  place: Place;
}

const NUMW = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];

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

function opener(d: Draft, pos: 'first' | 'mid' | 'last', label: string): Line {
  let text = d.opener[pos].trim();
  // Überleitungen sind kurz; alles Längere ist kein Übergang mehr, sondern Inhalt
  if (!text || text.split(/\s+/).length > 8) text = pos === 'first' ? `Wir starten in ${label}.` : pos === 'last' ? `Zum Schluss nach ${label}.` : `Blick nach ${label}.`;
  return { role: 'BRIEFING', text };
}

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

export function buildBriefing(date: string, generated: string, cfg: ThemenConfig, built: Built[], meta: { model: string; costUsd: number }): Briefing {
  // Wichtigste Meldung zuerst; bei gleicher Relevanz bleibt die Reihenfolge der Redaktion
  const items = built.map((b, i) => ({ b, i })).sort((x, y) => y.b.sel.relevance - x.b.sel.relevance || x.i - y.i).map(x => x.b);
  const taken: string[] = [];
  const stories: Story[] = items.map((b, i) => {
    const d = b.draft;
    const id = slugify(d.short || d.place.label, taken);
    taken.push(id);
    const pos = i === 0 ? 'first' : i === items.length - 1 ? 'last' : 'mid';
    const story: Story = {
      id,
      category: b.topic.category,
      topic: b.topic.name,
      relevance: b.sel.relevance,
      relevanceNote: b.sel.reason,
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
      opener: opener(d, pos, titleCase(d.place.label)),
      lines: d.lines.map(l => ({ role: l.role, text: l.text.trim(), ...(l.say && l.say.trim() !== l.text.trim() ? { say: l.say.trim() } : {}) }))
    };
    if (d.figure && Number.isFinite(d.figure.value)) {
      story.figure = { value: d.figure.value, dec: Math.max(0, Math.min(3, d.figure.decimals)), label: d.figure.label, ...(d.figure.prefix ? { prefix: d.figure.prefix } : {}), ...(d.figure.suffix ? { suffix: d.figure.suffix } : {}) };
    }
    return story;
  });

  const p = dateParts(date);
  const n = stories.length;
  const today = `Hier ist dein Lagebild für ${p.weekday}, den ${p.day}. ${p.monthName}. Heute: ${NUMW[n] ?? n} ${n === 1 ? 'Meldung' : 'Meldungen'}.`;
  const shorts = stories.map(s => s.short);
  const joined = shorts.length > 1 ? `${shorts.slice(0, -1).join(', ')} und ${shorts[shorts.length - 1]}` : (shorts[0] ?? '');
  const usedCats = new Set(stories.map(s => s.category));

  return {
    schema: SCHEMA_VERSION,
    date,
    generated,
    categories: cfg.categories.filter(c => usedCats.has(c.id)),
    intro: {
      morning: { role: 'BRIEFING', text: `Guten Morgen. ${today}` },
      day: { role: 'BRIEFING', text: `Guten Tag. ${today}` },
      evening: { role: 'BRIEFING', text: `Guten Abend. ${today}` }
    },
    outro: [
      { role: 'BRIEFING', text: n ? `Das war dein Update: ${joined}.` : 'Heute gab es keine Meldung zu deinen Themen.' },
      { role: 'BRIEFING', text: 'Bis morgen.' }
    ],
    stories,
    meta
  };
}
