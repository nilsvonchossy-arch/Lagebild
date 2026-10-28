// Mischung der Folge: Zeilen ohne Stille am Rand, gleich laut, Pausen nach den Regeln aus
// src/shared/script.ts, darunter ein durchgehendes Musikbett (tief, Puls bei 120 BPM, selbst erzeugt,
// daher ohne Lizenzfrage). Ergebnis: zwei MP3s (mit und ohne Musik) und die Zeitmarken jeder Zeile.
// ffmpeg übernimmt nur Lautheit (EBU R128) und MP3-Kodierung.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEAD_IN, pauseBefore, TAIL } from '../src/shared/script.ts';
import type { Line } from '../src/shared/types.ts';

/** Eine gesprochene Zeile: Mono-Samples, Abtastrate, Wortenden [Sekunde, Anteil] */
export interface Clip { pcm: Float32Array; sr: number; words: [number, number][] }

/** 16-Bit-PCM-WAV lesen (Azure liefert RIFF 24 kHz mono). */
export function parseWav(buf: Uint8Array): { pcm: Float32Array; sr: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number): string => String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Keine WAV-Datei');
  let sr = 24000, channels = 1, bits = 16, off = 12;
  while (off + 8 <= buf.length) {
    const id = tag(off), size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(off + 10, true);
      sr = dv.getUint32(off + 12, true);
      bits = dv.getUint16(off + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`WAV mit ${bits} Bit nicht unterstützt`);
      const n = Math.floor(Math.min(size, buf.length - off - 8) / 2 / channels);
      const pcm = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += dv.getInt16(off + 8 + (i * channels + c) * 2, true);
        pcm[i] = s / channels / 32768;
      }
      return { pcm, sr };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV ohne Daten');
}

export function wavBytes(pcm: Float32Array, sr: number): Uint8Array {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string): void => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(pcm[i]! * 32767))), true);
  return new Uint8Array(buf);
}

/** Erstes und letztes Sample über der Schwelle (relativ zur Spitze), mit etwas Rand. */
export function trimBounds(pcm: Float32Array, sr: number, db = -42, padMs = 30): [number, number] {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (!peak) return [0, pcm.length];
  const thr = peak * 10 ** (db / 20);
  let a = 0, b = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]!) < thr) a++;
  while (b > a && Math.abs(pcm[b]!) < thr) b--;
  const pad = Math.round((padMs / 1000) * sr);
  return [Math.max(0, a - pad), Math.min(pcm.length, b + 1 + pad)];
}

/** Verstärkung, damit die lauten Teile einer Zeile bei `targetDb` RMS liegen; Spitzen bleiben unter -1 dBFS. */
export function levelGain(pcm: Float32Array, targetDb = -20): number {
  const frame = 1024;
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let s = 0;
    for (let k = i; k < i + frame; k++) { s += pcm[k]! ** 2; peak = Math.max(peak, Math.abs(pcm[k]!)); }
    rms.push(Math.sqrt(s / frame));
  }
  if (!rms.length) return 1;
  const max = Math.max(...rms);
  const loud = rms.filter(r => r > max * 0.25);
  const cur = Math.sqrt(loud.reduce((a, r) => a + r * r, 0) / loud.length) || 1e-9;
  let g = 10 ** (targetDb / 20) / cur;
  if (peak * g > 0.89) g = 0.89 / peak;
  return g;
}

/**
 * Musikbett: zwei leicht verstimmte Sägezähne bei 55 Hz (nur tiefe Obertöne, langsam atmend),
 * ein leiser Ton bei 110 Hz für kleine Lautsprecher und ein weicher Puls auf jedem Schlag bei 120 BPM.
 */
export function musicBed(sec: number, sr: number): Float32Array {
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  const harm = Array.from({ length: 10 }, (_, k) => k + 1);
  const amp = harm.map(h => Math.exp(-(55 * h) / 260) / h);
  const beat = 0.5;
  const fadeIn = 1.2 * sr, fadeOut = 1.6 * sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bright = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.07 * t);
    let s = 0;
    for (let k = 0; k < harm.length; k++) {
      const a = amp[k]! * (k > 2 ? bright : 1);
      s += a * (Math.sin(2 * Math.PI * 55 * harm[k]! * t) + Math.sin(2 * Math.PI * 55.4 * harm[k]! * t + 1.3));
    }
    s = s * 0.5 + 0.35 * Math.sin(2 * Math.PI * 110 * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.05 * t));
    // Puls: kurzer Ton, der von 95 auf 48 Hz fällt
    const tb = t % beat;
    const phase = 2 * Math.PI * (48 * tb + 47 * 0.04 * (1 - Math.exp(-tb / 0.04)));
    s += 1.6 * Math.sin(phase) * Math.exp(-tb / 0.09);
    const env = Math.min(1, i / fadeIn, (n - i) / fadeOut);
    out[i] = s * env;
  }
  // auf -30 dBFS RMS bringen: etwa 10 dB unter den Stimmen
  let e = 0;
  for (const v of out) e += v * v;
  const g = 10 ** (-30 / 20) / (Math.sqrt(e / n) || 1);
  for (let i = 0; i < n; i++) out[i]! *= g;
  return out;
}

export interface Layout { at: number[]; trims: [number, number][]; total: number }

/** Startzeiten der Zeilen in der Folge: Vorlauf, Zeile, Pause nach Regel, Zeile … */
export function layoutLines(lines: Line[], clips: Clip[]): Layout {
  let t = LEAD_IN;
  const at: number[] = [];
  const trims: [number, number][] = [];
  lines.forEach((l, i) => {
    const c = clips[i]!;
    const [a, b] = trimBounds(c.pcm, c.sr);
    trims.push([a, b]);
    t += pauseBefore(lines[i - 1], l);
    at.push(+t.toFixed(3));
    t += (b - a) / c.sr;
  });
  return { at, trims, total: t + TAIL };
}

function encode(pcm: Float32Array, sr: number, mp3: string, tmp: string): void {
  writeFileSync(tmp, wavBytes(pcm, sr));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', String(sr), '-ac', '1', '-b:a', '64k', mp3]);
  rmSync(tmp, { force: true });
}

/**
 * Folge zusammensetzen und als MP3 ablegen (mit Musikbett und nur Stimmen). Setzt line.audio
 * (Beginn, Länge, Wortenden ab Zeilenbeginn) und liefert die Pfade relativ zum Datenordner.
 */
export function mixEpisode(lines: Line[], clips: Clip[], out: string, rel: string): { src: string; voice: string; dur: number } {
  const sr = clips[0]!.sr;
  if (clips.some(c => c.sr !== sr)) throw new Error('Unterschiedliche Abtastraten');
  const lay = layoutLines(lines, clips);
  const voice = new Float32Array(Math.ceil(lay.total * sr));
  lines.forEach((l, i) => {
    const c = clips[i]!;
    const [a, b] = lay.trims[i]!;
    const g = levelGain(c.pcm.subarray(a, b));
    const start = Math.round(lay.at[i]! * sr);
    for (let k = a; k < b; k++) voice[start + k - a] = c.pcm[k]! * g;
    const shift = a / sr;
    const dur = (b - a) / sr;
    l.audio = {
      at: lay.at[i]!,
      dur: +dur.toFixed(3),
      ...(c.words.length ? { words: c.words.map(([s, f]) => [+Math.min(dur, Math.max(0, s - shift)).toFixed(2), f] as [number, number]) } : {})
    };
  });
  const bed = musicBed(lay.total, sr);
  const mixed = new Float32Array(voice.length);
  for (let i = 0; i < voice.length; i++) mixed[i] = voice[i]! + (bed[i] ?? 0);
  mkdirSync(join(out, rel), { recursive: true });
  const src = `${rel}/folge.mp3`, plain = `${rel}/folge-stimme.mp3`;
  encode(mixed, sr, join(out, src), join(out, rel, 'mix.wav'));
  encode(voice, sr, join(out, plain), join(out, rel, 'stimme.wav'));
  return { src, voice: plain, dur: +lay.total.toFixed(2) };
}
