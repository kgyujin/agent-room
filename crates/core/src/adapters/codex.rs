//! OpenAI Codex CLI hooks -> common events.
//! Reference: https://developers.openai.com/codex/hooks

use super::{base_event, basename, classify_command, command_summary, mcp_activity, s};
use crate::model::{Activity, AgentKind, EvKind, NormEvent, PlanItem};
use serde_json::Value;

/// Hook events Agent Room registers in `~/.codex/hooks.json`.
pub const HOOK_EVENTS: &[&str] = &[
    "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop",
    "Interrupt", "PreCompact", "SubagentStart", "SubagentStop", "PostModelRequest",
];

pub fn tool_activity(tool: &str, input: &Value) -> (Activity, Option<String>) {
    let files = || {
        input.get("files").and_then(|f| f.as_array()).and_then(|a| a.first()).and_then(|x| x.as_str()).map(basename)
    };
    match tool {
        "Bash" | "shell" | "local_shell" | "exec_command" | "container.exec" | "unified_exec" => {
            let cmd = s(input, "command").unwrap_or("");
            if let Some(f) = files() {
                return (Activity::Edit, Some(f)); // apply_patch invoked through the shell
            }
            (classify_command(cmd), Some(command_summary(cmd)).filter(|x| !x.is_empty()))
        }
        "apply_patch" | "Edit" | "Write" => (Activity::Edit, files().or_else(|| s(input, "file_path").map(basename))),
        "update_plan" => (Activity::Plan, None),
        "web_search" | "web_fetch" => (Activity::Web, None),
        "view_image" | "read_file" => (Activity::Read, s(input, "path").map(basename)),
        "list_dir" | "grep_files" | "glob" | "search" => (Activity::Search, s(input, "pattern").map(String::from)),
        "spawn_agent" | "send_input" | "wait" => (Activity::Delegate, None),
        "request_user_input" => (Activity::Ask, None),
        t if t.starts_with("mcp__") => mcp_activity(t),
        _ => (Activity::Other, None),
    }
}

pub fn normalize(ts: u64, ev: &Value) -> Vec<NormEvent> {
    let name = s(ev, "hook_event_name").unwrap_or("");
    let tool = s(ev, "tool_name").unwrap_or("").to_string();
    let empty = Value::Null;
    let input = ev.get("tool_input").unwrap_or(&empty);
    let mk = |kind| base_event(AgentKind::Codex, ts, ev, kind);
    let mut out: Vec<Option<NormEvent>> = Vec::new();
    match name {
        "SessionStart" => out.push(mk(EvKind::SessionStart { source: s(ev, "source").map(String::from) })),
        "SessionEnd" => out.push(mk(EvKind::SessionEnd { reason: s(ev, "reason").map(String::from) })),
        "UserPromptSubmit" => out.push(mk(EvKind::PromptSubmitted)),
        "PreToolUse" => {
            let (activity, detail) = tool_activity(&tool, input);
            out.push(mk(EvKind::ToolStart { tool: tool.clone(), activity, detail }));
            if let Some(Value::Array(todos)) = input.get("todos") {
                let items = todos
                    .iter()
                    .map(|t| PlanItem { text: s(t, "text").unwrap_or("").to_string(), status: s(t, "status").unwrap_or("pending").to_string() })
                    .collect();
                out.push(mk(EvKind::Plan { items }));
            }
        }
        "PostToolUse" => {
            let (activity, _) = tool_activity(&tool, input);
            // Codex reports no failure event; only trust an explicit exit code / success flag.
            let ok = ev
                .pointer("/tool_response/exit_code")
                .and_then(|x| x.as_i64())
                .map(|c| c == 0)
                .or_else(|| ev.pointer("/tool_response/success").and_then(|x| x.as_bool()));
            out.push(mk(EvKind::ToolEnd { tool, activity, ok, error: None }));
        }
        "PermissionRequest" => {
            let (_, detail) = tool_activity(&tool, input);
            out.push(mk(EvKind::PermissionRequest {
                tool: Some(tool).filter(|t| !t.is_empty()),
                detail: detail.or_else(|| s(input, "description").map(String::from)),
            }));
        }
        "Stop" => out.push(mk(EvKind::TurnComplete)),
        "Interrupt" => out.push(mk(EvKind::Interrupted)),
        "PreCompact" => out.push(mk(EvKind::Compacting)),
        "SubagentStart" => out.push(mk(EvKind::SubagentStart { agent_type: s(ev, "agent_type").map(String::from) })),
        "SubagentStop" => out.push(mk(EvKind::SubagentStop { agent_type: s(ev, "agent_type").map(String::from) })),
        "PostModelRequest" => {
            if s(ev, "status") == Some("failed") {
                out.push(mk(EvKind::TurnFailed { error: s(ev, "error").unwrap_or("model request failed").to_string() }));
            }
        }
        _ => {}
    }
    out.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sanitize::sanitize;
    use serde_json::json;

    #[test]
    fn apply_patch_is_editing() {
        let raw = json!({"session_id":"c","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: src/lib.rs\n@@\n*** End Patch"}});
        let e = normalize(1, &sanitize(&raw));
        assert_eq!(e[0].kind, EvKind::ToolStart { tool: "apply_patch".into(), activity: Activity::Edit, detail: Some("lib.rs".into()) });
    }

    #[test]
    fn unknown_test_result_stays_unknown() {
        let raw = json!({"session_id":"c","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"cargo test"},"tool_response":"some output"});
        let e = normalize(1, &sanitize(&raw));
        assert!(matches!(&e[0].kind, EvKind::ToolEnd { activity: Activity::Test, ok: None, .. }));
    }

    #[test]
    fn update_plan_gives_plan() {
        let raw = json!({"session_id":"c","hook_event_name":"PreToolUse","tool_name":"update_plan","tool_input":{"plan":[{"step":"a","status":"completed"},{"step":"b","status":"pending"}]}});
        let e = normalize(1, &sanitize(&raw));
        assert!(matches!(&e[1].kind, EvKind::Plan { items } if items.len() == 2));
    }
}
