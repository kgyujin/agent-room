import { useCallback, useEffect, useMemo, useState } from 'react';
import { appVersion, autostartEnabled, backend, IN_TAURI, setAutostart, ZOOMS } from '../bridge';
import { BUILTIN_CRITTERS, CRITTER_COLORS, DEFAULT_POOL } from '../game/skin';
import type { Sfx, Sound } from '../game/audio';
import type { CharacterFile, HookStatus, Settings } from '../types';
import { Icon, type IconName } from './icons';
import { DASH_CARDS } from './DashboardPage';
import { BACKDROPS, UI_THEMES, backdropOf, uiTheme } from '../themes';

/** settings panes, in the order they appear in the sidebar */
const PANES = [
  { id: 'general', label: '일반', icon: 'cog' },
  { id: 'agents', label: '에이전트', icon: 'link' },
  { id: 'notify', label: '알림', icon: 'bell' },
  { id: 'sound', label: '소리', icon: 'sound' },
  { id: 'pets', label: '펫', icon: 'paw' },
  { id: 'look', label: '메인 창', icon: 'panel' },
  { id: 'bar', label: '메뉴바', icon: 'menubar' },
  { id: 'island', label: '다이나믹 아일랜드', icon: 'island' },
  { id: 'dev', label: '고급', icon: 'gear' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
export type SettingsPane = (typeof PANES)[number]['id'];

/** the pane opened last, so the window comes back where the user left it */
function lastPane(): SettingsPane {
  try {
    const v = localStorage.getItem('settingsPane');
    if (PANES.some((p) => p.id === v)) return v as SettingsPane;
  } catch { /* storage unavailable */ }
  return 'general';
}

export function SettingsModal(props: {
  /** a pane to open on (e.g. 'agents' from the first-run hint); otherwise the last one */
  initialTab?: SettingsPane | null;
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
  onCheckUpdate: () => void;
}) {
  const [tab, setTabState] = useState<SettingsPane>(props.initialTab ?? lastPane());
  const setTab = (t: SettingsPane) => {
    setTabState(t);
    try { localStorage.setItem('settingsPane', t); } catch { /* storage unavailable */ }
  };
  const [version, setVersion] = useState('');
  useEffect(() => { void appVersion().then(setVersion); }, []);
  const { settings: s, onChange } = props;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const pane = PANES.find((p) => p.id === tab)!;
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal card settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="설정">
        <aside className="set-side">
          <b className="set-title">설정</b>
          <nav aria-label="설정 영역">
            {PANES.map((p) => (
              <button key={p.id} className={tab === p.id ? 'on' : ''} onClick={() => setTab(p.id)} aria-current={tab === p.id ? 'page' : undefined}>
                <Icon name={p.icon} size={14} />{p.label}
              </button>
            ))}
          </nav>
          <small className="set-ver">Agent Room {version}</small>
        </aside>
        <section className="set-main">
          <header>
            <h3>{pane.label}</h3>
            <button className="tool" onClick={props.onClose} aria-label="닫기"><Icon name="close" /></button>
          </header>
          <div className="modal-body">
            {tab === 'general' && (
              <>
                <Group title="시작">
                  <AutostartToggle />
                </Group>
                <Group title="모양">
                  <Field label="색 테마">
                    <div className="swatches">
                      {UI_THEMES.map((th) => (
                        <button key={th.id} className={`swatch theme ${(s.uiTheme || 'peach') === th.id ? 'on' : ''}`} title={th.name} aria-label={th.name}
                          style={{ background: `linear-gradient(135deg, ${th.vars['--accent']} 50%, ${th.vars['--frame-l']} 50%)` }} onClick={() => set('uiTheme', th.id)} />
                      ))}
                    </div>
                  </Field>
                  <Field label="글꼴">
                    <select value={s.font} onChange={(e) => set('font', e.target.value as Settings['font'])}>
                      <option value="mixed">기본 (제목만 도트)</option>
                      <option value="system">읽기 쉬운 글꼴만</option>
                      <option value="pixel">전부 도트</option>
                    </select>
                  </Field>
                  <Field label="화면 크기" hint="⌘+ ⌘− ⌘0">
                    <select value={s.uiZoom ?? 1} onChange={(e) => set('uiZoom', Number(e.target.value))} disabled={!IN_TAURI}>
                      {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%{z === 1 ? ' (기본)' : ''}</option>)}
                    </select>
                  </Field>
                </Group>
                <Group title="사용량">
                  <Toggle label="남은 사용량 보이기" hint="5시간·주간 한도를 메인 창, 메뉴바, 아일랜드에 보여 줘요" v={s.showLimits} on={(v) => set('showLimits', v)} />
                  {s.showLimits && <Toggle label="Claude 계정에서 받아오기" hint="데스크톱 앱·VS Code 세션의 한도도 보여요. 키체인의 Claude Code 로그인으로 Anthropic에만 묻고, 저장하지 않아요" sub v={s.claudeAccountLimits ?? true} on={(v) => set('claudeAccountLimits', v)} />}
                  <Field label="토큰 단위" hint="토큰 수를 어떻게 줄여 쓸지 골라요">
                    <select value={s.tokenUnit ?? 'si'} onChange={(e) => set('tokenUnit', e.target.value as 'si' | 'ko')}>
                      <option value="si">12.4K · 340M</option>
                      <option value="ko">1.24만 · 3.4억</option>
                    </select>
                  </Field>
                </Group>
                <Group title="업데이트">
                  <div className="field">
                    <span>지금 버전 <b className="ver">{version || '—'}</b></span>
                    <button className="btn" onClick={props.onCheckUpdate} disabled={!IN_TAURI}>업데이트 확인</button>
                  </div>
                  <Toggle label="새 버전 자동 확인" hint="실행할 때와 6시간마다 확인하고, 설치 전에 물어봐요" v={s.autoUpdateCheck ?? true} on={(v) => set('autoUpdateCheck', v)} />
                </Group>
              </>
            )}
            {tab === 'agents' && (
              <>
                <Agents />
                <Group title="상태 판단">
                  <Field label="응답 없음으로 볼 시간" hint="이 시간 동안 소식이 없으면 '응답 없음'으로 표시해요">
                    <select value={s.staleMinutes} onChange={(e) => set('staleMinutes', Number(e.target.value))}>
                      {[...new Set([1, 3, 5, 10, 30, s.staleMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m}분{m === 3 ? ' (기본)' : ''}</option>)}
                    </select>
                  </Field>
                  <Field label="'완료' 표시 유지">
                    <select value={s.doneShownSec ?? 60} onChange={(e) => set('doneShownSec', Number(e.target.value))}>
                      <option value={30}>30초</option>
                      <option value={60}>1분</option>
                      <option value={300}>5분</option>
                      <option value={0}>다음 작업까지</option>
                    </select>
                  </Field>
                </Group>
              </>
            )}
            {tab === 'notify' && (
              <Group>
                <Toggle label="승인·입력 요청" hint="에이전트가 내 답을 기다릴 때" v={s.notifyApproval} on={(v) => set('notifyApproval', v)} />
                <Toggle label="작업 완료·오류" v={s.notifyComplete} on={(v) => set('notifyComplete', v)} />
                {s.notifyComplete && (
                  <Field label="완료 알림을 받을 작업" sub>
                    <select value={s.notifyMinTurnSec ?? 0} onChange={(e) => set('notifyMinTurnSec', Number(e.target.value))}>
                      <option value={0}>모든 작업</option>
                      <option value={60}>1분 이상 걸린 작업</option>
                      <option value={300}>5분 이상 걸린 작업</option>
                      <option value={900}>15분 이상 걸린 작업</option>
                    </select>
                  </Field>
                )}
                <Toggle label="남은 사용량 10% 이하" v={s.notifyLimits} on={(v) => set('notifyLimits', v)} />
                <Toggle label="앱을 보고 있을 땐 알리지 않기" v={s.notifyOnlyWhenHidden} on={(v) => set('notifyOnlyWhenHidden', v)} />
              </Group>
            )}
            {tab === 'sound' && (
              <>
                <Group>
                  <Toggle label="효과음" v={s.sfx} on={(v) => set('sfx', v)} />
                  <Toggle label="배경 음악 (Lo-fi)" v={s.bgm} on={(v) => set('bgm', v)} />
                </Group>
                <Sounds sound={props.sound} onChanged={props.onSoundsChanged} />
              </>
            )}
            {tab === 'pets' && <Pets settings={s} onChange={onChange} names={props.characters} onAdded={props.onCharactersChanged} />}
            {tab === 'look' && (
              <>
                <Group title="창">
                  <Toggle label="항상 위에 표시" v={s.alwaysOnTop} on={(v) => set('alwaysOnTop', v)} />
                  <Toggle label="룸만 띄울 때 항상 위에 표시" v={s.alwaysOnTopRoom} on={(v) => set('alwaysOnTopRoom', v)} />
                </Group>
                <Group title="방">
                  <Field label="시점">
                    <select value={s.roomView ?? 'iso'} onChange={(e) => set('roomView', e.target.value as Settings['roomView'])}>
                      <option value="iso">대각선</option>
                      <option value="top">탑다운</option>
                    </select>
                  </Field>
                  <Field label="조명">
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
                </Group>
                <Group title="이름표">
                  <Field label="펫 이름표">
                    <select value={s.tagStyle} onChange={(e) => set('tagStyle', e.target.value as Settings['tagStyle'])}>
                      <option value="compact">프로젝트 이름만</option>
                      <option value="full">프로젝트와 하는 일</option>
                      <option value="off">숨기기</option>
                    </select>
                  </Field>
                  {s.tagStyle !== 'off' && (
                    <Field label="쉬는 펫의 이름표" sub>
                      <select value={s.idleTags ?? 'dim'} onChange={(e) => set('idleTags', e.target.value as Settings['idleTags'])}>
                        <option value="dim">흐리게</option>
                        <option value="hide">숨기기</option>
                        <option value="show">그대로</option>
                      </select>
                    </Field>
                  )}
                </Group>
                <Group title="대시보드 카드">
                  {DASH_CARDS.map(([id, label]) => (
                    <Toggle key={id} label={label} v={!(s.dashHidden ?? []).includes(id)} on={(v) => set('dashHidden', v ? (s.dashHidden ?? []).filter((x) => x !== id) : [...(s.dashHidden ?? []), id])} />
                  ))}
                </Group>
                <Group title="보일 요소">
                  <Toggle label="아래쪽 상태 카드" hint="펫을 고르면 나와요" v={s.showDock} on={(v) => set('showDock', v)} />
                  <Toggle label="위쪽 세션 탭" v={s.showTabs} on={(v) => set('showTabs', v)} />
                </Group>
              </>
            )}
            {tab === 'bar' && (
              <Group title="메뉴바 아이콘">
                <Field label="아이콘 펫" hint="일할 땐 걷고, 내 차례면 느낌표를 띄워요">
                  <select value={props.characters.includes(s.trayPet) || s.trayPet?.startsWith('builtin/') ? s.trayPet : 'builtin/shiba'} onChange={(e) => set('trayPet', e.target.value)}>
                    {BUILTIN_CRITTERS.map(([id, label]) => <option key={id} value={`builtin/${id}`}>{label}</option>)}
                    {props.characters.map((n) => <option key={n} value={n}>{n} (내 PNG)</option>)}
                  </select>
                </Field>
                <p className="muted small">펫 탭에서 바꾼 색과 추가한 PNG도 그대로 쓸 수 있어요. 아이콘을 누르면 현황과 사용량을 볼 수 있어요.</p>
              </Group>
            )}
            {tab === 'island' && (
              <Group title="다이나믹 아일랜드">
                <Toggle label="화면 맨 위에 상태 표시" v={s.island} on={(v) => set('island', v)} />
                {s.island && (
                  <>
                    <Field label="펼치기" sub>
                      <select value={s.islandOpen ?? 'hover'} onChange={(e) => set('islandOpen', e.target.value as Settings['islandOpen'])}>
                        <option value="hover">마우스를 올리면</option>
                        <option value="click">클릭할 때만</option>
                      </select>
                    </Field>
                    <Field label="표시할 화면" sub>
                      <select value={s.islandScreen ?? 'auto'} onChange={(e) => set('islandScreen', e.target.value as Settings['islandScreen'])}>
                        <option value="auto">노치 있는 화면 (없으면 메뉴 막대 화면)</option>
                        <option value="main">메뉴 막대가 있는 화면</option>
                        <option value="pointer">마우스가 있는 화면</option>
                      </select>
                    </Field>
                    <Toggle label="일이 없을 땐 숨기기" sub v={s.islandHideIdle ?? false} on={(v) => set('islandHideIdle', v)} />
                    {s.showLimits && <Toggle label="접혔을 때 남은 사용량" sub v={s.islandUsage ?? true} on={(v) => set('islandUsage', v)} />}
                  </>
                )}
              </Group>
            )}
            {tab === 'dev' && <Dev {...props} />}
          </div>
        </section>
      </div>
    </div>
  );
}

/** a titled block of settings rows */
function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="set-group">
      {title && <h4>{title}</h4>}
      <div className="set-rows">{children}</div>
    </section>
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
    <Group title="효과음 바꾸기">
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
    </Group>
  );
}

function Field({ label, hint, sub, children }: { label: string; hint?: string; sub?: boolean; children: React.ReactNode }) {
  return (
    <label className={`field ${sub ? 'sub' : ''}`}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      {children}
    </label>
  );
}

function Toggle({ label, hint, sub, v, on, disabled }: { label: string; hint?: string; sub?: boolean; v: boolean; on: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`field toggle ${sub ? 'sub' : ''} ${disabled ? 'disabled' : ''}`}>
      <span>{label}{hint && <small>{hint}</small>}</span>
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

/**
 * Which pets may appear. New sessions get a random checked pet nobody in the room has yet;
 * only when every checked pet is already in the room does one appear twice.
 */
function Pets({ settings: s, onChange, names, onAdded }: { settings: Settings; onChange: (s: Settings) => void; names: string[]; onAdded: () => Promise<void> }) {
  const [dir, setDir] = useState('~/.agent-room');
  const [note, setNote] = useState<string | null>(null);
  const [files, setFiles] = useState<CharacterFile[]>([]);
  useEffect(() => { backend.listCharacters().then(setFiles).catch(() => undefined); }, []);
  useEffect(() => { backend.dataDir().then(setDir).catch(() => undefined); }, []);
  const pool = s.petPool?.length ? s.petPool : DEFAULT_POOL;
  const setPool = (next: string[]) => onChange({ ...s, petPool: next });
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...pool, id] : pool.filter((x) => x !== id);
    if (!next.length) return setNote('펫을 하나 이상 골라 주세요.');
    setNote(null);
    setPool(next);
  };
  // after any change on disk: this list and the pets in the room both reload
  const refresh = async () => {
    setFiles(await backend.listCharacters().catch(() => []));
    await onAdded();
  };
  const run = async (job: () => Promise<void>) => {
    try {
      await job();
      setNote(null);
    } catch (e) {
      setNote(String(e));
    }
    await refresh();
  };
  const add = async (list: FileList | null) => {
    const added: string[] = [];
    for (const f of Array.from(list ?? [])) {
      try {
        added.push(await backend.saveCharacter(f.name, Array.from(new Uint8Array(await f.arrayBuffer()))));
      } catch (e) {
        setNote(String(e));
        return;
      }
    }
    await refresh();
    if (added.length) {
      setPool([...new Set([...pool, ...added])]);
      setNote(`추가하고 체크했어요: ${added.join(', ')}`);
    }
  };
  // a renamed or deleted file is renamed or dropped in the list too
  const repoint = (from: string, to: string | null) =>
    onChange({ ...s, petPool: pool.flatMap((x) => (x === from ? (to ? [to] : []) : [x])), trayPet: s.trayPet === from ? to ?? 'builtin/shiba' : s.trayPet });
  const checkedCount = pool.filter((x) => x.startsWith('builtin/') || names.includes(x)).length;
  return (
    <>
      <Group title={`쓸 펫 고르기 · ${checkedCount}마리`}>
        <p className="muted small set-lead">체크한 펫 중에서 방에 없는 펫이 무작위로 나와요. 체크한 펫이 모두 방에 있을 때만 같은 펫이 또 나와요.</p>
        <div className="pet-grid">
          {BUILTIN_CRITTERS.map(([id, label]) => {
            const key = `builtin/${id}`;
            const cur = s.critterColors?.[id];
            const setColor = (c?: string) => {
              const next = { ...(s.critterColors ?? {}) };
              if (c) next[id] = c;
              else delete next[id];
              onChange({ ...s, critterColors: next });
            };
            return (
              <div key={id} className={`pet-card ${pool.includes(key) ? 'on' : ''}`}>
                <label className="pet-pick">
                  <input type="checkbox" checked={pool.includes(key)} onChange={(e) => toggle(key, e.target.checked)} />
                  <i className="pet-thumb" style={{ backgroundImage: `url(/assets/critters/${id}.png)` }} />
                  <b>{label}</b>
                </label>
                <div className="swatches mini" aria-label={`${label} 색`}>
                  <button className={`swatch orig ${!cur ? 'on' : ''}`} onClick={() => setColor()} title="원래 색" aria-label={`${label} 원래 색`} />
                  {CRITTER_COLORS.map((c) => (
                    <button key={c} className={`swatch ${cur === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`${label} 색 ${c}`} />
                  ))}
                </div>
              </div>
            );
          })}
          {files.map((f) => (
            <MyCharacter
              key={f.name}
              file={f}
              checked={pool.includes(f.name)}
              onCheck={(on) => toggle(f.name, on)}
              onRename={(to) => run(async () => { const saved = await backend.renameCharacter(f.name, to); if (saved !== f.name) repoint(f.name, saved); })}
              onReplace={(bytes) => run(() => backend.replaceCharacter(f.name, bytes))}
              onRemove={() => run(async () => { await backend.removeCharacter(f.name); repoint(f.name, null); })}
            />
          ))}
          <label className="pet-card add">
            <input type="file" accept="image/png" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
            <b>+ PNG 추가</b>
            <small>좋아하는 도트 캐릭터</small>
          </label>
        </div>
        {note && <p className="small set-note">{note}</p>}
      </Group>
      <Group title="움직임">
        <Field label="일이 없을 때 활동량">
          <select value={s.petEnergy ?? 'normal'} onChange={(e) => set('petEnergy', e.target.value as Settings['petEnergy'])}>
            <option value="calm">차분하게 (주로 쉬고 가끔 낮잠)</option>
            <option value="normal">보통 (쉬다가 돌아다니기)</option>
            <option value="lively">활발하게 (자주 돌아다니고 춤추기)</option>
          </select>
        </Field>
        <Toggle label="머리 위 상태 아이콘" hint="! ? ✓ 같은 표시" v={s.petBubbles ?? true} on={(v) => set('petBubbles', v)} />
      </Group>
      <p className="muted small">
        추가한 PNG는 <span className="mono">{dir}/characters/</span> 폴더에 저장되고, 이 폴더에 직접 넣어도 돼요. 확대된 도트는 1칸 = 1px 원래 크기로
        줄이고 단색 배경은 투명하게 처리해요. 파일은 이 컴퓨터에만 있고 어디에도 올리지 않아요.
      </p>
    </>
  );

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    onChange({ ...s, [k]: v });
  }
}

/** one added character: check to use it, picture, name, and buttons to rename, swap its file or delete it */
function MyCharacter({ file, checked, onCheck, onRename, onReplace, onRemove }: { file: CharacterFile; checked: boolean; onCheck: (on: boolean) => void; onRename: (to: string) => void; onReplace: (bytes: number[]) => void; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: 'image/png' })), [file.bytes]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [draft, setDraft] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const save = () => {
    if (draft !== null && draft.trim() && draft.trim() !== file.name) onRename(draft.trim());
    setDraft(null);
  };
  return (
    <div className={`pet-card mine ${checked ? 'on' : ''}`}>
      <label className="pet-pick">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
        <img className="pet-thumb" src={url} alt="" />
        {draft === null ? (
          <b title={file.name}>{file.name}</b>
        ) : (
          <input autoFocus value={draft} maxLength={40} aria-label="새 이름" onChange={(e) => setDraft(e.target.value)} onBlur={save}
            onClick={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); } }} />
        )}
      </label>
      <span className="pet-actions">
        <button className="link" onClick={() => setDraft(file.name)}>이름</button>
        <label className="link">
          파일 바꾸기
          <input type="file" accept="image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.arrayBuffer().then((b) => onReplace(Array.from(new Uint8Array(b)))); }} />
        </label>
        <button className={`link ${sure ? 'danger' : ''}`} onClick={() => (sure ? onRemove() : (setSure(true), window.setTimeout(() => setSure(false), 3000)))}>{sure ? '정말 삭제' : '삭제'}</button>
      </span>
    </div>
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
    <>
      <Group title="연결">
        {list.map((h) => (
          <div key={h.agent} className="agent-item">
            <div className="field">
              <span>
                {NAMES[h.agent]}
                <small className="mono">{h.configPath}</small>
                {!h.agentDetected && <small>이 컴퓨터에서 설정 폴더를 찾지 못했어요.</small>}
              </span>
              <span className="agent-act">
                <span className={`tag st-${h.installed}`}>{{ full: '연결됨', partial: '다시 연결 필요', none: '연결 안 됨' }[h.installed]}</span>
                {h.installed !== 'none' && (
                  <button className="btn" onClick={() => run(() => backend.hooksUninstall(h.agent), `${NAMES[h.agent]} Hook을 제거했어요.`)}>
                    제거
                  </button>
                )}
                <button className={`btn ${h.installed === 'full' ? '' : 'primary'}`} onClick={() => run(() => backend.hooksInstall(h.agent), `${NAMES[h.agent]} 연결했어요. 새로 시작하는 세션부터 표시돼요.`)}>
                  {h.installed === 'none' ? '연결하기' : '다시 연결'}
                </button>
              </span>
            </div>
            {h.notes.map((n) => (
              <div key={n} className="callout wait small">{n}</div>
            ))}
          </div>
        ))}
      </Group>
      {msg && <div className="callout small">{msg}</div>}
      <p className="muted small">
        에이전트의 공식 Hook에 작은 전달 프로그램(agent-room-hook)을 등록해요. 이 프로그램은 아무것도 출력하지 않아서 에이전트 대화에
        아무것도 추가되지 않고, 추가 토큰도 쓰지 않아요. 설정을 바꾸기 전에 원본을 백업합니다.
      </p>
      <p className="muted small">
        Claude Code는 남은 사용량을 상태줄(statusLine)에만 알려줘서, 상태줄 명령도 감싸요. 쓰던 상태줄이 있으면 그대로 실행해서 똑같이
        보이고, 연동을 해제하면 원래대로 돌아가요.
      </p>
    </>
  );
}

function Dev(props: { demoRunning: boolean; onToggleDemo: () => void; realCount: number }) {
  const [dir, setDir] = useState('');
  const [hooks, setHooks] = useState<HookStatus[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    backend.dataDir().then(setDir);
    backend.hooksStatus().then(setHooks);
  }, []);
  return (
    <>
      <Group title="데모">
        <Toggle label="데모 모드" hint="가상 세션으로 화면을 미리 봐요" v={props.demoRunning} on={() => props.onToggleDemo()} disabled={!IN_TAURI} />
        <p className="muted small">데모 세션에는 DEMO 표시가 붙고, 실제 세션과 섞이지 않아요. 실제 연결된 세션 {props.realCount}개.</p>
      </Group>
      <Group title="데이터">
        <p className="muted small">
          이벤트는 메모리에만 보관하고 디스크에 저장하지 않아요. 프롬프트, 응답, 파일 내용, 명령 출력은 Hook 단계에서 버려집니다. 앱 데이터 폴더: <span className="mono">{dir}</span>
        </p>
      </Group>
      <Group title="에이전트 설정 백업 복원">
        {hooks.map((h) => (
          <div key={h.agent} className="field">
            <span>{h.agent === 'claude' ? 'Claude Code' : 'Codex'}<small>백업 {h.backups.length}개</small></span>
            <button
              className="btn"
              disabled={!h.backups.length}
              onClick={() => backend.hooksRestore(h.agent).then((p) => setMsg(`복원했어요: ${p}`)).catch((e) => setMsg(String(e)))}
            >
              가장 최근 백업으로 복원
            </button>
          </div>
        ))}
      </Group>
      <Group title="완전 제거">
        <p className="muted small">
          모든 에이전트 설정에서 Agent Room Hook을 지우고 ~/.agent-room/bin 의 전달 프로그램도 삭제해요. 앱을 지우기 전에 실행하세요. 앱 없이도 터미널에서
          <span className="mono"> ~/.agent-room/bin/agent-room-hook --uninstall</span> 로 같은 작업을 할 수 있어요.
        </p>
        <div className="field">
          <span>모든 Hook 제거</span>
          <button className="btn danger" onClick={() => backend.hooksRemoveAll().then(() => setMsg('모든 Hook을 제거했어요.'))}>제거</button>
        </div>
      </Group>
      {msg && <div className="callout small">{msg}</div>}
    </>
  );
}
