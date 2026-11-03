//! `agent-room-hook <claude|codex>` — registered as a command hook in the agent's config.
//!
//! Contract with the agent (zero tokens):
//! * prints NOTHING to stdout (stdout of some hook events is added to the model's context)
//! * always exits 0, never blocks or decides anything
//! * gives up after a few hundred ms if Agent Room is not running
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
    if arg != "claude" && arg != "codex" {
        return;
    }
    let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&buf) else { return };
    let env = Envelope { v: 1, agent: arg, ts: now_ms(), ppid: parent_pid(), event: sanitize(&raw) };
    send(&env);
}

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
