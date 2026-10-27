// Volltext eines Artikels holen. Nur dieser Text geht später an Claude: Was nicht drinsteht,
// darf nicht in die Meldung. Bezahlschranken und zu kurze Texte werden aussortiert.
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { fetchText } from './util.ts';

export interface Article {
  url: string;
  title: string;
  text: string;
  /** Veröffentlichungsdatum JJJJ-MM-TT, falls die Seite es angibt */
  date: string | null;
  siteName: string | null;
}

const MIN_CHARS = 900;
const MAX_CHARS = 14000;

const PAYWALL = [
  /SPIEGEL\+|Jetzt weiterlesen mit|Zugang zu allen (?:Artikeln|F\+)/i,
  /Exklusiv für Abonnent|Dieser Artikel ist (?:nur )?für Abonnent|Abonnieren Sie|Jetzt abonnieren und weiterlesen/i,
  /WELTplus|SZ Plus|Handelsblatt Premium|\bF\+ Artikel/i,
  /subscribe to (?:continue|read)|this (?:article|story) is (?:only )?(?:available )?(?:for|to) subscribers|already a subscriber\?/i
];

function metaDate(doc: Document): string | null {
  const pick = (sel: string, attr = 'content'): string | null => doc.querySelector(sel)?.getAttribute(attr) ?? null;
  const candidates = [
    pick('meta[property="article:published_time"]'),
    pick('meta[name="date"]'),
    pick('meta[name="pubdate"]'),
    pick('meta[itemprop="datePublished"]'),
    pick('meta[name="dc.date"]'),
    pick('time[datetime]', 'datetime')
  ];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? '') as unknown;
      const stack = [data];
      while (stack.length) {
        const x = stack.pop();
        if (Array.isArray(x)) stack.push(...x);
        else if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>;
          if (typeof o.datePublished === 'string') candidates.unshift(o.datePublished);
          if (o['@graph']) stack.push(o['@graph']);
        }
      }
    } catch { /* kaputtes JSON-LD */ }
  }
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/** Text aus HTML; null, wenn kein brauchbarer, frei lesbarer Artikel drin ist. */
export function extractArticle(html: string, url: string): Article | { error: string } {
  const { document } = parseHTML(html);
  const date = metaDate(document as unknown as Document);
  const parsed = new Readability(document as unknown as Document, { charThreshold: 400 }).parse();
  const text = (parsed?.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (PAYWALL.some(re => re.test(html.slice(0, 400000))) && text.length < 4000) return { error: 'Bezahlschranke' };
  if (text.length < MIN_CHARS) return { error: `zu wenig Text (${text.length} Zeichen)` };
  return {
    url,
    title: (parsed?.title ?? '').trim(),
    text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n[… gekürzt]' : text,
    date,
    siteName: parsed?.siteName ?? null
  };
}

export async function fetchArticle(url: string): Promise<Article | { error: string }> {
  try {
    const res = await fetchText(url, { timeoutMs: 20000 });
    if (res.type && !/html|xml/.test(res.type)) return { error: `kein HTML (${res.type})` };
    return extractArticle(res.text, res.url);
  } catch (e) {
    return { error: (e as Error).message };
  }
}
