// Dynamic-island style pill at the top centre of the screen. Collapsed it shows who is
// working (left of the notch) and what needs the user (right of the notch); hovering or
// clicking opens the list. The window is resized from Rust so it stays centred.
import { useEffect, useRef, useState } from 'react';
import { backend } from '../bridge';
import { fmtDuration, stateLabel, stateTone, windowLabel } from '../labels';
import { AgentMark } from '../ui/icons';
import { progressOf } from '../ui/Hud';
import { isActive, latestLimits, userTodo } from '../ui/Overview';
import { useLive } from './useLive';

const COLLAPSED: [number, number] = [340, 34];
const ROW = 40;

export function Island() {
  const { list, now, settings } = useLive();
  // `open` is how the pill is drawn; `big` is how large its window is. Opening grows the window
  // first and then morphs the pill; closing morphs the pill back and then shrinks the window,
  // so the shape change is animated instead of jumping with the window.
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const leave = useRef(0);
  const shrink = useRef(0);
  const todos = list.filter((s) => userTodo(s, now));
  const working = list.filter((s) => isActive(s) && !userTodo(s, now));
  const done = list.filter((s) => s.state === 'completed');
  // remaining plan usage per agent, one line under the list
  const showLimits = settings?.showLimits ?? true;
  const limits = showLimits ? (['claude', 'codex', 'demo'] as const).map((a) => [a, latestLimits(list, a)] as const).filter((r) => r[1]) : [];
  // lowest remaining share across agents, shown on the collapsed pill once it is 10% or less
  const lows = limits.flatMap(([a, l]) => l!.windows.map((w) => ({ a, left: Math.max(0, Math.round(100 - w.usedPct)), name: windowLabel(w.minutes) })));
  const low = lows.reduce<(typeof lows)[number] | null>((m, x) => (!m || x.left < m.left ? x : m), null);

  const openSize: [number, number] = [420, 44 + Math.max(1, Math.min(list.length, 8)) * ROW + 12 + (limits.length ? 30 : 0)];
  useEffect(() => {
    // a little extra room below so the spring's overshoot is not clipped by the window
    const [w, h] = big ? [openSize[0], openSize[1] + 10] : COLLAPSED;
    void backend.islandLayout(w, h);
  }, [big, openSize[1]]);

  const enter = () => {
    clearTimeout(leave.current);
    clearTimeout(shrink.current);
    setBig(true);
    window.setTimeout(() => setOpen(true), big ? 0 : 40);
  };
  const exit = () => {
    leave.current = window.setTimeout(() => {
      setOpen(false);
      shrink.current = window.setTimeout(() => setBig(false), 360);
    }, 450);
  };
  const [w, h] = open ? openSize : COLLAPSED;

  return (
    <div className={`island ${open ? 'open' : ''} ${todos.length ? 'alert' : ''}`} style={{ width: w, height: h }} onMouseEnter={enter} onMouseLeave={exit} onClick={enter}>
      <div className="is-bar">
        <div className="is-left">
          {open && list.length > 0 && <span className="is-head">에이전트 {list.length}</span>}
          {!open && (todos.length ? todos : working.length ? working : list).slice(0, 3).map((s) => (
            <span key={s.key} className={`is-who t-${stateTone(s)}`}>
              <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={13} />
            </span>
          ))}
          {!list.length && <span className="is-dim">대기</span>}
        </div>
        <div className="is-notch" />
        <div className="is-right">
          {low && low.left <= 10 && (
            <span className="is-low" title={`${low.name} 남은 사용량이 얼마 없어요`}>
              <AgentMark agent={low.a} size={11} /> {low.left}%
            </span>
          )}
          {todos.length ? (
            <span className="is-alert">{open ? `확인 필요 ${todos.length}` : `! ${todos.length}`}</span>
          ) : working.length ? (
            <span className="is-work"><i />{open ? `작업 중 ${working.length}` : working.length}</span>
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
      {open && limits.length > 0 && (
        <div className="is-lim" title="남은 사용량 (에이전트가 알려준 요금제 한도)">
          <b>남은 사용량</b>
          {limits.map(([a, l]) => (
            <span key={a}>
              <AgentMark agent={a} size={13} />
              {l!.windows.map((w) => {
                const left = Math.max(0, Math.round(100 - w.usedPct));
                return <em key={w.minutes} className={left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}>{windowLabel(w.minutes)} {left}%</em>;
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
