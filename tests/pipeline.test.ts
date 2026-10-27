import { describe, expect, it } from 'vitest';
import themen from '../config/themen.json';
import { buildBriefing, cleanHeadline, type Built } from '../pipeline/assemble';
import { applyVerdicts, type Draft } from '../pipeline/editorial';
import { extractArticle } from '../pipeline/extract';
import { resolvePlace } from '../pipeline/geo';
import { gdeltQuery, mergeCandidates, parseFeed, type Feed } from '../pipeline/sources';
import { escapeXml, wordMarks } from '../pipeline/tts';
import { berlinISO, berlinNow, normalizeUrl, plainText } from '../pipeline/util';
import type { ThemenConfig } from '../src/shared/config';

const cfg = themen as unknown as ThemenConfig;
const feed: Feed = { id: 'x', name: 'Testquelle', url: 'https://example.org/feed', lang: 'de' };

describe('Feeds', () => {
  it('liest RSS 2.0', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>Bundestag beschließt &amp; streitet</title><link>https://example.org/a?utm_source=rss</link>
      <description><![CDATA[<p>Der Bundestag hat&nbsp;heute …</p>]]></description><pubDate>Tue, 27 Oct 2026 18:00:00 +0100</pubDate></item>
      <item><title>Zweiter</title><link>https://example.org/b</link></item></channel></rss>`;
    const items = parseFeed(xml, feed, 'deutschland');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Bundestag beschließt & streitet', teaser: 'Der Bundestag hat heute …', source: 'Testquelle', topic: 'deutschland', published: '2026-10-27T17:00:00.000Z' });
  });

  it('liest Atom und RDF', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">KI &lt;b&gt;Modell&lt;/b&gt;</title>
      <link rel="alternate" href="https://example.org/ki"/><summary>Kurz</summary><published>2026-10-28T05:00:00Z</published></entry></feed>`;
    expect(parseFeed(atom, feed, 'ki-neu')[0]).toMatchObject({ title: 'KI Modell', url: 'https://example.org/ki' });
    const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item><title>DW-Meldung</title><link>https://www.dw.com/x</link><description>Text</description><dc:date>2026-10-28T04:00:00Z</dc:date></item></rdf:RDF>`;
    expect(parseFeed(rdf, feed, 'usa')[0]).toMatchObject({ title: 'DW-Meldung', domain: 'dw.com' });
  });

  it('entfernt Dubletten, zu alte Artikel und begrenzt pro Thema', () => {
    const base = { teaser: '', source: 'Q', domain: 'example.org', lang: 'de', via: 'rss' as const };
    const now = '2026-10-28T05:00:00Z';
    const raw = [
      { ...base, title: 'A', url: 'https://www.example.org/a?utm_source=x', published: now, topic: 'usa' },
      { ...base, title: 'A', url: 'https://example.org/a', published: now, topic: 'nahost' },
      { ...base, title: 'Alt', url: 'https://example.org/alt', published: '2026-10-20T05:00:00Z', topic: 'usa' },
      { ...base, title: 'B', url: 'https://example.org/b', published: now, topic: 'usa' },
      { ...base, title: 'C', url: 'https://example.org/c', published: now, topic: 'usa' }
    ];
    const out = mergeCandidates(raw, { since: new Date('2026-10-27T00:00:00Z'), perTopic: 2, total: 100 });
    expect(out.map(c => c.title)).toEqual(['A', 'B']);
    expect(out[0]!.topics).toEqual(['usa', 'nahost']);
    expect(out.map(c => c.id)).toEqual([1, 2]);
  });

  it('baut GDELT-Abfragen', () => {
    expect(gdeltQuery({ ...cfg.topics[0]!, search: ['Israel', 'Weißes Haus', 'KI'] })).toBe('(Israel OR "Weißes Haus")');
    expect(gdeltQuery({ ...cfg.topics[0]!, search: ['Gaza'] })).toBe('Gaza');
    expect(gdeltQuery({ ...cfg.topics[0]!, search: ['KI'] })).toBeNull();
  });
});

describe('Volltext', () => {
  const para = 'Die Bundesregierung hat am Dienstag ein neues Gesetz beschlossen, das ab Januar gelten soll. '.repeat(14);
  it('holt den Artikeltext und das Datum', () => {
    const html = `<html><head><title>Gesetz beschlossen</title><meta property="article:published_time" content="2026-10-27T16:30:00+01:00"></head>
      <body><nav>Menü</nav><article><h1>Gesetz beschlossen</h1><p>${para}</p><p>${para}</p></article></body></html>`;
    const a = extractArticle(html, 'https://example.org/gesetz');
    expect('error' in a).toBe(false);
    if (!('error' in a)) {
      expect(a.text).toContain('neues Gesetz');
      expect(a.date).toBe('2026-10-27');
    }
  });

  it('erkennt Bezahlschranken und zu kurze Texte', () => {
    const paywall = `<html><body><article><h1>Titel</h1><p>${para.slice(0, 1200)}</p><div>Jetzt weiterlesen mit SPIEGEL+</div></article></body></html>`;
    expect(extractArticle(paywall, 'https://example.org/p')).toEqual({ error: 'Bezahlschranke' });
    expect('error' in extractArticle('<html><body><p>Kurz.</p></body></html>', 'https://example.org/k')).toBe(true);
  });
});

const draft = (): Draft => ({
  usable: true,
  headline: '[Bundestag] beschließt Gesetz',
  brief: 'Der Bundestag hat ein Gesetz beschlossen.',
  figure: { value: 412, decimals: 0, prefix: '', suffix: '', label: 'Ja-Stimmen' },
  lines: [
    { role: 'LAGE', text: 'Der Bundestag hat ein Gesetz beschlossen.', say: null },
    { role: 'LAGE', text: 'Es gilt ab Januar.', say: null },
    { role: 'EINORDNUNG', text: 'Das ist ein historischer Schritt.', say: null }
  ],
  opener: { first: 'Wir starten in Berlin.', mid: 'Blick nach Berlin.', last: 'Zum Schluss nach Berlin.' },
  short: 'neues Gesetz in Berlin',
  place: { label: 'BERLIN', country_iso3: 'DEU', lon: 13.4, lat: 52.52 },
  source_date: '2026-10-27'
});

describe('Faktencheck', () => {
  it('übernimmt Korrekturen und streicht Unbelegtes', () => {
    const r = applyVerdicts(draft(), [
      { id: 'headline', verdict: 'belegt', problem: null, correction: null },
      { id: 'figure', verdict: 'nicht_belegt', problem: 'Zahl fehlt im Text', correction: null },
      { id: 'line2', verdict: 'teilweise', problem: 'Datum falsch', correction: 'Es gilt ab Februar.' },
      { id: 'line3', verdict: 'nicht_belegt', problem: 'Wertung', correction: null }
    ]);
    expect(r.draft?.figure).toBeNull();
    expect(r.draft?.lines.map(l => l.text)).toEqual(['Der Bundestag hat ein Gesetz beschlossen.', 'Es gilt ab Februar.']);
    expect(r.issues).toHaveLength(3);
    expect(r.changed).toBe(true);
  });

  it('verwirft die Meldung, wenn die Headline nicht belegt ist', () => {
    expect(applyVerdicts(draft(), [{ id: 'headline', verdict: 'nicht_belegt', problem: 'x', correction: null }]).draft).toBeNull();
  });

  it('verwirft die Meldung bei weniger als zwei belegten Zeilen', () => {
    const r = applyVerdicts(draft(), ['line1', 'line2'].map(id => ({ id, verdict: 'nicht_belegt' as const, problem: 'x', correction: null })));
    expect(r.draft).toBeNull();
  });
});

describe('Montage', () => {
  it('repariert Akzent-Klammern', () => {
    expect(cleanHeadline('[Israel] wählt mit [Rekord]beteiligung')).toBe('[Israel] wählt mit [Rekord]beteiligung');
    expect(cleanHeadline('[[Israel]] wählt [a] [b] [c]')).toBe('[Israel] wählt [a] b c');
    expect(cleanHeadline('[Offen bleibt')).toBe('[Offen bleibt]');
    expect(cleanHeadline('Ohne ] Klammer')).toBe('Ohne Klammer');
  });

  it('baut ein Tages-Update im App-Schema', () => {
    const topic = cfg.topics.find(t => t.id === 'deutschland')!;
    const mk = (rel: number, short: string): Built => ({
      sel: { topic: 'deutschland', articles: [1], relevance: rel, reason: 'Grund', working_title: short },
      topic,
      article: { url: 'https://example.org/a', title: 'T', text: 'x', date: '2026-10-27', siteName: null },
      sourceName: 'tagesschau',
      published: '2026-10-27T10:00:00Z',
      draft: { ...draft(), short },
      place: resolvePlace('DEU', 13.4, 52.52)!
    });
    const b = buildBriefing('2026-10-28', '2026-10-28T07:00:00+01:00', cfg, [mk(3, 'b-meldung'), mk(5, 'a-meldung'), mk(4, 'c-meldung')], { model: 'test', costUsd: 0 });
    expect(b.stories.map(s => s.relevance)).toEqual([5, 4, 3]);
    expect(b.stories[0]!.opener.text).toBe('Wir starten in Berlin.');
    expect(b.stories[2]!.opener.text).toBe('Zum Schluss nach Berlin.');
    expect(b.intro.morning.text).toBe('Guten Morgen. Hier ist dein Lagebild für Mittwoch, den 28. Oktober. Heute: drei Meldungen.');
    expect(b.outro[0]!.text).toBe('Das war dein Update: a-meldung, c-meldung und b-meldung.');
    expect(b.categories.map(c => c.id)).toEqual(['deutschland']);
    expect(new Set(b.stories.map(s => s.id)).size).toBe(3);
    expect(b.stories[0]!.source).toMatchObject({ name: 'tagesschau', date: '2026-10-27' });
  });
});

describe('Helfer', () => {
  it('rechnet Berliner Zeit', () => {
    expect(berlinNow(new Date('2026-10-28T05:30:00Z'))).toEqual({ date: '2026-10-28', time: '06:30' });
    expect(berlinNow(new Date('2026-07-01T04:30:00Z'))).toEqual({ date: '2026-07-01', time: '06:30' });
    expect(berlinISO(new Date('2026-10-28T06:04:30Z'))).toBe('2026-10-28T07:04:00+01:00');
    expect(berlinISO(new Date('2026-07-01T05:00:00Z'))).toBe('2026-07-01T07:00:00+02:00');
  });

  it('normalisiert URLs und Text', () => {
    expect(normalizeUrl('https://www.example.org/a/?utm_source=x&id=3#top')).toBe('https://example.org/a/?id=3');
    expect(plainText('<p>A&nbsp;&amp;&#252;</p><script>x()</script>')).toBe('A &ü');
  });

  it('berechnet Wortmarken und maskiert SSML', () => {
    expect(wordMarks([{ end: 0.5, len: 3 }, { end: 1.2, len: 1 }])).toEqual([[0.5, 0.75], [1.2, 1]]);
    expect(escapeXml('S&P <500>')).toBe('S&amp;P &lt;500&gt;');
  });
});

describe('Suchbegriffe', () => {
  it('treffen Wörter, kurze nur ganz', async () => {
    const { termPattern, matchTopics } = await import('../pipeline/sources');
    expect(termPattern('KI').test('Neue KI-Regeln')).toBe(true);
    expect(termPattern('KI').test('Kiel feiert')).toBe(false);
    expect(termPattern('Israel').test('israelische Armee')).toBe(true);
    expect(termPattern('AI Act').test('EU AI Act enters force')).toBe(true);
    expect(termPattern('S&P 500').test('Der S&P 500 steigt')).toBe(true);
    const items = matchTopics([{ title: 'Elektrolyse in Leuna', teaser: '', url: 'https://e.org/1', source: 'Q', domain: 'e.org', published: null, lang: 'de', topic: 'wissen', via: 'rss' }],
      { ...cfg, topics: [...cfg.topics, { id: 'h2', name: 'Wasserstoff', category: 'wissen', priority: 3, active: true, search: ['Elektrolyse'], feeds: [] }] });
    expect(items.map(i => i.topic)).toEqual(['wissen', 'h2']);
  });
});
