// The dashboard: everything on one screen with no page scroll, either filling the window
// ("대시보드만") or beside the room ("방과 같이"). Counts, the agent map, recent activity, every task
// list, usage limits, sessions and the picked session each get one cell of a grid that fills the height.
// Everything shown comes from hook events, the agents' local usage logs and their local
// CLAUDE.md / AGENTS.md files; nothing calls a model.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFit } from './fit';
import { Lanes } from './Lanes';
import { backend, IN_TAURI } from '../bridge';
import type { HistLine, MemoryFile, Snapshot, TimelineEntry, UsageHistory } from '../types';
import { AGENT_NAME, ORIGIN_LABEL, chatName, doingLabel, fmtClock, timelineText, sessionNames, stateLabel, stateTone } from '../labels';
import { AgentMark, Icon } from './icons';
import { ActivityLog, SessionTable, StatCards, type SessFilter, type StatId } from './Activity';
import { userTodo } from './Overview';
import { fmtTokens, LimitCards, useUsageHistory } from './Usage';
import { Tasks, Timeline } from './DetailPanel';
import { ApproveButtons } from './Approve';
import { dayMarkdown, daySummary, estCost, fmtSpan, fmtUsd, reportName, type DayLog } from '../report';
import { L } from '../i18n';

/** the cards below the counts, in grid order; settings can turn any of them off */
export const DASH_CARDS = [
  ['map', '에이전트 지도', 'Agent map'],
  ['activity', '최근 활동', 'Recent activity'],
  ['usage', '남은 사용량', 'Usage left'],
  ['board', '작업 보드', 'Task board'],
  ['sessions', '세션', 'Sessions'],
  ['picked', '선택한 세션', 'Picked session'],
] as const;

/** what a card drops, first group first and the last item of a group first, until the rest fits
 * without scrolling: the usage share and pace notes, the weekly rows, edited files, then list rows */
const FIT_DROP = ['.dshare, .ub-rate', '.lc-pace', '.lc-grid:not(.rings) .lc-row ~ .lc-row', '.files li', '.lane, .dash-log li, .dash-table tbody tr, .dboard-card, .dmap-node, .tasks li, .timeline li, .pn-note'];

/** a dashboard cell: shows what fits its box and offers the whole card when something had to go */
function FitCard({ cls, title, style, onWhole, children }: { cls: string; title: React.ReactNode; style?: React.CSSProperties; onWhole: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const dropped = useFit(ref, FIT_DROP);
  // a short cell also hides card details by CSS (map activity and buttons, the session filters)
  const [squeezed, setSqueezed] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const v = !!el && [...el.querySelectorAll('.dmap-doing, .dmap-meta, .dash-chips')].some((x) => getComputedStyle(x).display === 'none');
    if (v !== squeezed) setSqueezed(v);
  });
  const cut = dropped + (squeezed ? 1 : 0);
  return (
    <section className={`dash-card ${cls}`} style={style}>
      <h4 className="dash-h">{title}{cut > 0 && <button className="dp-whole" onClick={onWhole} title={L('전체 보기', 'Show all')}><Icon name="out" size={12} />{L('전체 보기', 'Show all')}</button>}</h4>
      <div className="dp-scroll" ref={ref}>{children}</div>
    </section>
  );
}

export function DashboardPage(props: {
  sessions: Snapshot[];
  timelines: Record<string, TimelineEntry[]>;
  day: DayLog | null;
  selected: Snapshot | null;
  now: number;
  onSelect: (k: string) => void;
  /** brings the session's own terminal, editor or app to the front */
  onOpen: (k: string) => void;
  /** beside the room (a panel of this width) instead of filling the window */
  split?: number;
  /** switches between the two views; null when the window is too narrow to show the room beside it */
  onToggleSplit: (() => void) | null;
  onRoom: () => void;
  onSettings: () => void;
  /** opens the agent connection settings (shown while there are no sessions at all) */
  onConnect?: () => void;
  /** settings: whether Claude account limits are read (explains an empty limits card) */
  accountLimits: boolean;
  /** settings: card ids turned off */
  hidden: string[];
  /** settings: days of timeline kept on disk (0 hides the past-day view) */
  historyDays: number;
  /** settings: blended USD prices per million tokens, when the user wants an estimated cost */
  cost?: { claude: number; codex: number };
  /** a short note that would otherwise float over the page as a banner (demo, preview) */
  notice?: string | null;
  mac: boolean;
}) {
  const { sessions, now, selected } = props;
  const h = useUsageHistory(30);
  const [memOpen, setMemOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const live = sessions.filter((x) => x.connection !== 'ended' && x.connection !== 'lost');
  const todo = live.filter((x) => userTodo(x, now)).length;
  const pick = props.onSelect;
  const canOpen = (s: Snapshot) => IN_TAURI && !s.isDemo;
  // the activity card shows lanes or the plain log; remembered per computer (a convenience only)
  const [actView, setActView] = useState<'lanes' | 'log'>(() => { try { return localStorage.getItem('dashAct') === 'log' ? 'log' : 'lanes'; } catch { return 'lanes'; } });
  const pickActView = (v: 'lanes' | 'log') => { setActView(v); try { localStorage.setItem('dashAct', v); } catch { /* private window */ } };
  const [whole, setWhole] = useState<(typeof DASH_CARDS)[number][0] | null>(null);
  // the sessions overlay opened from a number card starts on the sessions that number counts
  const [wholeFilter, setWholeFilter] = useState<SessFilter>('all');
  const openStat = (id: StatId) => {
    if (id === 'done') { setTodayOpen(true); return; }
    if (id === 'todo' || id === 'work') { setWholeFilter(id); setWhole('sessions'); return; }
    setWhole('usage');
  };
  // Escape closes an open overlay first, before the window shortcut closes the whole dashboard
  const overlay = !!whole || todayOpen || pastOpen || memOpen;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setWhole(null); setTodayOpen(false); setPastOpen(false); setMemOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [overlay]);
  const split = props.split !== undefined;
  const cards: Record<(typeof DASH_CARDS)[number][0], () => [string, React.ReactNode, React.ReactNode]> = {
    map: () => ['g-map', <>{L('에이전트 지도', 'Agent map')} <span className="pn-count">{live.length}</span></>, <AgentMap sessions={sessions} now={now} selected={selected?.key ?? null} onPick={pick} onOpen={props.onOpen} />],
    activity: () => ['g-act', <>
      {L('최근 활동', 'Recent activity')}
      <span className="seg-tabs" role="tablist">
        <button role="tab" className={actView === 'lanes' ? 'on' : ''} onClick={() => pickActView('lanes')}>{L('흐름', 'Flow')}</button>
        <button role="tab" className={actView === 'log' ? 'on' : ''} onClick={() => pickActView('log')}>{L('기록', 'Log')}</button>
      </span>
    </>, actView === 'lanes' ? <Lanes sessions={sessions} timelines={props.timelines} now={now} selected={selected?.key ?? null} onSelect={pick} /> : <ActivityLog sessions={sessions} timelines={props.timelines} onSelect={pick} compact />],
    usage: () => ['g-use', L('남은 사용량', 'Usage left'), <><LimitCards ring sessions={sessions} now={now} accountLimits={props.accountLimits} onSettings={props.onSettings} /><UsageShare h={h} /></>],
    board: () => ['g-board', L('작업 보드', 'Task board'), <TaskBoard sessions={live} now={now} onPick={pick} />],
    sessions: () => ['g-sess', <>{L('세션', 'Sessions')} <span className="pn-count">{sessions.length}</span></>, <SessionTable sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={pick} />],
    picked: () => ['g-pick', <>
      {selected ? <><AgentMark agent={selected.isDemo ? 'demo' : selected.agent} size={14} /> {sessionNames(sessions)[selected.key] ?? L('세션', 'Session')}</> : L('선택한 세션', 'Picked session')}
      {selected && canOpen(selected) && <button className="link dp-open" onClick={() => props.onOpen(selected.key)}>{L('세션 열기', 'Open session')}</button>}
    </>, selected ? <><Tasks s={selected} /><Timeline entries={props.timelines[selected.key] ?? []} /></> : <p className="muted pad">{L('세션을 누르면 작업과 타임라인이 여기에 나와요.', 'Pick a session to see its tasks and timeline here.')}</p>],
  };
  const shown = DASH_CARDS.filter(([id]) => !props.hidden.includes(id));
  // rows grow to fill the height; a short last row lets its last card take the rest of the row
  const cols = split ? 2 : 3;
  const rows = Math.max(1, Math.ceil(shown.length / cols));
  const rest = shown.length % cols;
  const waiting = live.filter((x) => userTodo(x, now));
  return (
    <div className={`dpage ${split ? 'split' : ''} ${props.mac ? 'mac' : ''}`} style={split ? { width: props.split } : undefined}>
      {props.mac && <div className="dp-drag" data-tauri-drag-region />}
      <header className="dp-head">
        <div className="dp-title">
          <h2>{L('대시보드', 'Dashboard')}</h2>
          <p>{L(`세션 ${live.length}개 · 내 차례 ${todo}건`, `${live.length} sessions · ${todo} need you`)}{props.notice && <em className="dp-notice">{props.notice}</em>}</p>
        </div>
        <button className="btn" onClick={() => setTodayOpen(true)}><Icon name="note" />{L('오늘 요약', 'Today')}</button>
        {props.historyDays > 0 && <button className="btn" onClick={() => setPastOpen(true)}><Icon name="clock" />{L('지난 기록', 'Past days')}</button>}
        <button className="btn" onClick={() => setMemOpen(true)}><Icon name="book" />{L('지침 파일', 'Instruction files')}</button>
        {props.onToggleSplit && <button className="btn" onClick={props.onToggleSplit}><Icon name={split ? 'monitor' : 'panel'} />{split ? L('대시보드만', 'Dashboard only') : L('방과 같이', 'With the room')}</button>}
        <button className="btn" onClick={props.onRoom}><Icon name="iso" />{split ? L('닫기', 'Close') : L('방으로', 'To the room')}</button>
        {!split && <button className="btn" onClick={props.onSettings} aria-label={L('설정', 'Settings')} title={L('설정', 'Settings')}><Icon name="gear" /></button>}
      </header>
      {waiting.length > 0 && (
        <div className="dp-turn" role="list" aria-label={L('내 차례', 'Your turn')}>
          <b>{L('내 차례', 'Your turn')}</b>
          {waiting.map((x) => (
            <span key={x.key} className="dp-turn-item">
            <button role="listitem" className={selected?.key === x.key ? 'on' : ''} onClick={() => pick(x.key)} title={userTodo(x, now)!.text}>
              <AgentMark agent={x.isDemo ? 'demo' : x.agent} size={12} />
              <span>{sessionNames(sessions)[x.key]}</span>
              <em>{userTodo(x, now)!.text}</em>
            </button>
            <ApproveButtons s={x} now={now} compact />
            </span>
          ))}
        </div>
      )}
      {sessions.length === 0 && props.onConnect && (
        <div className="dp-empty">
          <div><b>{L('아직 보이는 세션이 없어요', 'No sessions yet')}</b><span>{L('에이전트를 연결해 두면 Claude Code나 Codex가 일할 때 여기에 바로 나타나요.', 'Once agents are connected, Claude Code and Codex show up here as they work.')}</span></div>
          <button className="btn primary" onClick={props.onConnect}>{L('에이전트 연결하기', 'Connect agents')}</button>
        </div>
      )}
      <div className="dp-body dp-one" style={{ '--rows': rows } as React.CSSProperties}>
        <div className="g-stats"><StatCards sessions={sessions} now={now} h={h} cost={props.cost} onOpen={openStat} /></div>
        {shown.map(([id], i) => {
          const [cls, title, body] = cards[id]();
          const last = i === shown.length - 1 && rest > 0;
          return <FitCard key={id} cls={last ? `${cls} dp-last` : cls} title={title} style={last ? ({ '--span': cols - rest + 1 } as React.CSSProperties) : undefined} onWhole={() => { setWholeFilter('all'); setWhole(id); }}>{body}</FitCard>;
        })}
      </div>
      {whole && (
        <div className="dp-over" onClick={() => setWhole(null)}>
          <section className={`dash-card ${cards[whole]()[0]}`} onClick={(e) => e.stopPropagation()}>
            <h4 className="dash-h">{cards[whole]()[1]}<button className="link dp-open" onClick={() => setWhole(null)}>{L('닫기', 'Close')}</button></h4>
            <div className="dp-scroll">{whole === 'sessions' ? <SessionTable filter={wholeFilter} sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={pick} /> : cards[whole]()[2]}</div>
          </section>
        </div>
      )}
      {todayOpen && (
        <div className="dp-over">
          <section className="dash-card">
            <h4 className="dash-h">{L('오늘 요약', 'Today')}<button className="link dp-open" onClick={() => setTodayOpen(false)}>{L('닫기', 'Close')}</button></h4>
            <div className="dp-scroll"><TodayReport day={props.day} h={h} now={now} cost={props.cost} /></div>
          </section>
        </div>
      )}
      {pastOpen && (
        <div className="dp-over">
          <section className="dash-card">
            <h4 className="dash-h">{L('지난 기록', 'Past days')}<button className="link dp-open" onClick={() => setPastOpen(false)}>{L('닫기', 'Close')}</button></h4>
            <div className="dp-scroll"><PastDays days={props.historyDays} now={now} /></div>
          </section>
        </div>
      )}
      {memOpen && (
        <div className="dp-over">
          <section className="dash-card">
            <h4 className="dash-h">{L('지침 파일', 'Instruction files')}<button className="link dp-open" onClick={() => setMemOpen(false)}>{L('닫기', 'Close')}</button></h4>
            <div className="dp-scroll"><MemoryBrowser /></div>
          </section>
        </div>
      )}
    </div>
  );
}

/** the second line of a map card: what is asked of the user, else the file or command it is on, else the folder
 *  of a session shown by its chat name
 *  (a bare state like "승인 필요" would only repeat the label above it) */
function mapLine(s: Snapshot, now: number): string | null {
  const todo = userTodo(s, now);
  if (todo) return todo.text;
  const d = doingLabel(s);
  return d && d.includes(' · ') ? d : chatName(s) ? s.project : null;
}

/** me → each agent → its projects → their sessions (with sub-agent counts), like an org chart */
function AgentMap({ sessions, now, selected, onPick, onOpen }: { sessions: Snapshot[]; now: number; selected: string | null; onPick: (k: string) => void; onOpen: (k: string) => void }) {
  const names = sessionNames(sessions);
  const agents = (['claude', 'codex', 'demo'] as const)
    .map((a) => ({ a, list: sessions.filter((s) => (s.isDemo ? 'demo' : s.agent) === a) }))
    .filter((g) => g.list.length);
  if (!agents.length) return <p className="muted pad">{L('아직 세션이 없어요. Claude Code나 Codex가 작업을 시작하면 여기에 나타나요.', 'No sessions yet. Claude Code and Codex show up here when they start working.')}</p>;
  return (
    <div className={`dmap ${sessions.length <= 3 ? 'few' : ''}`}>
      <div className="dmap-root"><span>{L('나', 'You')}</span><small>{L(`세션 ${sessions.length}개`, `${sessions.length} sessions`)}</small></div>
      <div className="dmap-agents">
        {agents.map(({ a, list }) => {
          const projects = [...new Set(list.map((s) => s.project ?? L('프로젝트 미확인', 'Unknown project')))];
          return (
            <div key={a} className="dmap-col">
              <div className={`dmap-agent ag-${a}`}><AgentMark agent={a} size={16} /><b>{AGENT_NAME[a]}</b><small>{list.length}</small></div>
              {projects.map((p) => {
                const inP = list.filter((s) => (s.project ?? L('프로젝트 미확인', 'Unknown project')) === p);
                return (
                <div key={p} className="dmap-proj">
                  {/* a project with one session already named after it needs no heading */}
                  {!(inP.length === 1 && names[inP[0].key] === p) && <div className="dmap-pname">{p}</div>}
                  {inP.map((s) => (
                    <div key={s.key} className={`dmap-node t-${stateTone(s)} ${selected === s.key ? 'on' : ''}`} onClick={() => onPick(s.key)}>
                      <div className="dmap-top"><i className={`dot tone-${stateTone(s)}`} /><b title={`${names[s.key]}${s.cwd ? `\n${s.cwd}` : ''}`}>{names[s.key]}</b><span className={`tone-${stateTone(s)}`}>{stateLabel(s)}</span></div>
                      {mapLine(s, now) && <div className="dmap-doing" title={mapLine(s, now) ?? ''}>{mapLine(s, now)}</div>}
                      <div className="dmap-meta">
                        {s.origin && <em className={`o-${s.origin}`}>{ORIGIN_LABEL[s.origin]}</em>}
                        {s.subagents > 0 && <em>{L('하위 에이전트', 'Subagents')} {s.subagents}</em>}
                        {s.model && <em>{s.model}</em>}
                        {IN_TAURI && !s.isDemo && <button className="link" onClick={(e) => { e.stopPropagation(); onOpen(s.key); }}>{L('세션 열기', 'Open session')}</button>}
                      </div>
                    </div>
                  ))}
                </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** every agent's own task list on one board (read-only: the lists belong to the agents) */
function TaskBoard({ sessions, now, onPick }: { sessions: Snapshot[]; now: number; onPick: (k: string) => void }) {
  const names = sessionNames(sessions);
  type Card = { key: string; text: string; s: Snapshot };
  const cols: { id: string; label: string; cards: Card[] }[] = [
    { id: 'todo', label: L('내 차례', 'Your turn'), cards: sessions.filter((s) => userTodo(s, now)).map((s) => ({ key: `${s.key}-todo`, text: userTodo(s, now)!.text, s })) },
    { id: 'pending', label: L('할 일', 'To do'), cards: [] },
    { id: 'in_progress', label: L('진행 중', 'In progress'), cards: [] },
    { id: 'completed', label: L('완료', 'Done'), cards: [] },
  ];
  for (const s of sessions)
    s.plan.forEach((p, i) => {
      const c = cols.find((x) => x.id === (p.status === 'completed' ? 'completed' : p.status === 'in_progress' ? 'in_progress' : 'pending'))!;
      c.cards.push({ key: `${s.key}-${i}`, text: p.text || L('(제목 없음)', '(untitled)'), s });
    });
  const none = cols.every((c) => !c.cards.length);
  return (
    <>
      {none && <p className="muted small pad">{L('에이전트가 작업 목록(TodoWrite, update_plan 등)을 만들면 여기에 모여요.', 'Task lists the agents make (TodoWrite, update_plan and the like) gather here.')}</p>}
      {!none && <div className="dboard" title={L('작업 목록은 각 에이전트가 직접 만든 것이라 여기서 옮기거나 고칠 수 없어요. 카드를 누르면 그 세션으로 가요.', "The agents make these task lists themselves, so they can't be moved or edited here. Click a card to go to its session.")}>
        {cols.map((c) => (
          <section key={c.id} className={`dboard-col c-${c.id}`}>
            <h4><em>{c.label}</em><span>{c.cards.length}</span></h4>
            {c.cards.map((k) => (
              <div key={k.key} className="dboard-card" onClick={() => onPick(k.s.key)}>
                <p title={`${k.text}\n${names[k.s.key]}`}>{k.text}</p>
                <span className="tag"><AgentMark agent={k.s.isDemo ? 'demo' : k.s.agent} size={12} /><span className="nm">{names[k.s.key]}</span></span>
              </div>
            ))}
          </section>
        ))}
      </div>}
    </>
  );
}

/** the last 14 days of tokens as stacked bars (Claude under Codex), with each agent's 30-day share */
function UsageShare({ h }: { h: UsageHistory | null }) {
  if (!h) return <p className="pn-note pad">{L('로그에서 사용량을 모으는 중…', 'Reading usage from the logs…')}</p>;
  const c = h.days.reduce((a, d) => a + d.claude, 0);
  const x = h.days.reduce((a, d) => a + d.codex, 0);
  const total = c + x;
  const days = h.days.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.claude + d.codex));
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const fmt = new Intl.DateTimeFormat(L('ko-KR', 'en-US'), { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  const dayLabel = (d: number) => fmt.format(d * 86_400_000);
  return (
    <div className="dshare pad">
      <div className="ubars" role="img" aria-label={L('최근 14일 토큰', 'Tokens, last 14 days')}>
        {days.map((d, i) => (
          <span key={d.day} className={i === days.length - 1 ? 'today' : ''} title={`${dayLabel(d.day)} · Claude ${fmtTokens(d.claude)} · Codex ${fmtTokens(d.codex)}`}>
            <i className="a-codex" style={{ height: `${(d.codex / max) * 100}%` }} />
            <i className="a-claude" style={{ height: `${(d.claude / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="ubars-x"><small>{days.length ? dayLabel(days[0].day) : ''}</small><small>{L('오늘', 'Today')}</small></div>
      <ul>
        <li><i style={{ background: 'var(--claude)' }} />Claude Code<b>{fmtTokens(c)}</b><small>{pct(c)}%</small></li>
        <li><i style={{ background: 'var(--codex)' }} />Codex<b>{fmtTokens(x)}</b><small>{pct(x)}%</small></li>
        <li className="sum">{L('30일 합계', '30-day total')}<b>{fmtTokens(total)}</b><small /></li>
      </ul>
    </div>
  );
}

function TodayReport({ day, h, now, cost }: { day: DayLog | null; h: UsageHistory | null; now: number; cost?: { claude: number; codex: number } }) {
  const [saved, setSaved] = useState<string | null>(null);
  const d = daySummary(day, h, now);
  const usd = d.tokens ? estCost(d.tokens, cost) : null;
  const md = dayMarkdown(d, fmtTokens, usd);
  const save = async () => {
    try { const at = await backend.saveReport(reportName(d.from), md); setSaved(L(`${at}에 저장했어요`, `Saved to ${at}`)); } catch (e) { setSaved(`${L('저장하지 못했어요', "Couldn't save")}: ${String(e)}`); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(md); setSaved(L('복사했어요', 'Copied')); } catch { setSaved(L('복사하지 못했어요', "Couldn't copy")); }
  };
  const total = d.tokens ? d.tokens.claude + d.tokens.codex : 0;
  // the chart runs from the first active hour (at least eight hours back) to the current hour
  const nowH = Math.min(23, Math.floor((now - d.from) / 3_600_000));
  const startH = Math.max(0, Math.min(nowH - 7, d.first !== null ? Math.floor((d.first - d.from) / 3_600_000) : nowH - 7));
  const hours = d.hours.slice(startH, nowH + 1).map((x, i) => ({ h: startH + i, ...x }));
  // sessions run side by side, so an hour can hold more than 60 minutes of work; the tallest bar sets the scale
  const scale = Math.max(3_600_000, ...hours.map((x) => x.work + x.wait));
  const busiest = hours.reduce<(typeof hours)[number] | null>((m, x) => (x.work + x.wait > (m ? m.work + m.wait : 0) ? x : m), null);
  const ranked = [...d.sessions].sort((x, y) => y.workMs - x.workMs || y.turns - x.turns);
  const maxWork = Math.max(1, ...ranked.map((x) => x.workMs));
  const quiet = !d.turns && !d.workMs && !d.asks;
  const step = hours.length > 16 ? 3 : hours.length > 8 ? 2 : 1;
  const agentOf = (name: string) => (name === AGENT_NAME.codex ? 'codex' : 'claude');
  return (
    <div className="dtoday">
      <section className="dt-hero">
        <p className="dt-lead">{quiet
          ? L('오늘은 아직 받은 활동이 없어요.', 'Nothing has happened today yet.')
          : L(`오늘 프로젝트 ${d.sessions.length}곳에서 요청 ${d.turns}건을 끝냈어요.`, `${d.turns} requests done across ${d.sessions.length} projects today.`)}</p>
        {!quiet && (
          <p className="dt-story">
            {busiest && busiest.work + busiest.wait > 0 && L(`가장 바빴던 때는 ${busiest.h}시`, `Busiest around ${busiest.h}:00`)}
            {ranked[0]?.workMs > 0 && L(`, 가장 오래 일한 곳은 ${ranked[0].project}예요.`, `, most time on ${ranked[0].project}.`)}
            {d.testsFail > 0 ? L(` 테스트가 ${d.testsFail}번 실패했어요.`, ` Tests failed ${d.testsFail} times.`) : d.testsOk > 0 ? L(` 테스트는 모두 통과했어요.`, ` Every test run passed.`) : ''}
          </p>
        )}
        <div className="dt-kpis">
          <span><b>{fmtSpan(d.workMs)}</b><small>{L('에이전트 작업', 'Agents working')}</small></span>
          <span className="wait"><b>{fmtSpan(d.waitMs)}</b><small>{L('내 차례 기다림', 'Waiting for you')}</small></span>
          {d.first !== null && <span><b>{fmtClock(d.first).slice(0, 5)}–{fmtClock(d.last ?? now).slice(0, 5)}</b><small>{L('활동 시간대', 'Active between')}</small></span>}
        </div>
      </section>
      <section className="dt-chart" aria-label={L('시간대별 작업', 'Work by hour')}>
        <div className="dt-bars">
          {hours.map((x) => (
            <div key={x.h} className={`dt-bar ${x.h === nowH ? 'now' : ''}`} title={L(`${x.h}시 · 작업 ${fmtSpan(x.work)} · 기다림 ${fmtSpan(x.wait)}`, `${x.h}:00 · working ${fmtSpan(x.work)} · waiting ${fmtSpan(x.wait)}`)}>
              <i className="wait" style={{ height: `${(x.wait / scale) * 100}%` }} />
              <i className="work" style={{ height: `${(x.work / scale) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="dt-hours">{hours.map((x) => <span key={x.h}>{(x.h - startH) % step === 0 ? L(`${x.h}시`, `${x.h}h`) : ''}</span>)}</div>
        <div className="lane-legend dt-legend"><span><i className="seg work" />{L('작업', 'Working')}</span><span><i className="seg wait" />{L('내 차례', 'Your turn')}</span><small>{L(`세션 시간을 더한 값 · 맨 위 ${fmtSpan(scale)}`, `Sessions added up · top ${fmtSpan(scale)}`)}</small></div>
      </section>
      <div className="dt-tiles">
        <Tile k={L('끝낸 요청', 'Requests done')} v={d.turns} />
        <div className={`dt-tile ${d.testsOk + d.testsFail ? '' : 'zero'}`}>
          <small>{L('테스트', 'Tests')}</small>
          <div className="dt-tests"><b className="ok">{d.testsOk}</b><span>{L('통과', 'passed')}</span><b className={d.testsFail ? 'bad' : ''}>{d.testsFail}</b><span>{L('실패', 'failed')}</span></div>
          {d.testsOk + d.testsFail > 0 && <span className="dt-split"><i className="ok" style={{ flex: d.testsOk }} /><i className="bad" style={{ flex: d.testsFail }} /></span>}
        </div>
        <Tile k={L('승인·답변 요청', 'Approvals and questions')} v={d.asks} />
        <Tile k={L('고친 파일', 'Files edited')} v={d.files} />
        <div className={`dt-tile ${total ? '' : 'zero'}`}>
          <small>{L('토큰', 'Tokens')}</small>
          <b>{d.tokens ? fmtTokens(total) : '—'}</b>
          {d.tokens && total > 0 && (
            <span className="dt-split" title={`Claude Code ${fmtTokens(d.tokens.claude)} · Codex ${fmtTokens(d.tokens.codex)}`}>
              <i className="a-claude" style={{ flex: d.tokens.claude }} /><i className="a-codex" style={{ flex: d.tokens.codex }} />
            </span>
          )}
        </div>
        {usd !== null && <div className="dt-tile"><small>{L('추정 비용', 'Estimated cost')}</small><b>{fmtUsd(usd)}</b></div>}
      </div>
      <h4 className="dash-h">{L('프로젝트별 작업 시간', 'Working time by project')} <span className="pn-count">{d.sessions.length}</span></h4>
      {ranked.length ? (
        <ul className="dt-sess">
          {ranked.map((x, i) => (
            <li key={`${x.project}-${i}`}>
              <div className="dt-sess-top">
                <AgentMark agent={agentOf(x.agent)} size={13} /><b>{x.project}</b>
                <span>{fmtSpan(x.workMs)} · {L(`요청 ${x.turns} · 파일 ${x.files.length}`, `${x.turns} requests · ${x.files.length} files`)}</span>
              </div>
              <span className={`dt-meter a-${agentOf(x.agent)}`}><i style={{ width: `${(x.workMs / maxWork) * 100}%` }} /></span>
              {x.files.length > 0 && <div className="dt-files">{x.files.slice(0, 8).map((f) => <code key={f} title={f}>{f.split('/').pop()}</code>)}{x.files.length > 8 && <small>+{x.files.length - 8}</small>}</div>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{L('오늘 받은 이벤트가 아직 없어요.', 'No events yet today.')}</p>}
      <details className="dt-md">
        <summary>{L('보고서 원문 (Markdown)', 'Report text (Markdown)')} <small className="muted">{L('저장·복사하면 이 내용이 들어가요. 프로젝트와 파일 이름이 포함돼요.', 'This is what gets saved or copied. It includes project and file names.')}</small></summary>
        <pre className="dtoday-md">{md}</pre>
      </details>
      <div className="dtoday-act">
        <button className="btn primary" onClick={() => void save()}>{IN_TAURI ? L('다운로드 폴더에 저장', 'Save to Downloads') : L('Markdown 받기', 'Get Markdown')}</button>
        <button className="btn" onClick={() => void copy()}>{L('복사', 'Copy')}</button>
        {saved && <span className="muted small">{saved}</span>}
      </div>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: number }) {
  return <div className={`dt-tile ${v ? '' : 'zero'}`}><small>{k}</small><b>{v}</b></div>;
}

/** a past day's timeline, from the history kept on this computer */
function PastDays({ days, now }: { days: number; now: number }) {
  const iso = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [day, setDay] = useState(() => iso(now - 86_400_000));
  const [lines, setLines] = useState<HistLine[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    const [y, m, d] = day.split('-').map(Number);
    const from = new Date(y, m - 1, d).getTime();
    setLines(null);
    void backend.historyRead(from, from + 86_400_000).then(setLines).catch(() => setLines([]));
  }, [day]);
  const query = q.trim().toLowerCase();
  const shown = (lines ?? []).filter((l) => !query || `${l.project ?? ''} ${timelineText(l.entry)}`.toLowerCase().includes(query));
  const projects = new Set((lines ?? []).map((l) => l.key)).size;
  return (
    <div className="dash-log dpast">
      <div className="dash-chips">
        <input type="date" value={day} min={iso(now - (days - 1) * 86_400_000)} max={iso(now)} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <span className="muted small">{lines ? L(`세션 ${projects}개 · 기록 ${lines.length}개`, `${projects} sessions · ${lines.length} entries`) : L('읽는 중…', 'Reading…')}</span>
        <input type="search" placeholder={L('프로젝트·내용 검색', 'Search projects and text')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {lines && !shown.length && <p className="muted pad">{lines.length ? L('검색과 맞는 기록이 없어요.', 'Nothing matches the search.') : L('이 날의 기록이 없어요. 기록은 설정에서 켠 뒤부터 쌓여요.', 'Nothing kept for this day. History builds up once it is on in settings.')}</p>}
      <ol>
        {shown.map((l) => (
          <li key={`${l.key}-${l.entry.id}-${l.entry.at}`} className={`k-${l.entry.kind} ${l.entry.ok === false ? 'bad' : l.entry.ok === true ? 'ok' : ''}`}>
            <i />
            <time>{fmtClock(l.entry.at)}</time>
            <span className="tag"><AgentMark agent={l.agent === 'demo' ? 'demo' : (l.agent as 'claude' | 'codex')} size={11} /><span className="nm">{l.project ?? AGENT_NAME[l.agent as 'claude'] ?? l.agent}</span></span>
            <span className="txt">{timelineText(l.entry)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** the CLAUDE.md / AGENTS.md files the agents load: search across and inside them, jump by heading, open in an editor */
function MemoryBrowser() {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [pick, setPick] = useState(0);
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => { void backend.memoryFiles().then(setFiles).catch(() => setFiles([])); }, []);
  const query = q.trim().toLowerCase();
  const count = (text: string) => { if (!query) return 0; let n = 0; for (let i = text.toLowerCase().indexOf(query); i >= 0; i = text.toLowerCase().indexOf(query, i + query.length)) n++; return n; };
  const shown = useMemo(() => (files ?? []).filter((f) => !query || `${f.label} ${f.content}`.toLowerCase().includes(query)), [files, query]);
  const f = shown.length ? shown[Math.min(pick, shown.length - 1)] : null;
  const lines = useMemo(() => (f ? f.content.split('\n') : []), [f]);
  const heads = useMemo(() => lines.map((t, i) => ({ i, m: /^(#{1,3})\s+(.+)/.exec(t) })).filter((x) => x.m).map((x) => ({ line: x.i, level: x.m![1].length, text: x.m![2] })), [lines]);
  const total = f ? count(f.content) : 0;
  // the current match scrolls into view whenever it or the file changes
  useEffect(() => { view.current?.querySelector('mark.cur')?.scrollIntoView({ block: 'center' }); }, [hit, f, query]);
  if (!files) return <p className="muted pad">{L('파일을 읽는 중…', 'Reading files…')}</p>;
  if (!files.length) return <p className="muted pad">{L('에이전트 지침 파일(CLAUDE.md, AGENTS.md)을 찾지 못했어요. 전역 파일과 지금 보이는 세션의 프로젝트 폴더만 찾아봐요.', 'No agent instruction files (CLAUDE.md, AGENTS.md) found. Only the global files and the project folders of the sessions shown are checked.')}</p>;
  const go = (d: number) => total && setHit((h) => (h + d + total) % total);
  const toLine = (n: number) => view.current?.querySelector(`[data-line="${n}"]`)?.scrollIntoView({ block: 'start' });
  // highlight matches; numbering them across the file marks the current one
  let k = 0;
  const mark = (t: string) => {
    if (!query) return t || '\u00a0';
    const out: React.ReactNode[] = [];
    let at = 0;
    for (let i = t.toLowerCase().indexOf(query); i >= 0; i = t.toLowerCase().indexOf(query, at)) {
      out.push(t.slice(at, i), <mark key={i} className={k === hit % Math.max(1, total) ? 'cur' : ''}>{t.slice(i, i + query.length)}</mark>);
      k++;
      at = i + query.length;
    }
    out.push(t.slice(at));
    return out;
  };
  return (
    <div className="dmem">
      <section className="dmem-list">
        <input type="search" placeholder={L('파일·내용 검색', 'Search files and text')} value={q} autoFocus
          onChange={(e) => { setQ(e.target.value); setPick(0); setHit(0); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }} />
        {shown.map((x, i) => (
          <button key={x.path} className={x === f ? 'on' : ''} onClick={() => { setPick(i); setHit(0); }} title={x.path}>
            <b>{x.label}{query && <em className="dmem-n">{count(x.content)}</em>}</b><small>{x.path}</small>
          </button>
        ))}
        {!shown.length && <p className="muted small pad">{L('검색과 맞는 파일이 없어요.', 'No files match the search.')}</p>}
      </section>
      {f && (
        <section className="dmem-view">
          <div className="dmem-bar">
            <h4 className="dmem-path" title={f.path}>{f.path}{f.truncated && L(' (앞부분 200KB만)', ' (first 200 KB only)')}</h4>
            {query && <span className="dmem-find">{total ? `${(hit % total) + 1}/${total}` : L('없음', 'none')}<button className="btn" onClick={() => go(-1)} disabled={!total} aria-label={L('이전', 'Previous')}>↑</button><button className="btn" onClick={() => go(1)} disabled={!total} aria-label={L('다음', 'Next')}>↓</button></span>}
            <button className="btn" onClick={() => void navigator.clipboard.writeText(f.path).then(() => setNote(L('경로를 복사했어요', 'Path copied')), () => undefined)}>{L('경로 복사', 'Copy path')}</button>
            {IN_TAURI && <button className="btn primary" onClick={() => void backend.openMemoryFile(f.path).catch((e) => setNote(String(e)))}>{L('편집기로 열기', 'Open in editor')}</button>}
          </div>
          <div className="dmem-body">
            {heads.length > 1 && (
              <nav className="dmem-toc" aria-label={L('목차', 'Outline')}>
                {heads.map((h) => <button key={h.line} className={`lv${h.level}`} onClick={() => toLine(h.line)}>{h.text}</button>)}
              </nav>
            )}
            <div className="dmem-text" ref={view}>
              {lines.map((t, i) => <div key={i} data-line={i} className={/^#{1,3}\s/.test(t) ? 'h' : ''}><span className="ln">{i + 1}</span><span className="tx">{mark(t)}</span></div>)}
            </div>
          </div>
          <p className="pn-note pad">{note ?? L(`줄 ${lines.length}개 · 제목 ${heads.length}개 · 이 컴퓨터의 파일을 바로 읽어 보여 줄 뿐, 어디에도 보내지 않아요.`, `${lines.length} lines · ${heads.length} headings · read straight from this computer and sent nowhere.`)}</p>
        </section>
      )}
    </div>
  );
}
