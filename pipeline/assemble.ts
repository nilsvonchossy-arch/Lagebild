// Aus geprüften Fakten, Plan und Drehbuch wird das Tages-Update im Datenschema der App.
import { slugify } from '../src/shared/config.ts';
import type { ThemenConfig, Topic } from '../src/shared/config.ts';
import { actorPattern, closingLines, deadlinePattern, findNumber, introLines, NOW_DATE, summaryText, TONE_TEXT } from '../src/shared/script.ts';
import { normalizeSymbol } from '../src/shared/symbols.ts';
import { dateParts } from '../src/util.ts';
import type { Actor, ArchiveImage, Briefing, ChainStep, Comparison, Deadline, Fact, Format, Line, Markets, Place, Source, Story, TimelineEntry, Tone } from '../src/shared/types.ts';
import { SCHEMA_VERSION } from '../src/shared/types.ts';
import type { ScriptStory } from './drehbuch.ts';
import { normalizeKind, type BackgroundDraft, type Draft, type Selection } from './editorial.ts';
import type { Article } from './extract.ts';
import type { ResolvedPlace } from './geo.ts';
import { wantsBackground, type PlanItem } from './plan.ts';

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
  /** Geprüfter Hintergrund aus einer zweiten Quelle (oder noch einmal aus der Hauptquelle, sameSource) */
  background?: { article: Article; sourceName: string; published: string | null; sameSource: boolean; draft: BackgroundDraft };
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

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const factsOf = (ids: string[], facts: Fact[]): Fact[] => facts.filter(f => ids.includes(f.id));
const yearOf = (s: string): number | null => { const m = /(?<!\d)(1\d{3}|20\d{2})(?!\d)/.exec(s); return m ? Number(m[1]) : null; };

/**
 * Zeitleiste nur, wenn jede Zeitangabe wörtlich in einem ihrer Fakten steht („heute“ nur als letzter Eintrag)
 * und die Jahreszahlen nicht rückwärts laufen. Einzelne ungültige Einträge fallen weg; bleiben weniger als zwei, keine.
 */
export function checkTimeline(entries: TimelineEntry[] | undefined, facts: Fact[]): TimelineEntry[] | null {
  if (!entries?.length) return null;
  const ok = entries.filter((e, i) => {
    const date = e.date.trim(), label = e.label.trim();
    if (!date || date.length > 24 || !label || label.length > 60) return false;
    const fs = factsOf(e.facts, facts);
    if (!fs.length || fs.length !== e.facts.length) return false;
    if (NOW_DATE.test(date)) return i === entries.length - 1;
    return fs.some(f => squash(f.text).includes(squash(date)));
  }).map(e => ({ date: e.date.trim(), label: e.label.trim(), facts: e.facts })).slice(0, 5);
  if (ok.length < 2) return null;
  const years = ok.map(e => yearOf(e.date)).filter((y): y is number => y !== null);
  if (years.some((y, i) => i > 0 && y < years[i - 1]!)) return null;
  return ok;
}

/** „Wer steht wo“ nur mit Beteiligten, deren Name in einem ihrer Fakten steht; mindestens zwei, höchstens vier. */
export function checkActors(actors: Actor[] | undefined, facts: Fact[]): Actor[] | null {
  if (!actors?.length) return null;
  const seen = new Set<string>();
  const ok = actors.filter(a => {
    const name = a.name.trim();
    if (!name || name.length > 40 || !a.role.trim() || a.role.length > 60 || !a.position.trim() || a.position.length > 120) return false;
    if (seen.has(squash(name))) return false;
    const fs = factsOf(a.facts, facts);
    if (!fs.length || fs.length !== a.facts.length) return false;
    const re = actorPattern(name)!;
    if (!fs.some(f => re.test(f.text))) return false;
    seen.add(squash(name));
    return true;
  }).map(a => ({ name: a.name.trim(), role: a.role.trim(), position: a.position.trim(), facts: a.facts })).slice(0, 4);
  return ok.length >= 2 ? ok : null;
}

/** Ursache-Wirkung-Kette: 2–4 Schritte, jeder mit vorhandenen Fakten; ein ungültiger Schritt bricht die Kette. */
export function checkChain(steps: ChainStep[] | undefined, facts: Fact[]): ChainStep[] | null {
  if (!steps || steps.length < 2 || steps.length > 4) return null;
  for (const s of steps) {
    if (!s.label.trim() || s.label.length > 60 || !s.facts.length || factsOf(s.facts, facts).length !== s.facts.length) return null;
  }
  return steps.map(s => ({ label: s.label.trim(), facts: s.facts }));
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

/**
 * Eine geprüfte Meldung im App-Format; Fakten bekommen IDs aus Buchstabe und Nummer (A1, A2 …).
 * Aufmacher und Fokus mit Relevanz ab 4 bekommen den Hintergrund: dessen Fakten hängen hinten an (Art
 * „hintergrund“, Quelle 1 bei einer zweiten Quelle), dazu Zeitleiste, Akteure und Kette, wenn sie die Prüfung bestehen.
 */
export function toStory(b: Built, key: string, format: Format, date: string, taken: string[]): Story {
  const d = b.draft;
  const id = slugify(d.short || d.place.label, taken);
  const bg = wantsBackground(format, b.sel.relevance) ? b.background : undefined;
  const main: Source = {
    name: b.sourceName,
    url: b.article.url,
    date: isoDate(b.article.date) ?? isoDate(d.source_date) ?? isoDate(b.published) ?? date,
    ...(b.article.title ? { title: b.article.title } : {})
  };
  const sources: Source[] = [main];
  if (bg && !bg.sameSource) {
    sources.push({
      name: bg.sourceName,
      url: bg.article.url,
      date: isoDate(bg.article.date) ?? isoDate(bg.published) ?? date,
      ...(bg.article.title ? { title: bg.article.title } : {})
    });
  }
  const facts: Fact[] = d.facts.map((f, i) => ({ id: `${key}${i + 1}`, text: f.text, kind: normalizeKind(f.kind), source: 0 }));
  // Verweise des Hintergrunds (f1 …, h1 …) auf die endgültigen IDs umschreiben
  const ref = new Map(d.facts.map((_, i) => [`f${i + 1}`, `${key}${i + 1}`]));
  for (const f of bg?.draft.facts ?? []) {
    const fid = `${key}${facts.length + 1}`;
    facts.push({ id: fid, text: f.text, kind: 'hintergrund', source: sources.length - 1 });
    ref.set(f.id, fid);
  }
  const refs = (r: string[]): string[] => r.map(x => ref.get(x) ?? '').filter(Boolean);
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
    source: main,
    sources,
    short: d.short.trim(),
    facts
  };
  if (d.enthuellung) story.investigative = true;
  const bgIds = facts.filter(f => f.kind === 'hintergrund').map(f => f.id);
  if (wantsBackground(format, b.sel.relevance) && bgIds.length) story.background = { facts: bgIds };
  if (bg) {
    const timeline = checkTimeline(bg.draft.timeline.map(e => ({ ...e, facts: refs(e.facts) })), facts);
    if (timeline) story.timeline = timeline;
    const actors = checkActors(bg.draft.actors.map(a => ({ ...a, facts: refs(a.facts) })), facts);
    if (actors) story.actors = actors;
    const chain = checkChain(bg.draft.chain.map(c => ({ ...c, facts: refs(c.facts) })), facts);
    if (chain) story.chain = chain;
  }
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
  const tl = s.timeline?.filter(e => !NOW_DATE.test(e.date));
  if (tl?.length) parts.push(`Zeitleiste Vorgeschichte bei ${tl.map(e => `„${e.date}“`).join(', ')}`);
  if (s.actors?.length) parts.push(`„Wer steht wo“ bei ${s.actors.map(a => `„${a.name}“`).join(', ')}`);
  if (s.chain?.length) parts.push(`Ursache und Wirkung mit ${s.chain.map(c => c.facts.join('+')).join(' → ')}`);
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
    ...(s.investigative ? { investigative: true } : {}),
    facts: s.facts.map((x, i) => {
      const src = x.source ? s.sources?.[x.source]?.name : undefined;
      return { id: x.id, text: x.text, kind: x.kind ?? b.draft.facts[i]?.kind ?? 'detail', ...(src ? { source: src } : {}) };
    })
  };
}

/** Marktdaten-Block: Frage von LEITUNG, dann die aus den Zahlen gebauten Sätze. */
export function marketBlock(lines: Line[], tone: Tone): Line[] {
  if (!lines.length) return [];
  return [{ role: 'LEITUNG', text: TONE_TEXT[tone].markets, story: 'maerkte', kind: 'frage' }, ...lines];
}

/** Schlagworte der drei wichtigsten Meldungen, in der Reihenfolge der Folge (geprüfte `short`). */
export function topShorts(stories: Story[]): string[] {
  const rank: Record<Format, number> = { aufmacher: 0, fokus: 0, meldung: 1, kurz: 2 };
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
