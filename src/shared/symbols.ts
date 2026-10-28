// Symbole der Meldungen: Namen, Beschriftung und Zuordnung. Die Zeichnungen liegen in src/icons.ts.
import { SYMBOLS, type SymbolId } from './types.ts';

export const SYMBOL_LABEL: Record<SymbolId, string> = {
  wahl: 'Wahl', parlament: 'Parlament', regierung: 'Regierung', diplomatie: 'Diplomatie', gericht: 'Justiz',
  sicherheit: 'Sicherheit', geld: 'Finanzen', boerse: 'Börse', handel: 'Handel', fabrik: 'Industrie', arbeit: 'Arbeit',
  energie: 'Energie', klima: 'Klima', medizin: 'Gesundheit', forschung: 'Forschung', ki: 'KI', chip: 'Technik',
  cyber: 'Cybersicherheit', raumfahrt: 'Raumfahrt', verkehr: 'Verkehr', bildung: 'Bildung'
};

export const isSymbol = (s: unknown): s is SymbolId => typeof s === 'string' && (SYMBOLS as readonly string[]).includes(s);

/** Ersatz, wenn eine Meldung kein Symbol hat: nach Kategorie */
export function fallbackSymbol(category: string): SymbolId {
  return ({ geopolitik: 'diplomatie', deutschland: 'regierung', wirtschaft: 'boerse', ki: 'ki', wissen: 'forschung' } as Record<string, SymbolId>)[category] ?? 'diplomatie';
}

/** Antwort des Modells auf ein Symbol abbilden („Börse“, „boerse.“ → boerse), sonst nach Kategorie. */
export function normalizeSymbol(raw: string, category: string): SymbolId {
  const k = raw.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]/g, '');
  if (isSymbol(k)) return k;
  const byLabel = (Object.entries(SYMBOL_LABEL) as [SymbolId, string][]).find(([, l]) => l.toLowerCase().replace(/ö/g, 'oe') === k);
  return byLabel?.[0] ?? fallbackSymbol(category);
}
