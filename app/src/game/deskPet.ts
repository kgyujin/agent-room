// Pets out on the desktop: one per live session, walking along the bottom of the screen.
// What a pet does comes only from its session's event-derived state (no timers decide it);
// randomness only picks where an idle pet strolls to and for how long it stands still.
import type { Snapshot } from '../types';

export type DeskBubble = 'bang' | 'ask' | 'check' | 'cross' | 'dots' | 'note' | 'gear' | 'book' | 'zzz' | 'heart' | 'pencil';
/** roam: stroll around · work: stay put on the job · call: come to the pointer and hop · cheer / panic: in place */
export type DeskAct = 'roam' | 'work' | 'call' | 'cheer' | 'panic' | 'nap' | 'stale';
/** `table`: the pet works at a little low table, writing on a sheet of paper */
export interface DeskPlan { act: DeskAct; bubble: DeskBubble | null; table: boolean }

/** what a session's pet does on the desktop, from the session's state alone */
export function deskPlan(s: Snapshot, now: number, napAfter: number): DeskPlan {
  const plan = (act: DeskAct, bubble: DeskBubble | null = null, table = false): DeskPlan => ({ act, bubble, table });
  if (s.connection === 'stale') return plan('stale', 'dots');
  const idle = () => (now - s.lastEventAt > napAfter ? plan('nap', 'zzz') : plan('roam'));
  switch (s.state) {
    case 'disconnected':
      return plan('nap', 'zzz');
    case 'idle':
      return idle();
    case 'starting':
      return plan('work', 'dots');
    case 'planning':
      return plan('work', s.activity === 'plan' ? 'note' : 'dots');
    case 'reading':
      return plan('work', 'book');
    case 'editing':
      // writing code: scribbling with a pencil at its little table
      return plan('work', 'pencil', true);
    case 'running':
      return plan('work', 'gear');
    case 'testing':
      if (s.tool === null && s.lastTest?.ok === true) return plan('cheer', 'check');
      return plan('work', 'gear');
    case 'waiting':
      return plan('call', s.waiting?.kind === 'approval' ? 'bang' : 'ask');
    case 'completed':
      return now - (s.turnEndedAt ?? s.lastEventAt) < 7000 ? plan('cheer', 'check') : idle();
    case 'error':
      return plan('panic', 'cross');
  }
}

export interface DeskPet {
  key: string;
  /** feet centre, CSS px from the strip's left edge */
  x: number;
  /** CSS px above the floor (dropped in, or held by the pointer) */
  lift: number;
  vy: number;
  /** 1 = facing right */
  dir: 1 | -1;
  plan: DeskPlan;
  /** x an idle or calling pet walks to */
  target: number | null;
  /** an idle pet stands still until then */
  restUntil: number;
  held: boolean;
  /** animation ticks (12 per second) */
  tick: number;
  /** a heart over the head until then (after a click) */
  heartUntil: number;
}

export type Energy = 'calm' | 'normal' | 'lively';
/** how long an idle pet stands between strolls [min, max] ms, and how far one stroll goes [min, max] art px */
const REST: Record<Energy, [number, number]> = { calm: [14_000, 30_000], normal: [5_000, 14_000], lively: [2_000, 6_000] };
const STROLL: [number, number] = [30, 140];
/** walking speed in art px per second (calling pets hurry) */
const SPEED = 18;
const GRAVITY = 2400; // CSS px / s²

export class DeskWorld {
  pets = new Map<string, DeskPet>();
  /** strip size in CSS px, and CSS px per art px */
  width = 800;
  height = 240;
  scale = 2;
  energy: Energy = 'normal';
  /** half a pet's width in CSS px, so pets stay fully on screen */
  half = 26;
  /** the pet under the pointer holds still, so it can be clicked */
  hovered: string | null = null;

  constructor(private rand: () => number = Math.random) {}

  private lo() { return this.half + 4; }
  private hi() { return Math.max(this.lo(), this.width - this.half - 4); }
  private clampX(x: number) { return Math.min(this.hi(), Math.max(this.lo(), x)); }

  /** a free spot: the widest gap between pets already out */
  private freeX(): number {
    const xs = [this.lo(), ...[...this.pets.values()].map((p) => p.x).sort((a, b) => a - b), this.hi()];
    let best = 0;
    let at = (this.lo() + this.hi()) / 2;
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      if (gap > best) { best = gap; at = (xs[i] + xs[i - 1]) / 2; }
    }
    return this.pets.size ? at : this.lo() + (this.hi() - this.lo()) * (0.55 + this.rand() * 0.35);
  }

  /** follow the sessions ([key, plan] each): new ones drop in, finished ones leave */
  sync(plans: [string, DeskPlan][]) {
    const keep = new Set(plans.map(([k]) => k));
    for (const k of [...this.pets.keys()]) if (!keep.has(k)) this.pets.delete(k);
    for (const [key, plan] of plans) {
      let p = this.pets.get(key);
      if (!p) {
        p = { key, x: this.freeX(), lift: this.height * 0.6, vy: 0, dir: -1, plan, target: null, restUntil: 0, held: false, tick: 0, heartUntil: 0 };
        this.pets.set(key, p);
      }
      if (p.plan.act !== plan.act) {
        p.target = null;
        p.restUntil = 0;
        p.tick = 0;
      }
      p.plan = plan;
    }
    for (const p of this.pets.values()) p.x = this.clampX(p.x);
  }

  /** one animation step; `pointer` is the pointer's x in the strip (null when it is elsewhere) */
  step(dt: number, now: number, pointer: number | null) {
    for (const p of this.pets.values()) {
      p.tick++;
      if (p.held) continue;
      if (p.key === this.hovered && p.lift === 0) continue;
      if (p.lift > 0) {
        p.vy += GRAVITY * dt;
        p.lift = Math.max(0, p.lift - p.vy * dt);
        if (p.lift === 0) p.vy = 0;
        continue;
      }
      const { act } = p.plan;
      if (act === 'call') {
        // come over to where the user is (or stay put when the pointer is on another screen)
        p.target = pointer === null ? p.target : this.clampX(pointer + (p.x < pointer ? -this.half * 2 : this.half * 2));
      } else if (act === 'roam') {
        if (p.target === null && now >= p.restUntil) {
          const [a, b] = STROLL;
          const d = (a + this.rand() * (b - a)) * this.scale * (this.rand() < 0.5 ? -1 : 1);
          // the other way when that side is too short or would end on top of another pet
          const bad = (t: number) => Math.abs(t - p.x) < a * this.scale * 0.5 || [...this.pets.values()].some((o) => o !== p && Math.abs(o.x - t) < this.half * 1.6);
          let t = this.clampX(p.x + d);
          if (bad(t)) t = this.clampX(p.x - d);
          if (bad(t)) t = p.x;
          p.target = t;
        }
      } else {
        p.target = null;
      }
      if (p.target !== null) {
        const v = SPEED * this.scale * (act === 'call' ? 4 : 1) * dt;
        const d = p.target - p.x;
        if (Math.abs(d) <= v) {
          p.x = p.target;
          p.target = null;
          if (act === 'roam') {
            const [a, b] = REST[this.energy];
            p.restUntil = now + a + this.rand() * (b - a);
          }
        } else {
          p.x += Math.sign(d) * v;
          p.dir = d > 0 ? 1 : -1;
        }
      } else if (pointer !== null && act !== 'nap' && Math.abs(pointer - p.x) < 260 && Math.abs(pointer - p.x) > 4) {
        // a pet standing still looks at the pointer nearby
        p.dir = pointer > p.x ? 1 : -1;
      }
    }
  }

  walking(p: DeskPet) {
    return p.target !== null && p.lift === 0 && !p.held && p.key !== this.hovered;
  }

  /** pick a pet up (it stays where the pointer holds it) */
  hold(key: string, x: number, lift: number) {
    const p = this.pets.get(key);
    if (!p) return;
    p.held = true;
    p.target = null;
    p.x = this.clampX(x);
    p.lift = Math.max(0, Math.min(this.height, lift));
    p.vy = 0;
  }

  /** let go: it falls back to the floor and then carries on */
  drop(key: string) {
    const p = this.pets.get(key);
    if (!p) return;
    p.held = false;
    p.vy = 0;
  }
}

/**
 * How the pet moves this tick (critters have no limbs; the work shows in how they move):
 * [x offset, hop height, which still/walk frame] in art px.
 */
export function deskMotion(p: DeskPet, walking: boolean): [number, number, 'still' | 'walk0' | 'walk1'] {
  const k = p.tick;
  if (p.held) return [k % 6 < 3 ? -1 : 1, 0, 'still']; // wriggles while held
  if (walking) return [0, [0, 1, 2, 1][Math.floor(k / 2) % 4], Math.floor(k / 3) % 2 ? 'walk1' : 'walk0'];
  switch (p.plan.act) {
    case 'work': return [0, p.plan.table ? Math.floor(k / 2) % 2 : Math.floor(k / 12) % 2, 'still']; // scribble-scribble / slow nod
    case 'call': return [0, [0, 2, 4, 2, 0, 0][Math.floor(k / 2) % 6], 'still'];                      // hop for attention
    case 'cheer': return [0, [0, 3, 5, 3][Math.floor(k / 2) % 4], 'still'];
    case 'panic': return [k % 2 ? 1 : -1, 0, 'still'];
    case 'nap': return [0, Math.floor(k / 20) % 2, 'still'];                                         // slow breathing
    default: return [0, 0, 'still'];
  }
}

// A little low table (like the room's wood) with a sheet of paper a working pet writes on.
// One colour per pixel: K outline, W wood top, D wood front, L legs, P paper; the pencil lines on the
// paper grow as the pet writes, and a fresh sheet starts when it is full.
const TABLE = [
  '.KKKKKKKKKKKK.',
  'KWWWWWWWWWWWWK',
  'KWPPPPPPPPPPWK',
  'KWPPPPPPPPPPWK',
  'KWPPPPPPPPPPWK',
  'KWPPPPPPPPPPWK',
  'KWPPPPPPPPPPWK',
  'KWWWWWWWWWWWWK',
  'KDDDDDDDDDDDDK',
  '.KLK......KLK.',
  '.KKK......KKK.',
];
const TABLE_INK: Record<string, string> = { K: '#2a2230', W: '#ebc18d', D: '#c99a66', L: '#8a5a40', P: '#fff8ec' };
const PENCIL_INK = '#9a8a96';
export const TABLE_W = TABLE[0].length;
export const TABLE_H = TABLE.length;

export function drawTable(g: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  TABLE.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = TABLE_INK[row[i]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x + i, y + j, 1, 1);
    }
  });
  // two lines of writing on the 10x5 sheet, a blank row around each, written out one after the other
  const t = Math.floor(tick / 2) % 20;
  g.fillStyle = PENCIL_INK;
  [7, 5].forEach((len, j) => {
    const n = Math.max(0, Math.min(len, t - j * 8));
    if (n) g.fillRect(x + 3, y + 3 + j * 2, n, 1);
  });
}
