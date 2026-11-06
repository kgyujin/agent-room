// "현황" tab: every session at a glance, sorted by what needs the user first.
// Everything shown comes from hook events; the only derived number is the remaining-time
// estimate, which is labelled as one and only appears once a plan step has finished.
import { useEffect } from 'react';
import { backend } from '../bridge';
import type { LimitWindow, RateLimits, Snapshot } from '../types';
import { doingLabel, fmtAgo, fmtDuration, fmtUntil, sessionNames, stateLabel, stateTone, windowLabel } from '../labels';
import { AgentMark, Icon } from './icons';
import { progressOf } from './Hud';
import { L } from '../i18n';

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

export const isActive = (s: Snapshot) => s.connection === 'live' && ACTIVE.includes(s.state);

/** what the user has to do for this session, if anything */
export function userTodo(s: Snapshot, now: number): { text: string; since: number } | null {
  if (s.connection !== 'live') return null;
  if (s.waiting)
    return {
      text: s.waiting.kind === 'approval' ? L(`${s.waiting.tool ?? '도구'} 실행 승인`, `Approve ${s.waiting.tool ?? 'a tool'}`) : L('답변 입력', 'Answer'),
      since: s.waiting.since,
    };
  if (s.state === 'error') return { text: s.lastTest?.ok === false ? L('테스트 실패 확인', 'Check the failed tests') : L('오류 확인', 'Check the error'), since: s.error?.at ?? now };
  return null;
}

function turnMs(s: Snapshot, now: number) {
  if (!s.turnStartedAt) return null;
  return (s.turnEndedAt && !isActive(s) ? s.turnEndedAt : now) - s.turnStartedAt;
}

/** rough time left: average time per finished plan step x steps left (null until one step is done
 *  and the turn has run a minute; steps the agent marks done right away would make it meaningless).
 *  None while the session waits on the user: no step moves until they answer */
export function etaMs(s: Snapshot, now: number): number | null {
  const p = progressOf(s);
  const t = turnMs(s, now);
  if (!p || !t || t < 60_000 || p.done < 1 || p.done >= p.total || !isActive(s) || userTodo(s, now)) return null;
  return (t / p.done) * (p.total - p.done);
}

/** sessions grouped by what they need: the user's turn first, then work, then the quiet ones */
export function Overview({ sessions, now, selected, onSelect, showLimits = true, limitsFirst = false }: { sessions: Snapshot[]; now: number; selected: string | null; onSelect: (k: string) => void; showLimits?: boolean; limitsFirst?: boolean }) {
  const live = sessions.filter((s) => s.connection !== 'ended' && s.connection !== 'lost');
  const names = sessionNames(live);
  // the longest-waiting first
  const todo = live.filter((s) => userTodo(s, now)).sort((a, b) => userTodo(a, now)!.since - userTodo(b, now)!.since);
  const work = live.filter((s) => isActive(s) && !userTodo(s, now));
  const done = live.filter((s) => !isActive(s) && s.state === 'completed' && s.connection === 'live');
  const quiet = live.filter((s) => !todo.includes(s) && !work.includes(s) && !done.includes(s));
  const groups = [
    { id: 'todo', label: L('내 차례', 'Your turn'), list: todo, empty: L('기다리는 에이전트가 없어요', 'No agent is waiting for you') },
    { id: 'work', label: L('작업 중', 'Working'), list: work },
    { id: 'done', label: L('완료', 'Done'), list: done },
    { id: 'quiet', label: L('쉬는 중', 'Resting'), list: quiet },
  ];
  return (
    <div className="ov">
      {showLimits && limitsFirst && <Limits sessions={sessions} now={now} />}
      {!live.length && <p className="muted small ov-none">{L('지금 일하는 에이전트가 없어요. Claude Code나 Codex가 작업을 시작하면 여기에 나타나요.', 'No agent is working right now. Claude Code or Codex shows up here when it starts.')}</p>}
      {live.length > 0 && groups.map((g) => (g.list.length || g.empty) && (
        <section key={g.id} className={`ov-group g-${g.id} ${g.list.length ? '' : 'empty'}`}>
          <h4><i className="ov-dot" />{g.label}<span className="pn-count">{g.list.length || ''}</span></h4>
          {g.list.length ? (
            <ul className="ov-list">
              {g.list.map((s) => (
                <li key={s.key}>
                  <AgentRow s={s} name={names[s.key]} now={now} on={selected === s.key} onClick={() => onSelect(s.key)} todo={userTodo(s, now)} slim={g.id === 'done' || g.id === 'quiet'} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small ov-none">{g.empty}</p>
          )}
        </section>
      ))}
    </div>
  );
}

const LIMITS_KEY = 'lastLimits';
function remembered(): Partial<Record<Snapshot['agent'], RateLimits>> {
  try { return JSON.parse(localStorage.getItem(LIMITS_KEY) ?? '{}'); } catch { return {}; }
}

/** Account usage that shows even when no session here reported it (the desktop app, VS Code, or
 *  before Agent Room started): Codex's from its newest log, Claude's from the account when that is
 *  turned on (the backend asks at most every 5 minutes). Asked once a minute, kept like any other report. */
export function useAccountLimits() {
  useEffect(() => {
    const keep = (agent: 'claude' | 'codex') => (l: RateLimits | null) => {
      if (!l) return;
      const mem = remembered();
      const old = mem[agent];
      if (!old || l.at > old.at) {
        try { localStorage.setItem(LIMITS_KEY, JSON.stringify({ ...mem, [agent]: l })); } catch { /* storage unavailable */ }
      }
    };
    const read = () => {
      void backend.codexLimits().then(keep('codex')).catch(() => {});
      void backend.claudeLimits().then(keep('claude')).catch(() => {});
    };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);
}

/** newest remaining-usage report for this agent (limits are per account, not per session). The last
 *  real report is remembered (percentages and reset times only, in this computer's local storage),
 *  so usage stays visible after the sessions that reported it are gone. */
export function latestLimits(sessions: Snapshot[], agent: Snapshot['agent']): RateLimits | null {
  let best: RateLimits | null = null;
  for (const s of sessions) if (s.agent === agent && s.limits && (!best || s.limits.at > best.at)) best = s.limits;
  if (agent === 'demo') return best;
  const mem = remembered();
  const old = mem[agent];
  if (best && (!old || best.at > old.at)) {
    try { localStorage.setItem(LIMITS_KEY, JSON.stringify({ ...mem, [agent]: best })); } catch { /* storage unavailable */ }
    return best;
  }
  // the newest report wins: a session that is still open may hold an older one than the cache
  return old && (!best || old.at > best.at) ? old : best;
}

/** "12분 전 기준" when the numbers are not fresh, so an old report is not read as current */
export function limitsAge(l: RateLimits, now: number): string | null {
  return now - l.at > 15 * 60_000 ? L(`${fmtAgo(now - l.at)} 기준`, `as of ${fmtAgo(now - l.at)}`) : null;
}

/** every agent's remaining usage in one small card (main window, top right) */
export function UsageStrip({ sessions, now, onOpen }: { sessions: Snapshot[]; now: number; onOpen?: () => void }) {
  const rows = (['claude', 'codex', 'demo'] as const).map((a) => [a, latestLimits(sessions, a)] as const).filter((r) => r[1]);
  if (!rows.length) return null;
  return (
    <button className="usage-strip" onClick={onOpen} disabled={!onOpen} title={L('남은 사용량 · 눌러서 사용량 자세히 보기', 'Usage left · click for details')}>
      {rows.map(([a, l]) => (
        <div key={a} className="us-agent">
          <AgentMark agent={a} size={14} />
          {l!.windows.map((w) => {
            const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
            return (
              <span key={w.minutes} className={`us-win ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={w.resetsAt && w.resetsAt > now ? L(`${fmtUntil(w.resetsAt - now)} 초기화`, `resets ${fmtUntil(w.resetsAt - now)}`) : undefined}>
                <em>{windowLabel(w.minutes)}</em>
                <span className="ov-lim-bar"><i style={{ width: `${left}%` }} /></span>
                <b>{left}%</b>
              </span>
            );
          })}
          {limitsAge(l!, now) && <small>{limitsAge(l!, now)}</small>}
        </div>
      ))}
    </button>
  );
}

/** remaining plan usage per agent, as each agent reports it (Claude status line, Codex log) */
export function Limits({ sessions, now }: { sessions: Snapshot[]; now: number }) {
  const rows = (['claude', 'codex', 'demo'] as const).map((a) => [a, latestLimits(sessions, a)] as const).filter((r) => r[1]);
  return (
    <>
      <h4>{L('남은 사용량', 'Usage left')}</h4>
      {rows.length ? (
        <div className="ov-lim">
          {rows.map(([a, l]) => (
            <div key={a} className="ov-lim-agent">
              <AgentMark agent={a} size={16} />
              <div className="ov-lim-rows">
                {l!.windows.map((w) => <LimitBar key={w.minutes} w={w} now={now} />)}
                {limitsAge(l!, now) && <small className="ov-lim-age">{limitsAge(l!, now)}</small>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small ov-none">{L('에이전트가 다음 응답을 받으면 5시간·주간 남은 양이 보여요. (Claude는 Pro·Max 요금제만)', 'The 5-hour and weekly usage left shows after the next reply. (Claude: Pro and Max plans only)')}</p>
      )}
    </>
  );
}

export function LimitBar({ w, now }: { w: LimitWindow; now: number }) {
  const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
  const reset = w.resetsAt && w.resetsAt > now ? L(`${fmtUntil(w.resetsAt - now)} 초기화`, `resets ${fmtUntil(w.resetsAt - now)}`) : '';
  const resetShort = w.resetsAt && w.resetsAt > now ? `↻ ${fmtUntil(w.resetsAt - now).replace(' 후', '').replace('in ', '')}` : '';
  return (
    <div className={`ov-lim-row ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={`${L('사용', 'Used')} ${Math.round(w.usedPct)}%${reset ? ` · ${reset}` : ''}`}>
      <span className="ov-lim-name">{windowLabel(w.minutes)}</span>
      <span className="ov-lim-bar"><i style={{ width: `${left}%` }} /></span>
      <b>{left}%</b>
      <span className="ov-lim-reset">{resetShort}</span>
    </div>
  );
}

function AgentRow({ s, name, now, on, onClick, todo, slim }: { s: Snapshot; name: string; now: number; on: boolean; onClick: () => void; todo: { text: string; since: number } | null; slim: boolean }) {
  const prog = progressOf(s);
  const step = s.plan.find((p) => p.status === 'in_progress');
  const t = turnMs(s, now);
  const eta = etaMs(s, now);
  const tone = stateTone(s);
  const busy = isActive(s);
  // the pill already says what it does; the line under it names only the file or command
  const doing = busy ? doingLabel(s)?.split(' · ')[1] ?? null : null;
  if (slim)
    return (
      <button className={`ov-row slim ${on ? 'on' : ''} t-${tone}`} onClick={onClick} title={`${name}${s.cwd ? `\n${s.cwd}` : ''}`}>
        <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={14} />
        <span className="ov-proj">{name}</span>
        <span className={`ov-state tone-${tone}`}>{stateLabel(s)}</span>
        <span className="ov-since">{fmtAgo(now - s.lastEventAt)}</span>
      </button>
    );
  return (
    <button className={`ov-row ${busy ? '' : 'quiet'} ${on ? 'on' : ''} t-${tone}`} onClick={onClick} title={`${name}${s.cwd ? `\n${s.cwd}` : ''}`}>
      {todo && (
        <div className="ov-ask">
          <Icon name="bell" />
          <b>{todo.text}</b>
          <span>{fmtAgo(now - todo.since)}</span>
        </div>
      )}
      <div className="ov-top">
        <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
        <span className="ov-proj">{name}</span>
        {/* a "내 차례" card already says what is asked in the line above */}
        {!todo && (
          <span className={`ov-state tone-${tone}`}>
            <i className="pulse" />
            {stateLabel(s)}
          </span>
        )}
      </div>
      {doing && <div className="ov-doing">{doing}</div>}
      {busy ? (
        <div className="ov-meta">
          {prog ? (
            <>
              <span className="ov-bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
              <span className="ov-n">{prog.done}/{prog.total}</span>
            </>
          ) : <span className="ov-fill" />}
          {t !== null && <span className="ov-time"><Icon name="clock" />{fmtDuration(t)}</span>}
          {eta !== null && <span className="ov-eta" title={L('끝난 단계의 평균 시간으로 계산한 추정치예요', 'Estimated from the average time of the finished steps')}>{L(`약 ${Math.max(1, Math.round(eta / 60000))}분 남음`, `about ${Math.max(1, Math.round(eta / 60000))} min left`)}</span>}
        </div>
      ) : (
        <div className="ov-meta quiet">
          {t !== null && <span>{L('소요', 'Took')} {fmtDuration(t)}</span>}
          <span>{L('마지막 활동', 'Last active')} {fmtAgo(now - s.lastEventAt)}</span>
        </div>
      )}
      {busy && (step || s.subagents > 0) && (
        <div className="ov-step">
          {step && <><Icon name="play" /><span>{step.text}</span></>}
          {s.subagents > 0 && <em>{L('하위 에이전트', 'Subagents')} {s.subagents}</em>}
        </div>
      )}
    </button>
  );
}
