// Mirrors agent-room-core's serialized structs (camelCase).
export type AgentKind = 'claude' | 'codex' | 'demo';
export type AgentState =
  | 'idle' | 'starting' | 'planning' | 'reading' | 'editing' | 'running'
  | 'testing' | 'waiting' | 'completed' | 'error' | 'disconnected';
export type Activity = 'think' | 'plan' | 'search' | 'read' | 'web' | 'edit' | 'run' | 'test' | 'delegate' | 'ask' | 'desktop' | 'other';
export type Connection = 'live' | 'stale' | 'ended' | 'lost';

export interface PlanItem { text: string; status: string }
/** one plan usage window as the agent reports it (minutes: 300 = 5 hours, 10080 = 7 days) */
export interface LimitWindow { minutes: number; usedPct: number; resetsAt: number | null }
export interface RateLimits { windows: LimitWindow[]; at: number }

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
  limits: RateLimits | null;
  completedTurns: number;
  toolCount: number;
  filesEdited: string[];
  subagents: number;
  /** where a Claude session was started from, from the desktop app's records */
  origin?: 'desktop' | 'remote' | 'project' | null;
  /** the desktop app's title for the session */
  title?: string | null;
  /** the session's name from its own transcript: the name it was given, its summary, or the first ask */
  chatTitle?: string | null;
  /** a permission request can be answered in Agent Room until this time */
  approveUntil?: number | null;
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
  notifyLimits: boolean;
  notifyOnlyWhenHidden: boolean;
  staleMinutes: number;
  panelOpen: boolean;
  alwaysOnTop: boolean;
  /** always-on-top while in room-only mode (separate from the normal window) */
  alwaysOnTopRoom: boolean;
  showLimits: boolean;
  /** agent ('claude' | 'codex' | 'generic') -> custom character name; missing = built-in */
  /** pets that may appear (skin ids: builtin/<id> or a PNG name); empty means all built-ins */
  petPool: string[];
  /** pet drawn in the menu bar icon (`builtin/<id>` or a PNG name) */
  trayPet: string;
  /** built-in critter id -> fur colour (hex) */
  critterColors: Record<string, string>;
  /** UI colour theme id (see themes.ts) */
  uiTheme: string;
  /** status pill at the top centre of the screen */
  island: boolean;
  /** 'mixed' = readable UI font with pixel numbers/titles, 'system', 'pixel' */
  font: 'mixed' | 'system' | 'pixel';
  /** '' = theme backdrop, a BACKDROPS id, or '#rrggbb' */
  backdrop: string;
  /** 'hover': only the pointed, picked or waiting pet shows its tag (the head icons still show) */
  tagStyle: 'compact' | 'full' | 'hover' | 'off';
  /** name tag outline: rounded or a pixel frame with cut corners */
  tagLook?: 'soft' | 'pixel';
  showDock: boolean;
  showTabs: boolean;
  /** how much idle pets move around */
  petEnergy: 'calm' | 'normal' | 'lively';
  /** the island opens when the pointer is over it, or only on click */
  islandOpen: 'hover' | 'click';
  /** seconds a finished turn still shows as "완료" (0 = until the next turn) */
  doneShownSec: number;
  /** name tags of idle pets */
  idleTags: 'dim' | 'hide' | 'show';
  /** little icons over the pets' heads */
  petBubbles: boolean;
  /** hide the island while nothing is going on */
  islandHideIdle: boolean;
  /** lowest remaining usage on the closed island */
  islandUsage: boolean;
  /** which display holds the island: the one with the notch (else the menu bar's), the menu bar's, or the pointer's */
  islandScreen: 'auto' | 'main' | 'pointer';
  /** look for a new version at launch and every few hours, and ask before installing */
  autoUpdateCheck: boolean;
  /** size of the main window's contents, 1 = 100% (⌘+ / ⌘− / ⌘0) */
  uiZoom: number;
  claudeAccountLimits?: boolean;
  /** start claude briefly in the background to renew an expired login */
  claudeCliRefresh?: boolean;
  /** token counts as 12.4K / 340M ('si') or 1.2만 / 3.4억 ('ko') */
  tokenUnit?: 'si' | 'ko';
  /** dashboard cards turned off, by id (see DASH_CARDS) */
  dashHidden?: string[];
  /** one notification with the day's numbers after this local hour */
  dailySummary?: boolean;
  dailySummaryHour?: number;
  /** estimated API cost (USD per million tokens, blended); hidden by default, since plans are flat-rate */
  showCost?: boolean;
  costClaudePerM?: number;
  costCodexPerM?: number;
  /** days of timeline kept on this computer, 0 = only in memory */
  historyDays?: number;
  /** answer Claude Code permission requests in Agent Room; Claude Code waits this long for the answer */
  approveInApp?: boolean;
  approveWaitSec?: number;
  /** no notifications between these local hours */
  quietHours?: boolean;
  quietFrom?: number;
  quietTo?: number;
  /** notify once more after a request has waited this many minutes (0 = never) */
  renotifyMin?: number;
  /** the island opens for a moment when a session starts waiting on the user */
  islandPeek?: boolean;
  /** UI language; 'auto' follows the system */
  language?: 'auto' | 'ko' | 'en';
  /** the session pets also walk along the bottom of the screen, outside the room */
  desktopPets?: boolean;
  /** screen px per art px of the desktop pets (2 small, 3 medium, 4 large) */
  desktopPetSize?: number;
  /** "작업 완료" notifications only for turns at least this long (seconds, 0 = all) */
  notifyMinTurnSec: number;
}

export interface CharacterFile { name: string; bytes: number[] }

export interface Overview {
  sessions: Snapshot[];
  detected: { claude: number; codex: number };
  serverError: string | null;
  demoRunning: boolean;
}

export interface SoundFile { event: string; bytes: number[] }

export interface DayTokens { day: number; claude: number; codex: number }
/** token use from the agents' local logs (usage counters only) */
export interface UsageHistory { days: DayTokens[]; recentClaude: number; recentCodex: number; streakLongest: number; streakCurrent: number }

export interface MemoryFile { label: string; path: string; content: string; truncated: boolean }

/** a timeline entry kept on disk, with the session it came from */
export interface HistLine { key: string; agent: string; project: string | null; entry: TimelineEntry }
