// Stimme mit VoxCPM2 (offenes Modell): Sprechtext bauen (Zahlen und Abkürzungen ausgeschrieben),
// die Python-Engine pipeline/stimme_voxcpm.py aufrufen und ihre Zeilen als Clips an mix.ts geben.
// Die Engine prüft jede Zeile mit Whisper und erzeugt abweichende neu; Wortzeiten kommen aus Whisper.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sprechtext } from '../src/shared/sprechtext.ts';
import type { Line, Role } from '../src/shared/types.ts';
import { parseWav, type Clip } from './mix.ts';
import { wordMarks } from './tts.ts';
import { log } from './util.ts';

export interface VoxcpmConfig {
  /** Referenzstimme je Rolle: WAV und der Text, der darin gesprochen wird */
  voices: Record<Role, { ref: string; text: string }>;
  cfg: number;
  steps: number;
  attempts: number;
  whisper: string;
  seed?: number;
  /** Rechenformat auf der CPU; float32, weil die meisten Server-CPUs bfloat16 nur umgerechnet können */
  dtype?: 'float32' | 'bfloat16';
  /** Höchste Rechenzeit; danach fehlen die restlichen Zeilen und die Folge kommt ohne Audiodatei */
  maxMinutes?: number;
}

/** Frühester Start des Tageslaufs (Berlin), damit die Folge bis 8 Uhr fertig ist: Die Stimme rechnet
 *  auf dem öffentlichen GitHub-Server (4 Kerne, float32) etwa 20 Sekunden pro Sekunde Sprache,
 *  eine 8-Minuten-Folge also gut zwei Stunden. */
export function earliestStart(minutes: number, voice: string): string {
  return voice === 'voxcpm2' && minutes >= 8 ? '04:30' : '05:30';
}

export interface JobLine { i: number; role: Role; say: string; ref: string }

/** Auftrag für die Engine: Sprechtext zum Sprechen, ohne Buchstabieren zum Vergleich mit Whisper. */
export function voxcpmJob(lines: Line[], cfg: VoxcpmConfig): { lines: JobLine[] } & VoxcpmConfig {
  return {
    ...cfg,
    lines: lines.map((l, i) => {
      const text = l.say ?? l.text;
      return { i, role: l.role, say: sprechtext(text), ref: sprechtext(text, { spell: false }) };
    })
  };
}

interface EngineLine { i: number; ok: boolean; file: string; bounds: { end: number; len: number }[]; problems: string[]; attempts: number; cer: number }
interface EngineResult { lines: EngineLine[]; failed: number[]; [k: string]: unknown }

/** Ergebnis der Engine lesen; unbrauchbare oder fehlende Zeilen sind null. */
export function readClips(dir: string, res: EngineResult, n: number): (Clip | null)[] {
  const clips: (Clip | null)[] = Array.from({ length: n }, () => null);
  for (const r of res.lines) {
    if (!r.ok || r.i < 0 || r.i >= n) continue;
    const { pcm, sr } = parseWav(new Uint8Array(readFileSync(join(dir, r.file))));
    clips[r.i] = { pcm, sr, words: wordMarks(r.bounds) };
  }
  return clips;
}

export function synthesizeVoxcpm(lines: Line[], cfg: VoxcpmConfig, workDir: string): { clips: (Clip | null)[]; report: Record<string, unknown> } {
  mkdirSync(workDir, { recursive: true });
  const jobPath = join(workDir, 'auftrag.json');
  writeFileSync(jobPath, JSON.stringify(voxcpmJob(lines, cfg), null, 1));
  const python = process.env.LAGEBILD_PYTHON ?? 'python3';
  log(`Stimme mit VoxCPM2 für ${lines.length} Zeilen …`);
  const run = spawnSync(python, ['pipeline/stimme_voxcpm.py', jobPath, workDir], { stdio: 'inherit' });
  if (run.status !== 0) {
    log(`VoxCPM2-Engine fehlgeschlagen (Status ${run.status ?? run.signal}), keine Audiodatei`);
    return { clips: lines.map(() => null), report: { engine: 'voxcpm2', error: `Status ${run.status ?? run.signal}` } };
  }
  const res = JSON.parse(readFileSync(join(workDir, 'ergebnis.json'), 'utf8')) as EngineResult;
  const clips = readClips(workDir, res, lines.length);
  const { lines: per, ...summary } = res;
  return {
    clips,
    report: { ...summary, problems: per.filter(l => l.problems.length).map(l => ({ line: l.i + 1, ok: l.ok, attempts: l.attempts, problems: l.problems })) }
  };
}
