// Canvas 2D renderer for the room. Draws at native pixel resolution into a small
// buffer and scales it up by an integer factor (crisp pixels, very cheap).
// Runs at 12 fps when focused, 6 fps when unfocused, and stops when hidden.
import type { Snapshot } from '../types';
import { Actor } from './actor';
import type { Atlas } from './assets';
import { behaviorFor, REST_KEYS, restBehavior, type Behavior } from './behaviors';

export type Theme = 'day' | 'sunset' | 'night';

const SKY: Record<Theme, string[]> = {
  day: ['#86cfe6', '#a9def0', '#cdeef4', '#f3eaf1', '#fde3ec'],
  sunset: ['#8f9fd6', '#d6a6c9', '#f6bfae', '#fbd7b5', '#fde9cf'],
  night: ['#141a3a', '#1f2650', '#2f3466', '#4a3f74', '#6b4f80'],
};
const SKY_BANDS = 14;

// furniture static draw order (back to front); overlays drawn right after their host
const ORDER = ['plant', 'bookshelf', 'desk', 'monitor', 'chair', 'sofa', 'table', 'chair_back', 'sofa_arm', 'bench', 'floor_lamp'];

interface Cloud { name: string; x: number; y: number; speed: number }
interface Petal { x: number; y: number; vx: number; vy: number; t: number; kind: string }
interface Spark { x: number; y: number; t: number }

export interface SceneView {
  session: Snapshot | null;
  /** true when no agent is connected (character rests, nothing claims work) */
  empty: boolean;
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buf = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private sky: HTMLCanvasElement | null = null;
  private scale = 3;
  private theme: Theme = 'day';
  private actor: Actor;
  private view: SceneView = { session: null, empty: true };
  private clouds: Cloud[] = [];
  private petals: Petal[] = [];
  private sparks: Spark[] = [];
  private stars: [number, number][] = [];
  private tickN = 0;
  private timer: number | null = null;
  private fps = 12;
  private restVariant = 'tea';
  private restSince = 0;
  insetRight = 0;
  insetBottom = 0;
  /** offset of the scene inside the buffer (for hit testing) */
  private off = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, private atlas: Atlas) {
    this.ctx = canvas.getContext('2d')!;
    this.bctx = this.buf.getContext('2d')!;
    this.actor = new Actor('generic', atlas.layout, 'sofa');
    this.actor.setBehavior(restBehavior('tea', false), 0);
    for (let i = 0; i < 6; i++) {
      this.clouds.push({ name: `cloud${i % 4}`, x: Math.random() * 500 - 60, y: 10 + Math.random() * 160, speed: 1.5 + Math.random() * 2.5 });
    }
    for (let i = 0; i < 70; i++) this.stars.push([Math.random(), Math.random() * 0.7]);
    this.resize();
  }

  setTheme(t: Theme) {
    if (t !== this.theme) {
      this.theme = t;
      this.sky = null;
    }
  }

  setView(v: SceneView) {
    const agent = v.session ? (v.session.agent === 'demo' ? 'demo' : v.session.agent) : 'generic';
    if (agent !== this.actor.agent) this.actor.agent = agent;
    this.view = v;
    this.applyBehavior();
  }

  private applyBehavior() {
    const now = Date.now();
    if (now - this.restSince > 30_000 + Math.random() * 20_000) {
      this.restVariant = REST_KEYS[Math.floor(Math.random() * REST_KEYS.length)];
      this.restSince = now;
    }
    const s = this.view.session;
    const b: Behavior = s ? behaviorFor(s, now, this.restVariant) : restBehavior(this.restVariant, this.view.empty);
    const prev = this.actor.current?.key;
    this.actor.setBehavior(b, now);
    if (prev !== b.key && b.fx === 'sparkle') this.burst();
  }

  /** frames per second target; 0 pauses rendering entirely */
  setFps(fps: number) {
    if (fps === this.fps && this.timer !== null) return;
    this.fps = fps;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (fps > 0) this.timer = window.setInterval(() => this.frame(), 1000 / fps);
  }

  start() {
    this.setFps(this.fps || 12);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    // pin the CSS size to the backing store so the browser never resamples:
    // one art pixel is always exactly scale x scale device pixels of one colour
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w / dpr}px`;
    this.canvas.style.height = `${h / dpr}px`;
    const room = this.atlas.frames.room;
    const availW = Math.max(1, w - this.insetRight * dpr);
    const availH = Math.max(1, h - this.insetBottom * dpr);
    // largest integer scale that fits the room with some sky around it
    this.scale = Math.max(1, Math.floor(Math.min(availW / (room.w + 40), availH / (room.h + 40))));
    this.buf.width = Math.ceil(w / this.scale);
    this.buf.height = Math.ceil(h / this.scale);
    this.sky = null;
    this.draw();
  }

  /** Converts a click (CSS px relative to canvas) to "did we hit the character". */
  hitActor(cssX: number, cssY: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const bx = (cssX * dpr) / this.scale - this.off.x;
    const by = (cssY * dpr) / this.scale - this.off.y;
    const f = this.actor.feet(this.atlas.layout);
    return bx > f.x - 9 && bx < f.x + 9 && by > f.y - 24 && by < f.y + 2;
  }

  private buildSky() {
    const c = document.createElement('canvas');
    c.width = this.buf.width;
    c.height = this.buf.height;
    const g = c.getContext('2d')!;
    // flat horizontal bands (no dithering): each band is one solid colour
    const stops = SKY[this.theme].map(hex);
    const bandH = Math.ceil(c.height / SKY_BANDS);
    for (let b = 0; b < SKY_BANDS; b++) {
      const t = (b / (SKY_BANDS - 1)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const f = t - i;
      const col = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      g.fillRect(0, b * bandH, c.width, bandH);
    }
    if (this.theme === 'night') {
      g.fillStyle = '#fff6d8';
      for (const [sx, sy] of this.stars) g.fillRect(Math.floor(sx * c.width), Math.floor(sy * c.height), 1, 1);
    }
    this.sky = c;
  }

  private burst() {
    for (let i = 0; i < 6; i++) this.sparks.push({ x: (Math.random() - 0.5) * 26, y: -10 - Math.random() * 18, t: 0 });
  }

  private frame() {
    this.tickN++;
    if (this.tickN % 6 === 0) this.applyBehavior();
    this.actor.tick(Date.now());
    this.draw();
  }

  draw() {
    const g = this.bctx;
    const W = this.buf.width;
    const H = this.buf.height;
    const A = this.atlas;
    const L = A.layout;
    if (!this.sky) this.buildSky();
    g.imageSmoothingEnabled = false;
    g.drawImage(this.sky!, 0, 0);

    // clouds drift slowly
    const dt = 1 / Math.max(1, this.fps);
    for (const c of this.clouds) {
      c.x -= c.speed * dt;
      const f = A.frames[c.name];
      if (c.x < -f.w - 10) {
        c.x = W + Math.random() * 60;
        c.y = 10 + Math.random() * Math.max(20, H - 80);
      }
      A.draw(g, c.name, c.x, c.y);
    }

    // centre the island in the free area; gentle float
    const freeW = W - (this.insetRight * (window.devicePixelRatio || 1)) / this.scale;
    const freeH = H - (this.insetBottom * (window.devicePixelRatio || 1)) / this.scale;
    const bob = Math.round(Math.sin(Date.now() / 2200) * 1.2);
    const room = A.frames.room;
    const ox = Math.floor((freeW - room.w) / 2) - room.dx;
    const oy = Math.floor((freeH - room.h) / 2) - room.dy + bob;
    this.off = { x: ox, y: oy };

    A.placed(g, 'room', ox, oy);
    const b = this.actor.current;

    // depth-sorted furniture + character: the character goes right after the last
    // furniture piece it overlaps on screen and stands in front of
    const ax = this.actor.x;
    const ay = this.actor.y;
    const feet = this.actor.feet(L);
    const boxes = Object.fromEntries(L.furniture.map((f) => [f.name, f.box]));
    const overlaps = (name: string) => {
      const f = A.frames[name];
      return f && f.dx < feet.x + 9 && f.dx + f.w > feet.x - 9 && f.dy < feet.y + 1 && f.dy + f.h > feet.y - 26;
    };
    const occludes = (b: [number, number, number, number]) => ax + 1 <= b[0] || ay + 1 <= b[1];
    let insertAfter = -1;
    ORDER.forEach((name, i) => {
      if (boxes[name] && overlaps(name) && !occludes(boxes[name])) insertAfter = i;
    });
    if (insertAfter === -1) this.actor.draw(g, A, ox, oy);
    ORDER.forEach((name, i) => {
      A.placed(g, name, ox, oy);
      if (name === 'monitor') A.placed(g, this.screenFrame(b), ox, oy);
      if (name === 'bench') A.placed(g, this.rigFrame(b), ox, oy);
      if (i === insertAfter) this.actor.draw(g, A, ox, oy);
    });

    // tea steam
    const st = Math.floor(this.tickN / 4) % 2;
    A.draw(g, st ? 'steam0' : 'steam1', ox + L.steam[0] - 1, oy + L.steam[1] - 6 - (Math.floor(this.tickN / 4) % 3));

    // petals
    this.updatePetals(g, ox, oy);

    // character fx + bubble
    const hx = ox + feet.x;
    const hy = oy + feet.y - 24;
    if (b?.fx === 'sweat' && Math.floor(this.tickN / 3) % 2 === 0) A.draw(g, 'sweat', hx + 6, hy + 4);
    if (b?.fx === 'sparkle' && this.tickN % 18 === 0) this.burst();
    this.sparks = this.sparks.filter((s) => s.t < 14);
    for (const s of this.sparks) {
      s.t++;
      s.y -= 0.4;
      A.draw(g, s.t % 4 < 2 ? 'sparkle0' : 'sparkle1', hx + s.x - 2, hy + s.y + 10);
    }
    if (b?.bubble && !this.actor.walking) {
      const bub = Math.round(Math.sin(this.tickN / 3) * 1);
      A.draw(g, `bubble_${b.bubble}`, hx - 3, hy - 13 + bub);
    }

    // lighting
    if (this.theme !== 'day') {
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = this.theme === 'night' ? 'rgba(70,72,140,0.55)' : 'rgba(255,200,180,0.18)';
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    // blit
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.buf, 0, 0, W * this.scale, H * this.scale);
  }

  private screenFrame(b: Behavior | null): string {
    const s = b?.screen ?? 'off';
    const t = Math.floor(this.tickN / 3);
    switch (s) {
      case 'code': return `scr_code${t % 4}`;
      case 'read': return `scr_read${Math.floor(t / 4) % 2}`;
      case 'err': return t % 2 ? 'scr_err' : 'scr_off';
      case 'ok': return 'scr_ok';
      case 'wait': return t % 4 < 2 ? 'scr_wait' : 'scr_idle';
      case 'idle': return 'scr_idle';
      default: return 'scr_off';
    }
  }

  private rigFrame(b: Behavior | null): string {
    switch (b?.rig) {
      case 'run': return `rig_run${Math.floor(this.tickN / 3) % 3}`;
      case 'pass': return 'rig_pass';
      case 'fail': return Math.floor(this.tickN / 4) % 2 ? 'rig_fail' : 'rig_idle';
      default: return 'rig_idle';
    }
  }

  private updatePetals(g: CanvasRenderingContext2D, ox: number, oy: number) {
    if (this.petals.length < 9 && Math.random() < 0.08) {
      const fromRight = Math.random() < 0.6;
      this.petals.push({
        x: fromRight ? 240 + Math.random() * 70 : 80 + Math.random() * 40,
        y: fromRight ? 10 + Math.random() * 40 : 30 + Math.random() * 30,
        vx: -0.25 - Math.random() * 0.35,
        vy: 0.35 + Math.random() * 0.3,
        t: 0,
        kind: Math.random() < 0.5 ? 'petal' : 'petal2',
      });
    }
    this.petals = this.petals.filter((p) => p.t < 160);
    for (const p of this.petals) {
      p.t++;
      p.x += p.vx + Math.sin(p.t / 7) * 0.25;
      p.y += p.vy;
      this.atlas.draw(g, p.kind, ox + p.x, oy + p.y);
    }
  }
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
