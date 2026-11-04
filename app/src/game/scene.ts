// Canvas 2D renderer for the room. Draws at native pixel resolution into a small
// buffer and scales it up by an integer factor (crisp pixels, very cheap).
// Runs at 12 fps when focused, 6 fps when unfocused, and stops when hidden.
import type { Snapshot } from '../types';
import { Actor } from './actor';
import type { Atlas } from './assets';
import { behaviorFor, REST_KEYS, restBehavior, type Behavior } from './behaviors';
import type { Skin } from './skin';

export type Theme = 'day' | 'sunset' | 'night';

// outside the room: the black void of a handheld RPG interior map
const VOID = '#fbe8e0';

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
  private scale = 3;
  private theme: Theme = 'day';
  private actor: Actor;
  private view: SceneView = { session: null, empty: true };
  private sparks: Spark[] = [];
  private tickN = 0;
  private timer: number | null = null;
  private fps = 12;
  private restVariant = 'tea';
  private restSince = 0;
  insetRight = 0;
  insetBottom = 0;
  insetTop = 0;
  /** room-only mode: transparent around the room */
  roomOnly = false;
  /** custom characters by agent ('claude', 'codex', 'generic'); demo uses 'generic' */
  skins: Record<string, Skin> = {};
  /** offset of the scene inside the buffer (for hit testing) */
  private off = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, private atlas: Atlas) {
    this.ctx = canvas.getContext('2d')!;
    this.bctx = this.buf.getContext('2d')!;
    this.actor = new Actor('generic', atlas.layout, 'sofa');
    this.actor.setBehavior(restBehavior('tea', false), 0);
    this.resize();
  }

  setTheme(t: Theme) {
    this.theme = t;
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
    // measure the container: the canvas itself carries a pinned CSS size from the last resize
    const rect = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
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
    const availH = Math.max(1, h - (this.insetBottom + this.insetTop) * dpr);
    // largest integer scale that fits the room with some sky around it
    const margin = this.roomOnly ? 6 : 16;
    this.scale = Math.max(1, Math.floor(Math.min(availW / (room.w + margin), availH / (room.h + margin))));
    this.buf.width = Math.ceil(w / this.scale);
    this.buf.height = Math.ceil(h / this.scale);
    this.draw();
  }

  /** Converts a click (CSS px relative to canvas) to "did we hit the character". */
  hitActor(cssX: number, cssY: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const bx = (cssX * dpr) / this.scale - this.off.x;
    const by = (cssY * dpr) / this.scale - this.off.y;
    const f = this.actor.feet();
    return bx > f.x - 9 && bx < f.x + 9 && by > f.y - 24 && by < f.y + 2;
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
    g.imageSmoothingEnabled = false;
    if (this.roomOnly) {
      g.clearRect(0, 0, W, H);
    } else {
      g.fillStyle = VOID;
      g.fillRect(0, 0, W, H);
    }

    // centre the room in the free area
    const freeW = W - (this.insetRight * (window.devicePixelRatio || 1)) / this.scale;
    const top = (this.insetTop * (window.devicePixelRatio || 1)) / this.scale;
    const freeH = H - top - (this.insetBottom * (window.devicePixelRatio || 1)) / this.scale;
    const room = A.frames.room;
    const ox = Math.floor((freeW - room.w) / 2) - room.dx;
    const oy = Math.floor(top + (freeH - room.h) / 2) - room.dy;
    this.off = { x: ox, y: oy };

    A.placed(g, 'room', ox, oy);
    const b = this.actor.current;

    // y-sorted: furniture whose front edge is above the character's feet is drawn first
    const feet = this.actor.feet();
    const skin = this.skins[this.actor.agent === 'demo' ? 'generic' : this.actor.agent];
    let drawn = false;
    for (const f of L.furniture) {
      if (!drawn && f.base > this.actor.y) {
        this.actor.draw(g, A, ox, oy, skin);
        drawn = true;
      }
      A.placed(g, f.name, ox, oy);
      if (f.name === 'monitor') A.placed(g, this.screenFrame(b), ox, oy);
      if (f.name === 'bench') A.placed(g, this.rigFrame(b), ox, oy);
    }
    if (!drawn) this.actor.draw(g, A, ox, oy, skin);

    // tea steam
    const st = Math.floor(this.tickN / 4) % 2;
    A.draw(g, st ? 'steam0' : 'steam1', ox + L.steam[0] - 1, oy + L.steam[1] - 6 - (Math.floor(this.tickN / 4) % 3));

    // character fx + bubble
    const hx = ox + feet.x;
    const hy = oy + feet.y - (skin ? skin.h : 24);
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
      // source-atop keeps the transparent surroundings untouched in room-only mode
      g.globalCompositeOperation = this.roomOnly ? 'source-atop' : 'multiply';
      g.fillStyle = this.theme === 'night' ? 'rgba(70,72,140,0.55)' : 'rgba(255,200,180,0.18)';
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    // blit
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
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


}
