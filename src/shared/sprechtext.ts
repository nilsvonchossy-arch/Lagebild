// Sprechtext für offene Stimm-Modelle: Sie lesen Ziffern, Zeichen und Abkürzungen nicht zuverlässig,
// deshalb wird alles ausgeschrieben, wie man es in einer deutschen Nachrichtensendung sagt:
// „55,7 %“ → „fünfundfünfzig Komma sieben Prozent“, „6. November“ → „sechsten November“,
// „1973“ → „neunzehnhundertdreiundsiebzig“, „S&P 500“ → „S und P fünfhundert“, „KI“ → „Ka-I“.
// Azure liest Ziffern selbst und bekommt den Text unverändert.

const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

/** 1–999 als Wortteil („ein“ statt „eins“ am Ende, z. B. „einhunderteins“ bleibt aber „eins“). */
function below1000(n: number, final: boolean): string {
  let out = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out += `${h === 1 ? 'ein' : ONES[h]}hundert`;
  if (r === 0) return out;
  if (r < 20) return out + (r === 1 ? (final ? 'eins' : 'ein') : ONES[r]);
  const t = Math.floor(r / 10), o = r % 10;
  return out + (o ? `${o === 1 ? 'ein' : ONES[o]}und` : '') + TENS[t];
}

/** Ganze Zahl als Wort: 2000 → „zweitausend“, 1499 → „eintausendvierhundertneunundneunzig“, 2500000 → „zwei Millionen fünfhunderttausend“. */
export function zahlwort(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${zahlwort(-n)}`;
  n = Math.round(n);
  if (n < 20) return ONES[n]!;
  const parts: string[] = [];
  const big: [number, string, string][] = [[1e12, 'Billion', 'Billionen'], [1e9, 'Milliarde', 'Milliarden'], [1e6, 'Million', 'Millionen']];
  for (const [v, one, many] of big) {
    const k = Math.floor(n / v);
    if (k) { parts.push(k === 1 ? `eine ${one}` : `${zahlwort(k)} ${many}`); n %= v; }
  }
  let small = '';
  const th = Math.floor(n / 1000), rest = n % 1000;
  if (th) small += `${below1000(th, false)}tausend`;
  if (rest) small += below1000(rest, true);
  if (small) parts.push(small);
  return parts.join(' ');
}

/** Jahreszahl 1100–1999 wie gesprochen: „neunzehnhundertdreiundsiebzig“ */
export function jahreswort(y: number): string {
  if (y < 1100 || y > 1999) return zahlwort(y);
  const hi = Math.floor(y / 100), lo = y % 100;
  return `${ONES[hi]}hundert${lo ? below1000(lo, true) : ''}`;
}

/** Ordnungszahl mit Endung „-en“ („am sechsten“) oder „-e“ („der sechste“). */
export function ordnungswort(n: number, ending: 'en' | 'e' = 'en'): string {
  const special: Record<number, string> = { 1: 'ers', 3: 'drit', 7: 'sieb', 8: 'ach' };
  const stem = n < 20 ? (special[n] ?? ONES[n]!) + 't' : zahlwort(n).replace(/\s+/g, '') + 'st';
  return stem + ending;
}

/** Dezimalzahl mit Komma: „55,7“ → „fünfundfünfzig Komma sieben“, Nachkommastellen einzeln. */
function dezimal(int: string, frac: string): string {
  return `${zahlwort(Number(int.replace(/\./g, '')))} Komma ${[...frac].map(d => ONES[Number(d)]).join(' ')}`;
}

const MONTHS = 'Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';

/** Abkürzungen, die man buchstabiert; deutsche Buchstabennamen */
const SPELL = ['KI', 'EU', 'USA', 'US', 'UN', 'UK', 'CDU', 'CSU', 'SPD', 'FDP', 'AfD', 'BSW', 'EZB', 'IWF', 'WHO', 'WTO', 'OECD', 'BIP', 'CEO', 'ARD', 'ZDF', 'BND', 'BKA', 'IAEA', 'SUV', 'VW', 'BMW', 'USB', 'PC', 'TV', 'AG', 'ÖVP', 'FPÖ', 'SPÖ', 'SVP', 'ETF'];
const LETTER: Record<string, string> = {
  A: 'A', B: 'Be', C: 'Ze', D: 'De', E: 'E', F: 'Eff', G: 'Ge', H: 'Ha', I: 'I', J: 'Jott', K: 'Ka', L: 'Ell', M: 'Emm', N: 'Enn', O: 'O',
  P: 'Pe', Q: 'Ku', R: 'Err', S: 'Ess', T: 'Te', U: 'U', V: 'Fau', W: 'We', X: 'Ix', Y: 'Ypsilon', Z: 'Zett', Ä: 'Ä', Ö: 'Ö', Ü: 'Ü'
};
const spell = (s: string): string => [...s.toUpperCase()].map(c => LETTER[c] ?? c).join('-');

const ABBR: [RegExp, string][] = [
  [/\bz\.\s?B\./g, 'zum Beispiel'], [/\bu\.\s?a\./g, 'unter anderem'], [/\bbzw\./g, 'beziehungsweise'], [/\bca\./g, 'circa'],
  [/\bd\.\s?h\./g, 'das heißt'], [/\bNr\./g, 'Nummer'], [/\bDr\./g, 'Doktor'], [/\bProf\./g, 'Professor'], [/\bMrd\.?(?=\s|$)/g, 'Milliarden'],
  [/\bMio\.?(?=\s|$)/g, 'Millionen'], [/\bTsd\./g, 'Tausend'], [/\bkm\/h\b/g, 'Kilometer pro Stunde'], [/\bkm\b/g, 'Kilometer'],
  [/°C\b/g, ' Grad'], [/\bPkt\./g, 'Punkte']
];

export interface SprechOpts {
  /** Abkürzungen buchstabieren (für die Stimme); aus für den Vergleich mit Whisper */
  spell?: boolean;
}

/** Text so umschreiben, wie er gesprochen wird. */
export function sprechtext(input: string, opts: SprechOpts = {}): string {
  let t = ` ${input} `;
  for (const [re, w] of ABBR) t = t.replace(re, w);
  t = t.replace(/(\d)\s*%/g, '$1 Prozent').replace(/\s*&\s*/g, ' und ').replace(/€/g, ' Euro ').replace(/\$/g, ' Dollar ');
  // Buchstabe direkt vor Zahl: „M6“ → „M 6“, „F-35“ → „F 35“, „COVID-19“ → „COVID 19“
  t = t.replace(/(\p{Lu})-?(\d)/gu, '$1 $2');
  // Zahl mit Bindestrich vor Wort: „1,9-mal“ → „1,9 mal“
  t = t.replace(/(\d)-(\p{L})/gu, '$1 $2');
  // Datum mit Monatsname: „6. November“ → „sechsten November“ (nach „der“ „sechste“)
  t = t.replace(new RegExp(`(\\b\\p{L}+\\s+)?\\b(\\d{1,2})\\.\\s*(${MONTHS})`, 'gu'), (_m, prev: string | undefined, d: string, mon: string) =>
    `${prev ?? ''}${ordnungswort(Number(d), prev && /^der\s+$/i.test(prev) ? 'e' : 'en')} ${mon}`);
  // Uhrzeit: „18:30 Uhr“, „18.30 Uhr“ → „achtzehn Uhr dreißig“; „22:00“ → „zweiundzwanzig Uhr“
  t = t.replace(/\b(\d{1,2})[:.](\d{2})(\s*Uhr)?\b/g, (_m, h: string, m: string) =>
    `${zahlwort(Number(h))} Uhr${m === '00' ? '' : ` ${zahlwort(Number(m))}`}`);
  // Vorzeichen
  t = t.replace(/(^|[\s(])[+](?=\d)/g, '$1plus ').replace(/(^|[\s(])[-−–](?=\d)/g, '$1minus ');
  // Dezimalzahlen
  t = t.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+),(\d+)\b/g, (_m, i: string, f: string) => dezimal(i, f));
  // Ganze Zahlen mit Tausenderpunkten
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, m => zahlwort(Number(m.replace(/\./g, ''))));
  // Übrige ganze Zahlen: Jahre ohne Punkt als Jahreszahl; „1“ vor einem Wort als „ein“/„eine“
  t = t.replace(/\b(\d+)\b(\s+(\p{L}+))?/gu, (_m, num: string, rest: string | undefined, word: string | undefined) => {
    const n = Number(num);
    let w: string;
    if (num.length === 4 && n >= 1100 && n <= 1999) w = jahreswort(n);
    else if (n === 1 && word) w = /^(Million|Milliarde|Billion)$/.test(word) ? 'eine' : 'ein';
    else w = zahlwort(n);
    return w + (rest ?? '');
  });
  if (opts.spell !== false) {
    const re = new RegExp(`(?<![\\p{L}])(${SPELL.join('|')})(?![\\p{L}])`, 'gu');
    t = t.replace(re, m => spell(m));
  }
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}
