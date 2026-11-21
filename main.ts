// CETARA — The City That Swims
// A travel poster for a place that does not exist.
// main.ts (Node 22, stdlib only, no network, deterministic).
// Draws a 1024x1024 vintage travel poster to /output/entry.png:
// a tiny lighthouse town rides on the back of a giant whale crossing
// a golden sunset sea. Every pixel is drawn procedurally by this file.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Multi-stop vertical gradient lookup: stops are [position 0..1, colour].
function gradient(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      return mix(c0, c1, (t - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
}

// Deterministic pseudo-random from an integer seed (no Math.random).
function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB raster with alpha-blended drawing primitives.
// ---------------------------------------------------------------------------

class Canvas {
  data: Uint8Array;
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 3);
  }

  // Set a pixel, blending colour over what is already there.
  px(x: number, y: number, c: RGB, a = 1): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 3;
    if (a >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
    } else if (a > 0) {
      this.data[i] = Math.round(this.data[i] * (1 - a) + c[0] * a);
      this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + c[1] * a);
      this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + c[2] * a);
    }
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c, a);
    }
  }

  // Vertical gradient fill over a rectangle.
  vGrad(x: number, y: number, w: number, h: number, stops: Array<[number, RGB]>): void {
    for (let yy = 0; yy < h; yy++) {
      const c = gradient(stops, yy / Math.max(1, h - 1));
      this.fillRect(x, y + yy, w, 1, c);
    }
  }

  // Filled circle with a soft 1px antialiased edge.
  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
        if (d <= r) this.px(xx, yy, c, a);
        else if (d <= r + 1) this.px(xx, yy, c, a * (r + 1 - d));
      }
    }
  }

  // Filled ellipse with a soft edge.
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry + 1));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx + 0.5 - cx) / rx;
        const dy = (yy + 0.5 - cy) / ry;
        const d = Math.hypot(dx, dy);
        if (d <= 1) this.px(xx, yy, c, a);
        else if (d <= 1.08) this.px(xx, yy, c, a * (1.08 - d) / 0.08);
      }
    }
  }

  // Filled polygon (scanline, even-odd) from [x, y] points.
  polygon(points: Array<[number, number]>, c: RGB, a = 1): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let yy = y0; yy <= y1; yy++) {
      const cy = yy + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1p] = points[i];
        const [x2, y2p] = points[(i + 1) % points.length];
        if ((y1p <= cy && y2p > cy) || (y2p <= cy && y1p > cy)) {
          xs.push(x1 + ((cy - y1p) * (x2 - x1)) / (y2p - y1p));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]));
        for (let xx = xa; xx <= xb; xx++) this.px(xx, yy, c, a);
      }
    }
  }

  // Thick line drawn as a chain of circles (round caps, round joins).
  thickLine(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB, a = 1): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, c, a);
    }
  }

  // Hollow rectangle outline of a given stroke width.
  strokeRect(x: number, y: number, w: number, h: number, sw: number, c: RGB, a = 1): void {
    this.fillRect(x, y, w, sw, c, a);
    this.fillRect(x, y + h - sw, w, sw, c, a);
    this.fillRect(x, y, sw, h, c, a);
    this.fillRect(x + w - sw, y, sw, h, c, a);
  }
}

// ---------------------------------------------------------------------------
// PNG encoding (pure Node stdlib: zlib deflate + hand-rolled CRC32).
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(cv: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Filter 0 (None) on every scanline: flat poster colours compress well.
  const raw = Buffer.alloc(cv.h * (1 + cv.w * 3));
  for (let y = 0; y < cv.h; y++) {
    raw[y * (1 + cv.w * 3)] = 0;
    raw.set(cv.data.subarray(y * cv.w * 3, (y + 1) * cv.w * 3), y * (1 + cv.w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Typeface: a bold 5x7 bitmap face, drawn as solid blocks so the poster
// type feels set, not typed. Rows are 7 strings of 5 cells ("1" = ink).
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "·": ["00000", "00000", "00000", "01100", "01100", "00000", "00000"],
};

// Width of a string at a given cell size (5 cells + 1 cell gap per glyph).
function textWidth(text: string, s: number): number {
  return text.length * 6 * s - s;
}

function drawGlyph(cv: Canvas, ch: string, x: number, y: number, s: number, c: RGB, a = 1): void {
  const g = GLYPHS[ch] ?? GLYPHS[" "];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === "1") cv.fillRect(x + col * s, y + r * s, s, s, c, a);
    }
  }
}

// Draw a centred line of text; returns its top y.
function drawText(cv: Canvas, text: string, cx: number, y: number, s: number, c: RGB, a = 1): void {
  let x = cx - textWidth(text, s) / 2;
  for (const ch of text) {
    drawGlyph(cv, ch, Math.round(x), Math.round(y), s, c, a);
    x += 6 * s;
  }
}

// Same, but with a soft offset shadow first so the type sits on the art.
function drawTextShadowed(
  cv: Canvas,
  text: string,
  cx: number,
  y: number,
  s: number,
  c: RGB,
  shadow: RGB,
  dx: number,
  dy: number,
): void {
  drawText(cv, text, cx + dx, y + dy, s, shadow);
  drawText(cv, text, cx, y, s, c);
}

// ---------------------------------------------------------------------------
// Palette — a vintage sunset: deep teal sky, gold horizon, slate whale.
// ---------------------------------------------------------------------------

const INK = hex("#F8ECD2"); // warm cream (type, frame)
const GOLD = hex("#F2C14E"); // sun gold
const SUN_CORE = hex("#FCE9B8");
const SKY_TOP = hex("#0A3648");
const SKY_MID = hex("#17617A");
const SKY_LOW = hex("#C97E45");
const HORIZON = hex("#F7D08A");
const SEA_TOP = hex("#1B5A6E");
const SEA_BOT = hex("#0A2A3A");
const WHALE = hex("#16324A");
const WHALE_EDGE = hex("#2E5A70");
const FOAM = hex("#EAF6F6");
const HOUSE = hex("#F5E6C8");
const ROOF = hex("#B5533C");
const WINDOW = hex("#FFD166");
const DARK = hex("#0A2A3A");

const WATERLINE = 668;

// Height of the whale's back above the waterline at parameter t (0..1).
function whaleTop(t: number): number {
  return WATERLINE - 190 * Math.pow(Math.sin(Math.PI * t), 0.85);
}

// Sample a quadratic Bezier curve into points.
function quad(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  n: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return pts;
}

function drawSky(cv: Canvas): void {
  cv.vGrad(0, 0, W, WATERLINE, [
    [0, SKY_TOP],
    [0.42, SKY_MID],
    [0.68, SKY_LOW],
    [0.88, hex("#F2B25C")],
    [1, HORIZON],
  ]);
  // Low sun, just clearing the whale's back.
  cv.circle(720, 360, 168, GOLD, 0.22);
  cv.circle(720, 360, 148, GOLD, 0.3);
  cv.circle(720, 360, 125, SUN_CORE);
  // A few flat evening clouds.
  const clouds: Array<[number, number, number, number, number]> = [
    [205, 252, 150, 20, 0.2],
    [335, 288, 105, 14, 0.16],
    [862, 218, 118, 16, 0.18],
    [120, 330, 90, 13, 0.14],
    [520, 196, 80, 12, 0.12],
  ];
  for (const [cx, cy, rx, ry, a] of clouds) cv.ellipse(cx, cy, rx, ry, FOAM, a);
  // Distant gulls.
  const birds: Array<[number, number]> = [
    [180, 200],
    [262, 168],
    [882, 182],
    [942, 242],
    [138, 282],
  ];
  for (const [bx, by] of birds) {
    cv.thickLine(bx, by, bx - 14, by - 8, 3, DARK, 0.75);
    cv.thickLine(bx, by, bx + 14, by - 8, 3, DARK, 0.75);
  }
}

function drawSea(cv: Canvas): void {
  cv.vGrad(0, WATERLINE, W, H - WATERLINE, [
    [0, SEA_TOP],
    [0.5, hex("#123F52")],
    [1, SEA_BOT],
  ]);
  // Horizon seam.
  cv.fillRect(0, WATERLINE - 1, W, 2, HORIZON, 0.55);
  // Sun path: a shimmering column of gold dashes under the sun.
  for (let y = WATERLINE + 14; y < 1000; y += 16) {
    const depth = (y - WATERLINE) / (H - WATERLINE);
    const wdt = 90 + depth * 170 + hash(y) * 60;
    const jx = (hash(y + 7) - 0.5) * 50;
    cv.fillRect(720 - wdt / 2 + jx, y, wdt, 5, GOLD, 0.32 - depth * 0.12);
  }
  // Long low waves, lighter crests and darker troughs.
  for (let row = 0; row < 9; row++) {
    const y = 700 + row * 34;
    for (let k = 0; k < 5; k++) {
      const x = hash(row * 31 + k * 17) * 980 + 10;
      const len = 46 + hash(row * 13 + k * 29) * 90;
      const crest = hash(row * 7 + k * 3) > 0.5;
      cv.thickLine(x, y, x + len, y, 3, crest ? hex("#7FB3C4") : DARK, crest ? 0.22 : 0.3);
    }
  }
}

function drawWhale(cv: Canvas): void {
  // Tail fluke, raised above the water at the right end: one wide fan
  // with a notch in the middle, the classic whale-tail silhouette.
  cv.polygon(
    [
      ...quad([840, 652], [858, 520], [890, 500], 10),
      ...quad([890, 500], [912, 545], [928, 590], 6).slice(1),
      ...quad([928, 590], [950, 540], [976, 512], 6).slice(1),
      ...quad([976, 512], [965, 600], [920, 656], 10).slice(1),
    ],
    WHALE,
  );
  // Body: the great arc of the back, down to the waterline.
  const pts: Array<[number, number]> = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([96 + t * 776, whaleTop(t)]);
  }
  pts.push([872, WATERLINE], [96, WATERLINE]);
  cv.polygon(pts, WHALE);
  // A lighter line along the back, catching the sunset.
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    cv.thickLine(
      96 + t0 * 776,
      whaleTop(t0) - 2,
      96 + t1 * 776,
      whaleTop(t1) - 2,
      4,
      WHALE_EDGE,
      0.7,
    );
  }
  // Eye, low on the head at the left: a lighter ring so it reads on the dark body.
  cv.circle(186, 606, 8, hex("#3E7C8C"));
  cv.circle(186, 606, 4, DARK);
  cv.circle(184, 603, 2, FOAM, 0.9);
  // The spout: a soft mist plume fanning up from the blowhole.
  cv.polygon([[168, 548], [138, 428], [206, 428]], FOAM, 0.12);
  const spout: Array<[number, number, number]> = [
    [172, 516, 7],
    [156, 492, 6],
    [142, 466, 5],
    [188, 490, 5],
    [202, 464, 4],
    [170, 446, 4],
    [158, 522, 4],
    [186, 520, 4],
  ];
  for (const [sx, sy, sr] of spout) cv.circle(sx, sy, sr, FOAM, 0.75);
  // Foam where the body meets the water.
  for (let k = 0; k < 8; k++) {
    const fx = 96 + k * 12 + hash(k * 5) * 8;
    cv.circle(fx, WATERLINE + 2, 5 + hash(k * 11) * 5, FOAM, 0.5);
    const gx = 830 + k * 6 + hash(k * 3) * 6;
    cv.circle(gx, WATERLINE + 2, 4 + hash(k * 19) * 5, FOAM, 0.45);
  }
}

function drawHouse(cv: Canvas, x: number, scale: number, seed: number): void {
  const t = (x - 96) / 776;
  const ground = whaleTop(t);
  const wdt = 30 * scale;
  const hgt = 24 * scale;
  const bx = x - wdt / 2;
  const by = ground - hgt + 3;
  // Body.
  cv.fillRect(bx, by, wdt, hgt, HOUSE);
  // Pitched roof.
  cv.polygon(
    [
      [bx - 3, by],
      [bx + wdt / 2, by - 15 * scale],
      [bx + wdt + 3, by],
    ],
    ROOF,
  );
  // Chimney on some houses.
  if (hash(seed) > 0.45) {
    cv.fillRect(bx + wdt * 0.62, by - 16 * scale, 5 * scale, 12 * scale, ROOF);
  }
  // Two lit windows.
  cv.fillRect(bx + 5 * scale, by + 8 * scale, 6 * scale, 7 * scale, WINDOW);
  cv.fillRect(bx + wdt - 11 * scale, by + 8 * scale, 6 * scale, 7 * scale, WINDOW);
}

function drawLighthouse(cv: Canvas): void {
  const x = 470;
  const base = whaleTop((x - 96) / 776);
  const top = base - 66;
  // Tapered tower in three bands: white, red, white.
  cv.polygon([[x - 12, base], [x - 8, top], [x + 8, top], [x + 12, base]], INK);
  cv.polygon(
    [
      [x - 10.4, base - 22],
      [x - 9.2, base - 44],
      [x + 9.2, base - 44],
      [x + 10.4, base - 22],
    ],
    hex("#C0392B"),
  );
  // Lamp room and its glow.
  cv.fillRect(x - 9, top - 14, 18, 14, DARK);
  cv.circle(x, top - 7, 5, WINDOW);
  cv.circle(x, top - 7, 16, GOLD, 0.25);
  // Twin beams sweeping the evening sky.
  cv.polygon([[x, top - 7], [x - 210, top - 52], [x - 210, top + 22]], GOLD, 0.14);
  cv.polygon([[x, top - 7], [x + 210, top - 52], [x + 210, top + 22]], GOLD, 0.14);
  // A tiny flag on the lamp room.
  cv.polygon([[x, top - 14], [x, top - 26], [x + 14, top - 20]], hex("#C0392B"));
}

function drawBoat(cv: Canvas): void {
  // A small sailboat in the foreground, for scale against the whale.
  cv.polygon([[140, 880], [226, 880], [210, 906], [156, 906]], DARK);
  cv.thickLine(183, 880, 183, 818, 4, DARK);
  cv.polygon([[187, 822], [187, 872], [233, 872]], INK);
  cv.polygon([[183, 822], [183, 826], [197, 824]], hex("#C0392B"));
  cv.ellipse(183, 912, 46, 5, FOAM, 0.18);
}

function drawPoster(): Canvas {
  const cv = new Canvas(W, H);
  drawSky(cv);
  drawSea(cv);
  drawWhale(cv);
  // The town rides the whale's back, lighthouse at the crown.
  const houses: Array<[number, number, number]> = [
    [298, 1.0, 11],
    [352, 0.85, 23],
    [408, 1.1, 37],
    [545, 0.95, 51],
    [598, 1.05, 67],
    [652, 0.85, 83],
    [706, 0.95, 97],
  ];
  for (const [hx, hs, seed] of houses) drawHouse(cv, hx, hs, seed);
  drawLighthouse(cv);
  drawBoat(cv);
  // Vintage double-rule frame.
  cv.strokeRect(26, 26, W - 52, H - 52, 5, INK);
  cv.strokeRect(40, 40, W - 80, H - 80, 2, INK, 0.9);
  // The name, set big and high, and the promise underneath it.
  drawTextShadowed(cv, "CETARA", 512, 66, 16, INK, DARK, 5, 6);
  drawText(cv, "* THE CITY THAT SWIMS *", 512, 936, 5, GOLD);
  return cv;
}

function main(): void {
  const cv = drawPoster();
  const png = encodePNG(cv);
  mkdirSync("/output", { recursive: true });
  writeFileSync("/output/entry.png", png);
  console.log(`entry.png: ${png.length} bytes, ${W}x${H}`);
}

main();
