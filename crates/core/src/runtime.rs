//! Local IPC server + process liveness. Used by the desktop app only.

use crate::adapters::Envelope;
use crate::paths;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::thread::JoinHandle;
use std::time::Duration;
use crate::model::AgentKind;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const MAX_LINE: u64 = 512 * 1024;

/// Listens on `~/.agent-room/run/agent-room.sock` (user-only permissions).
/// Each connection carries one JSON line from `agent-room-hook`; connections are
/// handled one at a time so events keep their order.
#[cfg(unix)]
pub fn spawn_server<F>(on_event: F) -> io::Result<JoinHandle<()>>
where
    F: Fn(Envelope) + Send + 'static,
{
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};

    let sock = paths::socket_path();
    let dir = sock.parent().unwrap().to_path_buf();
    // everything Agent Room keeps (config backups, the kept status line command) is user-only
    paths::ensure_private_dir(&paths::data_dir())?;
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    if sock.exists() {
        if UnixStream::connect(&sock).is_ok() {
            return Err(io::Error::new(io::ErrorKind::AddrInUse, "another Agent Room instance is already listening"));
        }
        std::fs::remove_file(&sock)?;
    }
    let listener = UnixListener::bind(&sock)?;
    std::fs::set_permissions(&sock, std::fs::Permissions::from_mode(0o600))?;
    Ok(std::thread::Builder::new().name("agent-room-ipc".into()).spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
            let mut line = String::new();
            let ok = BufReader::new((&stream).take(MAX_LINE)).read_line(&mut line).is_ok();
            if ok {
                if let Ok(env) = serde_json::from_str::<Envelope>(&line) {
                    // handle before acking, so the hook (and its parent agent process) is still
                    // alive while we resolve which process the session belongs to
                    on_event(env);
                }
            }
            let _ = stream.write_all(b"k");
        }
    })?)
}

#[cfg(not(unix))]
pub fn spawn_server<F>(_on_event: F) -> io::Result<JoinHandle<()>>
where
    F: Fn(Envelope) + Send + 'static,
{
    // Windows: planned transport is a named pipe (\\.\pipe\agent-room-<user>); not implemented yet.
    Err(io::Error::new(io::ErrorKind::Unsupported, "Windows transport not implemented yet"))
}

pub fn remove_socket() {
    let _ = std::fs::remove_file(paths::socket_path());
}

const SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "fish", "env", "nu", "pwsh", "powershell", "cmd", "cmd.exe", "timeout"];

pub struct ProcWatch {
    sys: System,
}

impl Default for ProcWatch {
    fn default() -> Self {
        Self { sys: System::new() }
    }
}

impl ProcWatch {
    fn refresh_one(&mut self, pid: Pid) -> bool {
        self.sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
        self.sys.process(pid).is_some()
    }

    /// Walks up from the hook's parent to the first non-shell process: the agent itself.
    pub fn resolve_agent_pid(&mut self, ppid: u32) -> Option<u32> {
        let mut pid = Pid::from_u32(ppid);
        for _ in 0..5 {
            if !self.refresh_one(pid) {
                return None;
            }
            let p = self.sys.process(pid)?;
            let name = p.name().to_string_lossy().to_ascii_lowercase();
            if !SHELLS.contains(&name.as_str()) {
                return Some(pid.as_u32());
            }
            pid = p.parent()?;
        }
        None
    }

    pub fn alive(&mut self, pid: u32) -> bool {
        self.refresh_one(Pid::from_u32(pid))
    }

    /// Counts running agent processes by executable name and path (no inspection of their content):
    /// the CLIs, Claude Code's versioned native builds, the copies the desktop apps run, and the
    /// Codex app server that runs the Codex app's threads and scheduled tasks.
    pub fn scan_agents(&mut self) -> (u32, u32) {
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
        let mut claude = 0;
        let mut codex = 0;
        for p in self.sys.processes().values() {
            let exe = p.exe().map(|e| e.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            match agent_of(&p.name().to_string_lossy(), &exe) {
                Some(AgentKind::Claude) => claude += 1,
                Some(AgentKind::Codex) => codex += 1,
                _ => {}
            }
        }
        (claude, codex)
    }
}

/// Which agent a process is, from its name and executable path. The desktop apps' own windows
/// (`…/Claude.app/Contents/MacOS/Claude`, `…/Codex.app/Contents/MacOS/Codex`) are not agents.
pub fn agent_of(name: &str, exe: &str) -> Option<AgentKind> {
    let n = name.to_ascii_lowercase();
    let e = exe.to_ascii_lowercase();
    if e.contains(".app/contents/macos/") {
        return None;
    }
    let file = e.rsplit('/').next().unwrap_or("");
    let file = file.strip_suffix(".exe").unwrap_or(file);
    if n == "claude" || n == "claude.exe" || file == "claude" || e.contains("/claude/versions/") || e.contains("/claude-code/") {
        Some(AgentKind::Claude)
    } else if n == "codex" || n == "codex.exe" || file == "codex" || file.starts_with("codex-") {
        Some(AgentKind::Codex)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_agents_from_their_apps() {
        assert_eq!(agent_of("claude", "/opt/homebrew/bin/claude"), Some(AgentKind::Claude));
        // native installs run as a binary named after its version
        assert_eq!(agent_of("2.0.37", "/Users/kim/.local/share/claude/versions/2.0.37"), Some(AgentKind::Claude));
        // the copy the Claude desktop app runs for its Code tab
        assert_eq!(agent_of("claude", "/Users/kim/Library/Application Support/Claude/claude-code/2.0.37/claude"), Some(AgentKind::Claude));
        assert_eq!(agent_of("Claude", "/Applications/Claude.app/Contents/MacOS/Claude"), None);
        assert_eq!(agent_of("codex", "/opt/homebrew/bin/codex"), Some(AgentKind::Codex));
        // the Codex app's server, which also runs scheduled tasks
        assert_eq!(agent_of("codex", "/Applications/Codex.app/Contents/Resources/codex"), Some(AgentKind::Codex));
        assert_eq!(agent_of("Codex", "/Applications/Codex.app/Contents/MacOS/Codex"), None);
        assert_eq!(agent_of("node", "/usr/local/bin/node"), None);
        assert_eq!(agent_of("claudette", "/usr/bin/claudette"), None);
    }
}
