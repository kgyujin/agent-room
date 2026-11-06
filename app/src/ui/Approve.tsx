// Allow / deny a Claude Code permission request from Agent Room (opt-in in settings). Shown only
// while the hook is still waiting; after that Claude Code asks in its own dialog.
import { useState } from 'react';
import { backend } from '../bridge';
import type { Snapshot } from '../types';
import { L } from '../i18n';

export function canApprove(s: Snapshot, now: number): boolean {
  return !!s.approveUntil && s.approveUntil > now && !s.isDemo;
}

export function ApproveButtons({ s, now, compact }: { s: Snapshot; now: number; compact?: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canApprove(s, now)) return err ? <small className="appr-err">{err}</small> : null;
  const left = Math.ceil((s.approveUntil! - now) / 1000);
  const answer = (allow: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    backend.answerApproval(s.key, allow).then(() => setErr(null), (x) => setErr(String(x))).finally(() => setBusy(false));
  };
  const what = s.waiting?.tool ? L(`${s.waiting.tool} 실행을`, `running ${s.waiting.tool}`) : L('요청을', 'this request');
  return (
    <span className={`appr ${compact ? 'compact' : ''}`} title={L(`${what} 여기서 허용하거나 거부해요. ${left}초 안에 답하지 않으면 에이전트 창에서 물어봐요`, `Allow or deny ${what} here. With no answer in ${left}s, the agent asks in its own window`)}>
      <button className="btn primary appr-ok" disabled={busy} onClick={answer(true)}>{L('허용', 'Allow')}</button>
      <button className="btn appr-no" disabled={busy} onClick={answer(false)}>{L('거부', 'Deny')}</button>
      {!compact && <small>{L(`${left}초`, `${left}s`)}</small>}
    </span>
  );
}
