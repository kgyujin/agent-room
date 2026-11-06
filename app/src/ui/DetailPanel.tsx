import type { Snapshot, TimelineEntry } from '../types';
import { AGENT_NAME, fmtAgo, fmtClock, fmtDuration, stateLabel, stateTone, timelineText } from '../labels';
import { AgentMark, Icon } from './icons';
import { progressOf } from './Hud';
import { Overview } from './Overview';
import { UsageBoard, useUsageHistory } from './Usage';
import { ActivityLog, SessionTable, StatCards } from './Activity';

export type Tab = 'overview' | 'usage' | 'timeline' | 'tasks' | 'session';
const TAB_NAME: Record<Tab, string> = { overview: '현황', usage: '사용량', timeline: '타임라인', tasks: '작업', session: '세션' };
/** tabs about one session; without a selected session only the others show */
const PER_SESSION: Tab[] = ['timeline', 'tasks', 'session'];

export function DetailPanel(props: {
  width: number;
  /** wide window: every section at once instead of tabs */
  dashboard?: boolean;
  s: Snapshot | null;
  sessions: Snapshot[];
  onSelect: (k: string) => void;
  showLimits: boolean;
  timeline: TimelineEntry[];
  /** every session's log, for the dashboard's activity console */
  timelines?: Record<string, TimelineEntry[]>;
  tab: Tab;
  setTab: (t: Tab) => void;
  now: number;
  onClose: () => void;
  onForget?: () => void;
}) {
  const { s, tab, setTab } = props;
  if (props.dashboard) return <Dashboard {...props} />;
  return (
    <aside className="panel" style={{ width: props.width }}>
      <header>
        <nav>
          {(Object.keys(TAB_NAME) as Tab[]).filter((t) => s || !PER_SESSION.includes(t)).map((t) => (
            <button key={t} className={`${tab === t ? 'on' : ''} ${t === PER_SESSION[0] ? 'first-own' : ''}`} onClick={() => setTab(t)}>
              {TAB_NAME[t]}
            </button>
          ))}
        </nav>
        <button className="tool" onClick={props.onClose} aria-label="패널 닫기" title="패널 닫기">
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        {/* the last three tabs are about the selected pet: say which one */}
        {s && PER_SESSION.includes(tab) && (
          <div className="pn-who">
            <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
            <b>{s.project ?? '프로젝트 미확인'}</b>
            <span className={`tone-${stateTone(s)}`}>{stateLabel(s)}</span>
          </div>
        )}
        {(tab === 'overview' || (!s && PER_SESSION.includes(tab))) && <Overview sessions={props.sessions} now={props.now} selected={s?.key ?? null} onSelect={props.onSelect} showLimits={props.showLimits} />}
        {tab === 'usage' && <div className="pad"><UsageBoard sessions={props.sessions} now={props.now} /></div>}
        {s && tab === 'timeline' && <Timeline entries={props.timeline} />}
        {s && tab === 'tasks' && <Tasks s={s} />}
        {s && tab === 'session' && <SessionInfo s={s} now={props.now} onForget={props.onForget} />}
      </div>
    </aside>
  );
}

/** full-screen panel: headline cards, 현황 and 사용량 side by side, every session in a table,
 *  one activity log across sessions, then the selected session's tasks and details */
function Dashboard(props: Parameters<typeof DetailPanel>[0]) {
  const { s, sessions, now } = props;
  const h = useUsageHistory(30);
  const live = sessions.filter((x) => x.connection !== 'ended' && x.connection !== 'lost');
  const errors = live.filter((x) => x.state === 'error').length;
  return (
    <aside className="panel dash" style={{ width: props.width }}>
      <header>
        <div>
          <h3 className="dash-title">대시보드</h3>
          <p className="dash-sub">세션 {live.length}개{errors ? <> · <b className="tone-bad">오류 {errors}건</b></> : null} · 이벤트가 오는 즉시 갱신</p>
        </div>
        <button className="tool" onClick={props.onClose} aria-label="패널 닫기" title="패널 닫기">
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body dash-body">
        <StatCards sessions={sessions} now={now} h={h} />
        <div className="dash-grid">
          <section className="dash-card">
            <h4 className="dash-h">현황</h4>
            <Overview sessions={sessions} now={now} selected={s?.key ?? null} onSelect={props.onSelect} showLimits={false} />
          </section>
          <section className="dash-card">
            <h4 className="dash-h">사용량</h4>
            <div className="pad"><UsageBoard sessions={sessions} now={now} /></div>
          </section>
        </div>
        <section className="dash-card dash-wide">
          <h4 className="dash-h">세션 <span className="pn-count">{sessions.length}</span></h4>
          <SessionTable sessions={sessions} now={now} selected={s?.key ?? null} onSelect={props.onSelect} />
        </section>
        <section className="dash-card dash-wide">
          <h4 className="dash-h">활동 기록</h4>
          <ActivityLog sessions={sessions} timelines={props.timelines ?? {}} onSelect={props.onSelect} />
        </section>
        {s && (
          <>
            <div className="pn-who dash-who">
              <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
              <b>{s.project ?? '프로젝트 미확인'}</b>
              <span className={`tone-${stateTone(s)}`}>{stateLabel(s)}</span>
            </div>
            <div className="dash-grid">
              <section className="dash-card">
                <h4 className="dash-h">작업</h4>
                <Tasks s={s} />
              </section>
              <section className="dash-card">
                <h4 className="dash-h">정보</h4>
                <SessionInfo s={s} now={now} onForget={props.onForget} />
              </section>
            </div>
          </>
        )}
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
