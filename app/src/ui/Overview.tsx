// "현황" tab: every session at a glance, sorted by what needs the user first.
// Everything shown comes from hook events; the only derived number is the remaining-time
// estimate, which is labelled as one and only appears once a plan step has finished.
import type { LimitWindow, RateLimits, Snapshot } from '../types';
import { doingLabel, fmtAgo, fmtDuration, fmtUntil, stateLabel, stateTone, windowLabel } from '../labels';
import { AgentMark, Icon } from './icons';
import { progressOf } from './Hud';

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

export const isActive = (s: Snapshot) => s.connection === 'live' && ACTIVE.includes(s.state);

/** what the user has to do for this session, if anything */
export function userTodo(s: Snapshot, now: number): { text: string; since: number } | null {
  if (s.connection !== 'live') return null;
  if (s.waiting)
    return {
      text: s.waiting.kind === 'approval' ? `${s.waiting.tool ?? '도구'} 실행 승인` : '답변 입력',
      since: s.waiting.since,
    };
  if (s.state === 'error') return { text: s.lastTest?.ok === false ? '테스트 실패 확인' : '오류 확인', since: s.error?.at ?? now };
  return null;
}

function turnMs(s: Snapshot, now: number) {
  if (!s.turnStartedAt) return null;
  return (s.turnEndedAt && !isActive(s) ? s.turnEndedAt : now) - s.turnStartedAt;
}

/** rough time left: average time per finished plan step x steps left (null until one step is done
 *  and the turn has run a minute; steps the agent marks done right away would make it meaningless) */
export function etaMs(s: Snapshot, now: number): number | null {
  const p = progressOf(s);
  const t = turnMs(s, now);
  if (!p || !t || t < 60_000 || p.done < 1 || p.done >= p.total || !isActive(s)) return null;
  return (t / p.done) * (p.total - p.done);
}

export function Overview({ sessions, now, selected, onSelect, showLimits = true, limitsFirst = false }: { sessions: Snapshot[]; now: number; selected: string | null; onSelect: (k: string) => void; showLimits?: boolean; limitsFirst?: boolean }) {
  const live = sessions.filter((s) => s.connection !== 'ended' && s.connection !== 'lost');
  const todos = live.map((s) => [s, userTodo(s, now)] as const).filter((x): x is [Snapshot, { text: string; since: number }] => x[1] !== null);
  const working = live.filter((s) => isActive(s) && s.state !== 'waiting' && s.state !== 'error').length;
  const done = live.filter((s) => s.state === 'completed').length;
  const quiet = live.filter((s) => s.connection === 'stale' || s.state === 'idle').length;
  return (
    <div className="ov">
      <div className="ov-stats">
        <Stat n={todos.length} label="내 차례" tone="wait" />
        <Stat n={working} label="작업 중" tone="work" />
        <Stat n={done} label="완료" tone="ok" />
        <Stat n={quiet} label="쉬는 중" tone="calm" />
      </div>

      {showLimits && limitsFirst && <Limits sessions={sessions} now={now} />}

      <h4>내가 할 일</h4>
      {todos.length ? (
        <ul className="ov-todo">
          {todos.map(([s, t]) => (
            <li key={s.key}>
              <button onClick={() => onSelect(s.key)} className={selected === s.key ? 'on' : ''}>
                <AgentMark agent={s.isDemo ? 'demo' : s.agent} />
                <span className="ov-proj">{s.project ?? '프로젝트'}</span>
                <span className={`ov-what tone-${stateTone(s)}`}>{t.text}</span>
                <span className="ov-since">{fmtAgo(now - t.since)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small ov-none">지금은 기다리는 에이전트가 없어요.</p>
      )}

      {showLimits && !limitsFirst && <Limits sessions={sessions} now={now} />}

      <h4>에이전트 {live.length}</h4>
      <ul className="ov-list">
        {live.map((s) => (
          <li key={s.key}>
            <AgentRow s={s} now={now} on={selected === s.key} onClick={() => onSelect(s.key)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const LIMITS_KEY = 'lastLimits';
function remembered(): Partial<Record<Snapshot['agent'], RateLimits>> {
  try { return JSON.parse(localStorage.getItem(LIMITS_KEY) ?? '{}'); } catch { return {}; }
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
  return best ?? old ?? null;
}

/** "12분 전 기준" when the numbers are not fresh, so an old report is not read as current */
export function limitsAge(l: RateLimits, now: number): string | null {
  return now - l.at > 15 * 60_000 ? `${fmtAgo(now - l.at)} 기준` : null;
}

/** every agent's remaining usage in one small card (main window, top right) */
export function UsageStrip({ sessions, now }: { sessions: Snapshot[]; now: number }) {
  const rows = (['claude', 'codex', 'demo'] as const).map((a) => [a, latestLimits(sessions, a)] as const).filter((r) => r[1]);
  if (!rows.length) return null;
  return (
    <div className="usage-strip" title="남은 사용량 (에이전트가 알려준 요금제 한도)">
      {rows.map(([a, l]) => (
        <div key={a} className="us-agent">
          <AgentMark agent={a} size={14} />
          {l!.windows.map((w) => {
            const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
            return (
              <span key={w.minutes} className={`us-win ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={w.resetsAt && w.resetsAt > now ? `${fmtUntil(w.resetsAt - now)} 초기화` : undefined}>
                <em>{windowLabel(w.minutes)}</em>
                <span className="ov-lim-bar"><i style={{ width: `${left}%` }} /></span>
                <b>{left}%</b>
              </span>
            );
          })}
          {limitsAge(l!, now) && <small>{limitsAge(l!, now)}</small>}
        </div>
      ))}
    </div>
  );
}

/** remaining plan usage per agent, as each agent reports it (Claude status line, Codex log) */
export function Limits({ sessions, now }: { sessions: Snapshot[]; now: number }) {
  const rows = (['claude', 'codex', 'demo'] as const).map((a) => [a, latestLimits(sessions, a)] as const).filter((r) => r[1]);
  return (
    <>
      <h4>남은 사용량</h4>
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
        <p className="muted small ov-none">에이전트가 다음 응답을 받으면 5시간·주간 남은 양이 보여요. (Claude는 Pro·Max 요금제만)</p>
      )}
    </>
  );
}

export function LimitBar({ w, now }: { w: LimitWindow; now: number }) {
  const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
  const reset = w.resetsAt && w.resetsAt > now ? `${fmtUntil(w.resetsAt - now)} 초기화` : '';
  const resetShort = w.resetsAt && w.resetsAt > now ? `↻ ${fmtUntil(w.resetsAt - now).replace(' 후', '')}` : '';
  return (
    <div className={`ov-lim-row ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={`사용 ${Math.round(w.usedPct)}%${reset ? ` · ${reset}` : ''}`}>
      <span className="ov-lim-name">{windowLabel(w.minutes)}</span>
      <span className="ov-lim-bar"><i style={{ width: `${left}%` }} /></span>
      <b>{left}%</b>
      <span className="ov-lim-reset">{resetShort}</span>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`ov-stat tone-${tone} ${n ? '' : 'zero'}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function AgentRow({ s, now, on, onClick }: { s: Snapshot; now: number; on: boolean; onClick: () => void }) {
  const prog = progressOf(s);
  const step = s.plan.find((p) => p.status === 'in_progress');
  const t = turnMs(s, now);
  const eta = etaMs(s, now);
  const tone = stateTone(s);
  const busy = isActive(s);
  const doing = busy ? doingLabel(s) : null;
  const name = s.project ?? '프로젝트 미확인';
  return (
    <button className={`ov-row ${busy ? '' : 'quiet'} ${on ? 'on' : ''} t-${tone}`} onClick={onClick} title={`${name}${s.cwd ? `\n${s.cwd}` : ''}`}>
      <div className="ov-top">
        <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
        <span className="ov-proj">{name}</span>
        <span className={`ov-state tone-${tone}`}>
          <i className="pulse" />
          {stateLabel(s)}
        </span>
      </div>
      {doing && doing !== stateLabel(s) && <div className="ov-doing">{doing}</div>}
      {busy ? (
        <div className="ov-meta">
          {prog ? (
            <>
              <span className="ov-bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
              <span className="ov-n">{prog.done}/{prog.total}</span>
            </>
          ) : <span className="ov-fill" />}
          {t !== null && <span className="ov-time"><Icon name="clock" />{fmtDuration(t)}</span>}
          {eta !== null && <span className="ov-eta" title="끝난 단계의 평균 시간으로 계산한 추정치예요">약 {Math.max(1, Math.round(eta / 60000))}분 남음</span>}
        </div>
      ) : (
        <div className="ov-meta quiet">
          {t !== null && <span>소요 {fmtDuration(t)}</span>}
          <span>마지막 활동 {fmtAgo(now - s.lastEventAt)}</span>
        </div>
      )}
      {busy && (step || s.subagents > 0) && (
        <div className="ov-step">
          {step && <><Icon name="play" /><span>{step.text}</span></>}
          {s.subagents > 0 && <em>하위 에이전트 {s.subagents}</em>}
        </div>
      )}
    </button>
  );
}
