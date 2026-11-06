//! Claude Code hooks -> common events.
//! Reference: https://code.claude.com/docs/en/hooks

use super::{base_event, basename, classify_command, command_summary, mcp_activity, s};
use crate::model::{Activity, AgentKind, EvKind, NormEvent, PlanItem};
use serde_json::Value;

/// Hook events Agent Room registers in `~/.claude/settings.json`.
pub const HOOK_EVENTS: &[&str] = &[
    "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "PermissionRequest", "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "PreCompact",
    "TaskCreated", "TaskCompleted",
];

pub fn tool_activity(tool: &str, input: &Value) -> (Activity, Option<String>) {
    let file = || {
        s(input, "file_path").or_else(|| s(input, "notebook_path")).or_else(|| s(input, "path")).map(basename)
    };
    match tool {
        "Read" | "NotebookRead" => (Activity::Read, file()),
        "Glob" | "Grep" | "LS" | "ToolSearch" => (Activity::Search, s(input, "pattern").map(String::from).or_else(file)),
        "WebFetch" => (Activity::Web, s(input, "host").map(String::from)),
        "WebSearch" => (Activity::Web, None),
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => (Activity::Edit, file()),
        "Bash" | "PowerShell" => {
            let cmd = s(input, "command").unwrap_or("");
            (classify_command(cmd), Some(command_summary(cmd)).filter(|x| !x.is_empty()))
        }
        "BashOutput" | "KillShell" | "KillBash" | "Monitor" => (Activity::Run, None),
        "TodoWrite" | "TaskCreate" | "TaskUpdate" | "TaskList" | "TaskGet" | "EnterPlanMode" | "ExitPlanMode" => (Activity::Plan, None),
        "Task" | "Agent" => (Activity::Delegate, s(input, "subagent_type").or_else(|| s(input, "description")).map(String::from)),
        "AskUserQuestion" => (Activity::Ask, None),
        t if t.starts_with("mcp__") => mcp_activity(t),
        _ => (Activity::Other, None),
    }
}

pub fn normalize(ts: u64, ev: &Value) -> Vec<NormEvent> {
    let name = s(ev, "hook_event_name").unwrap_or("");
    let tool = s(ev, "tool_name").unwrap_or("").to_string();
    let empty = Value::Null;
    let input = ev.get("tool_input").unwrap_or(&empty);
    let mk = |kind| base_event(AgentKind::Claude, ts, ev, kind);
    let mut out: Vec<Option<NormEvent>> = Vec::new();
    match name {
        "SessionStart" => out.push(mk(EvKind::SessionStart { source: s(ev, "source").map(String::from) })),
        "SessionEnd" => out.push(mk(EvKind::SessionEnd { reason: s(ev, "reason").map(String::from) })),
        "UserPromptSubmit" => out.push(mk(EvKind::PromptSubmitted)),
        // sent by `agent-room-hook statusline`, not a real hook: only the remaining plan usage
        "StatusLine" => {
            if let Some(limits) = ev.get("rate_limits").and_then(|rl| crate::limits::from_claude(rl, ts)) {
                out.push(mk(EvKind::Limits { limits }));
            }
        }
        "PreToolUse" => {
            let (activity, detail) = tool_activity(&tool, input);
            out.push(mk(EvKind::ToolStart { tool: tool.clone(), activity, detail }));
            if let Some(Value::Array(todos)) = input.get("todos") {
                let items = todos
                    .iter()
                    .map(|t| PlanItem {
                        text: s(t, "text").unwrap_or("").to_string(),
                        status: s(t, "status").unwrap_or("pending").to_string(),
                    })
                    .collect();
                out.push(mk(EvKind::Plan { items }));
            }
            if tool == "TaskUpdate" {
                if let Some(id) = s(input, "taskId").or_else(|| s(input, "task_id")) {
                    out.push(mk(EvKind::TaskUpdate {
                        id: id.to_string(),
                        text: s(input, "subject").map(String::from),
                        status: s(input, "status").map(String::from),
                    }));
                }
            }
        }
        "PostToolUse" | "PostToolUseFailure" => {
            let (activity, _) = tool_activity(&tool, input);
            let failed = name == "PostToolUseFailure"
                || ev.pointer("/tool_response/is_error").and_then(|x| x.as_bool()) == Some(true)
                || ev.pointer("/tool_response/interrupted").and_then(|x| x.as_bool()) == Some(true);
            let ok = match ev.pointer("/tool_response/exit_code").and_then(|x| x.as_i64()) {
                Some(code) => Some(code == 0 && !failed),
                None => Some(!failed),
            };
            out.push(mk(EvKind::ToolEnd { tool, activity, ok, error: if failed { s(ev, "error").map(String::from) } else { None } }));
        }
        "PermissionRequest" => {
            let (_, detail) = tool_activity(&tool, input);
            out.push(mk(EvKind::PermissionRequest { tool: Some(tool).filter(|t| !t.is_empty()), detail }));
        }
        "Notification" => match s(ev, "notification_type").unwrap_or("") {
            "permission_prompt" => out.push(mk(EvKind::PermissionRequest { tool: None, detail: s(ev, "message").map(String::from) })),
            "idle_prompt" | "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => {
                out.push(mk(EvKind::NeedsInput { message: s(ev, "message").map(String::from) }))
            }
            _ => {}
        },
        "Stop" => out.push(mk(EvKind::TurnComplete)),
        "StopFailure" => {
            let err = s(ev, "error_type").or_else(|| s(ev, "error")).unwrap_or("unknown").to_string();
            out.push(mk(EvKind::TurnFailed { error: err }))
        }
        "SubagentStart" => out.push(mk(EvKind::SubagentStart { agent_type: s(ev, "agent_type").map(String::from) })),
        "SubagentStop" => out.push(mk(EvKind::SubagentStop { agent_type: s(ev, "agent_type").map(String::from) })),
        "PreCompact" => out.push(mk(EvKind::Compacting)),
        "TaskCreated" | "TaskCompleted" => {
            if let Some(id) = s(ev, "task_id") {
                out.push(mk(EvKind::TaskUpdate {
                    id: id.to_string(),
                    text: s(ev, "task_subject").map(String::from),
                    status: Some(if name == "TaskCompleted" { "completed" } else { "pending" }.to_string()),
                }));
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

    fn norm(raw: Value) -> Vec<NormEvent> {
        normalize(1, &sanitize(&raw))
    }

    #[test]
    fn edit_maps_to_editing_with_file_name() {
        let e = norm(json!({"session_id":"a","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/p/src/app.tsx","old_string":"x","new_string":"y"}}));
        assert_eq!(e[0].kind, EvKind::ToolStart { tool: "Edit".into(), activity: Activity::Edit, detail: Some("app.tsx".into()) });
    }

    #[test]
    fn test_failure_is_reported() {
        let e = norm(json!({"session_id":"a","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"npm test"},"error":"exit 1"}));
        match &e[0].kind {
            EvKind::ToolEnd { activity, ok, .. } => {
                assert_eq!(*activity, Activity::Test);
                assert_eq!(*ok, Some(false));
            }
            k => panic!("{k:?}"),
        }
    }

    #[test]
    fn todowrite_gives_plan() {
        let e = norm(json!({"session_id":"a","hook_event_name":"PreToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"A","status":"completed"},{"content":"B","status":"in_progress"}]}}));
        assert!(matches!(&e[1].kind, EvKind::Plan { items } if items.len() == 2 && items[0].status == "completed"));
    }

    #[test]
    fn missing_session_id_is_ignored() {
        assert!(norm(json!({"hook_event_name":"Stop"})).is_empty());
    }
}
