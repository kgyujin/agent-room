import { describe, expect, it } from 'vitest';
import { segments } from './lanes';
import type { TimelineEntry } from './types';

const e = (id: number, at: number, kind: string): TimelineEntry => ({ id, at, kind, activity: null, tool: null, detail: null, ok: null });

describe('activity lane segments', () => {
  it('splits work and waits, ignoring idle time', () => {
    const tl = [e(1, 10, 'turn_start'), e(2, 20, 'approval'), e(3, 30, 'tool'), e(4, 40, 'turn_complete')];
    expect(segments(tl, 0, 100)).toEqual([
      { from: 10, to: 20, phase: 'work' },
      { from: 20, to: 30, phase: 'wait' },
      { from: 30, to: 40, phase: 'work' },
    ]);
  });
  it('carries the phase from before the window and sorts entries', () => {
    expect(segments([e(2, 70, 'turn_complete'), e(1, 5, 'turn_start')], 50, 100)).toEqual([{ from: 50, to: 70, phase: 'work' }]);
  });
  it('ends an answered wait at the session\'s last event', () => {
    const tl = [e(1, 10, 'turn_start'), e(2, 20, 'approval')];
    expect(segments(tl, 0, 100)).toEqual([{ from: 10, to: 20, phase: 'work' }, { from: 20, to: 100, phase: 'wait' }]);
    expect(segments(tl, 0, 100, 35)).toEqual([{ from: 10, to: 20, phase: 'work' }, { from: 20, to: 35, phase: 'wait' }, { from: 35, to: 100, phase: 'work' }]);
  });
  it('stops at the last event of a session that is no longer working', () => {
    const tl = [e(1, 10, 'turn_start'), e(2, 20, 'tool')];
    expect(segments(tl, 0, 100, 30, 30)).toEqual([{ from: 10, to: 30, phase: 'work' }]);
    // went quiet before the window: nothing is drawn
    expect(segments(tl, 50, 100, 30, 30)).toEqual([]);
  });
  it('is empty without entries', () => {
    expect(segments([], 0, 100)).toEqual([]);
  });
});
