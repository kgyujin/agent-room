// The full-window dashboard (any window size): a sidebar of sections in the manner of a command
// centre: overview, agent map, task board, activity, usage, instruction files and one session.
// Everything shown comes from hook events, the agents' local usage logs and their local
// CLAUDE.md / AGENTS.md files; nothing calls a model.
import { useEffect, useMemo, useState } from 'react';
import { backend, IN_TAURI } from '../bridge';
import type { MemoryFile, Snapshot, TimelineEntry, UsageHistory } from '../types';
import { AGENT_NAME, doingLabel, sessionNames, stateLabel, stateTone } from '../labels';
import { AgentMark, Icon } from './icons';
import { ActivityLog, SessionTable, StatCards } from './Activity';
import { Overview, userTodo } from './Overview';
import { fmtTokens, UsageBoard, useUsageHistory } from './Usage';
import { SessionInfo, Tasks, Timeline } from './DetailPanel';

type Section = 'home' | 'map' | 'board' | 'activity' | 'usage' | 'memory' | 'session';
const NAV: [Section, string, Parameters<typeof Icon>[0]['name']][] = [
  ['home', '개요', 'monitor'],
  ['map', '에이전트 지도', 'link'],
  ['board', '작업 보드', 'check'],
  ['activity', '활동 기록', 'clock'],
  ['usage', '사용량', 'bolt'],
  ['memory', '지침 파일', 'book'],
];

export function DashboardPage(props: {
  sessions: Snapshot[];
  timelines: Record<string, TimelineEntry[]>;
  selected: Snapshot | null;
  now: number;
  onSelect: (k: string) => void;
  /** brings the session's own terminal, editor or app to the front */
  onOpen: (k: string) => void;
  onForget?: () => void;
  onRoom: () => void;
  onSettings: () => void;
  mac: boolean;
}) {
  const { sessions, now, selected } = props;
  const [sec, setSec] = useState<Section>(() => { try { return (localStorage.getItem('dashSection') as Section) || 'home'; } catch { return 'home'; } });
  useEffect(() => { try { localStorage.setItem('dashSection', sec === 'session' ? 'home' : sec); } catch { /* storage unavailable */ } }, [sec]);
  const h = useUsageHistory(30);
  const live = sessions.filter((x) => x.connection !== 'ended' && x.connection !== 'lost');
  const todo = live.filter((x) => userTodo(x, now)).length;
  // picking a session anywhere opens its page
  const pick = (k: string) => { props.onSelect(k); setSec('session'); };
  const canOpen = (s: Snapshot) => IN_TAURI && !s.isDemo;
  const title = sec === 'session' ? selected?.project ?? '세션' : NAV.find((n) => n[0] === sec)?.[1];
  return (
    <div className={`dpage ${props.mac ? 'mac' : ''}`}>
      <aside className="dp-side">
        <div className="dp-brand"><b>Agent Room</b><small>대시보드</small></div>
        <nav>
          {NAV.map(([id, label, icon]) => (
            <button key={id} className={sec === id ? 'on' : ''} onClick={() => setSec(id)}>
              <Icon name={icon} /><span>{label}</span>
              {id === 'home' && todo > 0 && <em className="dp-badge wait">{todo}</em>}
              {id === 'map' && <em className="dp-badge">{live.length}</em>}
            </button>
          ))}
          {selected && (
            <button className={`dp-sess ${sec === 'session' ? 'on' : ''}`} onClick={() => setSec('session')}>
              <AgentMark agent={selected.isDemo ? 'demo' : selected.agent} size={14} /><span>{selected.project ?? '세션'}</span>
            </button>
          )}
        </nav>
        <div className="dp-foot">
          <button onClick={props.onRoom}><Icon name="iso" /><span>방으로 돌아가기</span></button>
          <button onClick={props.onSettings}><Icon name="gear" /><span>설정</span></button>
        </div>
      </aside>
      <main className="dp-main">
        <header className="dp-head">
          <h2>{title}</h2>
          <p>세션 {live.length}개 · 내 차례 {todo}건 · 이벤트가 오는 즉시 갱신</p>
          {sec === 'session' && selected && canOpen(selected) && (
            <button className="btn primary dp-open" onClick={() => props.onOpen(selected.key)}>세션 열기</button>
          )}
        </header>
        <div className="dp-body">
          {sec === 'home' && (
            <>
              <StatCards sessions={sessions} now={now} h={h} />
              <div className="dash-grid">
                <section className="dash-card"><h4 className="dash-h">현황</h4><Overview sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={pick} showLimits={false} /></section>
                <section className="dash-card"><h4 className="dash-h">최근 활동</h4><ActivityLog sessions={sessions} timelines={props.timelines} onSelect={pick} compact /></section>
              </div>
              <section className="dash-card dash-wide"><h4 className="dash-h">세션 <span className="pn-count">{sessions.length}</span></h4><SessionTable sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={pick} /></section>
            </>
          )}
          {sec === 'map' && <AgentMap sessions={sessions} now={now} selected={selected?.key ?? null} onPick={pick} onOpen={props.onOpen} />}
          {sec === 'board' && <TaskBoard sessions={live} now={now} onPick={pick} />}
          {sec === 'activity' && <section className="dash-card"><ActivityLog sessions={sessions} timelines={props.timelines} onSelect={pick} tall /></section>}
          {sec === 'usage' && (
            <>
              <div className="dash-grid">
                <section className="dash-card"><h4 className="dash-h">최근 30일 달력</h4><UsageCalendar h={h} /></section>
                <section className="dash-card"><h4 className="dash-h">에이전트별 비중</h4><UsageShare h={h} /></section>
              </div>
              <section className="dash-card"><div className="pad"><UsageBoard sessions={sessions} now={now} /></div></section>
            </>
          )}
          {sec === 'memory' && <MemoryBrowser />}
          {sec === 'session' && (selected ? (
            <div className="dash-grid">
              <section className="dash-card"><h4 className="dash-h">작업</h4><Tasks s={selected} /><h4 className="dash-h">정보</h4><SessionInfo s={selected} now={now} onForget={props.onForget} /></section>
              <section className="dash-card"><h4 className="dash-h">타임라인</h4><Timeline entries={props.timelines[selected.key] ?? []} /></section>
            </div>
          ) : <p className="muted pad">선택한 세션이 없어요.</p>)}
        </div>
      </main>
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
    <div className="dmap">
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
                      {doingLabel(s) && <div className="dmap-doing">{doingLabel(s)}</div>}
                      <div className="dmap-meta">
                        {userTodo(s, now) && <em className="wait">{userTodo(s, now)!.text}</em>}
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
      {none && <p className="muted small pad">에이전트가 만든 작업 목록(TodoWrite, update_plan 등)이 아직 없어요. 목록이 생기면 여기에 모여요.</p>}
      <div className="dboard">
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
      </div>
      <p className="pn-note pad">작업 목록은 각 에이전트가 직접 만든 것이라 여기서 옮기거나 고칠 수 없어요. 카드를 누르면 그 세션으로 가요.</p>
    </>
  );
}

const dayLabel = (day: number) => { const d = new Date(day * 86_400_000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

/** one square per day, darker for more tokens, laid out by weekday */
function UsageCalendar({ h }: { h: UsageHistory | null }) {
  if (!h) return <p className="pn-note pad">로그에서 사용량을 모으는 중…</p>;
  const max = Math.max(1, ...h.days.map((d) => d.claude + d.codex));
  const lead = (new Date(h.days[0].day * 86_400_000).getUTCDay() + 6) % 7; // Monday first
  const level = (n: number) => (n <= 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)));
  return (
    <div className="dcal pad">
      <div className="dcal-grid">
        {['월', '화', '수', '목', '금', '토', '일'].map((w) => <b key={w}>{w}</b>)}
        {Array.from({ length: lead }, (_, i) => <i key={`e${i}`} className="empty" />)}
        {h.days.map((d) => (
          <i key={d.day} className={`l${level(d.claude + d.codex)}`} title={`${dayLabel(d.day)} · ${fmtTokens(d.claude + d.codex)} 토큰`} />
        ))}
      </div>
      <div className="dcal-legend"><span>적음</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`l${l}`} />)}<span>많음</span></div>
    </div>
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
      <section className="dash-card dmem-list">
        <input type="search" placeholder="파일·내용 검색" value={q} onChange={(e) => { setQ(e.target.value); setPick(0); }} />
        {shown.map((x, i) => (
          <button key={x.path} className={x === f ? 'on' : ''} onClick={() => setPick(i)} title={x.path}>
            <b>{x.label}</b><small>{x.path}</small>
          </button>
        ))}
      </section>
      <section className="dash-card dmem-view">
        {f ? (
          <>
            <h4 className="dash-h">{f.path}{f.truncated && ' (앞부분 200KB만)'}</h4>
            <pre>{f.content}</pre>
            <p className="pn-note pad">읽기 전용이에요. 이 컴퓨터의 파일을 바로 읽어 보여 줄 뿐, 어디에도 보내지 않아요.</p>
          </>
        ) : <p className="muted pad">검색과 맞는 파일이 없어요.</p>}
      </section>
    </div>
  );
}
