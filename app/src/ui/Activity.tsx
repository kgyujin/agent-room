// Dashboard pieces modelled on a command-centre layout: headline cards with a trend against the
// previous period, a table of every session, and one activity log across all sessions with
// filter chips and search. Everything comes from hook events and the agents' local usage logs.
import { useMemo, useState } from 'react';
import type { Snapshot, TimelineEntry, UsageHistory } from '../types';
import { fmtAgo, fmtClock, fmtDuration, sessionNames, stateLabel, stateTone, timelineText } from '../labels';
import { AgentMark } from './icons';
import { progressOf } from './Hud';
import { isActive, userTodo } from './Overview';
import { fmtTokens } from './Usage';

/** "+27%" against the previous period; null when there is nothing to compare with */
function trend(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return { text: `${p >= 0 ? '+' : ''}${p}%`, up: p >= 0 };
}

const sum = (d: UsageHistory['days']) => d.reduce((a, x) => a + x.claude + x.codex, 0);

export function StatCards({ sessions, now, h }: { sessions: Snapshot[]; now: number; h: UsageHistory | null }) {
  const live = sessions.filter((x) => x.connection !== 'ended' && x.connection !== 'lost');
  const days = h?.days ?? [];
  const today = days.length ? sum(days.slice(-1)) : 0;
  const yday = days.length > 1 ? sum(days.slice(-2, -1)) : 0;
  const week = sum(days.slice(-7));
  const prevWeek = sum(days.slice(-14, -7));
  const cards: { id: string; label: string; value: string; sub?: string; tr?: ReturnType<typeof trend> }[] = [
    { id: 'todo', label: '내 차례', value: String(live.filter((x) => userTodo(x, now)).length), sub: '승인·답변 기다림' },
    { id: 'work', label: '작업 중', value: String(live.filter((x) => isActive(x) && !userTodo(x, now)).length), sub: `열린 세션 ${live.length}개` },
    { id: 'done', label: '완료한 요청', value: String(sessions.reduce((a, x) => a + x.completedTurns, 0)), sub: `수정한 파일 ${sessions.reduce((a, x) => a + x.filesEdited.length, 0)}개` },
    { id: 'today', label: '오늘 토큰', value: h ? fmtTokens(today) : '—', sub: h ? `어제 ${fmtTokens(yday)}` : '불러오는 중', tr: trend(today, yday) },
    { id: 'week', label: '최근 7일 토큰', value: h ? fmtTokens(week) : '—', sub: h ? `그 전 7일 ${fmtTokens(prevWeek)}` : '불러오는 중', tr: trend(week, prevWeek) },
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
export function SessionTable({ sessions, now, selected, onSelect }: { sessions: Snapshot[]; now: number; selected: string | null; onSelect: (k: string) => void }) {
  if (!sessions.length) return <p className="muted small pad">아직 세션이 없어요.</p>;
  const names = sessionNames(sessions);
  return (
    <table className="dash-table">
      <thead>
        <tr><th>세션</th><th>상태</th><th>진행</th><th className="num">경과</th><th className="num">요청</th><th className="num">파일</th><th className="num">마지막 활동</th></tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const p = progressOf(s);
          return (
            <tr key={s.key} className={`${selected === s.key ? 'on' : ''} tone-row-${stateTone(s)}`} onClick={() => onSelect(s.key)}>
              <td className="who"><AgentMark agent={s.isDemo ? 'demo' : s.agent} size={14} /><b title={s.cwd ?? undefined}>{names[s.key]}</b></td>
              <td><span className={`tone-${stateTone(s)}`}>{stateLabel(s)}</span></td>
              <td>{p ? <span className="dash-prog"><span className="trk"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></span><small>{p.done}/{p.total}</small></span> : <small className="muted">—</small>}</td>
              <td className="num">{fmtDuration(now - s.startedAt)}</td>
              <td className="num">{s.completedTurns}</td>
              <td className="num">{s.filesEdited.length}</td>
              <td className="num">{fmtAgo(now - s.lastEventAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Filter = 'all' | 'bad' | 'todo' | 'edit' | 'test' | 'done';
const FILTERS: [Filter, string, (e: TimelineEntry) => boolean][] = [
  ['all', '전체', () => true],
  ['bad', '오류', (e) => e.ok === false || e.kind === 'tool_fail' || e.kind === 'turn_failed'],
  ['todo', '승인·질문', (e) => e.kind === 'approval' || e.kind === 'input'],
  ['edit', '편집', (e) => e.kind === 'tool' && e.activity === 'edit'],
  ['test', '테스트', (e) => e.kind === 'test'],
  ['done', '완료', (e) => e.kind === 'turn_complete'],
];

/** one log across all sessions, newest first */
export function ActivityLog({ sessions, timelines, onSelect }: { sessions: Snapshot[]; timelines: Record<string, TimelineEntry[]>; onSelect: (k: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const names = sessionNames(sessions);
  const all = useMemo(() => sessions.flatMap((s) => (timelines[s.key] ?? []).map((e) => ({ e, s }))).sort((a, b) => b.e.at - a.e.at), [sessions, timelines]);
  const test = FILTERS.find((f) => f[0] === filter)![2];
  const needle = q.trim().toLowerCase();
  const shown = all.filter(({ e, s }) => test(e) && (!needle || `${timelineText(e)} ${names[s.key] ?? ''}`.toLowerCase().includes(needle))).slice(0, 200);
  return (
    <div className="dash-log">
      <div className="dash-chips">
        {FILTERS.map(([id, label, f]) => (
          <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
            {label}<span>{all.filter(({ e }) => f(e)).length}</span>
          </button>
        ))}
        <input type="search" placeholder="기록 검색" value={q} onChange={(ev) => setQ(ev.target.value)} />
      </div>
      {shown.length ? (
        <ol>
          {shown.map(({ e, s }) => {
            const bad = FILTERS[1][2](e);
            return (
              <li key={`${s.key}-${e.id}`} className={`${bad ? 'bad' : e.ok === true || e.kind === 'turn_complete' ? 'ok' : ''} k-${e.kind}`} onClick={() => onSelect(s.key)}>
                <i />
                <time>{fmtClock(e.at)}</time>
                <span className="tag">{names[s.key]}</span>
                <span className="txt" title={timelineText(e)}>{timelineText(e)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small pad">{all.length ? '조건에 맞는 기록이 없어요.' : '아직 기록된 활동이 없어요. 앱이 실행된 뒤 받은 이벤트만 보여요.'}</p>
      )}
    </div>
  );
}
