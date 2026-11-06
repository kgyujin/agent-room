//! `agent-room-hook <claude|codex>` — registered as a command hook in the agent's config.
//!
//! Contract with the agent (zero tokens):
//! * prints NOTHING to stdout (stdout of some hook events is added to the model's context)
//! * always exits 0 and gives up after a few hundred ms if Agent Room is not running
//! * decides nothing, with one opt-in exception: when the user turned on "앱에서 승인" in Agent Room,
//!   a Claude Code `PermissionRequest` waits for the user's answer in the app and prints only
//!   Claude Code's allow/deny decision JSON. Without an answer it prints nothing, so Claude
//!   Code asks in its own dialog as usual.
//!
//! `agent-room-hook statusline` is Claude Code's status line command instead: it forwards only
//! the remaining plan usage numbers, then runs the user's own status line command (if any)
//! and prints its output, so the user's status line looks the same as before.
//!
//! `agent-room-hook --uninstall` removes Agent Room's hooks from every agent config.

use agent_room_core::{adapters::Envelope, model::now_ms, paths, sanitize::sanitize};
use std::io::Read;

fn main() {
    let arg = std::env::args().nth(1).unwrap_or_default();
    if arg == "--uninstall" {
        for r in agent_room_core::install::uninstall_all() {
            match r {
                Ok(st) => eprintln!("removed Agent Room hooks from {}", st.config_path),
                Err(e) => eprintln!("error: {e}"),
            }
        }
        return;
    }
    // Read stdin fully (so the agent never sees a broken pipe), but cap memory use.
    let mut buf = Vec::new();
    let _ = std::io::stdin().lock().take(16 << 20).read_to_end(&mut buf);
    if arg == "statusline" {
        run_user_statusline(&buf);
        if let Ok(mut raw) = serde_json::from_slice::<serde_json::Value>(&buf) {
            if let Some(o) = raw.as_object_mut() {
                o.insert("hook_event_name".into(), "StatusLine".into());
                send(&Envelope { v: 1, agent: "claude".into(), ts: now_ms(), ppid: parent_pid(), event: sanitize(&raw), host_session: None });
            }
        }
        return;
    }
    if arg != "claude" && arg != "codex" {
        return;
    }
    let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&buf) else { return };
    // set by the Claude desktop app on its Code-tab sessions; lets a click open that session there
    let host_session = std::env::var("CLAUDE_CODE_HOST_SESSION_ID").ok().filter(|s| arg == "claude" && s.starts_with("local_") && s.len() <= 70);
    // a permission request may be answered in the app; the app replies at once when that is off
    let asks = arg == "claude" && raw.get("hook_event_name").and_then(|v| v.as_str()) == Some("PermissionRequest");
    let env = Envelope { v: 1, agent: arg, ts: now_ms(), ppid: parent_pid(), event: sanitize(&raw), host_session };
    let reply = send_wait(&env, if asks { agent_room_core::PERMISSION_WAIT_MS } else { 300 });
    if asks {
        if let Some(out) = decision_json(&reply) {
            use std::io::Write;
            let _ = std::io::stdout().write_all(out.as_bytes());
            let _ = std::io::stdout().flush();
        }
    }
}

/// Claude Code's PermissionRequest output for the app's answer; None leaves the decision to Claude Code.
fn decision_json(reply: &[u8]) -> Option<String> {
    let decision = match reply {
        b"allow" => serde_json::json!({ "behavior": "allow" }),
        b"deny" => serde_json::json!({ "behavior": "deny", "message": "Agent Room에서 거부했어요" }),
        _ => return None,
    };
    Some(serde_json::json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } }).to_string())
}

/// Runs the status line command the user had before Agent Room wrapped it, with the same input.
#[cfg(unix)]
fn run_user_statusline(input: &[u8]) {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let Ok(txt) = std::fs::read_to_string(paths::claude_prev_statusline()) else { return };
    let Ok(prev) = serde_json::from_str::<serde_json::Value>(&txt) else { return };
    let Some(cmd) = prev.get("command").and_then(|c| c.as_str()) else { return };
    let Ok(mut child) = Command::new("sh").arg("-c").arg(cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input);
    }
    if let Ok(out) = child.wait_with_output() {
        let _ = std::io::stdout().write_all(&out.stdout);
        let _ = std::io::stdout().flush();
    }
}

#[cfg(not(unix))]
fn run_user_statusline(_input: &[u8]) {}

#[cfg(unix)]
fn parent_pid() -> Option<u32> {
    Some(std::os::unix::process::parent_id())
}

#[cfg(not(unix))]
fn parent_pid() -> Option<u32> {
    None
}

fn send(env: &Envelope) {
    send_wait(env, 300);
}

/// Sends one event and returns the app's reply ("k", or "allow"/"deny" for an answered request).
#[cfg(unix)]
fn send_wait(env: &Envelope, wait_ms: u64) -> Vec<u8> {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use std::time::Duration;
    let Ok(mut s) = UnixStream::connect(paths::socket_path()) else { return vec![] };
    let _ = s.set_write_timeout(Some(Duration::from_millis(300)));
    let _ = s.set_read_timeout(Some(Duration::from_millis(wait_ms)));
    let Ok(mut line) = serde_json::to_vec(env) else { return vec![] };
    line.push(b'\n');
    let mut reply = Vec::new();
    if s.write_all(&line).is_ok() {
        let _ = s.take(16).read_to_end(&mut reply);
    }
    reply
}

#[cfg(not(unix))]
fn send_wait(_env: &Envelope, _wait_ms: u64) -> Vec<u8> {
    vec![]
}
