// Phases of a session over time for the activity lanes (pure, so it can be tested without the app).
import type { TimelineEntry } from './types';

type Phase = 'work' | 'wait' | 'idle' | 'end';
export interface Seg { from: number; to: number; phase: Phase }

const PHASE: Record<string, Phase> = {
  turn_start: 'work', tool: 'work', tool_fail: 'work', plan: 'work', subagent: 'work', test: 'work', compacting: 'work',
  approval: 'wait', input: 'wait',
  turn_complete: 'idle', turn_failed: 'idle', interrupted: 'idle', session_start: 'idle',
  session_end: 'end',
};

/**
 * The phases of one session between `from` and `to`, merged where nothing changed.
 * Answering an approval or a question leaves no timeline entry, so a wait that is still open in the
 * log but over in the session (`answeredAt`: the session's last event, when it is no longer waiting)
 * ends there and the rest counts as work.
 */
export function segments(entries: TimelineEntry[], from: number, to: number, answeredAt?: number): Seg[] {
  const ev = [...entries].sort((a, b) => a.at - b.at);
  let phase: Phase = 'idle';
  const out: Seg[] = [];
  let at = from;
  for (const e of ev) {
    const next = PHASE[e.kind];
    if (!next) continue;
    if (e.at <= from) { phase = next; continue; }
    if (e.at >= to) break;
    if (next !== phase) {
      if (e.at > at) out.push({ from: at, to: e.at, phase });
      phase = next;
      at = e.at;
    }
  }
  if (phase === 'wait' && answeredAt !== undefined && answeredAt > at && answeredAt < to) {
    out.push({ from: at, to: answeredAt, phase });
    phase = 'work';
    at = answeredAt;
  }
  if (to > at) out.push({ from: at, to, phase });
  return out.filter((s) => s.phase === 'work' || s.phase === 'wait');
}
