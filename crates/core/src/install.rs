//! Safe install / uninstall of Agent Room's hook entries in agent configs.
//!
//! * Every write is preceded by a timestamped backup of the original file.
//! * Only handlers whose command contains `agent-room-hook` are ever added or removed;
//!   the user's own hooks and settings are left untouched (key order preserved).
//! * Writes are atomic (temp file + rename). Unparseable configs are never overwritten.

use crate::adapters::{claude, codex};
use crate::model::now_ms;
use crate::paths;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const MARKER: &str = "agent-room-hook";
const KEEP_BACKUPS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Claude,
    Codex,
}

impl Target {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
    pub fn config_path(self) -> PathBuf {
        match self {
            Self::Claude => paths::claude_settings(),
            Self::Codex => paths::codex_hooks(),
        }
    }
    fn events(self) -> &'static [&'static str] {
        match self {
            Self::Claude => claude::HOOK_EVENTS,
            Self::Codex => codex::HOOK_EVENTS,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub agent: Target,
    pub config_path: String,
    /// the agent's config directory exists (agent seems to be installed)
    pub agent_detected: bool,
    /// "none" | "partial" | "full"
    pub installed: String,
    pub hook_binary_present: bool,
    pub notes: Vec<String>,
    pub backups: Vec<String>,
}

fn read_json(path: &Path) -> Result<Option<Value>, String> {
    match fs::read_to_string(path) {
        Ok(txt) if txt.trim().is_empty() => Ok(Some(json!({}))),
        Ok(txt) => serde_json::from_str(&txt).map(Some).map_err(|e| format!("{} 을(를) 읽을 수 없습니다 (JSON 오류: {e}). 파일을 변경하지 않았습니다.", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn write_atomic(path: &Path, v: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.agent-room-tmp");
    let txt = serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n";
    fs::write(&tmp, txt).map_err(|e| e.to_string())?;
    // keep the original file's permissions (a 0600 settings file must not become world-readable)
    if let Ok(meta) = fs::metadata(path) {
        fs::set_permissions(&tmp, meta.permissions()).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn backup(t: Target, path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let dir = paths::backups_dir();
    paths::ensure_private_dir(&paths::data_dir()).map_err(|e| e.to_string())?;
    paths::ensure_private_dir(&dir).map_err(|e| e.to_string())?;
    let file = path.file_name().and_then(|f| f.to_str()).unwrap_or("config");
    let dst = dir.join(format!("{}-{}-{}", t.name(), now_ms(), file));
    fs::copy(path, &dst).map_err(|e| e.to_string())?;
    paths::make_private(&dst).map_err(|e| e.to_string())?;
    // prune old backups of this agent
    let mut all = list_backups(t);
    while all.len() > KEEP_BACKUPS {
        let _ = fs::remove_file(all.remove(0));
    }
    Ok(Some(dst))
}

pub fn list_backups(t: Target) -> Vec<PathBuf> {
    let prefix = format!("{}-", t.name());
    let mut v: Vec<PathBuf> = fs::read_dir(paths::backups_dir())
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.file_name().and_then(|f| f.to_str()).is_some_and(|f| f.starts_with(&prefix))).collect())
        .unwrap_or_default();
    v.sort();
    v
}

fn is_ours(handler: &Value) -> bool {
    handler.get("command").and_then(|c| c.as_str()).is_some_and(|c| c.contains(MARKER))
}

fn hook_command(t: Target, bin: &Path) -> String {
    format!("\"{}\" {}", bin.display(), t.name())
}

/// Removes our handlers from a `{"hooks": {Event: [{matcher?, hooks: [...]}]}}` document.
fn strip_ours(doc: &mut Value) {
    strip_hooks(doc);
    // the status line is ours to restore even when the user already removed the hooks object
    strip_statusline(doc);
}

fn strip_hooks(doc: &mut Value) {
    let Some(hooks) = doc.get_mut("hooks").and_then(|h| h.as_object_mut()) else { return };
    let events: Vec<String> = hooks.keys().cloned().collect();
    for ev in events {
        if let Some(Value::Array(groups)) = hooks.get_mut(&ev) {
            for g in groups.iter_mut() {
                if let Some(Value::Array(hs)) = g.get_mut("hooks") {
                    hs.retain(|h| !is_ours(h));
                }
            }
            groups.retain(|g| g.get("hooks").and_then(|h| h.as_array()).map(|a| !a.is_empty()).unwrap_or(true));
            if groups.is_empty() {
                hooks.remove(&ev);
            }
        }
    }
    if hooks.is_empty() {
        if let Some(o) = doc.as_object_mut() {
            o.remove("hooks");
        }
    }
}

/// Puts back the user's own status line (or none) if ours is set.
fn strip_statusline(doc: &mut Value) {
    let Some(o) = doc.as_object_mut() else { return };
    if !o.get("statusLine").is_some_and(is_ours) {
        return;
    }
    let prev = fs::read_to_string(paths::claude_prev_statusline()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|v| !v.is_null());
    match prev {
        Some(v) => {
            o.insert("statusLine".into(), v);
        }
        None => {
            o.remove("statusLine");
        }
    }
}

/// Claude passes remaining plan usage only to its status line command, so ours wraps
/// the user's: it forwards the usage numbers, then runs the user's command and prints its output.
fn set_statusline(doc: &mut Value, bin: &Path) -> Result<(), String> {
    let o = doc.as_object_mut().unwrap();
    let prev = o.get("statusLine").cloned().unwrap_or(Value::Null);
    // already wrapped: keep the saved original, never save our own wrapper as the user's command
    if is_ours(&prev) {
        return Ok(());
    }
    let txt = serde_json::to_string(&prev).map_err(|e| e.to_string())?;
    paths::ensure_private_dir(&paths::data_dir()).map_err(|e| e.to_string())?;
    fs::write(paths::claude_prev_statusline(), txt).map_err(|e| e.to_string())?;
    paths::make_private(&paths::claude_prev_statusline()).map_err(|e| e.to_string())?;
    let mut ours = json!({ "type": "command", "command": format!("\"{}\" statusline", bin.display()) });
    if let Some(p) = prev.get("padding") {
        ours["padding"] = p.clone();
    }
    o.insert("statusLine".into(), ours);
    Ok(())
}

fn count_ours(doc: &Value, events: &[&str]) -> usize {
    events
        .iter()
        .filter(|ev| {
            doc.pointer(&format!("/hooks/{ev}"))
                .and_then(|g| g.as_array())
                .is_some_and(|groups| groups.iter().any(|g| g.get("hooks").and_then(|h| h.as_array()).is_some_and(|hs| hs.iter().any(is_ours))))
        })
        .count()
}

pub fn status(t: Target) -> HookStatus {
    let path = t.config_path();
    let agent_detected = path.parent().is_some_and(|p| p.exists());
    let mut notes = Vec::new();
    let installed = match read_json(&path) {
        Ok(Some(doc)) => {
            let n = count_ours(&doc, t.events());
            let status_line = t != Target::Claude || doc.get("statusLine").is_some_and(is_ours);
            // say what is missing, so "다시 연결 필요" isn't a guess
            if n > 0 && n < t.events().len() {
                notes.push(format!("연결 항목 {}개 중 {n}개만 설정 파일에 남아 있습니다.", t.events().len()));
            }
            if n > 0 && !status_line {
                notes.push("상태 표시줄(statusLine)이 다른 명령으로 바뀌었습니다.".into());
            }
            if n == 0 { "none" } else if n == t.events().len() && status_line { "full" } else { "partial" }
        }
        Ok(None) => "none",
        Err(e) => {
            notes.push(e);
            "none"
        }
    }
    .to_string();
    if t == Target::Codex {
        if let Ok(cfg) = fs::read_to_string(paths::codex_home().join("config.toml")) {
            let off = cfg.lines().map(|l| l.replace(' ', "")).any(|l| l == "hooks=false" || l == "codex_hooks=false");
            if off {
                notes.push("Codex config.toml 에서 hooks 기능이 꺼져 있습니다 ([features] hooks = false).".into());
            }
        }
        if installed != "none" {
            notes.push("Codex는 새 Hook을 처음 한 번 신뢰 승인해야 실행합니다. Codex에서 /hooks 를 열어 agent-room-hook 을 승인하세요.".into());
        }
    }
    HookStatus {
        agent: t,
        config_path: path.display().to_string(),
        agent_detected,
        installed,
        hook_binary_present: paths::installed_hook_bin().exists(),
        notes,
        backups: list_backups(t).iter().map(|p| p.display().to_string()).collect(),
    }
}

/// Copies the hook binary to a stable location (`~/.agent-room/bin`) so hooks keep working
/// (as silent no-ops) even if the app bundle is moved or deleted.
pub fn install_hook_binary(src: &Path) -> Result<PathBuf, String> {
    let dst = paths::installed_hook_bin();
    fs::create_dir_all(dst.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = dst.with_extension("tmp");
    fs::copy(src, &tmp).map_err(|e| format!("hook 바이너리 복사 실패 ({}): {e}", src.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    Ok(dst)
}

pub fn install(t: Target, hook_bin_src: Option<&Path>) -> Result<HookStatus, String> {
    let bin = match hook_bin_src {
        Some(src) if src != paths::installed_hook_bin() => install_hook_binary(src)?,
        _ => paths::installed_hook_bin(),
    };
    if !bin.exists() {
        return Err(format!("hook 바이너리가 없습니다: {}", bin.display()));
    }
    let path = t.config_path();
    let mut doc = read_json(&path)?.unwrap_or_else(|| json!({}));
    if !doc.is_object() {
        return Err(format!("{} 의 최상위가 JSON 객체가 아닙니다. 파일을 변경하지 않았습니다.", path.display()));
    }
    backup(t, &path)?;
    strip_ours(&mut doc);
    let obj = doc.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        return Err("\"hooks\" 항목이 객체가 아닙니다. 파일을 변경하지 않았습니다.".into());
    }
    let cmd = hook_command(t, &bin);
    for ev in t.events() {
        let arr = hooks.as_object_mut().unwrap().entry(ev.to_string()).or_insert_with(|| Value::Array(vec![]));
        if let Value::Array(groups) = arr {
            // short timeout; the hook itself gives up after ~0.3s and always exits 0. A Claude Code
            // permission request may wait for an answer in the app (opt-in), so it gets longer.
            let timeout = if t == Target::Claude && *ev == "PermissionRequest" { 130 } else { 5 };
            groups.push(json!({ "hooks": [ { "type": "command", "command": cmd, "timeout": timeout } ] }));
        }
    }
    if t == Target::Claude {
        set_statusline(&mut doc, &bin)?;
    }
    write_atomic(&path, &doc)?;
    Ok(status(t))
}

pub fn uninstall(t: Target) -> Result<HookStatus, String> {
    let path = t.config_path();
    if let Some(mut doc) = read_json(&path)? {
        if count_ours(&doc, t.events()) > 0 || doc.to_string().contains(MARKER) {
            backup(t, &path)?;
            strip_ours(&mut doc);
            write_atomic(&path, &doc)?;
        }
    }
    Ok(status(t))
}

/// Restores the most recent backup taken before Agent Room changed the file.
pub fn restore_latest(t: Target) -> Result<String, String> {
    let latest = list_backups(t).pop().ok_or("백업이 없습니다.")?;
    let path = t.config_path();
    // keep a copy of the current file too, so a restore can itself be undone
    backup(t, &path)?;
    fs::copy(&latest, &path).map_err(|e| e.to_string())?;
    Ok(latest.display().to_string())
}

/// Removes our hooks from every agent, then the hook binary. Used by the app's
/// "remove" action and by `agent-room-hook --uninstall`.
pub fn uninstall_all() -> Vec<Result<HookStatus, String>> {
    let res = vec![uninstall(Target::Claude), uninstall(Target::Codex)];
    // keep the binary while any config may still reference it
    if res.iter().all(|r| r.is_ok()) {
        let _ = fs::remove_file(paths::installed_hook_bin());
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV: Mutex<()> = Mutex::new(());

    fn sandbox(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("agent-room-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        std::env::set_var("AGENT_ROOM_HOME", d.join("ar"));
        std::env::set_var("CLAUDE_CONFIG_DIR", d.join("claude"));
        std::env::set_var("CODEX_HOME", d.join("codex"));
        d
    }

    #[test]
    fn install_preserves_user_hooks_and_uninstall_restores_shape() {
        let _g = ENV.lock().unwrap();
        let d = sandbox("a");
        fs::create_dir_all(d.join("claude")).unwrap();
        let original = r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"say done"}]}]},"zeta":1}"#;
        fs::write(d.join("claude/settings.json"), original).unwrap();
        let fake_bin = d.join("agent-room-hook");
        fs::write(&fake_bin, b"#!/bin/sh\n").unwrap();

        let st = install(Target::Claude, Some(&fake_bin)).unwrap();
        assert_eq!(st.installed, "full");
        assert_eq!(st.backups.len(), 1);
        let doc: Value = serde_json::from_str(&fs::read_to_string(d.join("claude/settings.json")).unwrap()).unwrap();
        assert_eq!(doc["hooks"]["Stop"].as_array().unwrap().len(), 2, "user hook kept + ours added");
        assert_eq!(doc["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        let keys: Vec<&String> = doc.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["model", "hooks", "zeta", "statusLine"], "key order preserved (our status line appended)");

        // idempotent
        install(Target::Claude, Some(&fake_bin)).unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(d.join("claude/settings.json")).unwrap()).unwrap();
        assert_eq!(doc["hooks"]["Stop"].as_array().unwrap().len(), 2);

        assert!(doc["statusLine"]["command"].as_str().unwrap().ends_with(" statusline"));

        let st = uninstall(Target::Claude).unwrap();
        assert_eq!(st.installed, "none");
        let after: Value = serde_json::from_str(&fs::read_to_string(d.join("claude/settings.json")).unwrap()).unwrap();
        let before: Value = serde_json::from_str(original).unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn users_status_line_is_wrapped_and_restored() {
        let _g = ENV.lock().unwrap();
        let d = sandbox("s");
        fs::create_dir_all(d.join("claude")).unwrap();
        let original = r#"{"statusLine":{"type":"command","command":"~/bin/my-line","padding":0},"zeta":1}"#;
        fs::write(d.join("claude/settings.json"), original).unwrap();
        let fake_bin = d.join("agent-room-hook");
        fs::write(&fake_bin, b"x").unwrap();
        install(Target::Claude, Some(&fake_bin)).unwrap();
        install(Target::Claude, Some(&fake_bin)).unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(d.join("claude/settings.json")).unwrap()).unwrap();
        assert!(doc["statusLine"]["command"].as_str().unwrap().contains(MARKER));
        assert_eq!(doc["statusLine"]["padding"], 0);
        let prev: Value = serde_json::from_str(&fs::read_to_string(paths::claude_prev_statusline()).unwrap()).unwrap();
        assert_eq!(prev["command"], "~/bin/my-line", "reinstall keeps the user's command, not ours");
        uninstall(Target::Claude).unwrap();
        let after: Value = serde_json::from_str(&fs::read_to_string(d.join("claude/settings.json")).unwrap()).unwrap();
        assert_eq!(after, serde_json::from_str::<Value>(original).unwrap());
    }

    #[test]
    fn status_line_is_restored_after_the_user_deleted_the_hooks() {
        let _g = ENV.lock().unwrap();
        let d = sandbox("h");
        fs::create_dir_all(d.join("claude")).unwrap();
        let original = r#"{"statusLine":{"type":"command","command":"~/bin/my-line"}}"#;
        let cfg = d.join("claude/settings.json");
        fs::write(&cfg, original).unwrap();
        let fake_bin = d.join("agent-room-hook");
        fs::write(&fake_bin, b"x").unwrap();
        install(Target::Claude, Some(&fake_bin)).unwrap();
        // the user removes the whole hooks object by hand, leaving our status line behind
        let mut doc: Value = serde_json::from_str(&fs::read_to_string(&cfg).unwrap()).unwrap();
        doc.as_object_mut().unwrap().remove("hooks");
        fs::write(&cfg, doc.to_string()).unwrap();
        install(Target::Claude, Some(&fake_bin)).unwrap();
        let prev: Value = serde_json::from_str(&fs::read_to_string(paths::claude_prev_statusline()).unwrap()).unwrap();
        assert_eq!(prev["command"], "~/bin/my-line", "our wrapper is never saved as the user's command");
        let mut doc: Value = serde_json::from_str(&fs::read_to_string(&cfg).unwrap()).unwrap();
        doc.as_object_mut().unwrap().remove("hooks");
        fs::write(&cfg, doc.to_string()).unwrap();
        uninstall(Target::Claude).unwrap();
        let after: Value = serde_json::from_str(&fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(after, serde_json::from_str::<Value>(original).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn copies_of_configs_stay_private() {
        use std::os::unix::fs::PermissionsExt;
        let _g = ENV.lock().unwrap();
        let d = sandbox("p");
        fs::create_dir_all(d.join("claude")).unwrap();
        let cfg = d.join("claude/settings.json");
        fs::write(&cfg, r#"{"env":{"ANTHROPIC_API_KEY":"sk-ant-xxxxxxxxxxxx"},"statusLine":{"type":"command","command":"x"}}"#).unwrap();
        fs::set_permissions(&cfg, fs::Permissions::from_mode(0o600)).unwrap();
        let fake_bin = d.join("agent-room-hook");
        fs::write(&fake_bin, b"x").unwrap();
        install(Target::Claude, Some(&fake_bin)).unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&cfg), 0o600, "rewritten config keeps its mode");
        for b in list_backups(Target::Claude) {
            assert_eq!(mode(&b), 0o600, "backup is private");
        }
        assert_eq!(mode(&paths::backups_dir()), 0o700);
        assert_eq!(mode(&paths::claude_prev_statusline()), 0o600);
    }

    #[test]
    fn broken_config_is_never_overwritten() {
        let _g = ENV.lock().unwrap();
        let d = sandbox("b");
        fs::create_dir_all(d.join("codex")).unwrap();
        fs::write(d.join("codex/hooks.json"), "{ not json").unwrap();
        let fake_bin = d.join("agent-room-hook");
        fs::write(&fake_bin, b"x").unwrap();
        assert!(install(Target::Codex, Some(&fake_bin)).is_err());
        assert_eq!(fs::read_to_string(d.join("codex/hooks.json")).unwrap(), "{ not json");
    }

    #[test]
    fn codex_install_creates_hooks_file() {
        let _g = ENV.lock().unwrap();
        let d = sandbox("c");
        let fake_bin = d.join("agent-room-hook");
        fs::write(&fake_bin, b"x").unwrap();
        let st = install(Target::Codex, Some(&fake_bin)).unwrap();
        assert_eq!(st.installed, "full");
        assert!(st.notes.iter().any(|n| n.contains("/hooks")));
        uninstall(Target::Codex).unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(d.join("codex/hooks.json")).unwrap()).unwrap();
        assert_eq!(doc, json!({}));
    }
}
