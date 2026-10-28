// Tages-Update erzeugen: Recherche → Auswahl → Volltext → Fakten → Faktencheck → Plan → Drehbuch →
// Drehbuch-Prüfung → (Stimme und Mischung) → Ablage.
//
//   node pipeline/run.ts --out daten               normales Update für heute
//   node pipeline/run.ts --gate                     nur, wenn es in Berlin nach 6:30 ist und heute noch nichts da ist
//   node pipeline/run.ts --check-feeds              nur Feeds und Suche prüfen, ohne Claude
//   node pipeline/run.ts --compare claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5
//   node pipeline/run.ts --vertonen public/demo/2026-10-27.json --out demo-out   fertige Folge nur vertonen
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import pipelineCfg from '../config/pipeline.json' with { type: 'json' };
import quellenJson from '../config/quellen.json' with { type: 'json' };
import themenJson from '../config/themen.json' with { type: 'json' };
import { migrateConfig, validateConfig } from '../src/shared/config.ts';
import type { Briefing, Line, Markets, Role, Story } from '../src/shared/types.ts';
import { dateParts } from '../src/util.ts';
import { buildBriefing, KEYS, toScriptStory, toStory, type Built } from './assemble.ts';
import { resolveImages } from './bilder.ts';
import { Claude, RefusalError } from './claude.ts';
import { writeScript } from './drehbuch.ts';
import { selectStories, verifyStory, writeStory, type Selection } from './editorial.ts';
import { fetchArticle, type Article } from './extract.ts';
import { resolveExtraPlace, resolvePlace } from './geo.ts';
import { fetchMarkets } from './markets.ts';
import { mixEpisode, type Clip } from './mix.ts';
import { planEpisode, wantedStories } from './plan.ts';
import { fetchFeeds, matchTopics, mergeCandidates, parseFeed, searchGdelt, type Candidate, type Quellen } from './sources.ts';
import { dayPath, nextEpisode, previousHeadlines, pruneMedia, writeIndex, writeJSON } from './store.ts';
import { synthesizeLines, type VoiceSpec } from './tts.ts';
import { synthesizeVoxcpm, type VoxcpmConfig } from './tts-voxcpm.ts';
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
    probe: { type: 'string' },
    vertonen: { type: 'string' },
    stimme: { type: 'string' }
  }
});

const cfg = migrateConfig(themenJson);
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
      const places = checked.draft.places.map(resolveExtraPlace).filter((p): p is NonNullable<typeof p> => p !== null);
      slog.attempts.push({ url: c.url, result: 'ok' });
      slog.result = 'ok';
      const sourceName = a.siteName && a.siteName.length <= 40 ? a.siteName : c.source;
      return { sel, topic, article: a, sourceName, published: c.published, draft: checked.draft, place, places };
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

async function produce(claude: Claude, selections: Selection[], cands: Candidate[], logs: StoryLog[], want: number): Promise<Built[]> {
  const byId = new Map(cands.map(c => [c.id, c]));
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
  results.push(...(await pool(queue.slice(0, want), 2, s => buildOne(claude, s, byId, mkLog(s)))));
  for (const s of queue.slice(want)) {
    if (results.filter(Boolean).length >= want) break;
    results.push(await buildOne(claude, s, byId, mkLog(s)));
  }
  return results.filter((b): b is Built => b !== null);
}

/** Plan, Drehbuch und Montage: aus den geprüften Meldungen wird die Folge. */
async function compose(claude: Claude, built: Built[], date: string, markets: { markets: Markets; lines: Line[] } | null, logs: StoryLog[], model: string, images = true): Promise<{ briefing: Briefing; scriptIssues: string[] }> {
  const plan = planEpisode(
    built.map(b => ({ relevance: b.sel.relevance, weight: b.topic.weight, facts: b.draft.facts.length, lon: b.place.lon, lat: b.place.lat, minPerDay: Boolean(b.topic.minPerDay) })),
    cfg.episode.minutes,
    Boolean(markets)
  );
  for (const i of plan.dropped) {
    const l = logs.find(x => x.title === built[i]!.sel.working_title);
    if (l) l.result = 'aus Zeitgründen weggelassen';
  }
  if (images) {
    // Archivbilder nur für Meldungen, die in der Folge vorkommen (Wikimedia Commons, kostenlos)
    await pool(plan.items, 2, async p => {
      const b = built[p.index]!;
      const l = logs.find(x => x.title === b.sel.working_title);
      b.images = await resolveImages(b.draft.motive, OUT, `bilder/${date}`, l?.issues ?? []);
    });
  }
  const taken: string[] = [];
  const stories: Story[] = plan.items.map((p, k) => {
    const s = toStory(built[p.index]!, KEYS[k]!, p.format, date, taken);
    taken.push(s.id);
    return s;
  });
  const script = await writeScript(claude, stories.map((s, k) => toScriptStory(s, built[plan.items[k]!.index]!, KEYS[k]!, plan.items[k]!)), cfg.episode.tone);
  const briefing = buildBriefing({
    date,
    generated: berlinISO(),
    cfg,
    episode: nextEpisode(OUT, date),
    stories,
    script: script.lines,
    markets,
    meta: { model, costUsd: 0, script: script.source }
  });
  return { briefing, scriptIssues: script.issues };
}

function dateLabel(date: string): string {
  const p = dateParts(date);
  return `${p.weekday}, ${p.day}. ${p.monthName} ${p.year} (Berlin ${berlinNow().time} Uhr)`;
}

/* ---------- Stimme ---------- */

/**
 * Folge vertonen und mischen: VoxCPM2 (Voreinstellung, kostenlos auf dem GitHub-Server) oder Azure.
 * Fehlt danach auch nur eine Zeile, gibt es keine Audiodatei; die App spricht dann mit der Systemstimme.
 */
async function voice(b: Briefing, engine: string): Promise<Record<string, unknown>> {
  let r: { clips: (Clip | null)[]; report: Record<string, unknown> };
  if (engine === 'azure') {
    if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
      log('Stimme Azure gewählt, aber kein Azure-Schlüssel gesetzt: keine Audiodatei.');
      return { engine, skipped: 'kein Schlüssel' };
    }
    r = await synthesizeLines(b.script, { key: process.env.AZURE_SPEECH_KEY, region: process.env.AZURE_SPEECH_REGION, voices: pipelineCfg.voices as Record<Role, VoiceSpec> });
  } else {
    r = synthesizeVoxcpm(b.script, pipelineCfg.voxcpm2 as VoxcpmConfig, join(tmpdir(), 'lagebild-stimme', b.date));
  }
  if (r.clips.every((c): c is Clip => c !== null)) {
    b.audio = mixEpisode(b.script, r.clips, OUT, `audio/${b.date}`);
    log(`Folge gemischt: ${b.audio.dur.toFixed(0)} s`);
  } else log('Nicht alle Zeilen vertont, keine Audiodatei (die App spricht selbst).');
  return { engine, ...r.report };
}

/* ---------- Modellvergleich ---------- */

async function compare(models: string[], date: string, cands: Candidate[], markets: { markets: Markets; lines: Line[] } | null): Promise<void> {
  const dir = join(OUT, 'vergleich', date);
  const yesterday = previousHeadlines(OUT, date);
  const want = wantedStories(cfg.episode.minutes);
  const report: Record<string, unknown> = { date, candidates: cands.length, models: {} };
  const ref = models[0]!;
  let refSelection: Selection[] = [];
  for (const m of models) {
    const claude = new Claude(m, pipelineCfg.effort as 'medium');
    const sel = await selectStories(claude, cfg, cands, { dateLabel: dateLabel(date), yesterday, want, minutes: cfg.episode.minutes });
    if (m === ref) refSelection = sel;
    (report.models as Record<string, unknown>)[m] = { selection: sel.map(s => ({ title: s.working_title, topic: s.topic, relevance: s.relevance, reason: s.reason })) };
    log(`${m}: Auswahl ${sel.length} Meldungen`);
  }
  // Alle Modelle schreiben dieselben Meldungen aus denselben Quellen, damit sich die Texte vergleichen lassen
  for (const m of models) {
    const claude = new Claude(m, pipelineCfg.effort as 'medium');
    const logs: StoryLog[] = [];
    const built = await produce(claude, refSelection, cands, logs, want);
    const { briefing, scriptIssues } = await compose(claude, built, date, markets, logs, m, false);
    briefing.meta = { ...briefing.meta!, costUsd: +claude.usage.costUsd.toFixed(4) };
    writeJSON(join(dir, `${m}.json`), briefing);
    Object.assign((report.models as Record<string, Record<string, unknown>>)[m]!, { usage: claude.usage, stories: logs, script: scriptIssues });
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

  if (args.vertonen) {
    // Fertige Folge (z. B. die Demo) nur vertonen und mischen, ohne Claude
    const b = JSON.parse(readFileSync(args.vertonen, 'utf8')) as Briefing;
    for (const l of b.script) delete l.audio;
    delete b.audio;
    const report = await voice(b, args.stimme ?? cfg.episode.voice ?? 'voxcpm2');
    writeJSON(join(OUT, `${b.date}.json`), b);
    writeJSON(join(OUT, 'logs', `stimme-${b.date}.json`), report);
    output('changed', 'true');
    return;
  }

  if (!args['check-feeds'] && !process.env.ANTHROPIC_API_KEY) {
    // Noch nicht eingerichtet: kein Fehler, damit nicht jeden Morgen eine Fehlermail kommt
    console.log('::warning::Kein ANTHROPIC_API_KEY gesetzt – Tages-Update übersprungen. Anleitung: docs/einrichtung.md');
    return;
  }

  log(`Recherche für ${date} …`);
  const [{ candidates, report }, markets] = await Promise.all([research(), fetchMarkets()]);
  if (args['check-feeds']) {
    console.log(JSON.stringify(report, null, 2));
    console.log('Märkte:', markets ? JSON.stringify(markets.markets.items.map(i => `${i.name} ${i.value} (${i.changePct} %, ${i.date})`)) : 'nicht verfügbar');
    if (markets) console.log('Sätze:', markets.lines.map(l => l.text).join(' '));
    console.log(`${candidates.length} Kandidaten, z. B.:`);
    for (const c of candidates.slice(0, 15)) console.log(`  [${c.topics.join(',')}] ${c.source}: ${c.title}`);
    return;
  }
  if (candidates.length < 10) throw new Error(`Nur ${candidates.length} Kandidaten gefunden, Feeds prüfen.`);

  if (args.compare) {
    await compare(args.compare.split(',').map(s => s.trim()).filter(Boolean), date, candidates, markets);
    return;
  }

  const model = args.model ?? process.env.LAGEBILD_MODEL ?? pipelineCfg.model;
  const claude = new Claude(model, pipelineCfg.effort as 'medium');
  const want = wantedStories(cfg.episode.minutes);
  log(`Auswahl mit ${model} aus ${candidates.length} Kandidaten, Ziel ${want} Meldungen für ${cfg.episode.minutes} Minuten …`);
  const selections = await selectStories(claude, cfg, candidates, { dateLabel: dateLabel(date), yesterday: previousHeadlines(OUT, date), want, minutes: cfg.episode.minutes });
  const storyLogs: StoryLog[] = [];
  const built = await produce(claude, selections, candidates, storyLogs, want);
  if (!built.length) throw new Error('Keine Meldung hat den Faktencheck bestanden.');

  log(`Drehbuch für ${built.length} Meldungen …`);
  const { briefing, scriptIssues } = await compose(claude, built, date, markets, storyLogs, model);
  const tts = args['no-tts'] ? { skipped: true } : await voice(briefing, args.stimme ?? cfg.episode.voice ?? 'voxcpm2');
  briefing.meta = { ...briefing.meta!, costUsd: +claude.usage.costUsd.toFixed(4) };

  writeJSON(dayPath(OUT, date), briefing);
  writeIndex(OUT, briefing.generated);
  const pruned = pruneMedia(OUT, date, pipelineCfg.audioDays);
  writeJSON(join(OUT, 'logs', `${date}.json`), { date, model, candidates: candidates.length, research: report, selections, stories: storyLogs, script: { source: briefing.meta.script, issues: scriptIssues }, usage: claude.usage, tts, pruned });
  log(`Fertig: Folge ${briefing.episode}, ${briefing.stories.length} Meldungen (${briefing.meta.script === 'claude' ? 'Drehbuch' : 'einfache Fassung'}), Claude-Kosten ${claude.usage.costUsd.toFixed(3)} $ (${claude.usage.calls} Aufrufe).`);
  output('changed', 'true');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
