//! A readable name for a session, read from the agent's own transcript on this computer:
//! the name the user gave it (Claude Code `/rename`), else the summary Claude Code wrote,
//! else the first thing the user asked (one line, cut short, credentials masked).
//! The log is read incrementally (only bytes added since the last read); nothing is stored
//! or sent anywhere, and no model is asked.

use crate::sanitize::{redact_command, truncate};
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};

const MAX_CHARS: usize = 48;
/// at most this much new log is read per call; the rest waits for the next one
const MAX_READ: u64 = 4 * 1024 * 1024;

#[derive(Debug, Default)]
pub struct ChatTitleReader {
    offset: u64,
    rest: String,
    named: Option<String>,
    summary: Option<String>,
    first: Option<String>,
}

impl ChatTitleReader {
    /// Reads what the log gained and returns the best title so far.
    pub fn poll(&mut self, path: &str) -> Option<String> {
        if let Ok(mut f) = std::fs::File::open(path) {
            let len = f.metadata().map(|m| m.len()).unwrap_or(0);
            if len < self.offset {
                *self = Self::default();
            }
            if len > self.offset && f.seek(SeekFrom::Start(self.offset)).is_ok() {
                let mut buf = Vec::new();
                if f.take(MAX_READ).read_to_end(&mut buf).is_ok() {
                    self.offset += buf.len() as u64;
                    self.rest.push_str(&String::from_utf8_lossy(&buf));
                    let text = std::mem::take(&mut self.rest);
                    let mut lines: Vec<&str> = text.split('\n').collect();
                    // an unfinished last line waits for the rest of it
                    self.rest = lines.pop().unwrap_or_default().to_string();
                    for line in lines {
                        self.line(line);
                    }
                }
            }
        }
        self.title()
    }

    pub fn title(&self) -> Option<String> {
        self.named.clone().or_else(|| self.summary.clone()).or_else(|| self.first.clone())
    }

    fn line(&mut self, line: &str) {
        // cheap filter before parsing: only the few line kinds that can carry a name
        if !(line.contains("custom-title") || line.contains("\"summary\"") || (self.first.is_none() && (line.contains("\"user\"") || line.contains("user_message")))) {
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { return };
        let s = |v: Option<&Value>| v.and_then(Value::as_str).and_then(clean);
        match v.get("type").and_then(Value::as_str) {
            Some("custom-title") => {
                if let Some(t) = s(v.get("customTitle")) {
                    self.named = Some(t);
                }
            }
            Some("summary") => {
                if let Some(t) = s(v.get("summary")) {
                    self.summary = Some(t);
                }
            }
            // Claude Code: a user turn (skipping meta lines and tool results)
            Some("user") if self.first.is_none() && v.get("isMeta").and_then(Value::as_bool) != Some(true) => {
                let c = v.pointer("/message/content");
                let text = match c {
                    Some(Value::String(t)) => Some(t.as_str()),
                    Some(Value::Array(a)) => a.iter().find(|b| b.get("type").and_then(Value::as_str) == Some("text")).and_then(|b| b.get("text")).and_then(Value::as_str),
                    _ => None,
                };
                self.first = text.and_then(clean);
            }
            // Codex rollout: the user's message event
            Some("event_msg") if self.first.is_none() && v.pointer("/payload/type").and_then(Value::as_str) == Some("user_message") => {
                self.first = s(v.pointer("/payload/message"));
            }
            _ => {}
        }
    }
}

/// One readable line: skips the agents' own wrapped blocks (`<command-name>`, `<environment_context>`, …)
fn clean(t: &str) -> Option<String> {
    let line = t.lines().map(str::trim).find(|l| !l.is_empty())?;
    if line.starts_with('<') || line.starts_with("Caveat:") {
        return None;
    }
    let one = line.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(truncate(&redact_command(&one), MAX_CHARS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("ar-title-{}-{name}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p.display().to_string()
    }

    fn log(name: &str, lines: &[&str]) -> String {
        let p = tmp(name);
        let mut f = std::fs::File::create(&p).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        p
    }

    #[test]
    fn prefers_the_given_name_then_the_summary_then_the_first_ask() {
        let p = log("claude", &[
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Caveat: local commands"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"  로그인 버그 고쳐줘\nstack trace below"}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":"second ask"}}"#,
        ]);
        let mut r = ChatTitleReader::default();
        assert_eq!(r.poll(&p).as_deref(), Some("로그인 버그 고쳐줘"));
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        writeln!(f, r#"{{"type":"summary","summary":"Fix login redirect","leafUuid":"x"}}"#).unwrap();
        assert_eq!(r.poll(&p).as_deref(), Some("Fix login redirect"));
        writeln!(f, r#"{{"type":"custom-title","customTitle":"talent graph API"}}"#).unwrap();
        assert_eq!(r.poll(&p).as_deref(), Some("talent graph API"));
    }

    #[test]
    fn reads_codex_user_messages_and_masks_secrets() {
        let p = log("codex", &[
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"<environment_context>cwd</environment_context>"}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"deploy with API_TOKEN=abc123 please"}}"#,
        ]);
        let t = ChatTitleReader::default().poll(&p).unwrap();
        assert!(!t.contains("abc123"), "{t}");
        assert!(t.starts_with("deploy with"));
    }

    #[test]
    fn waits_for_an_unfinished_line() {
        let p = tmp("half");
        let mut f = std::fs::File::create(&p).unwrap();
        write!(f, r#"{{"type":"user","message":{{"content":"half"#).unwrap();
        let mut r = ChatTitleReader::default();
        assert_eq!(r.poll(&p), None);
        writeln!(f, r#" done"}}}}"#).unwrap();
        assert_eq!(r.poll(&p).as_deref(), Some("half done"));
    }
}
