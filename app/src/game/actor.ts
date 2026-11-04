// One character in the room: walks between spots on a waypoint graph and plays
// the current behavior's frame sequence. A future multi-agent mode = several Actors.
import type { Atlas, Facing, Layout } from './assets';
import type { Behavior } from './behaviors';
import type { Skin } from './skin';

const SPEED = 36; // world units (= scene px) per second
const MIN_DWELL_MS = 1600; // stay at a spot at least this long before a non-urgent move
const SIT_APPROACH: Record<string, string> = { desk: 'deskA', sofa: 'sofaB' };

export class Actor {
  x: number;
  y: number;
  z = 0;
  lr: 'l' | 'r' = 'r';
  spot = 'center';
  private path: [number, number][] = [];
  private behavior: Behavior | null = null;
  private pending: Behavior | null = null;
  private arrivedAt = 0;
  private stepIdx = 0;
  private stepTick = 0;
  private walkTick = 0;
  frame = 'stand_f0';
  flip = false;
  walking = false;

  constructor(public agent: string, private layout: Layout, start = 'center') {
    const n = layout.nodes[start] ?? layout.nodes.center;
    this.x = n[0];
    this.y = n[1];
    this.spot = start;
  }

  get current() {
    return this.behavior;
  }

  setBehavior(b: Behavior, now: number) {
    if (this.behavior?.key === b.key) {
      this.behavior = b; // same behavior: refresh bubble/screen without restarting
      this.pending = null;
      return;
    }
    const dwelling = !this.walking && now - this.arrivedAt < MIN_DWELL_MS;
    if (this.behavior && dwelling && !b.urgent) {
      this.pending = b;
      return;
    }
    this.start(b, now);
  }

  private start(b: Behavior, now: number) {
    this.pending = null;
    this.behavior = b;
    this.stepIdx = 0;
    this.stepTick = 0;
    if (b.frozen) return; // keep pose & position
    let target = b.spot;
    if (target === '') {
      // act in place, but get off a chair/sofa first
      target = SIT_APPROACH[this.spot] ?? '';
    }
    if (target && target !== this.spot) {
      this.path = this.route(target);
      this.spot = target;
      this.walking = this.path.length > 0;
      this.z = 0;
    }
    if (!this.walking) this.arrive(now);
  }

  private arrive(now: number) {
    this.walking = false;
    this.arrivedAt = now;
    const sp = this.layout.spots[this.spot];
    this.z = sp?.sit ? sp.z ?? 0 : 0;
    if (sp) this.lr = sp.face.endsWith('l') ? 'l' : 'r';
  }

  private nearestNode(): string {
    let best = 'center';
    let bd = Infinity;
    for (const [k, [nx, ny]] of Object.entries(this.layout.nodes)) {
      const d = (nx - this.x) ** 2 + (ny - this.y) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /** BFS over the waypoint graph from the nearest node to the target spot's node. */
  private route(target: string): [number, number][] {
    const adj: Record<string, string[]> = {};
    for (const [a, b] of this.layout.edges) {
      (adj[a] ??= []).push(b);
      (adj[b] ??= []).push(a);
    }
    const start = this.nearestNode();
    const prev: Record<string, string | null> = { [start]: null };
    const q = [start];
    while (q.length) {
      const c = q.shift()!;
      if (c === target) break;
      for (const n of adj[c] ?? []) if (!(n in prev)) { prev[n] = c; q.push(n); }
    }
    if (!(target in prev)) {
      const t = this.layout.nodes[target];
      return t ? [t] : [];
    }
    const nodes: string[] = [];
    for (let c: string | null = target; c; c = prev[c]) nodes.unshift(c);
    const pts = nodes.map((n) => this.layout.nodes[n]);
    // skip the first node if we're basically on it
    if (pts.length > 1 && Math.hypot(pts[0][0] - this.x, pts[0][1] - this.y) < 6) pts.shift();
    return pts;
  }

  /** Advance one animation tick (1/12 s). */
  tick(now: number) {
    if (this.walking) {
      const dt = 1 / 12;
      let budget = SPEED * dt;
      while (budget > 0 && this.path.length) {
        const [tx, ty] = this.path[0];
        const dx = tx - this.x;
        const dy = ty - this.y;
        const d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.01) this.lr = dx > 0 ? 'r' : 'l';
        this.walkView = dy >= -Math.abs(dx) ? 'f' : 'b';
        if (d <= budget) {
          this.x = tx;
          this.y = ty;
          budget -= d;
          this.path.shift();
        } else {
          this.x += (dx / d) * budget;
          this.y += (dy / d) * budget;
          budget = 0;
        }
      }
      this.walkTick++;
      this.frame = `walk_${this.walkView}${Math.floor(this.walkTick / 2) % 4}`;
      this.flip = this.lr === 'l';
      if (!this.path.length) this.arrive(now);
      return;
    }
    if (this.pending && now - this.arrivedAt >= MIN_DWELL_MS) {
      this.start(this.pending, now);
      if (this.walking) return;
    }
    const b = this.behavior;
    if (!b) return;
    if (b.frozen) return;
    const step = b.seq[this.stepIdx % b.seq.length];
    const [frame, ticks, face] = step;
    this.frame = frame;
    const lr = face ? (face.endsWith('l') ? 'l' : 'r') : this.lr;
    this.flip = lr === 'l';
    this.stepTick++;
    if (this.stepTick >= ticks) {
      this.stepTick = 0;
      this.stepIdx++;
    }
  }

  private walkView: 'f' | 'b' = 'f';

  facing(): Facing {
    return ((this.frame.startsWith('walk_b') || BACK.some((p) => this.frame.startsWith(p)) ? 'u' : 'd') + this.lr) as Facing;
  }

  draw(ctx: CanvasRenderingContext2D, atlas: Atlas, ox: number, oy: number, skin?: Skin) {
    const L = atlas.layout;
    const sx = ox + this.x;
    const sy = oy + this.y - this.z;
    if (this.z === 0) atlas.draw(ctx, 'shadow', sx - 4, sy - 1);
    if (skin) {
      // hop while walking, 1px bob on each behavior step; source faces left.
      // Built-in critters also have back views and walk frames.
      const n = Number(this.frame.slice(-1)) || 0;
      const lift = this.walking ? [0, 1, 2, 1][n % 4] : this.stepIdx % 2;
      ctx.save();
      if (this.lr === 'r') {
        ctx.translate(Math.round(sx) * 2, 0);
        ctx.scale(-1, 1);
      }
      const back = this.facing().startsWith('u');
      const still = (back && skin.back) || skin.canvas;
      const img = (this.walking && (back ? skin.walkB : skin.walkF)?.[n % 2]) || still;
      ctx.drawImage(img, Math.round(sx) - (skin.w >> 1), Math.round(sy) - skin.h + 1 - lift);
      ctx.restore();
      return { x: sx, y: sy };
    }
    const name = `ch_${this.agent}_${this.frame}`;
    atlas.draw(ctx, atlas.has(name) ? name : `ch_${this.agent}_stand_f0`, sx - L.char.ax, sy - L.char.ay, this.flip);
    return { x: sx, y: sy };
  }

  /** screen position of the feet (scene coords, before offset) */
  feet() {
    return { x: this.x, y: this.y - this.z };
  }
}

const BACK = ['type_', 'sitb_', 'reach_', 'browse_', 'stand_b'];
