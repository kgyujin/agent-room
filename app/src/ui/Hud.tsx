import type { Snapshot } from '../types';
import { activityLabel, AGENT_NAME, fmtAgo, fmtDuration, stateLabel, stateTone } from '../labels';
import { AgentMark, Icon } from './icons';

export function progressOf(s: Snapshot): { done: number; total: number } | null {
  if (!s.plan.length) return null;
  return { done: s.plan.filter((p) => p.status === 'completed').length, total: s.plan.length };
}

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

/**
 * The selected session in one line at the bottom of the room: who, what state, what it is doing
 * (or what it needs from the user), how long, how far, and a button to open it.
 */
export function Hud({ s, now, onOpenApp }: { s: Snapshot; now: number; onOpenApp?: () => void }) {
  const tone = stateTone(s);
  const prog = progressOf(s);
  const active = ACTIVE.includes(s.state) && s.connection === 'live';
  const turnMs = s.turnStartedAt ? (s.turnEndedAt && !active ? s.turnEndedAt : now) - s.turnStartedAt : null;
  const note = noteOf(s, now);
  const doing = s.tool && s.connection === 'live' ? [activityLabel(s.activity), s.tool, s.detail].filter(Boolean).join(' · ') : null;
  return (
    <div className={`card shud t-${tone}`}>
      <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={20} />
      <div className="shud-id">
        <b title={s.cwd ?? ''}>{s.project ?? '프로젝트 미확인'}</b>
        <small>{AGENT_NAME[s.agent]}{s.isDemo && <span className="tag demo">DEMO</span>}</small>
      </div>
      <div className={`shud-state tone-${tone}`}><i className="pulse" />{stateLabel(s)}</div>
      <div className={`shud-what ${note ? `note ${note.tone}` : ''}`} title={note?.text ?? doing ?? ''}>
        {note ? note.text : doing ?? `마지막 활동 ${fmtAgo(now - s.lastEventAt)}`}
      </div>
      {prog && (
        <span className="shud-prog" title="에이전트가 보고한 작업 목록 기준">
          <span className="bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
          {prog.done}/{prog.total}
        </span>
      )}
      {turnMs !== null && <span className="shud-time" title={active ? '작업 시간' : '소요 시간'}><Icon name="clock" />{fmtDuration(turnMs)}</span>}
      {onOpenApp && <button className="btn primary open-app" onClick={onOpenApp} title="이 세션이 열린 터미널 탭·편집기 창·Codex 대화로 이동해요">세션 열기</button>}
    </div>
  );
}

/** what the user should know about this session right now, if anything beyond its state */
function noteOf(s: Snapshot, now: number): { tone: 'wait' | 'bad' | 'muted'; text: string } | null {
  if (s.connection === 'stale') return { tone: 'muted', text: `${fmtAgo(now - s.lastEventAt)}부터 소식이 없어요. 오래 걸리는 명령일 수 있어요.` };
  if (s.connection === 'lost') return { tone: 'muted', text: '에이전트 프로세스가 종료 이벤트 없이 사라졌어요.' };
  if (s.connection === 'ended') return { tone: 'muted', text: '세션이 끝났어요.' };
  if (s.waiting)
    return { tone: 'wait', text: `${s.waiting.kind === 'approval' ? `${s.waiting.tool ?? '도구'} 실행 승인` : '답변'}을 기다려요 · ${fmtAgo(now - s.waiting.since)}` };
  if (s.state === 'error' && s.error)
    return { tone: 'bad', text: `${s.error.fatal ? '작업이 오류로 중단됐어요' : `${s.error.tool ?? '도구'} 실행 실패`}${s.error.message ? ` · ${s.error.message}` : ''}` };
  return null;
}
