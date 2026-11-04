//! Runs inside the hook process, before anything leaves it.
//!
//! Hook payloads can contain prompts, assistant replies, file contents and command
//! output. None of that is needed to draw the room, so only an allow-list of small
//! fields survives. Prompts, replies, file contents and tool output never leave the hook.

use serde_json::{Map, Value};

const TOP_KEYS: &[&str] = &[
    "session_id", "transcript_path", "cwd", "hook_event_name", "source", "reason", "turn_id",
    "tool_name", "tool_use_id", "notification_type", "title", "error", "error_type", "status",
    "trigger", "agent_type", "agent_id", "permission_mode", "stop_hook_active", "task_id", "task_subject",
];
const INPUT_KEYS: &[&str] = &[
    "file_path", "path", "notebook_path", "pattern", "glob", "description", "subagent_type",
    "status", "taskId", "task_id", "subject",
];

pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// Masks values that look like credentials: `FOO_TOKEN=...`, `Bearer ...`, `sk-...` etc.
pub fn redact_command(cmd: &str) -> String {
    let mut out = Vec::new();
    let mut mask_next = false;
    for word in cmd.split_whitespace() {
        if mask_next {
            if ["bearer", "basic", "token"].contains(&word.to_ascii_lowercase().as_str()) {
                out.push(word.to_string());
                continue;
            }
            out.push("***".to_string());
            mask_next = false;
            continue;
        }
        let lw = word.to_ascii_lowercase();
        if lw == "bearer" || lw.ends_with("authorization:") {
            mask_next = true;
            out.push(word.to_string());
            continue;
        }
        if let Some((k, _)) = word.split_once('=') {
            let ku = k.to_ascii_uppercase();
            if ["KEY", "TOKEN", "SECRET", "PASS", "AUTH", "CREDENTIAL"].iter().any(|s| ku.contains(s)) {
                out.push(format!("{k}=***"));
                continue;
            }
        }
        let bare = word.trim_matches(|c| c == '"' || c == '\'');
        if ["sk-", "ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "AKIA", "glpat-"].iter().any(|p| bare.starts_with(p)) && bare.len() > 12 {
            out.push("***".to_string());
            continue;
        }
        out.push(word.to_string());
    }
    out.join(" ")
}

fn short_str(v: &Value, max: usize) -> Option<Value> {
    v.as_str().map(|s| Value::String(truncate(s, max)))
}

/// File paths touched by a Codex `apply_patch` (header lines only; the patch body is dropped).
pub fn patch_files(patch: &str) -> Vec<String> {
    patch
        .lines()
        .filter_map(|l| {
            for p in ["*** Update File: ", "*** Add File: ", "*** Delete File: ", "*** Move to: "] {
                if let Some(rest) = l.strip_prefix(p) {
                    return Some(rest.trim().to_string());
                }
            }
            None
        })
        .take(20)
        .collect()
}

fn sanitize_input(v: &Value) -> Value {
    let mut out = Map::new();
    if let Some(obj) = v.as_object() {
        for k in INPUT_KEYS {
            if let Some(x) = obj.get(*k) {
                if let Some(s) = short_str(x, 160) {
                    out.insert(k.to_string(), s);
                }
            }
        }
        // shell command: redacted + truncated (Claude: string, Codex: string or argv array)
        let cmd = match obj.get("command") {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Array(a)) => Some(a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" ")),
            _ => None,
        };
        if let Some(c) = cmd {
            let files = patch_files(&c);
            if !files.is_empty() {
                out.insert("files".into(), Value::from(files));
            } else {
                out.insert("command".into(), Value::String(truncate(&redact_command(&c), 200)));
            }
        }
        for key in ["input", "patch"] {
            if let Some(Value::String(p)) = obj.get(key) {
                let files = patch_files(p);
                if !files.is_empty() {
                    out.insert("files".into(), Value::from(files));
                }
            }
        }
        if let Some(Value::String(u)) = obj.get("url") {
            // host only
            let host = u.split("://").nth(1).unwrap_or(u).split('/').next().unwrap_or("");
            out.insert("host".into(), Value::String(truncate(host, 80)));
        }
        if obj.contains_key("query") {
            out.insert("has_query".into(), Value::Bool(true));
        }
        // explicit task lists: Claude TodoWrite `todos`, Codex update_plan `plan`
        if let Some(Value::Array(todos)) = obj.get("todos") {
            let items: Vec<Value> = todos
                .iter()
                .take(50)
                .map(|t| {
                    serde_json::json!({
                        "text": truncate(t.get("content").and_then(|x| x.as_str()).unwrap_or(""), 80),
                        "status": t.get("status").and_then(|x| x.as_str()).unwrap_or("pending"),
                    })
                })
                .collect();
            out.insert("todos".into(), Value::from(items));
        }
        if let Some(Value::Array(plan)) = obj.get("plan") {
            let items: Vec<Value> = plan
                .iter()
                .take(50)
                .map(|t| {
                    serde_json::json!({
                        "text": truncate(t.get("step").and_then(|x| x.as_str()).unwrap_or(""), 80),
                        "status": t.get("status").and_then(|x| x.as_str()).unwrap_or("pending"),
                    })
                })
                .collect();
            out.insert("todos".into(), Value::from(items));
        }
    }
    Value::Object(out)
}

/// Only the outcome of a tool call: exit code / error flags. Never output text.
fn sanitize_response(v: &Value) -> Value {
    let mut out = Map::new();
    match v {
        Value::Object(obj) => {
            for k in ["exit_code", "exitCode", "success", "interrupted", "is_error"] {
                if let Some(x) = obj.get(k) {
                    if x.is_number() || x.is_boolean() {
                        out.insert(k.into(), x.clone());
                    }
                }
            }
            if let Some(Value::Object(meta)) = obj.get("metadata") {
                if let Some(x) = meta.get("exit_code") {
                    if x.is_number() {
                        out.insert("exit_code".into(), x.clone());
                    }
                }
            }
        }
        Value::String(s) => {
            // Codex formats shell results as text that may begin with "Exit code: N"
            for line in s.lines().take(3) {
                if let Some(rest) = line.trim().strip_prefix("Exit code: ") {
                    if let Ok(n) = rest.trim().parse::<i64>() {
                        out.insert("exit_code".into(), Value::from(n));
                    }
                }
            }
        }
        _ => {}
    }
    Value::Object(out)
}

pub fn sanitize(raw: &Value) -> Value {
    let mut out = Map::new();
    let Some(obj) = raw.as_object() else { return Value::Object(out) };
    for k in TOP_KEYS {
        if let Some(v) = obj.get(*k) {
            match v {
                Value::String(s) => {
                    out.insert(k.to_string(), Value::String(truncate(s, 400)));
                }
                Value::Bool(_) | Value::Number(_) => {
                    out.insert(k.to_string(), v.clone());
                }
                _ => {}
            }
        }
    }
    // `message` of notifications is a short UI string ("Claude needs your permission to use Bash")
    if let Some(s) = obj.get("message").and_then(|m| m.as_str()) {
        out.insert("message".into(), Value::String(truncate(s, 160)));
    }
    if let Some(e) = obj.get("error") {
        if let Some(m) = e.get("message").and_then(|m| m.as_str()) {
            out.insert("error".into(), Value::String(truncate(m, 200)));
        }
    }
    match obj.get("model") {
        Some(Value::String(s)) => {
            out.insert("model".into(), Value::String(truncate(s, 60)));
        }
        Some(Value::Object(m)) => {
            if let Some(s) = m.get("id").or_else(|| m.get("display_name")).and_then(|x| x.as_str()) {
                out.insert("model".into(), Value::String(truncate(s, 60)));
            }
        }
        _ => {}
    }
    if let Some(v) = obj.get("tool_input") {
        out.insert("tool_input".into(), sanitize_input(v));
    }
    if let Some(v) = obj.get("tool_response") {
        out.insert("tool_response".into(), sanitize_response(v));
    }
    if let Some(Value::Object(tu)) = obj.get("token_usage") {
        let mut t = Map::new();
        for (k, v) in tu {
            if v.is_number() {
                t.insert(k.clone(), v.clone());
            }
        }
        out.insert("token_usage".into(), Value::Object(t));
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn drops_prompt_reply_content_and_output() {
        let raw = json!({
            "session_id": "s1", "hook_event_name": "PostToolUse", "prompt": "secret plan",
            "last_assistant_message": "hello", "tool_name": "Write",
            "tool_input": {"file_path": "/a/b.rs", "content": "fn main(){}"},
            "tool_response": {"stdout": "lots", "exit_code": 0}
        });
        let s = sanitize(&raw);
        let txt = s.to_string();
        assert!(!txt.contains("secret plan"));
        assert!(!txt.contains("hello"));
        assert!(!txt.contains("fn main"));
        assert!(!txt.contains("lots"));
        assert_eq!(s["tool_input"]["file_path"], "/a/b.rs");
        assert_eq!(s["tool_response"]["exit_code"], 0);
    }

    #[test]
    fn redacts_credentials_in_commands() {
        let r = redact_command("OPENAI_API_KEY=sk-abcdefghijklmnop curl -H Authorization: Bearer abc123 https://x");
        assert!(!r.contains("sk-abc"));
        assert!(!r.contains("abc123"));
        assert!(r.contains("OPENAI_API_KEY=***"));
    }

    #[test]
    fn apply_patch_keeps_only_file_names() {
        let raw = json!({"tool_input": {"command": "*** Begin Patch\n*** Update File: src/main.rs\n@@\n-old\n+new secret\n*** End Patch"}});
        let s = sanitize(&raw);
        assert_eq!(s["tool_input"]["files"][0], "src/main.rs");
        assert!(!s.to_string().contains("new secret"));
    }
}
