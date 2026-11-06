// The dashboard: everything on one screen with no page scroll, either filling the window
// ("대시보드만") or beside the room ("방과 같이"). Counts, the agent map, recent activity, every task
// list, usage limits, sessions and the picked session each get one cell of a grid that fills the height.
// Everything shown comes from hook events, the agents' local usage logs and their local
// CLAUDE.md / AGENTS.md files; nothing calls a model.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { backend, IN_TAURI } from '../bridge';
import type { HistLine, MemoryFile, Snapshot, TimelineEntry, UsageHistory } from '../types';
import { AGENT_NAME, ORIGIN_LABEL, doingLabel, fmtClock, timelineText, sessionNames, stateLabel, stateTone } from '../labels';
import { AgentMark, Icon } from './icons';
import { ActivityLog, SessionTable, StatCards } from './Activity';
import { userTodo } from './Overview';
import { fmtTokens, LimitCards, useUsageHistory } from './Usage';
import { Tasks, Timeline } from './DetailPanel';
import { ApproveButtons } from './Approve';
import { dayMarkdown, daySummary, estCost, fmtUsd, reportName } from '../report';

/** the cards below the counts, in grid order; settings can turn any of them off */
export const DASH_CARDS = [
  ['map', '에이전트 지도'],
  ['activity', '최근 활동'],
  ['usage', '남은 사용량'],
  ['board', '작업 보드'],
  ['sessions', '세션'],
  ['picked', '선택한 세션'],
] as const;

export function DashboardPage(props: {
  sessions: Snapshot[];
  timelines: Record<string, TimelineEntry[]>;
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
  const card = (cls: string, title: React.ReactNode, body: React.ReactNode, style?: React.CSSProperties) => (
    <section className={`dash-card ${cls}`} style={style}><h4 className="dash-h">{title}</h4><div className="dp-scroll">{body}</div></section>
  );
  const split = props.split !== undefined;
  const cards: Record<(typeof DASH_CARDS)[number][0], () => [string, React.ReactNode, React.ReactNode]> = {
    map: () => ['g-map', <>에이전트 지도 <span className="pn-count">{live.length}</span></>, <AgentMap sessions={sessions} now={now} selected={selected?.key ?? null} onPick={pick} onOpen={props.onOpen} />],
    activity: () => ['g-act', '최근 활동', <ActivityLog sessions={sessions} timelines={props.timelines} onSelect={pick} compact />],
    usage: () => ['g-use', '남은 사용량', <><LimitCards sessions={sessions} now={now} accountLimits={props.accountLimits} onSettings={props.onSettings} /><UsageShare h={h} /></>],
    board: () => ['g-board', '작업 보드', <TaskBoard sessions={live} now={now} onPick={pick} />],
    sessions: () => ['g-sess', <>세션 <span className="pn-count">{sessions.length}</span></>, <SessionTable sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={pick} />],
    picked: () => ['g-pick', <>
      {selected ? <><AgentMark agent={selected.isDemo ? 'demo' : selected.agent} size={14} /> {selected.project ?? '세션'}</> : '선택한 세션'}
      {selected && canOpen(selected) && <button className="link dp-open" onClick={() => props.onOpen(selected.key)}>세션 열기</button>}
    </>, selected ? <><Tasks s={selected} /><Timeline entries={props.timelines[selected.key] ?? []} /></> : <p className="muted pad">세션을 누르면 작업과 타임라인이 여기에 나와요.</p>],
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
        <h2>대시보드</h2>
        <p>세션 {live.length}개 · 내 차례 {todo}건{props.notice && <em className="dp-notice">{props.notice}</em>}</p>
        <button className="btn" onClick={() => setTodayOpen(true)}><Icon name="note" />오늘 요약</button>
        {props.historyDays > 0 && <button className="btn" onClick={() => setPastOpen(true)}><Icon name="clock" />지난 기록</button>}
        <button className="btn" onClick={() => setMemOpen(true)}><Icon name="book" />지침 파일</button>
        {props.onToggleSplit && <button className="btn" onClick={props.onToggleSplit}><Icon name={split ? 'monitor' : 'panel'} />{split ? '대시보드만' : '방과 같이'}</button>}
        <button className="btn" onClick={props.onRoom}><Icon name="iso" />{split ? '닫기' : '방으로'}</button>
        {!split && <button className="btn" onClick={props.onSettings} aria-label="설정" title="설정"><Icon name="gear" /></button>}
      </header>
      {waiting.length > 0 && (
        <div className="dp-turn" role="list" aria-label="내 차례">
          <b>내 차례</b>
          {waiting.map((x) => (
            <span key={x.key} className="dp-turn-item">
            <button role="listitem" className={selected?.key === x.key ? 'on' : ''} onClick={() => pick(x.key)} title={userTodo(x, now)!.text}>
              <AgentMark agent={x.isDemo ? 'demo' : x.agent} size={12} />
              <span>{x.project ?? AGENT_NAME[x.agent]}</span>
              <em>{userTodo(x, now)!.text}</em>
            </button>
            <ApproveButtons s={x} now={now} compact />
            </span>
          ))}
        </div>
      )}
      <div className="dp-body dp-one" style={{ '--rows': rows } as React.CSSProperties}>
        <div className="g-stats"><StatCards sessions={sessions} now={now} h={h} cost={props.cost} /></div>
        {shown.map(([id], i) => {
          const [cls, title, body] = cards[id]();
          const last = i === shown.length - 1 && rest > 0;
          return <Fragment key={id}>{card(last ? `${cls} dp-last` : cls, title, body, last ? ({ '--span': cols - rest + 1 } as React.CSSProperties) : undefined)}</Fragment>;
        })}
      </div>
      {todayOpen && (
        <div className="dp-over">
          <section className="dash-card">
            <h4 className="dash-h">오늘 요약<button className="link dp-open" onClick={() => setTodayOpen(false)}>닫기</button></h4>
            <div className="dp-scroll"><TodayReport sessions={sessions} timelines={props.timelines} h={h} now={now} cost={props.cost} /></div>
          </section>
        </div>
      )}
      {pastOpen && (
        <div className="dp-over">
          <section className="dash-card">
            <h4 className="dash-h">지난 기록<button className="link dp-open" onClick={() => setPastOpen(false)}>닫기</button></h4>
            <div className="dp-scroll"><PastDays days={props.historyDays} now={now} /></div>
          </section>
        </div>
      )}
      {memOpen && (
        <div className="dp-over">
          <section className="dash-card">
            <h4 className="dash-h">지침 파일<button className="link dp-open" onClick={() => setMemOpen(false)}>닫기</button></h4>
            <div className="dp-scroll"><MemoryBrowser /></div>
          </section>
        </div>
      )}
    </div>
  );
}

/** me → each agent → its projects → their sessions (with sub-agent counts), like an org chart */
function AgentMap({ sessions, now, selected, onPick, onOpen }: { sessions: Snapshot[]; now: number; selected: string | null; onPick: (k: string) => void; onOpen: (k: string) => void }) {
  const names = sessionNames(sessions);
  const agents = (['claude', 'codex', 'demo'] as const)
    .map((a) => ({ a, list: sessions.filter((s) => (s.isDemo ? 'demo' : s.agent) === a) }))
    .filter((g) => g.list.length);
  if (!agents.length) return <p className="muted pad">아직 세션이 없어요. Claude Code나 Codex가 작업을 시작하면 여기에 나타나요.</p>;
  return (
    <div className={`dmap ${sessions.length <= 3 ? 'few' : ''}`}>
      <div className="dmap-root"><span>나</span><small>세션 {sessions.length}개</small></div>
      <div className="dmap-agents">
        {agents.map(({ a, list }) => {
          const projects = [...new Set(list.map((s) => s.project ?? '프로젝트 미확인'))];
          return (
            <div key={a} className="dmap-col">
              <div className={`dmap-agent ag-${a}`}><AgentMark agent={a} size={16} /><b>{AGENT_NAME[a]}</b><small>{list.length}</small></div>
              {projects.map((p) => (
                <div key={p} className="dmap-proj">
                  <div className="dmap-pname">{p}</div>
                  {list.filter((s) => (s.project ?? '프로젝트 미확인') === p).map((s) => (
                    <div key={s.key} className={`dmap-node t-${stateTone(s)} ${selected === s.key ? 'on' : ''}`} onClick={() => onPick(s.key)}>
                      <div className="dmap-top"><i className={`dot tone-${stateTone(s)}`} /><b>{names[s.key]}</b><span className={`tone-${stateTone(s)}`}>{stateLabel(s)}</span></div>
                      {(doingLabel(s) ?? s.title) && <div className="dmap-doing">{doingLabel(s) ?? s.title}</div>}
                      <div className="dmap-meta">
                        {userTodo(s, now) && <em className="wait">{userTodo(s, now)!.text}</em>}
                        {s.origin && <em className={`o-${s.origin}`}>{ORIGIN_LABEL[s.origin]}</em>}
                        {s.subagents > 0 && <em>하위 에이전트 {s.subagents}</em>}
                        {s.model && <em>{s.model}</em>}
                        {IN_TAURI && !s.isDemo && <button className="link" onClick={(e) => { e.stopPropagation(); onOpen(s.key); }}>세션 열기</button>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
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
    { id: 'todo', label: '내 차례', cards: sessions.filter((s) => userTodo(s, now)).map((s) => ({ key: `${s.key}-todo`, text: userTodo(s, now)!.text, s })) },
    { id: 'pending', label: '할 일', cards: [] },
    { id: 'in_progress', label: '진행 중', cards: [] },
    { id: 'completed', label: '완료', cards: [] },
  ];
  for (const s of sessions)
    s.plan.forEach((p, i) => {
      const c = cols.find((x) => x.id === (p.status === 'completed' ? 'completed' : p.status === 'in_progress' ? 'in_progress' : 'pending'))!;
      c.cards.push({ key: `${s.key}-${i}`, text: p.text || '(제목 없음)', s });
    });
  const none = cols.every((c) => !c.cards.length);
  return (
    <>
      {none && <p className="muted small pad">에이전트가 작업 목록(TodoWrite, update_plan 등)을 만들면 여기에 모여요.</p>}
      {!none && <div className="dboard" title="작업 목록은 각 에이전트가 직접 만든 것이라 여기서 옮기거나 고칠 수 없어요. 카드를 누르면 그 세션으로 가요.">
        {cols.map((c) => (
          <section key={c.id} className={`dboard-col c-${c.id}`}>
            <h4>{c.label}<span>{c.cards.length}</span></h4>
            {c.cards.map((k) => (
              <div key={k.key} className="dboard-card" onClick={() => onPick(k.s.key)}>
                <p>{k.text}</p>
                <span className="tag"><AgentMark agent={k.s.isDemo ? 'demo' : k.s.agent} size={12} />{names[k.s.key]}</span>
              </div>
            ))}
          </section>
        ))}
      </div>}
    </>
  );
}

/** Claude vs Codex share of the last 30 days, as a ring */
function UsageShare({ h }: { h: UsageHistory | null }) {
  if (!h) return <p className="pn-note pad">로그에서 사용량을 모으는 중…</p>;
  const c = h.days.reduce((a, d) => a + d.claude, 0);
  const x = h.days.reduce((a, d) => a + d.codex, 0);
  const total = c + x;
  const r = 42;
  const len = 2 * Math.PI * r;
  const cl = total ? (c / total) * len : 0;
  return (
    <div className="dshare pad">
      <svg viewBox="0 0 110 110" width="120" height="120" role="img" aria-label="에이전트별 토큰 비중">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--hair)" strokeWidth="14" />
        {total > 0 && <circle cx="55" cy="55" r={r} fill="none" stroke="var(--codex)" strokeWidth="14" />}
        {total > 0 && <circle cx="55" cy="55" r={r} fill="none" stroke="var(--claude)" strokeWidth="14" strokeDasharray={`${cl} ${len}`} transform="rotate(-90 55 55)" />}
        <text x="55" y="53" textAnchor="middle" className="dshare-n">{fmtTokens(total)}</text>
        <text x="55" y="68" textAnchor="middle" className="dshare-s">30일 합계</text>
      </svg>
      <ul>
        <li><i style={{ background: 'var(--claude)' }} />Claude Code<b>{fmtTokens(c)}</b><small>{total ? Math.round((c / total) * 100) : 0}%</small></li>
        <li><i style={{ background: 'var(--codex)' }} />Codex<b>{fmtTokens(x)}</b><small>{total ? Math.round((x / total) * 100) : 0}%</small></li>
      </ul>
    </div>
  );
}

/** today's numbers, and the same as a Markdown report to look at before it is saved */
function TodayReport({ sessions, timelines, h, now, cost }: { sessions: Snapshot[]; timelines: Record<string, TimelineEntry[]>; h: UsageHistory | null; now: number; cost?: { claude: number; codex: number } }) {
  const [saved, setSaved] = useState<string | null>(null);
  const d = daySummary(sessions, timelines, h, now);
  const usd = d.tokens ? estCost(d.tokens, cost) : null;
  const md = dayMarkdown(d, fmtTokens, usd);
  const nums: [string, string][] = [
    ['끝낸 요청', `${d.turns}회`],
    ['테스트', `통과 ${d.testsOk} · 실패 ${d.testsFail}`],
    ['승인·답변 요청', `${d.asks}회`],
    ['고친 파일', `${d.files}개`],
    ['토큰', d.tokens ? fmtTokens(d.tokens.claude + d.tokens.codex) : '—'],
    ...(usd !== null ? [['추정 비용', fmtUsd(usd)] as [string, string]] : []),
  ];
  const save = async () => {
    try { setSaved(`${await backend.saveReport(reportName(d.from), md)}에 저장했어요`); } catch (e) { setSaved(`저장하지 못했어요: ${String(e)}`); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(md); setSaved('복사했어요'); } catch { setSaved('복사하지 못했어요'); }
  };
  return (
    <div className="dtoday">
      <div className="dash-stats">
        {nums.map(([k, v]) => <div key={k} className="dash-stat"><small>{k}</small><b>{v}</b></div>)}
      </div>
      <h4 className="dash-h">보고서 미리보기 <small className="muted">저장하기 전에 확인하세요. 프로젝트 이름과 파일 이름이 들어가요.</small></h4>
      <pre className="dtoday-md">{md}</pre>
      <div className="dtoday-act">
        <button className="btn primary" onClick={() => void save()}>{IN_TAURI ? '다운로드 폴더에 저장' : 'Markdown 받기'}</button>
        <button className="btn" onClick={() => void copy()}>복사</button>
        {saved && <span className="muted small">{saved}</span>}
      </div>
    </div>
  );
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
        <span className="muted small">{lines ? `세션 ${projects}개 · 기록 ${lines.length}개` : '읽는 중…'}</span>
        <input type="search" placeholder="프로젝트·내용 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {lines && !shown.length && <p className="muted pad">{lines.length ? '검색과 맞는 기록이 없어요.' : '이 날의 기록이 없어요. 기록은 설정에서 켠 뒤부터 쌓여요.'}</p>}
      <ol>
        {shown.map((l) => (
          <li key={`${l.key}-${l.entry.id}-${l.entry.at}`} className={`k-${l.entry.kind} ${l.entry.ok === false ? 'bad' : l.entry.ok === true ? 'ok' : ''}`}>
            <i />
            <time>{fmtClock(l.entry.at)}</time>
            <span className="tag"><AgentMark agent={l.agent === 'demo' ? 'demo' : (l.agent as 'claude' | 'codex')} size={11} />{l.project ?? AGENT_NAME[l.agent as 'claude'] ?? l.agent}</span>
            <span className="txt">{timelineText(l.entry)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** the CLAUDE.md / AGENTS.md files the agents load, read-only */
function MemoryBrowser() {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [pick, setPick] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => { void backend.memoryFiles().then(setFiles).catch(() => setFiles([])); }, []);
  const shown = useMemo(() => (files ?? []).filter((f) => !q.trim() || `${f.label} ${f.content}`.toLowerCase().includes(q.trim().toLowerCase())), [files, q]);
  if (!files) return <p className="muted pad">파일을 읽는 중…</p>;
  if (!files.length) return <p className="muted pad">에이전트 지침 파일(CLAUDE.md, AGENTS.md)을 찾지 못했어요. 전역 파일과 지금 보이는 세션의 프로젝트 폴더만 찾아봐요.</p>;
  const f = shown[Math.min(pick, shown.length - 1)];
  return (
    <div className="dmem">
      <section className="dmem-list">
        <input type="search" placeholder="파일·내용 검색" value={q} onChange={(e) => { setQ(e.target.value); setPick(0); }} />
        {shown.map((x, i) => (
          <button key={x.path} className={x === f ? 'on' : ''} onClick={() => setPick(i)} title={x.path}>
            <b>{x.label}</b><small>{x.path}</small>
          </button>
        ))}
      </section>
      <section className="dmem-view">
        {f ? (
          <>
            <h4 className="dmem-path">{f.path}{f.truncated && ' (앞부분 200KB만)'}</h4>
            <pre>{f.content}</pre>
            <p className="pn-note pad">읽기 전용이에요. 이 컴퓨터의 파일을 바로 읽어 보여 줄 뿐, 어디에도 보내지 않아요.</p>
          </>
        ) : <p className="muted pad">검색과 맞는 파일이 없어요.</p>}
      </section>
    </div>
  );
}
