// The day summary: counts the app already has (hook events since it started, the agents' local
// token counters), as numbers for the dashboard and as a Markdown report the user can save.
import type { Snapshot, TimelineEntry, UsageHistory } from './types';
import { AGENT_NAME } from './labels';

export interface DaySummary {
  /** local midnight the day starts at */
  from: number;
  sessions: { project: string; agent: string; turns: number; files: string[] }[];
  turns: number;
  testsOk: number;
  testsFail: number;
  asks: number;
  failures: number;
  files: number;
  tokens: { claude: number; codex: number } | null;
}

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function daySummary(sessions: Snapshot[], timelines: Record<string, TimelineEntry[]>, h: UsageHistory | null, now: number): DaySummary {
  const from = startOfDay(now);
  const out: DaySummary = { from, sessions: [], turns: 0, testsOk: 0, testsFail: 0, asks: 0, failures: 0, files: 0, tokens: null };
  for (const s of sessions) {
    if (s.isDemo) continue;
    const today = (timelines[s.key] ?? []).filter((e) => e.at >= from);
    if (!today.length && s.lastEventAt < from) continue;
    const turns = today.filter((e) => e.kind === 'turn_complete').length;
    out.turns += turns;
    out.testsOk += today.filter((e) => e.kind === 'test' && e.ok === true).length;
    out.testsFail += today.filter((e) => e.kind === 'test' && e.ok === false).length;
    out.asks += today.filter((e) => e.kind === 'approval' || e.kind === 'input').length;
    out.failures += today.filter((e) => e.kind === 'turn_failed').length;
    out.files += s.filesEdited.length;
    out.sessions.push({ project: s.project ?? '프로젝트 미확인', agent: AGENT_NAME[s.agent], turns, files: s.filesEdited });
  }
  // the usage history's last day is today in the local time zone
  const last = h?.days[h.days.length - 1];
  if (last) out.tokens = { claude: last.claude, codex: last.codex };
  return out;
}

/** estimated API cost from blended per-million-token prices; null without prices */
export function estCost(tokens: { claude: number; codex: number }, perM: { claude: number; codex: number } | undefined): number | null {
  if (!perM || (!perM.claude && !perM.codex)) return null;
  return (tokens.claude / 1e6) * perM.claude + (tokens.codex / 1e6) * perM.codex;
}

export function fmtUsd(v: number): string {
  return `$${v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString('en-US')}`;
}

const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function dayMarkdown(d: DaySummary, fmtTok: (n: number) => string, cost: number | null): string {
  const lines = [
    `# Agent Room 하루 요약 · ${ymd(d.from)}`,
    '',
    `- 끝낸 요청: ${d.turns}회`,
    `- 테스트: 통과 ${d.testsOk}회, 실패 ${d.testsFail}회`,
    `- 승인·답변 요청: ${d.asks}회`,
    `- 고친 파일: ${d.files}개`,
  ];
  if (d.tokens) lines.push(`- 토큰: Claude Code ${fmtTok(d.tokens.claude)}, Codex ${fmtTok(d.tokens.codex)}`);
  if (cost !== null) lines.push(`- 추정 비용: ${fmtUsd(cost)} (설정한 단가로 계산한 추정치)`);
  lines.push('', '## 세션', '');
  if (!d.sessions.length) lines.push('오늘 활동한 세션이 없어요.', '');
  for (const s of d.sessions) {
    lines.push(`### ${s.project} (${s.agent})`, '', `- 끝낸 요청: ${s.turns}회`);
    if (s.files.length) lines.push(`- 고친 파일: ${s.files.map((f) => `\`${f}\``).join(', ')}`);
    lines.push('');
  }
  lines.push('---', '요청 수와 테스트 결과는 Agent Room이 켜진 뒤 받은 이벤트만 셉니다.', '');
  return lines.join('\n');
}

export function reportName(from: number): string {
  return `agent-room-${ymd(from)}.md`;
}
