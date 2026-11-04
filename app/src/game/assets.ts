// Loads the generated sprite atlas (tools/art/gen_art.py) and draws frames.
export interface Frame { x: number; y: number; w: number; h: number; dx: number; dy: number }
export interface Piece { name: string; base: number }
export interface Layout {
  scene: { w: number; h: number };
  /** furniture sprites in draw order; `base` = screen y of the piece's front edge (for depth sorting) */
  furniture: Piece[];
  /** number of workstations (desk0..), one critter each */
  desks: number;
  spots: Record<string, { x: number; y: number; face: Facing; z?: number; sit?: boolean }>;
  nodes: Record<string, [number, number]>;
  edges: [string, string][];
  steam: [number, number];
  /** clear-glass box of each window [x, y, w, h] (scene coords); the sky is painted there */
  windows: [number, number, number, number][];
}
export type Facing = 'dr' | 'dl' | 'ur' | 'ul';

export class Atlas {
  constructor(public img: HTMLImageElement, public frames: Record<string, Frame>, public layout: Layout) {}

  has(name: string) {
    return name in this.frames;
  }

  /** Draws a frame at its baked scene position (dx, dy) offset by (ox, oy). */
  placed(ctx: CanvasRenderingContext2D, name: string, ox: number, oy: number) {
    const f = this.frames[name];
    if (f) ctx.drawImage(this.img, f.x, f.y, f.w, f.h, ox + f.dx, oy + f.dy, f.w, f.h);
  }

  draw(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, flip = false) {
    const f = this.frames[name];
    if (!f) return;
    x = Math.round(x);
    y = Math.round(y);
    if (!flip) {
      ctx.drawImage(this.img, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
    } else {
      ctx.save();
      ctx.translate(x + f.w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      ctx.restore();
    }
  }
}

export async function loadAtlas(): Promise<Atlas> {
  const [json, img] = await Promise.all([
    fetch('/assets/atlas.json').then((r) => r.json()),
    new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = '/assets/atlas.png';
    }),
  ]);
  return new Atlas(img, json.frames, json.layout);
}
