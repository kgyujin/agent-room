// Thin layer over Tauri IPC. Outside Tauri (plain browser, used only for design
// previews), a static preview backend is used and the UI labels itself as a preview.
import type { HistLine, MemoryFile, CharacterFile, SoundFile, HookStatus, Overview, RateLimits, Settings, Snapshot, TimelineEntry, Update, UsageHistory } from './types';
import { L, setLang } from './i18n';

export const IN_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Unlisten = () => void;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, cb: (payload: T) => void): Promise<Unlisten> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, (e) => cb(e.payload));
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto', roomView: 'iso', sfx: true, bgm: false, notifyComplete: true, notifyApproval: true, notifyLimits: true, notifyOnlyWhenHidden: true,
  staleMinutes: 3, panelOpen: true, alwaysOnTop: false, alwaysOnTopRoom: true, showLimits: true, petPool: [], trayPet: 'builtin/shiba', critterColors: {}, uiTheme: 'clean', island: true,
  font: 'mixed', backdrop: '', tagStyle: 'compact', tagLook: 'soft', showDock: true, showTabs: false,
  petEnergy: 'normal', islandOpen: 'hover',
  doneShownSec: 60, idleTags: 'dim', petBubbles: true, islandHideIdle: false, islandUsage: true, islandScreen: 'auto', notifyMinTurnSec: 0, autoUpdateCheck: true, uiZoom: 1, claudeAccountLimits: true, tokenUnit: 'si', dashHidden: [], dailySummary: false, dailySummaryHour: 18, showCost: false, costClaudePerM: 0, costCodexPerM: 0, historyDays: 0, approveInApp: false, approveWaitSec: 30, quietHours: false, quietFrom: 22, quietTo: 8, renotifyMin: 5, islandPeek: true, language: 'auto', desktopPets: false, desktopPetSize: 2,
};

export interface Backend {
  overview(): Promise<Overview>;
  timeline(key: string): Promise<TimelineEntry[]>;
  onUpdate(cb: (u: Update) => void): Promise<Unlisten>;
  onDetected(cb: (d: Overview['detected']) => void): Promise<Unlisten>;
  onTrayEvent(name: 'set-mini' | 'select-session' | 'open-settings' | 'check-update' | 'ui-zoom' | 'popover-shown' | 'settings-changed' | 'hover-main' | 'hover-island' | 'island-screen' | 'open-dashboard' | 'hover-desk' | 'pet-skins' | 'characters-changed', cb: (payload: unknown) => void): Promise<Unlisten>;
  /** menu bar popover / island buttons: open, mini, settings, select (key), quit */
  trayAction(action: string, key?: string): Promise<void>;
  /** resize the island window, kept centred at the top of the screen */
  islandLayout(width: number, height: number): Promise<void>;
  /** room-only mode: keep the app out of the Dock and the app switcher (macOS) */
  setRoomOnly(on: boolean): Promise<void>;
  /** camera notch of the menu bar screen [width, height] in points; null without one */
  notchSize(): Promise<[number, number] | null>;
  /** the local offset from UTC in minutes, for quiet hours */
  setTzOffset(min: number): Promise<void>;
  /** the language the menu bar menu and notifications use */
  setUiLang(en: boolean): Promise<void>;
  codexLimits(): Promise<RateLimits | null>;
  claudeLimits(): Promise<RateLimits | null>;
  hooksStatus(): Promise<HookStatus[]>;
  hooksInstall(agent: string): Promise<HookStatus>;
  hooksUninstall(agent: string): Promise<HookStatus>;
  hooksRestore(agent: string): Promise<string>;
  hooksRemoveAll(): Promise<unknown>;
  demoStart(): Promise<void>;
  demoStop(): Promise<void>;
  removeSession(key: string): Promise<void>;
  /** brings the terminal, editor or app the session runs in to the front */
  focusAgent(key: string): Promise<void>;
  /** the system's double-click interval (ms) */
  doubleClickMs(): Promise<number>;
  /** tokens per local day, recent rate and streaks, read from the agents' local logs */
  usageHistory(days: number): Promise<UsageHistory>;
  /** CLAUDE.md / AGENTS.md the agents load (global and per session folder), read-only */
  memoryFiles(): Promise<MemoryFile[]>;
  /** opens one of those files in the system's text editor */
  openMemoryFile(path: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  dataDir(): Promise<string>;
  /** writes a previewed report to ~/Downloads/<name> and returns the path */
  saveReport(name: string, text: string): Promise<string>;
  notifyText(title: string, body: string): Promise<void>;
  historyRead(from: number, to: number): Promise<HistLine[]>;
  historyClear(): Promise<void>;
  answerApproval(key: string, allow: boolean): Promise<void>;
  listCharacters(): Promise<CharacterFile[]>;
  /** which pet each session has in the room (the room tells the app; the desktop pets ask) */
  setPetSkins(bySession: Record<string, string>): Promise<void>;
  petSkins(): Promise<Record<string, string>>;
  /** tells the desktop pets to load the pet pictures again (a PNG was added, renamed, replaced or removed) */
  charactersChanged(): Promise<void>;
  /** menu bar icon frames (8 PNGs: run0..3, wait, done, idle, off) */
  setTrayFrames(frames: number[][]): Promise<void>;
  saveCharacter(name: string, bytes: number[]): Promise<string>;
  replaceCharacter(name: string, bytes: number[]): Promise<void>;
  renameCharacter(name: string, to: string): Promise<string>;
  removeCharacter(name: string): Promise<void>;
  listSounds(): Promise<SoundFile[]>;
  saveSound(event: string, name: string, bytes: number[]): Promise<void>;
  removeSound(event: string): Promise<void>;
}

const tauriBackend: Backend = {
  overview: () => tauriInvoke('get_overview'),
  timeline: (key) => tauriInvoke('get_timeline', { key }),
  onUpdate: (cb) => tauriListen('session-update', cb),
  onDetected: (cb) => tauriListen('agents-detected', cb),
  onTrayEvent: (name, cb) => tauriListen(name, cb),
  trayAction: (action, key) => tauriInvoke('tray_action', { action, key: key ?? null }),
  islandLayout: (width, height) => tauriInvoke('island_layout', { width, height }),
  notchSize: () => tauriInvoke('notch_size'),
  setTzOffset: (min) => tauriInvoke('set_tz_offset', { min }),
  setUiLang: (en) => tauriInvoke('set_ui_lang', { en }),
  codexLimits: () => tauriInvoke('codex_limits'),
  claudeLimits: () => tauriInvoke('claude_limits'),
  setRoomOnly: (on) => tauriInvoke('set_room_only', { on }),
  hooksStatus: () => tauriInvoke('hooks_status'),
  hooksInstall: (agent) => tauriInvoke('hooks_install', { agent }),
  hooksUninstall: (agent) => tauriInvoke('hooks_uninstall', { agent }),
  hooksRestore: (agent) => tauriInvoke('hooks_restore', { agent }),
  hooksRemoveAll: () => tauriInvoke('hooks_remove_all'),
  demoStart: () => tauriInvoke('demo_start'),
  demoStop: () => tauriInvoke('demo_stop'),
  removeSession: (key) => tauriInvoke('remove_session', { key }),
  focusAgent: (key) => tauriInvoke('focus_agent', { key }),
  doubleClickMs: () => tauriInvoke('double_click_ms'),
  usageHistory: (days) => tauriInvoke('usage_history', { tzOffsetMin: -new Date().getTimezoneOffset(), days }),
  memoryFiles: () => tauriInvoke('memory_files'),
  openMemoryFile: (path) => tauriInvoke('open_memory_file', { path }),
  getSettings: () => tauriInvoke('get_settings'),
  saveSettings: (settings) => tauriInvoke('save_settings', { settings }),
  dataDir: () => tauriInvoke('data_dir'),
  saveReport: (name, text) => tauriInvoke('save_report', { name, text }),
  notifyText: (title, body) => tauriInvoke('notify_text', { title, body }),
  historyRead: (from, to) => tauriInvoke('history_read', { from, to }),
  historyClear: () => tauriInvoke('history_clear'),
  answerApproval: (key, allow) => tauriInvoke('answer_approval', { key, allow }),
  listCharacters: () => tauriInvoke('list_characters'),
  setPetSkins: (bySession) => tauriInvoke('set_pet_skins', { bySession }),
  petSkins: () => tauriInvoke('pet_skins'),
  charactersChanged: async () => {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo('desk', 'characters-changed');
  },
  setTrayFrames: (frames) => tauriInvoke('set_tray_frames', { frames }),
  saveCharacter: (name, bytes) => tauriInvoke('save_character', { name, bytes }),
  replaceCharacter: (name, bytes) => tauriInvoke('replace_character', { name, bytes }),
  renameCharacter: (name, to) => tauriInvoke('rename_character', { name, to }),
  removeCharacter: (name) => tauriInvoke('remove_character', { name }),
  listSounds: () => tauriInvoke('list_sounds'),
  saveSound: (event, name, bytes) => tauriInvoke('save_sound', { event, name, bytes }),
  removeSound: (event) => tauriInvoke('remove_sound', { event }),
};

// ---------------------------------------------------------------- browser preview (design only)
function previewSnapshot(state: string): Snapshot {
  const now = Date.now();
  const s: Snapshot = {
    key: 'demo:preview', agent: 'demo', sessionId: 'preview', isDemo: true, project: 'cozy-project', cwd: '/demo/cozy-project',
    model: 'demo', permissionMode: null, state: 'idle', activity: null, tool: null, detail: null,
    startedAt: now - 754_000, startExact: true, turnStartedAt: now - 312_000, turnEndedAt: null, lastEventAt: now - 2000,
    connection: 'live', waiting: null, error: null, lastTest: null,
    plan: [
      { text: L('요구사항 읽기', 'Read the requirements'), status: 'completed' }, { text: L('UI 컴포넌트 수정', 'Update UI components'), status: 'completed' },
      { text: L('테스트 작성', 'Write tests'), status: 'in_progress' }, { text: L('빌드 확인', 'Check the build'), status: 'pending' },
    ],
    limits: { windows: [{ minutes: 300, usedPct: 38, resetsAt: now + 2.2 * 3_600_000 }, { minutes: 10080, usedPct: 22, resetsAt: now + 4.3 * 86_400_000 }], at: now },
    completedTurns: 2, toolCount: 37, filesEdited: ['Room.tsx', 'hud.css'], subagents: 0, origin: 'project', title: L('대시보드 다듬기', 'Polish the dashboard'),
  };
  const set = (p: Partial<Snapshot>) => Object.assign(s, p);
  switch (state) {
    case 'editing': set({ state: 'editing', activity: 'edit', tool: 'Edit', detail: 'Room.tsx' }); break;
    case 'reading': set({ state: 'reading', activity: 'read', tool: 'Read', detail: 'session.rs' }); break;
    case 'planning': set({ state: 'planning', activity: 'plan', tool: 'TodoWrite' }); break;
    case 'running': set({ state: 'running', activity: 'run', tool: 'Bash', detail: 'npm run build' }); break;
    case 'testing': set({ state: 'testing', activity: 'test', tool: 'Bash', detail: 'npm test' }); break;
    case 'testfail': set({ state: 'error', activity: 'test', tool: null, detail: 'npm test', lastTest: { ok: false, at: now, detail: 'npm test' }, error: { message: '2 tests failed', tool: 'Bash', at: now, fatal: false } }); break;
    case 'waiting': set({ state: 'waiting', tool: 'Bash', detail: 'npm run build', waiting: { kind: 'approval', tool: 'Bash', message: null, since: now - 8000 } }); break;
    case 'completed': set({ state: 'completed', turnEndedAt: now - 1000 }); break;
    case 'stale': set({ state: 'running', activity: 'run', tool: 'Bash', detail: 'npm run e2e', connection: 'stale', lastEventAt: now - 400_000 }); break;
    case 'none': break;
    default: set({ state: 'idle', turnStartedAt: null, plan: [] });
  }
  return s;
}

let previewSounds: SoundFile[] = [];

function previewBackend(): Backend {
  const params = new URLSearchParams(location.search);
  const state = params.get('preview') ?? 'cycle';
  const order = ['idle', 'editing', 'reading', 'planning', 'testing', 'testfail', 'waiting', 'completed', 'running', 'stale'];
  let listeners: ((u: Update) => void)[] = [];
  if (state === 'cycle') {
    let i = 0;
    setInterval(() => {
      i = (i + 1) % order.length;
      const snap = previewSnapshot(order[i]);
      listeners.forEach((l) => l({ snapshot: snap, appended: [], removed: false }));
    }, 9000);
  }
  // 'multi': several agents at once (browser design preview only)
  // Codex sessions in the preview report a tighter limit so both rows differ
  const cx: Snapshot['limits'] = { windows: [{ minutes: 300, usedPct: 84, resetsAt: Date.now() + 47 * 60_000 }, { minutes: 10080, usedPct: 51, resetsAt: Date.now() + 2.1 * 86_400_000 }], at: Date.now() };
  const multi = (): Snapshot[] => ([
    { ...previewSnapshot('editing'), key: 'p:claude1', agent: 'claude', isDemo: false, project: 'web-app', chatTitle: L('로그인 화면 다듬기', 'Polish the login screen') },
    { ...previewSnapshot('running'), key: 'p:codex1', agent: 'codex', limits: cx, isDemo: false, project: 'api-server' },
    { ...previewSnapshot('waiting'), key: 'p:claude2', agent: 'claude', isDemo: false, project: 'docs' },
    { ...previewSnapshot('testing'), key: 'p:claude3', agent: 'claude', isDemo: false, project: 'infra' },
    { ...previewSnapshot('completed'), key: 'p:codex2', agent: 'codex', limits: cx, isDemo: false, project: 'mobile' },
    { ...previewSnapshot('reading'), key: 'p:codex3', agent: 'codex', limits: cx, isDemo: false, project: 'web-app', chatTitle: L('결제 API 연결', 'Hook up the payment API'), plan: [] },
    // ?more=N: sessions past the six desks
    ...[...Array(Number(params.get('more') ?? 0)).keys()].map((i) => ({ ...previewSnapshot('idle'), key: `p:more${i}`, agent: 'claude' as const, isDemo: false, project: `extra-${i + 1}` })),
  ] as Snapshot[]).map((s) => ({ ...s, title: null })); // only the demo session plays a desktop-app session with a title
  // ?settings={"tagLook":"pixel"}: start the preview with some settings changed
  let settings: Settings = { ...DEFAULT_SETTINGS, theme: (params.get('theme') as Settings['theme']) ?? 'day', ...(JSON.parse(params.get('settings') ?? '{}') as Partial<Settings>) };
  setLang(settings.language); // the preview's made-up sessions below are written in it
  const first = state === 'none' ? [] : state === 'multi' ? multi() : [previewSnapshot(state === 'cycle' ? order[0] : state)];
  const now = Date.now();
  const tl: TimelineEntry[] = [
    { id: 1, at: now - 312_000, kind: 'turn_start', activity: null, tool: null, detail: null, ok: null },
    { id: 2, at: now - 300_000, kind: 'plan', activity: null, tool: null, detail: '0/4', ok: null },
    { id: 3, at: now - 280_000, kind: 'tool', activity: 'search', tool: 'Grep', detail: 'useSession', ok: null },
    { id: 4, at: now - 250_000, kind: 'tool', activity: 'edit', tool: 'Edit', detail: 'Room.tsx', ok: null },
    { id: 5, at: now - 120_000, kind: 'test', activity: 'test', tool: 'Bash', detail: 'npm test', ok: false },
    { id: 6, at: now - 60_000, kind: 'test', activity: 'test', tool: 'Bash', detail: 'npm test', ok: true },
  ];
  return {
    overview: async () => ({ sessions: first, detected: { claude: 0, codex: 0 }, serverError: null, demoRunning: false }),
    // each preview session gets its own made-up hour and a half so the activity lanes differ and can be scrolled back
    timeline: async (key) => {
      if (!key.startsWith('p:')) return tl;
      const seed = [...key].reduce((a, ch) => a + ch.charCodeAt(0), 0);
      const out: TimelineEntry[] = [];
      let t = now - 89 * 60_000 + (seed % 7) * 60_000;
      let id = 1;
      while (t < now - 60_000) {
        const work = (3 + ((seed + id) % 6)) * 60_000;
        if (t + work + 3 * 60_000 >= now) break;
        out.push({ id: id++, at: t, kind: 'turn_start', activity: null, tool: null, detail: null, ok: null });
        out.push({ id: id++, at: t + work / 3, kind: 'tool', activity: 'edit', tool: 'Edit', detail: 'App.tsx', ok: null });
        if ((seed + id) % 3 === 0) out.push({ id: id++, at: t + work / 2, kind: 'tool_fail', activity: 'run', tool: 'Bash', detail: 'npm run build', ok: false });
        if ((seed + id) % 4 === 1) { out.push({ id: id++, at: t + work, kind: 'approval', activity: null, tool: 'Bash', detail: null, ok: null }); t += 2 * 60_000; out.push({ id: id++, at: t + work, kind: 'tool', activity: 'run', tool: 'Bash', detail: 'npm test', ok: null }); }
        out.push({ id: id++, at: t + work + 60_000, kind: 'turn_complete', activity: null, tool: null, detail: null, ok: null });
        t += work + (2 + ((seed * id) % 5)) * 60_000;
      }
      // end in the state the preview card shows
      if (key === 'p:claude2') out.push({ id: id++, at: now - 9000, kind: 'approval', activity: null, tool: 'Bash', detail: null, ok: null });
      else if (key !== 'p:codex2') out.push({ id: id++, at: now - 50_000, kind: 'turn_start', activity: null, tool: null, detail: null, ok: null });
      return out;
    },
    onUpdate: async (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb); }; },
    onDetected: async () => () => {},
    onTrayEvent: async () => () => {},
    trayAction: async () => undefined,
    islandLayout: async () => undefined,
    notchSize: async () => null,
    setTzOffset: async () => {},
    setUiLang: async () => {},
    codexLimits: async () => null,
    claudeLimits: async () => null,
    setRoomOnly: async () => undefined,
    hooksStatus: async () => [
      { agent: 'claude', configPath: '~/.claude/settings.json', agentDetected: true, installed: 'none', hookBinaryPresent: false, notes: [], backups: [] },
      { agent: 'codex', configPath: '~/.codex/hooks.json', agentDetected: false, installed: 'none', hookBinaryPresent: false, notes: [], backups: [] },
    ],
    hooksInstall: async () => { throw new Error(L('브라우저 미리보기에서는 설치할 수 없습니다', "Can't install from the browser preview")); },
    hooksUninstall: async () => { throw new Error(L('브라우저 미리보기', 'Browser preview')); },
    hooksRestore: async () => { throw new Error(L('브라우저 미리보기', 'Browser preview')); },
    hooksRemoveAll: async () => undefined,
    demoStart: async () => undefined,
    demoStop: async () => undefined,
    removeSession: async () => undefined,
    focusAgent: async () => undefined,
    doubleClickMs: async () => 500,
    // a made-up month for the design preview (never real data)
    usageHistory: async (days) => {
      const today = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);
      const wave = (i: number, k: number) => Math.max(0, Math.round((Math.sin(i * k) + 0.6) * 4e7 * (i % 7 === 3 ? 0 : 1)));
      return {
        days: Array.from({ length: days }, (_, i) => ({ day: today - days + 1 + i, claude: wave(i, 0.45) * (i > days - 12 ? 3 : 1), codex: Math.round(wave(i + 3, 0.7) / 3) })),
        recentClaude: 1_300_000, recentCodex: 240_000, streakLongest: 6, streakCurrent: 5,
      };
    },
    openMemoryFile: async () => undefined,
    memoryFiles: async () => [
      { label: L('전역 · Claude Code', 'Global · Claude Code'), path: '~/.claude/CLAUDE.md', truncated: false, content: L('# 미리보기용 예시\n\n## 말투\n\n- 한국어로 답하기\n- 결론부터 말하기\n\n## 커밋\n\n- 커밋은 작게 나누지 말 것\n- 커밋 메시지는 영어로\n\n## 테스트\n\n- 고친 뒤 테스트를 꼭 돌리기\n', '# Preview example\n\n## Tone\n\n- Answer in English\n- Lead with the answer\n\n## Commits\n\n- Keep commits coarse\n- Write commit messages in English\n\n## Tests\n\n- Always run the tests after a change\n') },
      { label: 'cozy-project · AGENTS.md', path: '/demo/cozy-project/AGENTS.md', truncated: false, content: L('# cozy-project\n\n테스트는 `npm test`로 돌립니다.\n', '# cozy-project\n\nRun the tests with `npm test`.\n') },
    ],
    getSettings: async () => settings,
    saveSettings: async (s) => { settings = s; },
    dataDir: async () => '~/.agent-room',
    saveReport: async (name, text) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      return `${L('다운로드', 'Downloads')}/${name}`;
    },
    notifyText: async () => undefined,
    historyRead: async (from, to) => tl.map((entry) => ({ key: 'demo:preview', agent: 'demo', project: 'cozy-project', entry: { ...entry, at: from + (entry.at % 86_400_000) } })).filter((l) => l.entry.at < to),
    historyClear: async () => undefined,
    answerApproval: async () => { throw new Error(L('브라우저 미리보기에서는 승인할 수 없어요', "Can't approve from the browser preview")); },
    // design previews can inject test images; the preview never reads the disk
    listCharacters: async () => (window as { __previewCharacters?: CharacterFile[] }).__previewCharacters ?? [],
    setTrayFrames: async () => {},
    setPetSkins: async () => {},
    petSkins: async () => ({}),
    charactersChanged: async () => {},
    saveCharacter: async (name, bytes) => {
      const w = window as { __previewCharacters?: CharacterFile[] };
      const stem = name.replace(/\.png$/i, '');
      (w.__previewCharacters ??= []).push({ name: stem, bytes });
      return stem;
    },
    replaceCharacter: async (name, bytes) => {
      const c = (window as { __previewCharacters?: CharacterFile[] }).__previewCharacters?.find((x) => x.name === name);
      if (c) c.bytes = bytes;
    },
    renameCharacter: async (name, to) => {
      const c = (window as { __previewCharacters?: CharacterFile[] }).__previewCharacters?.find((x) => x.name === name);
      if (c) c.name = to;
      return to;
    },
    removeCharacter: async (name) => {
      const w = window as { __previewCharacters?: CharacterFile[] };
      w.__previewCharacters = (w.__previewCharacters ?? []).filter((x) => x.name !== name);
    },
    // sounds live in memory only in the browser preview
    listSounds: async () => previewSounds,
    saveSound: async (event, _name, bytes) => { previewSounds = [...previewSounds.filter((x) => x.event !== event), { event, bytes }]; },
    removeSound: async (event) => { previewSounds = previewSounds.filter((x) => x.event !== event); },
  };
}

export const backend: Backend = IN_TAURI ? tauriBackend : previewBackend();

// ---------------------------------------------------------------- window controls (no-ops in preview)
export async function win() {
  if (!IN_TAURI) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function setAutostart(on: boolean): Promise<boolean> {
  if (!IN_TAURI) return false;
  const m = await import('@tauri-apps/plugin-autostart');
  if (on) await m.enable();
  else await m.disable();
  return m.isEnabled();
}

export async function autostartEnabled(): Promise<boolean> {
  if (!IN_TAURI) return false;
  const m = await import('@tauri-apps/plugin-autostart');
  return m.isEnabled();
}

/** window content sizes offered by ⌘+ / ⌘− and Settings */
export const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

// ---------------------------------------------------------------- in-app updates (GitHub Releases, signed)
export interface AppUpdate { version: string; current: string; notes?: string; install: (onProgress: (pct: number) => void) => Promise<void> }

/** null when up to date (or in the browser preview); throws when the check itself fails (offline etc.) */
export async function checkUpdate(): Promise<AppUpdate | null> {
  if (!IN_TAURI) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    version: u.version,
    current: u.currentVersion,
    notes: u.body ?? undefined,
    install: async (onProgress) => {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        if (e.event === 'Progress') got += e.data.chunkLength;
        if (total) onProgress(Math.min(100, Math.round((got / total) * 100)));
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

export async function appVersion(): Promise<string> {
  if (!IN_TAURI) return 'preview';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
