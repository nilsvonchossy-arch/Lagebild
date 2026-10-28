// Folge planen: welche Meldung Aufmacher, Meldung oder „Kurz notiert“ wird, wie viel Zeit sie bekommt
// und in welcher Reihenfolge sie läuft. Ohne KI, damit es nachvollziehbar bleibt.
// Regeln aus docs/video-analyse-conflictly.md, Abschnitt 10.3: Aufmacher 30–45 s, Meldung 15–25 s,
// Kurz notiert 5–10 s; Tiefe nur, wenn die Quelle genug Fakten hergibt.
import { geoDistance } from 'd3-geo';
import type { Weight } from '../src/shared/config.ts';
import type { Format } from '../src/shared/types.ts';

export interface PlanInput {
  relevance: number;
  weight: Weight;
  /** Anzahl geprüfter Fakten */
  facts: number;
  lon: number;
  lat: number;
  minPerDay?: boolean;
}

export interface PlanItem {
  /** Index in der Eingabeliste */
  index: number;
  format: Format;
  /** Zielzeit in Sekunden */
  seconds: number;
}

const BONUS: Record<Weight, number> = { aus: -9, kurz: -1, normal: 0, ausfuehrlich: 1 };

/** Wichtigkeit aus Relevanz und Gewichtung des Themas */
export const score = (s: PlanInput): number => s.relevance + BONUS[s.weight] + (s.minPerDay ? 0.5 : 0);

/** Feste Teile: Vorlauf, Zusammenfassung und Abschlussformel; Marktdaten; Frage und Pause je Meldung */
export const OVERHEAD = { base: 14, markets: 13, perStory: 1.8 };

/** Zielzeit eines Formats; ohne genug Fakten wird es kürzer („Tiefe braucht Stoff“). */
export function targetSeconds(format: Format, s: PlanInput): number {
  const material = 6 + s.facts * 5.5;
  if (format === 'kurz') return 7;
  if (format === 'aufmacher') return Math.round(Math.max(15, Math.min(material, s.weight === 'ausfuehrlich' && s.facts >= 7 ? 45 : 38)));
  return Math.round(Math.max(12, Math.min(material, s.weight === 'ausfuehrlich' && s.facts >= 5 ? 25 : 20)));
}

const dist = (a: PlanInput, b: PlanInput): number => geoDistance([a.lon, a.lat], [b.lon, b.lat]);

/** Route ab `from`: immer zur nächsten Meldung, wichtige dürfen etwas weiter weg liegen (Bedeutung schlägt Geografie). */
function route(items: number[], input: PlanInput[], from: PlanInput): number[] {
  const left = [...items];
  const out: number[] = [];
  let at = from;
  const avg = left.reduce((n, i) => n + score(input[i]!), 0) / (left.length || 1);
  while (left.length) {
    let best = 0, bestCost = Infinity;
    left.forEach((i, k) => {
      const cost = dist(at, input[i]!) - 0.3 * (score(input[i]!) - avg);
      if (cost < bestCost) { bestCost = cost; best = k; }
    });
    const [i] = left.splice(best, 1);
    out.push(i!);
    at = input[i!]!;
  }
  return out;
}

export function planEpisode(input: PlanInput[], minutes: number, withMarkets: boolean): { items: PlanItem[]; dropped: number[] } {
  const order = input.map((s, i) => i).filter(i => input[i]!.weight !== 'aus').sort((a, b) => score(input[b]!) - score(input[a]!) || a - b);
  if (!order.length) return { items: [], dropped: input.map((_, i) => i) };
  let budget = minutes * 60 - OVERHEAD.base - (withMarkets ? OVERHEAD.markets : 0);

  // Aufmacher: die wichtigste Meldung, die vertieft werden darf und genug Stoff hat
  const lead = order.find(i => input[i]!.weight !== 'kurz' && input[i]!.facts >= 4) ?? order.find(i => input[i]!.weight !== 'kurz') ?? order[0]!;
  const chosen = new Map<number, PlanItem>();
  const leadFormat: Format = input[lead]!.weight === 'kurz' ? 'kurz' : 'aufmacher';
  chosen.set(lead, { index: lead, format: leadFormat, seconds: targetSeconds(leadFormat, input[lead]!) });
  budget -= chosen.get(lead)!.seconds + OVERHEAD.perStory;

  for (const i of order) {
    if (i === lead) continue;
    const s = input[i]!;
    const wish: Format = s.weight === 'kurz' || s.facts < 3 || score(s) < 3 ? 'kurz' : 'meldung';
    for (const f of wish === 'meldung' ? (['meldung', 'kurz'] as const) : (['kurz'] as const)) {
      const sec = targetSeconds(f, s);
      if (sec + OVERHEAD.perStory <= budget) {
        chosen.set(i, { index: i, format: f, seconds: sec });
        budget -= sec + OVERHEAD.perStory;
        break;
      }
    }
  }

  const main = [...chosen.values()].filter(p => p.format === 'meldung').map(p => p.index);
  const kurz = [...chosen.values()].filter(p => p.format === 'kurz' && p.index !== lead).map(p => p.index);
  const mainRoute = route(main, input, input[lead]!);
  const last = mainRoute.length ? input[mainRoute[mainRoute.length - 1]!]! : input[lead]!;
  const sequence = [lead, ...mainRoute, ...route(kurz, input, last)];
  return {
    items: sequence.map(i => chosen.get(i)!),
    dropped: order.filter(i => !chosen.has(i))
  };
}

/** Wie viele Meldungen die Auswahl liefern soll, damit die Länge gefüllt werden kann. */
export const wantedStories = (minutes: number): number => Math.max(4, Math.min(16, Math.round(minutes * 1.7 + 1.5)));
