// Meldungskarte im Netwatch-Stil: Themen-Tag, Headline mit Akzentwörtern, „Kurz gesagt“, Zahl, Quelle.
import { countUp, fmtNum, scramble } from './fx';
import type { Category, Markets, Story } from './shared/types';
import { $, esc, pad2, shortDate, sleep } from './util';

/** "[Israel] wählt" → Wörter einzeln einblenden, [..] in Akzentfarbe. */
export function headlineHTML(h: string, base: number): string {
  const marked = h.replace(/\[([^\]]+)\]/g, (_m, inner: string) => inner.split(/\s+/).map(w => `[${w}]`).join(' '));
  return marked
    .split(/\s+/)
    .map((word, i) => `<span class="w" style="--d:${(base + i * 0.06).toFixed(2)}s">${esc(word).replace(/\[([^\]]+)\]/g, '<span class="hl">$1</span>')}</span>`)
    .join(' ');
}

export const plainHeadline = (h: string): string => h.replace(/[[\]]/g, '');

export function relevanceHTML(r: number | undefined): string {
  if (!r) return '';
  const n = Math.max(1, Math.min(5, Math.round(r)));
  return `<span class="rel" title="Relevanz ${n} von 5 (Einschätzung)" aria-label="Relevanz ${n} von 5">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span>`;
}

export class Card {
  private readonly el = $('#card');
  private seq = 0;

  categoryColor(cats: Category[], id: string): string {
    return cats.find(c => c.id === id)?.color ?? '#ff7a3d';
  }

  private fill(s: Story, i: number, total: number, cats: Category[], date: string): void {
    const c = this.el;
    c.dataset.kind = 'story';
    $('#cMarkets').hidden = true;
    $('.brief').hidden = false;
    c.style.setProperty('--acc', this.categoryColor(cats, s.category));
    $('#cCount').innerHTML = relevanceHTML(s.relevance) + `<span>${pad2(i + 1)}/${pad2(total)}</span>`;
    $('#cHead').innerHTML = '<span>' + headlineHTML(s.headline, 0.35) + '</span>';
    $('#cBrief').textContent = s.brief;
    const fig = $('#cFigure');
    fig.hidden = !s.figure;
    if (s.figure) {
      $('#cFigLabel').textContent = s.figure.label;
      $('#cFig').textContent = fmtNum(0, s.figure);
    }
    $('#cSrcName').textContent = s.source.name;
    $('#cSrcDate').textContent = shortDate(s.source.date);
    $<HTMLAnchorElement>('#cSrc').href = s.source.url;
    $('#cMark').textContent = 'LAGEBILD // ' + shortDate(date);
  }

  async show(s: Story, i: number, total: number, cats: Category[], date: string): Promise<void> {
    const c = this.el;
    const my = ++this.seq;
    this.fill(s, i, total, cats, date);
    c.dataset.state = 'hidden';
    void c.offsetWidth;
    c.dataset.state = 'in';
    scramble($('#cTag'), s.topic.toUpperCase(), 600);
    if (s.figure) {
      const f = s.figure;
      void sleep(850).then(() => { if (my === this.seq) countUp($('#cFig'), f); });
    }
    await sleep(1000);
  }

  /** Marktdaten statt Meldung: Kurse mit Tagesveränderung, Quelle mit Stand. */
  async showMarkets(m: Markets, color: string, date: string): Promise<void> {
    const c = this.el;
    ++this.seq;
    c.dataset.kind = 'markets';
    c.style.setProperty('--acc', color);
    $('#cCount').innerHTML = `<span>STAND ${shortDate(m.asOf)}</span>`;
    $('#cHead').innerHTML = '<span>' + headlineHTML('Die [Märkte]', 0.35) + '</span>';
    $('.brief').hidden = true;
    $('#cFigure').hidden = true;
    const grid = $('#cMarkets');
    grid.hidden = false;
    grid.innerHTML = m.items.map(it => {
      const dir = Math.abs(it.changePct) < 0.05 ? 'flat' : it.changePct > 0 ? 'up' : 'down';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
      const ch = dir === 'flat' ? '0,0 %' : `${it.changePct > 0 ? '+' : ''}${it.changePct.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
      return `<div class="mrow"><span class="mname">${esc(it.name)}</span><span class="mval">${it.value.toLocaleString('de-DE', { minimumFractionDigits: it.dec, maximumFractionDigits: it.dec })}<small> ${esc(it.unit)}</small></span><span class="mch ${dir}">${arrow} ${ch}</span></div>`;
    }).join('');
    $('#cSrcName').textContent = m.source.name;
    $('#cSrcDate').textContent = shortDate(m.source.date);
    $<HTMLAnchorElement>('#cSrc').href = m.source.url;
    $('#cMark').textContent = 'LAGEBILD // ' + shortDate(date);
    c.dataset.state = 'hidden';
    void c.offsetWidth;
    c.dataset.state = 'in';
    scramble($('#cTag'), 'MÄRKTE', 600);
    await sleep(1000);
  }

  async hide(): Promise<void> {
    const c = this.el;
    if (c.dataset.state !== 'in') return;
    this.seq++;
    c.dataset.state = 'out';
    await sleep(500);
    c.dataset.state = 'hidden';
  }

  get visible(): boolean {
    return this.el.dataset.state === 'in';
  }
}
