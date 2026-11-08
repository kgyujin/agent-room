// Dashboard pieces modelled on a command-centre layout: headline cards with a trend against the
// previous period, a table of every session, and one activity log across all sessions with
// filter chips and search. Everything comes from hook events and the agents' local usage logs.
import { useMemo, useState } from 'react';
import type { Snapshot, TimelineEntry, UsageHistory } from '../types';
import { AGENT_NAME, fmtAgo, fmtClock, sessionNames, stateLabel, stateTone, timelineText } from '../labels';
import { AgentMark, Icon } from './icons';
import { progressOf } from './Hud';
import { isActive, userTodo } from './Overview';
import { fmtTokens } from './Usage';
import { daySummary, estCost, fmtSpan, fmtUsd, type DayLog } from '../report';
import { isEn, L } from '../i18n';

/** "+27%" against the previous period; null when there is nothing to compare with */
function trend(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return { text: `${p >= 0 ? '+' : ''}${p}%`, up: p >= 0 };
}

const sum = (d: UsageHistory['days']) => d.reduce((a, x) => a + x.claude + x.codex, 0);

/** a tiny trend line with a soft fill under it */
function Spark({ v }: { v: number[] }) {
  const max = Math.max(...v, 1);
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * 100).toFixed(1)},${(26 - (x / max) * 22).toFixed(1)}`).join(' ');
  return (
    <svg className="ds-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,28 ${pts} 100,28`} />
      <polyline points={pts} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const STAT_ICON = { todo: 'bell', work: 'bolt', done: 'check', today: 'note', week: 'clock' } as const;

export type StatId = 'todo' | 'work' | 'done' | 'today' | 'week';

/** onOpen: a card opens the view behind its number (the sessions it counts, today's summary, usage) */
export function StatCards({ sessions, now, h, day, cost, onOpen }: { sessions: Snapshot[]; now: number; h: UsageHistory | null; day: DayLog | null; cost?: { claude: number; codex: number }; onOpen?: (id: StatId) => void }) {
  const live = sessions.filter((x) => x.connection !== 'ended' && x.connection !== 'lost');
  const days = h?.days ?? [];
  const today = days.length ? sum(days.slice(-1)) : 0;
  const yday = days.length > 1 ? sum(days.slice(-2, -1)) : 0;
  const week = sum(days.slice(-7));
  const prevWeek = sum(days.slice(-14, -7));
  const last = days[days.length - 1];
  const usd = last ? estCost(last, cost) : null;
  // today's counts, the same ones the card opens (sessions keep counting since they started, across days)
  const d = daySummary(day, h, now);
  // small trend lines: daily totals of the last two weeks, and the rolling 7-day total over the same days
  const daily = days.slice(-14).map((d) => d.claude + d.codex);
  const weekly = days.length >= 7 ? days.slice(-14).map((_, i, a) => sum(days.slice(Math.max(0, days.length - a.length + i - 6), days.length - a.length + i + 1))) : [];
  const cards: { id: StatId; label: string; value: string; sub?: string; tr?: ReturnType<typeof trend>; spark?: number[] }[] = [
    { id: 'todo', label: L('내 차례', 'Your turn'), value: String(live.filter((x) => userTodo(x, now)).length), sub: L('승인이나 답변을 기다려요', 'Waiting for you') },
    { id: 'work', label: L('작업 중', 'Working'), value: String(live.filter((x) => isActive(x) && !userTodo(x, now)).length), sub: L(`열린 세션 ${live.length}개`, `${live.length} open sessions`) },
    { id: 'done', label: L('오늘 완료한 요청', 'Requests done today'), value: String(d.turns), sub: L(`수정한 파일 ${d.files}개`, `${d.files} files edited`) },
    { id: 'today', label: L('오늘 토큰', 'Tokens today'), value: h ? fmtTokens(today) : '…', sub: h ? `${L('어제', 'Yesterday')} ${fmtTokens(yday)}${usd !== null ? `, ${L('추정', 'est.')} ${fmtUsd(usd)}` : ''}` : L('불러오는 중', 'Loading'), tr: trend(today, yday), spark: daily },
    { id: 'week', label: L('최근 7일 토큰', 'Tokens, last 7 days'), value: h ? fmtTokens(week) : '…', sub: h ? `${L('그 전 7일', 'The 7 before')} ${fmtTokens(prevWeek)}` : L('불러오는 중', 'Loading'), tr: trend(week, prevWeek), spark: weekly },
  ];
  return (
    <div className="dash-stats">
      {cards.map((c) => (
        <div key={c.id} className={`dash-stat st-${c.id} ${onOpen ? 'go' : ''}`} {...(onOpen ? { role: 'button', tabIndex: 0, onClick: () => onOpen(c.id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id); } } } : {})}>
          <i className="ds-ic"><Icon name={STAT_ICON[c.id]} size={14} /></i>
          <small>{c.label}</small>
          <b>{c.value}{c.tr && <em className={c.tr.up ? 'up' : 'down'}>{c.tr.text}</em>}</b>
          {c.sub && <span>{c.sub}</span>}
          {c.spark && c.spark.length > 1 && <Spark v={c.spark} />}
        </div>
      ))}
    </div>
  );
}

/** every session in one table, the one needing the user first */
export type SessFilter = 'all' | 'todo' | 'work' | 'rest';
const SESS_FILTERS = (): [SessFilter, string][] => [['all', L('전체', 'All')], ['todo', L('내 차례', 'Your turn')], ['work', L('작업 중', 'Working')], ['rest', L('쉬는 중', 'Resting')]];

/** onOpen: a double-click brings the session's terminal, editor or app to the front; onForget takes ended sessions off the list */
export function SessionTable({ sessions: all, now, selected, onSelect, onOpen, onForget, filter = 'all' }: { sessions: Snapshot[]; now: number; selected: string | null; onSelect: (k: string) => void; onOpen?: (s: Snapshot) => void; onForget?: (keys: string[]) => void; filter?: SessFilter }) {
  const [f, setF] = useState<SessFilter>(filter);
  const [q, setQ] = useState('');
  if (!all.length) return <p className="muted small pad">{L('아직 세션이 없어요.', 'No sessions yet.')}</p>;
  const names = sessionNames(all);
  const kind = (s: Snapshot): SessFilter => (userTodo(s, now) ? 'todo' : isActive(s) ? 'work' : 'rest');
  const query = q.trim().toLowerCase();
  const sessions = all.filter((s) => (f === 'all' || kind(s) === f) && (!query || `${names[s.key]} ${s.project ?? ''} ${s.cwd ?? ''} ${AGENT_NAME[s.agent]} ${s.title ?? ''} ${s.chatTitle ?? ''}`.toLowerCase().includes(query)));
  const ended = all.filter((s) => s.connection === 'ended' || s.connection === 'lost');
  return (
    <>
    {(all.length > 3 || (onForget && ended.length > 0)) && (
      <div className="dash-chips">
        {SESS_FILTERS().map(([id, label]) => (
          <button key={id} className={f === id ? 'on' : ''} onClick={() => setF(id)}>{label}<span>{id === 'all' ? all.length : all.filter((s) => kind(s) === id).length}</span></button>
        ))}
        <input type="search" className="sess-q" placeholder={L('프로젝트, 경로, 에이전트', 'Project, path, agent')} value={q} onChange={(e) => setQ(e.target.value)} />
        {onForget && ended.length > 0 && <button className="sess-clear" onClick={() => onForget(ended.map((s) => s.key))} title={L('끝났거나 연결이 끊긴 세션을 목록에서 지워요', 'Takes ended and lost sessions off the list')}>{L('끝난 세션 지우기', 'Clear ended')}<span>{ended.length}</span></button>}
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
            <tr key={s.key} className={`${selected === s.key ? 'on' : ''} tone-row-${stateTone(s)}`} onClick={() => onSelect(s.key)} onDoubleClick={onOpen && (() => onOpen(s))} title={onOpen ? L('두 번 누르면 세션 열기', 'Double-click to open the session') : undefined}>
              <td><span className="who"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={14} /><b title={`${names[s.key]}${s.cwd ? `\n${s.cwd}` : ''}`}>{names[s.key]}</b></span></td>
              <td><span className={`st-badge tone-${stateTone(s)}`}>{stateLabel(s)}</span></td>
              <td>{p ? <span className="dash-prog"><span className="trk"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></span><small>{p.done}/{p.total}</small></span> : <small className="muted">{L('없음', 'None')}</small>}</td>
              <td className="num opt2">{fmtSpan(now - s.startedAt)}</td>
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
  ['todo', L('승인과 질문', 'Asks'), (e) => e.kind === 'approval' || e.kind === 'input'],
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
                <div className="row" role="button" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                  <i />
                  <time>{fmtClock(e.at)}</time>
                  <span className="tag"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={11} /><span className="nm" title={names[s.key]}>{names[s.key]}</span></span>
                  <span className="txt" title={timelineText(e)}>{timelineText(e)}</span>
                </div>
                {open === id && (
                  <div className="more">
                    <dl>
                      <dt>{L('시각', 'Time')}</dt><dd>{new Date(e.at).toLocaleString(isEn() ? 'en-GB' : 'ko-KR')}</dd>
                      <dt>{L('세션', 'Session')}</dt><dd>{names[s.key]}{s.project && names[s.key] !== s.project && <small> ({s.project})</small>}</dd>
                      <dt>{L('한 일', 'Event')}</dt><dd>{timelineText({ ...e, detail: null })}</dd>
                      {e.tool && <><dt>{L('도구', 'Tool')}</dt><dd><code>{e.tool}</code></dd></>}
                      {e.detail && <><dt>{L('내용', 'Detail')}</dt><dd><code className="full">{e.detail}</code></dd></>}
                      {e.ok !== null && <><dt>{L('결과', 'Result')}</dt><dd className={e.ok ? 'ok' : 'bad'}>{e.ok ? L('성공', 'Passed') : L('실패', 'Failed')}</dd></>}
                      {s.cwd && <><dt>{L('경로', 'Path')}</dt><dd><code className="full">{s.cwd}</code></dd></>}
                    </dl>
                    <div className="more-act">
                      <button className="btn" onClick={() => onSelect(s.key)}>{L('이 세션 보기', 'Show this session')}</button>
                      {e.detail && <button className="btn" onClick={() => void navigator.clipboard.writeText(e.detail!).catch(() => undefined)}>{L('내용 복사', 'Copy detail')}</button>}
                    </div>
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
