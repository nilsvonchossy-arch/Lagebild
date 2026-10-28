import { describe, expect, it } from 'vitest';
import quellen from '../config/quellen.json';
import themen from '../config/themen.json';
import { migrateConfig, slugify, validateConfig, type ThemenConfig } from '../src/shared/config';

const cfg = migrateConfig(themen);

describe('config/themen.json', () => {
  it('ist gültig', () => {
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('verweist nur auf vorhandene Feeds', () => {
    const ids = new Set(quellen.feeds.map(f => f.id));
    for (const t of cfg.topics) for (const f of t.feeds) expect(ids.has(f), `${t.id} → ${f}`).toBe(true);
  });

  it('hat eindeutige Feed-IDs und https-Adressen', () => {
    const ids = quellen.feeds.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of quellen.feeds) expect(f.url).toMatch(/^https:\/\//);
  });
});

describe('validateConfig', () => {
  const clone = (): ThemenConfig => structuredClone(cfg);

  it('meldet unbekannte Kategorien und fehlende Suchbegriffe', () => {
    const c = clone();
    c.topics.push({ id: 'x', name: 'X', category: 'gibtsnicht', weight: 'normal', search: [], feeds: [] });
    const errs = validateConfig(c);
    expect(errs.some(e => e.includes('unbekannte Kategorie'))).toBe(true);
    expect(errs.some(e => e.includes('Suchbegriffe oder Feeds'))).toBe(true);
  });

  it('meldet doppelte IDs und ungültige Gewichtungen', () => {
    const c = clone();
    c.topics.push({ ...c.topics[0]!, weight: 'hoch' as never });
    const errs = validateConfig(c);
    expect(errs.some(e => e.includes('ID doppelt'))).toBe(true);
    expect(errs.some(e => e.includes('Gewichtung'))).toBe(true);
  });

  it('prüft Länge und Ton der Folge', () => {
    const c = clone();
    c.episode = { minutes: 30, tone: 'radio' as never };
    const errs = validateConfig(c);
    expect(errs.some(e => e.includes('minutes'))).toBe(true);
    expect(errs.some(e => e.includes('tone'))).toBe(true);
  });

  it('verlangt mindestens ein eingeschaltetes Thema', () => {
    const c = clone();
    for (const t of c.topics) t.weight = 'aus';
    expect(validateConfig(c)).toContain('Mindestens ein Thema muss eingeschaltet sein');
  });

  it('lehnt Unsinn ab', () => {
    expect(validateConfig(null)).toEqual(['Konfiguration fehlt']);
    expect(validateConfig({ version: 3 }).length).toBeGreaterThan(0);
  });
});

describe('slugify', () => {
  it('macht lesbare, eindeutige IDs', () => {
    expect(slugify('KI & Arbeit')).toBe('ki-arbeit');
    expect(slugify('Wärmepumpen Förderung')).toBe('waermepumpen-foerderung');
    expect(slugify('Straße')).toBe('strasse');
    expect(slugify('KI & Arbeit', ['ki-arbeit'])).toBe('ki-arbeit-2');
    expect(slugify('!!!')).toBe('thema');
  });
});

describe('migrateConfig', () => {
  it('übersetzt Priorität und aktiv aus Version 1 in vier Stufen', () => {
    const v1 = {
      version: 1, stories: { min: 5, max: 7 },
      categories: [{ id: 'k', name: 'K', color: '#123456' }],
      topics: [
        { id: 'a', name: 'A', category: 'k', priority: 3, active: true, search: ['x'], feeds: [] },
        { id: 'b', name: 'B', category: 'k', priority: 2, active: true, search: ['x'], feeds: [] },
        { id: 'c', name: 'C', category: 'k', priority: 1, active: true, search: ['x'], feeds: [] },
        { id: 'd', name: 'D', category: 'k', priority: 3, active: false, search: ['x'], feeds: [] }
      ]
    };
    const c = migrateConfig(v1);
    expect(c.version).toBe(2);
    expect(c.episode).toEqual({ minutes: 3, tone: 'lagezentrum' });
    expect(c.topics.map(t => t.weight)).toEqual(['ausfuehrlich', 'normal', 'kurz', 'aus']);
    expect(c.topics[0]).not.toHaveProperty('priority');
    expect(validateConfig(c)).toEqual([]);
  });

  it('lässt Version 2 unverändert', () => {
    expect(migrateConfig(cfg)).toBe(cfg);
  });
});
