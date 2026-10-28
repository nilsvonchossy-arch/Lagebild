// Ablauf einer Folge. Mit Audiodatei bestimmt die Zeit dieser Datei alles: Untertitel, Kamerafahrten,
// Karte und Bild-Beats folgen ihr, auch nach Pausen, Sprüngen oder gesperrtem Bildschirm.
// Ohne Datei spricht die Systemstimme Zeile für Zeile mit denselben Pausenregeln.
// Jeder Start und jeder Sprung erhöht `gen`; alte Abläufe merken das und brechen ab.
import { Atmo, EpisodeAudio, SystemVoice, estimateMs, silentLine } from './audio';
import { Card, categoryColor } from './card';
import { countUp, scramble, Subtitle } from './fx';
import type { Globe } from './globe';
import { fallbackSymbol } from './shared/symbols';
import { comparisonAtFigure, cuesFor, LEAD_IN, pauseBefore, secToFrac, type Cue } from './shared/script';
import type { Briefing, Story } from './shared/types';
import { $, dateParts, pad2, sleep, speed } from './util';
import { comparisonHTML, deadlineHTML, symbolHTML, type Viz } from './viz';

const CANCEL = Symbol('cancel');
const MEDIA = Symbol('media');
const FRANKFURT: [number, number] = [8.68, 50.11];
/** Untertitel erscheinen so viele Sekunden vor der Stimme */
const LEAD = 0.12;
/** Wie lange Einblendungen stehen bleiben (ms bei normalem Tempo) */
const HOLD = { comparison: 5200, deadline: 4200, image: 5600, symbol: 2600 };
const VISUAL = new Set<Cue['kind']>(['comparison', 'deadline', 'image']);

export interface PlayerHooks {
  /** Fortschritt: Abschnitt (Meldung oder Märkte) und Anteil darin */
  progress(scene: number, frac: number): void;
  state(): void;
  finished(): void;
  /** Layout hat sich geändert (Karte ein/aus), Globus braucht neue Maße */
  layout(): void;
}

export interface PlayerSettings {
  speak: boolean;
  music: boolean;
  rate: number;
  systemVoice: string;
}

/** Abschnitt der Folge: eine Meldung, die Märkte oder der Schluss */
export interface Scene {
  key: string;
  story: Story | null;
  first: number;
  last: number;
  /** erste Zeile, die keine Frage ist: ab hier erscheint die Karte */
  firstFact: number;
  /** Mindestens ein Vergleich, Termin oder Archivbild wird im Dialog genannt; sonst zeigt die Meldung ihr Symbol */
  hasVisual: boolean;
  /** Der Dialog nennt keinen anderen Vergleichswert: Vergleich bei der Hauptzahl zeigen */
  cmpAtFigure: boolean;
}

export function scenesOf(b: Briefing): Scene[] {
  const out: Scene[] = [];
  b.script.forEach((l, i) => {
    const key = l.story ?? '_ende';
    const cur = out[out.length - 1];
    if (cur && cur.key === key) { cur.last = i; if (cur.firstFact < 0 && l.role !== 'LEITUNG') cur.firstFact = i; return; }
    out.push({ key, story: b.stories.find(s => s.id === key) ?? null, first: i, last: i, firstFact: l.role !== 'LEITUNG' ? i : -1, hasVisual: false, cmpAtFigure: false });
  });
  for (const s of out) {
    if (s.firstFact < 0) s.firstFact = s.first;
    const st = s.story;
    if (!st) continue;
    const lines = b.script.slice(s.first, s.last + 1);
    s.cmpAtFigure = comparisonAtFigure(st, lines);
    s.hasVisual = lines.some(l => cuesFor(st, l, { comparisonAtFigure: s.cmpAtFigure }).some(c => VISUAL.has(c.kind)));
  }
  return out;
}

export class Player {
  briefing: Briefing | null = null;
  scenes: Scene[] = [];
  playing = false;
  paused = false;
  lineIdx = -1;
  sceneIdx = -1;
  private sceneOfLine: number[] = [];
  private mode: 'file' | 'speech' = 'speech';
  /** Audiodatei ließ sich nicht abspielen: für diese Folge die Systemstimme nehmen */
  private fileBroken = false;
  private gen = 0;
  private lock: WakeLockSentinel | null = null;
  private cues: Cue[] = [];
  private fired = new Set<string>();
  private arrived = false;
  private factStarted = false;

  constructor(
    private readonly globe: Globe,
    private readonly card: Card,
    private readonly sub: Subtitle,
    private readonly audio: EpisodeAudio,
    private readonly sys: SystemVoice,
    private readonly atmo: Atmo,
    private readonly viz: Viz,
    private readonly settings: () => PlayerSettings,
    private readonly hooks: PlayerHooks
  ) {
    // Steuerung von außen (Sperrbildschirm, Kopfhörer) im Zustand nachziehen
    const el = audio.el;
    el.addEventListener('pause', () => { if (this.playing && this.mode === 'file' && !el.ended && !this.paused) { this.paused = true; this.hooks.state(); } });
    el.addEventListener('play', () => { if (this.playing && this.mode === 'file' && this.paused) { this.paused = false; this.hooks.state(); } });
  }

  load(b: Briefing): void {
    this.stop();
    this.briefing = b;
    this.fileBroken = false;
    this.scenes = scenesOf(b);
    this.sceneOfLine = [];
    this.scenes.forEach((s, k) => { for (let i = s.first; i <= s.last; i++) this.sceneOfLine[i] = k; });
  }

  /** Abschnitte mit Fortschrittsbalken: Meldungen und Märkte, ohne Schluss */
  get segments(): number {
    return this.scenes.filter(s => s.key !== '_ende').length;
  }

  get hasFile(): boolean {
    return Boolean(this.briefing?.audio) && !this.fileBroken;
  }

  private fileSrc(): string {
    const a = this.briefing!.audio!;
    return this.dataBase + (this.settings().music ? a.src : a.voice);
  }

  dataBase = '';

  /** Im Tipp-Ereignis aufrufen. */
  start(): void {
    if (!this.briefing?.script.length) return;
    this.audio.unlock();
    this.atmo.unlock();
    if (!this.hasFile && this.settings().speak) this.sys.unlock();
    void this.run(0, false, true);
  }

  /** Zu einer Zeile springen; Bild ohne Kamerafahrt dorthin setzen. */
  jumpLine(i: number): void {
    if (!this.playing || !this.briefing) return;
    const n = this.briefing.script.length;
    void this.run(Math.max(0, Math.min(n - 1, i)), true, true);
  }

  nextScene(): void {
    const s = this.scenes[this.sceneIdx + 1];
    if (s) this.jumpLine(s.first);
  }

  prevScene(): void {
    const cur = this.scenes[this.sceneIdx];
    if (!cur) return;
    const back = this.lineIdx > cur.firstFact + 1 ? cur : this.scenes[this.sceneIdx - 1] ?? cur;
    this.jumpLine(back.first);
  }

  togglePause(): void {
    if (!this.playing) { this.start(); return; }
    this.paused = !this.paused;
    if (this.mode === 'file') {
      if (this.paused) this.audio.pause(); else void this.audio.play().catch(() => undefined);
    } else if (this.paused) { this.sys.cancel(); this.atmo.off(); }
    else this.atmo.on();
    this.hooks.state();
  }

  /** Stimme an/aus oder Musik an/aus während der Wiedergabe übernehmen. */
  applySettings(): void {
    const s = this.settings();
    if (this.mode === 'file') {
      this.audio.el.muted = !s.speak;
      this.audio.el.playbackRate = s.rate * speed();
      if (this.playing) this.audio.load(this.fileSrc(), true);
    } else {
      this.atmo.enabled = s.music;
      if (this.playing && !this.paused && s.music) this.atmo.on(); else this.atmo.off();
      if (this.playing && !this.paused) this.jumpLine(this.lineIdx);
    }
  }

  /** Nach dem Zurückkehren in die App: Bild auf den Stand der weitergelaufenen Audiodatei setzen. */
  resync(): void {
    if (!this.playing || this.mode !== 'file' || !this.briefing) return;
    const t = this.audio.time;
    const lines = this.briefing.script;
    let i = 0;
    for (let k = 0; k < lines.length; k++) if ((lines[k]!.audio?.at ?? 0) <= t + 0.05) i = k;
    if (i !== this.lineIdx) void this.run(i, true, false);
  }

  stop(): void {
    this.gen++;
    this.sys.cancel();
    if (this.playing) this.finish(false);
  }

  /* ---------- Warten ---------- */

  private check(my: number): void {
    if (my !== this.gen) throw CANCEL;
  }

  /** Wartet `ms` (Sprechtempo und Testbeschleunigung eingerechnet), hält während einer Pause an. */
  private async wait(my: number, ms: number): Promise<void> {
    let left = ms / this.settings().rate / speed();
    while (left > 0) {
      const step = Math.min(left, 100);
      await new Promise(r => setTimeout(r, step));
      this.check(my);
      if (!this.paused) left -= step;
    }
  }

  /** Bis die Audiodatei Sekunde `t` erreicht; `frame` läuft bei jedem Bild mit. */
  private until(my: number, t: number, frame?: (time: number) => void): Promise<void> {
    const el = this.audio.el;
    return new Promise((resolve, reject) => {
      let raf = 0;
      const cleanup = (): void => { cancelAnimationFrame(raf); el.removeEventListener('timeupdate', test); el.removeEventListener('ended', test); el.removeEventListener('error', test); };
      const test = (): boolean => {
        if (my !== this.gen) { cleanup(); reject(CANCEL); return true; }
        if (el.error) { cleanup(); reject(MEDIA); return true; }
        frame?.(el.currentTime);
        if (el.currentTime >= t || el.ended) { cleanup(); resolve(); return true; }
        return false;
      };
      const tick = (): void => { if (!test()) raf = requestAnimationFrame(tick); };
      // timeupdate hält den Ablauf auch dann in Gang, wenn im Hintergrund keine Bilder gezeichnet werden
      el.addEventListener('timeupdate', test);
      el.addEventListener('ended', test);
      el.addEventListener('error', test);
      tick();
    });
  }

  /* ---------- Ablauf ---------- */

  private async run(from: number, instant: boolean, seek: boolean): Promise<void> {
    const b = this.briefing!;
    const lines = b.script;
    const my = ++this.gen;
    const s = this.settings();
    this.sys.cancel();
    this.playing = true;
    this.paused = false;
    this.sceneIdx = -1;
    this.globe.mode = 'brief';
    this.mode = this.hasFile ? 'file' : 'speech';
    this.hooks.state();
    void this.wakeLock();
    this.mediaSession();
    try {
      if (this.mode === 'file') {
        this.atmo.off();
        this.audio.load(this.fileSrc());
        this.audio.el.muted = !s.speak;
        this.audio.el.playbackRate = s.rate * speed();
        if (seek) this.audio.seek(from === 0 ? 0 : Math.max(0, (lines[from]!.audio?.at ?? 0) - 0.25));
        await this.audio.play().catch(() => {
          // Datei nicht abspielbar (offline, gelöscht): mit der Systemstimme weiter
          this.fileBroken = true;
          this.mode = 'speech';
          this.audio.pause();
        });
        this.check(my);
      }
      if (this.mode === 'speech') {
        this.atmo.enabled = s.music;
        this.atmo.on();
      }
      if (from === 0 && !instant) this.intro();
      for (let i = from; i < lines.length; i++) {
        const l = lines[i]!;
        const sc = this.sceneOfLine[i]!;
        if (sc !== this.sceneIdx) this.enterScene(my, sc, i, instant && i === from);
        if (this.mode === 'file') await this.until(my, (l.audio?.at ?? 0) - LEAD);
        else await this.wait(my, (i === from ? (i === 0 ? LEAD_IN : 0.2) : pauseBefore(lines[i - 1], l)) * 1000);
        this.lineIdx = i;
        this.lineStart(i);
        if (this.mode === 'file') await this.followFile(my, i);
        else await this.followSpeech(my, i);
      }
      if (this.mode === 'file') await this.until(my, (b.audio?.dur ?? 0) - 0.3);
      else await this.wait(my, 1200);
      this.finish(true);
    } catch (e) {
      if (e === MEDIA && my === this.gen) {
        // Datei bricht mitten in der Folge ab: ab der aktuellen Zeile mit der Systemstimme weiter
        this.fileBroken = true;
        this.audio.pause();
        void this.run(Math.max(0, this.lineIdx), true, false);
      } else if (e !== CANCEL) { console.error(e); this.finish(false); }
    }
  }

  private followFile(my: number, i: number): Promise<void> {
    const l = this.briefing!.script[i]!;
    const a = l.audio!;
    return this.until(my, a.at + a.dur, t => this.lineProgress(i, secToFrac(a.words, t - a.at + LEAD, a.dur)));
  }

  private async followSpeech(my: number, i: number): Promise<void> {
    const l = this.briefing!.script[i]!;
    const s = this.settings();
    for (;;) {
      while (this.paused) { await new Promise(r => setTimeout(r, 120)); this.check(my); }
      const res = s.speak && this.sys.ok
        ? await this.sys.speak(l, { rate: s.rate, preferred: s.systemVoice }, f => this.lineProgress(i, f))
        : await silentLine(l, s.rate * speed(), f => this.lineProgress(i, f), () => my !== this.gen || this.paused);
      this.check(my);
      if (res === 'done') { this.lineProgress(i, 1); return; }
      // abgebrochen durch Pause: Zeile nach dem Fortsetzen neu sprechen
    }
  }

  private lineStart(i: number): void {
    const b = this.briefing!;
    const l = b.script[i]!;
    const scene = this.scenes[this.sceneIdx]!;
    this.sub.show(l.role, l.text);
    this.cues = scene.story ? cuesFor(scene.story, l, { comparisonAtFigure: scene.cmpAtFigure }).filter(c => !this.fired.has(this.cueKey(c))) : [];
    if (i >= scene.firstFact && !this.factStarted) {
      this.factStarted = true;
      void sleep(300).then(() => this.maybeShowCard());
      const st = scene.story;
      if (st && !scene.hasVisual) {
        const my = this.gen;
        void sleep(700).then(() => {
          if (my === this.gen && this.scenes[this.sceneIdx] === scene) this.viz.show(symbolHTML(st.symbol ?? fallbackSymbol(st.category), st.topic), this.acc(st), HOLD.symbol);
        });
      }
    }
    this.lineProgress(i, 0);
  }

  private cueKey(c: Cue): string {
    return `${c.kind}:${c.place ?? c.image ?? ''}`;
  }

  private lineProgress(i: number, frac: number): void {
    this.sub.update(frac);
    for (const c of this.cues) {
      const key = this.cueKey(c);
      if (frac >= c.at && !this.fired.has(key)) { this.fired.add(key); this.fire(c); }
    }
    const scene = this.scenes[this.sceneIdx];
    if (scene && scene.key !== '_ende') {
      const n = scene.last - scene.first + 1;
      this.hooks.progress(this.sceneIdx, Math.min(1, (i - scene.first + Math.min(1, frac)) / n));
    }
  }

  private acc(s: Story): string {
    return categoryColor(this.briefing!.categories, s.category);
  }

  /** Bild-Beat: Zahl zählt am Pin hoch, weiterer Ort bekommt einen Pin (und eine Linie), Einblendungen erscheinen. */
  private fire(c: Cue): void {
    const s = this.scenes[this.sceneIdx]?.story;
    if (!s) return;
    if (c.kind === 'comparison' && s.comparison) this.viz.show(comparisonHTML(s.comparison), this.acc(s), HOLD.comparison);
    else if (c.kind === 'deadline' && s.deadline) this.viz.show(deadlineHTML(s.deadline), this.acc(s), HOLD.deadline);
    else if (c.kind === 'image' && c.image != null && s.images?.[c.image]) void this.viz.showImage(s.images[c.image]!, this.dataBase, this.acc(s), HOLD.image);
    else if (c.kind === 'figure' && s.figure) {
      $('#pinFigLabel').textContent = s.figure.label;
      $('#pinFig').classList.add('on');
      countUp($('#pinFigNum'), s.figure);
    } else if (c.kind === 'place' && c.place != null) {
      const p = s.places?.[c.place];
      if (p) this.globe.addMarker([p.lon, p.lat], p.label, Boolean(p.route));
    }
  }

  private maybeShowCard(): void {
    const scene = this.scenes[this.sceneIdx];
    if (!scene || !this.arrived || !this.factStarted || this.card.visible) return;
    const b = this.briefing!;
    if (scene.story) {
      const order = this.scenes.filter(x => x.story);
      this.card.show(scene.story, order.indexOf(scene), order.length, b.categories);
    } else if (scene.key === 'maerkte' && b.markets) {
      this.card.showMarkets(b.markets, categoryColor(b.categories, 'wirtschaft'));
    } else return;
    this.hooks.layout();
  }

  /** Neuer Abschnitt: Karte schließt, Kamera fliegt während der Frage zum neuen Ort. */
  private enterScene(my: number, sc: number, i: number, instant: boolean): void {
    const b = this.briefing!;
    const scene = this.scenes[sc]!;
    this.sceneIdx = sc;
    this.fired.clear();
    this.cues = [];
    this.arrived = false;
    this.factStarted = false;
    $('#pinFig').classList.remove('on');
    this.viz.release();
    void this.card.hide().then(() => this.hooks.layout());
    this.globe.highlight(null);
    this.globe.pin(null);
    this.globe.clearMarkers();
    this.globe.setIdle(false);
    this.hooks.state();

    const story = scene.story;
    const color = story ? categoryColor(b.categories, story.category) : categoryColor(b.categories, 'wirtschaft');
    this.globe.acc = color;
    $('#pin').style.setProperty('--acc', color);
    let target: [number, number], zoom: number;
    if (story) { target = [story.lon, story.lat]; zoom = story.zoom; }
    else if (scene.key === 'maerkte') { target = FRANKFURT; zoom = 3; }
    else {
      const last = [...b.stories].reverse()[0];
      target = [(last?.lon ?? 10) + 25, 22];
      zoom = 1;
    }
    // Ankunft, wenn die erste Antwort beginnt
    let ms: number;
    if (instant) ms = 0;
    else if (i === 0) ms = 2600;
    else if (this.mode === 'file') ms = ((b.script[scene.firstFact]?.audio?.at ?? 0) - this.audio.time) * 1000 / this.settings().rate;
    else {
      let est = 0;
      for (let k = i; k < scene.firstFact; k++) est += estimateMs(b.script[k]!.text) + pauseBefore(b.script[k - 1], b.script[k]!) * 1000;
      ms = est + pauseBefore(b.script[scene.firstFact - 1], b.script[scene.firstFact]!) * 1000;
    }
    if (!instant) ms = Math.max(900, Math.min(3200, ms));
    void this.globe.fly(target, zoom, ms).then(() => {
      if (my !== this.gen || this.sceneIdx !== sc) return;
      this.arrived = true;
      if (story) {
        this.globe.highlight(story.country, color);
        $('#pinFlag').textContent = story.flag;
        scramble($('#pinName'), story.label, 550);
        this.globe.pin([story.lon, story.lat]);
      } else if (scene.key === 'maerkte') {
        $('#pinFlag').textContent = '📈';
        scramble($('#pinName'), 'FRANKFURT', 550);
        this.globe.pin(FRANKFURT);
      } else {
        this.globe.setIdle(true);
      }
      this.maybeShowCard();
    });
  }

  private intro(): void {
    const b = this.briefing!;
    const d = dateParts(b.date);
    this.globe.glitch(950);
    this.atmo.blip();
    const app = $('#app');
    app.classList.add('glitch');
    setTimeout(() => app.classList.remove('glitch'), 800);
    const tt = $('#title');
    tt.classList.add('on');
    scramble($('#tDate'), `${pad2(d.day)}/${pad2(d.month)}/${d.year}`, 900);
    $('#tSub').textContent = '';
    const my = this.gen;
    setTimeout(() => { if (my === this.gen) scramble($('#tSub'), `LAGEBILD · FOLGE ${b.episode}`, 700); }, 700 / speed());
    setTimeout(() => tt.classList.remove('on'), 3400 / speed());
  }

  private finish(showEnd: boolean): void {
    this.playing = false;
    this.paused = false;
    this.audio.pause();
    this.globe.mode = 'menu';
    this.globe.reset();
    this.atmo.off();
    this.releaseLock();
    this.lineIdx = -1;
    this.sceneIdx = -1;
    this.sub.hide();
    $('#pinFig').classList.remove('on');
    void this.viz.hide();
    void this.card.hide().then(() => this.hooks.layout());
    $('#title').classList.remove('on');
    this.hooks.progress(this.segments, 0);
    this.hooks.state();
    if (showEnd) this.hooks.finished();
  }

  /** Sperrbildschirm und Kopfhörer: Titel der Folge, Abspielen/Pause, vorige/nächste Meldung. */
  private mediaSession(): void {
    if (!('mediaSession' in navigator) || !this.briefing) return;
    const b = this.briefing;
    const d = dateParts(b.date);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Lagebild · Folge ${b.episode}`,
        artist: 'Lagebild',
        album: `${d.weekday}, ${d.day}. ${d.monthName}`,
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => { if (this.paused) this.togglePause(); });
      ms.setActionHandler('pause', () => { if (!this.paused) this.togglePause(); });
      ms.setActionHandler('nexttrack', () => this.nextScene());
      ms.setActionHandler('previoustrack', () => this.prevScene());
    } catch { /* nicht überall verfügbar */ }
  }

  private async wakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && !this.lock) this.lock = await navigator.wakeLock.request('screen');
    } catch {
      this.lock = null;
    }
  }

  private releaseLock(): void {
    try { void this.lock?.release(); } catch { /* egal */ }
    this.lock = null;
  }
}

