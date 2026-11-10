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
 * `until`: for a session that is no longer working (no news, gone, ended, or resting without a closing
 * entry), its last real event; nothing is drawn after it, so a silent session doesn't read as working.
 */
export function segments(entries: TimelineEntry[], from: number, to: number, answeredAt?: number, until?: number): Seg[] {
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
  const stop = until === undefined ? to : Math.min(to, until);
  if (phase === 'wait' && answeredAt !== undefined && answeredAt > at && answeredAt < stop) {
    out.push({ from: at, to: answeredAt, phase });
    phase = 'work';
    at = answeredAt;
  }
  if (stop > at) out.push({ from: at, to: stop, phase });
  return out.filter((s) => s.phase === 'work' || s.phase === 'wait');
}
