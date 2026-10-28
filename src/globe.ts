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
import { EarthGL, type EarthTextures } from './earth';
import { findCountry, type WorldLayer } from './geo/world';
import { easeInOutCubic, hexA, lerp, reduceMotion, speed } from './util';

export type GlobeMode = 'menu' | 'brief';

/** Wo der Globus stehen soll: Mittelpunkt und Radius in Pixeln (relativ zu #app). */
export interface Spot {
  cx: number;
  cy: number;
  R: number;
}

export interface GlobeLayout {
  width: number;
  height: number;
  /** Ziel im Menü und während des Updates; das Layout (hoch/quer) rechnet main.ts aus */
  menu: Spot;
  brief: Spot;
  /** Meldungskarte, solange sie sichtbar ist */
  card: { top: number; left: number; width: number; height: number } | null;
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
  private layout: GlobeLayout = { width: 0, height: 0, menu: { cx: 0, cy: 0, R: 0 }, brief: { cx: 0, cy: 0, R: 0 }, card: null };
  private dpr = 1;

  private rot: [number, number] = [-14, -28];
  private zoom = 1;
  private idle = true;
  private cx: number | null = null;
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

  /** Weitere Orte einer Meldung: eigener Punkt mit Beschriftung, auf Wunsch eine Linie zum Hauptort */
  private markers: { at: [number, number]; label: string; route: boolean; t0: number }[] = [];

  /** Satellitenbild darunter (WebGL); ohne WebGL oder vor dem Laden bleibt der Vektor-Globus */
  private readonly earth: EarthGL | null = null;

  private glitchUntil = 0;
  private lastT = 0;
  private flight = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly pinEl: HTMLElement,
    private readonly earthCanvas?: HTMLCanvasElement
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
    if (earthCanvas) {
      this.earth = EarthGL.create(earthCanvas);
      if (this.earth) this.earth.onLoad = () => { this.baseKey = ''; };
    }
    requestAnimationFrame(this.frame);
  }

  /** Satellitenbilder laden (NASA Blue Marble, Black Marble, Wolken). */
  loadEarth(urls: EarthTextures): void {
    this.earth?.load(urls);
  }

  private get textured(): boolean {
    return Boolean(this.earth?.ready);
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
      this.earth?.resize(l.width, l.height, dpr);
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

  /** Weiteren Ort einblenden (erscheint, sobald er genannt wird). */
  addMarker(at: [number, number], label: string, route = false): void {
    if (this.markers.some(m => m.label === label)) return;
    this.markers.push({ at, label, route, t0: performance.now() });
  }

  clearMarkers(): void {
    this.markers = [];
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
    this.markers = [];
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

  private target(): Spot {
    return this.mode === 'brief' ? this.layout.brief : this.layout.menu;
  }

  /** Kugel, Gradnetz, Länder und Rand in den Zwischenspeicher zeichnen. */
  private drawBase(cx: number, cy: number, R: number, view: number): void {
    const { width: W, height: H } = this.layout;
    const ctx = this.bctx;
    const path = this.basePath;
    ctx.clearRect(0, 0, W, H);

    const textured = this.textured;
    if (!textured) {
      const sg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05);
      sg.addColorStop(0, '#13233a'); sg.addColorStop(0.6, '#0a1220'); sg.addColorStop(1, '#04070c');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fillStyle = sg; ctx.fill();
      ctx.beginPath(); path(this.grat); ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(140,170,215,.07)'; ctx.stroke();
    }

    const layer = view < DETAIL_VIEW && this.world50 ? this.world50 : this.world110;
    if (layer) {
      const center: [number, number] = [-this.rot[0], -this.rot[1]];
      ctx.beginPath();
      for (const p of layer.parts) {
        if (geoDistance(center, p.center) - p.radius <= view) path(p.geometry);
      }
      if (textured) {
        // auf dem Satellitenbild nur dünne, helle Grenzen
        ctx.lineWidth = 0.55; ctx.strokeStyle = 'rgba(225,235,255,.26)'; ctx.stroke();
      } else {
        ctx.fillStyle = '#18212d'; ctx.fill();
        ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(155,180,215,.32)'; ctx.stroke();
      }
    }
    if (textured) return;

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
    const ease = (cur: number | null, to: number): number => (cur == null || Math.abs(to - cur) < 0.05 ? to : cur + (to - cur) * 0.07);
    this.cx = ease(this.cx, tl.cx);
    this.cy = ease(this.cy, tl.cy);
    this.R = ease(this.R, tl.R);
    if (this.idle && !reduce) this.rot[0] += dt * 0.003;
    this.hlA += (this.hlT - this.hlA) * 0.07;
    this.pinA += (this.pinT - this.pinA) * 0.1;

    const R = this.R * this.zoom;
    const cx = this.cx;
    const cy = this.cy;
    const ctx = this.ctx;
    this.proj.translate([cx, cy]).scale(R).rotate([this.rot[0], this.rot[1], 0]);
    ctx.clearRect(0, 0, W, H);

    // Sterne
    ctx.fillStyle = '#dfe8ff';
    const textured = this.textured;
    for (const s of STARS) {
      if (textured && Math.hypot(s.x * W - cx, s.y * H - cy) < R) continue;
      ctx.globalAlpha = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * 0.0012 * s.s + s.p));
      ctx.fillRect(s.x * W, s.y * H, s.s * 1.3, s.s * 1.3);
    }
    ctx.globalAlpha = 1;

    // Atmosphäre: über dem Satellitenbild nur ein blauer Saum außen, sonst der Prototyp-Look
    if (textured) {
      if (R < Math.max(W, H) * 1.5) {
        const g = ctx.createRadialGradient(cx, cy, R * 0.985, cx, cy, R * 1.13);
        g.addColorStop(0, 'rgba(90,160,255,.38)');
        g.addColorStop(1, 'rgba(90,160,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.13, 0, 7); ctx.arc(cx, cy, R * 0.985, 0, 7, true); ctx.fill();
      }
    } else if (R < Math.max(W, H) * 2) {
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
    const key = `${cx.toFixed(2)}|${cy.toFixed(2)}|${R.toFixed(2)}|${Math.round(this.rot[0] / q)}|${Math.round(this.rot[1] / q)}|${this.worldVersion}|${W}x${H}@${this.dpr}|${textured}`;
    if (key !== this.baseKey) {
      this.drawBase(cx, cy, R, view);
      if (textured) this.earth!.draw(cx, cy, R, this.rot[0], this.rot[1]);
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

    this.drawMarkers(t);
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

  private drawMarkers(t: number): void {
    if (!this.markers.length) return;
    const ctx = this.ctx;
    const center: [number, number] = [-this.rot[0], -this.rot[1]];
    for (const m of this.markers) {
      const k = Math.min(1, (t - m.t0) / (1400 / speed()));
      ctx.save();
      if (m.route && this.pinAt) {
        // Linie vom Ort zum Hauptort, zeichnet sich ein
        const ip = geoInterpolate(m.at, this.pinAt);
        const n = 48;
        const pts: [number, number][] = [];
        for (let i = 0; i <= n * easeInOutCubic(k); i++) pts.push(ip(i / n));
        if (pts.length > 1) {
          ctx.beginPath(); this.path({ type: 'LineString', coordinates: pts });
          ctx.setLineDash([6, 5]); ctx.lineWidth = 1.8; ctx.strokeStyle = hexA(this.acc, 0.9); ctx.stroke();
        }
      }
      if (geoDistance(m.at, center) < Math.PI / 2 - 0.03) {
        const p = this.proj(m.at);
        if (p) {
          const a = Math.min(1, k * 2);
          ctx.globalAlpha = a;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
          ctx.beginPath(); ctx.arc(p[0], p[1], 7 + 4 * Math.sin(t / 300), 0, 7); ctx.strokeStyle = hexA(this.acc, 0.7); ctx.lineWidth = 1; ctx.stroke();
          ctx.font = '400 9.5px Michroma, system-ui, sans-serif';
          ctx.fillStyle = '#eef1f5';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
          ctx.fillText(m.label.toUpperCase(), p[0] + 10, p[1] + 3.5);
        }
      }
      ctx.restore();
    }
  }

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
    ctx.shadowBlur = 0; ctx.strokeStyle = hexA(this.acc, 0.85); ctx.lineWidth = 1; ctx.fillStyle = this.acc;
    if (card && card.left > px + 40) {
      // Karte rechts daneben: waagerecht hinüber, dann auf Höhe der Kartenoberkante einmünden
      const y2 = Math.max(card.top + 22, Math.min(card.top + card.height - 22, py));
      const mid = (px + card.left) / 2;
      ctx.beginPath(); ctx.moveTo(px + 5, py); ctx.lineTo(mid, py); ctx.lineTo(mid, y2); ctx.lineTo(card.left, y2); ctx.stroke();
      ctx.fillRect(card.left - 2.5, y2 - 2.5, 5, 5);
    } else if (card && card.top > py + 14) {
      const x2 = Math.max(card.left + 26, Math.min(card.left + card.width - 26, px));
      const mid = (py + card.top) / 2;
      ctx.beginPath(); ctx.moveTo(px, py + 5); ctx.lineTo(px, mid); ctx.lineTo(x2, mid); ctx.lineTo(x2, card.top); ctx.stroke();
      ctx.fillRect(x2 - 2.5, card.top - 2.5, 5, 5);
    }
    ctx.restore();
    pinEl.style.transform = `translate(${px}px,${py}px) translate(-50%,calc(-100% - 14px))`;
    pinEl.classList.add('on');
  }
}
