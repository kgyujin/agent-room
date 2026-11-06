// Dynamic-island style pill at the top centre of the screen. Collapsed it shows who is
// working (left of the notch) and what needs the user (right of the notch); hovering (or a
// click, by setting) opens the list. Its window stays one fixed size and lets clicks through outside the pill.
// Hover comes from Rust as well: macOS sends no mouse-over events to an inactive app's window.
import { ApproveButtons, canApprove } from '../ui/Approve';
import { useEffect, useRef, useState } from 'react';
import { backend } from '../bridge';
import { fmtAgo, fmtDuration, justDone, sessionNames, stateLabel, stateTone } from '../labels';
import { AgentMark, Icon, type IconName } from '../ui/icons';
import type { Snapshot } from '../types';
import { progressOf } from '../ui/Hud';
import { isActive, latestLimits, userTodo } from '../ui/Overview';
import { LimitCards, fmtTokens, useUsageHistory } from '../ui/Usage';
import { useLive } from './useLive';

const ROW = 40;
/** height of the usage section in the open card (header line + one row of limit cards) */
const USAGE_H = 182;
/** one small icon per state, next to the words */
const STATE_ICON: Record<Snapshot['state'], IconName> = {
  waiting: 'bell', error: 'cross', starting: 'cog', planning: 'note', reading: 'book', editing: 'pencil',
  running: 'play', testing: 'flask', completed: 'check', idle: 'moon', disconnected: 'moon',
};
/** room beside the notch for the agent icons (left) and the status (right) */
const SIDE = 88;
/** extra room on each side for the remaining usage (Claude left, Codex right) */
const USAGE_W = 64;
/** used when the screen has no notch: [empty middle, bar height] */
const NO_NOTCH: [number, number] = [24, 28];

export function Island() {
  const { list, now, settings, running } = useLive();
  const hoverOpens = (settings?.islandOpen ?? 'hover') === 'hover';
  // the bar is as tall as the notch and leaves the notch itself empty
  const [[notchW, barH], setNotch] = useState<[number, number]>([190, 34]);
  // asked again whenever the island moves to another display (it may have another notch, or none)
  useEffect(() => {
    const ask = () => void backend.notchSize().then((n) => setNotch(n ? [Math.round(n[0]), Math.round(n[1])] : NO_NOTCH));
    ask();
    const off = backend.onTrayEvent('island-screen', ask);
    return () => void off.then((f) => f());
  }, []);
  // `open` is how the pill is drawn; `big` is how large its window is. Opening grows the window
  // first and then morphs the pill; closing morphs the pill back and then shrinks the window,
  // so the shape change is animated instead of jumping with the window.
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  // why the agent's app could not be brought up (shown for a few seconds in the open card)
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);
  const leave = useRef(0);
  const shrink = useRef(0);
  const todos = list.filter((s) => userTodo(s, now));
  const names = sessionNames(list);
  const working = list.filter((s) => isActive(s) && !userTodo(s, now));
  // only a turn that just finished shows the check; after that the agent is simply idle
  const done = list.filter((s) => justDone(s, now, settings?.doneShownSec ?? 60));
  // remaining plan usage per agent, one line under the list
  const showLimits = settings?.showLimits ?? true;
  // remaining share of each agent's session (5-hour) and weekly window, always on the collapsed pill:
  // Claude at the far left, Codex at the far right, each in its own colour
  const usageOn = showLimits && (settings?.islandUsage ?? true);
  const claudeLeft = usageOn ? leftOf(list, 'claude') : null;
  const codexLeft = usageOn ? leftOf(list, 'codex') : null;
  const COLLAPSED: [number, number] = [notchW + (SIDE + (claudeLeft || codexLeft ? USAGE_W : 0)) * 2, barH];
  const usage = useUsageHistory(7);
  const lastDay = usage?.days[usage.days.length - 1];
  const today = lastDay ? lastDay.claude + lastDay.codex : 0;

  // never narrower than the collapsed pill: hover is hit-tested against the current size
  const openSize: [number, number] = [Math.max(420, notchW + 230, COLLAPSED[0]), barH + 10 + (Math.max(1, Math.min(list.length, 8)) + (note ? 1 : 0)) * ROW + 12 + (showLimits ? USAGE_H : 0)];
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
  // a session newly waiting on the user opens the island for a moment (setting), then it closes
  // again unless the pointer came over it meanwhile
  const seen = useRef<Set<string> | null>(null);
  const todoKeys = todos.map((s) => s.key).join(',');
  useEffect(() => {
    const keys = new Set(todoKeys ? todoKeys.split(',') : []);
    const fresh = seen.current !== null && [...keys].some((k) => !seen.current!.has(k));
    seen.current = keys;
    if (!fresh || !(settings?.islandPeek ?? true) || open) return;
    enter();
    leave.current = window.setTimeout(() => {
      setOpen(false);
      shrink.current = window.setTimeout(() => setBig(false), 360);
    }, 3000);
  }, [todoKeys]);
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
          {!open && claudeLeft && <UsageLeft agent="claude" v={claudeLeft} />}
          {open && list.length > 0 && <span className="is-head">에이전트 {list.length}</span>}
          {/* someone needs you: say who (the longest-waiting); no logos on the collapsed pill */}
          {!open && todos.length > 0 && (
            <span className="is-who t-wait">
              <b className="is-who-name">{names[todos[0].key]}</b>
              {todos.length > 1 && <small>+{todos.length - 1}</small>}
            </span>
          )}
          {!list.length && <span className="is-dim"><Icon name="moon" /> 대기</span>}
        </div>
        <div className="is-notch" />
        <div className="is-right">
          {todos.length ? (
            <span className="is-alert"><Icon name="bell" />{open ? `확인 필요 ${todos.length}` : todos.length}</span>
          ) : working.length ? (
            <span className="is-work"><Icon name="cog" />{open ? `작업 중 ${working.length}` : working.length}</span>
          ) : done.length ? (
            <span className="is-ok"><Icon name="check" />{open ? `완료 ${done.length}` : done.length}</span>
          ) : list.length ? (
            <span className="is-dim"><Icon name="moon" /></span>
          ) : null /* the left side already says 대기 */}
          {!open && codexLeft && <UsageLeft agent="codex" v={codexLeft} />}
        </div>
      </div>
      {open && (
        <ul className="is-list">
          {note && <li className="is-empty is-note">{note}</li>}
          {list.length === 0 && <li className="is-empty">{running ? '에이전트가 실행 중이에요 · 다음 작업부터 여기에 보여요' : '진행 중인 작업이 없어요'}</li>}
          {(list.length > 8 ? list.slice(0, 7) : list).map((s) => {
            const p = progressOf(s);
            const todo = userTodo(s, now);
            const t = s.turnStartedAt ? (s.turnEndedAt && !isActive(s) ? s.turnEndedAt : now) - s.turnStartedAt : null;
            return (
              <li key={s.key}>
                <button title={`${names[s.key]}${s.isDemo ? '' : '\n눌러서 이 세션 열기'}`} onClick={(e) => {
                  e.stopPropagation();
                  // jump to the agent's own app; when it can't be found, say why here instead of
                  // bringing up the main window (which looked like a flash and no app)
                  if (s.isDemo) void backend.trayAction('select', s.key);
                  else backend.focusAgent(s.key).then(() => setNote(null), (err) => setNote(String(err)));
                }}>
                  <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
                  <span className="is-proj">{names[s.key]}</span>
                  <span className={`is-state t-${stateTone(s)}`}><Icon name={todo ? 'bell' : STATE_ICON[s.state]} />{todo ? todo.text : stateLabel(s)}</span>
                  {/* a request shows how long it has waited; work shows its progress and turn time */}
                  {todo && !canApprove(s, now) && <span className="is-time"><Icon name="clock" />{fmtAgo(now - todo.since)}</span>}
                  {!todo && p && (
                    <span className="is-prog">
                      <span className="bar"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                      {p.done}/{p.total}
                    </span>
                  )}
                  {!todo && t !== null && <span className="is-time"><Icon name="clock" />{fmtDuration(t)}</span>}
                </button>
                <ApproveButtons s={s} now={now} compact />
              </li>
            );
          })}
          {list.length > 8 && (
            <li className="is-empty">
              <button className="is-more" onClick={(e) => { e.stopPropagation(); void backend.trayAction('open'); }}>+{list.length - 7}개 더 · 방에서 보기</button>
            </li>
          )}
        </ul>
      )}
      {open && showLimits && (
        <div className="is-use">
          <div className="is-use-head">
            <b><Icon name="bolt" />사용량</b>
            {usage && <span>오늘 {fmtTokens(today)} 토큰 · 최근 10분 {fmtTokens(Math.round((usage.recentClaude + usage.recentCodex) / 10))}/분</span>}
          </div>
          <LimitCards sessions={list} now={now} dark />
        </div>
      )}
    </div>
  );
}

type Left = { session: number | null; week: number | null };

/** remaining percent of an agent's session (5 hours or less) and weekly window; null without a report */
function leftOf(list: Snapshot[], agent: 'claude' | 'codex'): Left | null {
  const l = latestLimits(list, agent);
  if (!l) return null;
  const pct = (w?: { usedPct: number }) => (w ? Math.max(0, Math.min(100, Math.round(100 - w.usedPct))) : null);
  const v = { session: pct(l.windows.find((w) => w.minutes <= 300)), week: pct(l.windows.find((w) => w.minutes > 300)) };
  return v.session === null && v.week === null ? null : v;
}

function UsageLeft({ agent, v }: { agent: 'claude' | 'codex'; v: Left }) {
  const name = agent === 'claude' ? 'Claude' : 'Codex';
  const parts = [v.session !== null && `세션 ${v.session}%`, v.week !== null && `주간 ${v.week}%`].filter(Boolean).join(' · ');
  return (
    <span className={`is-pct is-pct-${agent}`} title={`${name} 남은 사용량: ${parts}`}>
      {v.session !== null && <b>{v.session}%</b>}
      {v.session !== null && v.week !== null && <i>·</i>}
      {v.week !== null && <b>{v.week}%</b>}
    </span>
  );
}
