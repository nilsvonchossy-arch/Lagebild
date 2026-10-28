// Text-Effekte: Entschlüsseln, Hochzählen, Untertitel als Blöcke.
import { subtitleBlocks, type Block } from './shared/script';
import type { Figure, Role } from './shared/types';
import { reduceMotion, speed } from './util';

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

export function countUp(el: HTMLElement, f: Figure, ms = 1100): void {
  if (reduceMotion()) { el.textContent = fmtNum(f.value, f); return; }
  const t0 = performance.now();
  const D = ms / speed();
  const tick = (now: number): void => {
    const k = Math.min(1, (now - t0) / D);
    el.textContent = fmtNum(f.value * (1 - Math.pow(1 - k, 3)), f);
    if (k < 1) requestAnimationFrame(tick);
  };
  tick(t0);
}

const ROLE_LABEL: Record<Role, string> = { LEITUNG: 'LEITUNG', LAGE: 'LAGE', EINORDNUNG: 'EINORDNUNG' };

/**
 * Untertitel: Jede Zeile wird in Blöcke mit 6–10 Wörtern geteilt (an Atempausen). Ein Block erscheint
 * als Ganzes, sobald die Stimme ihn erreicht; den Fortschritt liefert der Player (Anteil am Text).
 */
export class Subtitle {
  private blocks: Block[] = [];
  private shown = -1;

  constructor(
    private readonly box: HTMLElement,
    private readonly roleEl: HTMLElement,
    private readonly textEl: HTMLElement
  ) {}

  /** `label` ersetzt den Rollennamen, z. B. „LAGEBILD“ für den Assistenten */
  show(role: Role, text: string, label?: string): void {
    this.box.classList.remove('off');
    this.roleEl.dataset.role = role;
    this.roleEl.textContent = label ?? ROLE_LABEL[role];
    this.blocks = subtitleBlocks(text);
    this.shown = -1;
    this.update(0);
  }

  /** Anteil 0..1 des gesprochenen Textes; zeigt den Block, in dem die Stimme gerade ist. */
  update(frac: number): void {
    let k = this.blocks.findIndex(b => frac < b.to);
    if (k === -1) k = this.blocks.length - 1;
    if (k === this.shown || k < 0) return;
    this.shown = k;
    this.textEl.textContent = this.blocks[k]!.text;
    this.textEl.classList.remove('in');
    void this.textEl.offsetWidth;
    this.textEl.classList.add('in');
  }

  hide(): void {
    this.box.classList.add('off');
    this.shown = -1;
  }
}
