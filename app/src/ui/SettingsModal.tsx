import { useCallback, useEffect, useState } from 'react';
import { autostartEnabled, backend, IN_TAURI, setAutostart } from '../bridge';
import { BUILTIN_CRITTERS, CRITTER_COLORS, DEFAULT_CHARACTERS } from '../game/skin';
import type { Sfx, Sound } from '../game/audio';
import type { HookStatus, Settings } from '../types';
import { Icon } from './icons';
import { BACKDROPS, UI_THEMES, backdropOf, uiTheme } from '../themes';

type Tab = 'look' | 'general' | 'characters' | 'agents' | 'dev';

export function SettingsModal(props: {
  initialTab: Tab;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  demoRunning: boolean;
  onToggleDemo: () => void;
  realCount: number;
  characters: string[];
  onCharactersChanged: () => Promise<void>;
  sound: Sound;
  onSoundsChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const { settings: s, onChange } = props;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="설정">
        <header>
          <nav>
            <button className={tab === 'look' ? 'on' : ''} onClick={() => setTab('look')}>꾸미기</button>
            <button className={tab === 'characters' ? 'on' : ''} onClick={() => setTab('characters')}>캐릭터</button>
            <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>알림·소리</button>
            <button className={tab === 'agents' ? 'on' : ''} onClick={() => setTab('agents')}>에이전트 연동</button>
            <button className={tab === 'dev' ? 'on' : ''} onClick={() => setTab('dev')}>고급</button>
          </nav>
          <button className="tool" onClick={props.onClose} aria-label="닫기"><Icon name="close" /></button>
        </header>
        <div className="modal-body">
          {tab === 'look' && (
            <>
              <Field label="색 테마">
                <div className="swatches">
                  {UI_THEMES.map((th) => (
                    <button key={th.id} className={`swatch theme ${(s.uiTheme || 'peach') === th.id ? 'on' : ''}`} title={th.name} aria-label={th.name}
                      style={{ background: `linear-gradient(135deg, ${th.vars['--accent']} 50%, ${th.vars['--frame-l']} 50%)` }} onClick={() => set('uiTheme', th.id)} />
                  ))}
                </div>
              </Field>
              <Field label="방 조명">
                <select value={s.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
                  <option value="auto">실제 시간에 맞춰</option>
                  <option value="day">늘 낮</option>
                  <option value="sunset">늘 노을</option>
                  <option value="night">늘 밤</option>
                </select>
              </Field>
              <Field label="방 바깥 배경">
                <div className="swatches">
                  {[{ id: '', name: '테마 색', bd: uiTheme(s.uiTheme).bd }, ...BACKDROPS].map((b) => (
                    <button key={b.id} className={`swatch ${(s.backdrop || '') === b.id ? 'on' : ''}`} title={b.name} aria-label={b.name}
                      style={{ background: `radial-gradient(circle, ${b.bd[0]} 30%, ${b.bd[1]})` }} onClick={() => set('backdrop', b.id)} />
                  ))}
                  <label className={`swatch pick ${s.backdrop?.startsWith('#') ? 'on' : ''}`} title="직접 고르기"
                    style={{ background: s.backdrop?.startsWith('#') ? `radial-gradient(circle, ${backdropOf(s.backdrop, uiTheme(s.uiTheme)).join(' 30%, ')})` : undefined }}>
                    <input type="color" value={s.backdrop?.startsWith('#') ? s.backdrop : '#cfe3d6'} onChange={(e) => set('backdrop', e.target.value)} aria-label="배경 색 직접 고르기" />
                  </label>
                </div>
              </Field>
              <Field label="글꼴">
                <select value={s.font} onChange={(e) => set('font', e.target.value as Settings['font'])}>
                  <option value="mixed">기본 (제목만 도트)</option>
                  <option value="system">읽기 쉬운 글꼴만</option>
                  <option value="pixel">전부 도트</option>
                </select>
              </Field>
              <Field label="펫 이름표">
                <select value={s.tagStyle} onChange={(e) => set('tagStyle', e.target.value as Settings['tagStyle'])}>
                  <option value="compact">간단히</option>
                  <option value="full">프로젝트 이름까지</option>
                  <option value="off">숨기기</option>
                </select>
              </Field>
              <h4>화면 구성</h4>
              <Toggle label="위쪽 세션 탭" v={s.showTabs} on={(v) => set('showTabs', v)} />
              <Toggle label="남은 사용량 표시 (5시간·주간)" v={s.showLimits} on={(v) => set('showLimits', v)} />
              <Toggle label="아래쪽 상태 카드" v={s.showDock} on={(v) => set('showDock', v)} />
              <Toggle label="다이나믹 아일랜드 (화면 맨 위 상태 표시)" v={s.island} on={(v) => set('island', v)} />
            </>
          )}
          {tab === 'general' && (
            <>
              <Toggle label="효과음" v={s.sfx} on={(v) => set('sfx', v)} />
              <Toggle label="배경 음악 (Lo-fi)" v={s.bgm} on={(v) => set('bgm', v)} />
              <Toggle label="작업 완료·오류 알림" v={s.notifyComplete} on={(v) => set('notifyComplete', v)} />
              <Toggle label="승인·입력 요청 알림" v={s.notifyApproval} on={(v) => set('notifyApproval', v)} />
              <Toggle label="남은 사용량 10% 이하 알림" v={s.notifyLimits} on={(v) => set('notifyLimits', v)} />
              <Toggle label="앱을 보고 있을 땐 알림 생략" v={s.notifyOnlyWhenHidden} on={(v) => set('notifyOnlyWhenHidden', v)} />
              <Toggle label="항상 위에 표시" v={s.alwaysOnTop} on={(v) => set('alwaysOnTop', v)} />
              <AutostartToggle />
              <Sounds sound={props.sound} onChanged={props.onSoundsChanged} />
            </>
          )}
          {tab === 'characters' && <Characters settings={s} onChange={onChange} names={props.characters} onAdded={props.onCharactersChanged} />}
          {tab === 'agents' && <Agents />}
          {tab === 'dev' && <Dev {...props} />}
        </div>
      </div>
    </div>
  );
}

const SOUND_EVENTS: [Sfx, string][] = [['start', '작업 시작'], ['done', '작업 완료'], ['alert', '승인·입력 요청'], ['error', '오류']];

/** pick your own file per effect; stored in ~/.agent-room/sounds, played instead of the built-in tone */
function Sounds({ sound, onChanged }: { sound: Sound; onChanged: () => Promise<void> }) {
  const [mine, setMine] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const refresh = useCallback(async () => setMine((await backend.listSounds().catch(() => [])).map((f) => f.event)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const pick = async (ev: string, f: File | undefined) => {
    if (!f) return;
    try {
      await backend.saveSound(ev, f.name, Array.from(new Uint8Array(await f.arrayBuffer())));
      setNote(null);
    } catch (e) {
      setNote(String(e));
    }
    await onChanged();
    await refresh();
  };
  const reset = async (ev: string) => {
    await backend.removeSound(ev).catch(() => undefined);
    await onChanged();
    await refresh();
  };
  return (
    <>
      <h4>효과음 바꾸기</h4>
      {SOUND_EVENTS.map(([ev, label]) => (
        <div key={ev} className="field">
          <span>{label} <small className="muted">· {mine.includes(ev) ? '내 파일' : '기본음'}</small></span>
          <div className="row tight">
            <button className="btn small" onClick={() => { sound.unlock(); sound.play(ev, true); }}>듣기</button>
            <label className="btn small">
              파일 고르기
              <input type="file" accept=".mp3,.wav,.ogg,.m4a,audio/*" hidden onChange={(e) => { void pick(ev, e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {mine.includes(ev) && <button className="btn small" onClick={() => void reset(ev)}>기본음</button>}
          </div>
        </div>
      ))}
      {note && <p className="small">{note}</p>}
      <p className="muted small">
        2MB 이하 mp3·wav·ogg·m4a 파일을 고르면 그 소리로 바뀌어요. 다른 사이트에서 받은 소리는 그 사이트의 이용 조건을 확인하고 써 주세요. 파일은 이
        컴퓨터의 ~/.agent-room/sounds 폴더에만 저장돼요.
      </p>
    </>
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

const ROLES: [string, string][] = [['claude', 'Claude Code'], ['codex', 'Codex'], ['generic', '연결 없음·데모']];

function Characters({ settings: s, onChange, names, onAdded }: { settings: Settings; onChange: (s: Settings) => void; names: string[]; onAdded: () => Promise<void> }) {
  const [dir, setDir] = useState('~/.agent-room');
  const [note, setNote] = useState<string | null>(null);
  const add = async (files: FileList | null) => {
    const added: string[] = [];
    for (const f of Array.from(files ?? [])) {
      try {
        added.push(await backend.saveCharacter(f.name, Array.from(new Uint8Array(await f.arrayBuffer()))));
      } catch (e) {
        setNote(String(e));
        return;
      }
    }
    await onAdded();
    if (added.length) setNote(`추가했어요: ${added.join(', ')} · 아래 목록에서 고르면 바로 바뀌어요`);
  };
  useEffect(() => {
    backend.dataDir().then(setDir).catch(() => undefined);
  }, []);
  const pick = (agent: string, name: string) => {
    const next = { ...s.characters };
    if (name) next[agent] = name;
    else delete next[agent];
    onChange({ ...s, characters: next });
  };
  return (
    <>
      <div className="char-add">
        <div>
          <b>포켓몬 도트도 넣을 수 있어요</b>
          <p className="muted small">좋아하는 포켓몬 도트 PNG를 추가하면 아래 목록의 "내 캐릭터"에 바로 나타나요. 확대된 이미지도 괜찮아요.</p>
        </div>
        <label className="btn primary">
          PNG 추가
          <input type="file" accept="image/png" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {ROLES.map(([agent, label]) => (
        <Field key={agent} label={label}>
          <select value={s.characters[agent] ?? DEFAULT_CHARACTERS[agent]} onChange={(e) => pick(agent, e.target.value)}>
            {BUILTIN_CRITTERS.map(([id, label]) => (
              <option key={id} value={`builtin/${id}`}>{label}</option>
            ))}
            {names.length > 0 && (
              <optgroup label="내 캐릭터">
                {names.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </optgroup>
            )}
            {s.characters[agent] && !s.characters[agent].startsWith('builtin/') && !names.includes(s.characters[agent]) && <option value={s.characters[agent]} disabled>{s.characters[agent]} (파일 없음)</option>}
          </select>
        </Field>
      ))}
      <h4>펫 색 바꾸기</h4>
      {BUILTIN_CRITTERS.map(([id, label]) => {
        const cur = s.critterColors?.[id];
        const setColor = (c?: string) => {
          const next = { ...(s.critterColors ?? {}) };
          if (c) next[id] = c;
          else delete next[id];
          onChange({ ...s, critterColors: next });
        };
        return (
          <div key={id} className="field">
            <span className="pet-name"><i className="pet-thumb" style={{ backgroundImage: `url(/assets/critters/${id}.png)` }} />{label}</span>
            <div className="swatches">
              <button className={`swatch orig ${!cur ? 'on' : ''}`} onClick={() => setColor()} title="원래 색" aria-label={`${label} 원래 색`} />
              {CRITTER_COLORS.map((c) => (
                <button key={c} className={`swatch ${cur === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`${label} 색 ${c}`} />
              ))}
            </div>
          </div>
        );
      })}
      {note && <p className="small">{note}</p>}
      <p className="muted small">
        추가한 PNG는 <span className="mono">{dir}/characters/</span> 폴더에 저장되고, 이 폴더에 직접 넣어도 돼요. 확대된 도트는 1칸 = 1px
        원래 크기로 줄이고 단색 배경은 투명하게 처리해요. 파일은 이 컴퓨터에만 있고 어디에도 올리지 않아요.
      </p>
    </>
  );
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
        에이전트의 공식 Hook에 작은 전달 프로그램(agent-room-hook)을 등록해요. 이 프로그램은 아무것도 출력하지 않아서 에이전트 대화에
        아무것도 추가되지 않고, 추가 토큰도 쓰지 않아요. 설정을 바꾸기 전에 원본을 백업합니다.
      </p>
      <p className="muted small">
        Claude Code는 남은 사용량을 상태줄(statusLine)에만 알려줘서, 상태줄 명령도 감싸요. 쓰던 상태줄이 있으면 그대로 실행해서 똑같이
        보이고, 연동을 해제하면 원래대로 돌아가요.
      </p>
      {list.map((h) => (
        <div key={h.agent} className="agent-card">
          <div className="row between">
            <b>{NAMES[h.agent]}</b>
            <span className={`tag st-${h.installed}`}>{{ full: '연결됨', partial: '다시 연결 필요', none: '연결 안 됨' }[h.installed]}</span>
          </div>
          <div className="muted small mono">{h.configPath}</div>
          {!h.agentDetected && <div className="muted small">이 컴퓨터에서 {NAMES[h.agent]} 설정 폴더를 찾지 못했어요.</div>}
          {h.notes.map((n) => (
            <div key={n} className="callout wait small">{n}</div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={() => run(() => backend.hooksInstall(h.agent), `${NAMES[h.agent]} 연결했어요. 새로 시작하는 세션부터 표시돼요.`)}>
              {h.installed === 'none' ? '연결하기' : '다시 연결'}
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
        모든 에이전트 설정에서 Agent Room Hook을 지우고 ~/.agent-room/bin 의 전달 프로그램도 삭제해요. 앱을 지우기 전에 실행하세요. 앱 없이도 터미널에서
        <span className="mono"> ~/.agent-room/bin/agent-room-hook --uninstall</span> 로 같은 작업을 할 수 있어요.
      </p>
      <button className="btn danger" onClick={() => backend.hooksRemoveAll().then(() => setMsg('모든 Hook을 제거했어요.'))}>
        모든 Hook 제거
      </button>
      {msg && <div className="callout small">{msg}</div>}
    </div>
  );
}
