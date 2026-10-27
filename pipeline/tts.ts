// Sprachausgabe mit Azure Speech: eine MP3 pro Zeile, zwei Stimmen (BRIEFING / LAGE+EINORDNUNG),
// Wortenden als Zeitmarken für die Untertitel. Das Gratis-Kontingent (F0) erlaubt rund 20 Anfragen
// pro Minute, deshalb wird gedrosselt.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import type { AudioClip, Briefing, Line } from '../src/shared/types.ts';
import { log, sleep } from './util.ts';

export interface TtsOptions {
  key: string;
  region: string;
  voices: { briefing: string; main: string };
}

const MIN_GAP_MS = 3300;
const TICKS = 1e7; // Azure misst in 100-ns-Schritten

export const escapeXml = (s: string): string => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

export function ssml(text: string, voice: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="de-DE"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;
}

interface Spoken { audio: Uint8Array; dur: number; words: [number, number][] }

/** Wortenden in Anteile des Sprechtexts umrechnen (nach Zeichenzahl der Wörter). */
export function wordMarks(bounds: { end: number; len: number }[]): [number, number][] {
  const total = bounds.reduce((n, b) => n + b.len, 0) || 1;
  let acc = 0;
  return bounds.map(b => {
    acc += b.len;
    return [+b.end.toFixed(2), +(acc / total).toFixed(3)];
  });
}

function speakOnce(config: sdk.SpeechConfig, text: string, voice: string): Promise<Spoken> {
  return new Promise((resolve, reject) => {
    const synth = new sdk.SpeechSynthesizer(config, null as unknown as sdk.AudioConfig);
    const bounds: { end: number; len: number }[] = [];
    synth.wordBoundary = (_s, e) => {
      if (e.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) return;
      bounds.push({ end: (e.audioOffset + e.duration) / TICKS, len: e.wordLength || e.text.length });
    };
    synth.speakSsmlAsync(
      ssml(text, voice),
      result => {
        synth.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve({ audio: new Uint8Array(result.audioData), dur: result.audioDuration / TICKS, words: wordMarks(bounds) });
        } else {
          reject(new Error(result.errorDetails || `Azure: ${sdk.ResultReason[result.reason]}`));
        }
      },
      err => { synth.close(); reject(new Error(String(err))); }
    );
  });
}

/** Alle Zeilen eines Updates vertonen; Fehler einzelner Zeilen sind kein Abbruch (die App nimmt dann die Systemstimme). */
export async function synthesize(b: Briefing, out: string, opts: TtsOptions): Promise<Record<string, unknown>> {
  const config = sdk.SpeechConfig.fromSubscription(opts.key, opts.region);
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
  const rel = `audio/${b.date}`;
  mkdirSync(join(out, rel), { recursive: true });

  const jobs: { line: Line; name: string }[] = [
    { line: b.intro.morning, name: 'intro-morgen' },
    { line: b.intro.day, name: 'intro-tag' },
    { line: b.intro.evening, name: 'intro-abend' },
    ...b.stories.flatMap(s => [{ line: s.opener, name: `${s.id}-0` }, ...s.lines.map((line, k) => ({ line, name: `${s.id}-${k + 1}` }))]),
    ...(b.markets ? [b.markets.opener, ...b.markets.lines].map((line, k) => ({ line, name: `maerkte-${k}` })) : []),
    ...b.outro.map((line, k) => ({ line, name: `outro-${k + 1}` }))
  ];

  let chars = 0;
  const failed: string[] = [];
  let last = 0;
  for (const { line, name } of jobs) {
    const text = line.say ?? line.text;
    const voice = line.role === 'BRIEFING' ? opts.voices.briefing : opts.voices.main;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const wait = last + MIN_GAP_MS * attempt - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const r = await speakOnce(config, text, voice);
        const src = `${rel}/${name}.mp3`;
        writeFileSync(join(out, src), r.audio);
        const clip: AudioClip = { src, dur: +r.dur.toFixed(2), ...(r.words.length ? { words: r.words } : {}) };
        line.audio = clip;
        chars += text.length;
        break;
      } catch (e) {
        log(`Stimme ${name}, Versuch ${attempt}: ${(e as Error).message}`);
        if (attempt === 3) failed.push(name);
      }
    }
  }
  log(`Stimme: ${jobs.length - failed.length}/${jobs.length} Zeilen, ${chars} Zeichen`);
  return { lines: jobs.length, failed, chars, voices: opts.voices };
}
