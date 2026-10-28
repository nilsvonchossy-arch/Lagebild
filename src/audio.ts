// Ton: Die Folge kommt als eine Audiodatei (Stimmen, Pausen und Musikbett schon gemischt), damit sie
// gleichmäßig klingt und bei gesperrtem iPad weiterläuft. Ohne Datei (Demo, altes Archiv) spricht die
// Systemstimme Zeile für Zeile; dann liefert WebAudio den Bass-Teppich.
import type { Line, Role } from './shared/types';

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** iPad: Ton auch im Stumm-Modus und im Hintergrund abspielen (Safari 17+). */
export function playbackSession(): void {
  try {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch { /* ältere Geräte */ }
}

/** Bass-Teppich mit leichtem Puls und Blip über WebAudio, nur ohne Audiodatei. */
export class Atmo {
  private ctx: AudioContext | null = null;
  private drone: { g: GainNode; nodes: AudioScheduledSourceNode[]; timer: number } | null = null;
  enabled = true;

  /** Muss in einem Tipp-Ereignis aufgerufen werden (iOS). */
  unlock(): void {
    playbackSession();
    try {
      const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!AC) return;
      this.ctx ??= new AC();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  on(): void {
    const ac = this.ctx;
    if (!ac || this.drone || !this.enabled) return;
    try {
      const g = ac.createGain();
      g.gain.value = 0;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 150;
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
      o1.type = o2.type = 'sawtooth';
      o1.frequency.value = 55;
      o2.frequency.value = 55.4;
      lfo.frequency.value = 0.07;
      lg.gain.value = 55;
      lfo.connect(lg); lg.connect(f.frequency); o1.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination);
      for (const o of [o1, o2, lfo]) o.start();
      g.gain.linearRampToValueAtTime(0.05, ac.currentTime + 2.5);
      // Puls bei 120 BPM: kurzer, fallender Ton auf jedem Schlag
      const pulse = (): void => {
        const t = ac.currentTime + 0.05;
        for (let k = 0; k < 4; k++) {
          const o = ac.createOscillator(), e = ac.createGain(), at = t + k * 0.5;
          o.frequency.setValueAtTime(95, at);
          o.frequency.exponentialRampToValueAtTime(48, at + 0.12);
          e.gain.setValueAtTime(0.0001, at);
          e.gain.exponentialRampToValueAtTime(0.09, at + 0.008);
          e.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
          o.connect(e); e.connect(g);
          o.start(at); o.stop(at + 0.32);
        }
      };
      pulse();
      const timer = window.setInterval(pulse, 2000);
      this.drone = { g, nodes: [o1, o2, lfo], timer };
    } catch { /* ohne Atmo weiter */ }
  }

  off(): void {
    const ac = this.ctx, d = this.drone;
    if (!ac || !d) return;
    this.drone = null;
    clearInterval(d.timer);
    d.g.gain.cancelScheduledValues(ac.currentTime);
    d.g.gain.setValueAtTime(d.g.gain.value, ac.currentTime);
    d.g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8);
    setTimeout(() => d.nodes.forEach(o => { try { o.stop(); } catch { /* schon gestoppt */ } }), 1000);
  }

  blip(): void {
    const ac = this.ctx;
    if (!ac || !this.enabled) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = 'sine';
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(1480, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + 0.22);
    } catch { /* egal */ }
  }
}

// Kurze stille WAV-Datei: wird beim ersten Tippen abgespielt, damit iOS das Element freigibt.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Die gemischte Folge als ein <audio>-Element; die Zeit dieses Elements steuert Bild und Untertitel. */
export class EpisodeAudio {
  readonly el = new Audio();
  private src = '';

  constructor() {
    this.el.preload = 'auto';
  }

  /** Im Tipp-Ereignis aufrufen, bevor eine Folge startet. */
  unlock(): void {
    playbackSession();
    if (this.src) return;
    this.el.src = SILENCE;
    void this.el.play().catch(() => undefined);
  }

  /** Quelle wechseln, ohne die Position zu verlieren (z. B. Musikbett an/aus). */
  load(src: string, keepTime = false): void {
    if (src === this.src) return;
    const t = keepTime ? this.el.currentTime : 0;
    const playing = keepTime && !this.el.paused;
    this.src = src;
    this.el.src = src;
    if (keepTime) {
      const go = (): void => { this.el.currentTime = t; if (playing) void this.el.play().catch(() => undefined); };
      if (this.el.readyState >= 1) go(); else this.el.addEventListener('loadedmetadata', go, { once: true });
    }
  }

  get time(): number {
    return this.el.currentTime;
  }

  seek(t: number): void {
    try { this.el.currentTime = Math.max(0, t); } catch { /* noch nicht geladen */ }
  }

  play(): Promise<void> {
    return this.el.play();
  }

  pause(): void {
    this.el.pause();
  }

  reset(): void {
    this.el.pause();
    this.src = '';
  }
}

/** Geschätzte Sprechdauer der Systemstimme in ms */
export const estimateMs = (text: string, rate = 1): number => (text.split(/\s+/).length * 360 + 500) / rate;

/** Systemstimme (Web Speech API) als Rückfallebene, drei Rollen mit unterschiedlicher Stimme oder Tonhöhe. */
export class SystemVoice {
  readonly ok = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  voices: SpeechSynthesisVoice[] = [];
  private token = 0;

  unlock(): void {
    if (!this.ok) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch { /* egal */ }
  }

  load(): void {
    if (!this.ok) return;
    const score = (v: SpeechSynthesisVoice): number => (/premium|enhanced|neural|natural|online/i.test(v.name) ? 5 : 0) + (/google|microsoft/i.test(v.name) ? 2 : 0);
    this.voices = speechSynthesis.getVoices().filter(v => /^de([-_]|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a));
  }

  /** Stimme und Tonhöhe je Rolle: LAGE nimmt die gewählte Stimme, die anderen Rollen andere, falls vorhanden. */
  private pick(role: Role, preferred: string): { voice?: SpeechSynthesisVoice; pitch: number } {
    const main = this.voices.find(v => v.voiceURI === preferred) ?? this.voices[0];
    const others = this.voices.filter(v => v !== main);
    if (role === 'LAGE') return { voice: main, pitch: 1.05 };
    if (role === 'LEITUNG') return { voice: others[0] ?? main, pitch: others[0] ? 0.9 : 0.8 };
    return { voice: others[1] ?? others[0] ?? main, pitch: others.length > 1 ? 0.95 : 0.88 };
  }

  /** Zeile sprechen; `progress` bekommt den gesprochenen Anteil (aus Wortgrenzen oder geschätzt). */
  speak(line: Line, opts: { rate: number; preferred: string }, progress: (frac: number) => void): Promise<'done' | 'cancel'> {
    const my = ++this.token;
    const text = line.say ?? line.text;
    const ms = estimateMs(text, opts.rate);
    return new Promise(resolve => {
      let finished = false;
      const t0 = performance.now();
      let boundary = false;
      const done = (r: 'done' | 'cancel'): void => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        resolve(r);
      };
      const tick = (): void => {
        if (my !== this.token) { done('cancel'); return; }
        if (!boundary) progress(Math.min(0.98, (performance.now() - t0) / ms));
        raf = requestAnimationFrame(tick);
      };
      let raf = requestAnimationFrame(tick);
      if (!this.ok) { setTimeout(() => done(my === this.token ? 'done' : 'cancel'), ms); return; }
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const p = this.pick(line.role, opts.preferred);
        if (p.voice) { u.voice = p.voice; u.lang = p.voice.lang; } else u.lang = 'de-DE';
        u.rate = opts.rate;
        u.pitch = p.pitch;
        u.onboundary = e => { boundary = true; progress(Math.min(1, e.charIndex / Math.max(1, text.length))); };
        u.onend = () => done(my === this.token ? 'done' : 'cancel');
        u.onerror = e => done(e.error === 'interrupted' || e.error === 'canceled' ? 'cancel' : 'done');
        speechSynthesis.speak(u);
      } catch { /* Sicherheitsnetz unten */ }
      // falls onend nie kommt (kommt auf manchen Geräten vor)
      setTimeout(() => { if (my === this.token) done('done'); }, ms * 2.2 + 3000);
    });
  }

  cancel(): void {
    this.token++;
    if (this.ok) try { speechSynthesis.cancel(); } catch { /* egal */ }
  }
}

/** Ganz ohne Ton: Zeile dauert so lange, wie sie gesprochen ungefähr dauern würde. */
export function silentLine(line: Line, rate: number, progress: (frac: number) => void, cancelled: () => boolean): Promise<'done' | 'cancel'> {
  const ms = line.audio ? (line.audio.dur * 1000) / rate : estimateMs(line.say ?? line.text, rate);
  const t0 = performance.now();
  return new Promise(resolve => {
    const tick = (): void => {
      if (cancelled()) { resolve('cancel'); return; }
      const k = (performance.now() - t0) / ms;
      progress(Math.min(1, k));
      if (k >= 1) resolve('done'); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
