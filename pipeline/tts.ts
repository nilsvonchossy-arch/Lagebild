// Sprachausgabe mit Azure Speech (Gratis-Kontingent F0): drei Stimmen, eine pro Rolle. Jede Zeile wird
// einzeln als WAV erzeugt, mit Wortenden als Zeitmarken; mix.ts setzt daraus die Folge zusammen.
// F0 erlaubt rund 20 Anfragen pro Minute, deshalb wird gedrosselt.
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import type { Line, Role } from '../src/shared/types.ts';
import { parseWav, type Clip } from './mix.ts';
import { log, sleep } from './util.ts';

export interface VoiceSpec {
  name: string;
  /** SSML-Prosodie, z. B. "-4%" */
  rate?: string;
  pitch?: string;
}

export interface TtsOptions {
  key: string;
  region: string;
  voices: Record<Role, VoiceSpec>;
}

const MIN_GAP_MS = 3300;
const TICKS = 1e7; // Azure misst in 100-ns-Schritten

export const escapeXml = (s: string): string => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

export function ssml(text: string, voice: VoiceSpec | string): string {
  const v = typeof voice === 'string' ? { name: voice } : voice;
  const attrs = [v.rate ? `rate="${v.rate}"` : '', v.pitch ? `pitch="${v.pitch}"` : ''].filter(Boolean).join(' ');
  const body = attrs ? `<prosody ${attrs}>${escapeXml(text)}</prosody>` : escapeXml(text);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="de-DE"><voice name="${v.name}">${body}</voice></speak>`;
}

/** Wortenden in Anteile des Sprechtexts umrechnen (nach Zeichenzahl der Wörter). */
export function wordMarks(bounds: { end: number; len: number }[]): [number, number][] {
  const total = bounds.reduce((n, b) => n + b.len, 0) || 1;
  let acc = 0;
  return bounds.map(b => {
    acc += b.len;
    return [+b.end.toFixed(2), +(acc / total).toFixed(3)];
  });
}

function speakOnce(config: sdk.SpeechConfig, text: string, voice: VoiceSpec): Promise<Clip> {
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
          const { pcm, sr } = parseWav(new Uint8Array(result.audioData));
          resolve({ pcm, sr, words: wordMarks(bounds) });
        } else {
          reject(new Error(result.errorDetails || `Azure: ${sdk.ResultReason[result.reason]}`));
        }
      },
      err => { synth.close(); reject(new Error(String(err))); }
    );
  });
}

/** Alle Zeilen vertonen. Fehlt danach auch nur eine Zeile, gibt es keine Audiodatei (die App spricht dann selbst). */
export async function synthesizeLines(lines: Line[], opts: TtsOptions): Promise<{ clips: (Clip | null)[]; report: Record<string, unknown> }> {
  const config = sdk.SpeechConfig.fromSubscription(opts.key, opts.region);
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
  let chars = 0;
  const failed: number[] = [];
  const clips: (Clip | null)[] = [];
  let last = 0;
  for (const [i, line] of lines.entries()) {
    const text = line.say ?? line.text;
    let clip: Clip | null = null;
    for (let attempt = 1; attempt <= 3 && !clip; attempt++) {
      const wait = last + MIN_GAP_MS * attempt - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        clip = await speakOnce(config, text, opts.voices[line.role]);
        chars += text.length;
      } catch (e) {
        log(`Stimme Zeile ${i + 1}, Versuch ${attempt}: ${(e as Error).message}`);
      }
    }
    if (!clip) failed.push(i + 1);
    clips.push(clip);
  }
  log(`Stimme: ${lines.length - failed.length}/${lines.length} Zeilen, ${chars} Zeichen`);
  return { clips, report: { lines: lines.length, failed, chars, voices: opts.voices } };
}
