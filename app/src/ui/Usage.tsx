// "사용량": tokens per day stacked by agent, each agent's plan limits, the last 10 minutes and streaks.
// Tokens come from the usage counters in the agents' own local logs; limits from what each agent
// reports (Claude's status line, Codex's log). Nothing here calls a model.
import { useEffect, useState } from 'react';
import { backend } from '../bridge';
import { fmtUntil, paceNote, windowLabel } from '../labels';
import type { RateLimits, Snapshot, UsageHistory } from '../types';
import { AgentMark } from './icons';
import { latestLimits, limitsAge } from './Overview';

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

/** 5.2B, 340M, 12.4K, 980 */
export function fmtTokens(n: number): string {
  const f = (v: number, u: string) => `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '')}${u}`;
  if (n >= 1e9) return f(n / 1e9, 'B');
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e3) return f(n / 1e3, 'K');
  return String(n);
}

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
        <h4>에이전트 한도</h4>
        <LimitCards sessions={sessions} now={now} />
      </section>
      <section className="ub-card">
        <h4>최근 10분 <span className="pn-count">{h ? `${fmtTokens(h.recentClaude + h.recentCodex)} 토큰` : ''}</span></h4>
        <Rate h={h} />
      </section>
      <section className="ub-card ub-streak">
        <div><b>{h?.streakLongest ?? 0}</b><span>일</span><small>가장 오래 연속 사용</small></div>
        <div><b>{h?.streakCurrent ?? 0}</b><span>일</span><small>지금 연속 사용</small></div>
      </section>
      <p className="pn-note">토큰은 각 에이전트가 이 컴퓨터에 남긴 로그의 사용량 숫자만 더한 값이에요. 대화 내용은 읽지 않아요.</p>
    </div>
  );
}

function TokenChart({ h }: { h: UsageHistory | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!h) return <p className="pn-note">로그에서 사용량을 모으는 중…</p>;
  const total = h.days.reduce((a, d) => a + d.claude + d.codex, 0);
  const active = h.days.filter((d) => d.claude + d.codex > 0).length;
  const best = h.days.reduce((m, d) => (d.claude + d.codex > m.claude + m.codex ? d : m), h.days[0]);
  const max = Math.max(1, ...h.days.map((d) => d.claude + d.codex));
  const shown = hover !== null ? h.days[hover] : null;
  return (
    <>
      <div className="ub-head">
        <h4>토큰 사용량 <span className="ub-sub">최근 {h.days.length}일</span></h4>
        <span className="ub-legend"><i className="a-claude" />Claude <i className="a-codex" />Codex</span>
      </div>
      <div className="ub-stats">
        <div><b>{fmtTokens(total)}</b><small>합계 · {active}일 사용</small></div>
        <div><b>{best && best.claude + best.codex ? fmtTokens(best.claude + best.codex) : '—'}</b><small>가장 많은 날{best && best.claude + best.codex ? ` · ${dayLabel(best.day)}` : ''}</small></div>
        <div className="ub-pick">
          {shown ? <><b>{fmtTokens(shown.claude + shown.codex)}</b><small>{dayLabel(shown.day)} · Claude {fmtTokens(shown.claude)} · Codex {fmtTokens(shown.codex)}</small></> : <><b>{fmtTokens(h.days[h.days.length - 1].claude + h.days[h.days.length - 1].codex)}</b><small>오늘</small></>}
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
export function LimitCards({ sessions, now, dark }: { sessions: Snapshot[]; now: number; dark?: boolean }) {
  return (
    <div className={`lc-grid ${dark ? 'dark' : ''}`}>
      {AGENTS.map((a) => <LimitCard key={a} agent={a} l={latestLimits(sessions, a)} now={now} />)}
    </div>
  );
}

function LimitCard({ agent, l, now }: { agent: 'claude' | 'codex'; l: RateLimits | null; now: number }) {
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
          const reset = w.resetsAt && w.resetsAt > now ? `${fmtUntil(w.resetsAt - now)} 초기화` : '';
          return (
            <div key={w.minutes} className={`lc-row ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`}>
              <span className="lc-name">{w.minutes <= 300 ? `세션 · ${windowLabel(w.minutes)}` : windowLabel(w.minutes)}</span>
              <span className={`lc-bar a-${agent}`}><i style={{ width: `${left}%` }} /></span>
              <div className="lc-foot"><b>{left}% 남음</b><small>{reset}</small></div>
              {paceNote(w, l.at) && <small className="lc-pace">{paceNote(w, l.at)}</small>}
            </div>
          );
        })
      ) : (
        <p className="lc-none">아직 정보가 없어요. 다음 응답부터 보여요.</p>
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
          <b>{fmtTokens(Math.round(n / 10))}/분</b>
        </div>
      ))}
    </div>
  );
}
