import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import topo110 from 'world-atlas/countries-110m.json';
import topo50 from 'world-atlas/countries-50m.json';
import demo from '../public/demo/2026-10-27.json';
import { detailsHTML, headlineHTML, plainHeadline, relevanceHTML } from '../src/card';
import { scenesOf } from '../src/player';
import { comparisonAtFigure, cuesFor, deadlinePattern, estimateScript, findNumber, fracToSec, numberVariants, pauseBefore, secToFrac, subtitleBlocks, summaryText } from '../src/shared/script';
import { buildLayer, countryInfo, findCountry, flagEmoji } from '../src/geo/world';
import type { Briefing, Line } from '../src/shared/types';
import { jahreswort, ordnungswort, sprechtext, zahlwort } from '../src/shared/sprechtext';
import { dateParts, shortDate } from '../src/util';

const w110 = buildLayer(topo110 as unknown as Topology);
const w50 = buildLayer(topo50 as unknown as Topology);

describe('Ländertabelle', () => {
  it('übersetzt ISO-3 in den Zahlencode von world-atlas', () => {
    expect(countryInfo('ISR')).toEqual({ numeric: '376', iso2: 'IL', name: 'Israel' });
    expect(countryInfo('usa')?.numeric).toBe('840');
    expect(countryInfo('XYZ')).toBeNull();
  });

  it('baut Flaggen-Emojis', () => {
    expect(flagEmoji('ISR')).toBe('🇮🇱');
    expect(flagEmoji('DEU')).toBe('🇩🇪');
    expect(flagEmoji('XYZ')).toBe('');
  });

  it('findet Länder auf beiden Karten, Kosovo über den Namen', () => {
    for (const iso of ['ISR', 'USA', 'DEU', 'CHN', 'RUS', 'UKR', 'TWN', 'XKX']) {
      expect(findCountry(w110, iso), iso).not.toBeNull();
      expect(findCountry(w50, iso), iso).not.toBeNull();
    }
    expect(findCountry(w110, 'XYZ')).toBeNull();
  });

  it('fasst mehrteilige Länder zusammen', () => {
    const aus = findCountry(w50, 'AUS');
    expect(aus?.geometry.coordinates.length).toBeGreaterThan(1);
  });

  it('zerlegt die Karte in Teilflächen mit Hüllkreis', () => {
    expect(w50.parts.length).toBeGreaterThan(w50.countries.length);
    for (const p of w110.parts) expect(p.radius).toBeLessThan(Math.PI);
  });
});

describe('Karte', () => {
  it('färbt markierte Wörter ein', () => {
    const html = headlineHTML('[Israel] wählt mit [Rekord]beteiligung', 0);
    expect(html).toContain('<span class="hl">Israel</span>');
    expect(html).toContain('<span class="hl">Rekord</span>beteiligung');
    expect(plainHeadline('[Wall Street] fällt')).toBe('Wall Street fällt');
  });

  it('maskiert HTML in Headlines', () => {
    expect(headlineHTML('<b>[A&B]</b>', 0)).not.toContain('<b>');
  });

  it('zeigt Relevanz als 1–5 Punkte', () => {
    expect(relevanceHTML(undefined)).toBe('');
    expect((relevanceHTML(4).match(/class="on"/g) ?? []).length).toBe(4);
    expect((relevanceHTML(9).match(/class="on"/g) ?? []).length).toBe(5);
  });
});

describe('Datum', () => {
  it('zerlegt ISO-Daten ohne Zeitzonenverschiebung', () => {
    expect(dateParts('2026-10-27')).toMatchObject({ day: 27, month: 10, year: 2026, weekday: 'Dienstag', monthName: 'Oktober', short: 'OKT' });
    expect(shortDate('2026-03-01')).toBe('01.03.');
  });
});

describe('Demo-Folge', () => {
  const b = demo as unknown as Briefing;
  it('erfüllt das Schema 2', () => {
    expect(b.schema).toBe(2);
    expect(b.episode).toBe(1);
    const cats = new Set(b.categories.map(c => c.id));
    const ids = new Set(b.stories.map(s => s.id));
    for (const s of b.stories) {
      expect(cats.has(s.category), s.id).toBe(true);
      expect(countryInfo(s.country), s.id).not.toBeNull();
      expect(s.source.url).toMatch(/^https:\/\//);
      expect(s.source.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['aufmacher', 'meldung', 'kurz']).toContain(s.format);
      expect(s.facts.length).toBeGreaterThan(1);
    }
    expect(b.stories[0]!.format).toBe('aufmacher');
    for (const l of b.script) {
      expect(['LEITUNG', 'LAGE', 'EINORDNUNG']).toContain(l.role);
      if (l.story) expect(ids.has(l.story), l.text).toBe(true);
    }
  });

  it('hält die Drehbuch-Regeln ein', () => {
    const facts = new Map(b.stories.flatMap(s => s.facts.map(f => [f.id, s.id] as const)));
    // Einstieg mit der Kernaussage des Aufmachers, keine Begrüßung
    expect(b.script[0]!.role).toBe('LAGE');
    expect(b.script[0]!.story).toBe(b.stories[0]!.id);
    expect(b.script[0]!.text).not.toMatch(/guten (morgen|tag|abend)|willkommen/i);
    for (const l of b.script) {
      if (l.kind === 'fakt') {
        expect(l.facts?.length, l.text).toBeGreaterThan(0);
        for (const f of l.facts!) expect(facts.get(f), `${f} in „${l.text}“`).toBe(l.story);
      }
      if (l.role === 'LEITUNG' && l.kind === 'frage') expect(l.text.split(/\s+/).length, l.text).toBeLessThanOrEqual(6);
    }
    expect(b.script.slice(-2).map(l => l.kind)).toEqual(['abschluss', 'abschluss']);
  });

  it('teilt die Folge in Abschnitte', () => {
    const sc = scenesOf(b);
    expect(sc.map(s => s.key)).toEqual(['israel', 'kundl', 'wallstreet', 'apple', 'frankreich', '_ende']);
    expect(sc[1]!.firstFact).toBe(sc[1]!.first + 1);
    expect(estimateScript(b.script)).toBeGreaterThan(60);
  });

  it('zeigt Details mit Quelle', () => {
    const html = detailsHTML(b.stories[0]!, b.categories);
    expect(html).toContain('Kurz gesagt');
    expect(html).toContain(b.stories[0]!.source.url);
  });
});

describe('Einblendungen der Demo', () => {
  const b = demo as unknown as Briefing;
  it('nimmt Vergleichswerte und Termine nur aus den genannten Fakten', () => {
    for (const s of b.stories) {
      const facts = (ids: string[]) => s.facts.filter(f => ids.includes(f.id)).map(f => f.text);
      if (s.comparison) for (const it of s.comparison.items) expect(facts(s.comparison.facts).some(t => findNumber(t, it.value, s.comparison!.dec) >= 0), `${s.id} ${it.label}`).toBe(true);
      if (s.deadline) expect(facts(s.deadline.facts).some(t => deadlinePattern(s.deadline!)!.test(t)), s.id).toBe(true);
    }
  });
  it('hat Archivbilder mit Datei, Urheber und freier Lizenz', async () => {
    const { existsSync } = await import('node:fs');
    for (const s of b.stories) for (const img of s.images ?? []) {
      expect(existsSync(`public/demo/${img.src}`)).toBe(true);
      expect(img.author.length).toBeGreaterThan(1);
      expect(img.license).toMatch(/^(CC0|CC BY|Public domain)/);
      expect(img.page).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });
  it('zeigt in jeder Meldung mindestens eine Einblendung oder das Symbol', () => {
    for (const sc of scenesOf(b)) if (sc.story) expect(sc.hasVisual || Boolean(sc.story.symbol), sc.key).toBe(true);
  });
});

describe('Drehbuch-Regeln', () => {
  const L = (role: Line['role'], text: string, story?: string, kind: Line['kind'] = role === 'LEITUNG' ? 'frage' : 'fakt'): Line => ({ role, text, kind, ...(story ? { story } : {}) });

  it('setzt Pausen nach der Analyse', () => {
    expect(pauseBefore(undefined, L('LAGE', 'A.', 'x'))).toBe(0);
    expect(pauseBefore(L('LEITUNG', 'Ist das viel?', 'x'), L('EINORDNUNG', 'Ja.', 'x'))).toBe(0.3);
    expect(pauseBefore(L('LAGE', 'A.', 'x'), L('EINORDNUNG', 'B.', 'x'))).toBe(0.5);
    expect(pauseBefore(L('LAGE', 'Sandoz sagt,', 'x'), L('LAGE', 'dass …', 'x'))).toBe(0.12);
    expect(pauseBefore(L('LAGE', 'A.', 'x'), L('LAGE', 'B.', 'x'))).toBe(0.35);
    expect(pauseBefore(L('EINORDNUNG', 'A.', 'x'), L('LEITUNG', 'Und sonst?', 'y'))).toBe(0.9);
    expect(pauseBefore(L('EINORDNUNG', 'A.', 'x'), L('LEITUNG', 'Also: …', undefined, 'zusammenfassung'))).toBe(1);
    expect(pauseBefore(L('LEITUNG', 'Das ist die Lage.', undefined, 'abschluss'), L('LAGE', 'Wir bleiben dran.', undefined, 'abschluss'))).toBe(0.35);
  });

  it('teilt Untertitel in Blöcke mit 6–10 Wörtern an Satzzeichen', () => {
    expect(subtitleBlocks('Ist das viel?')).toEqual([{ text: 'Ist das viel?', from: 0, to: 1 }]);
    const t = 'Betreiber Sandoz nennt die Produktion wirtschaftlich nicht tragfähig, wenn Regierungen nicht mehr für Penicillin zahlen.';
    const b = subtitleBlocks(t);
    expect(b.map(x => x.text)).toEqual(['Betreiber Sandoz nennt die Produktion wirtschaftlich nicht tragfähig,', 'wenn Regierungen nicht mehr für Penicillin zahlen.']);
    expect(b[0]!.to).toBeCloseTo(b[1]!.from);
    const long = Array.from({ length: 23 }, (_, i) => `wort${i}`).join(' ');
    for (const x of subtitleBlocks(long)) {
      const n = x.text.split(' ').length;
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(10);
    }
    expect(subtitleBlocks('Israel wählt – und bis 16 Uhr haben schon 55,7 Prozent abgestimmt.').map(x => x.text)).toEqual(['Israel wählt – und bis 16 Uhr', 'haben schon 55,7 Prozent abgestimmt.']);
  });

  it('findet Zahl und weitere Orte im Text', () => {
    expect(numberVariants(2000, 0)).toEqual(['2.000', '2000']);
    expect(numberVariants(55.7, 1)).toEqual(['55,7']);
    const story = { figure: { value: 2000, dec: 0, label: 'x' }, places: [{ label: 'Nordkorea', lon: 127, lat: 40 }] };
    const cues = cuesFor(story, { text: 'Nordkorea droht, mehr als 2.000 Soldaten zu schicken.' });
    expect(cues.map(c => c.kind)).toEqual(['place', 'figure']);
    expect(cuesFor(story, { text: '12.000 Menschen' })).toEqual([]);
    expect(cuesFor({ figure: { value: 1.9, dec: 1, label: 'x' } }, { text: '1,9-mal so schnell' })).toHaveLength(1);
  });

  it('findet Vergleich, Termin und Bildmotiv im Text', () => {
    const story = {
      figure: { value: 55.7, dec: 1, label: 'x' },
      comparison: { label: 'Wahlbeteiligung', unit: ' %', dec: 1, items: [{ label: '16 Uhr', value: 55.7 }, { label: '2022', value: 47.5 }], facts: ['A1', 'A3'] },
      deadline: { time: '22:00', label: 'Wahllokale schließen', facts: ['A5'] },
      images: [{ src: 'bilder/x.jpg', w: 800, h: 600, motif: 'Gadi Eisenkot', match: 'Eisenkot', author: 'X', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:X.jpg' }]
    };
    // Der Vergleich erscheint beim Vergleichswert, nicht bei der Zahl, die am Pin hochzählt
    const a = cuesFor(story, { text: 'Bis 16 Uhr 55,7 Prozent, 2022 waren es 47,5 Prozent.' });
    expect(a.map(c => c.kind)).toEqual(['figure', 'comparison']);
    expect(a[1]!.at).toBeCloseTo('Bis 16 Uhr 55,7 Prozent, 2022 waren es '.length / 'Bis 16 Uhr 55,7 Prozent, 2022 waren es 47,5 Prozent.'.length);
    expect(cuesFor(story, { text: 'Die Wahllokale schließen um 22 Uhr Ortszeit.' }).map(c => c.kind)).toEqual(['deadline']);
    expect(cuesFor(story, { text: 'Gegen ihn tritt Gadi Eisenkot an.' })).toEqual([{ at: expect.any(Number), kind: 'image', image: 0 }]);
    expect(cuesFor({ deadline: { date: '2026-11-06', label: 'x', facts: [] } }, { text: 'Ausgeliefert ab dem 6. November.' })).toHaveLength(1);
    expect(cuesFor({ deadline: { time: '22:00', label: 'x', facts: [] } }, { text: 'Um 122 Uhr' })).toEqual([]);
  });

  it('zeigt den Vergleich bei der Hauptzahl nur, wenn kein anderer Vergleichswert gesagt wird', () => {
    const story = { figure: { value: 0.8, dec: 1, label: 'x' }, comparison: { label: 'Kursplus', unit: ' %', dec: 1, items: [{ label: 'Nasdaq', value: 0.8 }, { label: 'S&P 500', value: 0.7 }], facts: [] } };
    const only = [{ text: 'Der Nasdaq legte um 0,8 Prozent zu.' }];
    expect(cuesFor(story, only[0]!).map(c => c.kind)).toEqual(['figure']);
    expect(comparisonAtFigure(story, only)).toBe(true);
    expect(cuesFor(story, only[0]!, { comparisonAtFigure: true }).map(c => c.kind)).toEqual(['figure', 'comparison']);
    expect(comparisonAtFigure(story, [...only, { text: 'Der S&P 500 plus 0,7 Prozent.' }])).toBe(false);
  });

  it('rechnet zwischen Textanteil und Sekunde', () => {
    const words: [number, number][] = [[0.5, 0.25], [1, 0.5], [2, 1]];
    expect(fracToSec(words, 0.6, 2)).toBe(1);
    expect(fracToSec(undefined, 0.5, 4)).toBe(2);
    expect(secToFrac(words, 0.25, 2)).toBeCloseTo(0.125);
    expect(secToFrac(words, 1.5, 2)).toBeCloseTo(0.75);
    expect(secToFrac(words, 3, 2)).toBe(1);
  });

  it('baut die Zusammenfassung aus drei Schlagworten', () => {
    expect(summaryText(['Rekord in Israel', 'Druck in Kundl', 'KI treibt Börse', 'zu viel'], 'lagezentrum')).toBe('Also: Rekord in Israel, Druck in Kundl und KI treibt Börse.');
    expect(summaryText(['Eins.'], 'podcast')).toBe('Das Wichtigste: Eins.');
  });
});

describe('Sprechtext für offene Stimmen', () => {
  it('schreibt Zahlen aus', () => {
    expect([0, 1, 16, 21, 100, 101, 1000, 1499, 2022, 17000, 1000000, 2500000, 3200000000].map(zahlwort)).toEqual([
      'null', 'eins', 'sechzehn', 'einundzwanzig', 'einhundert', 'einhunderteins', 'eintausend', 'eintausendvierhundertneunundneunzig',
      'zweitausendzweiundzwanzig', 'siebzehntausend', 'eine Million', 'zwei Millionen fünfhunderttausend', 'drei Milliarden zweihundert Millionen'
    ]);
    expect([1973, 1100, 1999].map(jahreswort)).toEqual(['neunzehnhundertdreiundsiebzig', 'elfhundert', 'neunzehnhundertneunundneunzig']);
    expect([1, 3, 6, 7, 8, 20, 31].map(n => ordnungswort(n))).toEqual(['ersten', 'dritten', 'sechsten', 'siebten', 'achten', 'zwanzigsten', 'einunddreißigsten']);
  });

  it('liest Prozent, Datum, Uhrzeit, Jahre, Vorzeichen und Abkürzungen wie in den Nachrichten', () => {
    const cases: [string, string][] = [
      ['Bis 16 Uhr haben 55,7 % abgestimmt.', 'Bis sechzehn Uhr haben fünfundfünfzig Komma sieben Prozent abgestimmt.'],
      ['Ausgeliefert ab 6. November.', 'Ausgeliefert ab sechsten November.'],
      ['Der 3. Oktober ist ein Feiertag.', 'Der dritte Oktober ist ein Feiertag.'],
      ['Um 18:30 Uhr und um 22:00.', 'Um achtzehn Uhr dreißig und um zweiundzwanzig Uhr.'],
      ['Seit 1973, bis 2028.', 'Seit neunzehnhundertdreiundsiebzig, bis zweitausendachtundzwanzig.'],
      ['Mehr als 2.000 Menschen, ein iMac für 1.499 Dollar.', 'Mehr als zweitausend Menschen, ein iMac für eintausendvierhundertneunundneunzig Dollar.'],
      ['Der DAX −2,3 %, der Nasdaq +0,8 %.', 'Der DAX minus zwei Komma drei Prozent, der Nasdaq plus null Komma acht Prozent.'],
      ['Meta will 95 Mrd. $ aufnehmen.', 'Meta will fünfundneunzig Milliarden Dollar aufnehmen.'],
      ['S&P 500 und M6-Chip, 1,9-mal so schnell.', 'S und P fünfhundert und M sechs Chip, eins Komma neun mal so schnell.'],
      ['1 Million Euro, 1 Prozent, Platz 1.', 'eine Million Euro, ein Prozent, Platz eins.'],
      ['KI-Nachrichten aus der EU, z. B. von der CDU.', 'Ka-I-Nachrichten aus der E-U, zum Beispiel von der Ze-De-U.']
    ];
    for (const [a, b] of cases) expect(sprechtext(a)).toBe(b);
    // Für den Vergleich mit Whisper bleiben Abkürzungen stehen
    expect(sprechtext('KI in der EU', { spell: false })).toBe('KI in der EU');
    // Wörter, die wie Abkürzungen beginnen, bleiben
    expect(sprechtext('Kiel und Europa')).toBe('Kiel und Europa');
  });
});
