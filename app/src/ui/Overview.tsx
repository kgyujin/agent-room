// "현황" tab: every session at a glance, sorted by what needs the user first.
// Everything shown comes from hook events; the only derived number is the remaining-time
// estimate, which is labelled as one and only appears once a plan step has finished.
import type { Snapshot } from '../types';
import { activityLabel, fmtAgo, fmtDuration, fmtTokens, stateLabel, stateTone } from '../labels';
import { AgentMark } from './icons';
import { progressOf } from './Hud';

const ACTIVE = ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'waiting', 'error'];

export const isActive = (s: Snapshot) => s.connection === 'live' && ACTIVE.includes(s.state);

/** what the user has to do for this session, if anything */
export function userTodo(s: Snapshot, now: number): { text: string; since: number } | null {
  if (s.connection !== 'live') return null;
  if (s.waiting)
    return {
      text: s.waiting.kind === 'approval' ? `${s.waiting.tool ?? '도구'} 실행 승인` : s.waiting.message ?? '답변 입력',
      since: s.waiting.since,
    };
  if (s.state === 'error') return { text: s.lastTest?.ok === false ? '테스트 실패 확인' : '오류 확인', since: s.error?.at ?? now };
  return null;
}

function turnMs(s: Snapshot, now: number) {
  if (!s.turnStartedAt) return null;
  return (s.turnEndedAt && !isActive(s) ? s.turnEndedAt : now) - s.turnStartedAt;
}

/** rough time left: average time per finished plan step x steps left (null until one step is done) */
export function etaMs(s: Snapshot, now: number): number | null {
  const p = progressOf(s);
  const t = turnMs(s, now);
  if (!p || !t || p.done < 1 || p.done >= p.total || !isActive(s)) return null;
  return (t / p.done) * (p.total - p.done);
}

export function Overview({ sessions, now, selected, onSelect, showTokens = true }: { sessions: Snapshot[]; now: number; selected: string | null; onSelect: (k: string) => void; showTokens?: boolean }) {
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

      {showTokens && <Tokens sessions={sessions} onSelect={onSelect} />}

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

/** token use read from each agent's local logs: total, then each session's share */
function Tokens({ sessions, onSelect }: { sessions: Snapshot[]; onSelect: (k: string) => void }) {
  const withT = sessions.filter((s) => s.tokens && s.tokens.input + s.tokens.output > 0);
  if (!withT.length) return null;
  const sum = (f: (s: Snapshot) => number) => withT.reduce((n, s) => n + f(s), 0);
  const inp = sum((s) => s.tokens!.input);
  const out = sum((s) => s.tokens!.output);
  const cache = sum((s) => s.tokens!.cacheRead + s.tokens!.cacheWrite);
  const max = Math.max(...withT.map((s) => s.tokens!.input + s.tokens!.output));
  return (
    <>
      <h4>토큰 사용량</h4>
      <div className="ov-tok">
        <div className="ov-tok-sum">
          <div><b>{fmtTokens(inp + out)}</b><span>입력+출력</span></div>
          <div><b>{fmtTokens(inp)}</b><span>입력</span></div>
          <div><b>{fmtTokens(out)}</b><span>출력</span></div>
          <div title="캐시에서 읽거나 쓴 토큰 (보통 더 싸게 계산돼요)"><b>{fmtTokens(cache)}</b><span>캐시</span></div>
        </div>
        <ul className="ov-tok-list">
          {[...withT].sort((a, b) => b.tokens!.input + b.tokens!.output - (a.tokens!.input + a.tokens!.output)).map((s) => {
            const t = s.tokens!.input + s.tokens!.output;
            return (
              <li key={s.key}>
                <button onClick={() => onSelect(s.key)} title={`입력 ${fmtTokens(s.tokens!.input)} · 출력 ${fmtTokens(s.tokens!.output)} · 출처: ${s.tokens!.source}`}>
                  <AgentMark agent={s.isDemo ? 'demo' : s.agent} />
                  <span className="ov-proj">{s.project ?? '프로젝트'}</span>
                  <span className="ov-tok-bar"><i className={`a-${s.isDemo ? 'demo' : s.agent}`} style={{ width: `${(t / max) * 100}%` }} /></span>
                  <span className="ov-tok-n">{fmtTokens(t)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="muted small">에이전트의 로컬 로그에서 읽은 값이에요. 이 앱이 켜진 뒤 받은 세션만 합쳐요.</p>
      </div>
    </>
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
  return (
    <button className={`ov-row ${on ? 'on' : ''} t-${tone}`} onClick={onClick}>
      <div className="ov-top">
        <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
        <span className="ov-proj">{s.project ?? '프로젝트 미확인'}</span>
        <span className={`ov-state tone-${tone}`}>
          <i className="pulse" />
          {stateLabel(s)}
        </span>
      </div>
      {s.tool && s.connection === 'live' && isActive(s) && (
        <div className="ov-doing">
          {s.activity && <span className="chip">{activityLabel(s.activity)}</span>} {s.detail ?? s.tool}
        </div>
      )}
      <div className="ov-meta">
        {prog ? (
          <span className="prog">
            <span className="bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
            {prog.done}/{prog.total}
          </span>
        ) : (
          <span className="muted">단계 정보 없음</span>
        )}
        {t !== null && <span className="muted">{isActive(s) ? '진행' : '소요'} {fmtDuration(t)}</span>}
        {eta !== null && <span className="ov-eta" title="끝난 단계의 평균 시간으로 계산한 추정치예요">약 {Math.max(1, Math.round(eta / 60000))}분 남음</span>}
        {s.subagents > 0 && <span className="muted">하위 {s.subagents}</span>}
      </div>
      {step && <div className="ov-step">지금: {step.text}</div>}
    </button>
  );
}
