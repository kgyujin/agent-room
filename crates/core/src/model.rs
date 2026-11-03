//! Common event model shared by every agent adapter.
//!
//! Adapters translate an agent's own hook payloads into [`NormEvent`]s. The session
//! reducer only ever sees this model, so adding an agent never touches the reducer or UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
    Demo,
}

impl AgentKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "demo" => Some(Self::Demo),
            _ => None,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Demo => "demo",
        }
    }
}

/// The common states the room can show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Idle,
    Starting,
    Planning,
    Reading,
    Editing,
    Running,
    Testing,
    Waiting,
    Completed,
    Error,
    Disconnected,
}

/// What a tool call is doing, decided by fixed rules on the tool name / command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    /// model is generating between tool calls (no detail is known)
    Think,
    Plan,
    Search,
    Read,
    Web,
    Edit,
    Run,
    Test,
    Delegate,
    Ask,
    Other,
}

impl Activity {
    pub fn state(self) -> AgentState {
        match self {
            Activity::Think | Activity::Plan => AgentState::Planning,
            Activity::Search | Activity::Read | Activity::Web => AgentState::Reading,
            Activity::Edit => AgentState::Editing,
            Activity::Test => AgentState::Testing,
            Activity::Ask => AgentState::Waiting,
            Activity::Run | Activity::Delegate | Activity::Other => AgentState::Running,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub text: String,
    /// "pending" | "in_progress" | "completed"
    pub status: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// where the numbers come from, e.g. "claude-transcript" / "codex-rollout"
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EvKind {
    SessionStart { source: Option<String> },
    SessionEnd { reason: Option<String> },
    PromptSubmitted,
    ToolStart { tool: String, activity: Activity, detail: Option<String> },
    ToolEnd { tool: String, activity: Activity, ok: Option<bool>, error: Option<String> },
    PermissionRequest { tool: Option<String>, detail: Option<String> },
    NeedsInput { message: Option<String> },
    TurnComplete,
    TurnFailed { error: String },
    Interrupted,
    Compacting,
    SubagentStart { agent_type: Option<String> },
    SubagentStop { agent_type: Option<String> },
    /// whole explicit task list (Claude TodoWrite, Codex update_plan)
    Plan { items: Vec<PlanItem> },
    /// one task of an explicit task list (Claude Task* tools / TaskCreated / TaskCompleted hooks)
    TaskUpdate { id: String, text: Option<String>, status: Option<String> },
    Tokens { usage: TokenUsage },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormEvent {
    pub agent: AgentKind,
    pub session_id: String,
    /// unix ms
    pub ts: u64,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub transcript_path: Option<String>,
    pub permission_mode: Option<String>,
    pub kind: EvKind,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
