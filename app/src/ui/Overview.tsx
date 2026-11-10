// Session and usage helpers shared by the dashboard, island and popover. Everything comes from
// hook events; the only derived number is the remaining-time estimate, labelled as one.
import { useEffect } from 'react';
import { backend } from '../bridge';
import type { LimitWindow, RateLimits, Snapshot } from '../types';
import { fmtAgo, fmtUntil, windowLabel, withResets } from '../labels';
import { AgentMark } from './icons';
import { progressOf } from './Hud';
import { L } from '../i18n';

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

export const isActive = (s: Snapshot) => s.connection === 'live' && ACTIVE.includes(s.state);

/** where a session's elapsed time stops: its last event once it has ended or its process is gone */
export const spanEnd = (s: Snapshot, now: number) => (s.connection === 'ended' || s.connection === 'lost' ? s.lastEventAt : now);

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

/** how long the current or last turn ran; a turn that went quiet (no news, gone) stops at its last event */
export function turnMs(s: Snapshot, now: number) {
  if (!s.turnStartedAt) return null;
  return (isActive(s) ? now : s.turnEndedAt ?? s.lastEventAt) - s.turnStartedAt;
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

const LIMITS_KEY = 'lastLimits';
function remembered(): Partial<Record<Snapshot['agent'], RateLimits>> {
  try { return JSON.parse(localStorage.getItem(LIMITS_KEY) ?? '{}'); } catch { return {}; }
}

/** Account usage that shows even when no session here reported it (the desktop app, VS Code, or
 *  before Agent Room started): Codex's from its newest log, Claude's from the account when that is
 *  turned on (the backend asks at most every 5 minutes). Asked once a minute, kept like any other report. */
/** why the last ask of the Claude account got no usage, null once it answers */
export let claudeAccountWhy: 'login' | 'expired' | 'failed' | null = null;

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
      void backend.claudeLimits().then((r) => { claudeAccountWhy = r.why; keep('claude')(r.limits); }).catch(() => {});
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
    return withResets(best);
  }
  // the newest report wins: a session that is still open may hold an older one than the cache
  return withResets(old && (!best || old.at > best.at) ? old : best);
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
    <button className="usage-strip" onClick={onOpen} disabled={!onOpen} title={L('남은 사용량이에요. 누르면 자세히 볼 수 있어요', 'Usage left. Click for details')}>
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
        <p className="muted small ov-none">{L('에이전트가 다음 응답을 받으면 5시간과 주간 남은 양이 보여요. Claude는 Pro와 Max 요금제에서만 보여요.', 'The 5-hour and weekly usage left shows after the next reply. For Claude, only on Pro and Max plans.')}</p>
      )}
    </>
  );
}

export function LimitBar({ w, now }: { w: LimitWindow; now: number }) {
  const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
  const reset = w.resetsAt && w.resetsAt > now ? L(`${fmtUntil(w.resetsAt - now)} 초기화`, `resets ${fmtUntil(w.resetsAt - now)}`) : '';
  const resetShort = w.resetsAt && w.resetsAt > now ? `↻ ${fmtUntil(w.resetsAt - now).replace(' 후', '').replace('in ', '')}` : '';
  return (
    <div className={`ov-lim-row ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={`${L('사용', 'Used')} ${Math.round(w.usedPct)}%${reset ? `, ${reset}` : ''}`}>
      <span className="ov-lim-name">{windowLabel(w.minutes)}</span>
      <span className="ov-lim-bar"><i style={{ width: `${left}%` }} /></span>
      <b>{left}%</b>
      <span className="ov-lim-reset">{resetShort}</span>
    </div>
  );
}
