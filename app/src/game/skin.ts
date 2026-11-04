// Custom character ("skin") from a single local PNG in ~/.agent-room/characters/.
// The image may be an enlarged pixel sprite (even at a non-integer scale, on a solid
// background); it is reduced back to 1 art pixel = 1 px so it fits the room's pixel grid.
export interface Skin { canvas: HTMLCanvasElement; w: number; h: number }

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
  ['hamster', '햄스터'], ['chipmunk', '다람쥐'], ['rabbit', '토끼'], ['kitten', '회색 고양이'],
];

function loadUrl(url: string): Promise<Skin> {
  return new Promise<Skin>((res, rej) => {
    const img = new Image();
    img.onload = () => res(reduce(img));
    img.onerror = rej;
    img.src = url;
  });
}

export const loadBuiltin = (id: string) => loadUrl(`/assets/critters/${id}.png`);

export async function loadSkin(bytes: number[]): Promise<Skin> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  try {
    return await loadUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
