//! Finds agent sessions from the agents' own local session logs, for sessions whose hooks never
//! reached Agent Room: ones started before it, run by another app (the Claude or Codex desktop
//! apps, IDE extensions) or by a schedule (Codex automations, `codex exec`).
//!
//! Only file names, modification times and the `cwd` value near the start of each log are read;
//! nothing else in the log is parsed or kept. No network, no LLM calls.

use crate::model::AgentKind;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct LogSession {
    pub agent: AgentKind,
    pub session_id: String,
    pub cwd: Option<String>,
    /// last write to the log, unix ms
    pub modified: u64,
}

/// Where each agent keeps its session logs.
pub struct LogDirs {
    /// Claude Code: `<config>/projects/<project>/<session id>.jsonl`
    pub claude: PathBuf,
    /// Codex: `<codex home>/sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<session id>.jsonl`
    pub codex: PathBuf,
}

impl LogDirs {
    pub fn from_env() -> Self {
        let home = crate::paths::home();
        let claude = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"));
        let codex = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".codex"));
        Self { claude: claude.join("projects"), codex: codex.join("sessions") }
    }
}

fn modified_ms(p: &Path) -> Option<u64> {
    let t = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn entries(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default()
}

/// `"cwd":"…"` within the first 16 KB of a log (JSON string escapes for `\` `"` `/` undone).
pub fn cwd_near_start(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut buf = vec![0u8; 16 * 1024];
    let n = std::fs::File::open(path).ok()?.read(&mut buf).ok()?;
    cwd_in(&String::from_utf8_lossy(&buf[..n]))
}

fn cwd_in(text: &str) -> Option<String> {
    let start = text.find("\"cwd\":\"")? + 7;
    let mut out = String::new();
    let mut chars = text[start..].chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return (!out.is_empty()).then_some(out),
            '\\' => match chars.next()? {
                'n' | 't' | 'r' => return None,
                e => out.push(e),
            },
            c => out.push(c),
        }
    }
    None
}

/// The session id at the end of a Codex rollout file name (a 36-character UUID).
fn codex_id(stem: &str) -> Option<String> {
    let id = stem.get(stem.len().checked_sub(36)?..)?;
    (stem.starts_with("rollout-") && id.chars().filter(|&c| c == '-').count() == 4).then(|| id.to_string())
}

/// Sessions whose log was written in the last `within_ms`.
pub fn recent(dirs: &LogDirs, now: u64, within_ms: u64) -> Vec<LogSession> {
    let fresh = |p: &Path| modified_ms(p).filter(|&m| now.saturating_sub(m) <= within_ms);
    let mut out = Vec::new();
    // Claude: top-level logs of each project folder (subagent logs live in sub-folders)
    for proj in entries(&dirs.claude).into_iter().filter(|p| p.is_dir()) {
        for f in entries(&proj) {
            if f.extension().is_some_and(|e| e == "jsonl") {
                if let (Some(m), Some(id)) = (fresh(&f), f.file_stem().and_then(|s| s.to_str())) {
                    out.push(LogSession { agent: AgentKind::Claude, session_id: id.to_string(), cwd: cwd_near_start(&f), modified: m });
                }
            }
        }
    }
    // Codex: only the two newest day folders (a session started yesterday may still be running)
    let mut days = Vec::new();
    for y in entries(&dirs.codex) {
        for m in entries(&y) {
            days.extend(entries(&m).into_iter().filter(|d| d.is_dir()));
        }
    }
    days.sort();
    for day in days.iter().rev().take(2) {
        for f in entries(day) {
            let Some(id) = f.file_stem().and_then(|s| s.to_str()).and_then(codex_id) else { continue };
            if let Some(m) = fresh(&f) {
                out.push(LogSession { agent: AgentKind::Codex, session_id: id, cwd: cwd_near_start(&f), modified: m });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_the_cwd_value() {
        assert_eq!(cwd_in(r#"{"type":"user","cwd":"/Users/kim/agent-room","message":"secret"}"#).as_deref(), Some("/Users/kim/agent-room"));
        assert_eq!(cwd_in(r#"{"cwd":"C:\\Users\\kim\\app"}"#).as_deref(), Some(r"C:\Users\kim\app"));
        assert_eq!(cwd_in(r#"{"message":"no folder here"}"#), None);
        assert_eq!(cwd_in(r#"{"cwd":"/cut-off"#), None);
    }

    #[test]
    fn codex_ids_come_from_rollout_names() {
        assert_eq!(
            codex_id("rollout-2025-11-05T10-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b").as_deref(),
            Some("0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
        );
        assert_eq!(codex_id("notes"), None);
        assert_eq!(codex_id("history-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"), None);
    }

    #[test]
    fn finds_recent_logs_of_both_agents() {
        let root = std::env::temp_dir().join(format!("agent-room-logs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let claude = root.join("claude");
        let codex = root.join("codex");
        std::fs::create_dir_all(claude.join("-Users-kim-app").join("sub")).unwrap();
        std::fs::write(claude.join("-Users-kim-app").join("abc-123.jsonl"), r#"{"cwd":"/Users/kim/app","sessionId":"abc-123"}"#).unwrap();
        std::fs::write(claude.join("-Users-kim-app").join("sub").join("agent-1.jsonl"), "{}").unwrap();
        for day in ["2025/11/03", "2025/11/04", "2025/11/05"] {
            std::fs::create_dir_all(codex.join(day)).unwrap();
        }
        let id = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
        std::fs::write(codex.join("2025/11/05").join(format!("rollout-2025-11-05T10-00-00-{id}.jsonl")), r#"{"type":"session_meta","payload":{"id":"x","cwd":"/work/api"}}"#).unwrap();
        std::fs::write(codex.join("2025/11/03").join(format!("rollout-2025-11-03T10-00-00-{id}.jsonl")), "{}").unwrap();

        let dirs = LogDirs { claude, codex };
        let now = crate::model::now_ms();
        let mut found = recent(&dirs, now, 60_000);
        found.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        assert_eq!(found.len(), 2, "{found:?}");
        assert_eq!((found[0].agent, found[0].session_id.as_str(), found[0].cwd.as_deref()), (AgentKind::Codex, id, Some("/work/api")));
        assert_eq!((found[1].agent, found[1].session_id.as_str(), found[1].cwd.as_deref()), (AgentKind::Claude, "abc-123", Some("/Users/kim/app")));
        // nothing counts once it is older than the window
        assert!(recent(&dirs, now + 120_000, 60_000).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
