import type { Snapshot } from '../types';
import { activityLabel, AGENT_NAME, fmtAgo, fmtClock, fmtDuration, fmtTokens, stateLabel, stateTone } from '../labels';
import { Icon } from './icons';

export function progressOf(s: Snapshot): { done: number; total: number } | null {
  if (!s.plan.length) return null;
  return { done: s.plan.filter((p) => p.status === 'completed').length, total: s.plan.length };
}

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

export function Hud({ s, now, showTokens }: { s: Snapshot; now: number; showTokens: boolean }) {
  const tone = stateTone(s);
  const prog = progressOf(s);
  const active = ACTIVE.includes(s.state) && s.connection === 'live';
  const turnMs = s.turnStartedAt ? (s.turnEndedAt && !active ? s.turnEndedAt : now) - s.turnStartedAt : null;
  return (
    <div className="card hud">
      <div className="hud-main">
        <div className="hud-head">
          <span className={`agent-dot a-${s.agent}`} />
          <span className="hud-agent">{AGENT_NAME[s.agent]}</span>
          {s.isDemo && <span className="tag demo">DEMO</span>}
          <span className="hud-project" title={s.cwd ?? ''}>{s.project ?? '프로젝트 미확인'}</span>
        </div>
        <div className={`hud-state tone-${tone}`}>
          <span className="pulse" />
          {stateLabel(s)}
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
        {s.turnStartedAt && (
          <>
            <dt>작업 시작</dt>
            <dd>{fmtClock(s.turnStartedAt)}</dd>
          </>
        )}
        <dt>마지막 활동</dt>
        <dd>{fmtAgo(now - s.lastEventAt)}</dd>
        <dt>진행</dt>
        <dd>
          {prog ? (
            <span className="prog" title="Agent가 보고한 작업 목록 기준">
              <span className="bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
              {prog.done}/{prog.total}
            </span>
          ) : active ? '진행 중' : s.completedTurns > 0 ? `완료 ${s.completedTurns}회` : '—'}
        </dd>
        {showTokens && s.tokens && (
          <>
            <dt>토큰</dt>
            <dd title={`캐시 읽기 ${fmtTokens(s.tokens.cacheRead)} · 캐시 쓰기 ${fmtTokens(s.tokens.cacheWrite)} · 출처: ${s.tokens.source} (로컬 로그)`}>
              입력 {fmtTokens(s.tokens.input)} · 출력 {fmtTokens(s.tokens.output)}
            </dd>
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
  if (s.connection === 'lost') return <div className="callout muted">Agent 프로세스가 종료 이벤트 없이 사라졌어요.</div>;
  if (s.connection === 'ended') return <div className="callout muted">세션이 종료됐어요.</div>;
  if (s.waiting)
    return (
      <div className="callout wait">
        {s.waiting.kind === 'approval'
          ? `${s.waiting.tool ?? '도구'} 실행 승인을 기다리고 있어요. 터미널에서 확인해 주세요.`
          : s.waiting.message ?? 'Agent가 입력을 기다리고 있어요.'}
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

export function MiniPill({ s, now, onExpand }: { s: Snapshot | null; now: number; onExpand?: () => void }) {
  const prog = s ? progressOf(s) : null;
  return (
    <div className="mini-pill">
      {s ? (
        <>
          <span className={`agent-dot a-${s.agent}`} />
          <span className={`tone-${stateTone(s)} mini-state`}>{stateLabel(s)}</span>
          {s.detail && s.connection === 'live' && <span className="mini-detail">{s.detail}</span>}
          <span className="mini-time">
            {prog ? `${prog.done}/${prog.total} · ` : ''}
            {s.turnStartedAt ? fmtDuration((s.turnEndedAt && s.state === 'completed' ? s.turnEndedAt : now) - s.turnStartedAt) : ''}
          </span>
        </>
      ) : (
        <span className="mini-state">연결된 Agent 없음</span>
      )}
      {onExpand && (
        <button className="tool" onClick={onExpand} title="창으로 보기" aria-label="창으로 보기">
          <Icon name="expand" />
        </button>
      )}
    </div>
  );
}
