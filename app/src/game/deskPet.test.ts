import { describe, expect, it } from 'vitest';
import { DeskWorld, deskPlan, type DeskPlan } from './deskPet';
import type { Snapshot } from '../types';

const T = 1_000_000;
const snap = (p: Partial<Snapshot>): Snapshot => ({
  key: 'claude:a', agent: 'claude', sessionId: 'a', isDemo: false, project: 'p', cwd: null, model: null, permissionMode: null,
  state: 'idle', activity: null, tool: null, detail: null, startedAt: T - 60_000, startExact: true, turnStartedAt: null, turnEndedAt: null,
  lastEventAt: T - 1000, connection: 'live', waiting: null, error: null, lastTest: null, plan: [], limits: null,
  completedTurns: 0, toolCount: 0, filesEdited: [], subagents: 0, ...p,
});
const roam: DeskPlan = { act: 'roam', bubble: null, laptop: false };
const run = (w: DeskWorld, seconds: number, pointer: number | null = null, from = T) => {
  for (let i = 0; i < seconds * 12; i++) w.step(1 / 12, from + (i * 1000) / 12, pointer);
};
/** a world whose random numbers are fixed, so strolls are repeatable */
const world = () => {
  let n = 0;
  const w = new DeskWorld(() => [0.3, 0.8, 0.1, 0.6][n++ % 4]);
  w.width = 1000;
  w.height = 240;
  return w;
};

describe('deskPlan follows the session state', () => {
  it('maps each state to what the pet does', () => {
    expect(deskPlan(snap({ state: 'editing' }), T, 60_000)).toEqual({ act: 'work', bubble: null, laptop: true });
    expect(deskPlan(snap({ state: 'reading', activity: 'search' }), T, 60_000).bubble).toBe('book');
    expect(deskPlan(snap({ state: 'running' }), T, 60_000).bubble).toBe('gear');
    expect(deskPlan(snap({ state: 'waiting', waiting: { kind: 'approval', tool: 'Bash', message: null, since: T } }), T, 60_000)).toEqual({ act: 'call', bubble: 'bang', laptop: false });
    expect(deskPlan(snap({ state: 'waiting', waiting: { kind: 'input', tool: null, message: null, since: T } }), T, 60_000).bubble).toBe('ask');
    expect(deskPlan(snap({ state: 'error', error: { message: 'x', tool: null, at: T, fatal: false } }), T, 60_000).act).toBe('panic');
    expect(deskPlan(snap({ state: 'running', connection: 'stale' }), T, 60_000).act).toBe('stale');
  });
  it('celebrates a finished turn briefly, then roams, then naps', () => {
    expect(deskPlan(snap({ state: 'completed', turnEndedAt: T - 2000 }), T, 60_000).act).toBe('cheer');
    expect(deskPlan(snap({ state: 'completed', turnEndedAt: T - 20_000, lastEventAt: T - 20_000 }), T, 60_000).act).toBe('roam');
    expect(deskPlan(snap({ state: 'idle', lastEventAt: T - 120_000 }), T, 60_000).act).toBe('nap');
    expect(deskPlan(snap({ state: 'idle', lastEventAt: T - 120_000 }), T, Infinity).act).toBe('roam');
  });
});

describe('DeskWorld', () => {
  it('drops a new pet in and lands it on the floor', () => {
    const w = world();
    w.sync([['a', roam]]);
    expect(w.pets.get('a')!.lift).toBeGreaterThan(0);
    run(w, 1);
    expect(w.pets.get('a')!.lift).toBe(0);
  });

  it('puts a second pet in the widest free gap, and removes pets whose session is gone', () => {
    const w = world();
    w.sync([['a', roam]]);
    w.sync([['a', roam], ['b', roam]]);
    const [a, b] = [w.pets.get('a')!.x, w.pets.get('b')!.x];
    expect(Math.abs(a - b)).toBeGreaterThan(200);
    w.sync([['b', roam]]);
    expect([...w.pets.keys()]).toEqual(['b']);
  });

  it('an idle pet strolls but never leaves the screen', () => {
    const w = world();
    w.energy = 'lively';
    w.sync([['a', roam]]);
    const xs = new Set<number>();
    for (let s = 0; s < 120; s++) {
      run(w, 1, null, T + s * 1000);
      const p = w.pets.get('a')!;
      xs.add(Math.round(p.x));
      expect(p.x).toBeGreaterThanOrEqual(w.half);
      expect(p.x).toBeLessThanOrEqual(w.width - w.half);
    }
    expect(xs.size).toBeGreaterThan(3);
  });

  it('a working pet stays where it is', () => {
    const w = world();
    w.sync([['a', { act: 'work', bubble: null, laptop: true }]]);
    run(w, 1);
    const x = w.pets.get('a')!.x;
    run(w, 30, 100);
    expect(w.pets.get('a')!.x).toBe(x);
  });

  it('a pet that needs the user runs over to the pointer and stops beside it', () => {
    const w = world();
    w.sync([['a', { act: 'call', bubble: 'bang', laptop: false }]]);
    run(w, 1);
    run(w, 20, 150);
    const p = w.pets.get('a')!;
    expect(Math.abs(p.x - 150)).toBeLessThanOrEqual(w.half * 2 + 1);
    expect(p.dir).toBe(-1); // came from the right, so it faces the pointer
    expect(w.walking(p)).toBe(false);
  });

  it('a pet under the pointer holds still so it can be clicked', () => {
    const w = world();
    w.energy = 'lively';
    w.sync([['a', roam]]);
    run(w, 1);
    w.hovered = 'a';
    const x = w.pets.get('a')!.x;
    run(w, 30, x);
    expect(w.pets.get('a')!.x).toBe(x);
    w.hovered = null;
    run(w, 30, null, T + 60_000);
    expect(w.pets.get('a')!.x).not.toBe(x);
  });

  it('a held pet hangs where it is held and falls back down when dropped', () => {
    const w = world();
    w.sync([['a', roam]]);
    run(w, 1);
    w.hold('a', 500, 120);
    run(w, 2);
    expect(w.pets.get('a')!).toMatchObject({ x: 500, lift: 120 });
    w.drop('a');
    run(w, 1);
    expect(w.pets.get('a')!.lift).toBe(0);
  });

  it('a pet held off the edge is kept on screen', () => {
    const w = world();
    w.sync([['a', roam]]);
    w.hold('a', -50, 999);
    const p = w.pets.get('a')!;
    expect(p.x).toBeGreaterThanOrEqual(w.half);
    expect(p.lift).toBeLessThanOrEqual(w.height);
  });
});
