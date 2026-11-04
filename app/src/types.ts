// Mirrors agent-room-core's serialized structs (camelCase).
export type AgentKind = 'claude' | 'codex' | 'demo';
export type AgentState =
  | 'idle' | 'starting' | 'planning' | 'reading' | 'editing' | 'running'
  | 'testing' | 'waiting' | 'completed' | 'error' | 'disconnected';
export type Activity = 'think' | 'plan' | 'search' | 'read' | 'web' | 'edit' | 'run' | 'test' | 'delegate' | 'ask' | 'other';
export type Connection = 'live' | 'stale' | 'ended' | 'lost';

export interface PlanItem { text: string; status: string }
export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number; source: string }

export interface Snapshot {
  key: string;
  agent: AgentKind;
  sessionId: string;
  isDemo: boolean;
  project: string | null;
  cwd: string | null;
  model: string | null;
  permissionMode: string | null;
  state: AgentState;
  activity: Activity | null;
  tool: string | null;
  detail: string | null;
  startedAt: number;
  startExact: boolean;
  turnStartedAt: number | null;
  turnEndedAt: number | null;
  lastEventAt: number;
  connection: Connection;
  waiting: { kind: 'approval' | 'input'; tool: string | null; message: string | null; since: number } | null;
  error: { message: string; tool: string | null; at: number; fatal: boolean } | null;
  lastTest: { ok: boolean | null; at: number; detail: string | null } | null;
  plan: PlanItem[];
  tokens: TokenUsage | null;
  completedTurns: number;
  toolCount: number;
  filesEdited: string[];
  subagents: number;
}

export interface TimelineEntry {
  id: number;
  at: number;
  kind: string;
  activity: Activity | null;
  tool: string | null;
  detail: string | null;
  ok: boolean | null;
}

export interface Update { snapshot: Snapshot; appended: TimelineEntry[]; removed: boolean }

export interface HookStatus {
  agent: 'claude' | 'codex';
  configPath: string;
  agentDetected: boolean;
  installed: 'none' | 'partial' | 'full';
  hookBinaryPresent: boolean;
  notes: string[];
  backups: string[];
}

export interface Settings {
  theme: 'day' | 'sunset' | 'night' | 'auto';
  sfx: boolean;
  bgm: boolean;
  notifyComplete: boolean;
  notifyApproval: boolean;
  notifyOnlyWhenHidden: boolean;
  staleMinutes: number;
  panelOpen: boolean;
  alwaysOnTop: boolean;
  showTokens: boolean;
  /** agent ('claude' | 'codex' | 'generic') -> custom character name; missing = built-in */
  characters: Record<string, string>;
}

export interface CharacterFile { name: string; bytes: number[] }

export interface Overview {
  sessions: Snapshot[];
  detected: { claude: number; codex: number };
  serverError: string | null;
  demoRunning: boolean;
}
