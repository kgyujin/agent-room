import type { Snapshot, TimelineEntry } from '../types';
import { AGENT_NAME, fmtAgo, fmtClock, fmtDuration, fmtTokens, timelineText } from '../labels';
import { Icon } from './icons';
import { progressOf } from './Hud';
import { Overview } from './Overview';

export type Tab = 'overview' | 'timeline' | 'tasks' | 'session';
const TAB_NAME: Record<Tab, string> = { overview: '현황', timeline: '타임라인', tasks: '작업 목록', session: '세션 정보' };

export function DetailPanel(props: {
  width: number;
  s: Snapshot;
  sessions: Snapshot[];
  onSelect: (k: string) => void;
  timeline: TimelineEntry[];
  tab: Tab;
  setTab: (t: Tab) => void;
  now: number;
  onClose: () => void;
  onForget?: () => void;
}) {
  const { s, tab, setTab } = props;
  return (
    <aside className="panel" style={{ width: props.width }}>
      <header>
        <nav>
          {(Object.keys(TAB_NAME) as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {TAB_NAME[t]}
            </button>
          ))}
        </nav>
        <button className="tool" onClick={props.onClose} aria-label="패널 닫기" title="패널 닫기">
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        {tab === 'overview' && <Overview sessions={props.sessions} now={props.now} selected={s.key} onSelect={props.onSelect} />}
        {tab === 'timeline' && <Timeline entries={props.timeline} />}
        {tab === 'tasks' && <Tasks s={s} />}
        {tab === 'session' && <SessionInfo s={s} now={props.now} onForget={props.onForget} />}
      </div>
    </aside>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <p className="muted pad">아직 기록된 활동이 없어요. 앱이 실행된 뒤 받은 이벤트만 보여요.</p>;
  return (
    <ol className="timeline">
      {[...entries].reverse().map((e) => (
        <li key={e.id} className={`k-${e.kind} ${e.ok === false ? 'bad' : e.ok === true ? 'ok' : ''}`}>
          <time>{fmtClock(e.at)}</time>
          <span>{timelineText(e)}</span>
        </li>
      ))}
    </ol>
  );
}

function Tasks({ s }: { s: Snapshot }) {
  const prog = progressOf(s);
  return (
    <div className="pad">
      {prog ? (
        <>
          <div className="prog big">
            <span className="bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
            {prog.done}/{prog.total} 완료
          </div>
          <ul className="tasks">
            {s.plan.map((p, i) => (
              <li key={i} className={`st-${p.status}`}>
                <span className="box" />
                {p.text || '(제목 없음)'}
              </li>
            ))}
          </ul>
          <p className="muted small">Agent가 직접 작성한 작업 목록 기준이에요.</p>
        </>
      ) : (
        <p className="muted">
          Agent가 작업 목록(TodoWrite / update_plan 등)을 만들지 않아서 전체 단계를 알 수 없어요. 임의의 진행률 대신 경과 시간만 표시합니다.
        </p>
      )}
      {s.filesEdited.length > 0 && (
        <>
          <h4>수정한 파일</h4>
          <ul className="files">
            {[...s.filesEdited].reverse().map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SessionInfo({ s, now, onForget }: { s: Snapshot; now: number; onForget?: () => void }) {
  const rows: [string, string][] = [
    ['Agent', AGENT_NAME[s.agent] + (s.isDemo ? ' (데모)' : '')],
    ['프로젝트', s.project ?? '—'],
    ['경로', s.cwd ?? '—'],
    ['모델', s.model ?? '—'],
    ['권한 모드', s.permissionMode ?? '—'],
    ['세션 시작', `${fmtClock(s.startedAt)}${s.startExact ? '' : ' (앱이 처음 관찰한 시각)'}`],
    ['세션 경과', fmtDuration(now - s.startedAt)],
    ['마지막 이벤트', `${fmtClock(s.lastEventAt)} · ${fmtAgo(now - s.lastEventAt)}`],
    ['연결 상태', { live: '연결됨', stale: '이벤트 없음(불확실)', ended: '종료됨', lost: '프로세스 없음' }[s.connection]],
    ['완료한 요청', `${s.completedTurns}회`],
    ['도구 호출', `${s.toolCount}회`],
    ['세션 ID', s.sessionId],
  ];
  if (s.tokens) {
    rows.push(['토큰 입력/출력', `${fmtTokens(s.tokens.input)} / ${fmtTokens(s.tokens.output)}`]);
    rows.push(['캐시 읽기/쓰기', `${fmtTokens(s.tokens.cacheRead)} / ${fmtTokens(s.tokens.cacheWrite)}`]);
  }
  return (
    <div className="pad">
      <dl className="info">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {s.tokens && <p className="muted small">토큰 수는 Agent의 로컬 로그({s.tokens.source})에서 읽은 값이에요. 추가 API 호출은 없어요.</p>}
      {onForget && (
        <button className="btn" onClick={onForget}>
          목록에서 지우기
        </button>
      )}
    </div>
  );
}
