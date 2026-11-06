//! Where a Claude Code session was started from, read from the Claude desktop app's own session
//! records (`claude-code-sessions/<account>/<org>/local_*.json`): the desktop app's Code tab,
//! Remote Control, or a claude.ai project thread driving it through Remote Control.
//!
//! Only records written in the last day are opened, and from each only the CLI session ids, the
//! title, the archive flag and the Remote Control markers are taken. Nothing else is kept. The
//! app's key files (`remote-control-state.json`, `~/.claude/sessions/*.key`) are never opened.
//! No network, no LLM calls.

use crate::sanitize::truncate;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// the desktop app's Code tab
    Desktop,
    /// started or steered through Remote Control
    Remote,
    /// a claude.ai project thread, through Remote Control
    Project,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Desktop => "desktop",
            Origin::Remote => "remote",
            Origin::Project => "project",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DesktopSession {
    /// CLI session ids this record ran under (the current one first)
    pub cli_ids: Vec<String>,
    pub origin: Origin,
    pub title: Option<String>,
    pub last_activity: u64,
}

/// Reads one record; `None` when it is archived or names no CLI session.
pub fn parse(rec: &Value) -> Option<DesktopSession> {
    if rec.get("isArchived").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let mut cli_ids: Vec<String> = Vec::new();
    let mut add = |v: Option<&Value>| {
        if let Some(s) = v.and_then(Value::as_str) {
            if is_uuid(s) && !cli_ids.iter().any(|x| x == s) {
                cli_ids.push(s.to_string());
            }
        }
    };
    add(rec.get("cliSessionId"));
    add(rec.get("lastAssistantCliSessionId"));
    for v in rec.get("priorCliSessionIds").and_then(Value::as_array).into_iter().flatten() {
        add(Some(v));
    }
    if cli_ids.is_empty() {
        return None;
    }
    let spawn = rec.get("remoteControlSpawn").filter(|v| v.is_object());
    let flag = |v: Option<&Value>, k: &str| v.and_then(|v| v.get(k)).and_then(Value::as_bool) == Some(true);
    let origin = if flag(spawn, "projectThreadChild") {
        Origin::Project
    } else if spawn.is_some() || flag(Some(rec), "steeredByRemoteClient") {
        Origin::Remote
    } else {
        Origin::Desktop
    };
    let title = rec.get("title").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(|t| truncate(t, 80));
    let last_activity = rec.get("lastActivityAt").and_then(Value::as_u64).unwrap_or(0);
    Some(DesktopSession { cli_ids, origin, title, last_activity })
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Every record under `root` written within `within_ms` of `now`.
pub fn scan(root: &Path, now: u64, within_ms: u64) -> Vec<DesktopSession> {
    let mut out = Vec::new();
    let dirs = |p: &Path| std::fs::read_dir(p).into_iter().flatten().flatten();
    for account in dirs(root) {
        for org in dirs(&account.path()) {
            for f in dirs(&org.path()) {
                let name = f.file_name();
                let Some(name) = name.to_str() else { continue };
                if !name.starts_with("local_") || !name.ends_with(".json") {
                    continue;
                }
                let Ok(meta) = f.metadata() else { continue };
                let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                if now.saturating_sub(modified) > within_ms || meta.len() > 4 << 20 {
                    continue;
                }
                let Ok(raw) = std::fs::read(f.path()) else { continue };
                if let Some(s) = serde_json::from_slice::<Value>(&raw).ok().as_ref().and_then(parse) {
                    out.push(s);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const A: &str = "35d41fe0-8614-4055-a454-95c4ead1713a";
    const B: &str = "45d41fe0-8614-4055-a454-95c4ead1713b";

    #[test]
    fn origin_from_remote_control_markers() {
        let p = |v: Value| parse(&v).map(|s| s.origin);
        assert_eq!(p(json!({"cliSessionId": A})), Some(Origin::Desktop));
        assert_eq!(p(json!({"cliSessionId": A, "steeredByRemoteClient": true})), Some(Origin::Remote));
        assert_eq!(p(json!({"cliSessionId": A, "remoteControlSpawn": {"rcChild": true}})), Some(Origin::Remote));
        assert_eq!(p(json!({"cliSessionId": A, "remoteControlSpawn": {"projectThreadChild": true, "rcChild": true}})), Some(Origin::Project));
        assert_eq!(p(json!({"cliSessionId": A, "isArchived": true})), None);
        assert_eq!(p(json!({"cliSessionId": "not-a-uuid"})), None);
    }

    #[test]
    fn keeps_every_cli_id_and_the_title() {
        let s = parse(&json!({"cliSessionId": A, "priorCliSessionIds": [B, A], "title": "  Fix the dock  "})).unwrap();
        assert_eq!(s.cli_ids, vec![A.to_string(), B.to_string()]);
        assert_eq!(s.title.as_deref(), Some("Fix the dock"));
    }
}
