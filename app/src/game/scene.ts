// Canvas 2D renderer for the office. Draws at native pixel resolution into a small
// buffer and scales it up by an integer factor (crisp pixels, very cheap).
// Runs at 12 fps when focused, 4 fps when unfocused (the window is then only glanced at), and stops when hidden.
// One critter per session (up to one per desk), each with its own desk and screen.
import { stateTone } from '../labels';
import type { Snapshot } from '../types';
import { Actor } from './actor';
import type { Atlas } from './assets';
import { behaviorFor, NAP_AFTER, REST_HOLD, REST_POOL, restBehavior, type Behavior, type Energy } from './behaviors';
import type { Skin } from './skin';
import { lightAt, paintSky, type Box } from './sky';

/** room lighting; 'auto' follows the local clock continuously */
export type Theme = 'day' | 'sunset' | 'night' | 'auto';


interface Spark { x: number; y: number; t: number }

/** what a shared spot falls back to when another critter is already there */
const SHARED = new Set(['shelf', 'board', 'bench', 'window', 'plantcorner', 'center', 'coffee', 'beanbag']);

/** floor ring under a pet by state, so who works, who waits for you and what broke reads at a glance */
// the same values as the --work / --wait / --bad / --ok tokens in styles.css
const RING: Partial<Record<ReturnType<typeof stateTone>, string>> = { work: '#2e9a9c', wait: '#d9922e', bad: '#d0504b', ok: '#3f9e57' };

interface Mate {
  key: string;
  agent: string;
  slot: number;
  actor: Actor;
  session: Snapshot | null;
  skin: string;
  sparks: Spark[];
  restVariant: string;
  /** when the current rest variant ends */
  restUntil: number;
}

/** x, y: the point above the head a tag hangs from; foot, half: the floor line and half width of the
 *  critter (and its bubble) below it, all in CSS px */
export interface Anchor { key: string; agent: string; x: number; y: number; foot?: number; half?: number }

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buf = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  scale = 3;
  private theme: Theme = 'day';
  private mates: Mate[] = [];
  private tickN = 0;
  private timer: number | null = null;
  private fps = 12;
  insetRight = 0;
  insetBottom = 0;
  insetTop = 0;
  /** colour painted around the room (follows the UI theme) */
  /** solid colour behind the room in window mode; null leaves it clear for the page background */
  backdrop: string | null = null;
  /** room-only mode: transparent around the room */
  roomOnly = false;
  /** how much idle pets roam (setting) */
  energy: Energy = 'normal';
  /** draw the little icons over the pets' heads (setting) */
  bubbles = true;
  /** every loaded skin by name ('builtin/shiba', user PNG names) */
  skins: Record<string, Skin> = {};
  /** pets new critters may get (the user's checked list) */
  pool: string[] = [];
  /** told which pet each session has whenever that changes (the desktop pets wear the same ones) */
  onSkins: ((bySession: Record<string, string>) => void) | null = null;
  private lastSkins = '';
  /** offset of the scene inside the buffer (for hit testing) */
  private off = { x: 0, y: 0 };
  /** pixel ratio the canvas was last fitted at */
  private fitDpr = 0;
  /** user zoom: integer steps added to the fitted scale (mouse wheel) */
  zoom = 0;
  /** user pan in art pixels while zoomed in */
  private pan = { x: 0, y: 0 };
  private desks: number;
  /** clock for the sky and 'auto' lighting (the browser preview can pin an hour) */
  now = () => new Date();
  private sky = document.createElement('canvas');
  private skyKey = '';
  private span: Box;
  /** scratch canvas for the lighting pass (keeps transparent pixels transparent) */
  private tmp = document.createElement('canvas');

  constructor(private canvas: HTMLCanvasElement, private atlas: Atlas) {
    this.ctx = canvas.getContext('2d')!;
    // read back every frame (below), so it lives in memory rather than on the GPU
    this.bctx = this.buf.getContext('2d', { willReadFrequently: true })!;
    this.desks = atlas.layout.desks;
    this.span = this.fitSky();
    this.resize();
  }

  /** the window span of the current atlas, and a sky canvas that size */
  private fitSky(): Box {
    const wb = this.atlas.layout.windows ?? [];
    const x0 = Math.min(...wb.map((b) => b[0]), 0);
    const y0 = Math.min(...wb.map((b) => b[1]), 0);
    const span: Box = wb.length ? [x0, y0, Math.max(...wb.map((b) => b[0] + b[2])) - x0, Math.max(...wb.map((b) => b[1] + b[3])) - y0] : [0, 0, 1, 1];
    this.sky.width = span[2];
    this.sky.height = span[3];
    this.skyKey = '';
    return span;
  }

  /** switch to the same room seen by another camera: every pet keeps its spot */
  setAtlas(atlas: Atlas) {
    this.atlas = atlas;
    this.desks = atlas.layout.desks;
    this.alpha = null;
    this.span = this.fitSky();
    for (const m of this.mates) {
      const spot = m.actor.spot in atlas.layout.nodes ? m.actor.spot : `sofa${m.slot}`;
      const old = m.actor;
      m.actor = new Actor(m.agent, atlas.layout, spot);
      // a frozen (stale) behavior never re-arrives, so carry the pose and seat height over
      if (!old.walking) Object.assign(m.actor, { frame: old.frame, flip: old.flip, lr: old.lr, z: old.z });
      this.applyBehavior(m);
    }
    this.resize();
  }

  /** how many sessions get a pet (one per desk); the rest are only in the lists */
  get capacity() {
    return this.desks;
  }

  get view() {
    return this.atlas.layout.camera ?? 'iso';
  }

  setTheme(t: Theme) {
    this.theme = t;
  }

  /** sessions in priority order; with none, one critter rests in the lounge */
  setSessions(list: Snapshot[]) {
    const shown = list.slice(0, this.desks);
    const keys = shown.length ? shown.map((s) => s.key) : ['__rest'];
    this.mates = this.mates.filter((m) => keys.includes(m.key));
    for (const k of keys) {
      const s = shown.find((x) => x.key === k) ?? null;
      let m = this.mates.find((x) => x.key === k);
      if (!m) {
        const used = new Set(this.mates.map((x) => x.slot));
        const order = this.atlas.layout.deskOrder ?? [...Array(this.desks).keys()];
        const slot = order.find((i) => !used.has(i)) ?? 0;
        const agent = s ? (s.agent === 'demo' ? 'generic' : s.agent) : 'generic';
        const actor = new Actor(agent, this.atlas.layout, `sofa${slot}`);
        m = { key: k, agent, slot, actor, session: s, skin: '', sparks: [], restVariant: 'tea', restUntil: 0 };
        this.mates.push(m);
      }
      m.session = s;
    }
    this.assignSkins();
    for (const m of this.mates) this.applyBehavior(m);
  }

  /**
   * Each critter keeps its pet while that pet is still in the pool. One without a pet gets a random
   * pool pet nobody in the room has; only when every pool pet is already in the room is one repeated.
   */
  assignSkins() {
    const inRoom = new Set<string>();
    for (const m of this.mates) {
      if (m.skin && this.skins[m.skin] && this.pool.includes(m.skin)) inRoom.add(m.skin);
      else m.skin = '';
    }
    for (const m of this.mates) {
      if (m.skin) continue;
      const free = this.pool.filter((n) => !inRoom.has(n));
      const from = free.length ? free : this.pool;
      m.skin = from[Math.floor(Math.random() * from.length)] ?? '';
      inRoom.add(m.skin);
    }
    // the resting critter goes out as '__rest', so the desktop pet resting alone wears it too
    const by = Object.fromEntries(this.mates.filter((m) => m.skin).map((m) => [m.key, m.skin]));
    const sig = JSON.stringify(by);
    if (sig !== this.lastSkins) {
      this.lastSkins = sig;
      this.onSkins?.(by);
    }
  }

  private spotFor(m: Mate, spot: string): string {
    if (spot === 'desk' || spot === 'sofa' || spot === 'front') {
      const own = `${spot}${m.slot}`;
      return own in this.atlas.layout.spots ? own : `desk${m.slot}`;
    }
    if (SHARED.has(spot) && this.mates.some((o) => o !== m && o.actor.spot === spot)) return `desk${m.slot}`;
    return spot;
  }

  private applyBehavior(m: Mate) {
    const now = Date.now();
    if (now >= m.restUntil) {
      m.restVariant = this.pickRest(m);
      const [lo, hi] = REST_HOLD[this.energy];
      m.restUntil = now + lo + Math.random() * (hi - lo);
    }
    const s = m.session;
    // with no session at all, the one critter in the room just idles (and dozes off when calm)
    const b: Behavior = s ? behaviorFor(s, now, m.restVariant, NAP_AFTER[this.energy]) : restBehavior(m.restVariant, this.energy === 'calm');
    const prev = m.actor.current?.key;
    m.actor.setBehavior({ ...b, spot: b.spot ? this.spotFor(m, b.spot) : '' }, now);
    if (prev !== b.key && b.fx === 'sparkle') this.burst(m);
  }

  /** a new idle activity, different from the last; 'stroll' becomes a random free floor point */
  private pickRest(m: Mate): string {
    const pool = REST_POOL[this.energy].filter((v) => v !== m.restVariant.split(':')[0] || v === 'stroll');
    const v = pool[Math.floor(Math.random() * pool.length)];
    if (v !== 'stroll') return v;
    const floor = Object.keys(this.atlas.layout.nodes).filter((k) => k.startsWith('g'));
    return `stroll:${floor[Math.floor(Math.random() * floor.length)]}`;
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

  /** CSS height of the room's box at the last resize */
  private boxH = 0;
  /** a hash of the last frame put on screen; -1 after a resize, which clears the canvas */
  private shown = -1;

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.fitDpr = dpr;
    // measure the container: the canvas itself carries a pinned CSS size from the last resize
    const rect = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.boxH = rect.height;
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
    const box = this.roomOnly ? this.roomBox() : { w: room.w + 4, h: room.h + 4 };
    const fitIn = (aw: number) => Math.max(1, Math.floor(Math.min(aw / box.w, availH / box.h)));
    // the room always fits whole in the area the side panel or dashboard leaves free
    const fit = fitIn(availW);
    // zooming out never goes below 1, zooming in stops at 4 steps past the fitted size;
    // the floating room always fits its window (the window-mode zoom is kept for later)
    this.zoom = Math.max(1 - fit, Math.min(4, this.zoom));
    this.scale = this.roomOnly ? fit : fit + this.zoom;
    if (this.zoom <= 0) this.pan = { x: 0, y: 0 };
    this.buf.width = Math.ceil(w / this.scale);
    this.buf.height = Math.ceil(h / this.scale);
    this.shown = -1;
    this.draw();
  }

  /**
   * Draw order of a critter among the furniture. Sorting by the screen y of the feet alone puts a
   * critter that stands beside a long piece (e.g. right of a desk) behind it, so it is placed from
   * the floor boxes instead: after every piece it stands in front of (past its right or left front
   * side) and before every piece it stands behind. A piece the critter stands on is ignored, and a
   * seat keeps its own depth.
   */
  private depthOf(a: Actor): number {
    const seat = a.depth();
    if (seat !== a.y + 0.5) return seat;
    const o = this.atlas.layout.wallOrigin;
    if (!o) return seat;
    // the feet back in world units (see tools/art/cottage.py for both cameras)
    let wx: number;
    let wy: number;
    if (this.atlas.layout.camera === 'top') {
      wx = (a.x + 0.5 - o[0]) / 2;
      wy = (a.y + 0.5 - o[1]) / 2;
    } else {
      const u = (a.x + 0.5 - o[0]) / 2;        // x - y
      const v = a.y + 0.5 - o[1];              // x + y
      wx = (u + v) / 2;
      wy = (v - u) / 2;
    }
    let lo = -Infinity;
    let hi = Infinity;
    for (const f of this.atlas.layout.furniture) {
      const b = f.box;
      const r = this.atlas.frames[f.name];
      // only pieces whose picture can overlap the critter's (about 24 x 30 px above its feet) matter
      if (!b || !r || a.x + 12 < r.dx || a.x - 12 > r.dx + r.w || a.y < r.dy || a.y - 30 > r.dy + r.h) continue;
      if (wx >= b[2] || wy >= b[3]) lo = Math.max(lo, f.base);
      else if (wx <= b[0] || wy <= b[1]) hi = Math.min(hi, f.base);
    }
    if (lo === -Infinity) return Math.min(seat, hi - 0.01);
    if (hi === Infinity || lo >= hi) return Math.max(seat, lo + 0.01);
    return Math.min(Math.max(seat, lo + 0.01), hi - 0.01);
  }

  /** the drawn part of the room frame: the art has a clear border, which the room-only window
   * leaves out so a room pushed into a screen corner touches it */
  private opaque: { key: HTMLImageElement; x: number; y: number; w: number; h: number } | null = null;
  roomBox(): { x: number; y: number; w: number; h: number } {
    const room = this.atlas.frames.room;
    if (this.opaque?.key === this.atlas.img) return this.opaque;
    let box = { x: 0, y: 0, w: room.w, h: room.h };
    try {
      const c = document.createElement('canvas');
      c.width = room.w;
      c.height = room.h;
      const g = c.getContext('2d')!;
      g.drawImage(this.atlas.img, room.x, room.y, room.w, room.h, 0, 0, room.w, room.h);
      const a = g.getImageData(0, 0, room.w, room.h).data;
      let [x0, y0, x1, y1] = [room.w, room.h, -1, -1];
      for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (a[(y * room.w + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x1 >= 0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    } catch { /* a canvas that can't be read keeps the whole frame */ }
    this.opaque = { key: this.atlas.img, ...box };
    return box;
  }

  /**
   * CSS width the room needs, in a window of the current height, to be drawn one whole scale step
   * bigger than it would be in `cssW`; null when the height already holds it back
   */
  widthForNextStep(cssW: number): number | null {
    const dpr = window.devicePixelRatio || 1;
    const room = this.atlas.frames.room;
    const box = { w: room.w + 4, h: room.h + 4 };
    // the height from the last resize (the page asks on every render; measuring forced a layout each time)
    const height = this.boxH || (this.canvas.parentElement ?? this.canvas).getBoundingClientRect().height;
    const byH = Math.floor((height - this.insetBottom - this.insetTop) * dpr / box.h);
    const next = Math.max(1, Math.floor((cssW * dpr) / box.w)) + 1;
    return next > byH ? null : Math.ceil((next * box.w) / dpr);
  }

  /** largest whole scale at which the room-only window still fits in w x h CSS px */
  roomOnlyScale(cssW: number, cssH: number): number {
    const dpr = window.devicePixelRatio || 1;
    const room = this.roomBox();
    return Math.max(1, Math.floor(Math.min((cssW * dpr) / room.w, (cssH * dpr) / room.h)));
  }

  /** CSS size of a room-only window that holds the drawn room at `scale` with no clear margin */
  roomOnlySize(scale: number): { w: number; h: number } {
    const dpr = window.devicePixelRatio || 1;
    const room = this.roomBox();
    return { w: Math.ceil((room.w * scale) / dpr), h: Math.ceil((room.h * scale) / dpr) };
  }

  /** zoom one step in (dir 1) or out (-1) around the window centre, so the room stays in the middle */
  zoomBy(dir: number) {
    this.zoom += dir;
    this.resize();
  }

  /** drag the zoomed room by a CSS-pixel delta */
  panBy(dxCss: number, dyCss: number) {
    if (this.zoom <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.pan.x += (dxCss * dpr) / this.scale;
    this.pan.y += (dyCss * dpr) / this.scale;
    this.draw();
  }

  resetZoom() {
    this.zoom = 0;
    this.resize();
  }

  /** session key of the critter under a click (CSS px relative to canvas), if any */
  hitActor(cssX: number, cssY: number): string | null {
    const dpr = window.devicePixelRatio || 1;
    const bx = (cssX * dpr) / this.scale - this.off.x;
    const by = (cssY * dpr) / this.scale - this.off.y;
    for (const m of this.mates) {
      const f = m.actor.feet();
      if (bx > f.x - 12 && bx < f.x + 12 && by > f.y - 28 && by < f.y + 2) return m.key;
    }
    return null;
  }

  private alpha: Uint8ClampedArray | null = null;

  /** name of the topmost furniture piece drawn under this CSS point, if any */
  furnitureAt(cssX: number, cssY: number): string | null {
    const dpr = window.devicePixelRatio || 1;
    const x = Math.floor((cssX * dpr) / this.scale) - this.off.x;
    const y = Math.floor((cssY * dpr) / this.scale) - this.off.y;
    const A = this.atlas;
    if (!this.alpha) {
      const c = document.createElement('canvas');
      c.width = A.img.naturalWidth;
      c.height = A.img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(A.img, 0, 0);
      this.alpha = g.getImageData(0, 0, c.width, c.height).data;
    }
    const W = A.img.naturalWidth;
    for (const f of [...A.layout.furniture].reverse()) {
      const r = A.frames[f.name];
      if (!r || x < r.dx || y < r.dy || x >= r.dx + r.w || y >= r.dy + r.h) continue;
      if (this.alpha[((r.y + y - r.dy) * W + r.x + x - r.dx) * 4 + 3] > 0) return f.name;
    }
    return null;
  }

  /** is there any room (wall, floor, furniture, pet) drawn under this CSS point? */
  hitRoom(cssX: number, cssY: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const bx = Math.floor((cssX * dpr) / this.scale);
    const by = Math.floor((cssY * dpr) / this.scale);
    if (bx < 0 || by < 0 || bx >= this.buf.width || by >= this.buf.height) return false;
    return this.bctx.getImageData(bx, by, 1, 1).data[3] > 0;
  }

  /** CSS-pixel points above each critter's head, for the HTML name tags */
  anchors(): Anchor[] {
    const dpr = window.devicePixelRatio || 1;
    const k = this.scale / dpr;
    return this.mates.filter((m) => m.session).map((m) => {
      // the floor point, not the hop height: tags stay still while a critter bounces at its desk
      const f = { x: m.actor.x, y: m.actor.y };
      const sk = this.skins[m.skin];
      const h = sk ? sk.h - (sk.top ?? 0) : 24;
      // leave room for a thought bubble above the head when there is one
      const gap = this.bubbles && m.actor.current?.bubble && !m.actor.walking ? 13 : 3;
      return { key: m.key, agent: m.session!.agent, x: (this.off.x + f.x) * k, y: (this.off.y + f.y - h - gap) * k, foot: (this.off.y + f.y) * k, half: ((sk?.w ?? 24) / 2) * k };
    });
  }

  /** hands of the wall clock at the scene's time (the face is part of the room art) */
  private clockHands(g: CanvasRenderingContext2D, ox: number, oy: number) {
    const c = this.atlas.layout.clock;
    if (!c) return;
    const d = this.now();
    const min = d.getMinutes() + d.getSeconds() / 60;
    const hand = (turn: number, len: number, col: string) => {
      g.fillStyle = col;
      const a = turn * 2 * Math.PI;
      for (let t = 0; t <= len; t += 0.25) {
        const k = Math.round(t * Math.sin(a));
        const dz = Math.round(t * Math.cos(a));
        g.fillRect(ox + c.x + k, oy + Math.floor(c.y + k / 2 - dz), 1, 1);
      }
    };
    hand(((d.getHours() % 12) + min / 60) / 12, c.r - 3, '#2a2230');
    hand(min / 60, c.r - 1.5, '#4a3a5c');
  }

  /** pixel ellipse on the floor (or the seat) under a pet; waiting and errors blink */
  private ring(g: CanvasRenderingContext2D, m: Mate, ox: number, oy: number) {
    if (!m.session) return;
    const tone = stateTone(m.session);
    // "done" only rings while the pet celebrates, not for the whole time the tag says 완료
    if (tone === 'ok' && m.actor.current?.key !== 'done') return;
    const col = RING[tone];
    if (!col || ((tone === 'wait' || tone === 'bad') && Math.floor(this.tickN / 6) % 2)) return;
    const f = m.actor.feet();
    const cx = ox + Math.round(f.x);
    const cy = oy + Math.round(f.y);
    g.fillStyle = col;
    // two pixels thick; the floor is drawn 2:1, so the ring is twice as wide as deep
    for (const [rx, ry] of [[11, 5], [10, 4]]) {
      for (let x = -rx; x <= rx; x++) {
        const h = Math.round(ry * Math.sqrt(1 - (x / rx) ** 2));
        g.fillRect(cx + x, cy - h, 1, 1);
        g.fillRect(cx + x, cy + h, 1, 1);
      }
      for (let y = -ry; y <= ry; y++) {
        const w = Math.round(rx * Math.sqrt(1 - (y / ry) ** 2));
        g.fillRect(cx - w, cy + y, 1, 1);
        g.fillRect(cx + w, cy + y, 1, 1);
      }
    }
  }

  private burst(m: Mate) {
    for (let i = 0; i < 6; i++) m.sparks.push({ x: (Math.random() - 0.5) * 26, y: -10 - Math.random() * 18, t: 0 });
  }

  private frame() {
    // ⌘+/⌘− or a move to a display with another pixel density changes the pixel ratio without
    // always sending a resize event: re-fit then, so the room stays centred and crisp
    if ((window.devicePixelRatio || 1) !== this.fitDpr) return this.resize();
    this.tickN++;
    if (this.tickN % 6 === 0) this.mates.forEach((m) => this.applyBehavior(m));
    const now = Date.now();
    this.mates.forEach((m) => m.actor.tick(now));
    this.draw();
  }

  draw() {
    const g = this.bctx;
    const W = this.buf.width;
    const H = this.buf.height;
    const A = this.atlas;
    const L = A.layout;
    g.imageSmoothingEnabled = false;
    // everything is drawn on a clear buffer first; the sky and the backdrop go *behind* it at the end,
    // so they only show through the windows' clear glass and around the room
    g.clearRect(0, 0, W, H);

    // centre the room in the free area
    const dpr = window.devicePixelRatio || 1;
    const freeW = W - (this.insetRight * dpr) / this.scale;
    const top = (this.insetTop * dpr) / this.scale;
    const freeH = H - top - (this.insetBottom * dpr) / this.scale;
    const room = A.frames.room;
    // keep the room's centre inside the free area however far it is dragged
    this.pan.x = Math.max(-freeW / 2 - room.w / 2 + 24, Math.min(freeW / 2 + room.w / 2 - 24, this.pan.x));
    this.pan.y = Math.max(-freeH / 2 - room.h / 2 + 24, Math.min(freeH / 2 + room.h / 2 - 24, this.pan.y));
    const pan = this.roomOnly ? { x: 0, y: 0 } : this.pan;
    // room-only: the drawn part of the room is centred, so its clear border falls outside the window
    const box = this.roomOnly ? this.roomBox() : { x: 0, y: 0, w: room.w, h: room.h };
    const ox = Math.floor((freeW - box.w) / 2 + pan.x) - box.x - room.dx;
    const oy = Math.floor(top + (freeH - box.h) / 2 + pan.y) - box.y - room.dy;
    this.off = { x: ox, y: oy };

    A.placed(g, 'room', ox, oy);
    this.clockHands(g, ox, oy);

    // y-sorted: furniture and critters by the screen y of their front edge / feet
    const atDesk: Record<number, Behavior | null> = {};
    for (const m of this.mates) atDesk[m.slot] = m.session ? m.actor.current : null;
    const rigUser = this.mates.find((m) => m.actor.current?.rig && m.actor.current.rig !== 'idle')?.actor.current ?? null;
    const items: { y: number; draw: () => void }[] = L.furniture.map((f) => ({
      y: f.base,
      draw: () => {
        A.placed(g, f.name, ox, oy);
        const d = /^desk(\d+)$/.exec(f.name);
        if (d) A.placed(g, this.screenFrame(Number(d[1]), atDesk[Number(d[1])] ?? null), ox, oy);
        if (f.name === 'rig') A.placed(g, rigUser ? this.rigFrame(rigUser) : this.restingRig(), ox, oy);
      },
    }));
    for (const m of this.mates) {
      items.push({ y: this.depthOf(m.actor), draw: () => { this.ring(g, m, ox, oy); m.actor.draw(g, A, ox, oy, this.skins[m.skin]); } });
    }
    items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());

    // tea steam
    const st = Math.floor(this.tickN / 4) % 2;
    A.draw(g, st ? 'steam0' : 'steam1', ox + L.steam[0] - 1, oy + L.steam[1] - 6 - (Math.floor(this.tickN / 4) % 3));

    // per-critter fx + bubbles
    for (const m of this.mates) {
      const b = m.actor.current;
      const feet = m.actor.feet();
      const skin = this.skins[m.skin];
      const hx = ox + feet.x;
      const hy = oy + feet.y - (skin ? skin.h - (skin.top ?? 0) : 24);
      if (b?.fx === 'sweat' && Math.floor(this.tickN / 3) % 2 === 0) A.draw(g, 'sweat', hx + 6, hy + 4);
      if (b?.fx === 'sparkle' && this.tickN % 18 === 0) this.burst(m);
      m.sparks = m.sparks.filter((s) => s.t < 14);
      for (const s of m.sparks) {
        s.t++;
        s.y -= 0.4;
        A.draw(g, s.t % 4 < 2 ? 'sparkle0' : 'sparkle1', hx + s.x - 2, hy + s.y + 10);
      }
      if (this.bubbles && b?.bubble && !m.actor.walking) {
        const bub = Math.round(Math.sin((this.tickN + m.slot * 5) / 3) * 1);
        A.draw(g, `bubble_${b.bubble}`, hx + 5, hy - 11 + bub);
      }
    }

    // lighting: multiply over the drawn pixels only (the sky has its own day/night colours)
    const light = this.theme === 'auto' ? lightAt(this.now())
      : this.theme === 'night' ? { color: 'rgb(70,72,140)', alpha: 0.55 }
      : this.theme === 'sunset' ? { color: 'rgb(255,200,180)', alpha: 0.18 } : null;
    if (light && light.alpha > 0.01) {
      const t = this.tmp;
      if (t.width !== W || t.height !== H) { t.width = W; t.height = H; }
      const tc = t.getContext('2d')!;
      tc.globalCompositeOperation = 'copy';
      tc.drawImage(this.buf, 0, 0);
      tc.globalCompositeOperation = 'multiply';
      tc.globalAlpha = light.alpha;
      tc.fillStyle = light.color;
      tc.fillRect(0, 0, W, H);
      tc.globalAlpha = 1;
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(this.buf, 0, 0);
      g.globalCompositeOperation = 'copy';
      g.drawImage(t, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }

    // sky behind the windows (repainted once a second at most), then the backdrop behind everything
    g.globalCompositeOperation = 'destination-over';
    this.paintSkyCache();
    g.drawImage(this.sky, ox + this.span[0], oy + this.span[1]);
    if (!this.roomOnly && this.backdrop) {
      g.fillStyle = this.backdrop;
      g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';

    // blit, only when the picture changed: most ticks of a quiet room repeat the last frame, and
    // repainting the window's full-size canvas for nothing kept the GPU and the window server busy
    // only the room and a margin for bubbles and sparks can change; the rest is the flat backdrop
    const rx = Math.max(0, ox + room.dx - 24);
    const ry = Math.max(0, oy + room.dy - 48);
    const px = new Uint32Array(g.getImageData(rx, ry, Math.max(1, Math.min(W - rx, room.w + 48)), Math.max(1, Math.min(H - ry, room.h + 72))).data.buffer);
    // where the room sits counts too (a drag moves the same picture)
    let hash = Math.imul(2166136261 ^ (rx * 65536 + ry), 16777619);
    for (let i = 0; i < px.length; i++) hash = Math.imul(hash ^ px[i], 16777619);
    hash >>>= 0;
    if (hash === this.shown) return;
    this.shown = hash;
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.buf, 0, 0, W * this.scale, H * this.scale);
  }

  private paintSkyCache() {
    const wb = this.atlas.layout.windows ?? [];
    if (!wb.length) return;
    const d = this.now();
    const key = `${Math.floor(d.getTime() / 1000)}`;
    if (key === this.skyKey) return;
    this.skyKey = key;
    this.sky.getContext('2d')!.putImageData(paintSky(wb, this.span, d, this.tickN, this.atlas.layout.windowWalls, this.atlas.layout.wallOrigin, this.atlas.layout.camera), 0, 0);
  }

  private screenFrame(desk: number, b: Behavior | null): string {
    const s = b?.screen ?? 'off';
    const t = Math.floor((this.tickN + desk * 3) / 3);
    const name = (() => {
      switch (s) {
        case 'code': return `code${t % 4}`;
        case 'read': return `read${Math.floor(t / 4) % 2}`;
        case 'err': return t % 2 ? 'err' : 'off';
        case 'ok': return 'ok';
        case 'wait': return t % 4 < 2 ? 'wait' : 'idle';
        case 'idle': return 'idle';
        default: return 'off';
      }
    })();
    return `scr${desk}_${name}`;
  }

  /** with nobody at the bench the rig keeps the newest test result of the last 10 minutes, steady */
  private restingRig(): string {
    let t: { ok: boolean | null; at: number } | null = null;
    for (const m of this.mates) {
      const x = m.session?.lastTest;
      if (x && x.ok !== null && Date.now() - x.at < 600_000 && (!t || x.at > t.at)) t = x;
    }
    return t ? (t.ok ? 'rig_pass' : 'rig_fail') : 'rig_idle';
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
