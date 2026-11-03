// Maps a session snapshot to what the character does in the room.
// Pure rules over the event-derived state; no randomness decides *what* is shown,
// only which cosmetic variant of an idle/rest animation plays.
import type { Snapshot } from '../types';
import type { Facing } from './assets';

/** [frame, ticks (1 tick = 1/12 s), optional facing override] */
export type Step = [string, number, Facing?];

export interface Behavior {
  key: string;
  spot: string;
  seq: Step[];
  bubble?: 'bang' | 'ask' | 'check' | 'cross' | 'dots' | 'note' | 'heart' | 'gear' | 'book' | 'zzz';
  fx?: 'sparkle' | 'sweat' | null;
  screen: 'off' | 'idle' | 'code' | 'read' | 'err' | 'ok' | 'wait';
  rig: 'idle' | 'run' | 'pass' | 'fail';
  /** may interrupt walking / dwell immediately */
  urgent?: boolean;
  /** freeze animation (state uncertain) */
  frozen?: boolean;
}

const TYPE: Step[] = [['type_0', 2], ['type_1', 2], ['type_2', 2], ['type_1', 2], ['type_0', 2], ['type_2', 2], ['type_1', 2], ['type_0', 2], ['sitb_idle', 10], ['type_2', 2], ['type_1', 2], ['type_0', 2], ['type_2', 2]];
const THINK: Step[] = [['sitb_idle', 30], ['type_0', 3], ['sitb_idle', 26], ['type_1', 2], ['type_2', 2], ['sitb_idle', 20]];
const BOARD: Step[] = [['browse_0', 10], ['stand_b0', 14], ['browse_1', 10], ['stand_b0', 20], ['reach_0', 8], ['stand_b0', 12]];
const SHELF: Step[] = [['reach_0', 6], ['reach_1', 8], ['reach_0', 6], ['stand_b0', 6], ['read_0', 18, 'dl'], ['read_1', 12, 'dl'], ['read_0', 18, 'dl'], ['blink_f', 2, 'dl'], ['read_1', 14, 'dl'], ['stand_b0', 8], ['reach_1', 8]];
const OPERATE: Step[] = [['op_0', 5], ['op_1', 5], ['op_0', 5], ['op_1', 8], ['blink_f', 2], ['op_0', 6], ['op_1', 6]];
const WAVE: Step[] = [['wave_0', 4], ['wave_1', 4], ['wave_0', 4], ['wave_1', 4], ['wave_0', 4], ['wave_1', 4], ['stand_f0', 24], ['blink_f', 2], ['stand_f1', 24], ['look_l', 10], ['look_r', 10]];
const CHEER: Step[] = [['stretch_0', 6], ['stretch_1', 6], ['cheer_0', 3], ['cheer_1', 3], ['cheer_0', 3], ['cheer_1', 3], ['stretch_1', 8], ['stand_f0', 10]];
const PANIC: Step[] = [['panic_0', 3], ['panic_1', 3], ['panic_0', 3], ['panic_1', 3], ['look_l', 8], ['look_r', 8], ['panic_0', 6], ['stand_f0', 10]];
const STAND: Step[] = [['stand_f0', 30], ['blink_f', 2], ['stand_f1', 30], ['look_l', 12], ['stand_f0', 20], ['look_r', 12]];

const REST: Record<string, { spot: string; seq: Step[]; bubble?: Behavior['bubble'] }> = {
  tea: { spot: 'sofa', seq: [['sit_tea0', 36], ['sit_tea1', 14], ['sit_tea0', 30], ['sit_blink', 2], ['sit_tea0', 26], ['sit_tea1', 12]] },
  read: { spot: 'sofa', seq: [['sit_read0', 40], ['sit_read1', 6], ['sit_read0', 36], ['sit_blink', 2], ['sit_read0', 30], ['sit_read1', 6]] },
  window: { spot: 'window', seq: [['stand_b0', 40], ['stand_b0', 30], ['look_l', 14, 'dl'], ['stand_f0', 20, 'dl'], ['blink_f', 2, 'dl']] },
  plant: { spot: 'plantcorner', seq: [['stand_b0', 30], ['browse_0', 8], ['stand_b0', 20], ['browse_1', 8]] },
  wander: { spot: 'front', seq: STAND },
};
export const REST_KEYS = Object.keys(REST);

export function restBehavior(variant: string, napping: boolean): Behavior {
  if (napping) return { key: 'nap', spot: 'sofa', seq: [['sit_sleep', 60]], bubble: 'zzz', screen: 'off', rig: 'idle' };
  const r = REST[variant] ?? REST.tea;
  return { key: 'rest:' + variant, spot: r.spot, seq: r.seq, bubble: r.bubble, screen: 'off', rig: 'idle' };
}

/** Behavior for a live session. `now` is used only for "just finished" celebration timing. */
export function behaviorFor(s: Snapshot, now: number, restVariant: string): Behavior {
  const base = { screen: 'idle' as Behavior['screen'], rig: 'idle' as Behavior['rig'] };
  if (s.connection === 'lost' || s.connection === 'ended' || s.state === 'disconnected') {
    return { ...restBehavior(restVariant, true), key: 'gone' };
  }
  if (s.connection === 'stale') {
    // events stopped while "working": keep the last pose, show uncertainty instead of acting
    return { key: 'stale', spot: '', seq: [['__hold', 60]], bubble: 'dots', screen: 'idle', rig: 'idle', frozen: true };
  }
  switch (s.state) {
    case 'idle': {
      const napping = now - s.lastEventAt > 10 * 60_000;
      return restBehavior(restVariant, napping);
    }
    case 'starting':
      return { ...base, key: 'starting', spot: 'desk', seq: THINK, bubble: 'dots', screen: 'idle' };
    case 'planning':
      if (s.activity === 'plan') return { ...base, key: 'board', spot: 'board', seq: BOARD, bubble: 'note' };
      return { ...base, key: 'think', spot: 'desk', seq: THINK, bubble: 'dots' };
    case 'reading':
      if (s.activity === 'web') return { ...base, key: 'web', spot: 'desk', seq: THINK, screen: 'read' };
      return { ...base, key: 'shelf', spot: 'shelf', seq: SHELF, bubble: s.activity === 'search' ? 'book' : undefined };
    case 'editing':
      return { ...base, key: 'type', spot: 'desk', seq: TYPE, screen: 'code' };
    case 'running':
      return { ...base, key: 'operate', spot: 'bench', seq: OPERATE, bubble: 'gear', rig: 'run' };
    case 'testing': {
      if (s.tool === null && s.lastTest) {
        if (s.lastTest.ok === true) return { ...base, key: 'test-pass', spot: 'bench', seq: CHEER, bubble: 'check', fx: 'sparkle', rig: 'pass' };
        return { ...base, key: 'test-done', spot: 'bench', seq: STAND, rig: 'idle' };
      }
      return { ...base, key: 'test', spot: 'bench', seq: OPERATE, rig: 'run' };
    }
    case 'waiting':
      return { ...base, key: 'wait:' + (s.waiting?.kind ?? 'input'), spot: 'front', seq: WAVE, bubble: s.waiting?.kind === 'approval' ? 'bang' : 'ask', screen: 'wait', urgent: true };
    case 'completed': {
      const since = now - (s.turnEndedAt ?? s.lastEventAt);
      if (since < 7000) return { ...base, key: 'done', spot: '', seq: CHEER, bubble: 'check', fx: 'sparkle', screen: 'ok', urgent: true };
      return restBehavior(restVariant, now - s.lastEventAt > 10 * 60_000);
    }
    case 'error': {
      const testFail = s.lastTest?.ok === false && s.error && s.lastTest.at >= s.error.at;
      if (testFail) return { ...base, key: 'test-fail', spot: 'bench', seq: PANIC, bubble: 'cross', fx: 'sweat', rig: 'fail', urgent: true };
      return { ...base, key: 'error', spot: '', seq: PANIC, bubble: 'cross', fx: 'sweat', screen: 'err', urgent: true };
    }
  }
}
