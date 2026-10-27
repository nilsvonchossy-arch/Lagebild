// Text-Effekte: Entschlüsseln, Hochzählen, Untertitel mit Schreibmaschine.
import type { Figure, Role } from './shared/types';
import { esc, reduceMotion, speed } from './util';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&@0123456789';

/** Titel „entschlüsseln“: zufällige Zeichen, die von links nach rechts zum Klartext werden. */
export function scramble(el: HTMLElement, final: string, dur = 700): void {
  if (reduceMotion()) { el.textContent = final; return; }
  const t0 = performance.now();
  const D = dur / speed();
  const tick = (now: number): void => {
    const k = Math.min(1, (now - t0) / D);
    const n = Math.floor(final.length * k);
    let out = final.slice(0, n);
    for (let i = n; i < final.length; i++) out += /[\s/·]/.test(final[i]!) ? final[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (k < 1) requestAnimationFrame(tick);
  };
  tick(t0);
}

export const fmtNum = (v: number, f: Figure): string =>
  (f.prefix ?? '') + v.toLocaleString('de-DE', { minimumFractionDigits: f.dec, maximumFractionDigits: f.dec }) + (f.suffix ?? '');

export function countUp(el: HTMLElement, f: Figure): void {
  if (reduceMotion()) { el.textContent = fmtNum(f.value, f); return; }
  const t0 = performance.now();
  const D = 1300 / speed();
  const tick = (now: number): void => {
    const k = Math.min(1, (now - t0) / D);
    el.textContent = fmtNum(f.value * (1 - Math.pow(1 - k, 3)), f);
    if (k < 1) requestAnimationFrame(tick);
  };
  tick(t0);
}

/**
 * Untertitel. Der noch nicht gesprochene Rest steht unsichtbar im Text, damit sich der Umbruch
 * beim Tippen nicht verschiebt. Fortschritt kommt von außen (Audio-Position) oder per Timer.
 */
export class Caption {
  private text = '';
  private shown = -1;
  private timer = 0;

  constructor(
    private readonly box: HTMLElement,
    private readonly roleEl: HTMLElement,
    private readonly textEl: HTMLElement
  ) {}

  show(role: Role, text: string): void {
    this.stop();
    this.box.classList.remove('off');
    this.roleEl.dataset.role = role;
    this.roleEl.textContent = role;
    this.text = text;
    this.shown = -1;
    this.reveal(reduceMotion() ? 1 : 0);
  }

  /** Anteil 0..1 des Textes sichtbar machen, auf Wortgrenzen gerundet. */
  reveal(frac: number): void {
    const len = this.text.length;
    let n = Math.round(Math.max(0, Math.min(1, frac)) * len);
    if (n < len && n > 0) {
      const next = this.text.indexOf(' ', n);
      n = next === -1 ? len : next;
    }
    if (n === this.shown) return;
    this.shown = n;
    this.textEl.innerHTML = esc(this.text.slice(0, n)) + '<span class="ghost">' + esc(this.text.slice(n)) + '</span>';
  }

  /** Ohne Zeitmarken: Text gleichmäßig über `ms` eintippen. */
  typeOver(ms: number): void {
    this.stop();
    if (reduceMotion()) { this.reveal(1); return; }
    const t0 = performance.now();
    const D = Math.max(200, ms / speed());
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / D);
      this.reveal(k);
      if (k < 1) this.timer = requestAnimationFrame(tick);
    };
    this.timer = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.timer);
  }

  hide(): void {
    this.stop();
    this.box.classList.add('off');
  }
}
