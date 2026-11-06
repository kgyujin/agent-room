import type { Snapshot, TimelineEntry } from '../types';
import { AGENT_NAME, ORIGIN_LABEL, fmtAgo, fmtClock, fmtDuration, stateLabel, stateTone, timelineText } from '../labels';
import { AgentMark, Icon } from './icons';
import { progressOf } from './Hud';
import { Overview } from './Overview';
import { UsageBoard } from './Usage';
import { L } from '../i18n';

export type Tab = 'overview' | 'usage' | 'timeline' | 'tasks' | 'session';
const TAB_NAME: Record<Tab, string> = {
  get overview() { return L('현황', 'Overview'); }, get usage() { return L('사용량', 'Usage'); }, get timeline() { return L('타임라인', 'Timeline'); },
  get tasks() { return L('작업', 'Tasks'); }, get session() { return L('세션', 'Session'); },
};
/** tabs about one session; without a selected session only the others show */
const PER_SESSION: Tab[] = ['timeline', 'tasks', 'session'];

export function DetailPanel(props: {
  width: number;
  s: Snapshot | null;
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
          {(Object.keys(TAB_NAME) as Tab[]).filter((t) => s || !PER_SESSION.includes(t)).map((t) => (
            <button key={t} className={`${tab === t ? 'on' : ''} ${t === PER_SESSION[0] ? 'first-own' : ''}`} onClick={() => setTab(t)}>
              {TAB_NAME[t]}
            </button>
          ))}
        </nav>
        <button className="tool" onClick={props.onClose} aria-label={L('패널 닫기', 'Close panel')} title={L('패널 닫기', 'Close panel')}>
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        {/* the last three tabs are about the selected pet: say which one */}
        {s && PER_SESSION.includes(tab) && (
          <div className="pn-who">
            <AgentMark agent={s.isDemo ? 'demo' : s.agent} size={16} />
            <b>{s.project ?? L('프로젝트 미확인', 'Unknown project')}</b>
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

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <p className="muted pad">{L('아직 기록된 활동이 없어요. 앱이 실행된 뒤 받은 이벤트만 보여요.', 'No activity yet. Only events received while the app runs show here.')}</p>;
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

export function Tasks({ s }: { s: Snapshot }) {
  const prog = progressOf(s);
  return (
    <div className="pad">
      <section className="pn-sec">
        <h4>{L('작업 목록', 'Task list')} {prog && <span className="pn-count">{prog.done}/{prog.total} {L('완료', 'done')}</span>}</h4>
        {prog ? (
          <>
            <span className="pn-bar"><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></span>
            <ul className="tasks">
              {s.plan.map((p, i) => (
                <li key={i} className={`st-${p.status}`}>
                  <span className="box">{p.status === 'completed' && <Icon name="check" />}</span>
                  <span>{p.text || L('(제목 없음)', '(untitled)')}</span>
                </li>
              ))}
            </ul>
            <p className="pn-note">{L('에이전트가 직접 만든 작업 목록 기준이에요.', 'From the task list the agent made itself.')}</p>
          </>
        ) : (
          <p className="pn-note">
            {L('에이전트가 작업 목록(TodoWrite, update_plan 등)을 만들지 않아 전체 단계를 알 수 없어요. 진행률 대신 경과 시간만 보여요.', 'The agent made no task list (TodoWrite, update_plan and the like), so the steps aren\'t known. Only the elapsed time shows.')}
          </p>
        )}
      </section>
      {s.filesEdited.length > 0 && (
        <section className="pn-sec">
          <h4>{L('수정한 파일', 'Files edited')} <span className="pn-count">{s.filesEdited.length}</span></h4>
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

export function SessionInfo({ s, now, onForget }: { s: Snapshot; now: number; onForget?: () => void }) {
  const groups: [string, [string, string][]][] = [
    [L('세션', 'Session'), [
      [L('에이전트', 'Agent'), AGENT_NAME[s.agent] + (s.isDemo ? L(' (데모)', ' (demo)') : '')],
      [L('프로젝트', 'Project'), s.project ?? '—'],
      [L('경로', 'Path'), s.cwd ?? '—'],
      [L('모델', 'Model'), s.model ?? '—'],
      ...(s.origin ? [[L('시작한 곳', 'Started from'), ORIGIN_LABEL[s.origin]] as [string, string]] : []),
      ...(s.title ? [[L('제목', 'Title'), s.title] as [string, string]] : []),
    ]],
    [L('시간', 'Time'), [
      [L('시작', 'Started'), `${fmtClock(s.startedAt)}${s.startExact ? '' : L(' (처음 본 시각)', ' (first seen)')}`],
      [L('경과', 'Elapsed'), fmtDuration(now - s.startedAt)],
      [L('마지막 활동', 'Last active'), fmtAgo(now - s.lastEventAt)],
    ]],
    [L('상태', 'State'), [
      [L('연결', 'Connection'), { live: L('연결됨', 'Connected'), stale: L('이벤트 없음 (불확실)', 'No events (unsure)'), ended: L('종료됨', 'Ended'), lost: L('프로세스 없음', 'Process gone') }[s.connection]],
      [L('완료한 요청', 'Requests done'), L(`${s.completedTurns}회`, String(s.completedTurns))],
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
          {L('목록에서 지우기', 'Remove from the list')}
        </button>
      )}
    </div>
  );
}
