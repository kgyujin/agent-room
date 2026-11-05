// Dynamic-island style pill at the top centre of the screen. Collapsed it shows who is
// working (left of the notch) and what needs the user (right of the notch); hovering (or a
// click, by setting) opens the list. The window is resized from Rust so it stays centred.
// Hover comes from Rust as well: macOS sends no mouse-over events to an inactive app's window.
import { useEffect, useRef, useState } from 'react';
import { backend } from '../bridge';
import { fmtDuration, justDone, stateLabel, stateTone, windowLabel } from '../labels';
import { AgentMark, Icon, type IconName } from '../ui/icons';
import type { Snapshot } from '../types';
import { progressOf } from '../ui/Hud';
import { isActive, latestLimits, userTodo } from '../ui/Overview';
import { useLive } from './useLive';

const ROW = 40;
/** one small icon per state, next to the words */
const STATE_ICON: Record<Snapshot['state'], IconName> = {
  waiting: 'bell', error: 'cross', starting: 'cog', planning: 'note', reading: 'book', editing: 'pencil',
  running: 'play', testing: 'flask', completed: 'check', idle: 'moon', disconnected: 'moon',
};
/** room beside the notch for the agent icons (left) and the status (right) */
const SIDE = 88;
/** used when the screen has no notch: [empty middle, bar height] */
const NO_NOTCH: [number, number] = [24, 28];

export function Island() {
  const { list, now, settings, running } = useLive();
  const hoverOpens = (settings?.islandOpen ?? 'hover') === 'hover';
  // the bar is as tall as the notch and leaves the notch itself empty
  const [[notchW, barH], setNotch] = useState<[number, number]>([190, 34]);
  useEffect(() => { void backend.notchSize().then((n) => setNotch(n ? [Math.round(n[0]), Math.round(n[1])] : NO_NOTCH)); }, []);
  const COLLAPSED: [number, number] = [notchW + SIDE * 2, barH];
  // `open` is how the pill is drawn; `big` is how large its window is. Opening grows the window
  // first and then morphs the pill; closing morphs the pill back and then shrinks the window,
  // so the shape change is animated instead of jumping with the window.
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const leave = useRef(0);
  const shrink = useRef(0);
  const todos = list.filter((s) => userTodo(s, now));
  const working = list.filter((s) => isActive(s) && !userTodo(s, now));
  // only a turn that just finished shows the check; after that the agent is simply idle
  const done = list.filter((s) => justDone(s, now));
  // remaining plan usage per agent, one line under the list
  const showLimits = settings?.showLimits ?? true;
  const limits = showLimits ? (['claude', 'codex', 'demo'] as const).map((a) => [a, latestLimits(list, a)] as const).filter((r) => r[1]) : [];
  // lowest remaining share across agents, always shown on the collapsed pill (red at 10% or less)
  const lows = limits.flatMap(([a, l]) => l!.windows.map((w) => ({ a, left: Math.max(0, Math.round(100 - w.usedPct)), name: windowLabel(w.minutes) })));
  const low = lows.reduce<(typeof lows)[number] | null>((m, x) => (!m || x.left < m.left ? x : m), null);

  const openSize: [number, number] = [Math.max(420, notchW + 230), barH + 10 + Math.max(1, Math.min(list.length, 8)) * ROW + 12 + (limits.length ? 30 + limits.length * 22 : 0)];
  useEffect(() => {
    // a little extra room below so the spring's overshoot is not clipped by the window
    const [w, h] = big ? [openSize[0], openSize[1] + 10] : COLLAPSED;
    void backend.islandLayout(w, h);
  }, [big, openSize[0], openSize[1], COLLAPSED[0], COLLAPSED[1]]);

  const enter = () => {
    clearTimeout(leave.current);
    clearTimeout(shrink.current);
    setBig(true);
    window.setTimeout(() => setOpen(true), big ? 0 : 40);
  };
  const exit = () => {
    clearTimeout(leave.current);
    leave.current = window.setTimeout(() => {
      setOpen(false);
      shrink.current = window.setTimeout(() => setBig(false), 360);
    }, 450);
  };
  // click-only: coming back before the close delay keeps the island open, but never opens it
  const stay = () => clearTimeout(leave.current);
  const [w, h] = open ? openSize : COLLAPSED;
  const hoverRef = useRef({ enter, exit, stay, hoverOpens });
  hoverRef.current = { enter, exit, stay, hoverOpens };
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    void backend.onTrayEvent('hover-island', (inside) => {
      const r = hoverRef.current;
      if (!inside) r.exit();
      else if (r.hoverOpens) r.enter();
      else r.stay();
    }).then((u) => (dead ? u() : (off = u)));
    return () => { dead = true; off?.(); };
  }, []);

  return (
    // hover comes only from Rust: the page's own mouseenter/leave also fired while the window was
    // being resized under a still pointer, and the two sources together opened and closed it in a loop
    <div className={`island ${open ? 'open' : ''} ${todos.length ? 'alert' : ''}`} style={{ width: w, height: h, ['--bar-h' as string]: `${barH}px`, ['--notch-w' as string]: `${notchW}px` }}
      onClick={enter}>
      <div className="is-bar">
        <div className="is-left">
          {open && list.length > 0 && <span className="is-head">에이전트 {list.length}</span>}
          {!open && (todos.length ? todos : working.length ? working : list).slice(0, 3).map((s) => (
            <span key={s.key} className={`is-who t-${stateTone(s)}`}>
              <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={13} />
            </span>
          ))}
          {!list.length && <span className="is-dim"><Icon name="moon" /> 대기</span>}
        </div>
        <div className="is-notch" />
        <div className="is-right">
          {low && (
            <span className={`is-low ${low.left <= 10 ? 'low' : low.left <= 30 ? 'mid' : ''}`} title={`가장 적게 남은 사용량: ${low.name} ${low.left}%`}>
              <Icon name="bolt" />{low.left}%
            </span>
          )}
          {todos.length ? (
            <span className="is-alert"><Icon name="bell" />{open ? `확인 필요 ${todos.length}` : todos.length}</span>
          ) : working.length ? (
            <span className="is-work"><Icon name="cog" />{open ? `작업 중 ${working.length}` : working.length}</span>
          ) : done.length ? (
            <span className="is-ok"><Icon name="check" />{open ? `완료 ${done.length}` : done.length}</span>
          ) : (
            <span className="is-dim"><Icon name="moon" /></span>
          )}
        </div>
      </div>
      {open && (
        <ul className="is-list">
          {list.length === 0 && <li className="is-empty">{running ? '에이전트가 실행 중이에요 · 다음 작업부터 여기에 보여요' : '진행 중인 작업이 없어요'}</li>}
          {list.slice(0, 8).map((s) => {
            const p = progressOf(s);
            const todo = userTodo(s, now);
            const t = s.turnStartedAt ? (s.turnEndedAt && !isActive(s) ? s.turnEndedAt : now) - s.turnStartedAt : null;
            return (
              <li key={s.key}>
                <button title={s.isDemo ? undefined : '눌러서 이 에이전트가 일하는 앱 열기'} onClick={(e) => {
                  e.stopPropagation();
                  // jump to the agent's own app; the room shows the session when that app can't be found
                  if (s.isDemo) void backend.trayAction('select', s.key);
                  else backend.focusAgent(s.key).catch(() => backend.trayAction('select', s.key));
                }}>
                  <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
                  <span className="is-proj">{s.project ?? '프로젝트'}</span>
                  <span className={`is-state t-${stateTone(s)}`}><Icon name={todo ? 'bell' : STATE_ICON[s.state]} />{todo ? todo.text : stateLabel(s)}</span>
                  {p && (
                    <span className="is-prog">
                      <span className="bar"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                      {p.done}/{p.total}
                    </span>
                  )}
                  {t !== null && <span className="is-time"><Icon name="clock" />{fmtDuration(t)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && limits.length > 0 && (
        <div className="is-lim" title="남은 사용량 (에이전트가 알려준 요금제 한도)">
          <b><Icon name="bolt" />남은 사용량</b>
          {limits.map(([a, l]) => (
            <span key={a}>
              <AgentMark agent={a} size={13} />
              {l!.windows.map((w) => {
                const left = Math.max(0, Math.round(100 - w.usedPct));
                return (
                  <em key={w.minutes} className={left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}>
                    {windowLabel(w.minutes)} <i className="is-lim-bar"><i style={{ width: `${left}%` }} /></i> {left}%
                  </em>
                );
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
