// Fotorealistischer Nachtglobus mit WebGL: Satellitenbild der NASA (Blue Marble), Stadtlichter
// (Black Marble) und Wolken, abgedunkelt, mit Randabfall und Atmosphärenleuchten. Jeder Bildpunkt
// der Kugel wird im Shader zurück in Länge/Breite gerechnet, mit derselben Drehung wie d3-geo
// (geoOrthographic().rotate([λ, φ, 0])). Grenzen, Hervorhebung und Pins zeichnet globe.ts darüber.

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_aa;
uniform float u_cdp;
uniform float u_sdp;
uniform float u_dl;
uniform sampler2D u_day;
uniform sampler2D u_night;
uniform sampler2D u_clouds;
uniform float u_hasNight;
uniform float u_hasClouds;
void main() {
  vec2 p = (gl_FragCoord.xy - u_center) / u_radius;
  float r = length(p);
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  float z = sqrt(max(0.0, 1.0 - r * r));
  // Bildpunkt → gedrehte Länge/Breite (Umkehrung der orthografischen Projektion)
  float lam = atan(p.x, z);
  float phi = asin(clamp(p.y, -1.0, 1.0));
  // Umkehrung der Drehung um φ, dann um λ (wie d3-geo rotationPhiGamma.invert)
  float cp = cos(phi);
  float x = cos(lam) * cp;
  float y = sin(lam) * cp;
  float s = sin(phi);
  float lon = atan(y, x * u_cdp + s * u_sdp) - u_dl;
  float lat = asin(clamp(s * u_cdp - x * u_sdp, -1.0, 1.0));
  vec2 uv = vec2(fract(lon / 6.28318531 + 0.5), 0.5 - lat / 3.14159265);
  vec3 day = texture2D(u_day, uv).rgb;
  vec3 night = texture2D(u_night, uv).rgb;
  float cloud = texture2D(u_clouds, uv).r;
  vec3 c = day * vec3(0.24, 0.28, 0.37);
  c += night * night * vec3(1.6, 1.25, 0.8) * u_hasNight;
  c = mix(c, vec3(0.15, 0.18, 0.24), smoothstep(0.25, 0.9, cloud) * 0.6 * u_hasClouds);
  c *= mix(0.42, 1.0, pow(z, 0.55));
  c += vec3(0.22, 0.42, 0.95) * pow(1.0 - z, 3.0) * 0.75;
  float a = smoothstep(1.0, 1.0 - u_aa, r);
  gl_FragColor = vec4(c * a, a);
}`;

export interface EarthTextures { day: string; night?: string; clouds?: string }

export class EarthGL {
  private readonly gl: WebGLRenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly tex: Partial<Record<'day' | 'night' | 'clouds', WebGLTexture>> = {};
  private dpr = 1;
  private h = 0;
  ready = false;
  /** Wird aufgerufen, wenn ein Bild fertig geladen ist (Globus neu zeichnen) */
  onLoad: () => void = () => undefined;

  static create(canvas: HTMLCanvasElement): EarthGL | null {
    try {
      const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
      return gl ? new EarthGL(gl) : null;
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'Programm');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['u_center', 'u_radius', 'u_aa', 'u_cdp', 'u_sdp', 'u_dl', 'u_day', 'u_night', 'u_clouds', 'u_hasNight', 'u_hasClouds']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.u_day!, 0);
    gl.uniform1i(this.u.u_night!, 1);
    gl.uniform1i(this.u.u_clouds!, 2);
    // Platzhalter, bis die Bilder da sind
    for (const [k, unit] of [['day', 0], ['night', 1], ['clouds', 2]] as const) this.tex[k] = this.blank(unit);
  }

  private blank(unit: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  }

  /** Bilder laden; zu große für dieses Gerät werden vorher verkleinert. */
  load(urls: EarthTextures): void {
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    const one = (key: 'day' | 'night' | 'clouds', unit: number, src: string | undefined): void => {
      if (!src) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        let source: TexImageSource = img;
        if (img.naturalWidth > max) {
          const c = document.createElement('canvas');
          c.width = max;
          c.height = max / 2;
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          source = c;
        }
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[key]!);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (key === 'day') this.ready = true;
        gl.useProgram(this.prog);
        if (key === 'night') gl.uniform1f(this.u.u_hasNight!, 1);
        if (key === 'clouds') gl.uniform1f(this.u.u_hasClouds!, 1);
        this.onLoad();
      };
      img.src = src;
    };
    one('day', 0, urls.day);
    one('night', 1, urls.night);
    one('clouds', 2, urls.clouds);
  }

  resize(width: number, height: number, dpr: number): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    this.dpr = dpr;
    this.h = c.height;
    this.gl.viewport(0, 0, c.width, c.height);
  }

  /** Kugel zeichnen: Mittelpunkt und Radius in CSS-Pixeln, Drehung in Grad wie bei d3-geo. */
  draw(cx: number, cy: number, R: number, rotLambda: number, rotPhi: number): void {
    const gl = this.gl;
    const d = this.dpr;
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.u_center!, cx * d, this.h - cy * d);
    gl.uniform1f(this.u.u_radius!, R * d);
    gl.uniform1f(this.u.u_aa!, Math.min(0.5, 1.5 / Math.max(1, R * d)));
    const phi = (rotPhi * Math.PI) / 180;
    gl.uniform1f(this.u.u_cdp!, Math.cos(phi));
    gl.uniform1f(this.u.u_sdp!, Math.sin(phi));
    gl.uniform1f(this.u.u_dl!, (rotLambda * Math.PI) / 180);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
