//! `agent-room-hook <claude|codex>` — registered as a command hook in the agent's config.
//!
//! Contract with the agent (zero tokens):
//! * prints NOTHING to stdout (stdout of some hook events is added to the model's context)
//! * always exits 0, never blocks or decides anything
//! * gives up after a few hundred ms if Agent Room is not running
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
                send(&Envelope { v: 1, agent: "claude".into(), ts: now_ms(), ppid: parent_pid(), event: sanitize(&raw) });
            }
        }
        return;
    }
    if arg != "claude" && arg != "codex" {
        return;
    }
    let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&buf) else { return };
    let env = Envelope { v: 1, agent: arg, ts: now_ms(), ppid: parent_pid(), event: sanitize(&raw) };
    send(&env);
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

#[cfg(unix)]
fn send(env: &Envelope) {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use std::time::Duration;
    let Ok(mut s) = UnixStream::connect(paths::socket_path()) else { return };
    let _ = s.set_write_timeout(Some(Duration::from_millis(300)));
    let _ = s.set_read_timeout(Some(Duration::from_millis(300)));
    let Ok(mut line) = serde_json::to_vec(env) else { return };
    line.push(b'\n');
    if s.write_all(&line).is_ok() {
        let mut ack = [0u8; 1];
        let _ = s.read(&mut ack);
    }
}

#[cfg(not(unix))]
fn send(_env: &Envelope) {}
