//! Filesystem locations. Everything Agent Room writes lives under `~/.agent-room`
//! (override with `AGENT_ROOM_HOME`), except the hook entries it adds to agent configs.

use std::path::PathBuf;

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
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
