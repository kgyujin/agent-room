import type { Snapshot } from '../types';
import { AGENT_NAME, stateTone } from '../labels';
import { isActive, userTodo } from './Overview';
import { AgentMark } from './icons';
import { L } from '../i18n';

export function SessionTabs({ sessions, selected, pinned, onSelect }: { sessions: Snapshot[]; selected: string | null; pinned: string | null; onSelect: (k: string | null) => void }) {
  if (!sessions.length) return null;
  return (
    // a plain mouse wheel only scrolls up and down; turn it sideways so tabs past the edge can be reached
    <div className="tabs" role="tablist" onWheel={(e) => { if (!e.deltaX && e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
      <button className={`tab ${pinned === null ? 'on' : ''}`} onClick={() => onSelect(null)} title={L('가장 주의가 필요한 세션을 자동으로 보여줘요', 'Shows the session that needs you most')}>
        {L('자동', 'Auto')}
      </button>
      {sessions.map((s) => (
        <button key={s.key} role="tab" className={`tab ${selected === s.key && pinned ? 'on' : ''}`} onClick={(e) => { onSelect(s.key); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }} title={`${AGENT_NAME[s.agent]} · ${s.cwd ?? ''}`}>
          <AgentMark agent={s.isDemo ? 'demo' : s.agent} />
          <span>{s.project ?? s.sessionId.slice(0, 6)}</span>
          <span className={`dot tone-${stateTone(s)}`} />
        </button>
      ))}
    </div>
  );
}

/**
 * How many agents need the user, are working, or just finished, in three pills at the top left.
 * A pill selects the first session in its group (the user's turn pulses until it is handled).
 */
export function StatusPills({ sessions, now, onSelect }: { sessions: Snapshot[]; now: number; onSelect: (k: string) => void }) {
  const live = sessions.filter((s) => s.connection !== 'ended' && s.connection !== 'lost');
  if (!live.length) return null;
  const todo = live.filter((s) => userTodo(s, now));
  const work = live.filter((s) => isActive(s) && !userTodo(s, now));
  const done = live.filter((s) => !isActive(s) && s.state === 'completed');
  const pills = [
    { id: 'todo', label: L('내 차례', 'Your turn'), list: todo },
    { id: 'work', label: L('작업 중', 'Working'), list: work },
    { id: 'done', label: L('완료', 'Done'), list: done },
  ];
  return (
    <div className="pills">
      {pills.map((p) => (
        <button key={p.id} className={`pill p-${p.id} ${p.list.length ? '' : 'zero'}`} disabled={!p.list.length} onClick={() => p.list[0] && onSelect(p.list[0].key)}
          aria-label={`${p.label} ${p.list.length}`} title={p.list.map((s) => s.project ?? L('프로젝트', 'project')).join(', ') || p.label}>
          <i /><span className="pl">{p.label}</span><b>{p.list.length}</b>
        </button>
      ))}
    </div>
  );
}
