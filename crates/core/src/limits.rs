//! Remaining plan usage (rate-limit windows), read from what the agents already report locally.
//!
//! * Claude Code: the `rate_limits` object it passes to its status line command (Pro/Max only).
//! * Codex: the `rate_limits` of the latest `token_count` line in its rollout log.
//!
//! Only these numbers are read; message text is skipped. No API calls.

use crate::model::{LimitWindow, RateLimits};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

/// Claude status line input: `{"five_hour": {"used_percentage", "resets_at"}, "seven_day": {...}}`
pub fn from_claude(rl: &Value, at: u64) -> Option<RateLimits> {
    let windows: Vec<LimitWindow> = [("five_hour", 300), ("seven_day", 10080)]
        .iter()
        .filter_map(|(k, minutes)| {
            let w = rl.get(*k)?;
            Some(LimitWindow { minutes: *minutes, used_pct: w.get("used_percentage")?.as_f64()?, resets_at: w.get("resets_at").and_then(Value::as_f64).map(|s| (s * 1000.0) as u64) })
        })
        .collect();
    (!windows.is_empty()).then_some(RateLimits { windows, at })
}

/// Codex rollout `rate_limits`: `{"primary": {"used_percent", "window_minutes", "resets_at" | "resets_in_seconds"}, "secondary": {...}}`
pub fn from_codex(rl: &Value, at: u64) -> Option<RateLimits> {
    let windows: Vec<LimitWindow> = ["primary", "secondary"]
        .iter()
        .filter_map(|k| {
            let w = rl.get(*k)?;
            let resets_at = match w.get("resets_at").and_then(Value::as_f64) {
                Some(s) => Some((s * 1000.0) as u64),
                None => w.get("resets_in_seconds").and_then(Value::as_f64).map(|s| at + (s * 1000.0) as u64),
            };
            Some(LimitWindow { minutes: w.get("window_minutes").and_then(Value::as_u64).unwrap_or(0) as u32, used_pct: w.get("used_percent")?.as_f64()?, resets_at })
        })
        .collect();
    (!windows.is_empty()).then_some(RateLimits { windows, at })
}

/// Windows with at most `pct_left` percent left that have not been reported yet in their
/// current reset period. `warned` remembers (agent, window) -> reset time already reported,
/// so each window warns once per period and again after it resets.
pub fn newly_low(agent: &str, l: &RateLimits, pct_left: f64, warned: &mut HashMap<(String, u32), u64>) -> Vec<LimitWindow> {
    let mut out = Vec::new();
    for w in &l.windows {
        if 100.0 - w.used_pct > pct_left {
            continue;
        }
        let period = w.resets_at.unwrap_or(0);
        let key = (agent.to_string(), w.minutes);
        // a reset time that moves by a minute or two is the same period (Codex derives it from a countdown)
        if warned.get(&key).is_some_and(|p| p.abs_diff(period) < 10 * 60_000) {
            continue;
        }
        warned.insert(key, period);
        out.push(w.clone());
    }
    out
}

/// Follows a Codex rollout log and keeps the latest rate-limit numbers.
#[derive(Debug, Default)]
pub struct CodexLogReader {
    offset: u64,
}

impl CodexLogReader {
    /// Reads newly appended complete lines. Returns the latest limits found in them, if any.
    pub fn poll(&mut self, path: &str, at: u64) -> Option<RateLimits> {
        let mut f = File::open(path).ok()?;
        let len = f.metadata().ok()?.len();
        if len < self.offset {
            self.offset = 0; // rotated / truncated
        }
        f.seek(SeekFrom::Start(self.offset)).ok()?;
        let mut buf = Vec::new();
        // cap one read at 64 MiB; the rest is picked up next time
        f.take(64 << 20).read_to_end(&mut buf).ok()?;
        let end = buf.iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
        self.offset += end as u64;
        let mut last = None;
        for line in buf[..end].split(|b| *b == b'\n') {
            if !contains(line, b"rate_limits") {
                continue;
            }
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                if let Some(l) = v.pointer("/payload/rate_limits").and_then(|rl| from_codex(rl, at)) {
                    last = Some(l);
                }
            }
        }
        last
    }
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_status_line_windows() {
        let l = from_claude(&json!({"five_hour": {"used_percentage": 23.5, "resets_at": 1_700_000_000}, "seven_day": {"used_percentage": 41}}), 1).unwrap();
        assert_eq!(l.windows.len(), 2);
        assert_eq!((l.windows[0].minutes, l.windows[0].used_pct, l.windows[0].resets_at), (300, 23.5, Some(1_700_000_000_000)));
        assert_eq!((l.windows[1].minutes, l.windows[1].resets_at), (10080, None));
        assert!(from_claude(&json!({}), 1).is_none());
    }

    #[test]
    fn low_warning_fires_once_per_period() {
        let mut warned = HashMap::new();
        let l = |used: f64, reset: u64| RateLimits { windows: vec![LimitWindow { minutes: 300, used_pct: used, resets_at: Some(reset) }], at: 0 };
        assert!(newly_low("claude", &l(85.0, 1_000_000), 10.0, &mut warned).is_empty(), "15% left is fine");
        assert_eq!(newly_low("claude", &l(90.0, 1_000_000), 10.0, &mut warned).len(), 1, "exactly 10% left warns");
        assert!(newly_low("claude", &l(95.0, 1_060_000), 10.0, &mut warned).is_empty(), "same period, jittered reset");
        assert_eq!(newly_low("codex", &l(95.0, 1_000_000), 10.0, &mut warned).len(), 1, "other agent is separate");
        assert_eq!(newly_low("claude", &l(92.0, 1_000_000 + 5 * 3_600_000), 10.0, &mut warned).len(), 1, "next period warns again");
    }

    #[test]
    fn codex_takes_latest_limits() {
        let dir = std::env::temp_dir().join(format!("ar-lim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("r.jsonl");
        let line = |pct: f64| format!("{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"rate_limits\":{{\"primary\":{{\"used_percent\":{pct},\"window_minutes\":300,\"resets_in_seconds\":60}},\"secondary\":{{\"used_percent\":5.0,\"window_minutes\":10080,\"resets_at\":1700000000}}}}}}}}\n");
        std::fs::write(&p, line(10.0) + "{\"type\":\"response_item\",\"payload\":{\"content\":\"secret\"}}\n" + &line(12.5)).unwrap();
        let mut r = CodexLogReader::default();
        let l = r.poll(p.to_str().unwrap(), 1000).unwrap();
        assert_eq!((l.windows[0].used_pct, l.windows[0].resets_at), (12.5, Some(61_000)));
        assert_eq!(l.windows[1].resets_at, Some(1_700_000_000_000));
        // incremental: nothing new -> nothing returned
        assert!(r.poll(p.to_str().unwrap(), 2000).is_none());
    }
}
