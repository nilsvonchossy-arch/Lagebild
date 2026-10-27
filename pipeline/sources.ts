// Recherche: RSS/Atom-Feeds der Themen und Stichwortsuche über GDELT (frei, ohne Schlüssel).
import { XMLParser } from 'fast-xml-parser';
import type { ThemenConfig, Topic } from '../src/shared/config.ts';
import { clip, domainOf, fetchText, log, normalizeUrl, plainText, pool, sleep } from './util.ts';

export interface Feed { id: string; name: string; url: string; lang: string }
export interface Quellen { version: 1; feeds: Feed[]; trustedDomains: string[] }

export interface Candidate {
  id: number;
  title: string;
  teaser: string;
  url: string;
  source: string;
  domain: string;
  /** ISO-Zeitpunkt der Veröffentlichung, falls bekannt */
  published: string | null;
  lang: string;
  /** Themen-IDs, über die der Artikel gefunden wurde */
  topics: string[];
  via: 'rss' | 'gdelt';
}

type Raw = Omit<Candidate, 'id' | 'topics'> & { topic: string };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, htmlEntities: true });

const arr = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

function text(x: unknown): string {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (typeof x === 'object' && '#text' in (x as Record<string, unknown>)) return String((x as Record<string, unknown>)['#text']);
  return '';
}

function atomLink(l: unknown): string {
  const links = arr(l as Record<string, string> | Record<string, string>[]);
  const alt = links.find(k => !k['@_rel'] || k['@_rel'] === 'alternate') ?? links[0];
  return alt?.['@_href'] ?? text(l);
}

function toISO(s: string): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** RSS 2.0, RSS 1.0 (RDF) und Atom in eine einheitliche Liste übersetzen. */
export function parseFeed(xml: string, feed: Feed, topic: string): Raw[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const items: Raw[] = [];
  const push = (title: string, link: string, desc: string, date: string): void => {
    const t = plainText(title);
    if (!t || !/^https?:\/\//.test(link)) return;
    items.push({ title: t, teaser: clip(plainText(desc), 260), url: link.trim(), source: feed.name, domain: domainOf(link), published: toISO(date), lang: feed.lang, topic, via: 'rss' });
  };
  if (doc.rss?.channel) {
    for (const it of arr(doc.rss.channel.item)) push(text(it.title), text(it.link) || text(it.guid), text(it.description), text(it.pubDate) || text(it['dc:date']));
  } else if (doc['rdf:RDF']) {
    for (const it of arr(doc['rdf:RDF'].item)) push(text(it.title), text(it.link), text(it.description), text(it['dc:date']));
  } else if (doc.feed) {
    for (const it of arr(doc.feed.entry)) push(text(it.title), atomLink(it.link), text(it.summary) || text(it.content), text(it.published) || text(it.updated));
  }
  return items;
}

export async function fetchFeeds(cfg: ThemenConfig, q: Quellen): Promise<{ items: Raw[]; report: Record<string, string> }> {
  const byId = new Map(q.feeds.map(f => [f.id, f]));
  const jobs: { feed: Feed; topic: string }[] = [];
  for (const t of cfg.topics.filter(x => x.active)) for (const id of t.feeds) { const f = byId.get(id); if (f) jobs.push({ feed: f, topic: t.id }); }
  // Jeden Feed nur einmal laden, auch wenn er zu mehreren Themen gehört
  const cache = new Map<string, Promise<string>>();
  const report: Record<string, string> = {};
  const results = await pool(jobs, 8, async ({ feed, topic }) => {
    if (!cache.has(feed.url)) cache.set(feed.url, fetchText(feed.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' }).then(r => r.text));
    try {
      const items = parseFeed(await cache.get(feed.url)!, feed, topic);
      report[feed.id] = `${items.length} Artikel`;
      return items;
    } catch (e) {
      report[feed.id] = `Fehler: ${(e as Error).message}`;
      return [];
    }
  });
  return { items: results.flat(), report };
}

/**
 * Suchbegriff als Muster, Groß-/Kleinschreibung egal. Kurze Begriffe nur als ganzes Wort
 * („KI“ trifft nicht „Kiel“), ab fünf Zeichen auch mit Endung („Israel“ trifft „israelische“).
 */
export function termPattern(term: string): RegExp {
  const t = term.trim();
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const end = t.length >= 5 ? '' : '(?![\\p{L}\\p{N}])';
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}${end}`, 'iu');
}

/**
 * Suchbegriffe aller aktiven Themen auf sämtliche Feed-Artikel anwenden: Ein Artikel aus einem
 * allgemeinen Feed, der zu einem Thema passt, wird diesem Thema zusätzlich zugeordnet.
 * So wirken eigene Themen auch ohne eigene Feeds und ohne GDELT.
 */
export function matchTopics(items: Raw[], cfg: ThemenConfig): Raw[] {
  const rules = cfg.topics.filter(t => t.active && t.search.length).map(t => ({ id: t.id, res: t.search.map(termPattern) }));
  const extra: Raw[] = [];
  for (const it of items) {
    const hay = `${it.title} ${it.teaser}`;
    for (const r of rules) if (r.id !== it.topic && r.res.some(re => re.test(hay))) extra.push({ ...it, topic: r.id });
  }
  return [...items, ...extra];
}

/** GDELT-Suche mit den Suchbegriffen eines Themas, nur Artikel der letzten 24 Stunden von seriösen Domains. */
export function gdeltQuery(t: Topic): string | null {
  const terms = t.search.map(s => s.replace(/["()]/g, '').trim()).filter(s => s.length >= 3);
  if (!terms.length) return null;
  const parts = terms.map(s => (/\s|-/.test(s) ? `"${s}"` : s));
  return parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`;
}

/**
 * GDELT nur dort, wo die Feeds nicht reichen: Themen ohne eigene Feeds (z. B. selbst angelegte)
 * und Themen mit weniger als `thin` Feed-Artikeln. GDELT drosselt geteilte Server schnell,
 * deshalb mit Abstand und einer Wiederholung.
 */
export async function searchGdelt(cfg: ThemenConfig, q: Quellen, feedCount: Map<string, number>, thin = 6): Promise<{ items: Raw[]; report: Record<string, string> }> {
  const trusted = q.trustedDomains;
  const isTrusted = (d: string): boolean => trusted.some(t => d === t || d.endsWith(`.${t}`));
  const items: Raw[] = [];
  const report: Record<string, string> = {};
  const topics = cfg.topics.filter(t => t.active && t.search.length && (!t.feeds.length || (feedCount.get(t.id) ?? 0) < thin));
  for (const [i, t] of topics.entries()) {
    const query = gdeltQuery(t);
    if (!query) continue;
    if (i > 0) await sleep(8000); // GDELT erlaubt höchstens eine Anfrage pro 5 Sekunden
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=75&timespan=1d&sort=hybridrel`;
    try {
      let body: string;
      try {
        body = (await fetchText(url, { timeoutMs: 20000, accept: 'application/json' })).text;
      } catch (e) {
        if (!/429/.test((e as Error).message)) throw e;
        await sleep(20000);
        body = (await fetchText(url, { timeoutMs: 20000, accept: 'application/json' })).text;
      }
      const data = JSON.parse(body) as { articles?: { url: string; title: string; seendate?: string; domain?: string; language?: string }[] };
      let n = 0;
      for (const a of data.articles ?? []) {
        const domain = (a.domain ?? domainOf(a.url)).replace(/^www\./, '');
        if (!isTrusted(domain)) continue;
        const lang = a.language === 'German' ? 'de' : a.language === 'English' ? 'en' : '';
        if (!lang) continue;
        // seendate: 20261028T061500Z
        const sd = a.seendate?.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z') ?? '';
        items.push({ title: plainText(a.title), teaser: '', url: a.url, source: domain, domain, published: toISO(sd), lang, topic: t.id, via: 'gdelt' });
        n++;
      }
      report[t.id] = `${n} von ${data.articles?.length ?? 0} Treffern`;
    } catch (e) {
      report[t.id] = `Fehler: ${(e as Error).message}`;
    }
  }
  return { items, report };
}

/** Zusammenführen: Dubletten raus, zu alte Artikel raus, pro Thema begrenzen, IDs vergeben. */
export function mergeCandidates(raw: Raw[], opts: { since: Date; perTopic: number; total: number }): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  const byTitle = new Map<string, Candidate>();
  const fresh = raw.filter(r => !r.published || new Date(r.published) >= opts.since);
  // RSS zuerst (hat Teaser und Quellennamen), dann GDELT
  fresh.sort((a, b) => (a.via === b.via ? (b.published ?? '').localeCompare(a.published ?? '') : a.via === 'rss' ? -1 : 1));
  const perTopic = new Map<string, number>();
  const out: Candidate[] = [];
  for (const r of fresh) {
    const key = normalizeUrl(r.url);
    const tkey = r.title.toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim();
    const dup = byUrl.get(key) ?? byTitle.get(tkey);
    if (dup) {
      if (!dup.topics.includes(r.topic)) dup.topics.push(r.topic);
      if (!dup.teaser && r.teaser) dup.teaser = r.teaser;
      continue;
    }
    // pro Thema begrenzen: Feeds bis perTopic, Stichwortsuche bis zur Hälfte davon zusätzlich
    const capKey = `${r.topic}|${r.via}`;
    const count = perTopic.get(capKey) ?? 0;
    if (count >= (r.via === 'rss' ? opts.perTopic : Math.ceil(opts.perTopic / 2))) continue;
    perTopic.set(capKey, count + 1);
    const c: Candidate = { id: 0, title: r.title, teaser: r.teaser, url: r.url, source: r.source, domain: r.domain, published: r.published, lang: r.lang, topics: [r.topic], via: r.via };
    byUrl.set(key, c);
    byTitle.set(tkey, c);
    out.push(c);
  }
  // Bei zu vielen Kandidaten die ältesten weglassen
  const limited = out.length <= opts.total ? out : [...out].sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '')).slice(0, opts.total);
  limited.forEach((c, i) => { c.id = i + 1; });
  log(`Kandidaten: ${raw.length} gefunden, ${fresh.length} aktuell, ${limited.length} nach Dubletten und Begrenzung`);
  return limited;
}
