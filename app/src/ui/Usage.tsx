// "사용량": tokens per day stacked by agent, each agent's plan limits, the last 10 minutes and streaks.
// Tokens come from the usage counters in the agents' own local logs; limits from what each agent
// reports (Claude's status line, Codex's log). Nothing here calls a model.
import { useEffect, useState } from 'react';
import { backend } from '../bridge';
import { fmtTokens, fmtUntil, paceNote, windowLabel } from '../labels';
import type { RateLimits, Snapshot, UsageHistory } from '../types';
import { AgentMark } from './icons';
import { claudeAccountWhy, latestLimits, limitsAge } from './Overview';
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
    // the scan only reads what the logs gained since the last one, so this can run often
    const id = window.setInterval(() => !document.hidden && load(), 15_000);
    return () => { live = false; clearInterval(id); };
  }, [days]);
  return h;
}

export { fmtTokens };

/** one card per agent: each limit window with what is left and when it resets */
export function LimitCards({ sessions, now, dark, ring, accountLimits, onSettings, agents = AGENTS }: { sessions: Snapshot[]; now: number; dark?: boolean; /** each window as a ring gauge (the dashboard) */ ring?: boolean; accountLimits?: boolean; onSettings?: () => void; /** which agents get a card (all by default) */ agents?: readonly ('claude' | 'codex')[] }) {
  return (
    <div className={`lc-grid ${dark ? 'dark' : ''} ${ring ? 'rings' : ''}`}>
      {agents.map((a) => <LimitCard key={a} agent={a} l={latestLimits(sessions, a)} now={now} ring={ring} why={noLimitsWhy(a, sessions, accountLimits)} staleWhy={staleWhy(a, accountLimits)} onSettings={onSettings} />)}
    </div>
  );
}

/** why a limit card is empty, so the user knows whether to wait or change something */
function noLimitsWhy(agent: 'claude' | 'codex', sessions: Snapshot[], accountLimits?: boolean): { text: string; fix?: boolean } {
  const seen = sessions.some((s) => !s.isDemo && s.agent === agent);
  if (agent === 'claude' && accountLimits === false) return { text: L("'Claude 계정에서 받아오기'를 켜면 데스크톱 앱과 VS Code 세션의 한도도 보여요.", "Turn on 'Get from the Claude account' to see limits for desktop app and VS Code sessions too."), fix: true };
  if (agent === 'claude' && accountLimits !== false && claudeAccountWhy === 'login') return { text: L('이 Mac에서 Claude Code에 로그인하면 계정 한도도 보여요.', 'Sign in to Claude Code on this Mac to see account limits too.') };
  if (agent === 'claude' && accountLimits !== false && claudeAccountWhy === 'expired') return { text: L('사용량을 받아올 터미널 Claude Code 로그인이 오래됐어요. 터미널에서 claude 를 한 번 실행하면 갱신돼요. 연결 문제는 아니에요.', 'The terminal Claude Code sign-in used to get usage is out of date. Run claude in a terminal once to renew it. The connection is fine.') };
  if (agent === 'claude' && accountLimits !== false && claudeAccountWhy === 'failed') return { text: L('계정에서 한도를 받아오지 못했어요. 잠시 뒤 다시 시도해요.', "Couldn't get limits from the account. Trying again shortly.") };
  if (!seen) return { text: L(`${NAME[agent]} 세션이 아직 없어요. 세션이 응답하면 보여요.`, `No ${NAME[agent]} session yet. Limits show once one replies.`) };
  return { text: agent === 'claude' ? L('다음 응답부터 보여요. Pro와 Max 요금제만 한도가 있어요.', 'Shows from the next reply. Only Pro and Max plans have limits.') : L('다음 응답부터 보여요.', 'Shows from the next reply.') };
}

/** why the numbers shown are old, so "64시간 전 기준" doesn't look like a silent bug */
function staleWhy(agent: 'claude' | 'codex', accountLimits?: boolean): string | null {
  if (agent === 'codex') return L('Codex에서 새 값을 받지 못해 마지막으로 받은 값이에요. Codex에 로그인돼 있으면 5분 안에 다시 받아와요.', "Couldn't get new numbers from Codex, so this is the last one. If Codex is signed in, it is asked again within 5 minutes.");
  if (accountLimits === false) return null;
  if (claudeAccountWhy === 'login') return L('이 Mac의 Claude Code 로그인을 찾지 못해 계정에서 새로 받아오지 못했어요.', "Couldn't find the Claude Code sign-in on this Mac, so the account wasn't asked.");
  if (claudeAccountWhy === 'expired') return L("터미널 Claude Code 로그인이 만료돼 새로 받아오지 못했어요. 터미널에서 claude 를 한 번 실행하거나 설정의 '만료된 로그인 자동 갱신'을 켜면 갱신돼요.", "The terminal Claude Code sign-in has expired. Run claude in a terminal once, or turn on 'Renew an expired login' in settings.");
  if (claudeAccountWhy === 'failed') return L('계정에서 새 값을 받아오지 못했어요. 잠시 뒤 다시 시도해요.', "Couldn't get new numbers from the account. Trying again shortly.");
  return null;
}

/** what is left of one window as a ring with the percentage inside */
function Ring({ left }: { left: number }) {
  const r = 24;
  const len = 2 * Math.PI * r;
  return (
    <svg className="lc-ring" viewBox="0 0 60 60" aria-hidden>
      <circle cx="30" cy="30" r={r} className="trk" />
      <circle cx="30" cy="30" r={r} className="val" strokeDasharray={`${(left / 100) * len} ${len}`} transform="rotate(-90 30 30)" />
      <text x="30" y="34.5" textAnchor="middle">{left}%</text>
    </svg>
  );
}

function LimitCard({ agent, l, now, ring, why, staleWhy, onSettings }: { agent: 'claude' | 'codex'; l: RateLimits | null; now: number; ring?: boolean; why: { text: string; fix?: boolean }; staleWhy: string | null; onSettings?: () => void }) {
  const stale = !!l && !!limitsAge(l, now);
  // a pace worked out from an old report would be wrong now
  const pace = (w: RateLimits['windows'][number]) => (stale ? null : paceNote(w, l!.at));
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
          if (ring)
            return (
              <div key={w.minutes} className={`lc-row lc-r ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`} title={pace(w) ?? undefined}>
                <Ring left={left} />
                <span className="lc-name">{windowLabel(w.minutes)}</span>
                {w.resetsAt && w.resetsAt > now && <small className="lc-reset">{fmtUntil(w.resetsAt - now)}</small>}
              </div>
            );
          return (
            <div key={w.minutes} className={`lc-row ${left <= 10 ? 'low' : left <= 30 ? 'mid' : ''}`}>
              <span className="lc-name">{w.minutes <= 300 ? `${L('세션', 'Session')} (${windowLabel(w.minutes)})` : windowLabel(w.minutes)}</span>
              <span className={`lc-bar a-${agent}`}><i style={{ width: `${left}%` }} /></span>
              <div className="lc-foot"><b>{L(`${left}% 남음`, `${left}% left`)}</b><small>{reset}</small></div>
              {pace(w) && <small className="lc-pace">{pace(w)}</small>}
            </div>
          );
        })
      ) : null}
      {stale && staleWhy && <p className="lc-none">{staleWhy}</p>}
      {!l && (
        <p className="lc-none">{why.text}{why.fix && onSettings && <> <button className="link" onClick={onSettings}>{L('설정 열기', 'Open settings')}</button></>}</p>
      )}
    </div>
  );
}
