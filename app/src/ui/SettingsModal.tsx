import { useEffect, useState } from 'react';
import { autostartEnabled, backend, IN_TAURI, setAutostart } from '../bridge';
import type { HookStatus, Settings } from '../types';
import { Icon } from './icons';

type Tab = 'general' | 'agents' | 'dev';

export function SettingsModal(props: {
  initialTab: Tab;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  demoRunning: boolean;
  onToggleDemo: () => void;
  realCount: number;
}) {
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const { settings: s, onChange } = props;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="설정">
        <header>
          <nav>
            <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>일반</button>
            <button className={tab === 'agents' ? 'on' : ''} onClick={() => setTab('agents')}>Agent 연동</button>
            <button className={tab === 'dev' ? 'on' : ''} onClick={() => setTab('dev')}>고급</button>
          </nav>
          <button className="tool" onClick={props.onClose} aria-label="닫기"><Icon name="close" /></button>
        </header>
        <div className="modal-body">
          {tab === 'general' && (
            <>
              <Field label="배경 테마">
                <select value={s.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
                  <option value="day">봄날 낮</option>
                  <option value="sunset">노을</option>
                  <option value="night">밤</option>
                  <option value="auto">시간에 맞춰 자동</option>
                </select>
              </Field>
              <Toggle label="효과음" v={s.sfx} on={(v) => set('sfx', v)} />
              <Toggle label="배경 음악 (Lo-fi)" v={s.bgm} on={(v) => set('bgm', v)} />
              <Toggle label="작업 완료·오류 알림" v={s.notifyComplete} on={(v) => set('notifyComplete', v)} />
              <Toggle label="승인·입력 요청 알림" v={s.notifyApproval} on={(v) => set('notifyApproval', v)} />
              <Toggle label="앱을 보고 있을 땐 알림 생략" v={s.notifyOnlyWhenHidden} on={(v) => set('notifyOnlyWhenHidden', v)} />
              <Toggle label="항상 위에 표시" v={s.alwaysOnTop} on={(v) => set('alwaysOnTop', v)} />
              <Toggle label="토큰 사용량 표시 (로컬 로그 기준)" v={s.showTokens} on={(v) => set('showTokens', v)} />
              <AutostartToggle />
            </>
          )}
          {tab === 'agents' && <Agents />}
          {tab === 'dev' && <Dev {...props} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, v, on, disabled }: { label: string; v: boolean; on: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`field toggle ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <input type="checkbox" checked={v} disabled={disabled} onChange={(e) => on(e.target.checked)} />
      <i />
    </label>
  );
}

function AutostartToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    autostartEnabled().then(setOn).catch(() => setOn(false));
  }, []);
  return <Toggle label="로그인 시 자동 실행" v={on} disabled={!IN_TAURI} on={(v) => setAutostart(v).then(setOn).catch(() => undefined)} />;
}

const NAMES = { claude: 'Claude Code', codex: 'OpenAI Codex CLI' };

function Agents() {
  const [list, setList] = useState<HookStatus[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => backend.hooksStatus().then(setList);
  useEffect(() => {
    void refresh();
  }, []);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(String(e));
    }
    void refresh();
  };
  return (
    <div className="agents">
      <p className="muted small">
        Agent의 공식 Hook에 작은 전달 프로그램(agent-room-hook)을 등록해요. 이 프로그램은 아무것도 출력하지 않아서 Agent 대화에
        아무것도 추가되지 않고, 추가 토큰도 쓰지 않아요. 설정을 바꾸기 전에 원본을 백업합니다.
      </p>
      {list.map((h) => (
        <div key={h.agent} className="agent-card">
          <div className="row between">
            <b>{NAMES[h.agent]}</b>
            <span className={`tag st-${h.installed}`}>{{ full: '연결됨', partial: '일부만 설치', none: '미설치' }[h.installed]}</span>
          </div>
          <div className="muted small mono">{h.configPath}</div>
          {!h.agentDetected && <div className="muted small">이 컴퓨터에서 {NAMES[h.agent]} 설정 폴더를 찾지 못했어요.</div>}
          {h.notes.map((n) => (
            <div key={n} className="callout wait small">{n}</div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={() => run(() => backend.hooksInstall(h.agent), `${NAMES[h.agent]} Hook을 설치했어요. 새로 시작하는 세션부터 표시돼요.`)}>
              {h.installed === 'none' ? 'Hook 설치' : '다시 설치'}
            </button>
            {h.installed !== 'none' && (
              <button className="btn" onClick={() => run(() => backend.hooksUninstall(h.agent), `${NAMES[h.agent]} Hook을 제거했어요.`)}>
                제거
              </button>
            )}
          </div>
        </div>
      ))}
      {msg && <div className="callout small">{msg}</div>}
    </div>
  );
}

function Dev(props: { settings: Settings; onChange: (s: Settings) => void; demoRunning: boolean; onToggleDemo: () => void; realCount: number }) {
  const [dir, setDir] = useState('');
  const [hooks, setHooks] = useState<HookStatus[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    backend.dataDir().then(setDir);
    backend.hooksStatus().then(setHooks);
  }, []);
  const s = props.settings;
  return (
    <div>
      <Toggle label="데모 모드 (가상 이벤트 재생)" v={props.demoRunning} on={() => props.onToggleDemo()} disabled={!IN_TAURI} />
      <p className="muted small">데모 세션에는 DEMO 표시가 붙고, 실제 세션과 섞이지 않아요. 실제 연결된 세션 {props.realCount}개.</p>
      <Field label="응답 없음으로 표시할 시간(분)">
        <input type="number" min={1} max={60} value={s.staleMinutes} onChange={(e) => props.onChange({ ...s, staleMinutes: Math.max(1, Number(e.target.value) || 1) })} />
      </Field>
      <h4>데이터</h4>
      <p className="muted small">
        이벤트는 메모리에만 보관하고 디스크에 저장하지 않아요. 프롬프트, 응답, 파일 내용, 명령 출력은 Hook 단계에서 버려집니다. 앱 데이터 폴더: <span className="mono">{dir}</span>
      </p>
      <h4>설정 백업 복원</h4>
      {hooks.map((h) => (
        <div key={h.agent} className="row between small">
          <span>{h.agent === 'claude' ? 'Claude Code' : 'Codex'} · 백업 {h.backups.length}개</span>
          <button
            className="btn"
            disabled={!h.backups.length}
            onClick={() => backend.hooksRestore(h.agent).then((p) => setMsg(`복원했어요: ${p}`)).catch((e) => setMsg(String(e)))}
          >
            가장 최근 백업으로 복원
          </button>
        </div>
      ))}
      <h4>완전 제거</h4>
      <p className="muted small">
        모든 Agent 설정에서 Agent Room Hook을 지우고 ~/.agent-room/bin 의 전달 프로그램도 삭제해요. 앱을 지우기 전에 실행하세요. 앱 없이도 터미널에서
        <span className="mono"> ~/.agent-room/bin/agent-room-hook --uninstall</span> 로 같은 작업을 할 수 있어요.
      </p>
      <button className="btn danger" onClick={() => backend.hooksRemoveAll().then(() => setMsg('모든 Hook을 제거했어요.'))}>
        모든 Hook 제거
      </button>
      {msg && <div className="callout small">{msg}</div>}
    </div>
  );
}
