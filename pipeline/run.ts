// Tages-Update erzeugen: Recherche → Auswahl → Volltext → Schreiben → Faktencheck → (Stimme) → Ablage.
//
//   node pipeline/run.ts --out daten               normales Update für heute
//   node pipeline/run.ts --gate                     nur, wenn es in Berlin nach 6:30 ist und heute noch nichts da ist
//   node pipeline/run.ts --check-feeds              nur Feeds und Suche prüfen, ohne Claude
//   node pipeline/run.ts --compare claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import pipelineCfg from '../config/pipeline.json' with { type: 'json' };
import quellenJson from '../config/quellen.json' with { type: 'json' };
import themenJson from '../config/themen.json' with { type: 'json' };
import { validateConfig } from '../src/shared/config.ts';
import type { ThemenConfig } from '../src/shared/config.ts';
import type { Briefing } from '../src/shared/types.ts';
import { dateParts } from '../src/util.ts';
import { buildBriefing, type Built } from './assemble.ts';
import { Claude, RefusalError } from './claude.ts';
import { selectStories, verifyStory, writeStory, type Selection } from './editorial.ts';
import { fetchArticle, type Article } from './extract.ts';
import { resolvePlace } from './geo.ts';
import { fetchMarkets } from './markets.ts';
import { fetchFeeds, matchTopics, mergeCandidates, parseFeed, searchGdelt, type Candidate, type Quellen } from './sources.ts';
import { dayPath, previousHeadlines, pruneAudio, writeIndex, writeJSON } from './store.ts';
import { synthesize } from './tts.ts';
import { berlinISO, berlinNow, log, pool } from './util.ts';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'daten' },
    date: { type: 'string' },
    model: { type: 'string' },
    gate: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'check-feeds': { type: 'boolean', default: false },
    compare: { type: 'string' },
    'no-tts': { type: 'boolean', default: false },
    probe: { type: 'string' }
  }
});

const cfg = themenJson as unknown as ThemenConfig;
const quellen = quellenJson as unknown as Quellen;
const OUT = args.out!;

function output(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/* ---------- Recherche ---------- */

async function research(): Promise<{ candidates: Candidate[]; report: Record<string, unknown> }> {
  const since = new Date(Date.now() - pipelineCfg.candidates.hours * 3600 * 1000);
  const feeds = await fetchFeeds(cfg, quellen);
  const fresh = feeds.items.filter(it => !it.published || new Date(it.published) >= since);
  const matched = matchTopics(fresh, cfg);
  const perTopic = new Map<string, number>();
  for (const it of matched) perTopic.set(it.topic, (perTopic.get(it.topic) ?? 0) + 1);
  const gdelt = await searchGdelt(cfg, quellen, perTopic);
  const candidates = mergeCandidates([...matched, ...gdelt.items], { since, perTopic: pipelineCfg.candidates.perTopic, total: pipelineCfg.candidates.total });
  return { candidates, report: { feeds: feeds.report, perTopic: Object.fromEntries(perTopic), gdelt: gdelt.report } };
}

/** Beliebige Feed-Adressen testen (Status, Anzahl, erster Titel), mit Lagebild- und mit Browser-Kennung. */
async function probe(urls: string[]): Promise<void> {
  const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  for (const url of urls) {
    for (const ua of ['lagebild', 'browser'] as const) {
      try {
        const res = await fetch(url, { headers: ua === 'browser' ? { 'User-Agent': BROWSER, Accept: '*/*' } : { 'User-Agent': 'Lagebild/1.0 (+https://github.com/nilsvonchossy-arch/Lagebild)' }, signal: AbortSignal.timeout(15000) });
        const body = await res.text();
        const items = res.ok ? parseFeed(body, { id: 'p', name: 'p', url, lang: 'de' }, 'p') : [];
        console.log(`${res.status} ${ua.padEnd(8)} ${String(items.length).padStart(4)} Artikel  ${url}${items[0] ? `  → ${items[0].title.slice(0, 70)}` : ''}`);
      } catch (e) {
        console.log(`ERR ${ua.padEnd(8)}      ${url}  ${(e as Error).message}`);
      }
    }
  }
}

/* ---------- Meldungen bauen ---------- */

interface StoryLog { title: string; topic: string; relevance: number; attempts: { url: string; result: string }[]; issues: string[]; result: string }

const articleCache = new Map<string, Promise<Article | { error: string }>>();
const getArticle = (url: string): Promise<Article | { error: string }> => {
  if (!articleCache.has(url)) articleCache.set(url, fetchArticle(url));
  return articleCache.get(url)!;
};

/** Eine ausgewählte Meldung schreiben und prüfen; probiert bis zu drei Quellen. */
async function buildOne(claude: Claude, sel: Selection, cands: Map<number, Candidate>, slog: StoryLog): Promise<Built | null> {
  const topic = cfg.topics.find(t => t.id === sel.topic);
  if (!topic) { slog.result = 'unbekanntes Thema'; return null; }
  const category = cfg.categories.find(c => c.id === topic.category)?.name ?? topic.category;
  let tried = 0;
  for (const id of sel.articles) {
    const c = cands.get(id);
    if (!c || tried >= 3) continue;
    tried++;
    const a = await getArticle(c.url);
    if ('error' in a) { slog.attempts.push({ url: c.url, result: a.error }); continue; }
    try {
      const draft = await writeStory(claude, a, { topic: topic.name, category, title: sel.working_title, source: c.source, date: c.published?.slice(0, 10) ?? null });
      if (!draft.usable) { slog.attempts.push({ url: c.url, result: 'keine verwertbare Nachricht' }); continue; }
      const checked = await verifyStory(claude, a, draft, sel.working_title);
      slog.issues.push(...checked.issues);
      if (!checked.draft) { slog.attempts.push({ url: c.url, result: 'Faktencheck nicht bestanden' }); continue; }
      const place = resolvePlace(checked.draft.place.country_iso3, checked.draft.place.lon, checked.draft.place.lat);
      if (!place) { slog.attempts.push({ url: c.url, result: `unbekanntes Land ${checked.draft.place.country_iso3}` }); continue; }
      if (place.moved) slog.issues.push(`Ort korrigiert: ${checked.draft.place.label} liegt nicht in ${place.country}`);
      slog.attempts.push({ url: c.url, result: 'ok' });
      slog.result = 'ok';
      const sourceName = a.siteName && a.siteName.length <= 40 ? a.siteName : c.source;
      return { sel, topic, article: a, sourceName, published: c.published, draft: checked.draft, place };
    } catch (e) {
      // Falscher Schlüssel oder fehlendes Guthaben: sofort abbrechen; alles andere kostet nur diese Quelle
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw e;
      if (e instanceof Anthropic.BadRequestError && /credit|billing/i.test(e.message)) throw e;
      slog.attempts.push({ url: c.url, result: e instanceof RefusalError ? e.message : `Fehler: ${(e as Error).message}` });
      continue;
    }
  }
  slog.result ||= 'keine nutzbare Quelle';
  return null;
}

/** Geschätzte Länge in Sekunden (Sprechtempo ~2,4 Wörter/s plus Animationen je Meldung). */
function estimateSeconds(built: Built[]): number {
  const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
  let sec = 12;
  for (const b of built) sec += 4 + (words(b.draft.opener.mid) + b.draft.lines.reduce((n, l) => n + words(l.text), 0)) / 2.4 + b.draft.lines.length * 0.25;
  return sec;
}

async function produce(claude: Claude, selections: Selection[], cands: Candidate[], logs: StoryLog[]): Promise<Built[]> {
  const byId = new Map(cands.map(c => [c.id, c]));
  const want = cfg.stories.max;
  const perTopic = new Map<string, number>();
  const queue = selections.filter(s => {
    const n = perTopic.get(s.topic) ?? 0;
    perTopic.set(s.topic, n + 1);
    return n < 2;
  });
  const results: (Built | null)[] = [];
  const mkLog = (s: Selection): StoryLog => {
    const l: StoryLog = { title: s.working_title, topic: s.topic, relevance: s.relevance, attempts: [], issues: [], result: '' };
    logs.push(l);
    return l;
  };
  // Erst die besten parallel, dann Reserven der Reihe nach, bis genug Meldungen da sind
  const first = queue.slice(0, want);
  results.push(...(await pool(first, 2, s => buildOne(claude, s, byId, mkLog(s)))));
  for (const s of queue.slice(want)) {
    if (results.filter(Boolean).length >= want) break;
    results.push(await buildOne(claude, s, byId, mkLog(s)));
  }
  let built = results.filter((b): b is Built => b !== null);
  // Länge begrenzen: unwichtigste Meldungen weglassen, solange mehr als das Minimum da ist
  while (built.length > cfg.stories.min && estimateSeconds(built) > pipelineCfg.targetSeconds) {
    const weakest = built.reduce((a, b) => (b.sel.relevance <= a.sel.relevance ? b : a));
    built = built.filter(b => b !== weakest);
    logs.find(l => l.title === weakest.sel.working_title)!.result = 'aus Zeitgründen weggelassen';
  }
  return built;
}

function dateLabel(date: string): string {
  const p = dateParts(date);
  return `${p.weekday}, ${p.day}. ${p.monthName} ${p.year} (Berlin ${berlinNow().time} Uhr)`;
}

/* ---------- Modellvergleich ---------- */

async function compare(models: string[], date: string, cands: Candidate[]): Promise<void> {
  const dir = join(OUT, 'vergleich', date);
  const yesterday = previousHeadlines(OUT, date);
  const report: Record<string, unknown> = { date, candidates: cands.length, models: {} };
  const ref = models[0]!;
  let refSelection: Selection[] = [];
  for (const m of models) {
    const claude = new Claude(m, pipelineCfg.effort as 'medium');
    const sel = await selectStories(claude, cfg, cands, { dateLabel: dateLabel(date), yesterday, want: cfg.stories.max });
    if (m === ref) refSelection = sel;
    (report.models as Record<string, unknown>)[m] = { selection: sel.map(s => ({ title: s.working_title, topic: s.topic, relevance: s.relevance, reason: s.reason })) };
    log(`${m}: Auswahl ${sel.length} Meldungen`);
  }
  // Alle Modelle schreiben dieselben Meldungen aus denselben Quellen, damit sich die Texte vergleichen lassen
  for (const m of models) {
    const claude = new Claude(m, pipelineCfg.effort as 'medium');
    const logs: StoryLog[] = [];
    const built = await produce(claude, refSelection, cands, logs);
    const b = buildBriefing(date, berlinISO(), cfg, built, { model: m, costUsd: claude.usage.costUsd });
    writeJSON(join(dir, `${m}.json`), b);
    Object.assign((report.models as Record<string, Record<string, unknown>>)[m]!, { usage: claude.usage, stories: logs });
    log(`${m}: ${built.length} Meldungen, ${claude.usage.costUsd.toFixed(3)} $`);
  }
  writeJSON(join(dir, 'bericht.json'), report);
  output('changed', 'true');
}

/* ---------- Ablauf ---------- */

async function main(): Promise<void> {
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`config/themen.json ist ungültig: ${errs.join('; ')}`);
  const now = berlinNow();
  const date = args.date ?? now.date;
  output('changed', 'false');

  if (args.gate && !args.force) {
    if (now.time < '06:30') { log(`Zu früh (${now.time} Uhr in Berlin), nichts zu tun.`); return; }
    if (existsSync(dayPath(OUT, date))) { log(`Update für ${date} existiert schon.`); return; }
  }

  if (args.probe) { await probe(args.probe.split(/[\s,]+/).filter(Boolean)); return; }

  if (!args['check-feeds'] && !process.env.ANTHROPIC_API_KEY) {
    // Noch nicht eingerichtet: kein Fehler, damit nicht jeden Morgen eine Fehlermail kommt
    console.log('::warning::Kein ANTHROPIC_API_KEY gesetzt – Tages-Update übersprungen. Anleitung: docs/einrichtung.md');
    return;
  }

  log(`Recherche für ${date} …`);
  const [{ candidates, report }, markets] = await Promise.all([research(), fetchMarkets()]);
  if (args['check-feeds']) {
    console.log(JSON.stringify(report, null, 2));
    console.log('Märkte:', markets ? JSON.stringify(markets.items.map(i => `${i.name} ${i.value} (${i.changePct} %, ${i.date})`)) : 'nicht verfügbar');
    if (markets) console.log('Satz:', markets.lines[0]?.text);
    console.log(`${candidates.length} Kandidaten, z. B.:`);
    for (const c of candidates.slice(0, 15)) console.log(`  [${c.topics.join(',')}] ${c.source}: ${c.title}`);
    return;
  }
  if (candidates.length < 10) throw new Error(`Nur ${candidates.length} Kandidaten gefunden, Feeds prüfen.`);

  if (args.compare) {
    await compare(args.compare.split(',').map(s => s.trim()).filter(Boolean), date, candidates);
    return;
  }

  const model = args.model ?? process.env.LAGEBILD_MODEL ?? pipelineCfg.model;
  const claude = new Claude(model, pipelineCfg.effort as 'medium');
  log(`Auswahl mit ${model} aus ${candidates.length} Kandidaten …`);
  const selections = await selectStories(claude, cfg, candidates, { dateLabel: dateLabel(date), yesterday: previousHeadlines(OUT, date), want: cfg.stories.max });
  const storyLogs: StoryLog[] = [];
  const built = await produce(claude, selections, candidates, storyLogs);
  if (!built.length) throw new Error('Keine Meldung hat den Faktencheck bestanden.');
  if (built.length < cfg.stories.min) log(`Achtung: nur ${built.length} Meldungen.`);

  const briefing: Briefing = buildBriefing(date, berlinISO(), cfg, built, { model, costUsd: 0 });
  if (markets) briefing.markets = markets;
  let tts: Record<string, unknown> = { skipped: true };
  if (!args['no-tts'] && process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
    tts = await synthesize(briefing, OUT, { key: process.env.AZURE_SPEECH_KEY, region: process.env.AZURE_SPEECH_REGION, voices: pipelineCfg.voices });
  }
  briefing.meta = { model, costUsd: +claude.usage.costUsd.toFixed(4) };

  writeJSON(dayPath(OUT, date), briefing);
  writeIndex(OUT, briefing.generated);
  const pruned = pruneAudio(OUT, date, pipelineCfg.audioDays);
  writeJSON(join(OUT, 'logs', `${date}.json`), { date, model, candidates: candidates.length, research: report, selections, stories: storyLogs, usage: claude.usage, tts, pruned });
  log(`Fertig: ${built.length} Meldungen, Claude-Kosten ${claude.usage.costUsd.toFixed(3)} $ (${claude.usage.calls} Aufrufe).`);
  output('changed', 'true');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
