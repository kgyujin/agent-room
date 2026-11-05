// Menu bar icon frames drawn from any pet (built-in or the user's PNG), in the same layout as the
// bundled shiba frames (tools/art/gen_tray.py): the pet stands at the bottom left, and a "!" or
// check bubble, or "z"s, sit at the top right. macOS draws the icon 18pt tall, so the 36px-tall
// canvas puts one art pixel on one Retina screen pixel. One colour per pixel, no smoothing.
import type { Skin } from './skin';

const H = 36;
/** tallest pet that still leaves the bubble some room; taller pictures are shrunk by a whole factor */
const MAX_PET = 30;
const INK = '#2a2230';
const PAPER = '#ffffff';

const BUBBLE = [
  '.ooooooooo.',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  'opppppppppo',
  '.oppoooooo.',
  '.opo.......',
  '.oo........',
];
const EXCLAIM = ['..xx.', '..xx.', '..xx.', '..xx.', '.....', '..xx.'];
const CHECK = ['.....', '....x', '...xx', 'x.xx.', 'xxx..', '.x...'];
const Z_BIG = ['oooooo', 'oxxxxo', 'oooxoo', 'ooxooo', 'oxxxxo', 'oooooo'];
const Z_SMALL = ['ooooo', 'oxxoo', 'ooxoo', 'ooxxo', 'ooooo'];

function draw(g: CanvasRenderingContext2D, rows: string[], x0: number, y0: number, colours: Record<string, string>) {
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    if (!colours[ch]) return;
    g.fillStyle = colours[ch];
    g.fillRect(x0 + x, y0 + y, 1, 1);
  }));
}

/** box around the opaque pixels of all the pictures (they share one size) */
function bounds(cs: HTMLCanvasElement[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of cs) {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: cs[0].width, h: cs[0].height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** the faded grey look for "nothing connected": dark lines stay dark, the rest turns light grey */
function grey(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  const im = g.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = (d[i] * 30 + d[i + 1] * 59 + d[i + 2] * 11) / 100;
    const v = l < 70 ? 90 : 160 + Math.round(l / 3);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(im, 0, 0);
}

function toPng(c: HTMLCanvasElement): Promise<number[]> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(Array.from(new Uint8Array(a))), rej) : rej(new Error('no png'))), 'image/png'));
}

/** 8 canvases: run0..3 (waddle with a hop), wait, done, idle, off */
export function trayCanvases(skin: Skin): HTMLCanvasElement[] {
  const still = skin.canvas;
  const [stepL, stepR] = skin.walkF ?? [still, still];
  const b = bounds([still, stepL, stepR]);
  // whole-factor scale: small pictures are doubled, big ones shrunk until they fit
  const k = b.h > MAX_PET ? 1 / Math.ceil(b.h / MAX_PET) : b.h * 2 <= MAX_PET - 6 ? 2 : 1;
  const pw = Math.max(1, Math.round(b.w * k));
  const ph = Math.max(1, Math.round(b.h * k));
  const W = Math.max(H, pw + 11);
  const frame = (pet: HTMLCanvasElement, dy = 0, extra?: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    g.drawImage(pet, b.x, b.y, b.w, b.h, 0, H - ph + dy, pw, ph);
    extra?.(g);
    return c;
  };
  const bubble = (glyph: string[], colour: string) => (g: CanvasRenderingContext2D) => {
    draw(g, BUBBLE, W - 11, 0, { o: INK, p: PAPER });
    draw(g, glyph, W - 8, 3, { x: colour });
  };
  const off = frame(still);
  grey(off);
  return [
    frame(stepL), frame(still, -1), frame(stepR), frame(still, -1),
    frame(still, 0, bubble(EXCLAIM, '#e8553d')),
    frame(still, 0, bubble(CHECK, '#3d9a50')),
    frame(still, 0, (g) => { draw(g, Z_BIG, W - 6, 0, { o: INK, x: PAPER }); draw(g, Z_SMALL, W - 12, 6, { o: INK, x: PAPER }); }),
    off,
  ];
}

export function trayFrames(skin: Skin): Promise<number[][]> {
  return Promise.all(trayCanvases(skin).map(toPng));
}
