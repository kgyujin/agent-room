// Canvas 2D renderer for the office. Draws at native pixel resolution into a small
// buffer and scales it up by an integer factor (crisp pixels, very cheap).
// Runs at 12 fps when focused, 6 fps when unfocused, and stops when hidden.
// One critter per session (up to one per desk), each with its own desk and screen.
import type { Snapshot } from '../types';
import { Actor } from './actor';
import type { Atlas } from './assets';
import { behaviorFor, REST_KEYS, restBehavior, type Behavior } from './behaviors';
import type { Skin } from './skin';

export type Theme = 'day' | 'sunset' | 'night';

// around the room: a soft deep-green garden tone so the cream stone pops
const VOID = '#2f4a3e';

interface Spark { x: number; y: number; t: number }

/** what a shared spot falls back to when another critter is already there */
const SHARED = new Set(['shelf', 'board', 'bench', 'window', 'plantcorner', 'center']);

interface Mate {
  key: string;
  agent: string;
  slot: number;
  actor: Actor;
  session: Snapshot | null;
  skin: string;
  sparks: Spark[];
  restVariant: string;
  restSince: number;
}

export interface Anchor { key: string; agent: string; x: number; y: number }

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buf = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private scale = 3;
  private theme: Theme = 'day';
  private mates: Mate[] = [];
  private tickN = 0;
  private timer: number | null = null;
  private fps = 12;
  insetRight = 0;
  insetBottom = 0;
  insetTop = 0;
  /** room-only mode: transparent around the room */
  roomOnly = false;
  /** every loaded skin by name ('builtin/shiba', user PNG names) */
  skins: Record<string, Skin> = {};
  /** preferred skin order per agent ('claude', 'codex', 'generic'); first unused one wins */
  prefs: Record<string, string[]> = {};
  /** offset of the scene inside the buffer (for hit testing) */
  private off = { x: 0, y: 0 };
  private desks: number;

  constructor(private canvas: HTMLCanvasElement, private atlas: Atlas) {
    this.ctx = canvas.getContext('2d')!;
    this.bctx = this.buf.getContext('2d')!;
    this.desks = atlas.layout.desks;
    this.resize();
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
        const slot = [...Array(this.desks).keys()].find((i) => !used.has(i)) ?? 0;
        const agent = s ? (s.agent === 'demo' ? 'generic' : s.agent) : 'generic';
        const actor = new Actor(agent, this.atlas.layout, `sofa${slot}`);
        m = { key: k, agent, slot, actor, session: s, skin: '', sparks: [], restVariant: REST_KEYS[slot % REST_KEYS.length], restSince: Date.now() };
        this.mates.push(m);
      }
      m.session = s;
    }
    this.assignSkins();
    for (const m of this.mates) this.applyBehavior(m);
  }

  /** each critter keeps its skin; new ones take the first preferred skin nobody else wears.
   *  reset: re-pick every skin (the user changed the character settings) */
  assignSkins(reset = false) {
    const taken = new Set<string>();
    for (const m of this.mates) {
      if (reset) m.skin = '';
      const pref = this.prefs[m.agent] ?? [];
      if (!m.skin || !this.skins[m.skin] || taken.has(m.skin)) {
        m.skin = pref.find((n) => this.skins[n] && !taken.has(n)) ?? pref.find((n) => this.skins[n]) ?? '';
      }
      taken.add(m.skin);
    }
  }

  private spotFor(m: Mate, spot: string): string {
    if (spot === 'desk' || spot === 'sofa' || spot === 'front') return `${spot}${m.slot}`;
    if (SHARED.has(spot) && this.mates.some((o) => o !== m && o.actor.spot === spot)) return `desk${m.slot}`;
    return spot;
  }

  private applyBehavior(m: Mate) {
    const now = Date.now();
    if (now - m.restSince > 30_000 + Math.random() * 20_000) {
      m.restVariant = REST_KEYS[Math.floor(Math.random() * REST_KEYS.length)];
      m.restSince = now;
    }
    const s = m.session;
    const b: Behavior = s ? behaviorFor(s, now, m.restVariant) : restBehavior(m.restVariant, true);
    const prev = m.actor.current?.key;
    m.actor.setBehavior({ ...b, spot: b.spot ? this.spotFor(m, b.spot) : '' }, now);
    if (prev !== b.key && b.fx === 'sparkle') this.burst(m);
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
    const margin = this.roomOnly ? 2 : 8;
    this.scale = Math.max(1, Math.floor(Math.min(availW / (room.w + margin), availH / (room.h + margin))));
    this.buf.width = Math.ceil(w / this.scale);
    this.buf.height = Math.ceil(h / this.scale);
    this.draw();
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

  /** CSS-pixel points above each critter's head, for the HTML name tags */
  anchors(): Anchor[] {
    const dpr = window.devicePixelRatio || 1;
    const k = this.scale / dpr;
    return this.mates.filter((m) => m.session).map((m) => {
      const f = m.actor.feet();
      const h = this.skins[m.skin]?.h ?? 24;
      return { key: m.key, agent: m.session!.agent, x: (this.off.x + f.x) * k, y: (this.off.y + f.y - h - 13) * k };
    });
  }

  private burst(m: Mate) {
    for (let i = 0; i < 6; i++) m.sparks.push({ x: (Math.random() - 0.5) * 26, y: -10 - Math.random() * 18, t: 0 });
  }

  private frame() {
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
    if (this.roomOnly) {
      g.clearRect(0, 0, W, H);
    } else {
      g.fillStyle = VOID;
      g.fillRect(0, 0, W, H);
    }

    // centre the room in the free area
    const dpr = window.devicePixelRatio || 1;
    const freeW = W - (this.insetRight * dpr) / this.scale;
    const top = (this.insetTop * dpr) / this.scale;
    const freeH = H - top - (this.insetBottom * dpr) / this.scale;
    const room = A.frames.room;
    const ox = Math.floor((freeW - room.w) / 2) - room.dx;
    const oy = Math.floor(top + (freeH - room.h) / 2) - room.dy;
    this.off = { x: ox, y: oy };

    A.placed(g, 'room', ox, oy);

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
        if (f.name === 'rig') A.placed(g, this.rigFrame(rigUser), ox, oy);
      },
    }));
    for (const m of this.mates) {
      items.push({ y: m.actor.y + 0.5, draw: () => m.actor.draw(g, A, ox, oy, this.skins[m.skin]) });
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
      const hy = oy + feet.y - (skin ? skin.h : 24);
      if (b?.fx === 'sweat' && Math.floor(this.tickN / 3) % 2 === 0) A.draw(g, 'sweat', hx + 6, hy + 4);
      if (b?.fx === 'sparkle' && this.tickN % 18 === 0) this.burst(m);
      m.sparks = m.sparks.filter((s) => s.t < 14);
      for (const s of m.sparks) {
        s.t++;
        s.y -= 0.4;
        A.draw(g, s.t % 4 < 2 ? 'sparkle0' : 'sparkle1', hx + s.x - 2, hy + s.y + 10);
      }
      if (b?.bubble && !m.actor.walking) {
        const bub = Math.round(Math.sin((this.tickN + m.slot * 5) / 3) * 1);
        A.draw(g, `bubble_${b.bubble}`, hx + 5, hy - 10 + bub);
      }
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

  private rigFrame(b: Behavior | null): string {
    switch (b?.rig) {
      case 'run': return `rig_run${Math.floor(this.tickN / 3) % 3}`;
      case 'pass': return 'rig_pass';
      case 'fail': return Math.floor(this.tickN / 4) % 2 ? 'rig_fail' : 'rig_idle';
      default: return 'rig_idle';
    }
  }
}
