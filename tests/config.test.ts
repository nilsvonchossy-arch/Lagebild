import { describe, expect, it } from 'vitest';
import quellen from '../config/quellen.json';
import themen from '../config/themen.json';
import { slugify, validateConfig, type ThemenConfig } from '../src/shared/config';

const cfg = themen as unknown as ThemenConfig;

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
    c.topics.push({ id: 'x', name: 'X', category: 'gibtsnicht', priority: 2, active: true, search: [], feeds: [] });
    const errs = validateConfig(c);
    expect(errs.some(e => e.includes('unbekannte Kategorie'))).toBe(true);
    expect(errs.some(e => e.includes('Suchbegriffe oder Feeds'))).toBe(true);
  });

  it('meldet doppelte IDs und ungültige Prioritäten', () => {
    const c = clone();
    c.topics.push({ ...c.topics[0]!, priority: 5 as never });
    const errs = validateConfig(c);
    expect(errs.some(e => e.includes('ID doppelt'))).toBe(true);
    expect(errs.some(e => e.includes('Priorität'))).toBe(true);
  });

  it('lehnt Unsinn ab', () => {
    expect(validateConfig(null)).toEqual(['Konfiguration fehlt']);
    expect(validateConfig({ version: 2 }).length).toBeGreaterThan(0);
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
