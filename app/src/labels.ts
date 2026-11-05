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
