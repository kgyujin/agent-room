import type { Snapshot } from '../types';
import { AGENT_NAME, stateTone } from '../labels';

export function SessionTabs({ sessions, selected, pinned, onSelect }: { sessions: Snapshot[]; selected: string | null; pinned: string | null; onSelect: (k: string | null) => void }) {
  if (sessions.length < 2 && !pinned) return null;
  return (
    <div className="tabs" role="tablist">
      <button className={`tab ${pinned === null ? 'on' : ''}`} onClick={() => onSelect(null)} title="가장 주의가 필요한 세션을 자동으로 보여줘요">
        자동
      </button>
      {sessions.map((s) => (
        <button key={s.key} role="tab" className={`tab ${selected === s.key && pinned ? 'on' : ''}`} onClick={() => onSelect(s.key)} title={`${AGENT_NAME[s.agent]} · ${s.cwd ?? ''}`}>
          <span className={`dot tone-${stateTone(s)}`} />
          {s.isDemo ? 'DEMO' : AGENT_NAME[s.agent].split(' ')[0]}
          <small>{s.project ?? s.sessionId.slice(0, 6)}</small>
        </button>
      ))}
    </div>
  );
}
