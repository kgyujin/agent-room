// Menu bar popover: the essentials in one view that fits the window, never scrolling.
// Remaining usage per agent, today's tokens, and as many sessions as fit (the user's turn first);
// the rest is one click away in the main window.
import { ApproveButtons } from '../ui/Approve';
import { useEffect, useRef, useState } from 'react';
import { useFit } from '../ui/fit';
import { backend } from '../bridge';
import { doingLabel, fmtAgo, fmtUntil, paceNote, sessionNames, stateLabel, stateTone, windowLabel } from '../labels';
import type { Snapshot } from '../types';
import { isActive, latestLimits, userTodo } from '../ui/Overview';
import { fmtTokens, useUsageHistory } from '../ui/Usage';
import { AgentMark, Icon } from '../ui/icons';
import { useLive } from './useLive';
import { L } from '../i18n';

export function Popover() {
  const { list, now, settings, running } = useLive();
  const act = (a: string, key?: string) => void backend.trayAction(a, key);
  // with nothing connected yet, an empty list would wait forever: point straight at the fix
  const [unhooked, setUnhooked] = useState(false);
  useEffect(() => {
    if (!list.length) void backend.hooksStatus().then((h) => setUnhooked(h.every((x) => x.installed === 'none'))).catch(() => {});
  }, [list.length]);
  const showLimits = settings?.showLimits ?? true;
  const live = list.filter((s) => s.connection !== 'ended' && s.connection !== 'lost');
  const todo = live.filter((s) => userTodo(s, now)).sort((a, b) => userTodo(a, now)!.since - userTodo(b, now)!.since);
  const work = live.filter((s) => isActive(s) && !userTodo(s, now));
  // grouped by urgency like a task inbox: the user's turn, then working, then resting.
  // Rows that don't fit drop from the bottom (resting first) and the rest is one click away.
  const rest = live.filter((s) => !todo.includes(s) && !work.includes(s));
  const groups: [string, string, Snapshot[]][] = [
    ['todo', L('내 차례', 'Your turn'), todo],
    ['work', L('작업 중', 'Working'), work],
    ['rest', L('쉬는 중', 'Resting'), rest],
  ];
  const box = useRef<HTMLDivElement>(null);
  // the user's turn never drops: those rows are why the popover was opened
  const more = useFit(box, ['.pp-g-rest .pp-rowwrap', '.pp-g-work .pp-rowwrap']);
  const names = sessionNames(live);
  return (
    <div className="pop">
      <header className="pop-head">
        <b>Agent Room</b>
        <span className="pp-counts">
          {todo.length > 0 && <em className="todo">{L('내 차례', 'Your turn')} {todo.length}</em>}
          {work.length > 0 && <em>{L('작업 중', 'Working')} {work.length}</em>}
          {!todo.length && !work.length && <em className="calm">{live.length ? L('모두 쉬는 중', 'All resting') : unhooked ? L('연결 안 됨', 'Not connected') : L('대기 중', 'Idle')}</em>}
        </span>
      </header>
      {showLimits && <UsageBlock sessions={list} now={now} />}
      <div className="pp-list" ref={box}>
        {live.length ? (
          <>
            {groups.filter(([, , xs]) => xs.length).map(([id, label, xs]) => (
              <section key={id} className={`pp-g pp-g-${id}`}>
                <h4>{label} <span>{xs.length}</span></h4>
                {xs.map((s) => (
                  <div key={s.key} className="pp-rowwrap">
                    <Row s={s} name={names[s.key]} now={now} onClick={(inRoom) => act(inRoom || s.isDemo ? 'select' : 'focus', s.key)} />
                    <ApproveButtons s={s} now={now} compact />
                  </div>
                ))}
              </section>
            ))}
            {more > 0 && <button className="pp-more" onClick={() => act('open')}>{L(`+${more}개 더 · 방에서 보기`, `+${more} more · see the room`)}</button>}
          </>
        ) : (
          <div className="pp-empty">
            <p className="muted">{!unhooked && running ? L(`에이전트 ${running}개가 실행 중이에요. `, `${running} agents running. `) : ''}{unhooked ? L('아직 연결된 에이전트가 없어요. 연결하면 Claude Code나 Codex가 일할 때 여기에 바로 나타나요.', 'No agent connected yet. Once connected, Claude Code and Codex show up here as they work.') : L('Claude Code나 Codex가 작업을 시작하면 여기에 바로 나타나요.', 'Claude Code and Codex show up here when they start working.')}</p>
            {unhooked && <button className="btn primary" onClick={() => act('settings', 'agents')}>{L('에이전트 연결하기', 'Connect agents')}</button>}
          </div>
        )}
      </div>
      <footer className="pop-foot">
        <button onClick={() => act('open')}><Icon name="panel" size={16} />{L('방 열기', 'Room')}</button>
        <button onClick={() => act('dashboard')}><Icon name="monitor" size={16} />{L('대시보드', 'Dashboard')}</button>
        <button onClick={() => act('mini')}><Icon name="mini" size={16} />{L('방만 띄우기', 'Room only')}</button>
        <button onClick={() => act('settings')}><Icon name="gear" size={16} />{L('설정', 'Settings')}</button>
        <button onClick={() => act('quit')} className="quit"><Icon name="close" size={16} />{L('종료', 'Quit')}</button>
      </footer>
    </div>
  );
}

/** one line per agent: what is left of each limit and when the shortest one resets, plus today's tokens */
function UsageBlock({ sessions, now }: { sessions: Snapshot[]; now: number }) {
  const h = useUsageHistory(7);
  const rows = (['claude', 'codex'] as const).map((a) => [a, latestLimits(sessions, a)] as const);
  const today = h?.days[h.days.length - 1];
  return (
    <section className="pp-use">
      {rows.map(([a, l]) => (
        <div key={a} className="pp-agent">
          <AgentMark agent={a} size={16} />
          {l ? (
            l.windows.map((w) => {
              const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
              return (
                <span key={w.minutes} className={`pp-win ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={[w.resetsAt && w.resetsAt > now ? L(`${fmtUntil(w.resetsAt - now)} 초기화`, `resets ${fmtUntil(w.resetsAt - now)}`) : '', paceNote(w, l.at) ?? ''].filter(Boolean).join(' · ') || undefined}>
                  {/* running low: when it comes back matters more than which window it is */}
                  <small>{left <= 30 && w.resetsAt && w.resetsAt > now ? fmtUntil(w.resetsAt - now) : windowLabel(w.minutes)}</small>
                  <i className={`lc-bar a-${a}`}><i style={{ width: `${left}%` }} /></i>
                  <b>{left}%</b>
                </span>
              );
            })
          ) : (
            <span className="pp-none">{L('한도 정보 없음', 'No limit info')}</span>
          )}
        </div>
      ))}
      {today && (
        <div className="pp-today">
          {L('오늘', 'Today')} <b>{fmtTokens(today.claude + today.codex)}</b> {L('토큰', 'tokens')}
          {h && h.recentClaude + h.recentCodex > 0 && <> · {L('최근 10분', 'last 10 min')} <b>{fmtTokens(Math.round((h.recentClaude + h.recentCodex) / 10))}</b>/{L('분', 'min')}</>}
        </div>
      )}
    </section>
  );
}

/** click: open the session itself (terminal tab, editor, chat); ⌥-click: show it in the room */
function Row({ s, name, now, onClick }: { s: Snapshot; name: string; now: number; onClick: (inRoom: boolean) => void }) {
  const todo = userTodo(s, now);
  const tone = stateTone(s);
  // "코드 작성 중 · Room.tsx": the state in bold, then the file or command it is on (or the session title)
  const doing = doingLabel(s);
  const cut = doing?.indexOf(' · ') ?? -1;
  const what = stateLabel(s); // the same words as the dashboard and the room
  const detail = (doing && cut >= 0 ? doing.slice(cut + 3) : null) ?? s.title;
  return (
    <button className={`pp-row t-${tone}`} onClick={(e) => onClick(e.altKey)} title={`${s.cwd ?? ''}\n${L('⌥ 클릭: 방에서 보기', '⌥-click: see it in the room')}`}>
      <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
      <span className="pp-main">
        <span className="pp-top"><span className="pp-name">{name}</span><span className="pp-ago">{fmtAgo(now - (todo?.since ?? s.lastEventAt))}</span></span>
        <span className={`pp-state tone-${tone}`}><i className="pulse" /><b>{todo ? todo.text : what}</b>{!todo && detail && <em>{detail}</em>}</span>
      </span>
    </button>
  );
}
