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
    case 'waiting': return s.waiting?.kind === 'approval' ? '승인 필요' : '사용자 입력 대기';
    case 'completed': return '작업 완료';
    case 'error': return s.error?.fatal ? '오류로 중단됨' : '오류 발생';
    case 'disconnected': return '연결 끊김';
  }
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
    case 'compacting': return '대화 정리(컴팩트)';
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

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
