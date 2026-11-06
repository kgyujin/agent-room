// "사용량": tokens per day stacked by agent, each agent's plan limits, the last 10 minutes and streaks.
// Tokens come from the usage counters in the agents' own local logs; limits from what each agent
// reports (Claude's status line, Codex's log). Nothing here calls a model.
import { useEffect, useState } from 'react';
import { backend } from '../bridge';
import { fmtTokens, fmtUntil, paceNote, windowLabel } from '../labels';
import type { RateLimits, Snapshot, UsageHistory } from '../types';
import { AgentMark } from './icons';
import { latestLimits, limitsAge } from './Overview';
import { L } from '../i18n';

const AGENTS = ['claude', 'codex'] as const;
const NAME = { claude: 'Claude Code', codex: 'Codex' } as const;

/** loads the history now and every minute while mounted */
export function useUsageHistory(days: number): UsageHistory | null {
  const [h, setH] = useState<UsageHistory | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void backend.usageHistory(days).then((r) => live && setH(r)).catch(() => undefined);
    load();
    const id = window.setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [days]);
  return h;
}

export { fmtTokens };

const dayLabel = (day: number) => {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export function UsageBoard({ sessions, now, days = 30 }: { sessions: Snapshot[]; now: number; days?: number }) {
  const h = useUsageHistory(days);
  return (
    <div className="ub">
      <section className="ub-card">
        <TokenChart h={h} />
      </section>
      <section className="ub-card">
        <h4>{L('에이전트 한도', 'Agent limits')}</h4>
        <LimitCards sessions={sessions} now={now} />
      </section>
      <section className="ub-card">
        <h4>{L('최근 10분', 'Last 10 minutes')} <span className="pn-count">{h ? `${fmtTokens(h.recentClaude + h.recentCodex)} ${L('토큰', 'tokens')}` : ''}</span></h4>
        <Rate h={h} />
      </section>
      <section className="ub-card ub-streak">
        <div><b>{h?.streakLongest ?? 0}</b><span>{L('일', 'days')}</span><small>{L('가장 오래 연속 사용', 'Longest streak')}</small></div>
        <div><b>{h?.streakCurrent ?? 0}</b><span>{L('일', 'days')}</span><small>{L('지금 연속 사용', 'Current streak')}</small></div>
      </section>
      <p className="pn-note">{L('토큰은 각 에이전트가 이 컴퓨터에 남긴 로그의 사용량 숫자만 더한 값이에요. 대화 내용은 읽지 않아요.', 'Tokens add up only the usage numbers in the logs each agent keeps on this computer. Conversations are never read.')}</p>
    </div>
  );
}

function TokenChart({ h }: { h: UsageHistory | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!h) return <p className="pn-note">{L('로그에서 사용량을 모으는 중…', 'Reading usage from the logs…')}</p>;
  const total = h.days.reduce((a, d) => a + d.claude + d.codex, 0);
  const active = h.days.filter((d) => d.claude + d.codex > 0).length;
  const best = h.days.reduce((m, d) => (d.claude + d.codex > m.claude + m.codex ? d : m), h.days[0]);
  const max = Math.max(1, ...h.days.map((d) => d.claude + d.codex));
  const shown = hover !== null ? h.days[hover] : null;
  return (
    <>
      <div className="ub-head">
        <h4>{L('토큰 사용량', 'Token usage')} <span className="ub-sub">{L(`최근 ${h.days.length}일`, `last ${h.days.length} days`)}</span></h4>
        <span className="ub-legend"><i className="a-claude" />Claude <i className="a-codex" />Codex</span>
      </div>
      <div className="ub-stats">
        <div><b>{fmtTokens(total)}</b><small>{L(`합계 · ${active}일 사용`, `total · ${active} active days`)}</small></div>
        <div><b>{best && best.claude + best.codex ? fmtTokens(best.claude + best.codex) : '—'}</b><small>{L('가장 많은 날', 'Busiest day')}{best && best.claude + best.codex ? ` · ${dayLabel(best.day)}` : ''}</small></div>
        <div className="ub-pick">
          {shown ? <><b>{fmtTokens(shown.claude + shown.codex)}</b><small>{dayLabel(shown.day)} · Claude {fmtTokens(shown.claude)} · Codex {fmtTokens(shown.codex)}</small></> : <><b>{fmtTokens(h.days[h.days.length - 1].claude + h.days[h.days.length - 1].codex)}</b><small>{L('오늘', 'Today')}</small></>}
        </div>
      </div>
      <div className="ub-chart" onMouseLeave={() => setHover(null)}>
        {h.days.map((d, i) => (
          <div key={d.day} className={`ub-col ${hover === i ? 'on' : ''}`} onMouseEnter={() => setHover(i)}>
            <i className="a-codex" style={{ height: `${(d.codex / max) * 100}%` }} />
            <i className="a-claude" style={{ height: `${(d.claude / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="ub-axis"><span>{dayLabel(h.days[0].day)}</span><span>{dayLabel(h.days[h.days.length - 1].day)}</span></div>
    </>
  );
}

/** one card per agent: each limit window with what is left and when it resets */
export function LimitCards({ sessions, now, dark, accountLimits, onSettings }: { sessions: Snapshot[]; now: number; dark?: boolean; accountLimits?: boolean; onSettings?: () => void }) {
  return (
    <div className={`lc-grid ${dark ? 'dark' : ''}`}>
      {AGENTS.map((a) => <LimitCard key={a} agent={a} l={latestLimits(sessions, a)} now={now} why={noLimitsWhy(a, sessions, accountLimits)} onSettings={onSettings} />)}
    </div>
  );
}

/** why a limit card is empty, so the user knows whether to wait or change something */
function noLimitsWhy(agent: 'claude' | 'codex', sessions: Snapshot[], accountLimits?: boolean): { text: string; fix?: boolean } {
  const seen = sessions.some((s) => !s.isDemo && s.agent === agent);
  if (agent === 'claude' && accountLimits === false) return { text: L("'Claude 계정에서 받아오기'를 켜면 데스크톱 앱·VS Code 세션의 한도도 보여요.", "Turn on 'Get from the Claude account' to see limits for desktop app and VS Code sessions too."), fix: true };
  if (!seen) return { text: L(`${NAME[agent]} 세션이 아직 없어요. 세션이 응답하면 보여요.`, `No ${NAME[agent]} session yet. Limits show once one replies.`) };
  return { text: agent === 'claude' ? L('다음 응답부터 보여요. Pro·Max 요금제만 한도가 있어요.', 'Shows from the next reply. Only Pro and Max plans have limits.') : L('다음 응답부터 보여요.', 'Shows from the next reply.') };
}

function LimitCard({ agent, l, now, why, onSettings }: { agent: 'claude' | 'codex'; l: RateLimits | null; now: number; why: { text: string; fix?: boolean }; onSettings?: () => void }) {
  return (
    <div className="lc">
      <div className="lc-head">
        <AgentMark agent={agent} size={16} />
        <b>{NAME[agent]}</b>
        {l && limitsAge(l, now) && <small>{limitsAge(l, now)}</small>}
      </div>
      {l ? (
        l.windows.map((w) => {
          const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
          const reset = w.resetsAt && w.resetsAt > now ? L(`${fmtUntil(w.resetsAt - now)} 초기화`, `resets ${fmtUntil(w.resetsAt - now)}`) : '';
          return (
            <div key={w.minutes} className={`lc-row ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`}>
              <span className="lc-name">{w.minutes <= 300 ? `${L('세션', 'Session')} · ${windowLabel(w.minutes)}` : windowLabel(w.minutes)}</span>
              <span className={`lc-bar a-${agent}`}><i style={{ width: `${left}%` }} /></span>
              <div className="lc-foot"><b>{L(`${left}% 남음`, `${left}% left`)}</b><small>{reset}</small></div>
              {paceNote(w, l.at) && <small className="lc-pace">{paceNote(w, l.at)}</small>}
            </div>
          );
        })
      ) : (
        <p className="lc-none">{why.text}{why.fix && onSettings && <> <button className="link" onClick={onSettings}>{L('설정 열기', 'Open settings')}</button></>}</p>
      )}
    </div>
  );
}

function Rate({ h }: { h: UsageHistory | null }) {
  const rows = [['claude', h?.recentClaude ?? 0], ['codex', h?.recentCodex ?? 0]] as const;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="ub-rate">
      {rows.map(([a, n]) => (
        <div key={a} className="ub-rate-row">
          <AgentMark agent={a} size={14} />
          <span>{NAME[a]}</span>
          <span className={`lc-bar a-${a}`}><i style={{ width: `${(n / max) * 100}%` }} /></span>
          <b>{fmtTokens(Math.round(n / 10))}/{L('분', 'min')}</b>
        </div>
      ))}
    </div>
  );
}
