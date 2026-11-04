//! Token usage read from the agent's own local log files (no API calls).
//!
//! Only `usage` / `token_count` numbers are parsed; message text is skipped.

use crate::model::TokenUsage;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

#[derive(Debug, Default)]
pub struct UsageReader {
    offset: u64,
    /// Claude: usage per assistant message id (streamed chunks repeat the same id)
    per_msg: HashMap<String, [u64; 4]>,
    /// Codex: last cumulative total
    codex_total: Option<[u64; 4]>,
}

impl UsageReader {
    /// Reads newly appended complete lines. Returns the current totals if any were found.
    pub fn poll(&mut self, path: &str, codex: bool) -> Option<TokenUsage> {
        let mut f = File::open(path).ok()?;
        let len = f.metadata().ok()?.len();
        if len < self.offset {
            *self = UsageReader::default(); // rotated / truncated
        }
        f.seek(SeekFrom::Start(self.offset)).ok()?;
        let mut buf = Vec::new();
        // cap one read at 64 MiB; the rest is picked up next time
        f.take(64 << 20).read_to_end(&mut buf).ok()?;
        let end = buf.iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
        self.offset += end as u64;
        for line in buf[..end].split(|b| *b == b'\n') {
            if codex {
                if !contains(line, b"token_count") {
                    continue;
                }
                if let Ok(v) = serde_json::from_slice::<Value>(line) {
                    if let Some(t) = v.pointer("/payload/info/total_token_usage") {
                        let g = |k: &str| t.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                        self.codex_total = Some([g("input_tokens"), g("output_tokens"), g("cached_input_tokens"), 0]);
                    }
                }
            } else {
                if !contains(line, b"\"usage\"") {
                    continue;
                }
                if let Ok(v) = serde_json::from_slice::<Value>(line) {
                    let Some(msg) = v.get("message") else { continue };
                    let Some(u) = msg.get("usage") else { continue };
                    let id = msg.get("id").and_then(|x| x.as_str()).or_else(|| v.get("uuid").and_then(|x| x.as_str())).unwrap_or("").to_string();
                    let g = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    self.per_msg.insert(id, [g("input_tokens"), g("output_tokens"), g("cache_read_input_tokens"), g("cache_creation_input_tokens")]);
                }
            }
        }
        let t = if codex {
            self.codex_total?
        } else {
            if self.per_msg.is_empty() {
                return None;
            }
            self.per_msg.values().fold([0u64; 4], |mut a, b| {
                for i in 0..4 {
                    a[i] += b[i];
                }
                a
            })
        };
        Some(TokenUsage {
            input: t[0],
            output: t[1],
            cache_read: t[2],
            cache_write: t[3],
            source: if codex { "codex-rollout" } else { "claude-transcript" }.into(),
        })
    }
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn claude_usage_dedupes_by_message_id() {
        let dir = std::env::temp_dir().join(format!("ar-tok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.jsonl");
        let mut f = File::create(&p).unwrap();
        writeln!(f, r#"{{"type":"user","message":{{"content":"secret"}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"assistant","message":{{"id":"m1","usage":{{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100}}}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"assistant","message":{{"id":"m1","usage":{{"input_tokens":10,"output_tokens":7,"cache_read_input_tokens":100}}}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"assistant","message":{{"id":"m2","usage":{{"input_tokens":3,"output_tokens":1}}}}}}"#).unwrap();
        drop(f);
        let mut r = UsageReader::default();
        let u = r.poll(p.to_str().unwrap(), false).unwrap();
        assert_eq!((u.input, u.output, u.cache_read), (13, 8, 100));
        // incremental: nothing new -> same totals
        assert_eq!(r.poll(p.to_str().unwrap(), false).unwrap().output, 8);
    }

    #[test]
    fn codex_takes_latest_total() {
        let dir = std::env::temp_dir().join(format!("ar-tok2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("r.jsonl");
        std::fs::write(&p, "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":50,\"cached_input_tokens\":20,\"output_tokens\":9}}}}\n").unwrap();
        let u = UsageReader::default().poll(p.to_str().unwrap(), true).unwrap();
        assert_eq!((u.input, u.output, u.cache_read), (50, 9, 20));
    }
}
