import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import topo110 from 'world-atlas/countries-110m.json';
import topo50 from 'world-atlas/countries-50m.json';
import demo from '../public/demo/2026-10-27.json';
import { headlineHTML, plainHeadline, relevanceHTML } from '../src/card';
import { buildLayer, countryInfo, findCountry, flagEmoji } from '../src/geo/world';
import type { Briefing } from '../src/shared/types';
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

describe('Demo-Daten', () => {
  const b = demo as Briefing;
  it('erfüllt das Schema', () => {
    expect(b.schema).toBe(1);
    const cats = new Set(b.categories.map(c => c.id));
    for (const s of b.stories) {
      expect(cats.has(s.category), s.id).toBe(true);
      expect(countryInfo(s.country), s.id).not.toBeNull();
      expect(s.source.url).toMatch(/^https:\/\//);
      expect(s.source.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.opener.role).toBe('BRIEFING');
      expect(s.lines.length).toBeGreaterThan(0);
      for (const l of s.lines) expect(['LAGE', 'EINORDNUNG']).toContain(l.role);
    }
  });
});
