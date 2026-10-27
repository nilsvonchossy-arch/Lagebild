// Gemeinsame Helfer der Pipeline: Netzwerk, Zeit, Logging.

// Nur ASCII: Umlaute im User-Agent lassen manche Server mit 400/403 antworten.
export const UA = 'Mozilla/5.0 (compatible; Lagebild/1.0; personal news briefing; +https://github.com/nilsvonchossy-arch/Lagebild)';

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export function log(...args: unknown[]): void {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

/** fetch mit Zeitlimit; wirft bei HTTP-Fehlern. */
export async function fetchText(url: string, opts: { timeoutMs?: number; accept?: string } = {}): Promise<{ text: string; url: string; type: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'de,en;q=0.8' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), url: res.url || url, type: res.headers.get('content-type') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Führt Aufgaben mit begrenzter Parallelität aus, Reihenfolge der Ergebnisse bleibt erhalten. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const BERLIN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Datum (JJJJ-MM-TT) und Uhrzeit (HH:MM) in Berlin. */
export function berlinNow(d = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(BERLIN.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** ISO-Zeitpunkt mit Berliner Zeitzonen-Versatz, z. B. 2026-10-28T07:04:00+01:00 */
export function berlinISO(d = new Date()): string {
  const { date, time } = berlinNow(d);
  const local = Date.parse(`${date}T${time}:00Z`);
  const offMin = Math.round((local - Math.floor(d.getTime() / 60000) * 60000) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const a = Math.abs(offMin);
  return `${date}T${time}:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** URL ohne Tracking-Parameter und Anker, für den Vergleich. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|at_|wt_|ref$|xtor$|ns_|fbclid$|gclid$|cmp$|ito$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', euro: '€', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };

/** HTML-Tags entfernen, Entities auflösen, Leerraum zusammenziehen. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

export const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
