// The view through the office windows, following the local clock: sky colours,
// drifting clouds, sun and moon, stars at night, and two rows of hills.
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

/** world height of the far horizon (eye level), the same on both walls */
const HORIZON = 18;
/** world height where the sky colour reaches its top band */
const SKY_TOP = 40;

/**
 * Paint each window box (scene coordinates) into an RGBA image the size of the scene's
 * window span. `span` = [x, y, w, h] of the union of boxes. Returns ImageData for that span.
 *
 * The view is laid out in each wall's own coordinates (u along the wall, z up), so the
 * horizon sits at one height in every window and the hills run on from window to window.
 * The left wall faces the sunrise and the right wall the sunset: the sun (and the moon)
 * is only ever in one place, rising on the left in the morning and setting on the right.
 */
export function paintSky(boxes: Box[], span: Box, d: Date, tick: number, walls: ('L' | 'R')[] = [], origin: [number, number] = [0, 0]): ImageData {
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
  const [OX, OY] = origin;
  const wallOf = (i: number): 'L' | 'R' => walls[i] ?? 'R';
  // u (along the wall) and z (height) of a screen pixel on a wall, and back
  const uOf = (w: 'L' | 'R', x: number) => (w === 'L' ? OX - x - 0.5 : x + 0.5 - OX) / 2;
  // the top-down camera sees the back wall face on: no slant along u
  const toScreen = (w: 'L' | 'R', u: number, z: number): [number, number] => [w === 'L' ? OX - 2 * u - 0.5 : OX + 2 * u - 0.5, OY - z - 0.5];
  // span of each wall's windows along the wall
  const range: Record<string, [number, number]> = {};
  boxes.forEach(([bx, , bw], i) => {
    const w = wallOf(i);
    const a = uOf(w, bx);
    const b = uOf(w, bx + bw);
    const r = (range[w] ??= [Infinity, -Infinity]);
    r[0] = Math.min(r[0], a, b);
    r[1] = Math.max(r[1], a, b);
  });
  // sun 6:00-11:00 rising on the left wall, 13:00-18:30 setting on the right; the moon likewise 19-24 / 0-5
  const arc = (from: number, to: number) => (h >= from && h <= to ? (h - from) / (to - from) : null);
  const bodies: { wall: 'L' | 'R'; t: number; up: boolean; sun: boolean }[] = [];
  for (const [wall, from, to, up, sun] of [['L', 6, 11, true, true], ['R', 13, 18.5, false, true], ['L', 19, 24, true, false], ['R', 0, 5, false, false]] as const) {
    const t = arc(from, to);
    if (t !== null && range[wall]) bodies.push({ wall, t, up, sun });
  }
  const body = bodies[0];
  let bodyXY: [number, number] = [-99, -99];
  if (body) {
    const [u0, u1] = range[body.wall];
    const lift = body.up ? body.t : 1 - body.t;
    bodyXY = toScreen(body.wall, u0 + body.t * (u1 - u0), HORIZON - 1 + lift * 18);
  }

  const put = (x: number, y: number, c: RGB) => {
    const o = ((y - sy) * sw + (x - sx)) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  };

  boxes.forEach(([bx, by, bw, bh], i) => {
    const wall = wallOf(i);
    // each wall looks out on its own stretch of country
    const seed = wall === 'L' ? 100 : 0;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const u = uOf(wall, x);
        const z = Math.floor(OY - y);
        // hills: far row then near row, continuous along the wall
        const far = HORIZON + 2 + Math.round(Math.sin((u + seed) * 0.22) * 2 + Math.sin((u + seed) * 0.074 + 1) * 2);
        const near = HORIZON - 3 + Math.round(Math.sin((u + seed) * 0.38 + 2) * 1.5 + Math.sin((u + seed) * 0.1) * 2);
        if (z <= near) { put(x, y, z === near ? mix(hillN, hillF, 0.4) : hillN); continue; }
        if (z <= far) { put(x, y, z === far ? mix(hillF, cloud, 0.25) : hillF); continue; }
        // sky in four flat bands by height
        const band = Math.max(0, Math.min(3, Math.floor(((SKY_TOP - z) / (SKY_TOP - HORIZON)) * 4)));
        let c = mix(top, bot, band / 3);
        // sun / moon disc (round on screen)
        const dx = x - bodyXY[0];
        const dy = y - bodyXY[1];
        const r2 = dx * dx + dy * dy;
        if (body && wall === body.wall && r2 <= 9.5) {
          if (body.sun) c = r2 <= 4.5 ? hex('#fff6c8') : hex('#ffd36b');
          else c = dx + 1.5 > 0 && (dx - 1) * (dx - 1) + (dy + 1) * (dy + 1) <= 6 ? mix(top, bot, 0.3) : hex('#f4f1ff');
        } else if (night > 0.5 && hsh(x, y, 5) < 0.035 && (hsh(x, y, Math.floor(tick / 12)) > 0.25 || night < 0.8)) {
          c = hex('#fffbe6');
        } else {
          // clouds: one puffy cloud per 64 px of wall, at a per-cell height in the upper sky,
          const gx = 2 * (u + seed) + drift;
          const cell = Math.floor(gx / 64);
          const cx = cell * 64 + 12 + hsh(cell, seed, 1) * 36;
          const cz = HORIZON + 7 + hsh(cell, seed, 2) * 12;
          const rx = 6 + hsh(cell, seed, 3) * 5;
          // screen offset from the cloud centre: x along the wall, y down the screen
          const ox = gx - cx;
          const oy = cz - z;
          const ex = ox / rx;
          const ey = oy / 2.2;
          const ex2 = (ox - rx * 0.35) / (rx * 0.55);
          const ey2 = (oy + 1.6) / 2.2;
          if (ex * ex + ey * ey <= 1 || ex2 * ex2 + ey2 * ey2 <= 1) c = ey > 0.35 ? mix(cloud, bot, 0.35) : cloud;
        }
        put(x, y, c);
      }
    }
  });
  return img;
}
