// Dynamic-island style pill at the top centre of the screen. Collapsed it shows who is
// working (left of the notch) and what needs the user (right of the notch); hovering or
// clicking opens the list. The window is resized from Rust so it stays centred.
import { useEffect, useRef, useState } from 'react';
import { backend } from '../bridge';
import { fmtDuration, stateLabel, stateTone } from '../labels';
import { AgentMark } from '../ui/icons';
import { progressOf } from '../ui/Hud';
import { isActive, userTodo } from '../ui/Overview';
import { useLive } from './useLive';

const COLLAPSED: [number, number] = [340, 34];
const ROW = 40;

export function Island() {
  const { list, now } = useLive();
  const [open, setOpen] = useState(false);
  const leave = useRef(0);
  const todos = list.filter((s) => userTodo(s, now));
  const working = list.filter((s) => isActive(s) && !userTodo(s, now));
  const done = list.filter((s) => s.state === 'completed');

  useEffect(() => {
    const [w, h] = open ? [420, 44 + Math.max(1, Math.min(list.length, 8)) * ROW + 12] : COLLAPSED;
    void backend.islandLayout(w, h);
  }, [open, list.length]);

  const enter = () => { clearTimeout(leave.current); setOpen(true); };
  const exit = () => { leave.current = window.setTimeout(() => setOpen(false), 450); };

  return (
    <div className={`island ${open ? 'open' : ''} ${todos.length ? 'alert' : ''}`} onMouseEnter={enter} onMouseLeave={exit} onClick={() => setOpen(true)}>
      <div className="is-bar">
        <div className="is-left">
          {(todos.length ? todos : working.length ? working : list).slice(0, 3).map((s) => (
            <span key={s.key} className={`is-who t-${stateTone(s)}`}>
              <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={13} />
            </span>
          ))}
          {!list.length && <span className="is-dim">대기</span>}
        </div>
        <div className="is-notch" />
        <div className="is-right">
          {todos.length ? (
            <span className="is-alert">! {todos.length}</span>
          ) : working.length ? (
            <span className="is-work"><i />{working.length}</span>
          ) : done.length ? (
            <span className="is-ok">✓ {done.length}</span>
          ) : (
            <span className="is-dim">—</span>
          )}
        </div>
      </div>
      {open && (
        <ul className="is-list">
          {list.length === 0 && <li className="is-empty">연결된 에이전트가 없어요</li>}
          {list.slice(0, 8).map((s) => {
            const p = progressOf(s);
            const todo = userTodo(s, now);
            const t = s.turnStartedAt ? (s.turnEndedAt && !isActive(s) ? s.turnEndedAt : now) - s.turnStartedAt : null;
            return (
              <li key={s.key}>
                <button onClick={(e) => { e.stopPropagation(); void backend.trayAction('select', s.key); }}>
                  <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
                  <span className="is-proj">{s.project ?? '프로젝트'}</span>
                  <span className={`is-state t-${stateTone(s)}`}>{todo ? todo.text : stateLabel(s)}</span>
                  {p && (
                    <span className="is-prog">
                      <span className="bar"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                      {p.done}/{p.total}
                    </span>
                  )}
                  {t !== null && <span className="is-time">{fmtDuration(t)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
