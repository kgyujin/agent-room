import { describe, expect, it } from 'vitest';
import type { Snapshot, TimelineEntry } from './types';
import { addToDay, dayMarkdown, daySummary, estCost, reportName, startOfDay } from './report';

const now = new Date(2026, 10, 6, 15, 0).getTime();
const s = { key: 'claude:a', agent: 'claude', isDemo: false, project: 'web' } as unknown as Snapshot;
const e = (kind: string, at: number, ok: boolean | null = null) => ({ id: at, at, kind, ok }) as TimelineEntry;

describe('daySummary', () => {
  it('counts only today', () => {
    const tl = [e('turn_complete', now - 86_400_000), e('turn_complete', now - 1000), e('test', now - 500, true), e('test', now - 400, false), e('approval', now - 300)];
    const edit = (at: number, f: string) => ({ id: at, at, kind: 'tool', activity: 'edit', detail: f, ok: null }) as TimelineEntry;
    const day = addToDay(null, s, [...tl, edit(now - 86_400_000 + 1, 'old.ts'), edit(now - 200, 'a.ts'), edit(now - 100, 'a.ts')], now);
    const d = daySummary(day, { days: [{ day: 1, claude: 2000, codex: 0 }], recentClaude: 0, recentCodex: 0, streakLongest: 0, streakCurrent: 0 }, now);
    expect(d.from).toBe(startOfDay(now));
    expect([d.turns, d.testsOk, d.testsFail, d.asks, d.files]).toEqual([1, 1, 1, 1, 1]);
    expect(dayMarkdown(d, String, null)).toContain('### web (Claude Code)');
    expect(reportName(d.from)).toBe('agent-room-2026-11-06.md');
  });
  it('keeps the day when timelines drop entries or a session ends', () => {
    let day = addToDay(null, s, [e('turn_complete', now - 1000)], now);
    // the same entry again (a refetched timeline) and a newer one
    day = addToDay(day, s, [e('turn_complete', now - 1000), e('turn_complete', now - 10)], now);
    // an older entry arriving late (the first timeline fetch) still counts
    day = addToDay(day, s, [e('turn_complete', now - 5000)], now);
    expect(daySummary(day, null, now).turns).toBe(3);
    // next day starts over
    expect(daySummary(addToDay(day, s, [], now + 86_400_000), null, now + 86_400_000).turns).toBe(0);
  });
  it('estimates cost only with prices', () => {
    expect(estCost({ claude: 2e6, codex: 1e6 }, undefined)).toBeNull();
    expect(estCost({ claude: 2e6, codex: 1e6 }, { claude: 3, codex: 1 })).toBe(7);
  });
});
