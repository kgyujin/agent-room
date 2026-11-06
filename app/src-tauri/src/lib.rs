//! Agent Room desktop shell: IPC server, session store, tray, notifications, commands.
//! The UI (React + Canvas) only renders snapshots pushed from here.

mod demo;
mod files;
mod focus;
mod limits;
mod notify;
mod settings;
mod tray;
mod windows;

use files::*;
use limits::*;
use notify::*;
use settings::*;
use tray::*;
use windows::*;

use agent_room_core::adapters::{normalize, Envelope};
use agent_room_core::install::{self, HookStatus, Target};
use agent_room_core::model::{now_ms, AgentState, NormEvent};
use agent_room_core::runtime::{self, ProcWatch};
use agent_room_core::session::{Notice, SessionStore, Snapshot, TimelineEntry, Update};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// Set only when this process bound the hook socket, so a second instance
/// (which fails with AddrInUse) never unlinks the running instance's socket.
static OWNS_SOCKET: AtomicBool = AtomicBool::new(false);

/// When the popover last closed by losing focus; a click on the menu bar icon right after
/// that is the same click that closed it, so it must not reopen it.
static POPOVER_HIDDEN_AT: AtomicU64 = AtomicU64::new(0);
/// the UI language is English (set by the UI from its settings); menus and notifications follow it
static LANG_EN: AtomicBool = AtomicBool::new(false);

/// the Korean or English text, whichever the UI shows
fn tr(ko: &'static str, en: &'static str) -> &'static str {
    if LANG_EN.load(Ordering::Relaxed) { en } else { ko }
}

fn is_en() -> bool {
    LANG_EN.load(Ordering::Relaxed)
}

/// the UI's local offset from UTC in minutes (it comes with every usage request), for quiet hours
static TZ_OFFSET_MIN: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

#[derive(Default)]
struct Shared {
    store: Mutex<SessionStore>,
    /// token totals per day, read from the agents' own logs (usage counters only)
    usage: Mutex<agent_room_core::usage::UsageScanner>,
    procs: Mutex<ProcWatch>,
    settings: Mutex<Settings>,
    detected: Mutex<(u32, u32)>,
    server_error: Mutex<Option<String>>,
    demo_stop: Mutex<Option<Arc<AtomicBool>>>,
    /// (agent, window minutes) -> reset time already warned about (low remaining usage)
    limit_warned: Mutex<std::collections::HashMap<(String, u32), u64>>,
    /// sessions that sent hook events (their logs are not followed)
    hooked: Mutex<std::collections::HashSet<String>>,
    /// sessions known only from their log: key -> last write seen
    log_only: Mutex<std::collections::HashMap<String, u64>>,
    /// menu bar frames drawn by the app from the chosen pet (run0..3, wait, done, idle, off);
    /// None until then, and the bundled shiba frames are used. The number counts the updates.
    tray_frames: Mutex<Option<(u64, Arc<Vec<Vec<u8>>>)>>,
    /// session key -> the Claude desktop app's own id for it (Code-tab sessions only)
    desktop_ids: Mutex<std::collections::HashMap<String, String>>,
    /// permission requests waiting for an answer in the app (opt-in): session key -> (deadline, reply)
    approvals: Mutex<std::collections::HashMap<String, (u64, std::sync::mpsc::Sender<Vec<u8>>)>>,
    /// requests already notified a second time: (session key, waiting since)
    renotified: Mutex<std::collections::HashSet<(String, u64)>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Overview {
    sessions: Vec<Snapshot>,
    detected: Detected,
    server_error: Option<String>,
    demo_running: bool,
}

#[derive(Serialize, Clone, Copy, PartialEq)]
struct Detected {
    claude: u32,
    codex: u32,
}

/// Pushes one session change to the UI, the tray and (if enabled) a system notification.
fn publish(app: &AppHandle, u: Update) {
    let _ = app.emit("session-update", &u);
    if !u.appended.is_empty() && !u.snapshot.is_demo && app.state::<Shared>().settings.lock().unwrap().history_days > 0 {
        use agent_room_core::history::{self, HistLine};
        let lines: Vec<HistLine> = u.appended.iter().map(|e| HistLine { key: u.snapshot.key.clone(), agent: u.snapshot.agent.as_str().into(), project: u.snapshot.project.clone(), entry: e.clone() }).collect();
        let _ = history::append(&history::dir(), &lines);
    }
    if let Some(n) = u.notice {
        notify(app, &u.snapshot, n);
    }
    if let Some(l) = &u.snapshot.limits {
        notify_low_limits(app, &u.snapshot, l);
    }
    refresh_tray(app);
    sync_island(app);
}

/// With "일이 없을 땐 숨기기" on, the island shows only while an agent works, waits on the user,
/// or has just finished (for as long as "완료" is shown). The window is hidden, not destroyed.
fn sync_island(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let st = shared.settings.lock().unwrap().clone();
    let Some(w) = app.get_webview_window("island") else { return };
    let busy = || {
        let now = now_ms();
        shared.store.lock().unwrap().snapshots().iter().any(|s| {
            use agent_room_core::session::Connection;
            if !matches!(s.connection, Connection::Live | Connection::Stale) {
                return false;
            }
            match s.state {
                AgentState::Idle | AgentState::Disconnected => false,
                AgentState::Completed => st.done_shown_sec == 0 || s.turn_ended_at.is_some_and(|t| now.saturating_sub(t) < st.done_shown_sec as u64 * 1000),
                _ => true,
            }
        })
    };
    let show = !st.island_hide_idle || busy();
    if show {
        // also after a display was plugged in or out, or its resolution changed
        place_island(app, &w, ISLAND_WIN.0, ISLAND_WIN.1);
    }
    if show != w.is_visible().unwrap_or(true) {
        let _ = if show { w.show() } else { w.hide() };
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn handle_envelope(app: &AppHandle, env: Envelope) -> Option<std::sync::mpsc::Receiver<Vec<u8>>> {
    let shared = app.state::<Shared>();
    let hook_event = env.event.get("hook_event_name").and_then(|v| v.as_str());
    let asks = env.agent == "claude" && hook_event == Some("PermissionRequest");
    let session = env.event.get("session_id").and_then(|v| v.as_str()).map(|id| format!("claude:{id}"));
    // the turn ended or a new prompt came in: an open request is over. Other events (the status
    // line, a parallel tool, a subagent) don't answer it, so the request stays open for them
    let ends = matches!(hook_event, Some("Stop" | "StopFailure" | "SessionEnd" | "UserPromptSubmit"));
    if let Some(key) = session.as_ref().filter(|_| env.agent == "claude" && ends) {
        close_approval(app, key, None);
    }
    let pid = env.ppid.and_then(|p| shared.procs.lock().unwrap().resolve_agent_pid(p));
    for ev in normalize(&env) {
        let key = format!("{}:{}", ev.agent.as_str(), ev.session_id);
        if shared.hooked.lock().unwrap().insert(key.clone()) {
            shared.log_only.lock().unwrap().remove(&key);
        }
        if let Some(h) = &env.host_session {
            shared.desktop_ids.lock().unwrap().insert(key.clone(), h.clone());
        }
        let update = {
            // same lock order as the tick thread (procs, then store)
            let mut procs = shared.procs.lock().unwrap();
            let mut store = shared.store.lock().unwrap();
            let u = store.apply(ev);
            if let Some(pid) = pid {
                // keep a pid that is still running: a hook can come through a helper process that exits
                let known = store.pid_of(&key);
                if known != Some(pid) && !known.is_some_and(|k| procs.alive(k)) {
                    store.set_pid(&key, pid);
                }
            }
            u
        };
        if let Some(u) = update {
            publish(app, u);
        }
    }
    let (on, wait) = { let st = shared.settings.lock().unwrap(); (st.approve_in_app, st.approve_wait_sec.clamp(5, 110) as u64) };
    let key = session.filter(|k| asks && on && shared.store.lock().unwrap().snapshots().iter().any(|s| &s.key == k))?;
    let (tx, rx) = std::sync::mpsc::channel();
    let until = now_ms() + wait * 1000;
    // a newer request of the same session replaces the old one (whose hook then gets a plain ack)
    shared.approvals.lock().unwrap().insert(key.clone(), (until, tx));
    let u = shared.store.lock().unwrap().set_approve_until(&key, Some(until));
    if let Some(u) = u {
        publish(app, u);
    }
    Some(rx)
}

/// Ends an open in-app permission request: `answer` Some(true/false) allows or denies it, None
/// leaves it to Claude Code's own dialog.
fn close_approval(app: &AppHandle, key: &str, answer: Option<bool>) -> bool {
    let shared = app.state::<Shared>();
    let Some((_, tx)) = shared.approvals.lock().unwrap().remove(key) else { return false };
    let sent = match answer {
        Some(allow) => tx.send(if allow { b"allow".to_vec() } else { b"deny".to_vec() }).is_ok(),
        None => false,
    };
    let u = shared.store.lock().unwrap().set_approve_until(key, None);
    if let Some(u) = u {
        publish(app, u);
    }
    sent
}

/// The user's answer to a permission request from the app (only while it is still open).
#[tauri::command]
fn answer_approval(app: AppHandle, key: String, allow: bool) -> Result<(), String> {
    if close_approval(&app, &key, Some(allow)) {
        Ok(())
    } else {
        Err(tr("이 요청은 이미 끝났어요. 에이전트 창에서 답해 주세요", "This request has already ended. Answer it in the agent's window").into())
    }
}

/// Marks Claude sessions run by the desktop app, Remote Control or a claude.ai project thread,
/// from the app's own session records (see `agent_room_core::desktop`).
fn follow_desktop(app: &AppHandle) {
    use agent_room_core::desktop;
    let Some(home) = std::env::var_os("HOME") else { return };
    let root = std::path::Path::new(&home).join("Library/Application Support/Claude/claude-code-sessions");
    static CACHE: Mutex<Option<desktop::ScanCache>> = Mutex::new(None);
    let found = desktop::scan(&root, now_ms(), 24 * 3_600_000, CACHE.lock().unwrap().get_or_insert_with(Default::default));
    if found.is_empty() {
        return;
    }
    let shared = app.state::<Shared>();
    let mut out = Vec::new();
    {
        let mut store = shared.store.lock().unwrap();
        for snap in store.snapshots().into_iter().filter(|s| s.agent == agent_room_core::model::AgentKind::Claude) {
            // a session continued in a new record: the most recently active record wins
            let rec = found.iter().filter(|r| r.cli_ids.contains(&snap.session_id)).max_by_key(|r| r.last_activity);
            if let Some(r) = rec {
                out.extend(store.set_origin(&snap.key, Some(r.origin.as_str().into()), r.title.clone()));
            }
        }
    }
    for u in out {
        publish(app, u);
    }
}

/// Sessions that only show up in the agents' own logs: started before Agent Room, run by the
/// desktop apps, or by a schedule (Codex automations, `codex exec`). A log being written means the
/// agent is working; a quiet log means its turn is over; long quiet ends the session. Only the log
/// files' times and their `cwd` are read (see agent_room_core::logs).
fn follow_logs(app: &AppHandle) {
    use agent_room_core::logs;
    use agent_room_core::model::{AgentKind, EvKind};
    const FIND_WITHIN: u64 = 10 * 60_000;
    const TURN_OVER_AFTER: u64 = 60_000;
    const END_AFTER: u64 = 30 * 60_000;
    let shared = app.state::<Shared>();
    let now = now_ms();
    let found = logs::recent(&logs::LogDirs::from_env(), now, FIND_WITHIN);
    let ev = |agent: AgentKind, id: &str, ts: u64, cwd: Option<String>, kind: EvKind| NormEvent {
        agent, session_id: id.to_string(), ts, cwd, model: None, transcript_path: None, permission_mode: None, kind,
    };
    // sessions seen only in their log (the desktop app, VS Code) read their name from it, and Codex its remaining usage
    let with_log = |mut e: NormEvent, f: &logs::LogSession| {
        e.transcript_path = Some(f.path.clone());
        e
    };
    let mut out = Vec::new();
    {
        let hooked = shared.hooked.lock().unwrap();
        let mut known = shared.log_only.lock().unwrap();
        let mut store = shared.store.lock().unwrap();
        // every session's state once (each log is one session, so applying one log's events
        // doesn't change another's); it was copied out again for every log file
        let states: std::collections::HashMap<String, AgentState> = store.snapshots().into_iter().map(|s| (s.key, s.state)).collect();
        for f in found {
            let key = format!("{}:{}", f.agent.as_str(), f.session_id);
            if hooked.contains(&key) {
                continue;
            }
            let state = states.get(&key).copied();
            let last = known.get(&key).copied();
            let written = last.is_none_or(|l| f.modified > l);
            if !written {
                continue;
            }
            known.insert(key.clone(), f.modified);
            // new, or back after it ended: the session is there
            if matches!(state, None | Some(AgentState::Disconnected)) {
                out.extend(store.apply(with_log(ev(f.agent, &f.session_id, f.modified, f.cwd.clone(), EvKind::SessionStart { source: Some("log".into()) }), &f)));
            }
            // the log is being written: the agent is working (a log first seen counts if it is fresh)
            let busy = matches!(state, Some(st) if !matches!(st, AgentState::Idle | AgentState::Completed | AgentState::Disconnected));
            if busy {
                out.extend(store.apply(with_log(ev(f.agent, &f.session_id, f.modified, None, EvKind::StillWorking), &f)));
            } else if last.is_some() || now.saturating_sub(f.modified) < TURN_OVER_AFTER {
                out.extend(store.apply(with_log(ev(f.agent, &f.session_id, f.modified, None, EvKind::PromptSubmitted), &f)));
            }
        }
        // quiet logs: the turn is over, and after a long while the session is gone
        // (the key stays in `known` after the session ends, so an unchanged old log never brings it back)
        let snaps: std::collections::HashMap<String, Snapshot> = store.snapshots().into_iter().map(|s| (s.key.clone(), s)).collect();
        for (key, &m) in known.iter() {
            let Some(snap) = snaps.get(key) else { continue };
            if snap.state == AgentState::Disconnected {
                continue;
            }
            let (agent, id) = (snap.agent, snap.session_id.clone());
            let quiet = now.saturating_sub(m);
            if quiet > END_AFTER {
                out.extend(store.apply(ev(agent, &id, now, None, EvKind::SessionEnd { reason: Some("log quiet".into()) })));
            } else if quiet > TURN_OVER_AFTER && !matches!(snap.state, AgentState::Idle | AgentState::Completed) {
                out.extend(store.apply(ev(agent, &id, m, None, EvKind::TurnComplete)));
            }
        }
    }
    for mut u in out {
        // guessed from file times only: no notifications for these
        u.notice = None;
        publish(app, u);
    }
}

fn apply_local(app: &AppHandle, ev: NormEvent) {
    let u = app.state::<Shared>().store.lock().unwrap().apply(ev);
    if let Some(u) = u {
        publish(app, u);
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn get_overview(state: tauri::State<Shared>) -> Overview {
    let d = *state.detected.lock().unwrap();
    Overview {
        sessions: state.store.lock().unwrap().snapshots(),
        detected: Detected { claude: d.0, codex: d.1 },
        server_error: state.server_error.lock().unwrap().clone(),
        demo_running: state.demo_stop.lock().unwrap().is_some(),
    }
}

#[tauri::command]
fn get_timeline(state: tauri::State<Shared>, key: String) -> Vec<TimelineEntry> {
    state.store.lock().unwrap().timeline(&key)
}

/// One instructions/memory file the agents read (CLAUDE.md, AGENTS.md), shown read-only on the dashboard.
#[derive(serde::Serialize)]
struct MemoryFile {
    label: String,
    path: String,
    content: String,
    truncated: bool,
}

/// The instruction files Claude Code and Codex load: the user's global ones and, for each known
/// session, the ones in its project folder. Read-only, local, nothing is sent anywhere.
#[tauri::command]
fn memory_files(state: tauri::State<Shared>) -> Vec<MemoryFile> {
    const MAX: usize = 200 * 1024;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut add = |label: String, path: std::path::PathBuf| {
        let key = path.display().to_string();
        if !seen.insert(key.clone()) {
            return;
        }
        let Ok(bytes) = std::fs::read(&path) else { return };
        let truncated = bytes.len() > MAX;
        let content = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX)]).into_owned();
        out.push(MemoryFile { label, path: key, content, truncated });
    };
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::Path::new(&home);
        add(tr("전역 · Claude Code", "Global · Claude Code").into(), home.join(".claude/CLAUDE.md"));
        add(tr("전역 · Codex", "Global · Codex").into(), home.join(".codex/AGENTS.md"));
    }
    let mut cwds: Vec<String> = state.store.lock().unwrap().snapshots().into_iter().filter_map(|s| s.cwd).collect();
    cwds.sort();
    cwds.dedup();
    for cwd in cwds {
        let dir = std::path::Path::new(&cwd);
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| cwd.clone());
        for f in ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md"] {
            add(format!("{name} · {f}"), dir.join(f));
        }
    }
    out
}

/// Opens one of the instruction files in the system's text editor. Only a path the list above
/// would show is accepted, so the page can't open arbitrary files.
#[tauri::command]
fn open_memory_file(state: tauri::State<Shared>, path: String) -> Result<(), String> {
    if !memory_files(state).iter().any(|f| f.path == path) {
        return Err("not an instruction file".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-t").arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("notepad");
        c.arg(&path);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&path);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_session(app: AppHandle, key: String) {
    let u = app.state::<Shared>().store.lock().unwrap().remove(&key);
    if let Some(u) = u {
        publish(&app, u);
    }
}

/// Brings the app an agent session runs in (its terminal, editor or desktop app) to the front.
/// Sessions found only from their logs have no process; those open the agent's own desktop app if installed.
#[tauri::command]
fn focus_agent(app: AppHandle, key: String) -> Result<(), String> {
    let shared = app.state::<Shared>();
    let (pid, agent, cwd) = {
        let store = shared.store.lock().unwrap();
        let snap = store.snapshots().into_iter().find(|s| s.key == key);
        (store.pid_of(&key), snap.as_ref().map(|s| s.agent), snap.and_then(|s| s.cwd))
    };
    let mut procs = shared.procs.lock().unwrap();
    // a session seen only in its log (e.g. after Agent Room restarted) has no process yet:
    // the agent running in the same folder is the one
    let pid = pid.or_else(|| procs.agent_in(agent?, cwd.as_deref()?));
    let host = pid.and_then(|p| procs.host_app(p)).or_else(|| {
        // the Codex app now ships inside ChatGPT; the standalone Codex.app is kept for older installs
        let names: &[&str] = if key.starts_with("codex:") { &["Codex.app", "ChatGPT.app"] } else { &["Claude.app"] };
        names.iter().map(|n| std::path::Path::new("/Applications").join(n)).find(|p| p.exists())
    });
    drop(procs);
    // the hook reports it; a session seen only in its log (Agent Room restarted since its last hook)
    // is looked up in the desktop app's own session records instead
    // the cached id is read in its own statement: the guard of a lock taken inside a `let`'s
    // expression lives to the end of it, and the fallback below takes the same lock
    let cached = shared.desktop_ids.lock().unwrap().get(&key).cloned();
    let desktop = cached.or_else(|| {
        let cli = key.strip_prefix("claude:")?;
        let found = desktop_id_from_records(cli)?;
        shared.desktop_ids.lock().unwrap().insert(key.clone(), found.clone());
        Some(found)
    });
    let host = host.ok_or(if pid.is_some() { tr("이 에이전트가 실행 중인 앱을 찾지 못했어요 (tmux 같은 곳에서 실행 중일 수 있어요)", "Couldn't find the app this agent runs in (it may run inside something like tmux)") } else { tr("이 세션의 에이전트 프로세스를 찾지 못했어요", "Couldn't find this session's agent process") })?;
    open_session(&host, &key, pid, cwd.as_deref(), desktop.as_deref())
}

/// The Claude desktop app's id (`local_…`) for the Code-tab session whose CLI session id is `cli`.
/// Only the ids in the app's records under `claude-code-sessions/<account>/<org>/local_*.json` are
/// read; a file is parsed only when it mentions `cli`, and archived sessions are skipped (the app
/// does not open them by link).
fn desktop_id_from_records(cli: &str) -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let root = std::path::Path::new(&home).join("Library/Application Support/Claude/claude-code-sessions");
    desktop_id_in(&root, cli)
}

fn desktop_id_in(root: &std::path::Path, cli: &str) -> Option<String> {
    // a CLI session id is a uuid; nothing else is matched against the records
    if cli.len() != 36 || !cli.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }
    let mut best: Option<(u64, String)> = None;
    for account in std::fs::read_dir(root).ok()?.flatten() {
        for org in std::fs::read_dir(account.path()).into_iter().flatten().flatten() {
            for f in std::fs::read_dir(org.path()).into_iter().flatten().flatten() {
                let name = f.file_name();
                let Some(name) = name.to_str() else { continue };
                if !name.starts_with("local_") || !name.ends_with(".json") {
                    continue;
                }
                let Ok(raw) = std::fs::read(f.path()) else { continue };
                if !raw.windows(cli.len()).any(|w| w == cli.as_bytes()) {
                    continue;
                }
                let Ok(rec) = serde_json::from_slice::<serde_json::Value>(&raw) else { continue };
                let is_cli = |k: &str| rec.get(k).and_then(|v| v.as_str()) == Some(cli);
                let in_prior = rec.get("priorCliSessionIds").and_then(|v| v.as_array()).is_some_and(|a| a.iter().any(|v| v.as_str() == Some(cli)));
                if !(is_cli("cliSessionId") || is_cli("lastAssistantCliSessionId") || in_prior) {
                    continue;
                }
                if rec.get("isArchived").and_then(|v| v.as_bool()) == Some(true) {
                    continue;
                }
                let Some(id) = rec.get("sessionId").and_then(|v| v.as_str()) else { continue };
                // a session continued in a new record: the most recently active one is the open one
                let at = rec.get("lastActivityAt").and_then(|v| v.as_u64()).unwrap_or(0);
                if best.as_ref().is_none_or(|(t, _)| at > *t) {
                    best = Some((at, id.to_string()));
                }
            }
        }
    }
    best.map(|(_, id)| id)
}

/// Opens the session itself where possible (its terminal tab, its editor window, its Codex chat),
/// otherwise just the app it runs in.
#[cfg(target_os = "macos")]
fn open_session(host: &std::path::Path, key: &str, pid: Option<u32>, cwd: Option<&str>, desktop: Option<&str>) -> Result<(), String> {
    use focus::Reach;
    use std::process::Command;
    // Since macOS 14 an app that is not frontmost can't hand the focus to another app, and a click
    // on the island or the room-only window leaves Agent Room in the background. Taking the focus
    // first (the user just clicked us) lets the agent's app come to the front.
    unsafe {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if !ns_app.is_null() {
            let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
        }
    }
    let ok = |c: &mut Command| c.status().is_ok_and(|s| s.success());
    let (agent, id) = key.split_once(':').unwrap_or(("", key));
    let done = match focus::reach(host, agent == "codex", id, desktop, pid.and_then(focus::tty_of), cwd.is_some()) {
        // asks once for permission to control Terminal / iTerm2; without it the app still comes up below
        Reach::Tab { app, tty } => focus::tab_script(app, &tty).is_some_and(|sc| ok(Command::new("/usr/bin/osascript").args(["-e", &sc]))),
        Reach::Folder => ok(Command::new("/usr/bin/open").arg("-a").arg(host).arg(cwd.unwrap_or_default())),
        Reach::Ghostty => focus::ghostty_script(cwd.unwrap_or_default()).is_some_and(|sc| ok(Command::new("/usr/bin/osascript").args(["-e", &sc]))),
        // the link goes to the editor's front window, so the session's folder comes to the front first
        Reach::EditorTab(url) => {
            let raised = ok(Command::new("/usr/bin/open").arg("-a").arg(host).arg(cwd.unwrap_or_default()));
            std::thread::sleep(Duration::from_millis(400));
            ok(Command::new("/usr/bin/open").arg(url)) || raised
        }
        // handed to the host app itself: a scheme can also be claimed by a stale copy (an old
        // installer volume) or another app, and `-a` also brings the host to the front
        Reach::Link(url) => ok(Command::new("/usr/bin/open").arg("-a").arg(host).arg(&url)) || ok(Command::new("/usr/bin/open").arg(url)),
        Reach::App => false,
    };
    if done || ok(Command::new("/usr/bin/open").arg(host)) { Ok(()) } else { Err(tr("앱 창을 열지 못했어요", "Couldn't open the app window").into()) }
}

#[tauri::command]
fn set_ui_lang(app: AppHandle, en: bool) {
    if LANG_EN.swap(en, Ordering::Relaxed) != en {
        refresh_tray(&app);
        #[cfg(target_os = "macos")]
        if let Ok(m) = app_menu(&app) {
            let _ = app.set_menu(m);
        }
    }
}

/// The UI's offset from UTC, sent by the main window (always open) so quiet hours keep local
/// time even when no usage view is showing.
#[tauri::command]
fn set_tz_offset(min: i64) {
    TZ_OFFSET_MIN.store(min.clamp(-840, 840), Ordering::Relaxed);
}

/// the system's double-click interval in ms, so a single click on a pet can wait exactly that long
#[tauri::command]
fn double_click_ms() -> u32 {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send};
        let sec: f64 = msg_send![class!(NSEvent), doubleClickInterval];
        if sec > 0.0 { return (sec * 1000.0).round().min(5000.0) as u32; }
    }
    500
}

#[cfg(not(target_os = "macos"))]
fn open_session(_: &std::path::Path, _: &str, _: Option<u32>, _: Option<&str>, _: Option<&str>) -> Result<(), String> {
    Err(tr("앱 창 열기는 아직 macOS에서만 돼요", "Opening the app window works only on macOS for now").into())
}

#[tauri::command]
fn hooks_status() -> Vec<HookStatus> {
    vec![install::status(Target::Claude), install::status(Target::Codex)]
}

fn bundled_hook_bin() -> Option<std::path::PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let p = dir.join(agent_room_core::paths::hook_bin_name());
    p.exists().then_some(p)
}

#[tauri::command]
fn hooks_install(agent: String) -> Result<HookStatus, String> {
    let t = Target::parse(&agent).ok_or("unknown agent")?;
    let src = bundled_hook_bin();
    if src.is_none() && !agent_room_core::paths::installed_hook_bin().exists() {
        return Err(tr("앱 번들에서 agent-room-hook 을 찾지 못했습니다.", "agent-room-hook was not found in the app bundle.").into());
    }
    install::install(t, src.as_deref())
}

#[tauri::command]
fn hooks_uninstall(agent: String) -> Result<HookStatus, String> {
    let t = Target::parse(&agent).ok_or("unknown agent")?;
    install::uninstall(t)
}

#[tauri::command]
fn hooks_restore(agent: String) -> Result<String, String> {
    let t = Target::parse(&agent).ok_or("unknown agent")?;
    install::restore_latest(t)
}

#[tauri::command]
fn hooks_remove_all() -> Vec<Result<HookStatus, String>> {
    install::uninstall_all()
}

#[tauri::command]
fn demo_start(app: AppHandle) {
    let shared = app.state::<Shared>();
    let mut slot = shared.demo_stop.lock().unwrap();
    if slot.is_some() {
        return;
    }
    let stop = Arc::new(AtomicBool::new(false));
    *slot = Some(stop.clone());
    let handle = app.clone();
    demo::spawn(stop, move |ev| apply_local(&handle, ev));
}

#[tauri::command]
fn demo_stop(app: AppHandle) {
    let shared = app.state::<Shared>();
    if let Some(flag) = shared.demo_stop.lock().unwrap().take() {
        flag.store(true, Ordering::Relaxed);
    }
    let key = format!("demo:{}", demo::DEMO_SESSION);
    let u = shared.store.lock().unwrap().remove(&key);
    if let Some(u) = u {
        publish(&app, u);
    }
}

#[tauri::command]
fn get_settings(state: tauri::State<Shared>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let shared = app.state::<Shared>();
    shared.store.lock().unwrap().stale_after_ms = settings.stale_minutes.max(1) as u64 * 60_000;
    *shared.settings.lock().unwrap() = settings.clone();
    let path = settings_path(&app).ok_or("no config dir")?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_string_pretty(&settings).unwrap()).map_err(|e| e.to_string())?;
    // a shorter retention (or none) takes effect at once
    agent_room_core::history::prune(&agent_room_core::history::dir(), now_ms(), settings.history_days as u64);
    show_island(&app, settings.island);
    sync_island(&app);
    // the popover and island keep their pages alive, so they pick up the change from this event
    let _ = app.emit("settings-changed", &settings);
    Ok(())
}

/// Menu bar frames the app drew from the pet picked in settings (8 PNGs in TRAY order).
#[tauri::command]
fn set_tray_frames(app: AppHandle, frames: Vec<Vec<u8>>) -> Result<(), String> {
    if frames.len() != 8 {
        return Err("8 frames expected".into());
    }
    for f in &frames {
        tauri::image::Image::from_bytes(f).map_err(|e| e.to_string())?;
    }
    let shared = app.state::<Shared>();
    let mut cur = shared.tray_frames.lock().unwrap();
    let n = cur.as_ref().map_or(0, |f| f.0) + 1;
    *cur = Some((n, Arc::new(frames)));
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ------------------------------------------------------------------ setup

/// The macOS menu bar menus in Korean. Tauri's default menu is English only. The Edit menu also
/// keeps ⌘C / ⌘V / ⌘A working in text fields.
#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::{PredefinedMenuItem as P, Submenu};
    let sep = || P::separator(app);
    let main = Submenu::with_items(app, "Agent Room", true, &[
        &P::about(app, Some(tr("Agent Room에 관하여", "About Agent Room")), None)?,
        &MenuItem::with_id(app, "app-update", tr("업데이트 확인…", "Check for Updates…"), true, None::<&str>)?,
        &sep()?,
        &MenuItem::with_id(app, "app-settings", tr("설정…", "Settings…"), true, Some("CmdOrCtrl+,"))?,
        &sep()?,
        &P::hide(app, Some(tr("Agent Room 가리기", "Hide Agent Room")))?,
        &P::hide_others(app, Some(tr("기타 가리기", "Hide Others")))?,
        &P::show_all(app, Some(tr("모두 보기", "Show All")))?,
        &sep()?,
        &P::quit(app, Some(tr("Agent Room 종료", "Quit Agent Room")))?,
    ])?;
    let edit = Submenu::with_items(app, tr("편집", "Edit"), true, &[
        &P::undo(app, Some(tr("실행 취소", "Undo")))?,
        &P::redo(app, Some(tr("실행 복귀", "Redo")))?,
        &sep()?,
        &P::cut(app, Some(tr("오려두기", "Cut")))?,
        &P::copy(app, Some(tr("복사하기", "Copy")))?,
        &P::paste(app, Some(tr("붙여넣기", "Paste")))?,
        &P::select_all(app, Some(tr("모두 선택", "Select All")))?,
    ])?;
    let window = Submenu::with_items(app, tr("윈도우", "Window"), true, &[
        &P::minimize(app, Some(tr("최소화", "Minimize")))?,
        &P::maximize(app, Some(tr("확대/축소", "Zoom")))?,
        &sep()?,
        &P::close_window(app, Some(tr("윈도우 닫기", "Close Window")))?,
    ])?;
    let view = Submenu::with_items(app, tr("보기", "View"), true, &[
        &MenuItem::with_id(app, "zoom-in", tr("확대", "Zoom In"), true, Some("CmdOrCtrl+="))?,
        &MenuItem::with_id(app, "zoom-out", tr("축소", "Zoom Out"), true, Some("CmdOrCtrl+-"))?,
        &MenuItem::with_id(app, "zoom-reset", tr("실제 크기", "Actual Size"), true, Some("CmdOrCtrl+0"))?,
    ])?;
    Menu::with_items(app, &[&main, &edit, &view, &window])
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu).on_menu_event(|app, ev| {
        match ev.id().as_ref() {
            "app-settings" => {
                show_main(app);
                let _ = app.emit("open-settings", ());
            }
            "app-update" => {
                show_main(app);
                let _ = app.emit_to("main", "check-update", ());
            }
            id @ ("zoom-in" | "zoom-out" | "zoom-reset") => {
                let _ = app.emit_to("main", "ui-zoom", id.trim_start_matches("zoom-"));
            }
            _ => {}
        }
    });
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![
            get_overview, get_timeline, remove_session, hooks_status, hooks_install, hooks_uninstall, hooks_restore,
            hooks_remove_all, focus_agent, double_click_ms, usage_history, demo_start, demo_stop, get_settings, save_settings, data_dir, list_characters, set_tray_frames, save_character, replace_character, rename_character, remove_character, list_sounds, save_sound, remove_sound, quit_app,
            tray_action, set_tz_offset, set_ui_lang, island_layout, notch_size, set_room_only, codex_limits, claude_limits, memory_files, open_memory_file, save_report, notify_text, history_read, history_clear, answer_approval
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);
            let island_on = settings.island;
            {
                let shared = handle.state::<Shared>();
                shared.store.lock().unwrap().stale_after_ms = settings.stale_minutes.max(1) as u64 * 60_000;
                *shared.settings.lock().unwrap() = settings;
            }

            // local IPC from agent-room-hook
            let h = handle.clone();
            match runtime::spawn_server(move |env| handle_envelope(&h, env)) {
                Ok(_) => OWNS_SOCKET.store(true, Ordering::SeqCst),
                Err(e) => *handle.state::<Shared>().server_error.lock().unwrap() = Some(e.to_string()),
            }

            // connection health + agent process detection (no content is read)
            let h = handle.clone();
            std::thread::Builder::new().name("agent-room-tick".into()).spawn(move || {
                let mut n: u64 = 0;
                loop {
                    std::thread::sleep(Duration::from_secs(2));
                    let shared = h.state::<Shared>();
                    let updates = {
                        let mut procs = shared.procs.lock().unwrap();
                        let mut store = shared.store.lock().unwrap();
                        store.tick(now_ms(), &mut |pid| procs.alive(pid))
                    };
                    for u in updates {
                        publish(&h, u);
                    }
                    if n % 5 == 0 {
                        // "완료" runs out with time, not with an event
                        sync_island(&h);
                        follow_logs(&h);
                        follow_desktop(&h);
                        renotify(&h);
                        let expired: Vec<String> = shared.approvals.lock().unwrap().iter().filter(|(_, (until, _))| *until <= now_ms()).map(|(k, _)| k.clone()).collect();
                        for k in expired {
                            close_approval(&h, &k, None);
                        }
                        if n % 1800 == 0 {
                            let keep = shared.settings.lock().unwrap().history_days as u64;
                            agent_room_core::history::prune(&agent_room_core::history::dir(), now_ms(), keep);
                        }
                        let d = shared.procs.lock().unwrap().scan_agents();
                        let changed = { let mut cur = shared.detected.lock().unwrap(); let c = *cur != d; *cur = d; c };
                        if changed {
                            let _ = h.emit("agents-detected", Detected { claude: d.0, codex: d.1 });
                        }
                    }
                    n += 1;
                }
            })?;

            // menu bar
            let menu = build_menu(&handle, &[])?;
            TrayIconBuilder::with_id("main")
                .icon(tauri::image::Image::from_bytes(TRAY_OFF)?)
                .tooltip("Agent Room")
                .menu(&menu)
                // left click opens the popover; right click still shows the menu
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = ev {
                        toggle_popover(tray.app_handle(), rect);
                    }
                })
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => show_main(app),
                    "mini" => {
                        show_main(app);
                        let _ = app.emit("set-mini", true);
                    }
                    "settings" => {
                        show_main(app);
                        let _ = app.emit("open-settings", ());
                    }
                    "update" => {
                        show_main(app);
                        let _ = app.emit_to("main", "check-update", ());
                    }
                    "quit" => app.exit(0),
                    id if id.starts_with("session:") => tray_action(app.clone(), "focus".into(), Some(id.trim_start_matches("session:").into())),
                    _ => {}
                })
                .build(app)?;

            show_island(&handle, island_on);
            sync_island(&handle);
            watch_hover(handle.clone());
            animate_tray(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // closing the window keeps Agent Room in the menu bar
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // the popover closes as soon as the user clicks elsewhere
            WindowEvent::Focused(false) if window.label() == "tray" => {
                POPOVER_HIDDEN_AT.store(now_ms(), Ordering::SeqCst);
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Room")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                if OWNS_SOCKET.load(Ordering::SeqCst) {
                    runtime::remove_socket();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::character_stem;

    #[test]
    fn character_names_stay_inside_the_folder() {
        assert_eq!(character_stem("pikachu.png"), "pikachu");
        assert_eq!(character_stem("../../etc/passwd"), "______etc_passwd");
        assert_eq!(character_stem(""), "character");
    }

    #[test]
    fn finds_the_desktop_id_of_a_cli_session() {
        let root = std::env::temp_dir().join(format!("agent-room-records-{}", std::process::id()));
        let dir = root.join("acct").join("org");
        std::fs::create_dir_all(&dir).unwrap();
        let cli = "35d41fe0-8614-4055-a454-95c4ead1713a";
        let other = "11111111-2222-3333-4444-555555555555";
        let write = |name: &str, body: serde_json::Value| std::fs::write(dir.join(name), body.to_string()).unwrap();
        write("local_aaa.json", serde_json::json!({"sessionId": "local_aaa", "cliSessionId": other, "lastActivityAt": 9}));
        write("local_old.json", serde_json::json!({"sessionId": "local_old", "cliSessionId": "x", "priorCliSessionIds": [cli], "lastActivityAt": 1}));
        write("local_new.json", serde_json::json!({"sessionId": "local_new", "cliSessionId": cli, "lastActivityAt": 5}));
        write("local_gone.json", serde_json::json!({"sessionId": "local_gone", "cliSessionId": cli, "lastActivityAt": 99, "isArchived": true}));
        // the most recently active, unarchived record wins
        assert_eq!(super::desktop_id_in(&root, cli).as_deref(), Some("local_new"));
        assert_eq!(super::desktop_id_in(&root, other).as_deref(), Some("local_aaa"));
        assert_eq!(super::desktop_id_in(&root, "99999999-2222-3333-4444-555555555555"), None);
        // only uuids are looked up
        assert_eq!(super::desktop_id_in(&root, "local_aaa"), None);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
