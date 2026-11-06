//! Local IPC server + process liveness. Used by the desktop app only.

use crate::adapters::Envelope;
use crate::paths;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::thread::JoinHandle;
use std::time::Duration;
use crate::model::AgentKind;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const MAX_LINE: u64 = 512 * 1024;

/// How long a held connection (a permission request answered in the app) stays open at most.
pub const HOLD_MAX: Duration = Duration::from_secs(120);

/// Listens on `~/.agent-room/run/agent-room.sock` (user-only permissions).
/// Each connection carries one JSON line from `agent-room-hook`; connections are
/// handled one at a time so events keep their order. When `on_event` returns a receiver, the
/// connection is answered later, off this thread, with what arrives on it (or a plain ack when
/// nothing does within [`HOLD_MAX`]), so other events are not held up.
#[cfg(unix)]
pub fn spawn_server<F>(on_event: F) -> io::Result<JoinHandle<()>>
where
    F: Fn(Envelope) -> Option<std::sync::mpsc::Receiver<Vec<u8>>> + Send + 'static,
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
            let mut held = None;
            if ok {
                if let Ok(env) = serde_json::from_str::<Envelope>(&line) {
                    // handle before acking, so the hook (and its parent agent process) is still
                    // alive while we resolve which process the session belongs to
                    held = on_event(env);
                }
            }
            match held {
                Some(rx) => {
                    let _ = std::thread::Builder::new().name("agent-room-hold".into()).spawn(move || {
                        let reply = rx.recv_timeout(HOLD_MAX).unwrap_or_else(|_| b"k".to_vec());
                        let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
                        let _ = stream.write_all(&reply);
                    });
                }
                None => {
                    let _ = stream.write_all(b"k");
                }
            }
        }
    })?)
}

#[cfg(not(unix))]
pub fn spawn_server<F>(_on_event: F) -> io::Result<JoinHandle<()>>
where
    F: Fn(Envelope) -> Option<std::sync::mpsc::Receiver<Vec<u8>>> + Send + 'static,
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

    /// The app the agent runs inside (Terminal, iTerm, VS Code, the Claude or Codex app…): the
    /// outermost `.app` bundle on the executable path of the agent or of the nearest parent that has one.
    pub fn host_app(&mut self, pid: u32) -> Option<std::path::PathBuf> {
        let start = pid;
        let mut pid = Pid::from_u32(pid);
        for _ in 0..16 {
            self.sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
            let Some(p) = self.sys.process(pid) else { break };
            if let Some(app) = p.exe().and_then(outer_app) {
                return Some(app);
            }
            let Some(parent) = p.parent() else { break };
            pid = parent;
        }
        // a terminal starts the shell through `login`, which runs as root: its details can't be read
        // directly, but `ps` still lists every process's parent and command
        #[cfg(target_os = "macos")]
        {
            let out = std::process::Command::new("/bin/ps").args(["-axo", "pid=,ppid=,comm="]).output().ok()?;
            return host_from_ps(&String::from_utf8_lossy(&out.stdout), start);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = start;
            None
        }
    }

    /// A running agent of this kind working in `cwd`: sessions found only from their logs have no
    /// process yet, so their app is found through the agent process in the same folder.
    pub fn agent_in(&mut self, kind: AgentKind, cwd: &str) -> Option<u32> {
        let refresh = ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet).with_cwd(UpdateKind::Always);
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh);
        let want = std::path::Path::new(cwd);
        self.sys
            .processes()
            .values()
            .find(|p| {
                let exe = p.exe().map(|e| e.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                agent_of(&p.name().to_string_lossy(), &exe) == Some(kind) && p.cwd() == Some(want)
            })
            .map(|p| p.pid().as_u32())
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
    // An app's own window process is `…/X.app/Contents/MacOS/X` with a capitalised name. The CLIs the
    // desktop apps now ship as bundles keep the lowercase binary name (`…/claude.app/Contents/MacOS/claude`
    // in Claude's Code tab, `…/CodexCLI.app/Contents/MacOS/codex` inside ChatGPT), so the case decides.
    if e.contains(".app/contents/macos/") {
        let file = exe.replace('\\', "/");
        let file = file.rsplit('/').next().unwrap_or("");
        if file != "claude" && file != "codex" {
            return None;
        }
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

/// Walks up a `ps -axo pid=,ppid=,comm=` listing from `pid` to the first command inside an `.app`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn host_from_ps(table: &str, pid: u32) -> Option<std::path::PathBuf> {
    let rows: std::collections::HashMap<u32, (u32, &str)> = table
        .lines()
        .filter_map(|l| {
            let mut it = l.trim_start().splitn(2, char::is_whitespace);
            let pid = it.next()?.parse().ok()?;
            let rest = it.next()?.trim_start();
            let (ppid, comm) = rest.split_once(char::is_whitespace)?;
            Some((pid, (ppid.parse().ok()?, comm.trim())))
        })
        .collect();
    let mut pid = pid;
    for _ in 0..16 {
        let &(ppid, comm) = rows.get(&pid)?;
        if let Some(app) = outer_app(std::path::Path::new(comm)) {
            return Some(app);
        }
        if ppid <= 1 {
            return None;
        }
        pid = ppid;
    }
    None
}

/// `/Applications/Visual Studio Code.app` from `/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/…`
fn outer_app(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let s = exe.to_str()?;
    // The Claude desktop app runs its Code tab's CLI as a bundle of its own
    // (`~/Library/Application Support/Claude/claude-code/<ver>/…/claude.app/Contents/MacOS/claude`).
    // That bundle is not a window anyone can bring up; the app hosting it is further up the parents.
    if s.contains("/Library/Application Support/") {
        return None;
    }
    let end = s.find(".app/")? + 4;
    Some(std::path::PathBuf::from(&s[..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_app_is_the_outermost_bundle() {
        use std::path::Path;
        assert_eq!(outer_app(Path::new("/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)")).as_deref(), Some(Path::new("/Applications/Visual Studio Code.app")));
        assert_eq!(outer_app(Path::new("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal")).as_deref(), Some(Path::new("/System/Applications/Utilities/Terminal.app")));
        assert_eq!(outer_app(Path::new("/Users/kim/.local/share/claude/versions/2.0.1")), None);
        // the Code tab's CLI bundle is not the host; the Claude app above it is
        assert_eq!(outer_app(Path::new("/Users/kim/Library/Application Support/Claude/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude")), None);
        assert_eq!(outer_app(Path::new("/Applications/Claude.app/Contents/Helpers/disclaimer")).as_deref(), Some(Path::new("/Applications/Claude.app")));
        // Codex inside the ChatGPT app
        assert_eq!(outer_app(Path::new("/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex")).as_deref(), Some(Path::new("/Applications/ChatGPT.app")));
    }

    #[test]
    fn host_app_of_the_claude_desktop_code_tab() {
        let ps = "    1     0 /sbin/launchd\n\
                  80224     1 /Applications/Claude.app/Contents/MacOS/Claude\n\
                  81292 80224 /Applications/Claude.app/Contents/Helpers/disclaimer\n\
                  81293 81292 /Users/kim/Library/Application Support/Claude/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude\n";
        assert_eq!(host_from_ps(ps, 81293).as_deref(), Some(std::path::Path::new("/Applications/Claude.app")));
    }

    #[test]
    fn host_app_through_root_login() {
        let ps = "    1     0 /sbin/launchd\n  500     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\n  610   500 login\n  611   610 -zsh\n  700   611 claude\n";
        assert_eq!(host_from_ps(ps, 700).as_deref(), Some(std::path::Path::new("/System/Applications/Utilities/Terminal.app")));
        assert_eq!(host_from_ps("  9     1 /usr/sbin/tmux\n 10     9 claude\n", 10), None);
    }

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
        // the CLIs the desktop apps ship as bundles of their own
        assert_eq!(agent_of("claude", "/Users/kim/Library/Application Support/Claude/claude-code/2.1.317/91184d3d9ba3/claude.app/Contents/MacOS/claude"), Some(AgentKind::Claude));
        assert_eq!(agent_of("codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"), Some(AgentKind::Codex));
        assert_eq!(agent_of("ChatGPT", "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"), None);
        assert_eq!(agent_of("node", "/usr/local/bin/node"), None);
        assert_eq!(agent_of("claudette", "/usr/bin/claudette"), None);
    }
}
