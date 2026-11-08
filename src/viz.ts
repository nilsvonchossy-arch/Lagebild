// Einblendungen beim passenden Wort: Vergleich als Balken, Termin als Uhr oder Kalenderblatt,
// Archivbild mit Urheber und Lizenz, Symbol der Meldung, dazu die Erklär-Grafiken Vorgeschichte (Zeitleiste),
// „Wer steht wo“ (Akteure mit Position) und Ursache und Wirkung (Kette). Immer nur eine zugleich; die nächste
// ersetzt sie. Alle Zahlen, Zeiten, Namen und Zusammenhänge stammen aus geprüften Fakten; Archivbilder sind als
// solche beschriftet. Keine Aufnahmen vom Ereignis selbst.
import { symbolSVG } from './icons';
import { NOW_DATE } from './shared/script';
import { SYMBOL_LABEL } from './shared/symbols';
import { countUp, fmtNum } from './fx';
import type { Actor, ArchiveImage, ChainStep, Comparison, Deadline, SymbolId, TimelineEntry } from './shared/types';
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

/** Zustand eines Eintrags: schon erzählt, gerade dran, noch nicht */
const stepState = (k: number, active: number): string => (k < active ? 'done' : k === active ? 'on' : '');

/** Vorgeschichte als senkrechte Zeitleiste; die Linie wächst bis zum Eintrag, der gerade erzählt wird. */
export function timelineHTML(t: TimelineEntry[], active: number): string {
  const rows = t.map((e, k) => {
    const now = NOW_DATE.test(e.date);
    return `<li class="vz-step${now ? ' now' : ''} ${stepState(k, active)}" data-i="${k}" style="--d:${(0.12 + k * 0.14).toFixed(2)}s">
      <i class="vz-dot"></i><b>${esc(now ? 'Heute' : e.date)}</b><span>${esc(e.label)}</span>
    </li>`;
  }).join('');
  return `<div class="vz-kind">Vorgeschichte</div><ol class="vz-tl">${rows}</ol>`;
}

/** Kürzel für das runde Namensschild: Anfangsbuchstaben der ersten zwei Wörter */
export const initials = (name: string): string =>
  name.split(/[\s-]+/).filter(w => /^\p{L}/u.test(w)).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '•';

/** „Wer steht wo“: Beteiligte mit Rolle und Position; wer gerade genannt wird, ist hervorgehoben. */
export function actorsHTML(a: Actor[], active: number): string {
  const rows = a.map((x, k) => `<li class="vz-step vz-act ${k === active ? 'on' : ''}" data-i="${k}" style="--d:${(0.1 + k * 0.16).toFixed(2)}s">
      <span class="vz-ini" aria-hidden="true">${esc(initials(x.name))}</span>
      <div><span class="vz-who"><b>${esc(x.name)}</b><small>${esc(x.role)}</small></span><p>${esc(x.position)}</p></div>
    </li>`).join('');
  return `<div class="vz-kind">Wer steht wo</div><ul class="vz-acts">${rows}</ul>`;
}

/** Abstand, in dem die Schritte der Kette nacheinander erscheinen (Sekunden) */
const CHAIN_STEP = 0.6;

/** Ursache und Wirkung als Kette von oben nach unten: Ursache, Pfeil zeichnet sich ein, Wirkung – bis zum letzten Schritt. */
export function chainHTML(c: ChainStep[]): string {
  const rows = c.map((s, k) => `${k ? `<li class="vz-arrow done" aria-hidden="true" style="--d:${(0.15 + k * CHAIN_STEP - CHAIN_STEP / 2).toFixed(2)}s"><svg viewBox="0 0 24 24"><path d="M12 3v15M6 13l6 6 6-6"/></svg></li>` : ''}
    <li class="vz-step vz-link ${k === c.length - 1 ? 'on' : 'done'}" data-i="${k}" style="--d:${(0.15 + k * CHAIN_STEP).toFixed(2)}s"><span>${esc(s.label)}</span></li>`).join('');
  return `<div class="vz-kind">Ursache und Wirkung</div><ol class="vz-chain">${rows}</ol>`;
}

/** Einträge einer Erklär-Grafik neu markieren, ohne sie neu aufzubauen. */
export function markSteps(root: ParentNode, active: number, mode: 'progress' | 'single'): void {
  for (const n of root.querySelectorAll<HTMLElement>('.vz-step')) {
    const k = Number(n.dataset.i);
    n.classList.toggle('on', k === active);
    n.classList.toggle('done', mode === 'progress' && k < active);
  }
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

/** So lange steht eine Einblendung mindestens, bevor die nächste sie ersetzt (ms bei normalem Tempo) */
export const MIN_SHOW = 2200;

export class Viz {
  private readonly el = $('#viz');
  /** blendet die aktuelle Einblendung aus */
  private timer = 0;
  /** zeigt eine nachgereichte Einblendung, sobald die aktuelle lange genug stand */
  private pending = 0;
  private gen = 0;
  private shownAt = 0;
  /** Schlüssel der gezeigten Erklär-Grafik (z. B. „timeline:israel“), damit weitere Einträge sie nur weiterschalten */
  private key = '';

  /**
   * Einblendung zeigen und nach `ms` wieder ausblenden; eine neue ersetzt die alte, aber erst, wenn die alte
   * mindestens MIN_SHOW stand (sonst flackert es, wenn zwei Stichworte kurz hintereinander fallen).
   */
  show(html: string, acc: string, ms: number, key = ''): void {
    const my = ++this.gen;
    clearTimeout(this.pending);
    const wait = this.el.dataset.state === 'in' && key !== this.key ? MIN_SHOW - (performance.now() - this.shownAt) * speed() : 0;
    if (wait > 0) {
      clearTimeout(this.timer);
      this.pending = window.setTimeout(() => { if (my === this.gen) this.render(html, acc, ms, key, my); }, wait / speed());
      return;
    }
    this.render(html, acc, ms, key, my);
  }

  private render(html: string, acc: string, ms: number, key: string, my: number): void {
    clearTimeout(this.timer);
    clearTimeout(this.pending);
    this.pending = 0;
    this.key = key;
    const el = this.el;
    el.style.setProperty('--acc', acc);
    el.innerHTML = `<div class="vz">${html}</div>`;
    el.dataset.state = 'hidden';
    void el.offsetWidth;
    el.dataset.state = 'in';
    this.shownAt = performance.now();
    for (const n of el.querySelectorAll<HTMLElement>('.vz-num')) {
      countUp(n, { value: Number(n.dataset.v), dec: Number(n.dataset.dec), suffix: n.dataset.unit ?? '', label: '' }, 1000);
    }
    this.fit();
    this.timer = window.setTimeout(() => { if (my === this.gen) void this.hide(); }, ms / speed());
  }

  /**
   * Erklär-Grafik in den Platz einpassen: Läuft sie über (Handy hochkant, viele Einträge), zuerst kompakt
   * (Nebentexte nur beim aktuellen Eintrag), dann so weit rollen, dass der aktuelle Eintrag zu sehen ist.
   */
  private fit(): void {
    const z = this.el.querySelector<HTMLElement>('.vz');
    if (!z?.querySelector('.vz-step')) return;
    z.classList.remove('tight');
    if (z.scrollHeight <= z.clientHeight + 1) return;
    z.classList.add('tight');
    const steps = [...z.querySelectorAll<HTMLElement>('.vz-step')];
    const on = z.querySelector<HTMLElement>('.vz-step.on') ?? steps[steps.length - 1]!;
    const over = on.getBoundingClientRect().bottom - z.getBoundingClientRect().bottom + 14;
    if (over > 0 || z.scrollTop > 0) z.scrollTo({ top: Math.max(0, z.scrollTop + over), behavior: 'smooth' });
  }

  /**
   * Erklär-Grafik weiterschalten: Eintrag `active` hervorheben und die Standzeit auf `ms` verlängern.
   * false, wenn diese Grafik gerade nicht steht (dann zeigt der Aufrufer sie neu).
   */
  step(key: string, active: number, mode: 'progress' | 'single', ms: number): boolean {
    if (this.pending) return true;
    if (!key || this.key !== key || this.el.dataset.state !== 'in') return false;
    markSteps(this.el, active, mode);
    this.fit();
    const my = this.gen;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { if (my === this.gen) void this.hide(); }, ms / speed());
    return true;
  }

  async showImage(img: ArchiveImage, base: string, acc: string, ms: number): Promise<void> {
    const my = ++this.gen;
    if (!(await preload(base + img.src, 1500))) return;
    if (my !== this.gen) return;
    this.show(imageHTML(img, base), acc, ms);
  }

  /** Beim Themenwechsel: eine gerade erst erschienene Einblendung noch kurz stehen lassen (mindestens 2,2 s insgesamt). */
  release(): void {
    clearTimeout(this.pending);
    this.pending = 0;
    if (this.el.dataset.state !== 'in') { void this.hide(); return; }
    const rest = Math.min(1500, MIN_SHOW - (performance.now() - this.shownAt) * speed());
    if (rest <= 0) { void this.hide(); return; }
    const my = ++this.gen;
    this.key = '';
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { if (my === this.gen) void this.hide(); }, rest / speed());
  }

  async hide(): Promise<void> {
    ++this.gen;
    clearTimeout(this.timer);
    clearTimeout(this.pending);
    this.pending = 0;
    this.key = '';
    const el = this.el;
    if (el.dataset.state !== 'in') return;
    el.dataset.state = 'out';
    const my = this.gen;
    await sleep(400);
    if (my === this.gen && el.dataset.state === 'out') { el.dataset.state = 'hidden'; el.innerHTML = ''; }
  }
}
