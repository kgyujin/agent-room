// The view through the office windows, following the local clock: sky colours,
// drifting clouds, sun and moon crossing, stars at night, and two rows of hills.
// Drawn into each window's clear glass (the room sprite leaves those pixels transparent).
// Pixel art rules hold: every pixel gets exactly one solid colour.

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

// hour -> sky top, sky bottom, cloud, far hills, near hills
const KEYS: [number, string, string, string, string, string][] = [
  [0, '#1b2147', '#33406e', '#4a5384', '#2a3a55', '#1f2c40'],
  [4.5, '#1b2147', '#33406e', '#4a5384', '#2a3a55', '#1f2c40'],
  [5.75, '#4b5a9c', '#f2a7a0', '#e9b8c8', '#5b6f84', '#3f5866'],
  [7, '#7fb2ee', '#ffd9b5', '#fff4ea', '#7fa88c', '#5d8a64'],
  [9, '#6fb0f0', '#cfe8ff', '#ffffff', '#86b894', '#5f9a5c'],
  [15.5, '#6fb0f0', '#cfe8ff', '#ffffff', '#86b894', '#5f9a5c'],
  [17.25, '#7aa6e2', '#ffdcae', '#fff1dc', '#8fa889', '#6a8a5c'],
  [18.5, '#6a5aa8', '#ff9e6e', '#ffc7a8', '#7a6f86', '#5a5466'],
  [19.5, '#2f3266', '#a86a8e', '#7d6a99', '#3b4060', '#2a3048'],
  [21, '#1b2147', '#33406e', '#4a5384', '#2a3a55', '#1f2c40'],
  [24, '#1b2147', '#33406e', '#4a5384', '#2a3a55', '#1f2c40'],
];

// hour -> room lighting multiplied over the scene (colour, strength)
const LIGHT: [number, string, number][] = [
  [0, '#46488c', 0.55], [5, '#46488c', 0.55], [6.5, '#ffc8b4', 0.18], [8, '#ffffff', 0],
  [16.5, '#ffffff', 0], [18.25, '#ffaa8c', 0.24], [19.75, '#46488c', 0.55], [24, '#46488c', 0.55],
];

function at<T extends unknown[]>(keys: T[], h: number): [T, T, number] {
  let i = 0;
  while (i < keys.length - 2 && (keys[i + 1][0] as number) <= h) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = Math.min(1, Math.max(0, (h - (a[0] as number)) / ((b[0] as number) - (a[0] as number))));
  return [a, b, t];
}

const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

/** lighting for 'auto': CSS colour + alpha of the multiply pass (alpha 0 = full daylight) */
export function lightAt(d: Date): { color: string; alpha: number } {
  const [a, b, t] = at(LIGHT, hourOf(d));
  const c = mix(hex(a[1]), hex(b[1]), t);
  return { color: `rgb(${c[0]},${c[1]},${c[2]})`, alpha: a[2] + (b[2] - a[2]) * t };
}

function hsh(x: number, y: number, s: number): number {
  let h = 2166136261 ^ s;
  h = Math.imul(h ^ (x & 0xffff), 16777619);
  h = Math.imul(h ^ (y & 0xffff), 16777619);
  return ((h >>> 8) & 0xffff) / 0x10000;
}

export type Box = [number, number, number, number];

/**
 * Paint each window box (scene coordinates) into an RGBA image the size of the scene's
 * window span. `span` = [x, y, w, h] of the union of boxes. Returns ImageData for that span.
 */
export function paintSky(boxes: Box[], span: Box, d: Date, tick: number): ImageData {
  const [sx, sy, sw, sh] = span;
  const img = new ImageData(sw, sh);
  const px = img.data;
  const h = hourOf(d);
  const [ka, kb, kt] = at(KEYS, h);
  const C = [1, 2, 3, 4, 5].map((i) => mix(hex(ka[i] as string), hex(kb[i] as string), kt));
  const [top, bot, cloud, hillF, hillN] = C;
  const night = h < 5 || h > 20 ? 1 : h < 6 ? 6 - h : h > 19 ? h - 19 : 0;
  // clouds drift ~1 px every 40 s, wrapping on a 400 px loop
  const drift = Math.floor((d.getTime() / 40000) % 400);
  // sun 6:00-18:30 and moon 19:00-5:00 cross the whole window span left to right
  const sunT = (h - 6) / 12.5;
  const moonT = ((h + 24 - 19) % 24) / 10;
  const body = sunT >= 0 && sunT <= 1 ? { t: sunT, sun: true } : moonT <= 1 ? { t: moonT, sun: false } : null;
  const minX = Math.min(...boxes.map((b) => b[0]));
  const maxX = Math.max(...boxes.map((b) => b[0] + b[2]));
  const bodyX = body ? minX + body.t * (maxX - minX) : -99;

  const put = (x: number, y: number, c: RGB) => {
    const o = ((y - sy) * sw + (x - sx)) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  };

  for (const [bx, by, bw, bh] of boxes) {
    const horizon = Math.round(bh * 0.74);
    const bodyY = body ? by + Math.round(horizon - 3 - Math.sin(Math.PI * body.t) * (horizon - 9)) : -99;
    for (let y = by; y < by + bh; y++) {
      const ly = y - by;
      for (let x = bx; x < bx + bw; x++) {
        // hills: far row then near row, continuous across windows (scene x)
        const far = horizon - 2 + Math.round(Math.sin(x * 0.11) * 2 + Math.sin(x * 0.037 + 1) * 2);
        const near = horizon + 3 + Math.round(Math.sin(x * 0.19 + 2) * 1.5 + Math.sin(x * 0.05) * 2);
        if (ly >= near) { put(x, y, ly === near ? mix(hillN, hillF, 0.4) : hillN); continue; }
        if (ly >= far) { put(x, y, ly === far ? mix(hillF, cloud, 0.25) : hillF); continue; }
        // sky in four flat bands
        const band = Math.min(3, Math.floor((ly / horizon) * 4));
        let c = mix(top, bot, band / 3);
        // sun / moon disc
        const dx = x - bodyX;
        const dy = y - bodyY;
        const r2 = dx * dx + dy * dy;
        if (body && r2 <= 9.5) {
          if (body.sun) c = r2 <= 4.5 ? hex('#fff6c8') : hex('#ffd36b');
          else c = dx + 1.5 > 0 && (dx - 1) * (dx - 1) + (dy + 1) * (dy + 1) <= 6 ? mix(top, bot, 0.3) : hex('#f4f1ff');
        } else if (night > 0.5 && hsh(x, y, 5) < 0.035 && (hsh(x, y, Math.floor(tick / 12)) > 0.25 || night < 0.8)) {
          c = hex('#fffbe6');
        } else {
          // clouds: one puffy cloud per 64 px cell, at a per-cell height in the upper sky
          const gx = x + drift;
          const cell = Math.floor(gx / 64);
          const cx = cell * 64 + 12 + hsh(cell, 0, 1) * 36;
          const cy = 3 + hsh(cell, 0, 2) * (horizon * 0.45);
          const rx = 6 + hsh(cell, 0, 3) * 5;
          const ex = (gx - cx) / rx;
          const ey = (ly + 0.5 - cy) / 2.2;
          const ex2 = (gx - cx - rx * 0.35) / (rx * 0.55);
          const ey2 = (ly + 0.5 - cy + 1.6) / 2.2;
          if (ex * ex + ey * ey <= 1 || ex2 * ex2 + ey2 * ey2 <= 1) c = ey > 0.35 ? mix(cloud, bot, 0.35) : cloud;
        }
        put(x, y, c);
      }
    }
  }
  return img;
}
