//! Optional local history of the timeline, so a past day can be looked at again.
//!
//! Off unless the user sets a retention. Each UTC day is one JSON-lines file in
//! `~/.agent-room/history/` (0600, directory 0700) holding the same redacted timeline entries the
//! UI shows; files older than the retention are deleted. Nothing leaves the computer.

use crate::session::TimelineEntry;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

const DAY_MS: u64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistLine {
    pub key: String,
    pub agent: String,
    pub project: Option<String>,
    pub entry: TimelineEntry,
}

pub fn dir() -> PathBuf {
    crate::paths::data_dir().join("history")
}

fn file_of(dir: &Path, day: u64) -> PathBuf {
    dir.join(format!("{day}.jsonl"))
}

/// Appends entries to the file of the UTC day each one happened on.
pub fn append(dir: &Path, lines: &[HistLine]) -> std::io::Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    crate::paths::ensure_private_dir(dir)?;
    for l in lines {
        let path = file_of(dir, l.entry.at / DAY_MS);
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        crate::paths::make_private(&path)?;
        let mut raw = serde_json::to_vec(l).map_err(std::io::Error::other)?;
        raw.push(b'\n');
        f.write_all(&raw)?;
    }
    Ok(())
}

/// Entries with `from <= at < to`, oldest first.
pub fn read(dir: &Path, from: u64, to: u64) -> Vec<HistLine> {
    let mut out = Vec::new();
    if to <= from {
        return out;
    }
    for day in from / DAY_MS..=(to - 1) / DAY_MS {
        let Ok(raw) = std::fs::read_to_string(file_of(dir, day)) else { continue };
        out.extend(raw.lines().filter_map(|l| serde_json::from_str::<HistLine>(l).ok()).filter(|l| l.entry.at >= from && l.entry.at < to));
    }
    out.sort_by_key(|l| l.entry.at);
    out
}

/// Deletes day files older than `keep_days` (0 deletes every file).
pub fn prune(dir: &Path, now: u64, keep_days: u64) {
    let first_kept = (now / DAY_MS).saturating_sub(keep_days.saturating_sub(1));
    for f in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = f.file_name();
        let Some(day) = name.to_str().and_then(|n| n.strip_suffix(".jsonl")).and_then(|d| d.parse::<u64>().ok()) else { continue };
        if keep_days == 0 || day < first_kept {
            let _ = std::fs::remove_file(f.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(at: u64) -> HistLine {
        HistLine {
            key: "claude:a".into(),
            agent: "claude".into(),
            project: Some("web".into()),
            entry: TimelineEntry { id: at, at, kind: "tool".into(), activity: None, tool: Some("Edit".into()), detail: Some("a.ts".into()), ok: None },
        }
    }

    #[test]
    fn append_read_prune() {
        let dir = std::env::temp_dir().join(format!("agent-room-hist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let today = 20_000 * DAY_MS;
        append(&dir, &[line(today - 2 * DAY_MS), line(today + 5), line(today + 9)]).unwrap();
        assert_eq!(read(&dir, today, today + DAY_MS).len(), 2);
        assert_eq!(read(&dir, today + 6, today + DAY_MS), vec![line(today + 9)]);
        prune(&dir, today, 2);
        assert!(read(&dir, today - 2 * DAY_MS, today).is_empty());
        assert_eq!(read(&dir, today, today + DAY_MS).len(), 2);
        prune(&dir, today, 0);
        assert!(read(&dir, 0, today + DAY_MS).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
