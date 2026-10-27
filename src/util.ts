// Kleine Helfer, die überall gebraucht werden.

export function $<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Element fehlt: ${sel}`);
  return el;
}

export const reduceMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Testhaken: window.__lagebildSpeed = 4 lässt alle Animationen 4× schneller laufen. */
export const speed = (): number => (window as unknown as { __lagebildSpeed?: number }).__lagebildSpeed || 1;

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms / speed()));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export const pad2 = (n: number): string => String(n).padStart(2, '0');

const MONTHS_SHORT = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** "2026-10-27" → Datumsteile für die Anzeige (ohne Zeitzonen-Verschiebung). */
export function dateParts(iso: string): { day: number; month: number; year: number; weekday: string; monthName: string; short: string } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { day: d, month: m, year: y, weekday: WEEKDAYS[wd]!, monthName: MONTHS[m - 1]!, short: MONTHS_SHORT[m - 1]! };
}

/** "2026-10-21" → "21.10." */
export function shortDate(iso: string): string {
  const p = dateParts(iso);
  return `${pad2(p.day)}.${pad2(p.month)}.`;
}
