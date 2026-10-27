// Marktdaten-Kachel: Schlusskurse und Tagesveränderung. Die Zahlen kommen direkt aus der Kursquelle,
// die gesprochenen Sätze werden ohne KI aus den Zahlen gebaut – hier kann nichts dazuerfunden werden.
import type { Line, MarketItem, Markets } from '../src/shared/types.ts';
import { dateParts } from '../src/util.ts';
import { fetchText, log, pool } from './util.ts';

const SYMBOLS: (Omit<MarketItem, 'value' | 'changePct' | 'date'> & { symbol: string })[] = [
  { id: 'dax', name: 'DAX', symbol: '^GDAXI', dec: 0, unit: 'Pkt.' },
  { id: 'spx', name: 'S&P 500', symbol: '^GSPC', dec: 0, unit: 'Pkt.' },
  { id: 'ndq', name: 'Nasdaq', symbol: '^IXIC', dec: 0, unit: 'Pkt.' },
  { id: 'eurusd', name: 'Euro', symbol: 'EURUSD=X', dec: 4, unit: '$' },
  { id: 'gold', name: 'Gold', symbol: 'GC=F', dec: 0, unit: '$/Unze' },
  { id: 'brent', name: 'Öl (Brent)', symbol: 'BZ=F', dec: 2, unit: '$/Barrel' },
  { id: 'btc', name: 'Bitcoin', symbol: 'BTC-USD', dec: 0, unit: '$' }
];

interface Chart {
  chart: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number }; timestamp?: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] };
}

const berlinDate = (ts: number): string => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

async function quote(s: (typeof SYMBOLS)[number]): Promise<MarketItem | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?range=7d&interval=1d`;
  try {
    const data = JSON.parse((await fetchText(url, { accept: 'application/json' })).text) as Chart;
    const r = data.chart.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators.quote[0]?.close ?? [];
    const valid = ts.map((t, i) => ({ t, c: closes[i] })).filter((x): x is { t: number; c: number } => typeof x.c === 'number');
    // Die letzte Tageskerze hat manchmal noch keinen Schlusskurs; dann gilt der letzte Kurs aus den Metadaten
    const meta = r?.meta;
    const tail = valid[valid.length - 1];
    if (meta?.regularMarketPrice && meta.regularMarketTime && (!tail || (meta.regularMarketTime > tail.t && berlinDate(meta.regularMarketTime) !== berlinDate(tail.t)))) {
      valid.push({ t: meta.regularMarketTime, c: meta.regularMarketPrice });
    }
    const last = valid[valid.length - 1];
    const prev = valid[valid.length - 2];
    if (!last || !prev) return null;
    const { symbol: _s, ...rest } = s;
    return { ...rest, value: +last.c.toFixed(s.dec), changePct: +(((last.c - prev.c) / prev.c) * 100).toFixed(2), date: berlinDate(last.t) };
  } catch (e) {
    log(`Kurs ${s.name}: ${(e as Error).message}`);
    return null;
  }
}

const de = (v: number, dec: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pct = (v: number): string => de(Math.abs(v), 1);

/** Satzteil zur Bewegung; `inverted` für Verb-zweit nach „In New York …“. */
function move(name: string, c: number, inverted = false): string {
  const [verb, rest] = Math.abs(c) < 0.05 ? ['blieb', 'nahezu unverändert'] : c > 0 ? ['legte', `um ${pct(c)} Prozent zu`] : ['gab', `um ${pct(c)} Prozent nach`];
  return inverted ? `${verb} ${name} ${rest}` : `${name} ${verb} ${rest}`;
}

/** Gesprochene Zeilen aus den Zahlen: eine für den DAX, eine für New York. */
export function marketLines(items: MarketItem[]): Line[] {
  const get = (id: string): MarketItem | undefined => items.find(i => i.id === id);
  const dax = get('dax');
  const us = [get('spx'), get('ndq')].filter((x): x is MarketItem => Boolean(x));
  const lines: Line[] = [];
  if (dax) {
    const wd = dateParts(dax.date).weekday;
    const c = dax.changePct;
    lines.push({ role: 'LAGE', text: `Der DAX schloss am ${wd} bei ${de(dax.value, 0)} Punkten, ${Math.abs(c) < 0.05 ? 'nahezu unverändert' : `${c > 0 ? 'plus' : 'minus'} ${pct(c)} Prozent`}.` });
  }
  if (us.length) {
    const text = `In New York ${us.map((u, i) => move(`der ${u.name}`, u.changePct, i === 0)).join(', ')}.`;
    lines.push({ role: 'LAGE', text, ...(text.includes('S&P') ? { say: text.replace(/S&P 500/g, 'S und P 500') } : {}) });
  }
  return lines;
}

export async function fetchMarkets(): Promise<Markets | null> {
  const items = (await pool(SYMBOLS, 3, quote)).filter((x): x is MarketItem => x !== null);
  if (items.length < 3) { log(`Marktdaten unvollständig (${items.length} Werte), Kachel entfällt`); return null; }
  const lines = marketLines(items);
  if (!lines.length) return null;
  const asOf = items.map(i => i.date).sort().reverse()[0]!;
  return {
    asOf,
    source: { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/markets/', date: asOf },
    items,
    opener: { role: 'BRIEFING', text: 'Und die Märkte?' },
    lines
  };
}
