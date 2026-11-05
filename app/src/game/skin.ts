// Custom character ("skin") from a single local PNG in ~/.agent-room/characters/.
// The image may be an enlarged pixel sprite (even at a non-integer scale, on a solid
// background); it is reduced back to 1 art pixel = 1 px so it fits the room's pixel grid.
// Pictures that are still too big for the room are shrunk by a whole factor, and a
// two-step walk is made from the picture itself (the feet shuffle while the pet hops).
export interface Skin {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** built-in critters only: back view and two-frame walk cycles (same size as canvas) */
  back?: HTMLCanvasElement;
  walkF?: HTMLCanvasElement[];
  walkB?: HTMLCanvasElement[];
  /** first row with any opaque pixel (name tags sit just above it) */
  top?: number;
}

/** first non-transparent row of a canvas */
function topRow(c: HTMLCanvasElement): number {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) return y;
  return 0;
}

const EDGE = 48; // per-channel difference that counts as a colour edge
const BG_TOL = 40; // background flood-fill tolerance

const diff = (d: Uint8ClampedArray, a: number, b: number) =>
  Math.max(Math.abs(d[a] - d[b]), Math.abs(d[a + 1] - d[b + 1]), Math.abs(d[a + 2] - d[b + 2]), Math.abs(d[a + 3] - d[b + 3]));

/** edge counts at each boundary position along one axis */
function edges(d: Uint8ClampedArray, w: number, h: number, horiz: boolean): number[] {
  const n = horiz ? w : h;
  const m = horiz ? h : w;
  const e = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    let c = 0;
    for (let j = 0; j < m; j++) {
      const a = horiz ? (j * w + i) * 4 : (i * w + j) * 4;
      const b = horiz ? a + 4 : a + w * 4;
      if (diff(d, a, b) > EDGE) c++;
    }
    e[i + 1] = c;
  }
  return e;
}

/** How well a grid of cell size s explains the edges (0 = chance), and its best phase. */
function fit(e: number[], s: number): [number, number] {
  let total = 0;
  for (const v of e) total += v;
  if (!total) return [0, 0];
  let best = 0;
  let phase = 0;
  for (let k = 0; k < s * 4; k++) {
    const ph = k / 4;
    let cap = 0;
    for (let x = 0; x < e.length; x++) {
      if (!e[x]) continue;
      const t = (x - ph) / s;
      if (Math.abs(t - Math.round(t)) * s < 0.5) cap += e[x];
    }
    if (cap > best) { best = cap; phase = ph; }
  }
  const chance = 1 / s;
  return [(best / total - chance) / (1 - chance), phase];
}

export function reduce(img: HTMLImageElement): Skin {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(img, 0, 0);
  const d = sg.getImageData(0, 0, w, h).data;

  // transparent: real alpha if the image has any, else a solid background flood-filled from the border
  const clear = new Uint8Array(w * h);
  let hasAlpha = false;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] < 128) { clear[i] = 1; hasAlpha = true; }
  if (!hasAlpha) {
    const stack: number[] = [];
    for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (clear[i] || diff(d, i * 4, 0) > BG_TOL) continue;
      clear[i] = 1;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
  }

  // cell size: native sprites (small) are used as-is; enlarged ones get a grid fit
  let s = 1;
  let phx = 0;
  let phy = 0;
  if (Math.min(w, h) > 64) {
    const ex = edges(d, w, h, true);
    const ey = edges(d, w, h, false);
    let best = 0;
    for (let c = 2; c <= Math.min(48, Math.min(w, h) / 4); c += 0.05) {
      const v = (fit(ex, c)[0] + fit(ey, c)[0]) / 2;
      if (v > best) { best = v; s = c; }
    }
    if (s > 1) { phx = fit(ex, s)[1]; phy = fit(ey, s)[1]; }
  }
  const x0 = phx - Math.ceil(phx / s) * s;
  const y0 = phy - Math.ceil(phy / s) * s;
  const cw = Math.ceil((w - x0) / s);
  const ch = Math.ceil((h - y0) / s);

  // sample each cell's centre pixel (edge pixels can be blended; centres are clean)
  const out = new ImageData(cw, ch);
  let minX = cw, minY = ch, maxX = -1, maxY = -1;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const cx = Math.floor(x0 + (i + 0.5) * s);
      const cy = Math.floor(y0 + (j + 0.5) * s);
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || clear[cy * w + cx]) continue;
      const a = (cy * w + cx) * 4;
      const b = (j * cw + i) * 4;
      out.data[b] = d[a];
      out.data[b + 1] = d[a + 1];
      out.data[b + 2] = d[a + 2];
      out.data[b + 3] = 255;
      minX = Math.min(minX, i); maxX = Math.max(maxX, i);
      minY = Math.min(minY, j); maxY = Math.max(maxY, j);
    }
  }
  const tw = Math.max(1, maxX - minX + 1);
  const th = Math.max(1, maxY - minY + 1);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  canvas.getContext('2d')!.putImageData(out, -minX, -minY);
  return { canvas, w: tw, h: th };
}

/** built-in original critters (tools/art/gen_critters.py); stored in settings as 'builtin/<id>' */
export const BUILTIN_CRITTERS: [string, string][] = [
  ['shiba', '아기 시바'], ['penguin', '아기 펭귄'], ['hamster', '햄찌'], ['cat', '은빛 고양이'],
  ['rabbit', '솜토끼'], ['frog', '개굴이'], ['chick', '삐약이'],
];

/** critter each role uses until the user picks another one */
export const DEFAULT_CHARACTERS: Record<string, string> = {
  claude: 'builtin/shiba', codex: 'builtin/penguin', generic: 'builtin/hamster',
};

/**
 * Skin preference per role for auto-assignment: the role's chosen critter, then the
 * user's own PNGs, then the built-ins. Each new session takes the first one not in use.
 */
export function skinPrefs(chosen: Record<string, string>, own: string[]): Record<string, string[]> {
  const builtins = BUILTIN_CRITTERS.map(([id]) => `builtin/${id}`);
  const firsts = Object.keys(DEFAULT_CHARACTERS).map((r) => chosen[r] ?? DEFAULT_CHARACTERS[r]);
  const out: Record<string, string[]> = {};
  for (const role of Object.keys(DEFAULT_CHARACTERS)) {
    const first = chosen[role] ?? DEFAULT_CHARACTERS[role];
    // other roles' signature critters go last, so Claude and Codex keep looking different
    const rest = [...own, ...builtins].sort((a, b) => Number(firsts.includes(a)) - Number(firsts.includes(b)));
    out[role] = [...new Set([first, ...rest])];
  }
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** colours the user can pick for a built-in critter's fur/feathers */
export const CRITTER_COLORS = ['#f59a45', '#f2c14e', '#e86a8a', '#b07cd6', '#5f86e0', '#4fb3a6', '#6fae4f', '#8a6a5a', '#a6abbb', '#4a4a5c'];

type RGB = [number, number, number];
const hex2rgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
function rgb2hsl([r, g, b]: RGB): RGB {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hsl2rgb([h, s, l]: RGB): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

let rampsP: Promise<Record<string, string[]>> | null = null;

/** Maps the critter's main ramp onto `color`, keeping each tone's lightness step (exact colour swap, no blending). */
async function recolor(img: HTMLImageElement, id: string, color: string): Promise<HTMLCanvasElement> {
  rampsP ??= fetch('/assets/critters/critters.json').then((r) => r.json());
  const ramp = (await rampsP)[id] ?? [];
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  if (!ramp.length) return c;
  const base = rgb2hsl(hex2rgb(ramp[1]));
  const want = rgb2hsl(hex2rgb(color));
  const map = new Map(ramp.map((h) => {
    const [, s, l] = rgb2hsl(hex2rgb(h));
    const ns = base[1] ? Math.min(1, (s / base[1]) * want[1]) : want[1];
    const nl = Math.max(0.04, Math.min(0.96, l + (want[2] - base[2])));
    return [hex2rgb(h).join(','), hsl2rgb([want[0], ns, nl])] as const;
  }));
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const to = map.get(`${d.data[i]},${d.data[i + 1]},${d.data[i + 2]}`);
    if (to && d.data[i + 3]) [d.data[i], d.data[i + 1], d.data[i + 2]] = to;
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Built-in strip: front, walk front x2, back, walk back x2 (equal-width frames, already 1px art). */
export async function loadBuiltin(id: string, color?: string): Promise<Skin> {
  const img = await loadImage(`/assets/critters/${id}.png`);
  const src: CanvasImageSource = color ? await recolor(img, id, color) : img;
  const w = img.naturalWidth / 6;
  const h = img.naturalHeight;
  const f = [0, 1, 2, 3, 4, 5].map((i) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(src, i * w, 0, w, h, 0, 0, w, h);
    return c;
  });
  return { canvas: f[0], w, h, walkF: [f[1], f[2]], back: f[3], walkB: [f[4], f[5]], top: Math.min(topRow(f[0]), topRow(f[3])) };
}

/** a custom pet is at most this many art pixels on its longer side (built-in critters are 25 x 27) */
export const MAX_SKIN = 32;

/**
 * Shrinks a sprite by a whole factor until it fits MAX_SKIN. Each block becomes its most common
 * opaque colour (or clear when mostly clear), so every pixel stays one exact source colour.
 */
export function fitSize(c: HTMLCanvasElement): HTMLCanvasElement {
  const k = Math.ceil(Math.max(c.width, c.height) / MAX_SKIN);
  if (k <= 1) return c;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const ow = Math.ceil(c.width / k);
  const oh = Math.ceil(c.height / k);
  const out = new ImageData(ow, oh);
  for (let j = 0; j < oh; j++) {
    for (let i = 0; i < ow; i++) {
      const count = new Map<number, number>();
      let opaque = 0;
      let cells = 0;
      for (let y = j * k; y < Math.min(c.height, (j + 1) * k); y++) {
        for (let x = i * k; x < Math.min(c.width, (i + 1) * k); x++) {
          cells++;
          const a = (y * c.width + x) * 4;
          if (d[a + 3] < 128) continue;
          opaque++;
          const key = (d[a] << 16) | (d[a + 1] << 8) | d[a + 2];
          count.set(key, (count.get(key) ?? 0) + 1);
        }
      }
      if (opaque * 2 < cells) continue;
      let best = 0;
      let n = -1;
      for (const [key, v] of count) if (v > n) { n = v; best = key; }
      const b = (j * ow + i) * 4;
      out.data.set([best >> 16, (best >> 8) & 255, best & 255, 255], b);
    }
  }
  const o = document.createElement('canvas');
  o.width = ow;
  o.height = oh;
  o.getContext('2d')!.putImageData(out, 0, 0);
  return o;
}

/**
 * Still frame plus two walk frames for a one-picture pet: 1 px of clear margin on each side, and
 * in the walk frames the bottom rows (the feet) step 1 px back and forth.
 */
export function walkFrames(c: HTMLCanvasElement): { still: HTMLCanvasElement; walk: HTMLCanvasElement[] } {
  const w = c.width + 2;
  const h = c.height;
  const feet = Math.max(2, Math.round(h * 0.22));
  const make = (dx: number) => {
    const o = document.createElement('canvas');
    o.width = w;
    o.height = h;
    const g = o.getContext('2d')!;
    g.drawImage(c, 0, 0, c.width, h - feet, 1, 0, c.width, h - feet);
    g.drawImage(c, 0, h - feet, c.width, feet, 1 + dx, h - feet, c.width, feet);
    return o;
  };
  return { still: make(0), walk: [make(-1), make(1)] };
}

export async function loadSkin(bytes: number[]): Promise<Skin> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  try {
    const { still, walk } = walkFrames(fitSize(reduce(await loadImage(url)).canvas));
    // no back view: walking away shows the same picture
    return { canvas: still, w: still.width, h: still.height, walkF: walk, walkB: walk, top: topRow(still) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
