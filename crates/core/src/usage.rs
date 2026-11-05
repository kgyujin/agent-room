//! Token usage over time, from the agents' own local session logs.
//!
//! Only the usage counters are read: Claude Code's `message.usage` numbers (with the message id,
//! so a message logged several times or copied into a resumed session counts once) and Codex's
//! cumulative `total_token_usage.total_tokens` from its `token_count` events. Prompts, replies,
//! code and file names are never kept. No network, no LLM calls.
//!
//! Each log is read once and then only from where it ended, so a refresh costs little.

use crate::logs::LogDirs;
use crate::model::AgentKind;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const DAY: i64 = 86_400_000;
/// how far back logs are read, whatever range the chart shows, so streaks do not depend on the view
const SCAN_DAYS: i64 = 365;

/// One counted model call: when, which agent, how many tokens.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Hit {
    at: i64,
    tokens: u64,
}

#[derive(Default)]
struct FileState {
    /// bytes already read (always at a line end)
    offset: u64,
    hits: Vec<Hit>,
    /// Codex: the cumulative total seen last, so each event adds only what is new
    codex_total: u64,
    /// Claude message ids this file added to the scanner's `seen` set
    ids: Vec<u64>,
}

#[derive(Default)]
pub struct UsageScanner {
    files: HashMap<PathBuf, FileState>,
    /// Claude message ids already counted (a message is logged once per content block, and a
    /// resumed session repeats the earlier messages)
    seen: HashSet<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DayTokens {
    /// local day, as days since 1970-01-01
    pub day: i64,
    pub claude: u64,
    pub codex: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistory {
    /// one entry per day, oldest first, `days` long (days without use are 0)
    pub days: Vec<DayTokens>,
    /// tokens in the last 10 minutes
    pub recent_claude: u64,
    pub recent_codex: u64,
    /// days in a row with any use: the longest run and the one that reaches today (or yesterday)
    pub streak_longest: u32,
    pub streak_current: u32,
}

impl UsageScanner {
    /// Reads what is new in every log written in the last year and sums tokens per local day for
    /// the last `days` days. Streaks use the whole year.
    /// `tz_offset_min` is the local offset from UTC (e.g. +540 for KST).
    pub fn history(&mut self, dirs: &LogDirs, now: i64, tz_offset_min: i64, days: i64) -> UsageHistory {
        let since = now - SCAN_DAYS.max(days) * DAY - DAY;
        for (agent, path) in log_files(dirs, since) {
            self.read_new(agent, &path);
        }
        self.files.retain(|p, _| p.exists());
        summarize(self.files.iter().map(|(p, f)| (is_codex(p, dirs), &f.hits)), now, tz_offset_min, days)
    }

    fn read_new(&mut self, agent: AgentKind, path: &Path) {
        let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let st = self.files.entry(path.to_path_buf()).or_default();
        if len < st.offset {
            // the log was rewritten: start over, and let its messages be counted again
            for id in &st.ids {
                self.seen.remove(id);
            }
            *st = FileState::default();
        }
        if len == st.offset {
            return;
        }
        let Ok(mut f) = std::fs::File::open(path) else { return };
        if f.seek(SeekFrom::Start(st.offset)).is_err() {
            return;
        }
        let mut buf = Vec::new();
        if f.take(len - st.offset).read_to_end(&mut buf).is_err() {
            return;
        }
        // only whole lines; a line still being written is read next time
        let Some(end) = buf.iter().rposition(|&b| b == b'\n') else { return };
        st.offset += end as u64 + 1;
        for line in buf[..end].split(|&b| b == b'\n') {
            match agent {
                AgentKind::Claude => {
                    if let Some((id, hit)) = claude_line(line) {
                        if self.seen.insert(id) {
                            st.ids.push(id);
                            st.hits.push(hit);
                        }
                    }
                }
                _ => {
                    if let Some((at, total)) = codex_line(line) {
                        if total > st.codex_total {
                            st.hits.push(Hit { at, tokens: total - st.codex_total });
                            st.codex_total = total;
                        }
                    }
                }
            }
        }
    }
}

fn is_codex(p: &Path, dirs: &LogDirs) -> bool {
    p.starts_with(&dirs.codex)
}

fn summarize<'a>(files: impl Iterator<Item = (bool, &'a Vec<Hit>)>, now: i64, tz_offset_min: i64, days: i64) -> UsageHistory {
    let local_day = |t: i64| (t + tz_offset_min * 60_000).div_euclid(DAY);
    let today = local_day(now);
    let first = today - days + 1;
    let mut out = UsageHistory { days: (first..=today).map(|day| DayTokens { day, ..Default::default() }).collect(), ..Default::default() };
    let mut active: HashSet<i64> = HashSet::new();
    for (codex, hits) in files {
        for h in hits {
            let d = local_day(h.at);
            active.insert(d);
            if let Some(slot) = d.checked_sub(first).and_then(|i| out.days.get_mut(i as usize)) {
                if codex { slot.codex += h.tokens } else { slot.claude += h.tokens }
            }
            if now - h.at <= 10 * 60_000 && h.at <= now {
                if codex { out.recent_codex += h.tokens } else { out.recent_claude += h.tokens }
            }
        }
    }
    let mut sorted: Vec<i64> = active.into_iter().collect();
    sorted.sort();
    let mut run = 0u32;
    let mut prev: Option<i64> = None;
    for &d in &sorted {
        run = if prev == Some(d - 1) { run + 1 } else { 1 };
        out.streak_longest = out.streak_longest.max(run);
        prev = Some(d);
    }
    // the current run counts while today or yesterday was active (today may not have started yet)
    if let Some(&last) = sorted.last() {
        if last >= today - 1 {
            out.streak_current = run;
        }
    }
    out
}

/// Logs written since `since` (unix ms): Claude's project logs (subagents included), Codex rollouts.
fn log_files(dirs: &LogDirs, since: i64) -> Vec<(AgentKind, PathBuf)> {
    let fresh = |p: &Path| {
        std::fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .is_some_and(|d| d.as_millis() as i64 >= since)
    };
    let mut out = Vec::new();
    walk(&dirs.claude, 3, &mut |p| {
        if p.extension().is_some_and(|e| e == "jsonl") && fresh(p) {
            out.push((AgentKind::Claude, p.to_path_buf()));
        }
    });
    walk(&dirs.codex, 4, &mut |p| {
        let rollout = p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"));
        if rollout && fresh(p) {
            out.push((AgentKind::Codex, p.to_path_buf()));
        }
    });
    out
}

fn walk(dir: &Path, depth: u32, f: &mut dyn FnMut(&Path)) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                walk(&p, depth - 1, f);
            }
        } else {
            f(&p);
        }
    }
}

/// A Claude Code assistant line: (message id hash, time and tokens of its usage counters).
fn claude_line(line: &[u8]) -> Option<(u64, Hit)> {
    // cheap filter before parsing: only lines with usage counters
    if !contains(line, b"\"usage\"") || !contains(line, b"\"assistant\"") {
        return None;
    }
    let v: Value = serde_json::from_slice(line).ok()?;
    let msg = v.get("message")?;
    let u = msg.get("usage")?;
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    let tokens = n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
    if tokens == 0 {
        return None;
    }
    let at = iso_ms(v.get("timestamp")?.as_str()?)?;
    let id = msg.get("id").and_then(Value::as_str).or_else(|| v.get("requestId").and_then(Value::as_str)).or_else(|| v.get("uuid").and_then(Value::as_str))?;
    Some((hash(id), Hit { at, tokens }))
}

/// A Codex `token_count` event: (time, cumulative total tokens of the session).
fn codex_line(line: &[u8]) -> Option<(i64, u64)> {
    if !contains(line, b"\"token_count\"") {
        return None;
    }
    let v: Value = serde_json::from_slice(line).ok()?;
    let p = v.get("payload")?;
    if p.get("type")?.as_str()? != "token_count" {
        return None;
    }
    let total = p.get("info")?.get("total_token_usage")?.get("total_tokens")?.as_u64()?;
    Some((iso_ms(v.get("timestamp")?.as_str()?)?, total))
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

fn hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// `2026-11-05T06:12:00.123Z` (or with an offset like `+09:00`) as unix ms.
pub(crate) fn iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, sec) = (num(0, 4)?, num(5, 7)?, num(8, 10)?, num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let mut i = 19;
    let mut ms = 0;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while b.get(i).is_some_and(|c| c.is_ascii_digit()) {
            i += 1;
        }
        let frac = &s[start..i];
        ms = frac.get(..3.min(frac.len()))?.parse::<i64>().ok()? * 10i64.pow(3 - frac.len().min(3) as u32);
    }
    let off = match b.get(i) {
        Some(b'Z') | None => 0,
        Some(&c) if c == b'+' || c == b'-' => {
            let sign = if c == b'+' { 1 } else { -1 };
            sign * (num(i + 1, i + 3)? * 60 + num(i + 4, i + 6)?) * 60_000
        }
        _ => return None,
    };
    // days from civil (Howard Hinnant)
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * DAY + ((h * 60 + mi) * 60 + sec) * 1000 + ms - off)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_timestamps() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("2026-11-05T06:12:00.123Z"), Some(1_793_859_120_123));
        assert_eq!(iso_ms("2026-11-05T15:12:00.123+09:00"), Some(1_793_859_120_123));
        assert_eq!(iso_ms("2026-11-05T06:12:00.5Z"), Some(1_793_859_120_500));
        assert_eq!(iso_ms("not a time"), None);
    }

    #[test]
    fn reads_only_usage_counters() {
        let line = br#"{"type":"assistant","timestamp":"2026-11-05T06:12:00Z","message":{"id":"msg_1","content":[{"type":"text","text":"secret"}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":0}}}"#;
        let (_, hit) = claude_line(line).unwrap();
        assert_eq!(hit.tokens, 115);
        assert_eq!(claude_line(br#"{"type":"user","message":{"content":"hi"}}"#), None);
        let c = br#"{"timestamp":"2026-11-05T06:12:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":4200},"last_token_usage":{"total_tokens":200}}}}"#;
        assert_eq!(codex_line(c), Some((1_793_859_120_000, 4200)));
        assert_eq!(codex_line(br#"{"type":"event_msg","payload":{"type":"token_count","info":null}}"#), None);
    }

    #[test]
    fn sums_days_once_per_message_and_counts_streaks() {
        let root = std::env::temp_dir().join(format!("agent-room-usage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dirs = LogDirs { claude: root.join("claude"), codex: root.join("codex") };
        std::fs::create_dir_all(dirs.claude.join("proj")).unwrap();
        std::fs::create_dir_all(dirs.codex.join("2026/11/05")).unwrap();
        let cl = |id: &str, t: &str, n: u64| format!("{{\"type\":\"assistant\",\"timestamp\":\"{t}\",\"message\":{{\"id\":\"{id}\",\"usage\":{{\"input_tokens\":{n},\"output_tokens\":0}}}}}}\n");
        // msg a is logged twice (two content blocks) and copied into a resumed session: counted once
        let a = cl("a", "2026-11-05T01:00:00Z", 100);
        std::fs::write(dirs.claude.join("proj/s1.jsonl"), format!("{a}{a}{}", cl("b", "2026-11-04T01:00:00Z", 50))).unwrap();
        std::fs::write(dirs.claude.join("proj/s2.jsonl"), format!("{a}{}", cl("c", "2026-11-02T01:00:00Z", 7))).unwrap();
        let cx = |t: &str, total: u64| format!("{{\"timestamp\":\"{t}\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"total_tokens\":{total}}}}}}}}}\n");
        let rollout = dirs.codex.join("2026/11/05/rollout-2026-11-05T00-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl");
        // the same total repeated adds nothing
        std::fs::write(&rollout, format!("{}{}{}", cx("2026-11-05T02:00:00Z", 300), cx("2026-11-05T02:00:01Z", 300), cx("2026-11-05T02:05:00Z", 500))).unwrap();

        let now = iso_ms("2026-11-05T02:08:00Z").unwrap();
        let mut sc = UsageScanner::default();
        let h = sc.history(&dirs, now, 0, 7);
        assert_eq!(h.days.len(), 7);
        let today = h.days.last().unwrap();
        assert_eq!((today.claude, today.codex), (100, 500));
        assert_eq!(h.days[h.days.len() - 2].claude, 50);
        assert_eq!(h.days[h.days.len() - 4].claude, 7);
        // last 10 minutes: only codex's two events
        assert_eq!((h.recent_claude, h.recent_codex), (0, 500));
        // 11-02, then 11-04 and 11-05 in a row
        assert_eq!((h.streak_longest, h.streak_current), (2, 2));

        // appended lines are read on the next refresh, the old ones are not counted again
        use std::io::Write;
        std::fs::OpenOptions::new().append(true).open(&rollout).unwrap().write_all(cx("2026-11-05T02:07:00Z", 900).as_bytes()).unwrap();
        let h = sc.history(&dirs, now, 0, 7);
        assert_eq!(h.days.last().unwrap().codex, 900);

        // a rewritten (shorter) log is read again from the start and keeps its messages
        std::fs::write(dirs.claude.join("proj/s1.jsonl"), format!("{a}{}", cl("b", "2026-11-04T01:00:00Z", 50))).unwrap();
        let h = sc.history(&dirs, now, 0, 7);
        assert_eq!((h.days[5].claude, h.days[6].claude), (50, 100));

        // streaks come from older logs too, not only the days the chart shows (11-02 to 11-05)
        let old = dirs.claude.join("proj/s3.jsonl");
        std::fs::write(&old, cl("d", "2026-11-03T01:00:00Z", 1)).unwrap();
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_millis(iso_ms("2026-11-03T01:00:00Z").unwrap() as u64);
        std::fs::File::options().write(true).open(&old).unwrap().set_modified(t).unwrap();
        let h = UsageScanner::default().history(&dirs, now, 0, 1);
        assert_eq!(h.days.len(), 1);
        assert_eq!((h.streak_longest, h.streak_current), (4, 4));
        let _ = std::fs::remove_dir_all(&root);
    }
}
