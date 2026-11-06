import type { Activity, AgentKind, Snapshot, TimelineEntry } from './types';

export const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', demo: '데모' };

/** Main status line. Only what the events say; no guessed intent. */
export function stateLabel(s: Snapshot): string {
  if (s.connection === 'stale') return '응답 없음';
  if (s.connection === 'lost') return '연결 끊김';
  if (s.connection === 'ended') return '세션 종료';
  switch (s.state) {
    case 'idle': return '대기 중';
    case 'starting': return '작업 시작';
    case 'planning': return s.activity === 'plan' ? '계획 수립 중' : '작업 분석 중';
    case 'reading': return s.activity === 'search' ? '파일 검색 중' : s.activity === 'web' ? '웹 자료 확인 중' : '파일 확인 중';
    case 'editing': return '코드 작성 중';
    case 'running': return s.activity === 'delegate' ? '하위 작업 실행 중' : '명령어 실행 중';
    case 'testing':
      if (s.tool === null && s.lastTest) return s.lastTest.ok === true ? '테스트 통과' : s.lastTest.ok === false ? '테스트 실패' : '테스트 종료';
      return '테스트 실행 중';
    case 'waiting': return s.waiting?.kind === 'approval' ? '승인 필요' : '답변 기다리는 중';
    case 'completed': return '작업 완료';
    case 'error': return s.error?.fatal ? '오류로 중단됨' : '오류 발생';
    case 'disconnected': return '연결 끊김';
  }
}

/** Short "what it is doing right now" for the tag over a pet, with the file or command when known
 *  ("코드 수정 · Room.tsx", "테스트 중 · npm test"); null while it rests. */
/** a finished turn still shows as "완료" on the pet and the island for `sec` seconds (setting; 0 = until the next turn), then reads as idle */
export const justDone = (s: Snapshot, now: number, sec = 60) => s.state === 'completed' && (!sec || now - (s.turnEndedAt ?? s.lastEventAt) < sec * 1000);

export function doingLabel(s: Snapshot): string | null {
  if (s.connection === 'stale') return '응답 없음';
  if (s.connection !== 'live') return null;
  const what = ((): string | null => {
    switch (s.state) {
      case 'idle': return null;
      case 'starting': return '시작하는 중';
      case 'planning': return s.activity === 'plan' ? '계획 세우는 중' : '생각하는 중';
      case 'reading': return s.activity === 'search' ? '찾아보는 중' : s.activity === 'web' ? '웹 확인 중' : '파일 읽는 중';
      case 'editing': return '코드 수정 중';
      case 'running': return s.activity === 'delegate' ? '하위 작업 중' : '명령 실행 중';
      case 'testing': return s.tool === null && s.lastTest ? (s.lastTest.ok === false ? '테스트 실패' : '테스트 끝') : '테스트 중';
      case 'waiting': return s.waiting?.kind === 'approval' ? '승인 필요' : '답변 기다림';
      case 'completed': return '완료';
      case 'error': return '오류';
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

const ACT: Record<Activity, string> = {
  think: '분석', plan: '계획', search: '검색', read: '읽기', web: '웹', edit: '편집', run: '실행', test: '테스트', delegate: '하위 작업', ask: '질문', other: '도구',
};

export function activityLabel(a: Activity | null): string {
  return a ? ACT[a] : '';
}

export function timelineText(e: TimelineEntry): string {
  const d = e.detail ? ` · ${e.detail}` : '';
  switch (e.kind) {
    case 'session_start': return '세션 시작';
    case 'session_end': return '세션 종료';
    case 'turn_start': return '새 요청 처리 시작';
    case 'tool': return `${activityLabel(e.activity)} — ${e.tool ?? ''}${d}`;
    case 'tool_fail': return `실패 — ${e.tool ?? ''}${d}`;
    case 'test': return `${e.ok === true ? '테스트 통과' : e.ok === false ? '테스트 실패' : '테스트 종료(결과 미제공)'}${d}`;
    case 'approval': return `승인 요청 — ${e.tool ?? '도구'}${d}`;
    case 'input': return `입력 요청${d}`;
    case 'turn_complete': return '작업 완료';
    case 'turn_failed': return `오류로 중단${d}`;
    case 'interrupted': return '사용자가 중단';
    case 'compacting': return '대화 요약 (컴팩트)';
    case 'subagent': return `하위 에이전트 시작${d}`;
    case 'plan': return `작업 목록 갱신${d}`;
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
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.floor(m / 60)}시간 전`;
}

/** "5시간" / "주간" for the usage windows the agents report */
export function windowLabel(minutes: number): string {
  if (minutes === 300) return '5시간';
  if (minutes === 10080) return '주간';
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}일`;
  if (minutes > 0) return `${Math.round(minutes / 60)}시간`;
  return '한도';
}

/** time until a limit resets: "40분 후", "3시간 10분 후", "2일 5시간 후" */
export function fmtUntil(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}분 후`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간${m % 60 ? ` ${m % 60}분` : ''} 후`;
  return `${Math.floor(h / 24)}일${h % 24 ? ` ${h % 24}시간` : ''} 후`;
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
  return toFull < w.resetsAt - at ? `이 속도면 ${fmtUntil(toFull)} 소진` : null;
}

/**
 * Names that tell sessions apart when their folders share a name: "web-app · wt-2" (the parent
 * folder), or the session's short id when they run in the same folder. Others keep the folder name.
 */
export function sessionNames(list: Snapshot[]): Record<string, string> {
  const base = (s: Snapshot) => s.project ?? '프로젝트';
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
