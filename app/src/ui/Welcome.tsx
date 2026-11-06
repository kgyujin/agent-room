// First run: what the app is, the three steps to see your first critter, and a demo.
// Replaces the plain "no agent" card while no session has connected yet.
import { useEffect, useState } from 'react';
import { backend, IN_TAURI } from '../bridge';
import type { HookStatus, Overview } from '../types';
import { AgentMark, Icon } from './icons';
import { L } from '../i18n';

export function Welcome({ detected, onDemo, onSettings, onClose }: { detected: Overview['detected']; onDemo: () => void; onSettings: () => void; onClose: () => void }) {
  const [hooks, setHooks] = useState<HookStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => backend.hooksStatus().then(setHooks).catch(() => undefined);
  useEffect(() => { void refresh(); }, []);
  const connected = hooks.filter((h) => h.installed === 'full');
  const install = async (agent: string) => {
    setBusy(agent);
    setErr(null);
    try { await backend.hooksInstall(agent); } catch (e) { setErr(String(e)); }
    setBusy(null);
    void refresh();
  };
  const running = detected.claude + detected.codex;
  return (
    <div className="card welcome">
      <button className="tool wl-close" onClick={onClose} aria-label={L('닫기', 'Close')} title={L('닫기', 'Close')}><Icon name="close" /></button>
      <div className="wl-head">
        <b>{L('Agent Room에 오신 걸 환영해요', 'Welcome to Agent Room')}</b>
        <span className="muted">{L('Claude Code·Codex가 일하는 모습을 작은 사무실로 보여줘요. 에이전트 대화에 끼어들지 않고, 추가 토큰도 쓰지 않아요.', 'Shows Claude Code and Codex at work as a tiny office. It never joins the agents\' conversations and uses no extra tokens.')}</span>
      </div>
      <ol className="wl-steps">
        <li className={connected.length ? 'done' : 'now'}>
          <span className="wl-n">1</span>
          <div>
            <b>{L('쓰는 에이전트 연결하기', 'Connect the agents you use')}</b>
            <div className="wl-agents">
              {hooks.map((h) => (
                <div key={h.agent} className="wl-agent">
                  <AgentMark agent={h.agent} size={16} />
                  <span>{h.agent === 'claude' ? 'Claude Code' : 'Codex'}</span>
                  {h.installed === 'full' ? (
                    <span className="wl-ok">{L('연결됨', 'Connected')}</span>
                  ) : (
                    <button className={`btn small ${h.agentDetected ? 'primary' : ''}`} disabled={busy !== null} onClick={() => install(h.agent)}>
                      {busy === h.agent ? L('연결 중…', 'Connecting…') : L('연결하기', 'Connect')}
                    </button>
                  )}
                  {!h.agentDetected && h.installed !== 'full' && <small className="muted">{L('아직 설치되지 않았어요 · 미리 연결해 둘 수 있어요', 'Not installed yet · you can connect it ahead')}</small>}
                </div>
              ))}
            </div>
            {err && <div className="callout bad small">{err}</div>}
          </div>
        </li>
        <li className={connected.length ? 'now' : ''}>
          <span className="wl-n">2</span>
          <div>
            <b>{L('평소처럼 일을 시키기', 'Work as usual')}</b>
            <span className="muted">
              {L('터미널이나 앱에서 Claude Code나 Codex에게 일을 시키면 펫이 책상에 앉아요. 이미 열려 있던 세션은 한 번 다시 시작해 주세요.', 'Give Claude Code or Codex work in a terminal or app and a pet sits at a desk. Restart sessions that were already open once.')}
              {hooks.some((h) => h.agent === 'codex' && h.installed === 'full') && L(' Codex는 처음 한 번 /hooks 에서 승인이 필요해요.', ' Codex needs a one-time approval in /hooks.')}
              {running > 0 && L(` 지금 실행 중인 에이전트 ${running}개가 보여요.`, ` ${running} running agents found.`)}
            </span>
          </div>
        </li>
        <li>
          <span className="wl-n">3</span>
          <div>
            <b>{L('한눈에 보기', 'At a glance')}</b>
            <span className="muted">{L('이름표 색이 ', 'Tag colours: ')}<i className="wl-dot work" />{L('작업 중, ', 'working, ')}<i className="wl-dot wait" />{L('내 차례(승인·답변), ', 'your turn (approve or answer), ')}<i className="wl-dot ok" />{L('완료예요. 오른쪽 현황판과 화면 맨 위 알약에서도 볼 수 있어요.', 'done. The board on the right and the pills at the top show them too.')}</span>
          </div>
        </li>
      </ol>
      <div className="row">
        {IN_TAURI && <button className="btn" onClick={onDemo}>{L('데모로 먼저 보기', 'Try the demo first')}</button>}
        <button className="btn" onClick={onSettings}>{L('연동 자세히', 'Connection details')}</button>
      </div>
    </div>
  );
}
