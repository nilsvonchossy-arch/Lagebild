// Einblendungen beim passenden Wort: Vergleich als Balken, Termin als Uhr oder Kalenderblatt,
// Archivbild mit Urheber und Lizenz, Symbol der Meldung. Immer nur eine zugleich; die nächste ersetzt sie.
// Alle Zahlen und Zeiten stammen aus geprüften Fakten; Archivbilder sind als solche beschriftet.
import { symbolSVG } from './icons';
import { SYMBOL_LABEL } from './shared/symbols';
import { countUp, fmtNum } from './fx';
import type { ArchiveImage, Comparison, Deadline, SymbolId } from './shared/types';
import { $, dateParts, esc, sleep, speed } from './util';

const MONTH_SHORT = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];

export function comparisonHTML(c: Comparison): string {
  const max = Math.max(...c.items.map(i => Math.abs(i.value)), 1e-9);
  const rows = c.items.map((it, k) => `<div class="vz-row">
      <span class="vz-lab">${esc(it.label)}</span>
      <span class="vz-bar${it.value < 0 ? ' neg' : ''}"><i style="--w:${(Math.abs(it.value) / max).toFixed(3)};--d:${(0.15 + k * 0.18).toFixed(2)}s"></i></span>
      <b class="vz-num" data-v="${it.value}" data-dec="${c.dec}" data-unit="${esc(c.unit)}">${esc(fmtNum(it.value, { value: it.value, dec: c.dec, suffix: c.unit, label: '' }))}</b>
    </div>`).join('');
  return `<div class="vz-kind">Vergleich</div><div class="vz-title">${esc(c.label)}</div><div class="vz-bars">${rows}</div>`;
}

/** Zifferblatt mit Zeigern auf der Uhrzeit */
function clockSVG(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const ha = ((h % 12) + m / 60) * 30, ma = m * 6;
  const ticks = Array.from({ length: 12 }, (_, i) => `<path d="M32 6v${i % 3 ? 3 : 5}" transform="rotate(${i * 30} 32 32)"/>`).join('');
  return `<svg class="vz-clock" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/>${ticks}
    <path class="hh" d="M32 32V17" style="--a:${ha}deg"/><path class="mm" d="M32 32V10" style="--a:${ma}deg"/><circle class="dot" cx="32" cy="32" r="2"/></svg>`;
}

export function deadlineHTML(d: Deadline): string {
  let big = '';
  if (d.time) big += `<div class="vz-time">${clockSVG(d.time)}<b>${esc(d.time)}</b></div>`;
  if (d.date) {
    const p = dateParts(d.date);
    big += `<div class="vz-cal"><span>${MONTH_SHORT[p.month - 1]}</span><b>${p.day}</b></div>`;
  }
  return `<div class="vz-kind">Termin</div><div class="vz-when">${big}</div><div class="vz-title">${esc(d.label)}</div>`;
}

export function imageHTML(img: ArchiveImage, base: string): string {
  return `<div class="vz-kind">Archivbild</div>
    <figure class="vz-img"><img src="${esc(base + img.src)}" width="${img.w}" height="${img.h}" alt="${esc(img.motif)}" decoding="async">
      <figcaption><b>${esc(img.motif)}</b><span>Foto: ${esc(img.author)} · ${esc(img.license)} · Wikimedia Commons</span></figcaption>
    </figure>`;
}

export function symbolHTML(id: SymbolId, topic: string): string {
  return `<div class="vz-kind">${esc(topic)}</div><div class="vz-sym">${symbolSVG(id)}<span>${esc(SYMBOL_LABEL[id])}</span></div>`;
}

/** Bild vorladen; false, wenn es nicht rechtzeitig kommt (offline, gelöscht). */
function preload(src: string, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    const t = setTimeout(() => resolve(img.complete && img.naturalWidth > 0), ms);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = src;
  });
}

export class Viz {
  private readonly el = $('#viz');
  private timer = 0;
  private gen = 0;

  /** Einblendung zeigen und nach `ms` wieder ausblenden; eine neue ersetzt die alte. */
  show(html: string, acc: string, ms: number): void {
    const my = ++this.gen;
    clearTimeout(this.timer);
    const el = this.el;
    el.style.setProperty('--acc', acc);
    el.innerHTML = `<div class="vz">${html}</div>`;
    el.dataset.state = 'hidden';
    void el.offsetWidth;
    el.dataset.state = 'in';
    for (const n of el.querySelectorAll<HTMLElement>('.vz-num')) {
      countUp(n, { value: Number(n.dataset.v), dec: Number(n.dataset.dec), suffix: n.dataset.unit ?? '', label: '' }, 1000);
    }
    this.timer = window.setTimeout(() => { if (my === this.gen) void this.hide(); }, ms / speed());
  }

  async showImage(img: ArchiveImage, base: string, acc: string, ms: number): Promise<void> {
    const my = ++this.gen;
    if (!(await preload(base + img.src, 1500))) return;
    if (my !== this.gen) return;
    this.show(imageHTML(img, base), acc, ms);
  }

  async hide(): Promise<void> {
    ++this.gen;
    clearTimeout(this.timer);
    const el = this.el;
    if (el.dataset.state !== 'in') return;
    el.dataset.state = 'out';
    const my = this.gen;
    await sleep(400);
    if (my === this.gen && el.dataset.state === 'out') { el.dataset.state = 'hidden'; el.innerHTML = ''; }
  }
}
