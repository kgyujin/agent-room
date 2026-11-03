// Thin layer over Tauri IPC. Outside Tauri (plain browser, used only for design
// previews), a static preview backend is used and the UI labels itself as a preview.
import type { HookStatus, Overview, Settings, Snapshot, TimelineEntry, Update } from './types';

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
  theme: 'day', sfx: true, bgm: false, notifyComplete: true, notifyApproval: true, notifyOnlyWhenHidden: true,
  staleMinutes: 3, panelOpen: true, alwaysOnTop: false, showTokens: true,
};

export interface Backend {
  overview(): Promise<Overview>;
  timeline(key: string): Promise<TimelineEntry[]>;
  onUpdate(cb: (u: Update) => void): Promise<Unlisten>;
  onDetected(cb: (d: Overview['detected']) => void): Promise<Unlisten>;
  onTrayEvent(name: 'set-mini' | 'select-session', cb: (payload: unknown) => void): Promise<Unlisten>;
  hooksStatus(): Promise<HookStatus[]>;
  hooksInstall(agent: string): Promise<HookStatus>;
  hooksUninstall(agent: string): Promise<HookStatus>;
  hooksRestore(agent: string): Promise<string>;
  hooksRemoveAll(): Promise<unknown>;
  demoStart(): Promise<void>;
  demoStop(): Promise<void>;
  removeSession(key: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  dataDir(): Promise<string>;
}

const tauriBackend: Backend = {
  overview: () => tauriInvoke('get_overview'),
  timeline: (key) => tauriInvoke('get_timeline', { key }),
  onUpdate: (cb) => tauriListen('session-update', cb),
  onDetected: (cb) => tauriListen('agents-detected', cb),
  onTrayEvent: (name, cb) => tauriListen(name, cb),
  hooksStatus: () => tauriInvoke('hooks_status'),
  hooksInstall: (agent) => tauriInvoke('hooks_install', { agent }),
  hooksUninstall: (agent) => tauriInvoke('hooks_uninstall', { agent }),
  hooksRestore: (agent) => tauriInvoke('hooks_restore', { agent }),
  hooksRemoveAll: () => tauriInvoke('hooks_remove_all'),
  demoStart: () => tauriInvoke('demo_start'),
  demoStop: () => tauriInvoke('demo_stop'),
  removeSession: (key) => tauriInvoke('remove_session', { key }),
  getSettings: () => tauriInvoke('get_settings'),
  saveSettings: (settings) => tauriInvoke('save_settings', { settings }),
  dataDir: () => tauriInvoke('data_dir'),
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
      { text: '요구사항 읽기', status: 'completed' }, { text: 'UI 컴포넌트 수정', status: 'completed' },
      { text: '테스트 작성', status: 'in_progress' }, { text: '빌드 확인', status: 'pending' },
    ],
    tokens: { input: 18240, output: 6310, cacheRead: 152000, cacheWrite: 9800, source: 'demo' },
    completedTurns: 2, toolCount: 37, filesEdited: ['Room.tsx', 'hud.css'], subagents: 0,
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
  const first = state === 'none' ? [] : [previewSnapshot(state === 'cycle' ? order[0] : state)];
  let settings = { ...DEFAULT_SETTINGS, theme: (params.get('theme') as Settings['theme']) ?? 'day' };
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
    timeline: async () => tl,
    onUpdate: async (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb); }; },
    onDetected: async () => () => {},
    onTrayEvent: async () => () => {},
    hooksStatus: async () => [
      { agent: 'claude', configPath: '~/.claude/settings.json', agentDetected: true, installed: 'none', hookBinaryPresent: false, notes: [], backups: [] },
      { agent: 'codex', configPath: '~/.codex/hooks.json', agentDetected: false, installed: 'none', hookBinaryPresent: false, notes: [], backups: [] },
    ],
    hooksInstall: async () => { throw new Error('브라우저 미리보기에서는 설치할 수 없습니다'); },
    hooksUninstall: async () => { throw new Error('브라우저 미리보기'); },
    hooksRestore: async () => { throw new Error('브라우저 미리보기'); },
    hooksRemoveAll: async () => undefined,
    demoStart: async () => undefined,
    demoStop: async () => undefined,
    removeSession: async () => undefined,
    getSettings: async () => settings,
    saveSettings: async (s) => { settings = s; },
    dataDir: async () => '~/.agent-room',
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
