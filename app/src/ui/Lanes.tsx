// "Activity flow": one lane per session over the last half hour, coloured by what it was doing
// (working, waiting for the user), with marks where something failed. Built from the same hook
// timeline the activity log reads, so it costs nothing extra.
import type { Snapshot, TimelineEntry } from '../types';
import { sessionNames, stateTone } from '../labels';
import { AgentMark } from './icons';
import { userTodo } from './Overview';
import { L } from '../i18n';

type Phase = 'work' | 'wait' | 'idle' | 'end';
export interface Seg { from: number; to: number; phase: Phase }

const PHASE: Record<string, Phase> = {
  turn_start: 'work', tool: 'work', tool_fail: 'work', plan: 'work', subagent: 'work', test: 'work', compacting: 'work',
  approval: 'wait', input: 'wait',
  turn_complete: 'idle', turn_failed: 'idle', interrupted: 'idle', session_start: 'idle',
  session_end: 'end',
};

/** the phases of one session between `from` and `to`, merged where nothing changed */
export function segments(entries: TimelineEntry[], from: number, to: number): Seg[] {
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
  if (to > at) out.push({ from: at, to, phase });
  return out.filter((s) => s.phase === 'work' || s.phase === 'wait');
}

const MIN = 60_000;

export function Lanes({ sessions, timelines, now, minutes = 30, selected, onSelect }: { sessions: Snapshot[]; timelines: Record<string, TimelineEntry[]>; now: number; minutes?: number; selected: string | null; onSelect: (k: string) => void }) {
  const from = now - minutes * MIN;
  const names = sessionNames(sessions);
  const rank = (s: Snapshot) => (userTodo(s, now) ? 0 : stateTone(s) === 'work' ? 1 : 2);
  const rows = [...sessions].filter((s) => s.connection !== 'ended').sort((a, b) => rank(a) - rank(b));
  if (!rows.length) return <p className="muted pad">{L('세션이 일하기 시작하면 여기에 흐름이 그려져요.', 'Lanes appear here once sessions start working.')}</p>;
  const x = (t: number) => `${(((t - from) / (now - from)) * 100).toFixed(2)}%`;
  const ticks = [minutes, (minutes * 2) / 3, minutes / 3].map((m) => Math.round(m));
  return (
    <div className="lanes">
      <div className="lane-axis">
        <span />
        <div className="lane-track">
          {ticks.map((m) => <em key={m} style={{ left: x(now - m * MIN) }}>{L(`${m}분 전`, `${m}m ago`)}</em>)}
          <em className="now" style={{ left: '100%' }}>{L('지금', 'now')}</em>
        </div>
      </div>
      {rows.map((s) => {
        const tl = timelines[s.key] ?? [];
        const fails = tl.filter((e) => e.at > from && (e.kind === 'tool_fail' || e.kind === 'turn_failed' || (e.kind === 'test' && e.ok === false)));
        return (
          <button key={s.key} className={`lane ${selected === s.key ? 'on' : ''}`} onClick={() => onSelect(s.key)}>
            <span className="lane-name"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={12} /><b>{names[s.key]}</b></span>
            <span className="lane-track">
              {ticks.map((m) => <i key={m} className="grid" style={{ left: x(now - m * MIN) }} />)}
              {segments(tl, from, now).map((g) => <i key={g.from} className={`seg ${g.phase}`} style={{ left: x(g.from), width: `calc(${x(g.to)} - ${x(g.from)})` }} />)}
              {fails.map((e) => <i key={e.id} className="fail" style={{ left: x(e.at) }} title={e.detail ?? ''} />)}
            </span>
          </button>
        );
      })}
      <div className="lane-legend"><span><i className="seg work" />{L('작업', 'Working')}</span><span><i className="seg wait" />{L('내 차례', 'Your turn')}</span><span><i className="fail" />{L('실패', 'Failed')}</span></div>
    </div>
  );
}
