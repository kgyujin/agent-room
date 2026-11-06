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
/// `why` says why there is no answer: "login" (not signed in to Claude Code here),
/// "expired" (Claude Code refreshes the token on its next run) or "failed" (the request failed).
#[derive(serde::Serialize, Clone, Default)]
pub(crate) struct ClaudeLimits {
    limits: Option<agent_room_core::model::RateLimits>,
    why: Option<&'static str>,
}

#[tauri::command]
pub(crate) async fn claude_limits(app: AppHandle) -> ClaudeLimits {
    static LAST: Mutex<(u64, ClaudeLimits, u32)> = Mutex::new((0, ClaudeLimits { limits: None, why: None }, 0));
    // with usage hidden the account isn't asked either (that switch is hidden then, so it couldn't be turned off)
    let shared = app.state::<Shared>();
    let on = { let st = shared.settings.lock().unwrap(); st.show_limits && st.claude_account_limits };
    if !on {
        return ClaudeLimits::default();
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
        Ok(l) => *last = (now + 5 * 60_000, ClaudeLimits { limits: Some(l), why: None }, 0),
        Err(why) => {
            last.2 = (last.2 + 1).min(4);
            last.0 = now + (60_000u64 << last.2).min(15 * 60_000);
            last.1.why = Some(why);
        }
    }
    last.1.clone()
}

#[cfg(target_os = "macos")]
pub(crate) fn claude_account_usage(now: u64) -> Result<agent_room_core::model::RateLimits, &'static str> {
    use std::process::{Command, Stdio};
    // the Keychain item Claude Code writes; `security` is on its access list, so this reads it
    // without a prompt. The token stays in memory and is dropped after the one request.
    let out = run_for(Command::new("/usr/bin/security").args(["find-generic-password", "-s", "Claude Code-credentials", "-w"]), None).ok_or("login")?;
    let cred: serde_json::Value = serde_json::from_slice(&out).map_err(|_| "login")?;
    let oauth = cred.get("claudeAiOauth").ok_or("login")?;
    let token = oauth.get("accessToken").and_then(|t| t.as_str()).ok_or("login")?;
    if token.is_empty() || !token.chars().all(|c| c.is_ascii_graphic() && c != '"' && c != '\\') {
        return Err("login");
    }
    // an expired token is refreshed by Claude Code on its next run, never here
    if oauth.get("expiresAt").and_then(|v| v.as_u64()).is_some_and(|t| t <= now) {
        return Err("expired");
    }
    // the token goes to curl on stdin, not its arguments, so other processes cannot see it
    let config = format!(
        "url = \"https://api.anthropic.com/api/oauth/usage\"\nheader = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\nheader = \"Accept: application/json\"\nuser-agent = \"AgentRoom\"\n"
    );
    let mut cmd = Command::new("/usr/bin/curl");
    cmd.args(["-sS", "--fail", "--max-time", "15", "--proto", "=https", "--max-redirs", "0", "-K", "-"]).stdin(Stdio::piped());
    let body = run_for(&mut cmd, Some(config.as_bytes())).ok_or("failed")?;
    let json = serde_json::from_slice(&body).map_err(|_| "failed")?;
    agent_room_core::limits::from_claude_usage(&json, now).ok_or("failed")
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn claude_account_usage(_now: u64) -> Result<agent_room_core::model::RateLimits, &'static str> {
    Err("login")
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
