// "Activity flow": one lane per session over the last half hour, coloured by what it was doing
// (working, waiting for the user), with marks where something failed. Built from the same hook
// timeline the activity log reads, so it costs nothing extra.
import type { Snapshot, TimelineEntry } from '../types';
import { sessionNames, stateTone } from '../labels';
import { AgentMark } from './icons';
import { userTodo } from './Overview';
import { L } from '../i18n';
import { segments } from '../lanes';
import { useRef, useState } from 'react';

const MIN = 60_000;

export function Lanes({ sessions, timelines, now, minutes = 30, selected, onSelect }: { sessions: Snapshot[]; timelines: Record<string, TimelineEntry[]>; now: number; minutes?: number; selected: string | null; onSelect: (k: string) => void }) {
  // how far the window is moved back from now; dragging or a sideways wheel moves it, up to the oldest entry
  const [back, setBack] = useState(0);
  const span = minutes * MIN;
  const oldest = Object.values(timelines).reduce((m, tl) => tl.reduce((n, e) => Math.min(n, e.at), m), now);
  const maxBack = Math.max(0, now - span - oldest);
  const shift = Math.min(back, maxBack);
  const end = now - shift;
  const from = end - span;
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; back: number; moved: boolean } | null>(null);
  const perPx = () => span / Math.max(1, box.current?.querySelector('.lane .lane-track')?.clientWidth ?? 1);
  const move = (b: number) => setBack(Math.max(0, Math.min(maxBack, b)));
  const names = sessionNames(sessions);
  const rank = (s: Snapshot) => (userTodo(s, now) ? 0 : stateTone(s) === 'work' ? 1 : 2);
  const rows = [...sessions].filter((s) => s.connection !== 'ended').sort((a, b) => rank(a) - rank(b));
  if (!rows.length) return <p className="muted pad">{L('세션이 일하기 시작하면 여기에 흐름이 그려져요.', 'Lanes appear here once sessions start working.')}</p>;
  const x = (t: number) => `${(((t - from) / span) * 100).toFixed(2)}%`;
  const ticks = [minutes, (minutes * 2) / 3, minutes / 3].map((m) => Math.round(m));
  const ago = (m: number) => Math.round(m + shift / MIN);
  return (
    <div
      ref={box}
      className={`lanes ${shift > 0 ? 'past' : ''} ${maxBack > 0 ? 'pannable' : ''}`}
      onWheel={(e) => { const d = e.deltaX || (e.shiftKey ? e.deltaY : 0); if (d) move(shift - d * perPx()); }}
      onPointerDown={(e) => { if (maxBack > 0 && e.button === 0) drag.current = { x: e.clientX, back: shift, moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.abs(e.clientX - d.x) < 4) return;
        if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
        move(d.back + (e.clientX - d.x) * perPx());
      }}
      onPointerUp={() => { setTimeout(() => { drag.current = null; }); }}
      onPointerCancel={() => { drag.current = null; }}
      onClickCapture={(e) => { if (drag.current?.moved) e.stopPropagation(); }}
    >
      <div className="lane-axis">
        {shift > 0 ? <button className="lane-now" onClick={() => setBack(0)}>{L('지금으로', 'Back to now')}</button> : <span />}
        <div className="lane-track">
          {ticks.map((m) => <em key={m} style={{ left: x(end - m * MIN) }}>{L(`${ago(m)}분 전`, `${ago(m)}m ago`)}</em>)}
          <em className="now" style={{ left: '100%' }}>{shift > 0 ? L(`${ago(0)}분 전`, `${ago(0)}m ago`) : L('지금', 'now')}</em>
        </div>
      </div>
      {rows.map((s) => {
        const tl = timelines[s.key] ?? [];
        const fails = tl.filter((e) => e.at > from && e.at <= end && (e.kind === 'tool_fail' || e.kind === 'turn_failed' || (e.kind === 'test' && e.ok === false)));
        return (
          <button key={s.key} className={`lane ${selected === s.key ? 'on' : ''}`} onClick={() => onSelect(s.key)}>
            <span className="lane-name"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={12} /><b>{names[s.key]}</b></span>
            <span className="lane-track">
              {ticks.map((m) => <i key={m} className="grid" style={{ left: x(end - m * MIN) }} />)}
              {segments(tl, from, end, s.waiting ? undefined : s.lastEventAt).map((g) => <i key={g.from} className={`seg ${g.phase}`} style={{ left: x(g.from), width: `calc(${x(g.to)} - ${x(g.from)})` }} />)}
              {fails.map((e) => <i key={e.id} className="fail" style={{ left: x(e.at) }} title={e.detail ?? ''} />)}
            </span>
          </button>
        );
      })}
      <div className="lane-legend"><span><i className="seg work" />{L('작업', 'Working')}</span><span><i className="seg wait" />{L('내 차례', 'Your turn')}</span><span><i className="fail" />{L('실패', 'Failed')}</span></div>
    </div>
  );
}
