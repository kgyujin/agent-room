// Dashboard pieces modelled on a command-centre layout: headline cards with a trend against the
// previous period, a table of every session, and one activity log across all sessions with
// filter chips and search. Everything comes from hook events and the agents' local usage logs.
import { useMemo, useState } from 'react';
import type { Snapshot, TimelineEntry, UsageHistory } from '../types';
import { AGENT_NAME, fmtAgo, fmtClock, fmtDuration, sessionNames, stateLabel, stateTone, timelineText } from '../labels';
import { AgentMark } from './icons';
import { progressOf } from './Hud';
import { isActive, userTodo } from './Overview';
import { fmtTokens } from './Usage';
import { estCost, fmtUsd } from '../report';
import { isEn, L } from '../i18n';

/** "+27%" against the previous period; null when there is nothing to compare with */
function trend(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return { text: `${p >= 0 ? '+' : ''}${p}%`, up: p >= 0 };
}

const sum = (d: UsageHistory['days']) => d.reduce((a, x) => a + x.claude + x.codex, 0);

export function StatCards({ sessions, now, h, cost }: { sessions: Snapshot[]; now: number; h: UsageHistory | null; cost?: { claude: number; codex: number } }) {
  const live = sessions.filter((x) => x.connection !== 'ended' && x.connection !== 'lost');
  const days = h?.days ?? [];
  const today = days.length ? sum(days.slice(-1)) : 0;
  const yday = days.length > 1 ? sum(days.slice(-2, -1)) : 0;
  const week = sum(days.slice(-7));
  const prevWeek = sum(days.slice(-14, -7));
  const last = days[days.length - 1];
  const usd = last ? estCost(last, cost) : null;
  const cards: { id: string; label: string; value: string; sub?: string; tr?: ReturnType<typeof trend> }[] = [
    { id: 'todo', label: L('내 차례', 'Your turn'), value: String(live.filter((x) => userTodo(x, now)).length), sub: L('승인·답변 기다림', 'Waiting for you') },
    { id: 'work', label: L('작업 중', 'Working'), value: String(live.filter((x) => isActive(x) && !userTodo(x, now)).length), sub: L(`열린 세션 ${live.length}개`, `${live.length} open sessions`) },
    { id: 'done', label: L('완료한 요청', 'Requests done'), value: String(sessions.reduce((a, x) => a + x.completedTurns, 0)), sub: L(`수정한 파일 ${sessions.reduce((a, x) => a + x.filesEdited.length, 0)}개`, `${sessions.reduce((a, x) => a + x.filesEdited.length, 0)} files edited`) },
    { id: 'today', label: L('오늘 토큰', 'Tokens today'), value: h ? fmtTokens(today) : '—', sub: h ? `${L('어제', 'Yesterday')} ${fmtTokens(yday)}${usd !== null ? ` · ${L('추정', 'est.')} ${fmtUsd(usd)}` : ''}` : L('불러오는 중', 'Loading'), tr: trend(today, yday) },
    { id: 'week', label: L('최근 7일 토큰', 'Tokens, last 7 days'), value: h ? fmtTokens(week) : '—', sub: h ? `${L('그 전 7일', 'The 7 before')} ${fmtTokens(prevWeek)}` : L('불러오는 중', 'Loading'), tr: trend(week, prevWeek) },
  ];
  return (
    <div className="dash-stats">
      {cards.map((c) => (
        <div key={c.id} className={`dash-stat st-${c.id}`}>
          <small>{c.label}</small>
          <b>{c.value}{c.tr && <em className={c.tr.up ? 'up' : 'down'}>{c.tr.text}</em>}</b>
          {c.sub && <span>{c.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** every session in one table, the one needing the user first */
type SessFilter = 'all' | 'todo' | 'work' | 'rest';
const SESS_FILTERS = (): [SessFilter, string][] => [['all', L('전체', 'All')], ['todo', L('내 차례', 'Your turn')], ['work', L('작업 중', 'Working')], ['rest', L('쉬는 중', 'Resting')]];

export function SessionTable({ sessions: all, now, selected, onSelect }: { sessions: Snapshot[]; now: number; selected: string | null; onSelect: (k: string) => void }) {
  const [f, setF] = useState<SessFilter>('all');
  const [q, setQ] = useState('');
  if (!all.length) return <p className="muted small pad">{L('아직 세션이 없어요.', 'No sessions yet.')}</p>;
  const names = sessionNames(all);
  const kind = (s: Snapshot): SessFilter => (userTodo(s, now) ? 'todo' : isActive(s) ? 'work' : 'rest');
  const query = q.trim().toLowerCase();
  const sessions = all.filter((s) => (f === 'all' || kind(s) === f) && (!query || `${names[s.key]} ${s.project ?? ''} ${s.cwd ?? ''} ${AGENT_NAME[s.agent]} ${s.title ?? ''}`.toLowerCase().includes(query)));
  return (
    <>
    {all.length > 3 && (
      <div className="dash-chips">
        {SESS_FILTERS().map(([id, label]) => (
          <button key={id} className={f === id ? 'on' : ''} onClick={() => setF(id)}>{label}<span>{id === 'all' ? all.length : all.filter((s) => kind(s) === id).length}</span></button>
        ))}
        <input type="search" className="sess-q" placeholder={L('프로젝트·경로·에이전트', 'Project, path, agent')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
    )}
    {!sessions.length && <p className="muted small pad">{L('맞는 세션이 없어요.', 'No matching sessions.')}</p>}
    {sessions.length > 0 && <table className="dash-table">
      <thead>
        <tr><th>{L('세션', 'Session')}</th><th>{L('상태', 'State')}</th><th>{L('진행', 'Progress')}</th><th className="num opt2">{L('경과', 'Elapsed')}</th><th className="num opt">{L('요청', 'Requests')}</th><th className="num opt">{L('파일', 'Files')}</th><th className="num">{L('마지막 활동', 'Last active')}</th></tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const p = progressOf(s);
          return (
            <tr key={s.key} className={`${selected === s.key ? 'on' : ''} tone-row-${stateTone(s)}`} onClick={() => onSelect(s.key)}>
              <td className="who"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={14} /><b title={s.cwd ?? undefined}>{names[s.key]}</b></td>
              <td><span className={`tone-${stateTone(s)}`}>{stateLabel(s)}</span></td>
              <td>{p ? <span className="dash-prog"><span className="trk"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></span><small>{p.done}/{p.total}</small></span> : <small className="muted">—</small>}</td>
              <td className="num opt2">{fmtDuration(now - s.startedAt)}</td>
              <td className="num opt">{s.completedTurns}</td>
              <td className="num opt">{s.filesEdited.length}</td>
              <td className="num">{fmtAgo(now - s.lastEventAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>}
    </>
  );
}

type Filter = 'all' | 'bad' | 'todo' | 'edit' | 'test' | 'done';
const FILTERS = (): [Filter, string, (e: TimelineEntry) => boolean][] => [
  ['all', L('전체', 'All'), () => true],
  ['bad', L('오류', 'Errors'), (e) => e.ok === false || e.kind === 'tool_fail' || e.kind === 'turn_failed'],
  ['todo', L('승인·질문', 'Asks'), (e) => e.kind === 'approval' || e.kind === 'input'],
  ['edit', L('편집', 'Edits'), (e) => e.kind === 'tool' && e.activity === 'edit'],
  ['test', L('테스트', 'Tests'), (e) => e.kind === 'test'],
  ['done', L('완료', 'Done'), (e) => e.kind === 'turn_complete'],
];

/** one log across all sessions, newest first; a row opens to show everything the event carried */
export function ActivityLog({ sessions, timelines, onSelect, compact, tall }: { sessions: Snapshot[]; timelines: Record<string, TimelineEntry[]>; onSelect: (k: string) => void; compact?: boolean; tall?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // paused: the list stays as it was so a row can be read while events keep arriving
  const [frozen, setFrozen] = useState<{ e: TimelineEntry; s: Snapshot }[] | null>(null);
  const names = sessionNames(sessions);
  const liveRows = useMemo(() => sessions.flatMap((s) => (timelines[s.key] ?? []).map((e) => ({ e, s }))).sort((a, b) => b.e.at - a.e.at), [sessions, timelines]);
  const all = frozen ?? liveRows;
  const test = FILTERS().find((f) => f[0] === filter)![2];
  const needle = q.trim().toLowerCase();
  const shown = all.filter(({ e, s }) => test(e) && (!needle || `${timelineText(e)} ${names[s.key] ?? ''}`.toLowerCase().includes(needle))).slice(0, compact ? 12 : 300);
  return (
    <div className={`dash-log ${tall ? 'tall' : ''}`}>
      {!compact && (
        <div className="dash-chips">
          {FILTERS().map(([id, label, f]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}<span>{all.filter(({ e }) => f(e)).length}</span>
            </button>
          ))}
          <input type="search" placeholder={L('기록 검색', 'Search the log')} value={q} onChange={(ev) => setQ(ev.target.value)} />
          <button className={`live ${frozen ? '' : 'on'}`} onClick={() => setFrozen(frozen ? null : liveRows)} title={frozen ? L('다시 실시간으로', 'Back to live') : L('목록 멈추기', 'Pause the list')}>
            <i />{frozen ? L('멈춤', 'Paused') : L('실시간', 'Live')}
          </button>
        </div>
      )}
      {shown.length ? (
        <ol>
          {shown.map(({ e, s }) => {
            const bad = FILTERS()[1][2](e);
            const id = `${s.key}-${e.id}`;
            return (
              <li key={id} className={`${bad ? 'bad' : e.ok === true || e.kind === 'turn_complete' ? 'ok' : ''} k-${e.kind} ${open === id ? 'open' : ''}`}>
                <div className="row" onClick={() => (compact ? onSelect(s.key) : setOpen(open === id ? null : id))}>
                  <i />
                  <time>{fmtClock(e.at)}</time>
                  <span className="tag"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={11} />{names[s.key]}</span>
                  <span className="txt" title={timelineText(e)}>{timelineText(e)}</span>
                </div>
                {open === id && (
                  <div className="more">
                    <pre>{JSON.stringify(isEn() ? { time: new Date(e.at).toLocaleString('en-GB'), kind: e.kind, activity: e.activity, tool: e.tool, detail: e.detail, ok: e.ok, session: s.project, agent: s.agent, path: s.cwd } : { 시각: new Date(e.at).toLocaleString('ko-KR'), 종류: e.kind, 활동: e.activity, 도구: e.tool, 내용: e.detail, 결과: e.ok, 세션: s.project, 에이전트: s.agent, 경로: s.cwd }, null, 2)}</pre>
                    <button className="link" onClick={() => onSelect(s.key)}>{L('이 세션 보기', 'Show this session')}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small pad">{all.length ? L('조건에 맞는 기록이 없어요.', 'Nothing matches.') : L('아직 기록된 활동이 없어요. 앱이 실행된 뒤 받은 이벤트만 보여요.', 'No activity yet. Only events received while the app runs show here.')}</p>
      )}
    </div>
  );
}
