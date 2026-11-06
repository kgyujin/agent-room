import { describe, expect, it } from 'vitest';
import type { Snapshot } from './types';
import { doingLabel, fmtAgo, fmtTokens, setTokenUnit, fmtDuration, fmtUntil, paceNote, sessionNames, shortName, stateLabel, windowLabel } from './labels';

const snap = (key: string, project: string, cwd: string) => ({ key, project, cwd }) as unknown as Snapshot;

describe('formatting', () => {
  it('durations and ages', () => {
    expect(fmtDuration(65_000)).toBe('1:05');
    expect(fmtDuration(3_725_000)).toBe('1:02:05');
    expect(fmtAgo(2_000)).toBe('방금');
    expect(fmtAgo(90_000)).toBe('1분 전');
    expect(fmtAgo(2 * 3600_000)).toBe('2시간 전');
  });
  it('limit windows and resets', () => {
    expect(windowLabel(300)).toBe('5시간');
    expect(windowLabel(10080)).toBe('주간');
    expect(fmtUntil(40 * 60_000)).toBe('40분 후');
    expect(fmtUntil(190 * 60_000)).toBe('3시간 10분 후');
    expect(fmtUntil(53 * 3600_000)).toBe('2일 5시간 후');
  });
});

describe('screen work', () => {
  it('reads as using the screen, not as a command', () => {
    const s = { connection: 'live', state: 'running', activity: 'desktop', tool: 'Bash', detail: 'agent-desktop click' } as unknown as Snapshot;
    expect(stateLabel(s)).toBe('화면 사용 중');
    expect(doingLabel(s)).toBe('화면 사용 중 · agent-desktop cli…');
  });
});

describe('paceNote', () => {
  const span = 300 * 60_000;
  it('warns when the current rate runs out before the reset', () => {
    const start = 1_000_000;
    const at = start + span / 2;
    expect(paceNote({ minutes: 300, usedPct: 80, resetsAt: start + span }, at)).toMatch(/소진$/);
  });
  it('stays quiet when the rate lasts, or too early to tell', () => {
    const start = 1_000_000;
    expect(paceNote({ minutes: 300, usedPct: 20, resetsAt: start + span }, start + span / 2)).toBeNull();
    expect(paceNote({ minutes: 300, usedPct: 50, resetsAt: start + span }, start + span * 0.05)).toBeNull();
  });
});

describe('sessionNames', () => {
  it('keeps unique names and tells twins apart', () => {
    const n = sessionNames([snap('c:aaaa1111', 'web', '/a/one/web'), snap('c:bbbb2222', 'web', '/a/two/web'), snap('c:cccc3333', 'api', '/a/api')]);
    expect(n['c:cccc3333']).toBe('api');
    expect(n['c:aaaa1111']).toBe('web · one');
    expect(n['c:bbbb2222']).toBe('web · two');
  });
  it('numbers twins in the same folder by start', () => {
    const n = sessionNames([{ ...snap('c:x-0002', 'web', '/a/web'), startedAt: 20 }, { ...snap('c:x-0001', 'web', '/a/web'), startedAt: 10 }] as Snapshot[]);
    expect([n['c:x-0001'], n['c:x-0002']]).toEqual(['web · 1', 'web · 2']);
  });
  it('uses the chat name when the session has one', () => {
    const n = sessionNames([{ ...snap('c:a', 'web', '/a/web'), chatTitle: '로그인 버그 고쳐줘' }, snap('c:b', 'web', '/a/web'), { ...snap('c:c', 'web', '/a/web'), title: 'Desktop title', chatTitle: 'x' }] as Snapshot[]);
    expect([n['c:a'], n['c:b'], n['c:c']]).toEqual(['로그인 버그 고쳐줘', 'web', 'Desktop title']);
  });
});

describe('shortName', () => {
  it('keeps short names and tells shared prefixes apart', () => {
    expect(shortName('web', 8)).toBe('web');
    expect(shortName('agent-room-api', 8)).toBe('agen…api');
    expect(shortName('agent-room-ui', 8)).not.toBe(shortName('agent-room-api', 8));
    expect([...shortName('한글프로젝트이름입니다', 8)].length).toBe(8);
  });
});

describe('fmtTokens', () => {
  it('uses K/M/B by default and 만/억 when set', () => {
    setTokenUnit('si');
    expect(fmtTokens(12_400)).toBe('12.4K');
    expect(fmtTokens(340_000_000)).toBe('340M');
    setTokenUnit('ko');
    expect(fmtTokens(12_400)).toBe('1.24만');
    expect(fmtTokens(340_000_000)).toBe('3.4억');
    expect(fmtTokens(9_800)).toBe('9,800');
    setTokenUnit('si');
  });
});
