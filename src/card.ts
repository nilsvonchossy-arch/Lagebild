// Karte im unteren Drittel: runde Flagge, Ort in breiten Versalien, eine Zeile, Zähler.
// „Kurz gesagt“, Zahl und Quelle stehen in den Details (Tippen auf die Karte) und auf dem Endbildschirm.
import { fmtNum, scramble } from './fx';
import type { Category, Markets, Story } from './shared/types';
import { $, esc, pad2, shortDate, sleep } from './util';

/** "[Israel] wählt" → [..] in Akzentfarbe, Wörter einzeln einblenden. */
export function headlineHTML(h: string, base: number): string {
  const marked = h.replace(/\[([^\]]+)\]/g, (_m, inner: string) => inner.split(/\s+/).map(w => `[${w}]`).join(' '));
  return marked
    .split(/\s+/)
    .map((word, i) => `<span class="w" style="--d:${(base + i * 0.05).toFixed(2)}s">${esc(word).replace(/\[([^\]]+)\]/g, '<span class="hl">$1</span>')}</span>`)
    .join(' ');
}

export const plainHeadline = (h: string): string => h.replace(/[[\]]/g, '');

export function relevanceHTML(r: number | undefined): string {
  if (!r) return '';
  const n = Math.max(1, Math.min(5, Math.round(r)));
  return `<span class="rel" title="Relevanz ${n} von 5 (Einschätzung)" aria-label="Relevanz ${n} von 5">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span>`;
}

export const categoryColor = (cats: Category[], id: string): string => cats.find(c => c.id === id)?.color ?? '#ff7a3d';

const FORMAT_LABEL = { aufmacher: 'Aufmacher', meldung: 'Meldung', kurz: 'Kurz notiert' } as const;
export const formatLabel = (s: Story): string => FORMAT_LABEL[s.format] ?? '';

const pct = (v: number): string => `${v > 0 ? '+' : ''}${v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

export function marketsHTML(m: Markets): string {
  return m.items.map(it => {
    const dir = Math.abs(it.changePct) < 0.05 ? 'flat' : it.changePct > 0 ? 'up' : 'down';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
    return `<div class="mrow"><span class="mname">${esc(it.name)}</span><span class="mval">${it.value.toLocaleString('de-DE', { minimumFractionDigits: it.dec, maximumFractionDigits: it.dec })}<small> ${esc(it.unit)}</small></span><span class="mch ${dir}">${arrow} ${dir === 'flat' ? '0,0 %' : pct(it.changePct)}</span></div>`;
  }).join('');
}

/** Details einer Meldung: Kurz gesagt, Zahl, Quelle mit Link und Datum. */
export function detailsHTML(s: Story, cats: Category[]): string {
  const c = categoryColor(cats, s.category);
  return `<article class="det" style="--acc:${c}">
    <div class="det-top"><span class="tag">${esc(s.topic)}</span><span class="det-fmt">${esc(formatLabel(s))}</span>${relevanceHTML(s.relevance)}</div>
    <h3 class="det-head"><span class="flag">${s.flag}</span><span>${headlineHTML(s.headline, 0)}</span></h3>
    <p class="det-brief"><b>Kurz gesagt:</b> ${esc(s.brief)}</p>
    ${s.figure ? `<div class="det-fig"><span class="fig-num">${esc(fmtNum(s.figure.value, s.figure))}</span><span class="fig-label">${esc(s.figure.label)}</span></div>` : ''}
    <a class="src" href="${esc(s.source.url)}" target="_blank" rel="noopener">Quelle <span class="sep"></span> <b>${esc(s.source.name)}</b> <span class="src-date">${shortDate(s.source.date)}</span> ↗</a>
  </article>`;
}

export class Card {
  private readonly el = $('#card');
  /** Meldung, die gerade auf der Karte steht (für die Details beim Tippen) */
  story: Story | null = null;

  show(s: Story, i: number, total: number, cats: Category[]): void {
    const c = this.el;
    this.story = s;
    c.dataset.kind = 'story';
    c.style.setProperty('--acc', categoryColor(cats, s.category));
    $('#cMarkets').hidden = true;
    $('#cFlag').textContent = s.flag;
    $('#cCount').textContent = `${pad2(i + 1)}/${pad2(total)}`;
    $('#cLine').innerHTML = headlineHTML(s.headline, 0.3);
    $('#cLine').hidden = false;
    this.open();
    scramble($('#cPlace'), s.label, 550);
  }

  showMarkets(m: Markets, color: string): void {
    const c = this.el;
    this.story = null;
    c.dataset.kind = 'markets';
    c.style.setProperty('--acc', color);
    $('#cFlag').textContent = '📈';
    $('#cCount').textContent = `STAND ${shortDate(m.asOf)}`;
    $('#cLine').hidden = true;
    const grid = $('#cMarkets');
    grid.hidden = false;
    grid.innerHTML = marketsHTML(m);
    this.open();
    scramble($('#cPlace'), 'MÄRKTE', 550);
  }

  private open(): void {
    const c = this.el;
    c.dataset.state = 'hidden';
    void c.offsetWidth;
    c.dataset.state = 'in';
  }

  async hide(): Promise<void> {
    const c = this.el;
    if (c.dataset.state !== 'in') return;
    c.dataset.state = 'out';
    await sleep(450);
    if (c.dataset.state === 'out') c.dataset.state = 'hidden';
  }

  get visible(): boolean {
    return this.el.dataset.state === 'in';
  }
}
