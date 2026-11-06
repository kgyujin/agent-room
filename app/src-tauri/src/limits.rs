//! Remaining usage and token history: Codex from its logs, Claude from the account (opt-in).

use super::*;

/// Codex's remaining usage from its newest log, so it shows even with no session open in Agent Room
/// (limits are per account; the desktop app and VS Code write the same logs).
#[tauri::command]
pub(crate) async fn codex_limits() -> Option<agent_room_core::model::RateLimits> {
    agent_room_core::logs::newest_codex_limits(&agent_room_core::logs::LogDirs::from_env())
}

/// Claude's remaining usage from the account, for sessions whose status line never reports it
/// (the desktop app, VS Code). At most one request per 5 minutes, longer after failures.
#[tauri::command]
pub(crate) async fn claude_limits(app: AppHandle) -> Option<agent_room_core::model::RateLimits> {
    static LAST: Mutex<(u64, Option<agent_room_core::model::RateLimits>, u32)> = Mutex::new((0, None, 0));
    if !app.state::<Shared>().settings.lock().unwrap().claude_account_limits {
        return None;
    }
    let now = now_ms();
    {
        let last = LAST.lock().unwrap();
        if now < last.0 {
            return last.1.clone();
        }
    }
    let got = claude_account_usage(now);
    let mut last = LAST.lock().unwrap();
    match got {
        Some(l) => *last = (now + 5 * 60_000, Some(l), 0),
        None => {
            last.2 = (last.2 + 1).min(4);
            last.0 = now + (60_000u64 << last.2).min(15 * 60_000);
        }
    }
    last.1.clone()
}

#[cfg(target_os = "macos")]
pub(crate) fn claude_account_usage(now: u64) -> Option<agent_room_core::model::RateLimits> {
    use std::process::{Command, Stdio};
    // the Keychain item Claude Code writes; `security` is on its access list, so this reads it
    // without a prompt. The token stays in memory and is dropped after the one request.
    let out = run_for(Command::new("/usr/bin/security").args(["find-generic-password", "-s", "Claude Code-credentials", "-w"]), None)?;
    let cred: serde_json::Value = serde_json::from_slice(&out).ok()?;
    let oauth = cred.get("claudeAiOauth")?;
    let token = oauth.get("accessToken")?.as_str()?;
    if token.is_empty() || !token.chars().all(|c| c.is_ascii_graphic() && c != '"' && c != '\\') {
        return None;
    }
    // an expired token is refreshed by Claude Code on its next run, never here
    if oauth.get("expiresAt").and_then(|v| v.as_u64()).is_some_and(|t| t <= now) {
        return None;
    }
    // the token goes to curl on stdin, not its arguments, so other processes cannot see it
    let config = format!(
        "url = \"https://api.anthropic.com/api/oauth/usage\"\nheader = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\nheader = \"Accept: application/json\"\nuser-agent = \"AgentRoom\"\n"
    );
    let mut cmd = Command::new("/usr/bin/curl");
    cmd.args(["-sS", "--fail", "--max-time", "15", "--proto", "=https", "--max-redirs", "0", "-K", "-"]).stdin(Stdio::piped());
    let body = run_for(&mut cmd, Some(config.as_bytes()))?;
    agent_room_core::limits::from_claude_usage(&serde_json::from_slice(&body).ok()?, now)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn claude_account_usage(_now: u64) -> Option<agent_room_core::model::RateLimits> {
    None
}

/// stdout of a command that exits 0 within 20 seconds (killed after that)
#[cfg(target_os = "macos")]
pub(crate) fn run_for(cmd: &mut std::process::Command, stdin: Option<&[u8]>) -> Option<Vec<u8>> {
    use std::io::{Read, Write};
    use std::process::Stdio;
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    if let Some(input) = stdin {
        child.stdin.take()?.write_all(input).ok()?;
    }
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        stdout.read_to_end(&mut buf).ok().map(|_| buf)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let status = loop {
        if let Some(st) = child.try_wait().ok()? {
            break st;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let out = reader.join().ok()??;
    status.success().then_some(out)
}

/// Tokens per local day for the last `days` days, recent rate and streaks, from local logs only.
#[tauri::command]
pub(crate) async fn usage_history(app: AppHandle, tz_offset_min: i64, days: i64) -> agent_room_core::usage::UsageHistory {
    TZ_OFFSET_MIN.store(tz_offset_min.clamp(-840, 840), Ordering::Relaxed);
    let shared = app.state::<Shared>();
    let mut scan = shared.usage.lock().unwrap();
    scan.history(&agent_room_core::logs::LogDirs::from_env(), now_ms() as i64, tz_offset_min.clamp(-840, 840), days.clamp(1, 90))
}
