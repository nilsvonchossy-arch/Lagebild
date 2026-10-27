// Ton: Bass-Teppich und Blip über WebAudio, Sprache über ein <audio>-Element (vorproduzierte MP3s)
// mit Systemstimme (Web Speech API) als Rückfallebene und einem Timer-Modus ganz ohne Ton.
import type { Caption } from './fx';
import type { Line } from './shared/types';
import { speed } from './util';

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** Bass-Teppich und Blip. */
export class Atmo {
  private ctx: AudioContext | null = null;
  private drone: { g: GainNode; nodes: OscillatorNode[] } | null = null;
  enabled = true;

  /** Muss in einem Tipp-Ereignis aufgerufen werden (iOS). */
  unlock(): void {
    try {
      // iPad: Ton auch im Stumm-Modus abspielen (Safari 17+)
      const nav = navigator as AudioSessionNavigator;
      if (nav.audioSession) nav.audioSession.type = 'playback';
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
      o2.frequency.value = 55.5;
      lfo.frequency.value = 0.07;
      lg.gain.value = 55;
      lfo.connect(lg); lg.connect(f.frequency); o1.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination);
      for (const o of [o1, o2, lfo]) o.start();
      g.gain.linearRampToValueAtTime(0.05, ac.currentTime + 2.5);
      this.drone = { g, nodes: [o1, o2, lfo] };
    } catch { /* ohne Atmo weiter */ }
  }

  off(): void {
    const ac = this.ctx, d = this.drone;
    if (!ac || !d) return;
    this.drone = null;
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

export type SpeakResult = 'done' | 'interrupted' | 'cancel';

export interface VoiceSettings {
  speak: boolean;
  rate: number;
  /** voiceURI der Systemstimme für die Rückfallebene, leer = automatisch */
  systemVoice: string;
}

// Kurze stille WAV-Datei: wird beim ersten Tippen abgespielt, damit iOS das Element freigibt.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Vorlauf der Untertitel vor der Stimme in Sekunden */
const LEAD = 0.15;

/** Geschätzte Sprechdauer in ms, wenn es keine Audiodatei gibt. */
export const estimateMs = (text: string, rate = 1): number => (text.split(/\s+/).length * 360 + 700) / rate;

export class Voice {
  readonly systemOk = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  systemVoices: SpeechSynthesisVoice[] = [];
  private readonly el = new Audio();
  private pending: ((r: SpeakResult) => void) | null = null;
  private raf = 0;
  private mode: 'clip' | 'system' | 'timer' | null = null;

  constructor(
    private readonly settings: () => VoiceSettings,
    private readonly dataBase: () => string
  ) {
    this.el.preload = 'auto';
  }

  /** Im Tipp-Ereignis aufrufen: gibt das Audio-Element und die Systemstimme für spätere Wiedergabe frei. */
  unlock(): void {
    this.el.src = SILENCE;
    void this.el.play().catch(() => undefined);
    if (this.systemOk && this.settings().speak) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch { /* egal */ }
    }
  }

  loadSystemVoices(): void {
    if (!this.systemOk) return;
    const score = (v: SpeechSynthesisVoice): number => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (/premium|enhanced|neural|natural|online/.test(n)) s += 5;
      if (/google|microsoft/.test(n)) s += 2;
      return s;
    };
    this.systemVoices = speechSynthesis
      .getVoices()
      .filter(v => /^de([-_]|$)/i.test(v.lang))
      .sort((a, b) => score(b) - score(a));
  }

  /** Audiodateien vorab laden, damit es zwischen den Zeilen keine Pausen gibt. */
  prefetch(lines: Line[]): void {
    for (const l of lines) if (l.audio) void fetch(this.dataBase() + l.audio.src).catch(() => undefined);
  }

  speak(line: Line, caption: Caption): Promise<SpeakResult> {
    const s = this.settings();
    caption.show(line.role, line.text);
    return new Promise<SpeakResult>(resolve => {
      let finished = false;
      const done = (r: SpeakResult): void => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(this.raf);
        this.pending = null;
        this.mode = null;
        if (r === 'done') caption.reveal(1);
        resolve(r);
      };
      this.pending = done;

      if (s.speak && line.audio) this.playClip(line, caption, done, () => this.speakSystem(line, caption, done));
      else if (s.speak && this.systemOk) this.speakSystem(line, caption, done);
      else this.timer(line, caption, done);
    });
  }

  private playClip(line: Line, caption: Caption, done: (r: SpeakResult) => void, fallback: () => void): void {
    const clip = line.audio!;
    const el = this.el;
    this.mode = 'clip';
    const fail = (): void => {
      if (this.mode !== 'clip' || this.pending !== done) return;
      cancelAnimationFrame(this.raf);
      el.onended = el.onerror = null;
      fallback();
    };
    el.onended = () => done('done');
    el.onerror = fail;
    el.src = this.dataBase() + clip.src;
    el.playbackRate = this.settings().rate * speed();
    el.play().catch(fail);
    const words = clip.words;
    const tick = (): void => {
      const t = el.currentTime + LEAD;
      let frac = clip.dur ? t / clip.dur : 0;
      if (words?.length) {
        // erstes Wortende, das noch nicht erreicht ist → bis dorthin anzeigen
        const next = words.find(w => w[0] > t);
        frac = next ? next[1] : 1;
      }
      caption.reveal(frac);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private speakSystem(line: Line, caption: Caption, done: (r: SpeakResult) => void): void {
    const s = this.settings();
    if (!this.systemOk) { this.timer(line, caption, done); return; }
    this.mode = 'system';
    const text = line.say ?? line.text;
    const ms = estimateMs(text, s.rate);
    caption.typeOver(ms * 0.8);
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const main = this.systemVoices.find(v => v.voiceURI === s.systemVoice) ?? this.systemVoices[0];
      // zweite Stimme für BRIEFING, falls vorhanden
      const alt = line.role === 'BRIEFING' ? this.systemVoices.find(v => v !== main) : undefined;
      const v = alt ?? main;
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'de-DE';
      u.rate = s.rate;
      u.pitch = line.role === 'BRIEFING' && !alt ? 0.85 : 1;
      u.onend = () => done('done');
      u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled') done('done'); };
      speechSynthesis.speak(u);
    } catch { /* Timer unten greift */ }
    // Sicherheitsnetz, falls onend nie kommt (kommt auf manchen Geräten vor)
    setTimeout(() => { if (this.mode === 'system') done('done'); }, ms * 2.2 + 3000);
  }

  private timer(line: Line, caption: Caption, done: (r: SpeakResult) => void): void {
    this.mode = 'timer';
    const ms = line.audio ? (line.audio.dur * 1000) / this.settings().rate : estimateMs(line.text, this.settings().rate);
    caption.typeOver(ms * 0.8);
    setTimeout(() => { if (this.mode === 'timer') done('done'); }, ms / speed());
  }

  /** Pause: Audiodatei hält an; Systemstimme und Timer brechen ab und die Zeile startet nach dem Fortsetzen neu. */
  pause(): void {
    if (this.mode === 'clip') { this.el.pause(); return; }
    if (this.systemOk) try { speechSynthesis.cancel(); } catch { /* egal */ }
    this.pending?.('interrupted');
  }

  resume(): void {
    if (this.mode === 'clip') void this.el.play().catch(() => this.pending?.('done'));
  }

  /** Laufende Zeile abbrechen; sie startet sofort mit den aktuellen Einstellungen neu (z. B. Stimme aus). */
  interrupt(): void {
    this.el.pause();
    if (this.systemOk) try { speechSynthesis.cancel(); } catch { /* egal */ }
    this.pending?.('interrupted');
  }

  stop(): void {
    this.el.pause();
    if (this.systemOk) try { speechSynthesis.cancel(); } catch { /* egal */ }
    this.pending?.('cancel');
  }
}
