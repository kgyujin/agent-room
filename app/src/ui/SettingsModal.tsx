import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { appVersion, autostartEnabled, backend, DEFAULT_SETTINGS, IN_TAURI, setAutostart, ZOOMS } from '../bridge';
import { BUILTIN_CRITTERS, CRITTER_COLORS, DEFAULT_POOL } from '../game/skin';
import type { Sfx, Sound } from '../game/audio';
import type { CharacterFile, HookStatus, Settings } from '../types';
import { AgentMark, Icon, type IconName } from './icons';
import { DASH_CARDS } from './DashboardPage';
import { BACKDROPS, UI_THEMES, backdropOf, uiTheme } from '../themes';
import { L } from '../i18n';

/** settings panes, in the order they appear in the sidebar */
const PANES = [
  { id: 'general', get label() { return L('일반', 'General'); }, icon: 'cog' },
  { id: 'agents', get label() { return L('에이전트', 'Agents'); }, icon: 'link' },
  { id: 'notify', get label() { return L('알림', 'Notifications'); }, icon: 'bell' },
  { id: 'sound', get label() { return L('소리', 'Sound'); }, icon: 'sound' },
  { id: 'pets', get label() { return L('펫', 'Pets'); }, icon: 'paw' },
  { id: 'look', get label() { return L('메인 창', 'Main window'); }, icon: 'panel' },
  { id: 'bar', get label() { return L('메뉴바', 'Menu bar'); }, icon: 'menubar' },
  { id: 'island', get label() { return L('다이나믹 아일랜드', 'Dynamic Island'); }, icon: 'island' },
  { id: 'dev', get label() { return L('고급', 'Advanced'); }, icon: 'gear' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
export type SettingsPane = (typeof PANES)[number]['id'];

/** settings each pane's "기본값으로" puts back (not the pet list, colours, sounds or kept history) */
const PANE_KEYS: Partial<Record<SettingsPane, (keyof Settings)[]>> = {
  general: ['autoUpdateCheck', 'claudeAccountLimits', 'font', 'showCost', 'costClaudePerM', 'costCodexPerM', 'showLimits', 'tokenUnit', 'uiTheme', 'uiZoom'],
  agents: ['doneShownSec', 'staleMinutes'],
  notify: ['approveInApp', 'approveWaitSec', 'dailySummary', 'dailySummaryHour', 'notifyApproval', 'notifyComplete', 'notifyLimits', 'notifyMinTurnSec', 'notifyOnlyWhenHidden', 'quietFrom', 'quietHours', 'quietTo', 'renotifyMin'],
  sound: ['bgm', 'sfx'],
  pets: ['desktopPets', 'desktopPetSize', 'petBubbles', 'petEnergy'],
  look: ['alwaysOnTop', 'alwaysOnTopRoom', 'backdrop', 'dashHidden', 'idleTags', 'showDock', 'showTabs', 'tagLook', 'tagStyle', 'theme'],
  bar: ['trayPet'],
  island: ['island', 'islandHideIdle', 'islandOpen', 'islandPeek', 'islandScreen', 'islandUsage'],
};

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
  // search across every pane: all panes render, and rows (or whole groups) that don't match are hidden
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const show = (t: SettingsPane) => (query ? true : tab === t);
  const body = useRef<HTMLDivElement>(null);
  const [hits, setHits] = useState(0);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    let n = 0;
    el.querySelectorAll<HTMLElement>('.set-group').forEach((g) => {
      const title = g.querySelector('h4')?.textContent?.toLowerCase() ?? '';
      const whole = !!query && title.includes(query);
      let any = false;
      g.querySelectorAll<HTMLElement>('.set-rows > *').forEach((r) => {
        const hit = !query || whole || (r.textContent ?? '').toLowerCase().includes(query);
        r.style.display = hit ? '' : 'none';
        if (hit) { any = true; n++; }
      });
      g.style.display = any || !query ? '' : 'none';
    });
    // notes between groups stay only when they hold the words themselves
    el.querySelectorAll<HTMLElement>(':scope > :not(.set-group)').forEach((x) => {
      x.style.display = !query || (x.textContent ?? '').toLowerCase().includes(query) ? '' : 'none';
    });
    setHits(n);
  });
  // "기본값으로": the pane's own settings go back to their defaults (pets, sounds and history stay)
  const [resetAsk, setResetAsk] = useState(false);
  useEffect(() => setResetAsk(false), [tab]);
  const resetKeys = PANE_KEYS[tab] ?? [];
  const reset = () => {
    if (!resetAsk) return setResetAsk(true);
    const next = { ...s } as Record<string, unknown>;
    for (const k of resetKeys) next[k] = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
    onChange(next as unknown as Settings);
    setResetAsk(false);
  };
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal card settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={L('설정', 'Settings')}>
        <aside className="set-side">
          <b className="set-title">{L('설정', 'Settings')}</b>
          <input type="search" className="set-search" placeholder={L('설정 찾기', 'Search settings')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('설정 찾기', 'Search settings')} />
          <nav aria-label={L('설정 영역', 'Settings sections')}>
            {PANES.map((p) => (
              <button key={p.id} className={(query ? p.label.toLowerCase().includes(query) : tab === p.id) ? 'on' : ''} onClick={() => { setTab(p.id); setQ(''); }} aria-current={tab === p.id ? 'page' : undefined}>
                <Icon name={p.icon} size={14} />{p.label}
              </button>
            ))}
          </nav>
          <small className="set-ver">Agent Room {version}</small>
        </aside>
        <section className="set-main">
          <header>
            <h3>{query ? L(`'${q.trim()}' 찾기 · ${hits}개`, `'${q.trim()}' · ${hits} found`) : pane.label}</h3>
            {!query && resetKeys.length > 0 && <button className={`btn small set-reset ${resetAsk ? 'ask' : ''}`} onClick={reset}>{resetAsk ? L('한 번 더 누르면 기본값으로', 'Click again to reset') : L('기본값으로', 'Reset to defaults')}</button>}
            <button className="tool" onClick={props.onClose} aria-label={L('닫기', 'Close')}><Icon name="close" /></button>
          </header>
          <div className="modal-body" ref={body}>
            {show('general') && (
              <>
                <Group title={L('시작', 'Startup')}>
                  <AutostartToggle />
                </Group>
                <Group title={L('모양', 'Look')}>
                  <Field label="언어 · Language">
                    <select value={s.language ?? 'auto'} onChange={(e) => set('language', e.target.value as Settings['language'])}>
                      <option value="auto">{L('시스템 언어 따라', 'Follow the system')}</option>
                      <option value="ko">한국어</option>
                      <option value="en">English</option>
                    </select>
                  </Field>
                  <Field label={L('색 테마', 'Colour theme')}>
                    <div className="swatches">
                      {UI_THEMES.map((th) => (
                        <button key={th.id} className={`swatch theme ${(s.uiTheme || 'clean') === th.id ? 'on' : ''}`} title={th.name} aria-label={th.name}
                          style={{ background: `linear-gradient(135deg, ${th.vars['--accent']} 50%, ${th.vars['--frame-l']} 50%)` }} onClick={() => set('uiTheme', th.id)} />
                      ))}
                    </div>
                  </Field>
                  <Field label={L('글꼴', 'Font')}>
                    <select value={s.font} onChange={(e) => set('font', e.target.value as Settings['font'])}>
                      <option value="mixed">{L('기본 (제목만 도트)', 'Default (pixel titles only)')}</option>
                      <option value="system">{L('읽기 쉬운 글꼴만', 'Plain fonts only')}</option>
                      <option value="pixel">{L('전부 도트', 'All pixel')}</option>
                    </select>
                  </Field>
                  <Field label={L('화면 크기', 'Zoom')} hint="⌘+ ⌘− ⌘0">
                    <select value={s.uiZoom ?? 1} onChange={(e) => set('uiZoom', Number(e.target.value))} disabled={!IN_TAURI}>
                      {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%{z === 1 ? L(' (기본)', ' (default)') : ''}</option>)}
                    </select>
                  </Field>
                </Group>
                <Group title={L('사용량', 'Usage')}>
                  <Toggle label={L('남은 사용량 보이기', 'Show usage left')} hint={L('5시간·주간 한도를 메인 창, 메뉴바, 아일랜드에 보여 줘요', 'Shows the 5-hour and weekly limits in the main window, menu bar and island')} v={s.showLimits} on={(v) => set('showLimits', v)} />
                  {s.showLimits && <Toggle label={L('Claude 계정에서 받아오기', 'Get from the Claude account')} hint={L('데스크톱 앱·VS Code 세션의 한도도 보여요. 키체인의 Claude Code 로그인으로 Anthropic에만 묻고, 저장하지 않아요', 'Limits for desktop app and VS Code sessions too. Asks only Anthropic, with the Claude Code login in the Keychain, and stores nothing')} sub v={s.claudeAccountLimits ?? true} on={(v) => set('claudeAccountLimits', v)} />}
                  <Field label={L('토큰 단위', 'Token units')} hint={L('토큰 수를 어떻게 줄여 쓸지 골라요', 'How token counts are shortened')}>
                    <select value={s.tokenUnit ?? 'si'} onChange={(e) => set('tokenUnit', e.target.value as 'si' | 'ko')}>
                      <option value="si">12.4K · 340M</option>
                      <option value="ko">1.24만 · 3.4억</option>
                    </select>
                  </Field>
                  <Toggle label={L('추정 비용 보이기', 'Show estimated cost')} hint={L('API로 쓸 때만 의미가 있어요. 로컬 토큰 수 × 아래 단가로 계산한 추정치예요', 'Only meaningful with API use. Estimated from local token counts × the prices below')} v={s.showCost ?? false} on={(v) => set('showCost', v)} />
                  {s.showCost && (['claude', 'codex'] as const).map((a) => {
                    const k = a === 'claude' ? 'costClaudePerM' : 'costCodexPerM';
                    return (
                      <Field key={a} label={`${a === 'claude' ? 'Claude Code' : 'Codex'} ${L('단가', 'price')}`} hint={L('100만 토큰당 달러 (입력·출력·캐시를 섞은 평균)', 'USD per million tokens (a blend of input, output and cache)')} sub>
                        <input type="number" min={0} step={0.1} className="num-in" value={s[k] ?? 0} onChange={(e) => set(k, Math.max(0, Number(e.target.value) || 0))} />
                      </Field>
                    );
                  })}
                </Group>
                <Group title={L('기록', 'History')}>
                  <Field label={L('타임라인 보관', 'Keep the timeline')} hint={L('켜면 이 컴퓨터(~/.agent-room/history)에만 저장하고, 기간이 지난 날은 지워요. 끄면 저장된 기록도 지워요', 'Saved only on this computer (~/.agent-room/history); older days are deleted. Turning it off deletes what was saved')}>
                    <select value={s.historyDays ?? 0} onChange={(e) => set('historyDays', Number(e.target.value))}>
                      <option value={0}>{L('보관 안 함 (메모리에만)', 'Off (memory only)')}</option>
                      <option value={7}>{L('7일', '7 days')}</option>
                      <option value={30}>{L('30일', '30 days')}</option>
                      <option value={90}>{L('90일', '90 days')}</option>
                    </select>
                  </Field>
                  {(s.historyDays ?? 0) > 0 && (
                    <div className="field sub">
                      <span>{L('저장된 기록', 'Saved history')}</span>
                      <button className="btn" disabled={!IN_TAURI} onClick={() => void backend.historyClear()}>{L('모두 지우기', 'Delete all')}</button>
                    </div>
                  )}
                </Group>
                <Group title={L('단축키', 'Shortcuts')}>
                  <p className="pn-note">{L('앱 창이 앞에 있을 때만 동작해요. 글자를 입력하는 칸에서는 쓰이지 않아요.', 'Work only while the app window is in front, and not while typing in a field.')}</p>
                  <dl className="info keys">
                    <div><dt>D</dt><dd>{L('대시보드 방과 같이 보기 · 닫기', 'Dashboard beside the room · close')}</dd></div>
                    <div><dt>F</dt><dd>{L('대시보드만 보기', 'Dashboard only')}</dd></div>
                    <div><dt>N</dt><dd>{L('다음 내 차례 세션 열기', 'Open the next session waiting for you')}</dd></div>
                    <div><dt>/</dt><dd>{L('대시보드에서 세션 찾기', 'Find a session in the dashboard')}</dd></div>
                    <div><dt>Esc</dt><dd>{L('대시보드 닫기', 'Close the dashboard')}</dd></div>
                  </dl>
                </Group>
                <Group title={L('업데이트', 'Updates')}>
                  <div className="field">
                    <span>{L('지금 버전', 'Version')} <b className="ver">{version || '—'}</b></span>
                    <button className="btn" onClick={props.onCheckUpdate} disabled={!IN_TAURI}>{L('업데이트 확인', 'Check for updates')}</button>
                  </div>
                  <Toggle label={L('새 버전 자동 확인', 'Check for new versions')} hint={L('앱을 켤 때 확인하고, 새 버전이 있으면 설치할지 물어봐요', 'Checks when the app starts and asks before installing')} v={s.autoUpdateCheck ?? true} on={(v) => set('autoUpdateCheck', v)} />
                </Group>
              </>
            )}
            {show('agents') && (
              <>
                <Agents />
                <Group title={L('상태 판단', 'Status')}>
                  <Field label={L('응답 없음으로 볼 시간', 'Not responding after')} hint={L('이 시간 동안 소식이 없으면 \'응답 없음\'으로 표시해요', 'Shows \'Not responding\' after this long without news')}>
                    <select value={s.staleMinutes} onChange={(e) => set('staleMinutes', Number(e.target.value))}>
                      {[...new Set([1, 3, 5, 10, 30, s.staleMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{L(`${m}분`, `${m} min`)}{m === 3 ? L(' (기본)', ' (default)') : ''}</option>)}
                    </select>
                  </Field>
                  <Field label={L('\'완료\' 표시 유지', 'Keep showing \'Done\'')}>
                    <select value={s.doneShownSec ?? 60} onChange={(e) => set('doneShownSec', Number(e.target.value))}>
                      <option value={30}>{L('30초', '30 s')}</option>
                      <option value={60}>{L('1분', '1 min')}</option>
                      <option value={300}>{L('5분', '5 min')}</option>
                      <option value={0}>{L('다음 작업까지', 'Until the next task')}</option>
                    </select>
                  </Field>
                </Group>
              </>
            )}
            {show('notify') && (
              <Group>
                <Toggle label={L('승인·입력 요청', 'Approval or input asked')} hint={L('에이전트가 내 답을 기다릴 때', 'When an agent waits for your answer')} v={s.notifyApproval} on={(v) => set('notifyApproval', v)} />
                <Toggle label={L('작업 완료·오류', 'Work done or failed')} v={s.notifyComplete} on={(v) => set('notifyComplete', v)} />
                {s.notifyComplete && (
                  <Field label={L('완료 알림을 받을 작업', 'Notify for')} sub>
                    <select value={s.notifyMinTurnSec ?? 0} onChange={(e) => set('notifyMinTurnSec', Number(e.target.value))}>
                      <option value={0}>{L('모든 작업', 'All work')}</option>
                      <option value={60}>{L('1분 이상 걸린 작업', 'Work that took 1 min or more')}</option>
                      <option value={300}>{L('5분 이상 걸린 작업', 'Work that took 5 min or more')}</option>
                      <option value={900}>{L('15분 이상 걸린 작업', 'Work that took 15 min or more')}</option>
                    </select>
                  </Field>
                )}
                <Field label={L('오래 기다리면 한 번 더', 'Remind me when it waits')} hint={L('승인·답변 요청이 이만큼 기다리면 다시 알려요', 'Notifies again when an approval or question waits this long')}>
                  <select value={s.renotifyMin ?? 5} onChange={(e) => set('renotifyMin', Number(e.target.value))}>
                    <option value={0}>{L('다시 알리지 않기', 'Never')}</option>
                    <option value={5}>{L('5분 뒤', 'After 5 min')}</option>
                    <option value={10}>{L('10분 뒤', 'After 10 min')}</option>
                    <option value={30}>{L('30분 뒤', 'After 30 min')}</option>
                  </select>
                </Field>
                <Toggle label={L('남은 사용량 10% 이하', 'Usage left at 10% or less')} v={s.notifyLimits} on={(v) => set('notifyLimits', v)} />
                <Toggle label={L('하루 요약', 'Day summary')} hint={L('정한 시각이 지나면 하루에 한 번, 오늘 끝낸 요청·테스트·고친 파일 수를 알려 줘요', 'Once a day after the hour you pick: today\'s requests done, tests and files edited')} v={s.dailySummary ?? false} on={(v) => set('dailySummary', v)} />
                {s.dailySummary && (
                  <Field label={L('알릴 시각', 'At')} sub>
                    <select value={s.dailySummaryHour ?? 18} onChange={(e) => set('dailySummaryHour', Number(e.target.value))}>
                      {[17, 18, 19, 20, 21, 22].map((hr) => <option key={hr} value={hr}>{L(`${hr}시`, `${hr}:00`)}</option>)}
                    </select>
                  </Field>
                )}
                <Toggle label={L('앱에서 승인하기 (Claude Code)', 'Approve in the app (Claude Code)')} hint={L('권한 요청을 메인 창·아일랜드·대시보드에서 허용하거나 거부해요. 기다리는 동안 Claude Code의 승인 창은 뜨지 않고, 시간 안에 답하지 않으면 원래대로 Claude Code가 물어봐요', 'Allow or deny permission requests from the main window, island or dashboard. Claude Code\'s own prompt waits meanwhile, and asks as usual if you don\'t answer in time')} v={s.approveInApp ?? false} on={(v) => {
                  set('approveInApp', v);
                  // the permission hook needs its longer timeout, which reinstalling writes (only where it is already installed)
                  if (v && IN_TAURI) void backend.hooksStatus().then(async (all) => { if (all.some((h) => h.agent === 'claude' && h.installed !== 'none')) await backend.hooksInstall('claude'); }).catch(() => undefined);
                }} />
                {s.approveInApp && (
                  <Field label={L('앱에서 기다릴 시간', 'Wait in the app for')} sub>
                    <select value={s.approveWaitSec ?? 30} onChange={(e) => set('approveWaitSec', Number(e.target.value))}>
                      {[15, 30, 60, 90].map((sec) => <option key={sec} value={sec}>{L(`${sec}초`, `${sec} s`)}{sec === 30 ? L(' (기본)', ' (default)') : ''}</option>)}
                    </select>
                  </Field>
                )}
                <Toggle label={L('방해 금지 시간', 'Quiet hours')} hint={L('이 시간에는 알림을 보내지 않아요. macOS 집중 모드가 켜져 있으면 macOS가 알림을 알아서 막아요', 'No notifications in these hours. macOS Focus also holds them back when it is on')} v={s.quietHours ?? false} on={(v) => set('quietHours', v)} />
                {s.quietHours && (
                  <Field label={L('시간', 'Hours')} sub>
                    <span className="row tight">
                      <select value={s.quietFrom ?? 22} onChange={(e) => set('quietFrom', Number(e.target.value))}>
                        {[...Array(24).keys()].map((h) => <option key={h} value={h}>{L(`${h}시`, `${h}:00`)}</option>)}
                      </select>
                      {L('부터', 'to')}
                      <select value={s.quietTo ?? 8} onChange={(e) => set('quietTo', Number(e.target.value))}>
                        {[...Array(24).keys()].map((h) => <option key={h} value={h}>{L(`${h}시`, `${h}:00`)}</option>)}
                      </select>
                      {L('까지', '')}
                    </span>
                  </Field>
                )}
                <Toggle label={L('앱을 보고 있을 땐 알리지 않기', 'Don\'t notify while the app is in view')} v={s.notifyOnlyWhenHidden} on={(v) => set('notifyOnlyWhenHidden', v)} />
              </Group>
            )}
            {show('sound') && (
              <>
                <Group>
                  <Toggle label={L('효과음', 'Sound effects')} v={s.sfx} on={(v) => set('sfx', v)} />
                  <Toggle label={L('배경 음악 (Lo-fi)', 'Background music (lo-fi)')} v={s.bgm} on={(v) => set('bgm', v)} />
                </Group>
                <Sounds sound={props.sound} onChanged={props.onSoundsChanged} />
              </>
            )}
            {show('pets') && <Pets settings={s} onChange={onChange} names={props.characters} onAdded={props.onCharactersChanged} />}
            {show('look') && (
              <>
                <Group title={L('창', 'Window')}>
                  <Toggle label={L('항상 위에 표시', 'Always on top')} v={s.alwaysOnTop} on={(v) => set('alwaysOnTop', v)} />
                  <Toggle label={L('방만 띄울 때 항상 위에 표시', 'Always on top in room-only mode')} v={s.alwaysOnTopRoom} on={(v) => set('alwaysOnTopRoom', v)} />
                </Group>
                <Group title={L('방', 'Room')}>
                  <Field label={L('조명', 'Lighting')}>
                    <select value={s.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
                      <option value="auto">{L('실제 시간에 맞춰', 'Follow the time of day')}</option>
                      <option value="day">{L('늘 낮', 'Always day')}</option>
                      <option value="sunset">{L('늘 노을', 'Always sunset')}</option>
                      <option value="night">{L('늘 밤', 'Always night')}</option>
                    </select>
                  </Field>
                  <Field label={L('방 바깥 배경', 'Backdrop')}>
                    <div className="swatches">
                      {[{ id: '', name: L('테마 색', 'Theme colour'), bd: uiTheme(s.uiTheme).bd }, ...BACKDROPS].map((b) => (
                        <button key={b.id} className={`swatch ${(s.backdrop || '') === b.id ? 'on' : ''}`} title={b.name} aria-label={b.name}
                          style={{ background: `radial-gradient(circle, ${b.bd[0]} 30%, ${b.bd[1]})` }} onClick={() => set('backdrop', b.id)} />
                      ))}
                      <label className={`swatch pick ${s.backdrop?.startsWith('#') ? 'on' : ''}`} title={L('직접 고르기', 'Pick your own')}
                        style={{ background: s.backdrop?.startsWith('#') ? `radial-gradient(circle, ${backdropOf(s.backdrop, uiTheme(s.uiTheme)).join(' 30%, ')})` : undefined }}>
                        <input type="color" value={s.backdrop?.startsWith('#') ? s.backdrop : '#cfe3d6'} onChange={(e) => set('backdrop', e.target.value)} aria-label={L('배경 색 직접 고르기', 'Pick a backdrop colour')} />
                      </label>
                    </div>
                  </Field>
                </Group>
                <Group title={L('이름표', 'Name tags')}>
                  <Field label={L('펫 이름표', 'Pet name tags')}>
                    <select value={s.tagStyle} onChange={(e) => set('tagStyle', e.target.value as Settings['tagStyle'])}>
                      <option value="compact">{L('프로젝트 이름만', 'Project name only')}</option>
                      <option value="full">{L('프로젝트와 하는 일', 'Project and what it does')}</option>
                      <option value="hover">{L('가리킬 때만', 'Only on hover')}</option>
                      <option value="off">{L('숨기기', 'Hide')}</option>
                    </select>
                  </Field>
                  {s.tagStyle !== 'off' && (
                    <div className={`nametags tag-preview ${s.tagLook === 'pixel' ? 'pixel' : ''}`} aria-hidden>
                      <span className="nametag t-work">
                        <AgentMark agent="claude" />
                        {s.tagStyle === 'full' ? <><b className="tag-project">web-app</b><span>{L('App.tsx 고치는 중', 'Editing App.tsx')}</span></> : <span>web-app</span>}
                        <i className="dot tone-work" />
                      </span>
                    </div>
                  )}
                  {s.tagStyle !== 'off' && (
                    <Field label={L('이름표 모양', 'Tag style')} sub>
                      <select value={s.tagLook ?? 'soft'} onChange={(e) => set('tagLook', e.target.value as 'soft' | 'pixel')}>
                        <option value="soft">{L('둥글게', 'Rounded')}</option>
                        <option value="pixel">{L('픽셀 테두리', 'Pixel frame')}</option>
                      </select>
                    </Field>
                  )}
                  {s.tagStyle !== 'off' && (
                    <Field label={L('쉬는 펫의 이름표', 'Tags of resting pets')} sub>
                      <select value={s.idleTags ?? 'dim'} onChange={(e) => set('idleTags', e.target.value as Settings['idleTags'])}>
                        <option value="dim">{L('흐리게', 'Dim')}</option>
                        <option value="hide">{L('숨기기', 'Hide')}</option>
                        <option value="show">{L('그대로', 'As is')}</option>
                      </select>
                    </Field>
                  )}
                </Group>
                <Group title={L('대시보드 카드', 'Dashboard cards')}>
                  {DASH_CARDS.map(([id, ko, en]) => (
                    <Toggle key={id} label={L(ko, en)} v={!(s.dashHidden ?? []).includes(id)} on={(v) => set('dashHidden', v ? (s.dashHidden ?? []).filter((x) => x !== id) : [...(s.dashHidden ?? []), id])} />
                  ))}
                </Group>
                <Group title={L('보일 요소', 'Show')}>
                  <Toggle label={L('아래쪽 상태 카드', 'Status card at the bottom')} hint={L('펫을 고르면 나와요', 'Shows when a pet is picked')} v={s.showDock} on={(v) => set('showDock', v)} />
                  <Toggle label={L('위쪽 세션 탭', 'Session tabs at the top')} v={s.showTabs} on={(v) => set('showTabs', v)} />
                </Group>
              </>
            )}
            {show('bar') && (
              <Group title={L('메뉴바 아이콘', 'Menu bar icon')}>
                <Field label={L('아이콘 펫', 'Icon pet')} hint={L('일할 땐 걷고, 내 차례면 느낌표를 띄워요', 'Walks while working and shows ! when it is your turn')}>
                  <select value={props.characters.includes(s.trayPet) || s.trayPet?.startsWith('builtin/') ? s.trayPet : 'builtin/shiba'} onChange={(e) => set('trayPet', e.target.value)}>
                    {BUILTIN_CRITTERS.map(([id, label]) => <option key={id} value={`builtin/${id}`}>{label}</option>)}
                    {props.characters.map((n) => <option key={n} value={n}>{n} {L('(내 PNG)', '(my PNG)')}</option>)}
                  </select>
                </Field>
                <p className="muted small">{L('펫 탭에서 바꾼 색과 추가한 PNG도 그대로 쓸 수 있어요. 아이콘을 누르면 현황과 사용량을 볼 수 있어요.', 'Colours and PNGs from the Pets tab work here too. Click the icon for status and usage.')}</p>
              </Group>
            )}
            {show('island') && (
              <Group title={L('다이나믹 아일랜드', 'Dynamic Island')}>
                <Toggle label={L('화면 맨 위에 상태 표시', 'Status at the top of the screen')} v={s.island} on={(v) => set('island', v)} />
                {s.island && (
                  <>
                    <Field label={L('펼치기', 'Open')} sub>
                      <select value={s.islandOpen ?? 'hover'} onChange={(e) => set('islandOpen', e.target.value as Settings['islandOpen'])}>
                        <option value="hover">{L('마우스를 올리면', 'On hover')}</option>
                        <option value="click">{L('클릭할 때만', 'On click only')}</option>
                      </select>
                    </Field>
                    <Field label={L('표시할 화면', 'Screen')} sub>
                      <select value={s.islandScreen ?? 'auto'} onChange={(e) => set('islandScreen', e.target.value as Settings['islandScreen'])}>
                        <option value="auto">{L('노치 있는 화면 (없으면 메뉴 막대 화면)', 'The notched screen (or the menu bar screen)')}</option>
                        <option value="main">{L('메뉴 막대가 있는 화면', 'The menu bar screen')}</option>
                        <option value="pointer">{L('마우스가 있는 화면', 'The screen with the pointer')}</option>
                      </select>
                    </Field>
                    <Toggle label={L('내 차례가 생기면 잠깐 펼치기', 'Open briefly when something needs you')} hint={L('승인·답변을 기다리는 세션이 새로 생기면 3초 동안 펼쳐서 보여 줘요', 'Opens for 3 seconds when a session starts waiting for an approval or answer')} sub v={s.islandPeek ?? true} on={(v) => set('islandPeek', v)} />
                    <Toggle label={L('일이 없을 땐 숨기기', 'Hide when idle')} sub v={s.islandHideIdle ?? false} on={(v) => set('islandHideIdle', v)} />
                    {s.showLimits && <Toggle label={L('접혔을 때 남은 사용량', 'Usage left when closed')} sub v={s.islandUsage ?? true} on={(v) => set('islandUsage', v)} />}
                  </>
                )}
              </Group>
            )}
            {show('dev') && <Dev {...props} />}
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

const SOUND_EVENTS = (): [Sfx, string][] => [['start', L('작업 시작', 'Work starts')], ['done', L('작업 완료', 'Work done')], ['alert', L('승인·입력 요청', 'Approval or input asked')], ['error', L('오류', 'Error')]];

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
    <Group title={L('효과음 바꾸기', 'Change sounds')}>
      {SOUND_EVENTS().map(([ev, label]) => (
        <div key={ev} className="field">
          <span>{label} <small className="muted">· {mine.includes(ev) ? L('내 파일', 'my file') : L('기본음', 'default')}</small></span>
          <div className="row tight">
            <button className="btn small" onClick={() => { sound.unlock(); sound.play(ev, true); }}>{L('듣기', 'Play')}</button>
            <label className="btn small">
              {L('파일 고르기', 'Choose file')}
              <input type="file" accept=".mp3,.wav,.ogg,.m4a,audio/*" hidden onChange={(e) => { void pick(ev, e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {mine.includes(ev) && <button className="btn small" onClick={() => void reset(ev)}>{L('기본음', 'Default')}</button>}
          </div>
        </div>
      ))}
      {note && <p className="small">{note}</p>}
      <p className="muted small">
        {L('2MB 이하 mp3·wav·ogg·m4a 파일을 고르면 그 소리로 바뀌어요. 다른 사이트에서 받은 소리는 그 사이트의 이용 조건을 확인하고 써 주세요. 파일은 이 컴퓨터의 ~/.agent-room/sounds 폴더에만 저장돼요.', 'Pick an mp3, wav, ogg or m4a file up to 2 MB to use that sound. For sounds from other sites, check that site\'s terms. Files are kept only in ~/.agent-room/sounds on this computer.')}
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
  return <Toggle label={L('로그인 시 자동 실행', 'Open at login')} v={on} disabled={!IN_TAURI} on={(v) => setAutostart(v).then(setOn).catch(() => undefined)} />;
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
    if (!next.length) return setNote(L('펫을 하나 이상 골라 주세요.', 'Pick at least one pet.'));
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
      setNote(`${L('추가하고 체크했어요', 'Added and checked')}: ${added.join(', ')}`);
    }
  };
  // a renamed or deleted file is renamed or dropped in the list too
  const repoint = (from: string, to: string | null) =>
    onChange({ ...s, petPool: pool.flatMap((x) => (x === from ? (to ? [to] : []) : [x])), trayPet: s.trayPet === from ? to ?? 'builtin/shiba' : s.trayPet });
  const checkedCount = pool.filter((x) => x.startsWith('builtin/') || names.includes(x)).length;
  return (
    <>
      <Group title={L(`쓸 펫 고르기 · ${checkedCount}마리`, `Pets to use · ${checkedCount}`)}>
        <p className="muted small set-lead">{L('체크한 펫 중에서 방에 없는 펫이 무작위로 나와요. 체크한 펫이 모두 방에 있을 때만 같은 펫이 또 나와요.', 'New sessions get a random checked pet not already in the room. A pet repeats only when all checked pets are in.')}</p>
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
                <div className="swatches mini" aria-label={`${label} ${L('색', 'colour')}`}>
                  <button className={`swatch orig ${!cur ? 'on' : ''}`} onClick={() => setColor()} title={L('원래 색', 'Original colour')} aria-label={`${label} ${L('원래 색', 'original colour')}`} />
                  {CRITTER_COLORS.map((c) => (
                    <button key={c} className={`swatch ${cur === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`${label} ${L('색', 'colour')} ${c}`} />
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
            <b>{L('+ PNG 추가', '+ Add PNG')}</b>
            <small>{L('좋아하는 도트 캐릭터', 'Your favourite pixel character')}</small>
          </label>
        </div>
        {note && <p className="small set-note">{note}</p>}
      </Group>
      <Group title={L('움직임', 'Motion')}>
        <Field label={L('일이 없을 때 활동량', 'Activity when idle')}>
          <select value={s.petEnergy ?? 'normal'} onChange={(e) => set('petEnergy', e.target.value as Settings['petEnergy'])}>
            <option value="calm">{L('차분하게 (주로 쉬고 가끔 낮잠)', 'Calm (mostly rests, naps now and then)')}</option>
            <option value="normal">{L('보통 (쉬다가 돌아다니기)', 'Normal (rests and wanders)')}</option>
            <option value="lively">{L('활발하게 (자주 돌아다니고 춤추기)', 'Lively (wanders and dances a lot)')}</option>
          </select>
        </Field>
        <Toggle label={L('머리 위 상태 아이콘', 'Status icon over the head')} hint={L('! ? ✓ 같은 표시', 'Marks like ! ? ✓')} v={s.petBubbles ?? true} on={(v) => set('petBubbles', v)} />
      </Group>
      <Group title={L('바탕화면 펫', 'Desktop pets')}>
        <Toggle label={L('화면 아래를 돌아다니기', 'Walk along the bottom of the screen')}
          hint={L('방 밖으로 나와 Dock 위를 걸어 다녀요. 일하는 중엔 그 자리에서 일하고, 승인이 필요하면 포인터 쪽으로 달려와요. 클릭하면 그 세션을 열고, 끌어서 옮길 수 있어요. 펫이 아닌 곳은 클릭이 그대로 뒤로 지나가요.', 'They come out of the room and walk along the Dock. A working pet stays put and works; one that needs your OK runs over to the pointer. Click one to open its session, or drag it around. Clicks anywhere else go straight through.')}
          v={s.desktopPets ?? false} on={(v) => set('desktopPets', v)} />
        <Field label={L('크기', 'Size')}>
          <select value={s.desktopPetSize ?? 2} disabled={!s.desktopPets} onChange={(e) => set('desktopPetSize', Number(e.target.value))}>
            <option value={2}>{L('작게', 'Small')}</option>
            <option value={3}>{L('보통', 'Medium')}</option>
            <option value={4}>{L('크게', 'Large')}</option>
          </select>
        </Field>
      </Group>
      <p className="muted small">
        {L('추가한 PNG는 ', 'Added PNGs are kept in ')}<span className="mono">{dir}/characters/</span>{L(' 폴더에 저장되고, 이 폴더에 직접 넣어도 돼요. 확대된 도트는 1칸 = 1px 원래 크기로 줄이고 단색 배경은 투명하게 처리해요. 파일은 이 컴퓨터에만 있고 어디에도 올리지 않아요.', ', and you can put files there yourself. Scaled-up pixel art is shrunk back to 1 cell = 1 px and a plain background becomes transparent. The files stay on this computer and are uploaded nowhere.')}
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
          <input autoFocus value={draft} maxLength={40} aria-label={L('새 이름', 'New name')} onChange={(e) => setDraft(e.target.value)} onBlur={save}
            onClick={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); } }} />
        )}
      </label>
      <span className="pet-actions">
        <button className="link" onClick={() => setDraft(file.name)}>{L('이름', 'Rename')}</button>
        <label className="link">
          {L('파일 바꾸기', 'Replace file')}
          <input type="file" accept="image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.arrayBuffer().then((b) => onReplace(Array.from(new Uint8Array(b)))); }} />
        </label>
        <button className={`link ${sure ? 'danger' : ''}`} onClick={() => (sure ? onRemove() : (setSure(true), window.setTimeout(() => setSure(false), 3000)))}>{sure ? L('정말 삭제', 'Really delete') : L('삭제', 'Delete')}</button>
      </span>
    </div>
  );
}

const NAMES = { claude: 'Claude Code', codex: 'OpenAI Codex CLI' };

/** the install notes come from the core crate in Korean; show them in plain words in either language */
function noteText(n: string): string {
  if (n.includes('/hooks')) return L('Codex는 처음 한 번 허락이 필요해요. Codex에서 /hooks 를 입력하고 agent-room-hook 을 승인해 주세요.', 'Codex asks once before it runs a new connection. In Codex, type /hooks and approve agent-room-hook.');
  if (n.includes('hooks = false')) return L('Codex 설정(~/.codex/config.toml)에서 이 기능이 꺼져 있어요. [features] 아래 hooks = false 를 true 로 바꿔 주세요.', 'This feature is turned off in Codex settings (~/.codex/config.toml). Under [features], change hooks = false to true.');
  const part = n.match(/(\d+)개 중 (\d+)개만/);
  if (part) return L(`설정 파일에 연결 항목 ${part[1]}개 중 ${part[2]}개만 남아 있어요. 다른 프로그램이 설정을 고쳤을 수 있어요. 다시 연결하면 채워져요.`, `Only ${part[2]} of ${part[1]} connection entries are left in the settings file; another program may have edited it. Reconnecting fills them in.`);
  if (n.includes('statusLine')) return L('Claude Code의 상태 표시줄 설정이 다른 명령으로 바뀌어서 남은 사용량을 받지 못해요. 다시 연결하면 그 명령은 그대로 보이게 두고 사용량만 함께 받아요.', "Claude Code's status line was changed to another command, so usage left can't come through. Reconnecting keeps that command showing and gets usage alongside it.");
  return n;
}

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
      <Group title={L('연결', 'Connections')}>
        {list.map((h) => (
          <div key={h.agent} className="agent-item">
            <div className="field">
              <span>
                {NAMES[h.agent]}
                <small>{L('설정 파일', 'Settings file')} <span className="mono">{h.configPath}</span></small>
                {!h.agentDetected && <small>{L('이 컴퓨터에서 설정 폴더를 찾지 못했어요.', 'No settings folder found on this computer.')}</small>}
              </span>
              <span className="agent-act">
                <span className={`tag st-${h.installed}`}>{{ full: L('연결됨', 'Connected'), partial: L('다시 연결 필요', 'Needs reconnecting'), none: L('연결 안 됨', 'Not connected') }[h.installed]}</span>
                {h.installed !== 'none' && (
                  <button className="btn" onClick={() => run(() => backend.hooksUninstall(h.agent), L(`${NAMES[h.agent]} 연결을 끊었어요.`, `Disconnected ${NAMES[h.agent]}.`))}>
                    {L('연결 끊기', 'Disconnect')}
                  </button>
                )}
                <button className={`btn ${h.installed === 'full' ? '' : 'primary'}`} onClick={() => run(() => backend.hooksInstall(h.agent), L(`${NAMES[h.agent]} 연결했어요. 새로 시작하는 세션부터 표시돼요.`, `Connected ${NAMES[h.agent]}. Sessions started from now on show up.`))}>
                  {h.installed === 'none' ? L('연결하기', 'Connect') : L('다시 연결', 'Reconnect')}
                </button>
              </span>
            </div>
            {h.notes.map((n) => (
              <div key={n} className="callout wait small">{noteText(n)}</div>
            ))}
          </div>
        ))}
      </Group>
      {msg && <div className="callout small">{msg}</div>}
      <p className="muted small">
        {L('연결하면 에이전트가 일할 때마다 \'지금 무엇을 하는지\'만 이 앱에 알려 주도록 에이전트 설정에 몇 줄을 더해요. 대화에는 아무것도 끼어들지 않고 토큰도 더 쓰지 않아요. 바꾸기 전에 원래 설정을 백업해 둬요.', 'Connecting adds a few lines to the agent\'s settings so it tells this app what it is doing as it works. Nothing is added to your conversations and no extra tokens are used. Your original settings are backed up first.')}
      </p>
      <p className="muted small">
        {L('Claude Code는 남은 사용량을 화면 아래 상태 표시줄에만 알려 줘서, 그 표시줄도 함께 연결해요. 원래 쓰던 표시줄은 그대로 보이고, 연결을 끊으면 원래대로 돌아가요.', 'Claude Code reports usage left only to the status bar under its prompt, so that is connected too. Your own status bar looks the same, and disconnecting puts it back.')}
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
      <Group title={L('데모', 'Demo')}>
        <Toggle label={L('데모 모드', 'Demo mode')} hint={L('가상 세션으로 화면을 미리 봐요', 'Preview the screens with made-up sessions')} v={props.demoRunning} on={() => props.onToggleDemo()} disabled={!IN_TAURI} />
        <p className="muted small">{L(`데모 세션에는 DEMO 표시가 붙고, 실제 세션과 섞이지 않아요. 실제 연결된 세션 ${props.realCount}개.`, `Demo sessions carry a DEMO mark and never mix with real ones. Real sessions connected: ${props.realCount}.`)}</p>
      </Group>
      <Group title={L('데이터', 'Data')}>
        <p className="muted small">
          {L('이벤트는 메모리에만 보관하고, 알림 탭의 기록 보관을 켰을 때만 이 컴퓨터에 저장해요. 프롬프트, 응답, 파일 내용, 명령 출력은 앱에 전달되기 전에 버려져요. 앱 데이터 폴더: ', 'Events stay in memory and are written to this computer only when history is turned on. Prompts, replies, file contents and command output are dropped before they reach the app. App data folder: ')}<span className="mono">{dir}</span>
        </p>
      </Group>
      <Group title={L('에이전트 설정 백업 복원', 'Restore agent settings backup')}>
        {hooks.map((h) => (
          <div key={h.agent} className="field">
            <span>{h.agent === 'claude' ? 'Claude Code' : 'Codex'}<small>{L(`백업 ${h.backups.length}개`, `${h.backups.length} backups`)}</small></span>
            <button
              className="btn"
              disabled={!h.backups.length}
              onClick={() => backend.hooksRestore(h.agent).then((p) => setMsg(`${L('복원했어요', 'Restored')}: ${p}`)).catch((e) => setMsg(String(e)))}
            >
              {L('가장 최근 백업으로 복원', 'Restore the latest backup')}
            </button>
          </div>
        ))}
      </Group>
      <Group title={L('완전 제거', 'Uninstall')}>
        <p className="muted small">
          {L('모든 에이전트 설정에서 Agent Room 연결을 지우고 ~/.agent-room/bin 의 작은 전달 프로그램도 삭제해요. 앱을 지우기 전에 실행하세요. 앱 없이도 터미널에서', 'Removes the Agent Room connection from every agent and deletes the small relay in ~/.agent-room/bin. Run it before deleting the app. Without the app, run')}
          <span className="mono"> ~/.agent-room/bin/agent-room-hook --uninstall</span>{L(' 로 같은 작업을 할 수 있어요.', ' in a terminal to do the same.')}
        </p>
        <div className="field">
          <span>{L('모든 에이전트 연결 끊기', 'Disconnect every agent')}</span>
          <button className="btn danger" onClick={() => backend.hooksRemoveAll().then(() => setMsg(L('모든 연결을 끊었어요.', 'Disconnected every agent.')))}>{L('연결 끊기', 'Disconnect')}</button>
        </div>
      </Group>
      {msg && <div className="callout small">{msg}</div>}
    </>
  );
}
