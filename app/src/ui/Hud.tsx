import type { RateLimits, Snapshot } from '../types';
import { activityLabel, AGENT_NAME, fmtAgo, fmtDuration, stateLabel, stateTone, windowLabel } from '../labels';
import { AgentMark } from './icons';

export function progressOf(s: Snapshot): { done: number; total: number } | null {
  if (!s.plan.length) return null;
  return { done: s.plan.filter((p) => p.status === 'completed').length, total: s.plan.length };
}

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

export function Hud({ s, now, limits, onOpenApp }: { s: Snapshot; now: number; limits: RateLimits | null; onOpenApp?: () => void }) {
  const tone = stateTone(s);
  const prog = progressOf(s);
  const active = ACTIVE.includes(s.state) && s.connection === 'live';
  const turnMs = s.turnStartedAt ? (s.turnEndedAt && !active ? s.turnEndedAt : now) - s.turnStartedAt : null;
  return (
    <div className="card hud">
      <div className="hud-main">
        <div className="hud-head">
          <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
          <span className="hud-agent">{AGENT_NAME[s.agent]}</span>
          {s.isDemo && <span className="tag demo">DEMO</span>}
          <span className="hud-project" title={s.cwd ?? ''}>{s.project ?? '프로젝트 미확인'}</span>
        </div>
        <div className={`hud-state tone-${tone}`}>
          <span className="pulse" />
          {stateLabel(s)}
          {onOpenApp && <button className="btn open-app" onClick={onOpenApp} title="이 에이전트가 일하는 터미널·편집기·앱을 앞으로 가져와요">앱 열기 ↗</button>}
        </div>
        {s.tool && s.connection === 'live' && (
          <div className="hud-tool">
            <span className="chip">{activityLabel(s.activity)}</span> {s.tool}
            {s.detail && <b className="detail"> · {s.detail}</b>}
          </div>
        )}
      </div>
      <dl className="hud-grid">
        {turnMs !== null && (
          <>
            <dt>{active ? '작업 시간' : '소요 시간'}</dt>
            <dd>{fmtDuration(turnMs)}</dd>
          </>
        )}
        <dt>마지막 활동</dt>
        <dd>{fmtAgo(now - s.lastEventAt)}</dd>
        {prog && (
          <>
            <dt>진행</dt>
            <dd>
              <span className="prog" title="에이전트가 보고한 작업 목록 기준">
                <span className="bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
                {prog.done}/{prog.total}
              </span>
            </dd>
          </>
        )}
        {limits && (
          <>
            <dt>남은 사용량</dt>
            <dd title="에이전트가 알려준 요금제 한도 기준이에요">{limits.windows.map((w) => `${windowLabel(w.minutes)} ${Math.max(0, Math.round(100 - w.usedPct))}%`).join(' · ')}</dd>
          </>
        )}
      </dl>
      <Callouts s={s} now={now} />
    </div>
  );
}

function Callouts({ s, now }: { s: Snapshot; now: number }) {
  if (s.connection === 'stale')
    return (
      <div className="callout muted">
        {fmtAgo(now - s.lastEventAt)}부터 새 이벤트가 없어요. 오래 걸리는 명령을 실행 중일 수도 있지만, 지금 상태를 확정할 수 없어요.
      </div>
    );
  if (s.connection === 'lost') return <div className="callout muted">에이전트 프로세스가 종료 이벤트 없이 사라졌어요.</div>;
  if (s.connection === 'ended') return <div className="callout muted">세션이 종료됐어요.</div>;
  if (s.waiting)
    return (
      <div className="callout wait">
        {s.waiting.kind === 'approval'
          ? `${s.waiting.tool ?? '도구'} 실행 승인을 기다리고 있어요. 에이전트가 일하는 앱에서 확인해 주세요.`
          : '답변을 기다리고 있어요. 에이전트가 일하는 앱에서 확인해 주세요.'}
        <span className="since">{fmtAgo(now - s.waiting.since)}</span>
      </div>
    );
  if (s.state === 'error' && s.error)
    return (
      <div className="callout bad">
        {s.error.fatal ? '작업이 오류로 중단됐어요' : `${s.error.tool ?? '도구'} 실행 실패`}
        {s.error.message && <code>{s.error.message}</code>}
      </div>
    );
  return null;
}
