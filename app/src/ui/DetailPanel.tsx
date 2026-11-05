import type { Snapshot, TimelineEntry } from '../types';
import { AGENT_NAME, fmtAgo, fmtClock, fmtDuration, timelineText } from '../labels';
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
  showLimits: boolean;
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
        {tab === 'overview' && <Overview sessions={props.sessions} now={props.now} selected={s.key} onSelect={props.onSelect} showLimits={props.showLimits} />}
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
          <i className="tl-dot" />
          <span className="tl-text" title={timelineText(e)}>{timelineText(e)}</span>
          <time>{fmtClock(e.at)}</time>
        </li>
      ))}
    </ol>
  );
}

function Tasks({ s }: { s: Snapshot }) {
  const prog = progressOf(s);
  return (
    <div className="pad">
      <section className="pn-sec">
        <h4>작업 목록 {prog && <span className="pn-count">{prog.done}/{prog.total} 완료</span>}</h4>
        {prog ? (
          <>
            <span className="pn-bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
            <ul className="tasks">
              {s.plan.map((p, i) => (
                <li key={i} className={`st-${p.status}`}>
                  <span className="box">{p.status === 'completed' && <Icon name="check" />}</span>
                  <span>{p.text || '(제목 없음)'}</span>
                </li>
              ))}
            </ul>
            <p className="pn-note">에이전트가 직접 만든 작업 목록 기준이에요.</p>
          </>
        ) : (
          <p className="pn-note">
            에이전트가 작업 목록(TodoWrite, update_plan 등)을 만들지 않아 전체 단계를 알 수 없어요. 진행률 대신 경과 시간만 보여요.
          </p>
        )}
      </section>
      {s.filesEdited.length > 0 && (
        <section className="pn-sec">
          <h4>수정한 파일 <span className="pn-count">{s.filesEdited.length}</span></h4>
          <ul className="files">
            {[...s.filesEdited].reverse().map((f) => {
              const i = f.lastIndexOf('/');
              return (
                <li key={f} title={f}>
                  <Icon name="note" />
                  <b>{f.slice(i + 1)}</b>
                  {i > 0 && <span>{f.slice(0, i)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SessionInfo({ s, now, onForget }: { s: Snapshot; now: number; onForget?: () => void }) {
  const groups: [string, [string, string][]][] = [
    ['세션', [
      ['에이전트', AGENT_NAME[s.agent] + (s.isDemo ? ' (데모)' : '')],
      ['프로젝트', s.project ?? '—'],
      ['경로', s.cwd ?? '—'],
      ['모델', s.model ?? '—'],
    ]],
    ['시간', [
      ['시작', `${fmtClock(s.startedAt)}${s.startExact ? '' : ' (처음 본 시각)'}`],
      ['경과', fmtDuration(now - s.startedAt)],
      ['마지막 활동', fmtAgo(now - s.lastEventAt)],
    ]],
    ['상태', [
      ['연결', { live: '연결됨', stale: '이벤트 없음 (불확실)', ended: '종료됨', lost: '프로세스 없음' }[s.connection]],
      ['완료한 요청', `${s.completedTurns}회`],
    ]],
  ];
  return (
    <div className="pad">
      {groups.map(([title, rows]) => (
        <section key={title} className="pn-sec">
          <h4>{title}</h4>
          <dl className="info">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {onForget && (
        <button className="btn pn-forget" onClick={onForget}>
          목록에서 지우기
        </button>
      )}
    </div>
  );
}
