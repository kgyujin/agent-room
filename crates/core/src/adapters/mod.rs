//! Agent adapters: sanitized hook payload -> common [`NormEvent`]s.
//!
//! Every rule here is a fixed table / string match. Nothing is inferred by a model.
//! To support a new agent (Cursor, Gemini CLI, OpenCode, ...), add a module with a
//! `normalize` function and register it in [`normalize`].

pub mod claude;
pub mod codex;

use crate::model::{Activity, AgentKind, NormEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One line sent by `agent-room-hook` over the local socket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub agent: String,
    pub ts: u64,
    /// parent pid of the hook process (used only to check if the agent is still alive)
    pub ppid: Option<u32>,
    pub event: Value,
    /// the Claude desktop app's own id for a Code-tab session (`CLAUDE_CODE_HOST_SESSION_ID`),
    /// the only id its link to that session accepts
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_session: Option<String>,
}

pub fn normalize(env: &Envelope) -> Vec<NormEvent> {
    match AgentKind::parse(&env.agent) {
        Some(AgentKind::Claude) => claude::normalize(env.ts, &env.event),
        Some(AgentKind::Codex) => codex::normalize(env.ts, &env.event),
        _ => Vec::new(),
    }
}

pub(crate) fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

pub(crate) fn base_event(agent: AgentKind, ts: u64, ev: &Value, kind: crate::model::EvKind) -> Option<NormEvent> {
    let session_id = s(ev, "session_id")?.to_string();
    Some(NormEvent {
        agent,
        session_id,
        ts,
        cwd: s(ev, "cwd").map(String::from),
        model: s(ev, "model").map(String::from),
        transcript_path: s(ev, "transcript_path").map(String::from),
        permission_mode: s(ev, "permission_mode").map(String::from),
        kind,
    })
}

pub fn basename(p: &str) -> String {
    p.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

const TEST_RUNNERS: &[&str] = &[
    "pytest", "py.test", "jest", "vitest", "mocha", "rspec", "phpunit", "ctest", "tox", "nox", "karma", "ava", "tap",
];
const TEST_SUBCOMMANDS: &[(&str, &str)] = &[
    ("npm", "test"), ("pnpm", "test"), ("yarn", "test"), ("bun", "test"), ("cargo", "test"), ("cargo", "nextest"),
    ("go", "test"), ("mvn", "test"), ("gradle", "test"), ("./gradlew", "test"), ("dotnet", "test"), ("swift", "test"),
    ("xcodebuild", "test"), ("make", "test"), ("make", "check"), ("deno", "test"), ("mix", "test"), ("flutter", "test"),
    ("playwright", "test"), ("npx", "jest"), ("npx", "vitest"), ("npx", "playwright"), ("bunx", "vitest"), ("rake", "test"),
];

/// MCP servers that work the user's own screen: their tools read or click in the apps the user has open
const DESKTOP_SERVERS: &[&str] = &["agent-desktop", "computer-use", "computer_use", "claude-in-chrome"];

/// What an MCP tool does, from its server's name (`mcp__<server>__<tool>`), with "server/tool" as detail.
pub fn mcp_activity(tool: &str) -> (Activity, Option<String>) {
    let mut parts = tool.trim_start_matches("mcp__").splitn(2, "__");
    let server = parts.next().unwrap_or("");
    let name = parts.next().unwrap_or("");
    let lower = server.to_ascii_lowercase();
    let act = if DESKTOP_SERVERS.iter().any(|d| lower.contains(d)) { Activity::Desktop } else { Activity::Other };
    (act, Some(format!("{server}/{name}")))
}

/// Decides whether a shell command is a test run or works the screen (agent-desktop), by fixed rules.
pub fn classify_command(cmd: &str) -> Activity {
    let lower = cmd.to_ascii_lowercase();
    for seg in lower.split(['&', ';', '|', '\n']) {
        let toks: Vec<&str> = seg.split_whitespace().filter(|t| !t.contains('=')).collect();
        if toks.is_empty() {
            continue;
        }
        let prog = basename(toks[0]);
        let prog = prog.as_str();
        // agent-desktop reads and operates the apps on this screen, run directly or through npx/bunx
        if prog == "agent-desktop" || (["npx", "bunx", "pnpx"].contains(&prog) && toks.get(1).is_some_and(|t| basename(t) == "agent-desktop")) {
            return Activity::Desktop;
        }
        if TEST_RUNNERS.contains(&prog) {
            return Activity::Test;
        }
        if (prog == "python" || prog == "python3") && toks.windows(2).any(|w| w[0] == "-m" && (w[1] == "pytest" || w[1] == "unittest")) {
            return Activity::Test;
        }
        let sub = toks.iter().skip(1).find(|t| !t.starts_with('-')).copied().unwrap_or("");
        let sub2 = toks.get(2).copied().unwrap_or("");
        for (p, s) in TEST_SUBCOMMANDS {
            if prog == basename(p) && (sub == *s || (sub == "run" && sub2.starts_with(s))) {
                return Activity::Test;
            }
        }
    }
    Activity::Run
}

/// Short, display-safe summary of a command: the first segment's program + subcommand.
pub fn command_summary(cmd: &str) -> String {
    let first = cmd.split(['&', ';', '|', '\n']).map(str::trim).find(|s| !s.is_empty()).unwrap_or("");
    let toks: Vec<&str> = first.split_whitespace().filter(|t| !t.contains('=')).take(3).collect();
    let mut out = toks.join(" ");
    if out.chars().count() > 48 {
        out = out.chars().take(48).collect::<String>() + "…";
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_work_is_its_own_activity() {
        assert_eq!(classify_command("agent-desktop click @s8f3k2p9:e8"), Activity::Desktop);
        assert_eq!(classify_command("cd x && npx agent-desktop snapshot --app Finder -i"), Activity::Desktop);
        assert_eq!(classify_command("/opt/homebrew/bin/agent-desktop type @s1:e2 --stdin"), Activity::Desktop);
        assert_eq!(classify_command("npx vitest"), Activity::Test);
        assert_eq!(classify_command("echo agent-desktop"), Activity::Run);
        assert_eq!(mcp_activity("mcp__agent-desktop__desktop_click"), (Activity::Desktop, Some("agent-desktop/desktop_click".into())));
        assert_eq!(mcp_activity("mcp__claude-in-chrome__navigate").0, Activity::Desktop);
        assert_eq!(mcp_activity("mcp__github__create_pull_request").0, Activity::Other);
    }

    #[test]
    fn test_commands_are_detected() {
        for c in ["npm test", "pnpm run test:unit", "cargo test -p core", "cd app && npx vitest run", "python -m pytest -q", "CI=1 go test ./...", "/usr/bin/pytest x"] {
            assert_eq!(classify_command(c), Activity::Test, "{c}");
        }
        for c in ["npm run build", "ls -la", "cargo build", "git status", "echo test"] {
            assert_eq!(classify_command(c), Activity::Run, "{c}");
        }
    }

    #[test]
    fn summary_is_short() {
        assert_eq!(command_summary("FOO=1 npm run build --verbose && echo ok"), "npm run build");
    }
}
