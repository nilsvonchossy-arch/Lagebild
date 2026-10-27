// Ablauf eines Updates: Intro → je Meldung Kamerafahrt, Hervorhebung, Pin, Karte, Zeilen → Outro.
// Jeder Start und jeder Sprung erhöht `gen`; alte Abläufe merken das bei check() und brechen ab.
import type { Atmo, Voice } from './audio';
import type { Card } from './card';
import type { Caption } from './fx';
import { scramble } from './fx';
import type { Globe } from './globe';
import type { Briefing, Line } from './shared/types';
import { $, dateParts, pad2, sleep } from './util';

const CANCEL = Symbol('cancel');

export interface PlayerHooks {
  progress(i: number, frac: number): void;
  state(): void;
  finished(): void;
  /** Layout hat sich geändert (Karte ein/aus), Globus braucht neue Maße */
  layout(): void;
}

export class Player {
  briefing: Briefing | null = null;
  playing = false;
  paused = false;
  curIdx = -1;
  lineK = 0;
  private introDone = false;
  private gen = 0;
  private lock: WakeLockSentinel | null = null;

  constructor(
    private readonly globe: Globe,
    private readonly card: Card,
    private readonly caption: Caption,
    private readonly voice: Voice,
    private readonly atmo: Atmo,
    private readonly hooks: PlayerHooks
  ) {}

  get count(): number {
    return this.briefing?.stories.length ?? 0;
  }

  /** Im Tipp-Ereignis aufrufen. */
  start(): void {
    if (!this.count) return;
    this.atmo.unlock();
    this.voice.unlock();
    this.introDone = false;
    void this.run(0);
  }

  jump(i: number): void {
    if (!this.playing) return;
    this.gen++;
    this.voice.stop();
    $('#title').classList.remove('on');
    this.introDone = true;
    const target = Math.min(Math.max(0, i), this.count);
    setTimeout(() => void this.run(target), 80);
  }

  togglePause(): void {
    if (!this.playing) { this.start(); return; }
    this.paused = !this.paused;
    if (this.paused) { this.voice.pause(); this.atmo.off(); }
    else { this.voice.resume(); this.atmo.on(); }
    this.hooks.state();
  }

  /** Bei Rückkehr ins Menü (z. B. anderer Tag gewählt) alles anhalten. */
  stop(): void {
    this.gen++;
    this.voice.stop();
    if (this.playing) this.finish(false);
  }

  private check(my: number): void {
    if (my !== this.gen) throw CANCEL;
  }

  private async hold(my: number): Promise<void> {
    while (this.paused) {
      await new Promise(r => setTimeout(r, 120));
      this.check(my);
    }
    this.check(my);
  }

  private async say(my: number, line: Line): Promise<void> {
    for (;;) {
      await this.hold(my);
      const r = await this.voice.speak(line, this.caption);
      this.check(my);
      if (r === 'done') {
        await sleep(240);
        this.check(my);
        return;
      }
    }
  }

  private greeting(): Line {
    const b = this.briefing!;
    const h = new Date().getHours();
    return h < 11 ? b.intro.morning : h < 18 ? b.intro.day : b.intro.evening;
  }

  private async intro(my: number): Promise<void> {
    const d = dateParts(this.briefing!.date);
    this.globe.glitch(950);
    const app = $('#app');
    app.classList.add('glitch');
    setTimeout(() => app.classList.remove('glitch'), 800);
    const tt = $('#title');
    tt.classList.add('on');
    scramble($('#tDate'), `${pad2(d.day)}/${pad2(d.month)}/${d.year}`, 900);
    $('#tSub').textContent = '';
    await sleep(700);
    this.check(my);
    scramble($('#tSub'), 'TAGES-UPDATE', 700);
    await this.say(my, this.greeting());
    tt.classList.remove('on');
    this.introDone = true;
  }

  private async story(my: number, i: number): Promise<void> {
    const b = this.briefing!;
    const s = b.stories[i]!;
    this.curIdx = i;
    this.lineK = 0;
    this.hooks.progress(i, 0);
    this.hooks.state();
    this.voice.prefetch([s.opener, ...s.lines]);
    await this.card.hide();
    this.hooks.layout();
    this.check(my);
    this.globe.highlight(null);
    this.globe.pin(null);
    await sleep(250);
    this.check(my);
    const color = this.card.categoryColor(b.categories, s.category);
    this.globe.acc = color;
    $('#pin').style.setProperty('--acc', color);
    await Promise.all([this.globe.fly([s.lon, s.lat], s.zoom, 2600), this.say(my, s.opener)]);
    this.check(my);
    this.globe.highlight(s.country, color);
    $('#pinFlag').textContent = s.flag;
    scramble($('#pinName'), s.label, 650);
    this.globe.pin([s.lon, s.lat]);
    await sleep(420);
    this.check(my);
    const next = b.stories[i + 1];
    if (next) this.voice.prefetch([next.opener, ...next.lines]);
    const shown = this.card.show(s, i, b.stories.length, b.categories, b.date);
    this.hooks.layout();
    await shown;
    this.check(my);
    for (let k = 0; k < s.lines.length; k++) {
      this.lineK = k;
      await this.say(my, s.lines[k]!);
      this.hooks.progress(i, (k + 1) / s.lines.length);
    }
    await sleep(500);
    this.check(my);
  }

  private async outro(my: number): Promise<void> {
    const b = this.briefing!;
    this.curIdx = this.count;
    this.hooks.state();
    await this.card.hide();
    this.hooks.layout();
    this.check(my);
    this.globe.highlight(null);
    this.globe.pin(null);
    const last = b.stories[b.stories.length - 1];
    const [first, ...rest] = b.outro;
    await Promise.all([
      this.globe.fly([(last?.lon ?? 10) + 25, 22], 1, 2600),
      first ? this.say(my, first) : Promise.resolve()
    ]);
    this.check(my);
    this.globe.setIdle(true);
    for (const l of rest) await this.say(my, l);
    this.caption.hide();
    this.finish(true);
  }

  private async run(from: number): Promise<void> {
    const my = ++this.gen;
    this.paused = false;
    this.playing = true;
    this.globe.mode = 'brief';
    this.hooks.state();
    this.atmo.on();
    void this.wakeLock();
    try {
      if (from === 0 && !this.introDone) await this.intro(my);
      for (let i = from; i < this.count; i++) await this.story(my, i);
      await this.outro(my);
    } catch (e) {
      if (e !== CANCEL) console.error(e);
    }
  }

  private finish(showEnd: boolean): void {
    this.playing = false;
    this.paused = false;
    this.globe.mode = 'menu';
    this.globe.reset();
    this.atmo.off();
    this.releaseLock();
    this.introDone = false;
    this.curIdx = -1;
    this.caption.hide();
    void this.card.hide().then(() => this.hooks.layout());
    $('#title').classList.remove('on');
    this.hooks.progress(this.count, 0);
    this.hooks.state();
    if (showEnd) this.hooks.finished();
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
