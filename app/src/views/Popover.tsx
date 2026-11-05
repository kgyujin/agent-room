// Menu bar popover: the essentials in one view that fits the window, never scrolling.
// Remaining usage per agent, today's tokens, and as many sessions as fit (the user's turn first);
// the rest is one click away in the main window.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { backend } from '../bridge';
import { fmtAgo, fmtUntil, stateLabel, stateTone, windowLabel } from '../labels';
import type { Snapshot } from '../types';
import { isActive, latestLimits, userTodo } from '../ui/Overview';
import { fmtTokens, useUsageHistory } from '../ui/Usage';
import { AgentMark, Icon } from '../ui/icons';
import { useLive } from './useLive';

/** height of one session row in CSS px (kept in step with .pp-row) */
const ROW_H = 36;

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
  const todo = live.filter((s) => userTodo(s, now));
  const work = live.filter((s) => isActive(s) && !userTodo(s, now));
  // as many rows as the space between the usage block and the footer holds
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(6);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit(Math.max(1, Math.floor((el.clientHeight - 26) / ROW_H)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const order = [...todo, ...live.filter((s) => !todo.includes(s))];
  const rows = order.length > fit ? order.slice(0, fit - 1) : order;
  const more = live.length - rows.length;
  return (
    <div className="pop">
      <header className="pop-head">
        <b>Agent Room</b>
        <span className="pp-counts">
          {todo.length > 0 && <em className="todo">내 차례 {todo.length}</em>}
          {work.length > 0 && <em>작업 중 {work.length}</em>}
          {!todo.length && !work.length && <em className="calm">{live.length ? '모두 쉬는 중' : '대기 중'}</em>}
        </span>
      </header>
      {showLimits && <UsageBlock sessions={list} now={now} />}
      <div className="pp-list" ref={box}>
        {live.length ? (
          <>
            <h4>세션 <span>{live.length}</span></h4>
            {rows.map((s) => <Row key={s.key} s={s} now={now} onClick={() => act('select', s.key)} />)}
            {more > 0 && <button className="pp-more" onClick={() => act('open')}>+{more}개 더 · 방에서 보기</button>}
          </>
        ) : (
          <div className="pp-empty">
            <p className="muted">{!unhooked && running ? `에이전트 ${running}개가 실행 중이에요. ` : ''}{unhooked ? '아직 연결된 에이전트가 없어요. 연결하면 Claude Code나 Codex가 일할 때 여기에 바로 나타나요.' : 'Claude Code나 Codex가 작업을 시작하면 여기에 바로 나타나요.'}</p>
            {unhooked && <button className="btn primary" onClick={() => act('settings', 'agents')}>에이전트 연결하기</button>}
          </div>
        )}
      </div>
      <footer className="pop-foot">
        <button onClick={() => act('open')}><Icon name="panel" size={16} />방 열기</button>
        <button onClick={() => act('mini')}><Icon name="mini" size={16} />룸만 띄우기</button>
        <button onClick={() => act('settings')}><Icon name="gear" size={16} />설정</button>
        <button onClick={() => act('quit')} className="quit">종료</button>
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
                <span key={w.minutes} className={`pp-win ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={w.resetsAt && w.resetsAt > now ? `${fmtUntil(w.resetsAt - now)} 초기화` : undefined}>
                  <small>{windowLabel(w.minutes)}</small>
                  <i className={`lc-bar a-${a}`}><i style={{ width: `${left}%` }} /></i>
                  <b>{left}%</b>
                </span>
              );
            })
          ) : (
            <span className="pp-none">한도 정보 없음</span>
          )}
        </div>
      ))}
      {today && (
        <div className="pp-today">
          오늘 <b>{fmtTokens(today.claude + today.codex)}</b> 토큰
          {h && h.recentClaude + h.recentCodex > 0 && <> · 최근 10분 <b>{fmtTokens(Math.round((h.recentClaude + h.recentCodex) / 10))}</b>/분</>}
        </div>
      )}
    </section>
  );
}

function Row({ s, now, onClick }: { s: Snapshot; now: number; onClick: () => void }) {
  const todo = userTodo(s, now);
  const tone = stateTone(s);
  return (
    <button className={`pp-row t-${tone}`} onClick={onClick} title={s.cwd ?? ''}>
      <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={14} />
      <span className="pp-name">{s.project ?? '프로젝트'}</span>
      <span className={`pp-state tone-${tone}`}><i className="pulse" />{todo ? todo.text : stateLabel(s)}</span>
      <span className="pp-ago">{fmtAgo(now - (todo?.since ?? s.lastEventAt))}</span>
    </button>
  );
}
