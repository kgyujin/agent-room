import type { Activity, AgentKind, Snapshot, TimelineEntry } from './types';
import { isEn, L } from './i18n';

export const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', get demo() { return L('데모', 'Demo'); } };

/** Main status line. Only what the events say; no guessed intent. */
export function stateLabel(s: Snapshot): string {
  if (s.connection === 'stale') return L('응답 없음', 'Not responding');
  if (s.connection === 'lost') return L('연결 끊김', 'Disconnected');
  if (s.connection === 'ended') return L('세션 종료', 'Session ended');
  switch (s.state) {
    case 'idle': return L('대기 중', 'Idle');
    case 'starting': return L('작업 시작', 'Starting');
    case 'planning': return s.activity === 'plan' ? L('계획 수립 중', 'Planning') : L('작업 분석 중', 'Thinking');
    case 'reading': return s.activity === 'search' ? L('파일 검색 중', 'Searching files') : s.activity === 'web' ? L('웹 자료 확인 중', 'Checking the web') : L('파일 확인 중', 'Reading files');
    case 'editing': return L('코드 작성 중', 'Writing code');
    case 'running': return s.activity === 'delegate' ? L('하위 작업 실행 중', 'Running a subtask') : L('명령어 실행 중', 'Running a command');
    case 'testing':
      if (s.tool === null && s.lastTest) return s.lastTest.ok === true ? L('테스트 통과', 'Tests passed') : s.lastTest.ok === false ? L('테스트 실패', 'Tests failed') : L('테스트 종료', 'Tests ended');
      return L('테스트 실행 중', 'Running tests');
    case 'waiting': return s.waiting?.kind === 'approval' ? L('승인 필요', 'Needs approval') : L('답변 기다리는 중', 'Waiting for your answer');
    case 'completed': return L('작업 완료', 'Done');
    case 'error': return s.error?.fatal ? L('오류로 중단됨', 'Stopped by an error') : L('오류 발생', 'Error');
    case 'disconnected': return L('연결 끊김', 'Disconnected');
  }
}

/** Short "what it is doing right now" for the tag over a pet, with the file or command when known
 *  ("코드 수정 · Room.tsx", "테스트 중 · npm test"); null while it rests. */
/** a finished turn still shows as "완료" on the pet and the island for `sec` seconds (setting; 0 = until the next turn), then reads as idle */
export const justDone = (s: Snapshot, now: number, sec = 60) => s.state === 'completed' && (!sec || now - (s.turnEndedAt ?? s.lastEventAt) < sec * 1000);

export function doingLabel(s: Snapshot): string | null {
  if (s.connection === 'stale') return L('응답 없음', 'Not responding');
  if (s.connection !== 'live') return null;
  const what = ((): string | null => {
    switch (s.state) {
      case 'idle': return null;
      case 'starting': return L('시작하는 중', 'Starting');
      case 'planning': return s.activity === 'plan' ? L('계획 세우는 중', 'Planning') : L('생각하는 중', 'Thinking');
      case 'reading': return s.activity === 'search' ? L('찾아보는 중', 'Searching') : s.activity === 'web' ? L('웹 확인 중', 'On the web') : L('파일 읽는 중', 'Reading');
      case 'editing': return L('코드 수정 중', 'Editing');
      case 'running': return s.activity === 'delegate' ? L('하위 작업 중', 'Subtask') : L('명령 실행 중', 'Running');
      case 'testing': return s.tool === null && s.lastTest ? (s.lastTest.ok === false ? L('테스트 실패', 'Tests failed') : L('테스트 끝', 'Tests done')) : L('테스트 중', 'Testing');
      case 'waiting': return s.waiting?.kind === 'approval' ? L('승인 필요', 'Needs approval') : L('답변 기다림', 'Waiting for you');
      case 'completed': return L('완료', 'Done');
      case 'error': return L('오류', 'Error');
      case 'disconnected': return null;
    }
  })();
  if (!what) return null;
  const busy = ['reading', 'editing', 'running', 'testing'].includes(s.state) && s.tool !== null;
  // files show just their name; commands show as they are
  const file = s.state === 'reading' || s.state === 'editing';
  const d = !busy || !s.detail ? '' : file ? s.detail.split(/[\\/]/).pop()!.trim() : s.detail.trim();
  return d ? `${what} · ${d.length > 18 ? d.slice(0, 17) + '…' : d}` : what;
}

export function stateTone(s: Snapshot): 'work' | 'wait' | 'ok' | 'bad' | 'calm' | 'muted' {
  if (s.connection !== 'live') return 'muted';
  switch (s.state) {
    case 'waiting': return 'wait';
    case 'error': return 'bad';
    case 'completed': return 'ok';
    case 'idle': return 'calm';
    case 'disconnected': return 'muted';
    case 'testing': return s.lastTest?.ok === false ? 'bad' : 'work';
    default: return 'work';
  }
}

const ACT = (): Record<Activity, string> => ({
  think: L('분석', 'Think'), plan: L('계획', 'Plan'), search: L('검색', 'Search'), read: L('읽기', 'Read'), web: L('웹', 'Web'), edit: L('편집', 'Edit'), run: L('실행', 'Run'), test: L('테스트', 'Test'), delegate: L('하위 작업', 'Subtask'), ask: L('질문', 'Ask'), other: L('도구', 'Tool'),
});

export function activityLabel(a: Activity | null): string {
  return a ? ACT()[a] : '';
}

export function timelineText(e: TimelineEntry): string {
  const d = e.detail ? ` · ${e.detail}` : '';
  switch (e.kind) {
    case 'session_start': return L('세션 시작', 'Session started');
    case 'session_end': return L('세션 종료', 'Session ended');
    case 'turn_start': return L('새 요청 처리 시작', 'New request');
    case 'tool': return `${activityLabel(e.activity)} — ${e.tool ?? ''}${d}`;
    case 'tool_fail': return `${L('실패', 'Failed')} — ${e.tool ?? ''}${d}`;
    case 'test': return `${e.ok === true ? L('테스트 통과', 'Tests passed') : e.ok === false ? L('테스트 실패', 'Tests failed') : L('테스트 종료(결과 미제공)', 'Tests ended (no result)')}${d}`;
    case 'approval': return `${L('승인 요청', 'Approval asked')} — ${e.tool ?? L('도구', 'tool')}${d}`;
    case 'input': return `${L('입력 요청', 'Input asked')}${d}`;
    case 'turn_complete': return L('작업 완료', 'Done');
    case 'turn_failed': return `${L('오류로 중단', 'Stopped by an error')}${d}`;
    case 'interrupted': return L('사용자가 중단', 'Stopped by you');
    case 'compacting': return L('대화 요약 (컴팩트)', 'Compacting the conversation');
    case 'subagent': return `${L('하위 에이전트 시작', 'Subagent started')}${d}`;
    case 'plan': return `${L('작업 목록 갱신', 'Task list updated')}${d}`;
    default: return e.kind;
  }
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(isEn() ? 'en-GB' : 'ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return L('방금', 'just now');
  if (s < 60) return L(`${s}초 전`, `${s}s ago`);
  const m = Math.floor(s / 60);
  if (m < 60) return L(`${m}분 전`, `${m}m ago`);
  return L(`${Math.floor(m / 60)}시간 전`, `${Math.floor(m / 60)}h ago`);
}

/** "5시간" / "주간" for the usage windows the agents report */
export function windowLabel(minutes: number): string {
  if (minutes === 300) return L('5시간', '5-hour');
  if (minutes === 10080) return L('주간', 'Weekly');
  if (minutes >= 1440) return L(`${Math.round(minutes / 1440)}일`, `${Math.round(minutes / 1440)}-day`);
  if (minutes > 0) return L(`${Math.round(minutes / 60)}시간`, `${Math.round(minutes / 60)}-hour`);
  return L('한도', 'Limit');
}

/** time until a limit resets: "40분 후", "3시간 10분 후", "2일 5시간 후" */
export function fmtUntil(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return L(`${m}분 후`, `in ${m}m`);
  const h = Math.floor(m / 60);
  if (h < 24) return L(`${h}시간${m % 60 ? ` ${m % 60}분` : ''} 후`, `in ${h}h${m % 60 ? ` ${m % 60}m` : ''}`);
  return L(`${Math.floor(h / 24)}일${h % 24 ? ` ${h % 24}시간` : ''} 후`, `in ${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ''}`);
}

/**
 * "이 속도면 40분 후 소진" when the use so far in a window, kept at the same rate, runs out before the
 * window resets. Nothing in a window's first tenth (too early to tell) or when it lasts. `at` is when
 * the numbers were reported.
 */
export function paceNote(w: { minutes: number; usedPct: number; resetsAt: number | null }, at: number): string | null {
  if (!w.resetsAt || w.minutes <= 0 || w.usedPct <= 0 || w.usedPct >= 100) return null;
  const span = w.minutes * 60_000;
  const elapsed = at - (w.resetsAt - span);
  if (elapsed < span * 0.1) return null;
  const toFull = ((100 - w.usedPct) * elapsed) / w.usedPct;
  return toFull < w.resetsAt - at ? L(`이 속도면 ${fmtUntil(toFull)} 소진`, `runs out ${fmtUntil(toFull)} at this pace`) : null;
}

/**
 * Names that tell sessions apart when their folders share a name: "web-app · wt-2" (the parent
 * folder), or the session's short id when they run in the same folder. Others keep the folder name.
 */
export function sessionNames(list: Snapshot[]): Record<string, string> {
  const base = (s: Snapshot) => s.project ?? L('프로젝트', 'project');
  const parent = (s: Snapshot) => (s.cwd ?? '').split('/').filter(Boolean).slice(-2, -1)[0] ?? null;
  const out: Record<string, string> = {};
  for (const s of list) {
    const twins = list.filter((o) => base(o) === base(s));
    if (twins.length < 2) { out[s.key] = base(s); continue; }
    const p = parent(s);
    const own = p !== null && twins.filter((o) => parent(o) === p).length === 1;
    if (own) { out[s.key] = `${base(s)} · ${p}`; continue; }
    // ids can share a prefix (time-ordered ids do), so take the shortest tail no twin shares
    const id = (o: Snapshot) => o.key.split(':').pop()!;
    let n = 4;
    while (n < id(s).length && twins.some((o) => o !== s && id(o).slice(-n) === id(s).slice(-n))) n++;
    out[s.key] = `${base(s)} · ${id(s).slice(-n)}`;
  }
  return out;
}

/** cut a name to `max` characters, keeping its start and its last three ("agent-room-api" → "agen…api"),
 *  so names that share a prefix stay apart */
export function shortName(n: string, max: number): string {
  const ch = [...n];
  if (ch.length <= max) return n;
  const head = Math.max(2, max - 4);
  return ch.slice(0, head).join('') + '…' + ch.slice(-3).join('');
}

let tokenUnit: 'si' | 'ko' = 'si';
/** set once per window from the settings; fmtTokens reads it */
export function setTokenUnit(u: 'si' | 'ko' | undefined) { tokenUnit = u ?? 'si'; }

/** 'si': 5.2B, 340M, 12.4K, 980 · 'ko': 52억, 3.4억, 1.24만, 9,800 */
export function fmtTokens(n: number): string {
  const f = (v: number, u: string) => `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '')}${u}`;
  if (tokenUnit === 'ko') {
    if (n >= 1e8) return f(n / 1e8, '억');
    if (n >= 1e4) return f(n / 1e4, '만');
    return n.toLocaleString('en-US');
  }
  if (n >= 1e9) return f(n / 1e9, 'B');
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e3) return f(n / 1e3, 'K');
  return String(n);
}

export const ORIGIN_LABEL: Record<'desktop' | 'remote' | 'project', string> = {
  get desktop() { return L('데스크톱 앱', 'Desktop app'); },
  get remote() { return L('원격 제어', 'Remote Control'); },
  get project() { return L('프로젝트 스레드', 'Project thread'); },
};
