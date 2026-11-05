//! Local IPC server + process liveness. Used by the desktop app only.

use crate::adapters::Envelope;
use crate::paths;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::thread::JoinHandle;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

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

    /// Counts running agent CLI processes by executable name (no inspection of their content).
    pub fn scan_agents(&mut self) -> (u32, u32) {
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let mut claude = 0;
        let mut codex = 0;
        for p in self.sys.processes().values() {
            let n = p.name().to_string_lossy().to_ascii_lowercase();
            if n == "claude" {
                claude += 1;
            } else if n == "codex" {
                codex += 1;
            }
        }
        (claude, codex)
    }
}
