//! Filesystem locations. Everything Agent Room writes lives under `~/.agent-room`
//! (override with `AGENT_ROOM_HOME`), except the hook entries it adds to agent configs.

use std::path::PathBuf;

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Creates `dir` readable by this user only (0700 on unix). Backups and the kept status line
/// command are copies of agent configs, which can hold API keys in their `env` block.
pub fn ensure_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Makes a file readable by this user only (0600 on unix).
pub fn make_private(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub fn data_dir() -> PathBuf {
    std::env::var_os("AGENT_ROOM_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".agent-room"))
}

pub fn socket_path() -> PathBuf {
    data_dir().join("run").join("agent-room.sock")
}

pub fn hook_bin_name() -> &'static str {
    if cfg!(windows) { "agent-room-hook.exe" } else { "agent-room-hook" }
}

pub fn installed_hook_bin() -> PathBuf {
    data_dir().join("bin").join(hook_bin_name())
}

pub fn backups_dir() -> PathBuf {
    data_dir().join("backups")
}

pub fn claude_settings() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".claude")).join("settings.json")
}

pub fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex"))
}

pub fn codex_hooks() -> PathBuf {
    codex_home().join("hooks.json")
}

/// the user's own Claude `statusLine` setting, kept while Agent Room's status line wraps it
pub fn claude_prev_statusline() -> PathBuf {
    data_dir().join("claude-statusline.json")
}
