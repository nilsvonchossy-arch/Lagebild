// Schema 3: Hintergrund aus einer zweiten Quelle, Format „Im Fokus“, Erklär-Einblendungen.
import { describe, expect, it } from 'vitest';
import pipelineCfg from '../config/pipeline.json';
import themen from '../config/themen.json';
import demo from '../public/demo/2026-10-27.json';
import folge29 from '../folgen/2026-10-29.json';
import { checkActors, checkChain, checkTimeline, toScriptStory, toStory, visualHint, type Built } from '../pipeline/assemble';
import { Claude } from '../pipeline/claude';
import { drehbuchPrompt, simpleLines, type ScriptStory } from '../pipeline/drehbuch';
import {
  applyBackgroundVerdicts, applyVerdicts, cleanBackground, isMajor, selectStories, verifyBackground, verifyPrompt, writeBackground,
  type BackgroundDraft, type Draft
} from '../pipeline/editorial';
import { resolvePlace } from '../pipeline/geo';
import { fokusCandidate, planEpisode, targetSeconds, wantsBackground, type PlanInput } from '../pipeline/plan';
import { backgroundHTML, detailsHTML, formatLabel } from '../src/card';
import { scenesOf } from '../src/player';
import { migrateConfig } from '../src/shared/config';
import { actorPattern, cuesFor, timelinePattern } from '../src/shared/script';
import { isPlayable, type Briefing, type Fact } from '../src/shared/types';
import { actorsHTML, chainHTML, initials, timelineHTML } from '../src/viz';

const cfg = migrateConfig(themen);

/** Claude-Ersatz: gibt die Antworten der Reihe nach zurück und merkt sich die Anfragen */
function fakeClaude(answers: unknown[]): { claude: Claude; calls: { label: string; user: string }[] } {
  const calls: { label: string; user: string }[] = [];
  const claude = { ask: async (label: string, _s: string, user: string) => { calls.push({ label, user }); return answers.shift(); }, for() { return claude; } };
  return { claude: claude as unknown as Claude, calls };
}

const article = (url: string, text: string) => ({ url, title: 'T', text, date: '2026-11-05', siteName: null });

const mainDraft = (): Draft => ({
  usable: true,
  facts: [
    { text: 'Nach Recherchen von NDR und WDR zahlte die Firma X verdeckt an Abgeordnete.', kind: 'kern' },
    { text: 'Laut Recherche flossen 2,4 Millionen Euro.', kind: 'zahl' },
    { text: 'Die Firma X bestreitet die Vorwürfe.', kind: 'reaktion' },
    { text: 'Der Bundestag will den Fall am Freitag beraten.', kind: 'ausblick' }
  ],
  headline: '[Recherche]: Firma X zahlte an [Abgeordnete]',
  brief: 'b',
  figure: null,
  short: 'Zahlungen der Firma X',
  place: { label: 'BERLIN', country_iso3: 'DEU', lon: 13.4, lat: 52.52 },
  places: [],
  source_date: '2026-11-05',
  enthuellung: true,
  vergleich: null,
  termin: null,
  symbol: 'parlament',
  motive: []
});

const bgDraft = (): BackgroundDraft => ({
  facts: [
    { id: 'h1', text: 'Schon 2019 hatte die Firma X Lobbyregeln kritisiert.' },
    { id: 'h2', text: 'Im März 2024 verschärfte der Bundestag laut Deutschlandfunk die Transparenzpflichten.' },
    { id: 'h3', text: 'Die Grünen fordern laut Deutschlandfunk einen Untersuchungsausschuss.' }
  ],
  timeline: [
    { date: '2019', label: 'Firma kritisiert Lobbyregeln', facts: ['h1'] },
    { date: 'März 2024', label: 'Strengere Transparenzpflichten', facts: ['h2'] },
    { date: 'heute', label: 'Recherche zu Zahlungen', facts: ['f1'] }
  ],
  actors: [
    { name: 'Firma X', role: 'beschuldigtes Unternehmen', position: 'bestreitet die Vorwürfe', facts: ['f3'] },
    { name: 'Die Grünen', role: 'Opposition', position: 'fordern einen Untersuchungsausschuss', facts: ['h3'] }
  ],
  chain: [
    { label: 'Strengere Transparenzpflichten', facts: ['h2'] },
    { label: 'Zahlungen werden sichtbar', facts: ['f1'] }
  ]
});

function built(relevance: number, background = true): Built {
  const topic = cfg.topics.find(t => t.id === 'deutschland')!;
  return {
    sel: { topic: 'deutschland', articles: [1, 2], relevance, reason: 'Grund', working_title: 'Zahlungen', investigative: true, background_articles: [2] },
    topic,
    article: article('https://www.tagesschau.de/a', 'x'),
    sourceName: 'tagesschau',
    published: '2026-11-05T06:00:00Z',
    draft: mainDraft(),
    place: resolvePlace('DEU', 13.4, 52.52)!,
    places: [],
    ...(background ? { background: { article: article('https://www.deutschlandfunk.de/b', 'y'), sourceName: 'Deutschlandfunk', published: null, sameSource: false, draft: bgDraft() } } : {})
  };
}

describe('Auswahl erkennt Enthüllungen', () => {
  it('übernimmt investigative und Hintergrund-Artikel, nur gültige IDs', async () => {
    const cands = [1, 2, 3].map(id => ({ id, title: `T${id}`, teaser: '', url: `https://e.org/${id}`, source: 'Q', domain: 'e.org', published: null, lang: 'de', topics: ['deutschland'], via: 'rss' as const }));
    const { claude } = fakeClaude([{ stories: [
      { topic: 'deutschland', articles: [1], relevance: 5, reason: 'r', working_title: 'Recherche', investigative: true, background_articles: [2, 99, 3, 1] },
      { topic: 'deutschland', articles: [3], relevance: 3, reason: 'r', working_title: 'Normal', investigative: false, background_articles: [] }
    ] }]);
    const sel = await selectStories(claude, cfg, cands, { dateLabel: 'x', yesterday: [], want: 2, minutes: 3 });
    expect(sel[0]).toMatchObject({ investigative: true, background_articles: [2, 3] });
    expect(sel[1]!.investigative).toBe(false);
    expect(isMajor({ relevance: 4, investigative: true })).toBe(true);
    expect(isMajor({ relevance: 4, investigative: false })).toBe(false);
    expect(isMajor({ relevance: 5 })).toBe(true);
  });

  it('lässt den Faktencheck die Enthüllung bestätigen', () => {
    expect(verifyPrompt(article('u', 'Text'), mainDraft())).toContain('enthuellung:');
    const r = applyVerdicts(mainDraft(), [{ id: 'enthuellung', verdict: 'nicht_belegt', problem: 'normale Meldung', correction: null }]);
    expect(r.draft?.enthuellung).toBe(false);
    expect(r.draft?.facts).toHaveLength(4);
  });
});

describe('Hintergrund', () => {
  it('nummeriert neue Fakten, vereinheitlicht Verweise und lässt zu kurze Grafiken weg', () => {
    const bg = cleanBackground({
      usable: true,
      facts: ['Schon 2019 gab es Streit.', '  ', 'Laut DLF gab es 2021 eine Reform.'],
      zeitleiste: [{ datum: '2019', label: 'Streit', fakten: ['H1'] }, { datum: '2021', label: 'Reform', fakten: ['h3', 'h9'] }],
      akteure: [{ name: 'DLF', rolle: 'Sender', position: 'berichtet', fakten: ['f7'] }],
      kette: [{ label: 'A', fakten: ['f1'] }, { label: 'B', fakten: ['f1'] }]
    }, 4);
    expect(bg!.facts.map(f => f.id)).toEqual(['h1', 'h3']);
    expect(bg!.timeline.map(e => e.facts)).toEqual([['h1'], ['h3']]);
    // f7 gibt es nicht (nur f1–f4), ein Akteur allein ist keine Grafik; Kette mit nur einem Fakt erklärt nichts
    expect(bg!.actors).toEqual([]);
    expect(bg!.chain).toEqual([]);
    expect(cleanBackground({ usable: false, facts: ['x'], zeitleiste: [], akteure: [], kette: [] }, 4)).toBeNull();
  });

  it('wendet den Faktencheck an: korrigieren, streichen, Grafiken ohne Beleg weglassen', () => {
    const r = applyBackgroundVerdicts(bgDraft(), [
      { id: 'h1', verdict: 'nicht_belegt', problem: 'Jahr fehlt', correction: null },
      { id: 'h2', verdict: 'teilweise', problem: 'Zuschreibung', correction: 'Im März 2024 verschärfte der Bundestag die Transparenzpflichten, berichtet der Deutschlandfunk.' },
      { id: 'akteur2', verdict: 'teilweise', problem: 'zugespitzt', correction: null },
      { id: 'kette', verdict: 'nicht_belegt', problem: 'nur Nacheinander', correction: null }
    ], 4);
    const bg = r.background!;
    expect(bg.facts.map(f => f.id)).toEqual(['h2', 'h3']);
    expect(bg.facts[0]!.text).toContain('berichtet der Deutschlandfunk');
    // Eintrag 2019 verliert seinen Fakt; es bleiben März 2024 und heute
    expect(bg.timeline.map(e => e.date)).toEqual(['März 2024', 'heute']);
    expect(bg.actors).toEqual([]);
    expect(bg.chain).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.issues).toHaveLength(4);
  });

  it('zieht und prüft Hintergrund aus der zweiten Quelle, zweite Prüfung ohne Korrekturen', async () => {
    const { claude, calls } = fakeClaude([
      { usable: true, facts: ['Schon 2019 hatte die Firma X Lobbyregeln kritisiert.', 'Die Firma X war 2022 Rekordspender.'], zeitleiste: [{ datum: '2019', label: 'Kritik an Lobbyregeln', fakten: ['h1'] }, { datum: 'heute', label: 'Recherche', fakten: ['f1'] }], akteure: [], kette: [] },
      { items: [{ id: 'h1', verdict: 'belegt', problem: null, correction: null }, { id: 'h2', verdict: 'teilweise', problem: 'Jahr', correction: 'Die Firma X war Rekordspender.' }] },
      { items: [{ id: 'h2', verdict: 'nicht_belegt', problem: 'steht nicht drin', correction: 'egal' }] }
    ]);
    const a = article('https://www.deutschlandfunk.de/b', 'Quelltext zwei');
    const draft = await writeBackground(claude, a, mainDraft(), { title: 'Zahlungen', mainSource: 'tagesschau', source: 'Deutschlandfunk', sameSource: false });
    expect(calls[0]!.user).toContain('BEKANNTE FAKTEN (geprüft, aus tagesschau)');
    expect(calls[0]!.user).toContain('f2 [zahl] Laut Recherche flossen 2,4 Millionen Euro.');
    expect(calls[0]!.user).toContain('QUELLTEXT (Deutschlandfunk — https://www.deutschlandfunk.de/b)');
    const r = await verifyBackground(claude, a, mainDraft(), draft!, 'Zahlungen');
    expect(calls.map(c => c.label)).toEqual(['Hintergrund „Zahlungen“', 'Hintergrund prüfen „Zahlungen“', 'Hintergrund nachprüfen „Zahlungen“']);
    expect(calls[1]!.user).toContain('zeit1: 2019 – Kritik an Lobbyregeln [h1]');
    expect(r.background!.facts.map(f => f.text)).toEqual(['Schon 2019 hatte die Firma X Lobbyregeln kritisiert.']);
    expect(r.background!.timeline).toHaveLength(2);
    expect(r.issues.some(i => i.startsWith('2. Prüfung'))).toBe(true);
  });

  it('übernimmt den Hintergrund nur bei Aufmacher und Fokus ab Relevanz 4', () => {
    const s = toStory(built(4), 'A', 'aufmacher', '2026-11-05', []);
    expect(s.facts.map(f => `${f.id}:${f.kind}:${f.source}`)).toEqual([
      'A1:kern:0', 'A2:zahl:0', 'A3:reaktion:0', 'A4:ausblick:0', 'A5:hintergrund:1', 'A6:hintergrund:1', 'A7:hintergrund:1'
    ]);
    expect(s.sources!.map(x => x.name)).toEqual(['tagesschau', 'Deutschlandfunk']);
    expect(s.source.name).toBe('tagesschau');
    expect(s.investigative).toBe(true);
    expect(s.background).toEqual({ facts: ['A5', 'A6', 'A7'] });
    expect(s.timeline).toEqual([
      { date: '2019', label: 'Firma kritisiert Lobbyregeln', facts: ['A5'] },
      { date: 'März 2024', label: 'Strengere Transparenzpflichten', facts: ['A6'] },
      { date: 'heute', label: 'Recherche zu Zahlungen', facts: ['A1'] }
    ]);
    expect(s.actors!.map(a => `${a.name}:${a.facts.join()}`)).toEqual(['Firma X:A3', 'Die Grünen:A7']);
    expect(s.chain!.map(c => c.facts.join())).toEqual(['A6', 'A1']);
    // Meldung oder zu geringe Relevanz: kein Hintergrund-Teil, keine zweite Quelle
    for (const [rel, fmt] of [[4, 'meldung'], [3, 'aufmacher']] as const) {
      const m = toStory(built(rel), 'B', fmt, '2026-11-05', []);
      expect(m.facts).toHaveLength(4);
      expect(m.sources).toHaveLength(1);
      expect(m.background).toBeUndefined();
      expect(m.timeline).toBeUndefined();
    }
    expect(wantsBackground('fokus', 4)).toBe(true);
    expect(wantsBackground('kurz', 5)).toBe(false);
  });

  it('gibt dem Drehbuch Hintergrund, Quelle und Einblendungen mit', () => {
    const s = toStory(built(5), 'A', 'fokus', '2026-11-05', []);
    const ss = toScriptStory(s, built(5), 'A', { index: 0, format: 'fokus', seconds: 75 });
    expect(ss.investigative).toBe(true);
    expect(ss.facts[4]).toEqual({ id: 'A5', text: 'Schon 2019 hatte die Firma X Lobbyregeln kritisiert.', kind: 'hintergrund', source: 'Deutschlandfunk' });
    expect(ss.facts[0]!.source).toBeUndefined();
    expect(visualHint(s)).toContain('Zeitleiste Vorgeschichte bei „2019“, „März 2024“');
    expect(visualHint(s)).toContain('„Wer steht wo“ bei „Firma X“, „Die Grünen“');
    const prompt = drehbuchPrompt([ss]);
    expect(prompt).toContain('A · Im Fokus · Enthüllung (eigene Recherche) · etwa 75 Sekunden');
    expect(prompt).toContain('A5 [hintergrund · Quelle: Deutschlandfunk] Schon 2019');
  });
});

describe('Prüfung der Erklär-Grafiken im Code', () => {
  const facts: Fact[] = [
    { id: 'A1', text: 'Am 7. Oktober 2023 griff die Hamas Israel an.' },
    { id: 'A2', text: 'Seit 2019 gab es fünf Wahlen.' },
    { id: 'A3', text: 'Laut Sandoz ist das Werk nicht tragfähig.' },
    { id: 'A4', text: 'Gadi Eisenkot fordert Neuwahlen.' }
  ];

  it('nimmt Zeitangaben nur wörtlich aus den Fakten, in Reihenfolge, „heute“ nur am Ende', () => {
    expect(checkTimeline([{ date: '2019', label: 'Erste Wahl', facts: ['A2'] }, { date: '7. Oktober 2023', label: 'Angriff', facts: ['A1'] }], facts)).toHaveLength(2);
    // 2018 steht nirgends: Eintrag fällt weg, einer bleibt – zu wenig
    expect(checkTimeline([{ date: '2018', label: 'x', facts: ['A2'] }, { date: '2019', label: 'y', facts: ['A2'] }], facts)).toBeNull();
    // rückwärts
    expect(checkTimeline([{ date: '7. Oktober 2023', label: 'x', facts: ['A1'] }, { date: '2019', label: 'y', facts: ['A2'] }], facts)).toBeNull();
    // „heute“ nicht am Ende
    expect(checkTimeline([{ date: 'heute', label: 'x', facts: ['A3'] }, { date: '2019', label: 'y', facts: ['A2'] }], facts)).toBeNull();
    // unbekannter Fakt
    expect(checkTimeline([{ date: '2019', label: 'y', facts: ['A9'] }, { date: 'heute', label: 'x', facts: ['A3'] }], facts)).toBeNull();
  });

  it('nimmt Akteure nur, wenn der Name im Fakt steht, und nicht doppelt', () => {
    const ok = checkActors([
      { name: 'Sandoz', role: 'Betreiber', position: 'nennt das Werk nicht tragfähig', facts: ['A3'] },
      { name: 'Gadi Eisenkot', role: 'Politiker', position: 'fordert Neuwahlen', facts: ['A4'] }
    ], facts);
    expect(ok).toHaveLength(2);
    expect(checkActors([{ name: 'Novartis', role: 'x', position: 'y', facts: ['A3'] }, { name: 'Sandoz', role: 'x', position: 'y', facts: ['A3'] }], facts)).toBeNull();
    expect(checkActors([{ name: 'Sandoz', role: 'x', position: 'y', facts: ['A3'] }, { name: 'sandoz', role: 'x', position: 'y', facts: ['A3'] }], facts)).toBeNull();
    expect(actorPattern('Gadi Eisenkot')!.test('Eisenkot fordert')).toBe(true);
  });

  it('nimmt eine Kette nur mit 2–4 Schritten und vorhandenen Fakten', () => {
    expect(checkChain([{ label: 'Ursache', facts: ['A1'] }, { label: 'Wirkung', facts: ['A2'] }], facts)).toHaveLength(2);
    expect(checkChain([{ label: 'Ursache', facts: ['A1'] }], facts)).toBeNull();
    expect(checkChain([{ label: 'Ursache', facts: ['A1'] }, { label: 'Wirkung', facts: ['A8'] }], facts)).toBeNull();
  });
});

describe('Plan mit „Im Fokus“', () => {
  const item = (relevance: number, weight: PlanInput['weight'], facts: number, lon: number, lat: number, investigative = false): PlanInput => ({ relevance, weight, facts, lon, lat, investigative });

  it('macht eine große Enthüllung mit genug Stoff zum Fokus, auch als Aufmacher', () => {
    const p = planEpisode([item(4, 'normal', 11, 13, 52, true), item(4, 'normal', 6, 2, 49), item(3, 'normal', 5, 12, 47)], 5, true);
    expect(p.items[0]).toMatchObject({ index: 0, format: 'fokus' });
    expect(p.items[0]!.seconds).toBeGreaterThanOrEqual(60);
    expect(p.items[0]!.seconds).toBeLessThanOrEqual(75);
    expect(targetSeconds('fokus', item(5, 'ausfuehrlich', 16, 0, 0))).toBe(90);
    expect(targetSeconds('fokus', item(5, 'normal', 9, 0, 0))).toBe(60);
  });

  it('setzt den Fokus direkt hinter den Aufmacher, höchstens einen pro Folge', () => {
    const input = [item(5, 'normal', 6, 35, 31), item(4, 'normal', 12, -74, 41, true), item(5, 'normal', 10, 2, 49, true), item(3, 'normal', 5, 12, 47)];
    const p = planEpisode(input, 8, true);
    // Index 2 (Relevanz 5, Enthüllung) ist am wichtigsten und wird Fokus-Aufmacher; Index 1 bleibt Meldung
    expect(p.items.filter(x => x.format === 'fokus')).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ index: 2, format: 'fokus' });
    const q = planEpisode([item(5, 'normal', 6, 35, 31), item(4, 'normal', 12, -74, 41, true), item(3, 'normal', 5, 12, 47)], 5, true);
    expect(q.items.map(x => `${x.index}:${x.format}`).slice(0, 2)).toEqual(['0:aufmacher', '1:fokus']);
  });

  it('kein Fokus ohne Stoff, bei „nur kurz“ oder ohne Enthüllung unter Relevanz 5', () => {
    expect(fokusCandidate(item(5, 'normal', 8, 0, 0))).toBe(false);
    expect(fokusCandidate(item(5, 'kurz', 12, 0, 0))).toBe(false);
    expect(fokusCandidate(item(4, 'ausfuehrlich', 12, 0, 0))).toBe(false);
    expect(fokusCandidate(item(4, 'normal', 9, 0, 0, true))).toBe(true);
  });

  it('bleibt in der Länge einer 3-Minuten-Folge', () => {
    const input = [item(5, 'normal', 7, 35, 31), item(4, 'normal', 16, -74, 41, true), item(3, 'normal', 5, 12, 47), item(3, 'normal', 5, 2, 49), item(2, 'normal', 4, 10, 50)];
    const p = planEpisode(input, 3, true);
    const total = p.items.reduce((n, x) => n + x.seconds + 1.8, 14 + 13);
    expect(total).toBeLessThanOrEqual(180);
    expect(p.items[1]!.format).toBe('fokus');
  });
});

describe('Drehbuch mit Hintergrund', () => {
  it('fragt in der einfachen Fassung nach dem Hintergrund und lässt EINORDNUNG antworten', () => {
    const s: ScriptStory = {
      key: 'A', id: 'a', format: 'aufmacher', seconds: 40, topic: 'T', label: 'ORT', places: [], figure: null,
      facts: [
        { id: 'A1', text: 'Kern.', kind: 'kern' }, { id: 'A2', text: 'Vorher.', kind: 'hintergrund' }, { id: 'A3', text: 'Problem.', kind: 'problem' },
        { id: 'A4', text: 'Grund.', kind: 'hintergrund', source: 'DLF' }, { id: 'A5', text: 'Mehr.', kind: 'hintergrund' }
      ]
    };
    const lines = simpleLines([s], 'lagezentrum');
    expect(lines.map(l => `${l.role}:${l.text}`)).toEqual(['LAGE:Kern.', 'EINORDNUNG:Problem.', 'LEITUNG:Wie kam es dazu?', 'EINORDNUNG:Vorher.', 'EINORDNUNG:Grund.']);
    // Meldungen behalten die alte Reihenfolge ohne eigenen Teil
    expect(simpleLines([{ ...s, format: 'meldung' }], 'podcast').map(l => l.text)).toEqual(['Kern.', 'Vorher.', 'Problem.']);
  });
});

describe('Modelle je Schritt', () => {
  it('stellt Auswahl und Faktencheck auf Sonnet, Drehbuch bleibt Haiku', () => {
    const claude = new Claude(pipelineCfg.model, 'high', pipelineCfg.steps as never);
    expect(claude.for('auswahl').model).toBe('claude-sonnet-5-5');
    expect(claude.for('faktencheck').model).toBe('claude-sonnet-5-5');
    expect(claude.for('drehbuch').model).toBe('claude-haiku-5-5');
    expect(claude.for('fakten')).toBe(claude);
    expect(claude.for('auswahl').usage).toBe(claude.usage);
    expect(claude.models()).toEqual({ auswahl: 'claude-sonnet-5-5', fakten: 'claude-haiku-5-5', hintergrund: 'claude-haiku-5-5', faktencheck: 'claude-sonnet-5-5', drehbuch: 'claude-haiku-5-5' });
    // --model: ein Modell für alles
    expect(new Claude('claude-opus-5-5').for('auswahl').model).toBe('claude-opus-5-5');
  });
});

describe('Erklär-Einblendungen in der App', () => {
  const story = {
    timeline: [{ date: '2019', label: 'Erste Wahl', facts: ['A2'] }, { date: '7. Oktober 2023', label: 'Angriff', facts: ['A1'] }, { date: 'heute', label: 'Jetzt', facts: ['A3'] }],
    actors: [{ name: 'Gadi Eisenkot', role: 'Politiker', position: 'fordert Neuwahlen', facts: ['A4'] }, { name: 'Likud', role: 'Partei', position: 'lehnt ab', facts: ['A5'] }],
    chain: [{ label: 'Konkurrenz aus China', facts: ['B3'] }, { label: 'Werk unter Druck', facts: ['B1'] }]
  };

  it('erscheinen beim Wort: Zeitangabe, Jahreszahl, Name; sonst mit ihren Fakten am Zeilenanfang', () => {
    const a = cuesFor(story, { text: 'Seit 2019 gab es fünf Wahlen, im Oktober 2023 dann der Angriff.' });
    expect(a.map(c => `${c.kind}:${c.index}`)).toEqual(['timeline:0', 'timeline:1']);
    expect(a[1]!.at).toBeCloseTo('Seit 2019 gab es fünf Wahlen, im Oktober '.length / 'Seit 2019 gab es fünf Wahlen, im Oktober 2023 dann der Angriff.'.length);
    // „heute“ löst nie aus, auch nicht über seine Fakten
    expect(cuesFor(story, { text: 'Heute ist es so.', facts: ['A3'] })).toEqual([]);
    expect(cuesFor(story, { text: 'Eisenkot fordert Neuwahlen, der Likud lehnt ab.' }).map(c => `${c.kind}:${c.index}`)).toEqual(['actors:0', 'actors:1']);
    expect(cuesFor(story, { text: 'Er will Neuwahlen.', facts: ['A4'] })).toEqual([{ at: 0, kind: 'actors', index: 0 }]);
    // Kette: mit der Ursache, nicht mit der Wirkung
    expect(cuesFor(story, { text: 'Grund ist günstigere Konkurrenz.', facts: ['B3'] })).toEqual([{ at: 0, kind: 'chain' }]);
    expect(cuesFor(story, { text: 'Das Werk steht unter Druck.', facts: ['B1'] })).toEqual([]);
    expect(timelinePattern('heute')).toBeNull();
    expect(timelinePattern('2019')!.test('20190')).toBe(false);
  });

  it('bauen Zeitleiste, Akteure und Kette mit Hervorhebung und maskiertem Text', () => {
    const tl = timelineHTML(story.timeline, 1);
    expect(tl).toContain('Vorgeschichte');
    expect(tl.match(/class="vz-step[^"]*"/g)).toEqual(['class="vz-step done"', 'class="vz-step on"', 'class="vz-step now "']);
    expect(tl).toContain('<b>Heute</b>');
    const ac = actorsHTML([{ name: '<b>X</b>', role: 'r', position: 'p', facts: [] }, ...story.actors], 2);
    expect(ac).not.toContain('<b>X</b>');
    expect(ac).toContain('Wer steht wo');
    expect((ac.match(/vz-act on/g) ?? []).length).toBe(1);
    expect(initials('Gadi Eisenkot')).toBe('GE');
    expect(initials('EU-Kommission')).toBe('EK');
    const ch = chainHTML(story.chain);
    expect(ch).toContain('Ursache und Wirkung');
    expect((ch.match(/vz-arrow/g) ?? []).length).toBe(1);
    expect(ch.indexOf('Konkurrenz aus China')).toBeLessThan(ch.indexOf('Werk unter Druck'));
  });
});

describe('Demo-Folge mit Schema 3', () => {
  const b = demo as unknown as Briefing;
  const israel = b.stories.find(s => s.id === 'israel')!;
  const kundl = b.stories.find(s => s.id === 'kundl')!;

  it('besteht dieselben Prüfungen wie die Pipeline', () => {
    expect(checkTimeline(israel.timeline, israel.facts)).toEqual(israel.timeline);
    expect(checkActors(israel.actors, israel.facts)).toEqual(israel.actors);
    expect(checkChain(kundl.chain, kundl.facts)).toEqual(kundl.chain);
    for (const s of b.stories) {
      expect(s.sources?.[0]).toEqual(s.source);
      for (const f of s.facts) expect(s.sources![f.source ?? 0], `${f.id}`).toBeDefined();
      for (const id of s.background?.facts ?? []) expect(s.facts.find(f => f.id === id)?.kind, id).toBe('hintergrund');
    }
  });

  it('zeigt Zeitleiste, Akteure und Kette beim passenden Satz', () => {
    const cuesOf = (id: string) => b.script.filter(l => l.story === id).flatMap(l => cuesFor(b.stories.find(s => s.id === id)!, l).map(c => c.kind));
    expect(cuesOf('israel')).toEqual(expect.arrayContaining(['timeline', 'actors', 'comparison', 'image', 'deadline']));
    expect(cuesOf('kundl')).toContain('chain');
    const sc = scenesOf(b);
    expect(sc.find(s => s.key === 'kundl')!.hasVisual).toBe(true);
  });

  it('zeigt Hintergrund und Grafiken in den Details', () => {
    const html = detailsHTML(israel, b.categories);
    expect(html).toContain('<h4>Hintergrund</h4>');
    expect(html).toContain('<h4>Vorgeschichte</h4>');
    expect(html).toContain('<h4>Wer steht wo</h4>');
    expect(backgroundHTML(kundl)).toContain('Günstigere Konkurrenz aus China → Europas letztes großes Penicillin-Werk unter Druck');
    expect(formatLabel({ ...israel, format: 'fokus', investigative: true })).toBe('Im Fokus · Recherche');
  });

  it('spielt ältere Tage mit Schema 2 weiter ab', () => {
    const old = folge29 as unknown as Briefing;
    expect(old.schema).toBe(2);
    expect(isPlayable(old)).toBe(true);
    expect(isPlayable(b)).toBe(true);
    expect(isPlayable({ schema: 1, script: [] })).toBe(false);
    expect(isPlayable({ schema: 3 })).toBe(false);
    // ohne neue Felder: keine Erklär-Grafiken, Details ohne Hintergrund-Block
    const sc = scenesOf(old);
    expect(sc.length).toBeGreaterThan(2);
    expect(backgroundHTML(old.stories[0]!)).toBe('');
    expect(detailsHTML(old.stories[0]!, old.categories)).toContain(old.stories[0]!.source.url);
  });
});
