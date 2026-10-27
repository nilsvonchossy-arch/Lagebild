// Globus auf einem Canvas: orthografische Projektion, Kamerafahrt, Hervorhebung, Pin mit Linie zur Karte.
// Damit es auf dem iPad flüssig läuft:
// - Kugel, Gradnetz und Länder landen in einem Zwischenspeicher-Canvas, der nur neu gezeichnet wird,
//   wenn sich die Kamera bewegt. Während einer Meldung steht die Kamera, dann kostet ein Bild fast nichts.
// - Gezeichnet werden nur Flächen, deren Hüllkreis im Bild liegt.
// - Die genaue 50m-Karte nur bei engem Ausschnitt, sonst 110m.
// - Kugel und Rand als Kreis statt als Geo-Pfad, kein shadowBlur am Rand.
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';
import type { GeoPath, GeoProjection } from 'd3-geo';
import type { Feature, MultiPolygon } from 'geojson';
import { findCountry, type WorldLayer } from './geo/world';
import { easeInOutCubic, hexA, lerp, reduceMotion, speed } from './util';

export type GlobeMode = 'menu' | 'brief';

export interface GlobeLayout {
  width: number;
  height: number;
  /** Bühne zwischen Untertitel und Karte (relativ zu #app) */
  stage: { top: number; height: number } | null;
  /** Meldungskarte, solange sie sichtbar ist */
  card: { top: number; left: number; width: number } | null;
}

/** Unterhalb dieses sichtbaren Winkels (Radius, Bogenmaß) wird die 50m-Karte gezeichnet. */
const DETAIL_VIEW = (28 * Math.PI) / 180;

const STARS = Array.from({ length: 200 }, (_, i) => {
  const r = Math.sin(i * 12.9898) * 43758.5453;
  const r2 = Math.sin(i * 78.233) * 12345.678;
  return { x: r - Math.floor(r), y: r2 - Math.floor(r2), s: 0.4 + ((i * 7) % 10) / 10, p: i * 1.7 };
});

export class Globe {
  mode: GlobeMode = 'menu';
  /** Akzentfarbe für Hervorhebung und Pin */
  acc = '#ff7a3d';

  private readonly ctx: CanvasRenderingContext2D;
  private readonly base = document.createElement('canvas');
  private readonly bctx: CanvasRenderingContext2D;
  private baseKey = '';
  private readonly proj: GeoProjection;
  private readonly path: GeoPath;
  private readonly basePath: GeoPath;
  private readonly grat = geoGraticule10();
  private layout: GlobeLayout = { width: 0, height: 0, stage: null, card: null };
  private dpr = 1;

  private rot: [number, number] = [-14, -28];
  private zoom = 1;
  private idle = true;
  private cy: number | null = null;
  private R: number | null = null;

  private world110: WorldLayer | null = null;
  private world50: WorldLayer | null = null;
  private worldVersion = 0;

  private hlIso: string | null = null;
  private hl: Feature<MultiPolygon> | null = null;
  private hlA = 0;
  private hlT = 0;

  private pinAt: [number, number] | null = null;
  private pinA = 0;
  private pinT = 0;

  private glitchUntil = 0;
  private lastT = 0;
  private flight = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly pinEl: HTMLElement
  ) {
    const ctx = canvas.getContext('2d');
    const bctx = this.base.getContext('2d');
    if (!ctx || !bctx) throw new Error('Canvas 2D nicht verfügbar');
    this.ctx = ctx;
    this.bctx = bctx;
    // precision 0: keine adaptive Nachberechnung, die Kartenpunkte liegen dicht genug
    this.proj = geoOrthographic().clipAngle(90).precision(0);
    this.path = geoPath(this.proj, ctx);
    this.basePath = geoPath(this.proj, bctx);
    requestAnimationFrame(this.frame);
  }

  setWorld(layer: WorldLayer, detail = false): void {
    if (detail) this.world50 = layer;
    else this.world110 = layer;
    this.worldVersion++;
    if (this.hlIso) this.hl = this.resolve(this.hlIso);
  }

  setLayout(l: GlobeLayout): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sizeChanged = l.width !== this.layout.width || l.height !== this.layout.height || dpr !== this.dpr;
    this.layout = l;
    if (sizeChanged) {
      this.dpr = dpr;
      for (const [c, x] of [[this.canvas, this.ctx], [this.base, this.bctx]] as const) {
        c.width = Math.round(l.width * dpr);
        c.height = Math.round(l.height * dpr);
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.baseKey = '';
    }
  }

  highlight(iso3: string | null, color?: string): void {
    if (color) this.acc = color;
    if (!iso3) { this.hlT = 0; return; }
    this.hlIso = iso3;
    this.hl = this.resolve(iso3);
    this.hlT = 1;
  }

  pin(lonlat: [number, number] | null): void {
    if (!lonlat) { this.pinT = 0; return; }
    this.pinAt = lonlat;
    this.pinT = 1;
  }

  glitch(ms: number): void {
    this.glitchUntil = performance.now() + ms / speed();
  }

  /** Zurück in den Ruhezustand (langsames Drehen, keine Markierungen). */
  reset(): void {
    this.flight++;
    this.hlT = 0;
    this.pinT = 0;
    this.hl = null;
    this.hlIso = null;
    this.pinAt = null;
    this.zoom = 1;
    this.idle = true;
  }

  setIdle(on: boolean): void {
    this.idle = on;
  }

  /** Kamerafahrt: Großkreis zum Ziel, unterwegs leicht herauszoomen. */
  fly(lonlat: [number, number], zoomTo: number, dur: number): Promise<void> {
    const id = ++this.flight;
    return new Promise(res => {
      const from: [number, number] = [-this.rot[0], -this.rot[1]];
      const ip = geoInterpolate(from, lonlat);
      const z0 = this.zoom;
      const dist = geoDistance(from, lonlat);
      const zMid = Math.max(1, Math.min(z0, zoomTo) / (1 + dist * 3));
      const T = reduceMotion() ? 0 : dur / speed();
      const t0 = performance.now();
      this.idle = false;
      const step = (now: number): void => {
        if (id !== this.flight) { res(); return; }
        const k = T ? Math.min(1, (now - t0) / T) : 1;
        const c = ip(easeInOutCubic(k));
        this.rot = [-c[0], -c[1]];
        this.zoom = k < 0.45
          ? Math.exp(lerp(Math.log(z0), Math.log(zMid), easeInOutCubic(k / 0.45)))
          : Math.exp(lerp(Math.log(zMid), Math.log(zoomTo), easeInOutCubic((k - 0.45) / 0.55)));
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }

  private resolve(iso3: string): Feature<MultiPolygon> | null {
    const layer = this.world50 ?? this.world110;
    return layer ? findCountry(layer, iso3) : null;
  }

  private target(): { cy: number; R: number } {
    const { width: W, height: H, stage } = this.layout;
    if (this.mode === 'brief' && stage) {
      const sh = Math.max(120, stage.height);
      return { cy: stage.top + sh * 0.5, R: Math.min(W * 0.43, sh * 0.47) };
    }
    return { cy: H * 0.29, R: Math.min(W * 0.4, H * 0.22) };
  }

  /** Kugel, Gradnetz, Länder und Rand in den Zwischenspeicher zeichnen. */
  private drawBase(cx: number, cy: number, R: number, view: number): void {
    const { width: W, height: H } = this.layout;
    const ctx = this.bctx;
    const path = this.basePath;
    ctx.clearRect(0, 0, W, H);

    const sg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05);
    sg.addColorStop(0, '#13233a'); sg.addColorStop(0.6, '#0a1220'); sg.addColorStop(1, '#04070c');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fillStyle = sg; ctx.fill();

    ctx.beginPath(); path(this.grat); ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(140,170,215,.07)'; ctx.stroke();

    const layer = view < DETAIL_VIEW && this.world50 ? this.world50 : this.world110;
    if (layer) {
      const center: [number, number] = [-this.rot[0], -this.rot[1]];
      ctx.beginPath();
      for (const p of layer.parts) {
        if (geoDistance(center, p.center) - p.radius <= view) path(p.geometry);
      }
      ctx.fillStyle = '#18212d'; ctx.fill();
      ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(155,180,215,.32)'; ctx.stroke();
    }

    // Rand mit Leuchten: zwei Striche statt shadowBlur
    const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rg.addColorStop(0, 'rgba(120,175,255,.9)'); rg.addColorStop(0.55, 'rgba(120,175,255,.15)'); rg.addColorStop(1, 'rgba(255,80,80,.75)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.save(); ctx.globalAlpha = 0.25; ctx.lineWidth = 7; ctx.strokeStyle = rg; ctx.stroke(); ctx.restore();
    ctx.lineWidth = 1.4; ctx.strokeStyle = rg; ctx.stroke();
  }

  private readonly frame = (t: number): void => {
    requestAnimationFrame(this.frame);
    const { width: W, height: H } = this.layout;
    if (!W || !H) return;
    const dt = Math.min(50, t - (this.lastT || t));
    this.lastT = t;
    const reduce = reduceMotion();

    // Mittelpunkt und Größe weich nachführen, nahe am Ziel einrasten (sonst nie „still“)
    const tl = this.target();
    if (this.cy == null || this.R == null) { this.cy = tl.cy; this.R = tl.R; }
    this.cy = Math.abs(tl.cy - this.cy) < 0.05 ? tl.cy : this.cy + (tl.cy - this.cy) * 0.07;
    this.R = Math.abs(tl.R - this.R) < 0.05 ? tl.R : this.R + (tl.R - this.R) * 0.07;
    if (this.idle && !reduce) this.rot[0] += dt * 0.003;
    this.hlA += (this.hlT - this.hlA) * 0.07;
    this.pinA += (this.pinT - this.pinA) * 0.1;

    const R = this.R * this.zoom;
    const cx = W / 2;
    const cy = this.cy;
    const ctx = this.ctx;
    this.proj.translate([cx, cy]).scale(R).rotate([this.rot[0], this.rot[1], 0]);
    ctx.clearRect(0, 0, W, H);

    // Sterne
    ctx.fillStyle = '#dfe8ff';
    for (const s of STARS) {
      ctx.globalAlpha = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * 0.0012 * s.s + s.p));
      ctx.fillRect(s.x * W, s.y * H, s.s * 1.3, s.s * 1.3);
    }
    ctx.globalAlpha = 1;

    // Atmosphäre
    if (R < Math.max(W, H) * 2) {
      let g = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.24);
      g.addColorStop(0, 'rgba(70,140,255,.42)');
      g.addColorStop(1, 'rgba(70,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.24, 0, 7); ctx.fill();
      g = ctx.createRadialGradient(cx + R * 0.22, cy + R * 0.2, R * 0.8, cx + R * 0.22, cy + R * 0.2, R * 1.16);
      g.addColorStop(0, 'rgba(255,60,60,.22)');
      g.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx + R * 0.22, cy + R * 0.2, R * 1.16, 0, 7); ctx.fill();
    }

    // Globus aus dem Zwischenspeicher, nur bei Kamerabewegung neu zeichnen
    const reach = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    const view = reach >= R ? Math.PI / 2 : Math.asin(reach / R);
    // Drehung auf ~½ Pixel am Äquator runden: beim langsamen Drehen im Menü reicht so etwa jedes zweite Bild
    const q = (0.5 / R) * (180 / Math.PI);
    const key = `${cy.toFixed(2)}|${R.toFixed(2)}|${Math.round(this.rot[0] / q)}|${Math.round(this.rot[1] / q)}|${this.worldVersion}|${W}x${H}@${this.dpr}`;
    if (key !== this.baseKey) {
      this.drawBase(cx, cy, R, view);
      this.baseKey = key;
    }
    ctx.drawImage(this.base, 0, 0, W, H);

    // Hervorgehobenes Land
    if (this.hl && this.hlA > 0.01) {
      ctx.save();
      ctx.globalAlpha = this.hlA;
      ctx.beginPath(); this.path(this.hl);
      ctx.fillStyle = hexA(this.acc, 0.3); ctx.fill();
      ctx.shadowColor = this.acc; ctx.shadowBlur = 14;
      ctx.lineWidth = 1.6; ctx.strokeStyle = this.acc; ctx.stroke();
      ctx.restore();
    }

    this.drawPin(t, R);

    // Glitch
    if (t < this.glitchUntil && !reduce) {
      for (let i = 0; i < 7; i++) {
        const y = Math.random() * H, h = 4 + Math.random() * 26, dx = (Math.random() - 0.5) * 46;
        try { ctx.drawImage(this.canvas, 0, y * this.dpr, W * this.dpr, h * this.dpr, dx, y, W, h); } catch { /* leerer Canvas */ }
        ctx.fillStyle = i % 2 ? 'rgba(255,40,70,.07)' : 'rgba(60,200,255,.06)';
        ctx.fillRect(0, y, W, h);
      }
    }
  };

  private drawPin(t: number, R: number): void {
    const pinEl = this.pinEl;
    if (!this.pinAt || this.pinA <= 0.01) { pinEl.classList.remove('on'); return; }
    const center: [number, number] = [-this.rot[0], -this.rot[1]];
    const visible = geoDistance(this.pinAt, center) < Math.PI / 2 - 0.03;
    const p = this.proj(this.pinAt);
    if (!visible || !p || R <= 0) { pinEl.classList.remove('on'); return; }
    const [px, py] = p;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = this.pinA;
    const ph = (t % 1700) / 1700;
    ctx.beginPath(); ctx.arc(px, py, 5 + ph * 16, 0, 7); ctx.strokeStyle = hexA(this.acc, (1 - ph) * 0.9); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fillStyle = '#fff'; ctx.shadowColor = this.acc; ctx.shadowBlur = 10; ctx.fill();
    const card = this.layout.card;
    if (card && card.top > py + 14) {
      const x2 = Math.max(card.left + 26, Math.min(card.left + card.width - 26, px));
      const mid = (py + card.top) / 2;
      ctx.shadowBlur = 0; ctx.strokeStyle = hexA(this.acc, 0.85); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py + 5); ctx.lineTo(px, mid); ctx.lineTo(x2, mid); ctx.lineTo(x2, card.top); ctx.stroke();
      ctx.fillStyle = this.acc; ctx.fillRect(x2 - 2.5, card.top - 2.5, 5, 5);
    }
    ctx.restore();
    pinEl.style.transform = `translate(${px}px,${py}px) translate(-50%,calc(-100% - 14px))`;
    pinEl.classList.add('on');
  }
}
