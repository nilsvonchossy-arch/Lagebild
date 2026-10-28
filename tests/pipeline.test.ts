import { describe, expect, it } from 'vitest';
import themen from '../config/themen.json';
import { buildBriefing, checkComparison, checkDeadline, cleanHeadline, summaryLine, toScriptStory, toStory, type Built } from '../pipeline/assemble';
import { freeLicense, matchWord, nameKey, plain, resolveImages } from '../pipeline/bilder';
import { applyLineVerdicts, cleanDraft, fillGaps, normalizeLineVerdict, simpleLines, tidy, type ScriptStory } from '../pipeline/drehbuch';
import { applyVerdicts, type Draft } from '../pipeline/editorial';
import { extractArticle } from '../pipeline/extract';
import { resolveExtraPlace, resolvePlace } from '../pipeline/geo';
import { layoutLines, levelGain, musicBed, parseWav, trimBounds, wavBytes, type Clip } from '../pipeline/mix';
import { planEpisode, targetSeconds, wantedStories, type PlanInput } from '../pipeline/plan';
import { gdeltQuery, mergeCandidates, parseFeed, type Feed } from '../pipeline/sources';
import { escapeXml, wordMarks } from '../pipeline/tts';
import { earliestStart, readClips, styleFor, voxcpmJob, type VoxcpmConfig } from '../pipeline/tts-voxcpm';
import { berlinISO, berlinNow, normalizeUrl, plainText } from '../pipeline/util';
import { migrateConfig } from '../src/shared/config';
import { normalizeSymbol } from '../src/shared/symbols';
import type { Line } from '../src/shared/types';

const cfg = migrateConfig(themen);
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
  facts: [
    { text: 'Der Bundestag hat ein Gesetz beschlossen.', kind: 'kern' },
    { text: 'Es gilt ab Januar.', kind: 'detail' },
    { text: 'Das ist ein historischer Schritt.', kind: 'hintergrund' }
  ],
  headline: '[Bundestag] beschließt Gesetz',
  brief: 'Der Bundestag hat ein Gesetz beschlossen.',
  figure: { value: 412, decimals: 0, prefix: '', suffix: '', label: 'Ja-Stimmen' },
  short: 'neues Gesetz in Berlin',
  place: { label: 'BERLIN', country_iso3: 'DEU', lon: 13.4, lat: 52.52 },
  places: [],
  source_date: '2026-10-27',
  vergleich: { label: 'Ja-Stimmen', unit: '', decimals: 0, items: [{ label: 'jetzt', value: 412 }, { label: '2020', value: 380 }] },
  termin: null,
  symbol: 'parlament',
  motive: []
});

describe('Faktencheck', () => {
  it('übernimmt Korrekturen und streicht Unbelegtes', () => {
    const r = applyVerdicts(draft(), [
      { id: 'headline', verdict: 'belegt', problem: null, correction: null },
      { id: 'figure', verdict: 'nicht_belegt', problem: 'Zahl fehlt im Text', correction: null },
      { id: 'vergleich', verdict: 'teilweise', problem: 'Wert 2020 fehlt', correction: null },
      { id: 'f2', verdict: 'teilweise', problem: 'Datum falsch', correction: 'Es gilt ab Februar.' },
      { id: 'f3', verdict: 'nicht_belegt', problem: 'Wertung', correction: null }
    ]);
    expect(r.draft?.figure).toBeNull();
    expect(r.draft?.vergleich).toBeNull();
    expect(r.draft?.facts.map(f => f.text)).toEqual(['Der Bundestag hat ein Gesetz beschlossen.', 'Es gilt ab Februar.']);
    expect(r.issues).toHaveLength(4);
    expect(r.changed).toBe(true);
  });

  it('verwirft die Meldung, wenn die Headline nicht belegt ist', () => {
    expect(applyVerdicts(draft(), [{ id: 'headline', verdict: 'nicht_belegt', problem: 'x', correction: null }]).draft).toBeNull();
  });

  it('verwirft die Meldung bei weniger als zwei belegten Fakten', () => {
    const r = applyVerdicts(draft(), ['f1', 'f2'].map(id => ({ id, verdict: 'nicht_belegt' as const, problem: 'x', correction: null })));
    expect(r.draft).toBeNull();
  });
});

describe('Einblendungen', () => {
  const facts = [
    { id: 'A1', text: 'Bis 16 Uhr haben 55,7 Prozent der Wahlberechtigten abgestimmt.' },
    { id: 'A2', text: '2022 lag die Beteiligung zur selben Zeit bei 47,5 Prozent.' },
    { id: 'A3', text: 'Die Wahllokale schließen um 22 Uhr Ortszeit.' },
    { id: 'A4', text: 'Die neuen Geräte kommen ab dem 6. November in den Handel.' }
  ];

  it('nimmt einen Vergleich nur, wenn Werte und Beschriftungen in den Fakten stehen', () => {
    const ok = checkComparison({ label: 'Wahlbeteiligung', unit: ' %', decimals: 1, items: [{ label: '16 Uhr', value: 55.7 }, { label: '2022', value: 47.5 }] }, facts);
    expect(ok).toEqual({ label: 'Wahlbeteiligung', unit: ' %', dec: 1, items: [{ label: '16 Uhr', value: 55.7 }, { label: '2022', value: 47.5 }], facts: ['A1', 'A2'] });
    // falscher Wert, falsche Beschriftung, nur ein Wert
    expect(checkComparison({ label: 'x', unit: ' %', decimals: 1, items: [{ label: '16 Uhr', value: 55.7 }, { label: '2022', value: 45.1 }] }, facts)).toBeNull();
    expect(checkComparison({ label: 'x', unit: ' %', decimals: 1, items: [{ label: '16 Uhr', value: 55.7 }, { label: '2018', value: 47.5 }] }, facts)).toBeNull();
    expect(checkComparison({ label: 'x', unit: ' %', decimals: 1, items: [{ label: 'jetzt', value: 55.7 }] }, facts)).toBeNull();
  });

  it('nimmt einen Termin nur, wenn Uhrzeit oder Datum in einem Fakt stehen', () => {
    expect(checkDeadline({ time: '22:00', date: null, label: 'Wahllokale schließen' }, facts)).toEqual({ time: '22:00', label: 'Wahllokale schließen', facts: ['A3'] });
    expect(checkDeadline({ time: null, date: '2026-11-06', label: 'Marktstart' }, facts)).toEqual({ date: '2026-11-06', label: 'Marktstart', facts: ['A4'] });
    expect(checkDeadline({ time: '21:00', date: null, label: 'x' }, facts)).toBeNull();
    expect(checkDeadline({ time: 'abends', date: null, label: 'x' }, facts)).toBeNull();
  });

  it('ordnet Symbole zu und fällt sonst auf die Kategorie zurück', () => {
    expect(normalizeSymbol('Börse', 'ki')).toBe('boerse');
    expect(normalizeSymbol('wahl.', 'ki')).toBe('wahl');
    expect(normalizeSymbol('Gesundheit', 'ki')).toBe('medizin');
    expect(normalizeSymbol('Vulkan', 'wissen')).toBe('forschung');
  });
});

describe('Archivbilder', () => {
  it('erkennt freie Lizenzen und bereinigt Urheberangaben', () => {
    for (const l of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'CC BY-SA 3.0 de']) expect(freeLicense(l)).toBe(true);
    for (const l of ['Fair use', 'All rights reserved', '', 'Copyrighted free use']) expect(freeLicense(l)).toBe(false);
    expect(plain('<a href="//x">Jane&nbsp;Doe</a> (<span>Flickr</span>)')).toBe('Jane Doe ( Flickr )');
    expect(matchWord({ name: 'Gadi Eisenkot', art: 'person', suche: 'Gadi Eisenkot' })).toBe('Eisenkot');
    expect(matchWord({ name: 'Kundl', art: 'ort', suche: 'Kundl' })).toBe('Kundl');
  });

  it('sucht über Wikidata, nimmt bei Personen nur Menschen und speichert das Vorschaubild', async () => {
    const { mkdtempSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const out = mkdtempSync(join(tmpdir(), 'lagebild-bild-'));
    const res = (body: unknown, type = 'application/json'): Response => new Response(body instanceof Blob ? body : JSON.stringify(body), { headers: { 'content-type': type } });
    const calls: string[] = [];
    const fake = async (url: string): Promise<Response> => {
      calls.push(url);
      if (url.includes('wbsearchentities')) return res({ search: [{ id: 'Q1', label: 'Gadi Eisenkot', match: { type: 'label', text: 'Gadi Eisenkot' } }, { id: 'Q2', label: 'Gadi Eizenkot', match: { type: 'alias', text: 'Gadi Eisenkot' } }, { id: 'Q3', label: 'Israelische Armee', match: { type: 'description', text: 'Gadi Eisenkot' } }] });
      if (url.includes('wbgetentities')) return res({ entities: {
        // Q1: gleichnamiges Schiff, Q2: der Mensch
        Q1: { labels: { de: { value: 'Eisenkot (Schiff)' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11446' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Schiff.jpg' } } }] } },
        Q2: { labels: { de: { value: 'Gadi Eizenkot' }, en: { value: 'Gadi Eisenkot' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Gadi Eisenkot 2015.jpg' } } }] } }
      } });
      if (url.includes('commons.wikimedia.org/w/api.php')) {
        expect(url).toContain(encodeURIComponent('File:Gadi Eisenkot 2015.jpg'));
        return res({ query: { pages: { '1': { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/960px-G.jpg', thumbwidth: 960, thumbheight: 1200, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Gadi_Eisenkot_2015.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' }, Artist: { value: '<a href="x">IDF Spokesperson</a>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' } } }] } } } });
      }
      return res(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]), 'image/jpeg');
    };
    const issues: string[] = [];
    const imgs = await resolveImages([{ name: 'Eisenkot', art: 'person', suche: 'Gadi Eisenkot' }], out, 'bilder/2026-10-28', issues, fake);
    expect(issues).toEqual([]);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ motif: 'Gadi Eisenkot', match: 'Eisenkot', author: 'IDF Spokesperson', license: 'CC BY-SA 3.0', w: 960, h: 1200, page: 'https://commons.wikimedia.org/wiki/File:Gadi_Eisenkot_2015.jpg' });
    expect(imgs[0]!.src).toMatch(/^bilder\/2026-10-28\/[0-9a-f]{12}\.jpg$/);
    expect(existsSync(join(out, imgs[0]!.src))).toBe(true);
    expect(calls.every(u => !/vonchossy\.eu/.test(u))).toBe(true);
  });

  it('nimmt kein Bild eines anderen Eintrags, wenn der Name nicht genau passt', async () => {
    // „Sandoz“ ist bei Wikidata ein Alias von Novartis (mit Bild); das darf nicht als Sandoz erscheinen
    const fake = async (url: string): Promise<Response> => new Response(JSON.stringify(
      url.includes('wbsearchentities') ? { search: [{ id: 'Q7' }] }
        : { entities: { Q7: { labels: { de: { value: 'Novartis' }, en: { value: 'Novartis' } }, aliases: { de: [{ value: 'Sandoz' }] }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q4830453' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Novartis.jpg' } } }] } } } }
    ));
    const issues: string[] = [];
    expect(await resolveImages([{ name: 'Sandoz', art: 'organisation', suche: 'Sandoz' }], '/tmp', 'bilder/x', issues, fake)).toEqual([]);
    expect(issues[0]).toContain('kein Wikidata-Eintrag');
    expect(nameKey('Gadí  Eisenkot')).toBe(nameKey('gadi eisenkot'));
    expect(plain('\u202bיהב טרודלר\u202c')).toBe('יהב טרודלר');
  });

  it('lässt Bilder ohne freie Lizenz weg und protokolliert den Grund', async () => {
    const fake = async (url: string): Promise<Response> => new Response(JSON.stringify(
      url.includes('wbsearchentities') ? { search: [{ id: 'Q9', label: 'Sandoz' }] }
        : url.includes('wbgetentities') ? { entities: { Q9: { labels: { de: { value: 'Sandoz' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q4830453' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Logo.png' } } }] } } } }
          : { query: { pages: { '1': { imageinfo: [{ thumburl: 'https://u/x.png', descriptionurl: 'https://c/File:Logo.png', extmetadata: { LicenseShortName: { value: 'Fair use' } } }] } } } }
    ));
    const issues: string[] = [];
    expect(await resolveImages([{ name: 'Sandoz', art: 'organisation', suche: 'Sandoz' }], '/tmp', 'bilder/x', issues, fake)).toEqual([]);
    expect(issues[0]).toContain('Lizenz nicht frei');
  });
});

describe('Plan der Folge', () => {
  const item = (relevance: number, weight: PlanInput['weight'], facts: number, lon: number, lat: number): PlanInput => ({ relevance, weight, facts, lon, lat });

  it('macht die wichtigste Meldung mit genug Stoff zum Aufmacher', () => {
    const p = planEpisode([item(3, 'normal', 6, 13, 52), item(5, 'ausfuehrlich', 2, 35, 31), item(5, 'ausfuehrlich', 8, 35, 31)], 3, false);
    expect(p.items[0]).toMatchObject({ index: 2, format: 'aufmacher' });
    // zu wenig Fakten: nur kurz notiert
    expect(p.items.find(x => x.index === 1)?.format).toBe('kurz');
  });

  it('setzt „nur kurz“-Themen ans Ende und verteilt die Zeit nach Länge', () => {
    const input = [item(5, 'normal', 8, 35, 31), item(4, 'kurz', 6, 2, 49), item(4, 'normal', 5, 12, 47), item(3, 'normal', 5, -74, 41)];
    const p = planEpisode(input, 3, true);
    expect(p.items.map(x => x.format)).toEqual(['aufmacher', 'meldung', 'meldung', 'kurz']);
    expect(p.items[p.items.length - 1]!.index).toBe(1);
    const sum = p.items.reduce((n, x) => n + x.seconds, 0);
    expect(sum).toBeLessThanOrEqual(180);
  });

  it('fährt eine Route statt hin und her zu springen', () => {
    // Aufmacher Israel, dann Tirol, Paris, New York, Kalifornien (nicht nach Relevanz durcheinander)
    const input = [item(5, 'ausfuehrlich', 8, 35, 31), item(3, 'normal', 5, -122, 37), item(3, 'normal', 5, 12, 47), item(3, 'normal', 5, -74, 41), item(3, 'normal', 5, 2, 49)];
    const p = planEpisode(input, 8, false);
    expect(p.items.map(x => x.index)).toEqual([0, 2, 4, 3, 1]);
  });

  it('lässt Meldungen weg, wenn die Zeit nicht reicht', () => {
    const input = Array.from({ length: 12 }, (_, i) => item(3, 'normal', 6, i * 10, 0));
    const p = planEpisode(input, 3, true);
    expect(p.dropped.length).toBeGreaterThan(0);
    expect(p.items.length + p.dropped.length).toBe(12);
  });

  it('kürzt, wenn die Quelle wenig hergibt', () => {
    expect(targetSeconds('aufmacher', item(5, 'ausfuehrlich', 9, 0, 0))).toBe(45);
    expect(targetSeconds('aufmacher', item(5, 'ausfuehrlich', 3, 0, 0))).toBeLessThan(30);
    expect(targetSeconds('meldung', item(3, 'normal', 2, 0, 0))).toBeLessThan(20);
    expect(wantedStories(3)).toBeLessThan(wantedStories(8));
  });
});

const sstory = (key: string, format: ScriptStory['format'], n = 4): ScriptStory => ({
  key, id: `s-${key.toLowerCase()}`, format, seconds: 20, topic: 'T', label: 'ORT', places: [], figure: null,
  facts: Array.from({ length: n }, (_, i) => ({ id: `${key}${i + 1}`, text: `Fakt ${key}${i + 1}.`, kind: i === 0 ? 'kern' : i === 2 ? 'vorbehalt' : 'detail' }))
});

describe('Drehbuch', () => {
  const stories = [sstory('A', 'aufmacher'), sstory('B', 'meldung'), sstory('C', 'kurz'), sstory('D', 'kurz')];

  it('räumt die Antwort auf: Rollen, fremde Fakten, Reihenfolge, Begrüßung', () => {
    const raw = [
      { role: 'Leitung', story: 'A', text: 'Guten Morgen und willkommen!', say: null, facts: [] },
      { role: 'LAGE', story: 'A', text: 'LAGE: Kernaussage A.', say: null, facts: ['A1', 'B2'], mood: 'Überrascht' },
      { role: 'leitung', story: 'C', text: 'Und sonst?', say: null, facts: [] },
      { role: 'Lage', story: 'C', text: 'Kurz C.', say: 'Kurz C.', facts: ['c1'] },
      { role: 'LEITUNG', story: 'B', text: 'Und dann?', say: null, facts: [] },
      { role: 'Einordnung', story: 'B', text: 'Einordnung B.', say: null, facts: ['B3'] },
      { role: 'LAGE', story: 'X', text: 'Unbekannt.', say: null, facts: [] }
    ].map(l => ({ mood: 'wütend', ...l }));
    const r = cleanDraft(raw, stories);
    expect(r.lines.map(l => `${l.key}:${l.role}:${l.text}`)).toEqual(['A:LAGE:Kernaussage A.', 'B:LEITUNG:Und dann?', 'B:EINORDNUNG:Einordnung B.', 'C:LEITUNG:Und sonst?', 'C:LAGE:Kurz C.']);
    expect(r.lines[0]!.facts).toEqual(['A1']);
    expect(r.lines.map(l => l.mood)).toEqual(['ueberrascht', 'neutral', 'neutral', 'neutral', 'neutral']);
    expect(r.lines[4]!.facts).toEqual(['C1']);
    expect(r.lines[4]!.say).toBeNull();
    expect(r.issues.some(i => i.includes('Begrüßung'))).toBe(true);
    expect(r.issues.some(i => i.includes('Reihenfolge'))).toBe(true);
  });

  it('streicht Fragen ohne Antwort', () => {
    const L = (key: string, role: 'LEITUNG' | 'LAGE', text: string) => ({ key, role, text, say: null, facts: role === 'LAGE' ? [`${key}1`] : [] });
    expect(tidy([L('A', 'LEITUNG', 'Frage?'), L('A', 'LAGE', 'a'), L('A', 'LEITUNG', 'Wie viele?'), L('B', 'LEITUNG', 'Und?'), L('B', 'LAGE', 'b'), L('B', 'LEITUNG', 'Noch was?')]).map(l => l.text)).toEqual(['a', 'Und?', 'b']);
  });

  it('wendet die Prüfung an: korrigieren, streichen, ungeprüft', () => {
    const lines = [0, 1, 2, 3].map(i => ({ role: 'LAGE' as const, key: 'A', text: `Zeile ${i}`, say: 'x', facts: ['A1'] }));
    const r = applyLineVerdicts(lines, [
      { nr: 1, verdict: 'ok', problem: null, correction: null },
      { nr: 2, verdict: 'korrigieren', problem: 'Ortszeit ergänzt', correction: 'Zeile 1 neu' },
      { nr: 3, verdict: 'streichen', problem: 'Wertung', correction: null }
    ]);
    expect(r.lines.map(l => l.text)).toEqual(['Zeile 0', 'Zeile 1 neu', 'Zeile 3']);
    expect(r.lines[1]!.say).toBeNull();
    // korrigierte und ungeprüfte Zeilen kommen in die zweite Runde
    expect([...r.touched].sort()).toEqual([1, 2]);
    const second = applyLineVerdicts(r.lines, [{ nr: 2, verdict: 'korrigieren', problem: 'noch falsch', correction: 'nochmal' }], r.touched);
    expect(second.lines.map(l => l.text)).toEqual(['Zeile 0']);
    expect(normalizeLineVerdict('OK')).toBe('ok');
    expect(normalizeLineVerdict('Korrigieren')).toBe('korrigieren');
    expect(normalizeLineVerdict('???')).toBe('streichen');
  });

  it('baut eine einfache Fassung nur aus geprüften Fakten', () => {
    const lines = simpleLines(stories, 'lagezentrum');
    expect(lines[0]).toMatchObject({ role: 'LAGE', key: 'A', text: 'Fakt A1.' });
    expect(lines.filter(l => l.role !== 'LEITUNG').every(l => l.facts.length === 1 && l.text === `Fakt ${l.facts[0]}.`)).toBe(true);
    // Vorbehalte spricht EINORDNUNG, „Kurz notiert“ bekommt eine einzige Frage
    expect(lines.find(l => l.text === 'Fakt A3.')?.role).toBe('EINORDNUNG');
    expect(lines.filter(l => l.role === 'LEITUNG').map(l => `${l.key}:${l.text}`)).toEqual(['B:Weiter.', 'C:Was noch?']);
  });

  it('ersetzt fehlende Meldungen durch die einfache Fassung', () => {
    const only = simpleLines(stories, 'podcast').filter(l => l.key !== 'B');
    const r = fillGaps(only, stories, 'podcast');
    expect(r.filled).toEqual(['B']);
    expect(r.lines.map(l => l.key)).toEqual([...r.lines.map(l => l.key)].sort());
  });
});

describe('Montage', () => {
  it('repariert Akzent-Klammern', () => {
    expect(cleanHeadline('[Israel] wählt mit [Rekord]beteiligung')).toBe('[Israel] wählt mit [Rekord]beteiligung');
    expect(cleanHeadline('[[Israel]] wählt [a] [b] [c]')).toBe('[Israel] wählt [a] b c');
    expect(cleanHeadline('[Offen bleibt')).toBe('[Offen bleibt]');
    expect(cleanHeadline('Ohne ] Klammer')).toBe('Ohne Klammer');
  });

  it('baut eine Folge im App-Schema', () => {
    const topic = cfg.topics.find(t => t.id === 'deutschland')!;
    const mk = (rel: number, short: string): Built => ({
      sel: { topic: 'deutschland', articles: [1], relevance: rel, reason: 'Grund', working_title: short },
      topic,
      article: { url: 'https://example.org/a', title: 'T', text: 'x', date: '2026-10-27', siteName: null },
      sourceName: 'tagesschau',
      published: '2026-10-27T10:00:00Z',
      draft: { ...draft(), short },
      place: resolvePlace('DEU', 13.4, 52.52)!,
      places: []
    });
    const built = [mk(5, 'a-meldung'), mk(4, 'b-meldung'), mk(3, 'c-meldung')];
    const taken: string[] = [];
    const stories = built.map((b, i) => { const s = toStory(b, 'ABC'[i]!, i ? 'meldung' : 'aufmacher', '2026-10-28', taken); taken.push(s.id); return s; });
    expect(stories[0]!.facts.map(f => f.id)).toEqual(['A1', 'A2', 'A3']);
    expect(new Set(stories.map(s => s.id)).size).toBe(3);
    const ss = toScriptStory(stories[0]!, built[0]!, 'A', { index: 0, format: 'aufmacher', seconds: 38 });
    expect(ss.figure).toBe('412 (Ja-Stimmen)');
    expect(ss.facts[0]).toEqual({ id: 'A1', text: 'Der Bundestag hat ein Gesetz beschlossen.', kind: 'kern' });
    const script: Line[] = [{ role: 'LAGE', text: 'x', story: stories[0]!.id, kind: 'fakt', facts: ['A1'] }];
    const markets = { markets: { asOf: '2026-10-27', source: { name: 'Y', url: 'https://y', date: '2026-10-27' }, items: [] }, lines: [{ role: 'LAGE' as const, text: 'DAX.', story: 'maerkte', kind: 'fakt' as const }] };
    const b = buildBriefing({ date: '2026-10-28', generated: 'jetzt', cfg, episode: 7, stories, script, markets, meta: { model: 'test', costUsd: 0, script: 'claude' } });
    expect(b.schema).toBe(2);
    expect(b.episode).toBe(7);
    // Ton „Assistent“ (Voreinstellung): Begrüßung mit Datum und Vorschau, keine Zusammenfassung am Ende
    expect(b.script.map(l => l.kind)).toEqual(['begruessung', 'begruessung', 'fakt', 'frage', 'fakt', 'abschluss', 'abschluss']);
    expect(b.script.slice(0, 2).map(l => l.text)).toEqual(['Guten Morgen! Heute ist Mittwoch, der 28. Oktober.', "Ich hab dir das Wichtigste rausgesucht: a-meldung, b-meldung und c-meldung. Los geht's."]);
    expect(b.script.slice(0, 2).every(l => l.role === 'LEITUNG' && !l.story)).toBe(true);
    expect(b.script.at(-2)!.text).toBe("Das war's für heute. Ich halt dich auf dem Laufenden.");
    expect(b.categories.map(c => c.id).sort()).toEqual(['deutschland', 'wirtschaft']);
    // mit Namen
    const named = buildBriefing({ date: '2026-11-02', generated: 'jetzt', cfg: { ...cfg, episode: { ...cfg.episode, name: 'Alex' } }, episode: 8, stories, script, markets: null, meta: { model: 'test', costUsd: 0 } });
    expect(named.script[0]!.text).toBe('Guten Morgen, Alex, und einen guten Start in die Woche! Heute ist Montag, der 2. November.');
    expect(named.script.at(-2)!.text).toBe("Das war's für heute, Alex. Ich halt dich auf dem Laufenden.");
    // Lagezentrum: ohne Gruß, mit Zusammenfassung
    const lz = buildBriefing({ date: '2026-10-28', generated: 'jetzt', cfg: { ...cfg, episode: { ...cfg.episode, tone: 'lagezentrum' } }, episode: 7, stories, script, markets, meta: { model: 'test', costUsd: 0 } });
    expect(lz.script.map(l => l.kind)).toEqual(['fakt', 'frage', 'fakt', 'zusammenfassung', 'abschluss', 'abschluss']);
    expect(lz.script[3]!.text).toBe('Also: a-meldung, b-meldung und c-meldung.');
    expect(summaryLine([], 'lagezentrum')).toBeNull();
    expect(summaryLine(stories, 'assistent')).toBeNull();
  });

  it('prüft weitere Orte wie den Hauptort', () => {
    expect(resolveExtraPlace({ label: 'Nordkorea', country_iso3: 'PRK', lon: 125.75, lat: 39.03, route: false })).toEqual({ label: 'Nordkorea', lon: 125.75, lat: 39.03 });
    expect(resolveExtraPlace({ label: 'X', country_iso3: 'XYZ', lon: 0, lat: 0, route: true })).toBeNull();
  });
});

describe('Mischung', () => {
  const tone = (sec: number, sr: number, lead = 0.2, tail = 0.3): Float32Array => {
    const pcm = new Float32Array(Math.round((lead + sec + tail) * sr));
    for (let i = Math.round(lead * sr); i < Math.round((lead + sec) * sr); i++) pcm[i] = 0.3 * Math.sin(i / 5);
    return pcm;
  };

  it('liest und schreibt WAV', () => {
    const pcm = tone(0.1, 24000);
    const back = parseWav(wavBytes(pcm, 24000));
    expect(back.sr).toBe(24000);
    expect(back.pcm.length).toBe(pcm.length);
    expect(Math.abs(back.pcm[5000]! - pcm[5000]!)).toBeLessThan(1e-3);
  });

  it('schneidet Stille ab und gleicht die Lautstärke an', () => {
    const sr = 24000;
    const [a, b] = trimBounds(tone(1, sr), sr);
    expect(a / sr).toBeCloseTo(0.2 - 0.03, 2);
    expect(b / sr).toBeCloseTo(1.2 + 0.03, 2);
    const quiet = tone(1, sr).map(v => v * 0.1);
    expect(levelGain(quiet)).toBeGreaterThan(levelGain(tone(1, sr)));
  });

  it('legt die Zeilen mit den Pausenregeln an', () => {
    const sr = 8000;
    const clip = (sec: number): Clip => ({ pcm: tone(sec, sr), sr, words: [] });
    const lines: Line[] = [
      { role: 'LAGE', text: 'A.', story: 'x', kind: 'fakt' },
      { role: 'LEITUNG', text: 'Ist das viel?', story: 'x', kind: 'frage' },
      { role: 'EINORDNUNG', text: 'Ja.', story: 'x', kind: 'fakt' }
    ];
    const lay = layoutLines(lines, [clip(1), clip(0.5), clip(1)]);
    expect(lay.at[0]).toBeCloseTo(0.8, 2);
    expect(lay.at[1]! - lay.at[0]!).toBeCloseTo(1.06 + 0.5, 1);
    expect(lay.at[2]! - lay.at[1]!).toBeCloseTo(0.56 + 0.3, 1);
    expect(lay.total).toBeGreaterThan(lay.at[2]! + 1);
  });

  it('erzeugt ein leises Musikbett', () => {
    const bed = musicBed(2, 8000);
    expect(bed.length).toBe(16000);
    const rms = Math.sqrt(bed.reduce((a, v) => a + v * v, 0) / bed.length);
    expect(20 * Math.log10(rms)).toBeCloseTo(-30, 0);
    expect(Math.abs(bed[0]!)).toBeLessThan(1e-3);
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
      { ...cfg, topics: [...cfg.topics, { id: 'h2', name: 'Wasserstoff', category: 'wissen', weight: 'ausfuehrlich', search: ['Elektrolyse'], feeds: [] }] });
    expect(items.map(i => i.topic)).toEqual(['wissen', 'h2']);
  });
});

describe('Marktdaten', () => {
  it('baut die Sätze nur aus den Zahlen', async () => {
    const { marketLines } = await import('../pipeline/markets');
    const item = (id: string, name: string, value: number, changePct: number) => ({ id, name, value, dec: 0, unit: 'Pkt.', changePct, date: '2026-10-27' });
    const lines = marketLines([item('dax', 'DAX', 24512, 0.42), item('spx', 'S&P 500', 6912, -0.71), item('ndq', 'Nasdaq', 26169, 0.01)]);
    expect(lines.map(l => l.text)).toEqual([
      'Der DAX schloss am Dienstag bei 24.512 Punkten, plus 0,4 Prozent.',
      'In New York gab der S&P 500 um 0,7 Prozent nach, der Nasdaq blieb nahezu unverändert.'
    ]);
    expect(lines[1]!.say).toContain('S und P 500');
    expect(lines.every(l => l.story === 'maerkte' && l.kind === 'fakt')).toBe(true);
  });
});

describe('Normalisierung', () => {
  it('vereinheitlicht Rollen und Prüfergebnisse', async () => {
    const { normalizeVerdict, normalizeKind } = await import('../pipeline/editorial');
    const { normalizeRole } = await import('../pipeline/drehbuch');
    expect(normalizeRole('Einordnung')).toBe('EINORDNUNG');
    expect(normalizeRole('LAGE:')).toBe('LAGE');
    expect(normalizeRole('Leitung')).toBe('LEITUNG');
    expect(normalizeRole('BRIEFING')).toBe('LEITUNG');
    expect(normalizeVerdict('Belegt')).toBe('belegt');
    expect(normalizeVerdict('nicht belegt')).toBe('nicht_belegt');
    expect(normalizeVerdict('teilweise belegt')).toBe('teilweise');
    expect(normalizeVerdict('???')).toBe('nicht_belegt');
    expect(normalizeKind('Vorbehalt')).toBe('vorbehalt');
    expect(normalizeKind('irgendwas')).toBe('detail');
  });
});

describe('Stimme VoxCPM2', () => {
  const cfg: VoxcpmConfig = { voices: { LEITUNG: { ref: 'l.wav', text: 'a' }, LAGE: { ref: 'g.wav', text: 'b' }, EINORDNUNG: { ref: 'e.wav', text: 'c' } }, cfg: 2, steps: 10, attempts: 3, whisper: 'large-v3-turbo' };

  it('schickt Sprechtext zum Sprechen und Text ohne Buchstabieren zum Vergleich', () => {
    const job = voxcpmJob([
      { role: 'LAGE', text: 'Bis 16 Uhr haben 55,7 % abgestimmt.', story: 'a', kind: 'fakt' },
      { role: 'EINORDNUNG', text: 'S&P 500 plus 0,7 %.', say: 'S und P 500 plus 0,7 %.', story: 'a', kind: 'fakt' },
      { role: 'LEITUNG', text: 'Und die KI?', story: 'a', kind: 'frage' }
    ], cfg);
    expect(job.lines.map(l => [l.i, l.role, l.say])).toEqual([
      [0, 'LAGE', 'Bis sechzehn Uhr haben fünfundfünfzig Komma sieben Prozent abgestimmt.'],
      [1, 'EINORDNUNG', 'S und P fünfhundert plus null Komma sieben Prozent.'],
      [2, 'LEITUNG', 'Und die Ka-I?']
    ]);
    expect(job.lines[2]!.ref).toBe('Und die KI?');
    expect(job.attempts).toBe(3);
  });

  it('gibt der Stimme nur im Modus „steuerbar“ eine Anweisung je Stimmung', () => {
    const moods = { neutral: 'natural', ueberrascht: 'surprised' };
    const l: Line = { role: 'LEITUNG', text: 'Oha.', kind: 'frage', mood: 'ueberrascht' };
    expect(styleFor(l, { ...cfg, moods })).toBeUndefined();
    expect(styleFor(l, { ...cfg, mode: 'steuerbar', moods })).toBe('surprised');
    expect(styleFor({ ...l, mood: 'ernst' }, { ...cfg, mode: 'steuerbar', moods })).toBe('natural');
    expect(voxcpmJob([l], { ...cfg, mode: 'steuerbar', moods }).lines[0]!.style).toBe('surprised');
  });

  it('startet eine 8-Minuten-Folge mit VoxCPM2 früher, damit sie bis 8 Uhr fertig ist', () => {
    expect(earliestStart(3, 'voxcpm2')).toBe('05:30');
    expect(earliestStart(5, 'voxcpm2')).toBe('05:30');
    expect(earliestStart(8, 'voxcpm2')).toBe('04:30');
    expect(earliestStart(8, 'azure')).toBe('05:30');
  });

  it('liest die Zeilen der Engine als Clips mit Wortzeiten; unbrauchbare fehlen', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'lagebild-vox-'));
    writeFileSync(join(dir, 'zeile-000.wav'), wavBytes(new Float32Array(4800).fill(0.1), 48000));
    const clips = readClips(dir, {
      failed: [1],
      lines: [
        { i: 0, ok: true, file: 'zeile-000.wav', bounds: [{ end: 0.05, len: 3 }, { end: 0.1, len: 1 }], problems: [], attempts: 1, cer: 0 },
        { i: 1, ok: false, file: 'zeile-001.wav', bounds: [], problems: ['Verneinung fehlt: „nicht“'], attempts: 3, cer: 12 }
      ]
    }, 3);
    expect(clips[0]?.sr).toBe(48000);
    expect(clips[0]?.pcm.length).toBe(4800);
    expect(clips[0]?.words).toEqual([[0.05, 0.75], [0.1, 1]]);
    expect(clips[1]).toBeNull();
    expect(clips[2]).toBeNull();
  });
});

describe('Ablage', () => {
  it('schreibt den Index, zählt Folgen und räumt altes Audio und alte Bilder samt Verweisen auf', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { pruneMedia, writeIndex, previousHeadlines, writeJSON, nextEpisode } = await import('../pipeline/store');
    const out = mkdtempSync(join(tmpdir(), 'lagebild-'));
    const day = (date: string, headline: string, episode: number) => ({
      schema: 2, date, generated: `${date}T07:00:00+01:00`, episode, tone: 'lagezentrum', categories: [],
      stories: [{ id: 'x', category: 'k', topic: 'T', format: 'aufmacher', country: 'DEU', label: 'B', flag: '', lon: 0, lat: 0, zoom: 2, headline, brief: 'b', source: { name: 'Q', url: 'https://q.de', date }, short: 's', facts: [], images: [{ src: `bilder/${date}/a.jpg`, w: 1, h: 1, motif: 'M', match: 'M', author: 'A', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:A.jpg' }] }],
      script: [{ role: 'LAGE', text: 't', story: 'x', kind: 'fakt', audio: { at: 0.8, dur: 1 } }],
      audio: { src: `audio/${date}/folge.mp3`, voice: `audio/${date}/folge-stimme.mp3`, dur: 3 }
    });
    writeJSON(join(out, '2026-10-01.json'), day('2026-10-01', '[Alt] Meldung', 1));
    writeJSON(join(out, '2026-10-27.json'), day('2026-10-27', '[Gestern] Meldung', 2));
    for (const d of ['2026-10-01', '2026-10-27']) {
      mkdirSync(join(out, 'audio', d), { recursive: true }); writeFileSync(join(out, 'audio', d, 'folge.mp3'), '');
      mkdirSync(join(out, 'bilder', d), { recursive: true }); writeFileSync(join(out, 'bilder', d, 'a.jpg'), '');
    }
    const idx = writeIndex(out, 'jetzt');
    expect(idx.days.map(d => [d.date, d.episode, d.dur])).toEqual([['2026-10-27', 2, 3], ['2026-10-01', 1, 3]]);
    expect(previousHeadlines(out, '2026-10-28')).toEqual(['Gestern Meldung']);
    expect(nextEpisode(out, '2026-10-28')).toBe(3);
    expect(nextEpisode(out, '2026-10-27')).toBe(2);
    expect(pruneMedia(out, '2026-10-28', 14)).toEqual(['2026-10-01']);
    expect(existsSync(join(out, 'audio', '2026-10-01'))).toBe(false);
    expect(existsSync(join(out, 'bilder', '2026-10-01'))).toBe(false);
    expect(readFileSync(join(out, '2026-10-01.json'), 'utf8')).not.toContain('"images"');
    expect(readFileSync(join(out, '2026-10-27.json'), 'utf8')).toContain('"images"');
    expect(existsSync(join(out, 'audio', '2026-10-27'))).toBe(true);
    expect(readFileSync(join(out, '2026-10-01.json'), 'utf8')).not.toContain('"audio"');
    expect(readFileSync(join(out, '2026-10-27.json'), 'utf8')).toContain('"audio"');
  });
});
