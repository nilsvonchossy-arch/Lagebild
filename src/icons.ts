// Symbole für Meldungen ohne eigenes Bild: eigene, schlichte Linienzeichnungen (24×24, nur Striche).
import type { SymbolId } from './shared/types';

const PATHS: Record<SymbolId, string> = {
  wahl: '<path d="M3 13h18v7H3z"/><path d="M7 13V4h10v9"/><path d="M10 8.5l1.8 1.8L15 6.5"/>',
  parlament: '<path d="M3 20h18"/><path d="M5 20v-8M9 20v-8M15 20v-8M19 20v-8"/><path d="M4 12h16"/><path d="M6.5 12a5.5 5.5 0 0 1 11 0"/><path d="M12 6.5V3"/>',
  regierung: '<path d="M5 21V3"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  diplomatie: '<path d="M3 5h11v7H7.5L3 15z"/><path d="M17 9h4v9l-3.5-3H10v-3"/>',
  gericht: '<path d="M12 4v16"/><path d="M8 20h8"/><path d="M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0z"/>',
  sicherheit: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  geld: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6.5 9.5h.01M17.5 14.5h.01"/>',
  boerse: '<path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>',
  handel: '<path d="M3 15h18l-2 5H5z"/><path d="M6 10h5v5H6zM11 10h5v5h-5zM8.5 5h5v5h-5z"/>',
  fabrik: '<path d="M3 21V11l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 18h2M12 18h2"/>',
  arbeit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M3 12h18"/>',
  energie: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  klima: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  medizin: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  forschung: '<path d="M9 3h6"/><path d="M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3"/><path d="M7 15h10"/>',
  ki: '<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  cyber: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
  raumfahrt: '<path d="M12 2c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10z"/><circle cx="12" cy="10" r="2"/><path d="M9 16l-3 4M15 16l3 4"/>',
  verkehr: '<path d="M5 15l1.6-4.6A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.4L19 15"/><rect x="3" y="15" width="18" height="4" rx="1"/><path d="M6 19v2M18 19v2"/>',
  bildung: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/><path d="M22 9v6"/>'
};

export function symbolSVG(id: SymbolId): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[id]}</svg>`;
}
