//! Agent Room desktop shell: IPC server, session store, tray, notifications, commands.
//! The UI (React + Canvas) only renders snapshots pushed from here.

mod demo;
mod focus;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub sfx: bool,
    pub bgm: bool,
    pub notify_complete: bool,
    pub notify_approval: bool,
    /// notify when a plan usage window has 10% or less left
    pub notify_limits: bool,
    pub notify_only_when_hidden: bool,
    pub stale_minutes: u32,
    pub panel_open: bool,
    pub always_on_top: bool,
    /// always-on-top while in room-only mode (kept apart from the normal window's)
    pub always_on_top_room: bool,
    /// remaining plan usage (5-hour / weekly) in the overview and HUD
    pub show_limits: bool,
    /// agent ('claude' | 'codex' | 'generic') -> custom character file stem; missing = built-in
    pub characters: std::collections::BTreeMap<String, String>,
    /// built-in critter id -> fur colour ("#rrggbb")
    pub critter_colors: std::collections::BTreeMap<String, String>,
    /// UI colour theme id ("peach", "mint", ...)
    pub ui_theme: String,
    /// status pill at the top centre of the screen (around the MacBook notch)
    pub island: bool,
    /// "mixed" (readable UI font, pixel numbers/titles), "system" or "pixel"
    pub font: String,
    /// "" = theme backdrop, a preset id, or "#rrggbb"
    pub backdrop: String,
    /// pet name tags: "compact", "full" or "off"
    pub tag_style: String,
    pub show_dock: bool,
    pub show_tabs: bool,
    /// how much idle pets move around: "calm", "normal" or "lively"
    pub pet_energy: String,
    /// the island opens on "hover" or only on "click"
    pub island_open: String,
    /// seconds a finished turn still shows as "완료" (0 = until the next turn)
    pub done_shown_sec: u32,
    /// name tags of idle pets: "dim", "hide" or "show"
    pub idle_tags: String,
    /// little icons over the pets' heads (!, ?, ✓, …)
    pub pet_bubbles: bool,
    /// hide the island while no agent is working or waiting on the user
    pub island_hide_idle: bool,
    /// lowest remaining usage on the closed island
    pub island_usage: bool,
    /// "작업 완료" notifications only for turns at least this long (seconds, 0 = all)
    pub notify_min_turn_sec: u32,
    /// look for a new version at launch and every few hours, and ask before installing it
    pub auto_update_check: bool,
    /// size of the whole main window's contents (text, panels, room), 1.0 = 100%
    pub ui_zoom: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            sfx: true,
            bgm: false,
            notify_complete: true,
            notify_approval: true,
            notify_limits: true,
            notify_only_when_hidden: true,
            stale_minutes: 3,
            panel_open: true,
            always_on_top: false,
            always_on_top_room: true,
            show_limits: true,
            characters: Default::default(),
            critter_colors: Default::default(),
            ui_theme: "peach".into(),
            island: true,
            font: "mixed".into(),
            backdrop: String::new(),
            tag_style: "compact".into(),
            show_dock: true,
            show_tabs: true,
            pet_energy: "normal".into(),
            island_open: "hover".into(),
            done_shown_sec: 60,
            idle_tags: "dim".into(),
            pet_bubbles: true,
            island_hide_idle: false,
            island_usage: true,
            notify_min_turn_sec: 0,
            auto_update_check: true,
            ui_zoom: 1.0,
        }
    }
}

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

fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Pushes one session change to the UI, the tray and (if enabled) a system notification.
fn publish(app: &AppHandle, u: Update) {
    let _ = app.emit("session-update", &u);
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
    if show != w.is_visible().unwrap_or(true) {
        let _ = if show { w.show() } else { w.hide() };
    }
}

/// One notification per usage window and reset period once 10% or less is left.
fn notify_low_limits(app: &AppHandle, s: &Snapshot, l: &agent_room_core::model::RateLimits) {
    let shared = app.state::<Shared>();
    if s.is_demo || !shared.settings.lock().unwrap().notify_limits {
        return;
    }
    let agent = agent_label(s);
    let low = agent_room_core::limits::newly_low(agent, l, 10.0, &mut shared.limit_warned.lock().unwrap());
    for w in low {
        let name = match w.minutes { 300 => "5시간", 10080 => "주간", _ => "사용량" };
        let left = (100.0 - w.used_pct).max(0.0).round();
        let reset = w.resets_at.map(|t| {
            let mins = t.saturating_sub(agent_room_core::model::now_ms()) / 60_000;
            if mins < 60 { format!(" {mins}분 뒤 초기화돼요.") } else if mins < 1440 { format!(" {}시간 뒤 초기화돼요.", mins / 60) } else { format!(" {}일 뒤 초기화돼요.", mins / 1440) }
        }).unwrap_or_default();
        let _ = app.notification().builder().title(format!("{agent} {name} 사용량 {left}% 남음")).body(format!("남은 사용량이 얼마 없어요.{reset}")).show();
    }
}

fn notify(app: &AppHandle, s: &Snapshot, n: Notice) {
    let shared = app.state::<Shared>();
    let st = shared.settings.lock().unwrap().clone();
    let wanted = match n {
        Notice::Completed | Notice::Failed => st.notify_complete,
        Notice::NeedsApproval | Notice::NeedsInput => st.notify_approval,
    };
    if !wanted || s.is_demo {
        return;
    }
    // a quick answer is not worth a notification when the user asked for long turns only
    if matches!(n, Notice::Completed) && st.notify_min_turn_sec > 0 {
        let took = s.turn_started_at.zip(s.turn_ended_at).map(|(a, b)| b.saturating_sub(a)).unwrap_or(u64::MAX);
        if took < st.notify_min_turn_sec as u64 * 1000 {
            return;
        }
    }
    if st.notify_only_when_hidden {
        if let Some(w) = app.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                return;
            }
        }
    }
    let agent = agent_label(s);
    let project = s.project.clone().unwrap_or_default();
    let (title, body) = match n {
        Notice::Completed => (format!("{agent} 작업 완료"), format!("{project} 작업이 끝났어요.")),
        Notice::Failed => (format!("{agent} 오류"), s.error.as_ref().map(|e| e.message.clone()).unwrap_or_default()),
        Notice::NeedsApproval => (
            format!("{agent} 승인 필요"),
            format!("{project}: {} 실행 승인을 기다리고 있어요.", s.waiting.as_ref().and_then(|w| w.tool.clone()).unwrap_or_else(|| "도구".into())),
        ),
        Notice::NeedsInput => (format!("{agent} 입력 대기"), format!("{project}: 입력을 기다리고 있어요.")),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

fn agent_label(s: &Snapshot) -> &'static str {
    match s.agent {
        agent_room_core::model::AgentKind::Claude => "Claude Code",
        agent_room_core::model::AgentKind::Codex => "Codex",
        agent_room_core::model::AgentKind::Demo => "데모",
    }
}

fn state_label(s: &Snapshot) -> &'static str {
    use agent_room_core::session::Connection;
    if s.connection == Connection::Stale {
        return "응답 없음";
    }
    match s.state {
        AgentState::Idle => "대기 중",
        AgentState::Starting => "작업 시작",
        AgentState::Planning => "분석 중",
        AgentState::Reading => "파일 확인",
        AgentState::Editing => "코드 작성",
        AgentState::Running => "명령 실행",
        AgentState::Testing => "테스트",
        AgentState::Waiting => {
            if s.waiting.as_ref().is_some_and(|w| w.kind == "approval") { "승인 필요" } else { "입력 대기" }
        }
        AgentState::Completed => "완료",
        AgentState::Error => "오류",
        AgentState::Disconnected => "연결 끊김",
    }
}

/// Most important session first: waiting > error > working > rest.
fn priority(s: &Snapshot) -> u8 {
    match s.state {
        AgentState::Waiting => 0,
        AgentState::Error => 1,
        AgentState::Starting | AgentState::Planning | AgentState::Reading | AgentState::Editing | AgentState::Running | AgentState::Testing => 2,
        AgentState::Completed => 3,
        AgentState::Idle => 4,
        AgentState::Disconnected => 5,
    }
}

fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let mut sessions: Vec<Snapshot> = app.state::<Shared>().store.lock().unwrap().snapshots().into_iter().filter(|s| !s.is_demo).collect();
    sessions.sort_by_key(priority);
    let title = sessions.first().map(|s| {
        let extra = if sessions.len() > 1 { format!(" +{}", sessions.len() - 1) } else { String::new() };
        format!("{}{}", state_label(s), extra)
    });
    let _ = tray.set_title(title.as_deref());
    let _ = tray.set_tooltip(Some(title.as_deref().unwrap_or("Agent Room · 연결된 에이전트 없음")));
    if let Ok(menu) = build_menu(app, &sessions) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle, sessions: &[Snapshot]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "open", "Agent Room 열기", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "mini", "룸만 띄우기", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if sessions.is_empty() {
        menu.append(&MenuItem::with_id(app, "none", "연결된 에이전트 없음", false, None::<&str>)?)?;
    }
    for s in sessions.iter().take(8) {
        let label = format!("{} · {} — {}", agent_label(s), s.project.clone().unwrap_or_else(|| "?".into()), state_label(s));
        menu.append(&MenuItem::with_id(app, format!("session:{}", s.key), label, true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "설정…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "update", "업데이트 확인…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?)?;
    Ok(menu)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn handle_envelope(app: &AppHandle, env: Envelope) {
    let shared = app.state::<Shared>();
    let pid = env.ppid.and_then(|p| shared.procs.lock().unwrap().resolve_agent_pid(p));
    for ev in normalize(&env) {
        let key = format!("{}:{}", ev.agent.as_str(), ev.session_id);
        if shared.hooked.lock().unwrap().insert(key.clone()) {
            shared.log_only.lock().unwrap().remove(&key);
        }
        let update = {
            let mut store = shared.store.lock().unwrap();
            let u = store.apply(ev);
            if let Some(pid) = pid {
                if store.pid_of(&key) != Some(pid) {
                    store.set_pid(&key, pid);
                }
            }
            u
        };
        if let Some(u) = update {
            publish(app, u);
        }
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
    let mut out = Vec::new();
    {
        let hooked = shared.hooked.lock().unwrap();
        let mut known = shared.log_only.lock().unwrap();
        let mut store = shared.store.lock().unwrap();
        for f in found {
            let key = format!("{}:{}", f.agent.as_str(), f.session_id);
            if hooked.contains(&key) {
                continue;
            }
            let state = store.snapshots().into_iter().find(|s| s.key == key).map(|s| s.state);
            let last = known.get(&key).copied();
            let written = last.is_none_or(|l| f.modified > l);
            if !written {
                continue;
            }
            known.insert(key.clone(), f.modified);
            // new, or back after it ended: the session is there
            if matches!(state, None | Some(AgentState::Disconnected)) {
                out.extend(store.apply(ev(f.agent, &f.session_id, f.modified, f.cwd.clone(), EvKind::SessionStart { source: Some("log".into()) })));
            }
            // the log is being written: the agent is working (a log first seen counts if it is fresh)
            let busy = matches!(state, Some(st) if !matches!(st, AgentState::Idle | AgentState::Completed | AgentState::Disconnected));
            if busy {
                out.extend(store.apply(ev(f.agent, &f.session_id, f.modified, None, EvKind::StillWorking)));
            } else if last.is_some() || now.saturating_sub(f.modified) < TURN_OVER_AFTER {
                out.extend(store.apply(ev(f.agent, &f.session_id, f.modified, None, EvKind::PromptSubmitted)));
            }
        }
        // quiet logs: the turn is over, and after a long while the session is gone
        // (the key stays in `known` after the session ends, so an unchanged old log never brings it back)
        for (key, &m) in known.iter() {
            let Some(snap) = store.snapshots().into_iter().find(|s| &s.key == key) else { continue };
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
        let name = if key.starts_with("codex:") { "Codex.app" } else { "Claude.app" };
        let p = std::path::Path::new("/Applications").join(name);
        p.exists().then_some(p)
    });
    drop(procs);
    let host = host.ok_or(if pid.is_some() { "이 에이전트가 실행 중인 앱을 찾지 못했어요 (tmux 같은 곳에서 실행 중일 수 있어요)" } else { "이 세션의 에이전트 프로세스를 찾지 못했어요" })?;
    open_session(&host, &key, pid, cwd.as_deref())
}

/// Opens the session itself where possible (its terminal tab, its editor window, its Codex chat),
/// otherwise just the app it runs in.
#[cfg(target_os = "macos")]
fn open_session(host: &std::path::Path, key: &str, pid: Option<u32>, cwd: Option<&str>) -> Result<(), String> {
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
    let done = match focus::reach(host, agent == "codex", id, pid.and_then(focus::tty_of), cwd.is_some()) {
        // asks once for permission to control Terminal / iTerm2; without it the app still comes up below
        Reach::Tab { app, tty } => focus::tab_script(app, &tty).is_some_and(|sc| ok(Command::new("/usr/bin/osascript").args(["-e", &sc]))),
        Reach::Folder => ok(Command::new("/usr/bin/open").arg("-a").arg(host).arg(cwd.unwrap_or_default())),
        Reach::Link(url) => ok(Command::new("/usr/bin/open").arg(url)),
        Reach::App => false,
    };
    if done || ok(Command::new("/usr/bin/open").arg(host)) { Ok(()) } else { Err("앱 창을 열지 못했어요".into()) }
}

/// Tokens per local day for the last `days` days, recent rate and streaks, from local logs only.
#[tauri::command]
async fn usage_history(app: AppHandle, tz_offset_min: i64, days: i64) -> agent_room_core::usage::UsageHistory {
    let shared = app.state::<Shared>();
    let mut scan = shared.usage.lock().unwrap();
    scan.history(&agent_room_core::logs::LogDirs::from_env(), now_ms() as i64, tz_offset_min.clamp(-840, 840), days.clamp(1, 90))
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
fn open_session(_: &std::path::Path, _: &str, _: Option<u32>, _: Option<&str>) -> Result<(), String> {
    Err("앱 창 열기는 아직 macOS에서만 돼요".into())
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
        return Err("앱 번들에서 agent-room-hook 을 찾지 못했습니다.".into());
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
    show_island(&app, settings.island);
    sync_island(&app);
    // the popover and island keep their pages alive, so they pick up the change from this event
    let _ = app.emit("settings-changed", &settings);
    Ok(())
}

// ------------------------------------------------------------------ menu bar popover + island

/// Window for the menu bar popover ("tray") and the top-centre status pill ("island").
/// Both load the same page; the UI picks its view from the window label.
fn extra_window(app: &AppHandle, label: &str, w: f64, h: f64, resizable: bool) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Agent Room")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        // the island resizes itself; some platforms ignore set_size on fixed-size windows
        .resizable(resizable)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .build()?;
    #[cfg(target_os = "macos")]
    float_over_menu_bar(&win);
    Ok(win)
}

/// Raises the window above the menu bar (status window level) and keeps it on every Space,
/// including next to full-screen apps, so the island can sit in the notch row.
#[cfg(target_os = "macos")]
fn float_over_menu_bar(win: &WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let Ok(ptr) = win.ns_window() else { return };
    let ns = ptr as *mut AnyObject;
    if ns.is_null() {
        return;
    }
    // NSStatusWindowLevel = 25; canJoinAllSpaces (1) | stationary (16) | fullScreenAuxiliary (256)
    unsafe {
        let _: () = msg_send![ns, setLevel: 25isize];
        let _: () = msg_send![ns, setCollectionBehavior: (1usize | 16 | 256)];
    }
}

/// Shows the island at the top centre of the primary screen, or removes it. The island's web
/// view only exists while the setting is on, so a turned-off island costs no memory.
/// The island's window never changes size (resizing it on hover made the pill flicker); it is
/// as large as the open card and lets clicks through everywhere outside the pill.
const ISLAND_WIN: (f64, f64) = (640.0, 560.0);
/// The pill's current size in points, reported by the page; the hover check uses it.
static ISLAND_PILL: Mutex<(f64, f64)> = Mutex::new((366.0, 34.0));

fn show_island(app: &AppHandle, on: bool) {
    let existing = app.get_webview_window("island");
    if !on {
        if let Some(w) = existing {
            let _ = w.destroy();
        }
        return;
    }
    let Some(w) = existing.or_else(|| extra_window(app, "island", ISLAND_WIN.0, ISLAND_WIN.1, true).ok()) else { return };
    place_island(app, &w, ISLAND_WIN.0, ISLAND_WIN.1);
    // the hover watcher turns clicks back on while the pointer is over the pill
    let _ = w.set_ignore_cursor_events(true);
    let _ = w.show();
}

fn place_island(app: &AppHandle, w: &WebviewWindow, width: f64, height: f64) {
    let Ok(Some(mon)) = app.primary_monitor() else { return };
    let k = mon.scale_factor();
    let x = mon.position().x as f64 / k + (mon.size().width as f64 / k - width) / 2.0;
    let y = mon.position().y as f64 / k;
    #[cfg(target_os = "macos")]
    if mac_set_frame(w, x.round(), width, height) {
        return;
    }
    let _ = w.set_size(tauri::LogicalSize::new(width, height));
    let _ = w.set_position(tauri::LogicalPosition::new(x.round(), y));
}

/// Moves and resizes the island in one step at the top of the first screen. Two separate calls
/// (size, then position) showed a frame of the pill off-centre, which looked like flicker on hover.
#[cfg(target_os = "macos")]
fn mac_set_frame(w: &WebviewWindow, x: f64, width: f64, height: f64) -> bool {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let Ok(ptr) = w.ns_window() else { return false };
    let ns = ptr as usize;
    w.run_on_main_thread(move || unsafe {
        let ns = ns as *mut AnyObject;
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let count: usize = if screens.is_null() { 0 } else { msg_send![screens, count] };
        if ns.is_null() || count == 0 {
            return;
        }
        // Cocoa puts the origin at the bottom-left of the first screen
        let screen: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        let frame: MacRect = msg_send![screen, frame];
        let r = MacRect(x, frame.1 + frame.3 - height, width, height);
        let _: () = msg_send![ns, setFrame: r, display: true];
    })
    .is_ok()
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct MacRect(f64, f64, f64, f64);

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct MacPoint(f64, f64);

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for MacPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGPoint", &[objc2::encode::Encoding::Double, objc2::encode::Encoding::Double]);
}

/// Runs `f` on the main thread (AppKit) and waits briefly for its answer.
#[cfg(target_os = "macos")]
fn mac_on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .ok()?;
    rx.recv_timeout(Duration::from_millis(250)).ok()
}

/// The pointer inside the window, in points from its top-left (= CSS px), or None outside.
#[cfg(target_os = "macos")]
fn mac_pointer_in(app: &AppHandle, w: &WebviewWindow) -> Option<(i32, i32)> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let ns = w.ns_window().ok()? as usize;
    mac_on_main(app, move || unsafe {
        let ns = ns as *mut AnyObject;
        if ns.is_null() {
            return None;
        }
        let p: MacPoint = msg_send![class!(NSEvent), mouseLocation];
        let f: MacRect = msg_send![ns, frame];
        // Cocoa's y grows upwards
        let (x, y) = (p.0 - f.0, f.1 + f.3 - p.1);
        (x >= 0.0 && y >= 0.0 && x < f.2 && y < f.3).then(|| (x as i32, y as i32))
    })
    .flatten()
}

/// Puts the popover under the menu bar of the display that was clicked, centred on the pointer
/// (which is on the menu bar icon) and kept inside that display. All in global points.
#[cfg(target_os = "macos")]
fn mac_place_popover(app: &AppHandle, w: &WebviewWindow) -> bool {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let Ok(ptr) = w.ns_window() else { return false };
    let ns = ptr as usize;
    mac_on_main(app, move || unsafe {
        let ns = ns as *mut AnyObject;
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if ns.is_null() || screens.is_null() {
            return false;
        }
        let p: MacPoint = msg_send![class!(NSEvent), mouseLocation];
        let count: usize = msg_send![screens, count];
        for i in 0..count {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
            let f: MacRect = msg_send![screen, frame];
            if p.0 < f.0 || p.0 >= f.0 + f.2 || p.1 < f.1 || p.1 > f.1 + f.3 {
                continue;
            }
            let vis: MacRect = msg_send![screen, visibleFrame];
            let me: MacRect = msg_send![ns, frame];
            let x = (p.0 - me.2 / 2.0).max(f.0 + 8.0).min(f.0 + f.2 - me.2 - 8.0);
            let top = vis.1 + vis.3 - 4.0;
            let _: () = msg_send![ns, setFrameTopLeftPoint: MacPoint(x, top)];
            return true;
        }
        false
    })
    .unwrap_or(false)
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for MacRect {
    const ENCODING: objc2::encode::Encoding = {
        use objc2::encode::Encoding;
        const PAIR: [Encoding; 2] = [Encoding::Double, Encoding::Double];
        Encoding::Struct("CGRect", &[Encoding::Struct("CGPoint", &PAIR), Encoding::Struct("CGSize", &PAIR)])
    };
}

/// Size of the camera notch on the primary screen in points (width, height); None without a notch.
/// The island is drawn around it, so its collapsed height and empty middle match the notch.
#[tauri::command]
fn notch_size() -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    return mac_notch();
    #[cfg(not(target_os = "macos"))]
    None
}

#[cfg(target_os = "macos")]
fn mac_notch() -> Option<(f64, f64)> {
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, sel};
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Insets(f64, f64, f64, f64);
    unsafe impl Encode for Insets {
        const ENCODING: Encoding = Encoding::Struct("NSEdgeInsets", &[Encoding::Double, Encoding::Double, Encoding::Double, Encoding::Double]);
    }
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return None;
        }
        let count: usize = msg_send![screens, count];
        if count == 0 {
            return None;
        }
        // the first screen holds the menu bar, which is where the island is placed
        let screen: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        // safeAreaInsets and the auxiliary areas exist from macOS 12
        let has: bool = msg_send![screen, respondsToSelector: sel!(auxiliaryTopLeftArea)];
        if !has {
            return None;
        }
        let inset: Insets = msg_send![screen, safeAreaInsets];
        if inset.0 <= 0.0 {
            return None;
        }
        let frame: MacRect = msg_send![screen, frame];
        let left: MacRect = msg_send![screen, auxiliaryTopLeftArea];
        let right: MacRect = msg_send![screen, auxiliaryTopRightArea];
        let width = frame.2 - left.2 - right.2;
        (width > 0.0).then_some((width, inset.0))
    }
}

/// Tells the main window and the island where the pointer is. macOS sends no hover events to a
/// window of an app that is not frontmost, so without this the island only opened and the
/// room-only controls only showed after a click. Only the pointer position is read.
/// Each window gets its own event name: a page's `listen` hears events sent to any window.
/// "hover-island": true / false. "hover-main": the pointer in window (CSS px) or null outside.
fn watch_hover(app: AppHandle) {
    let _ = std::thread::Builder::new().name("agent-room-hover".into()).spawn(move || {
        let mut last_island: Option<bool> = None;
        let mut last_main: Option<Option<(i32, i32)>> = None;
        loop {
            std::thread::sleep(Duration::from_millis(120));
            #[cfg(not(target_os = "macos"))]
            let Ok(c) = app.cursor_position() else { continue };
            let at = |label: &str| -> Option<(i32, i32)> {
                let w = app.get_webview_window(label)?;
                if !w.is_visible().unwrap_or(false) {
                    return None;
                }
                // macOS: the pointer and the window frame both in global points, so displays with
                // different scaling (a Retina laptop next to a plain monitor) can't mix up
                #[cfg(target_os = "macos")]
                return mac_pointer_in(&app, &w);
                #[cfg(not(target_os = "macos"))]
                {
                    let (p, s, k) = (w.inner_position().ok()?, w.inner_size().ok()?, w.scale_factor().ok()?);
                    let (x, y) = (c.x - p.x as f64, c.y - p.y as f64);
                    (x >= 0.0 && y >= 0.0 && x < s.width as f64 && y < s.height as f64).then(|| ((x / k) as i32, (y / k) as i32))
                }
            };
            // only the pill counts: it sits at the top centre of its (larger, see-through) window
            let island = at("island").is_some_and(|(x, y)| {
                let (pw, ph) = *ISLAND_PILL.lock().unwrap();
                let left = (ISLAND_WIN.0 - pw) / 2.0;
                (x as f64) >= left && (x as f64) < left + pw && (y as f64) < ph
            });
            if last_island != Some(island) {
                last_island = Some(island);
                if let Some(w) = app.get_webview_window("island") {
                    let _ = w.set_ignore_cursor_events(!island);
                }
                let _ = app.emit_to("island", "hover-island", island);
            }
            let main = at("main");
            if last_main != Some(main) {
                last_main = Some(main);
                let _ = app.emit_to("main", "hover-main", main);
            }
        }
    });
}

/// Room-only mode keeps Agent Room out of the Dock and the ⌘Tab switcher, so moving the little
/// room around or switching apps never brings the app forward. Window mode puts it back.
#[tauri::command]
fn set_room_only(app: AppHandle, on: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if on { tauri::ActivationPolicy::Accessory } else { tauri::ActivationPolicy::Regular };
        let _ = app.set_activation_policy(policy);
        if !on {
            show_main(&app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on);
}

/// The pill's size as drawn (it grows when hovered/clicked and shrinks back); the window itself stays put.
#[tauri::command]
fn island_layout(width: f64, height: f64) {
    *ISLAND_PILL.lock().unwrap() = (width.clamp(120.0, ISLAND_WIN.0), height.clamp(24.0, ISLAND_WIN.1));
}

/// Opens the popover under the menu bar icon (or closes it when it is already open).
/// The popover's web view is made on the first click, not at launch.
fn toggle_popover(app: &AppHandle, rect: tauri::Rect) {
    let existing = app.get_webview_window("tray");
    let Some(w) = existing.or_else(|| extra_window(app, "tray", 360.0, 480.0, false).ok()) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    if now_ms().saturating_sub(POPOVER_HIDDEN_AT.load(Ordering::SeqCst)) < 400 {
        return;
    }
    #[cfg(target_os = "macos")]
    if mac_place_popover(app, &w) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("popover-shown", ());
        return;
    }
    let k = w.scale_factor().unwrap_or(1.0);
    let pos = rect.position.to_physical::<f64>(k);
    let size = rect.size.to_physical::<f64>(k);
    let ww = w.outer_size().map(|s| s.width as f64).unwrap_or(360.0 * k);
    let mut x = pos.x + size.width / 2.0 - ww / 2.0;
    let y = pos.y + size.height + 4.0 * k;
    // keep the whole popover on the display whose menu bar was clicked
    if let Ok(Some(m)) = app.monitor_from_point(pos.x + size.width / 2.0, pos.y + size.height / 2.0) {
        let left = m.position().x as f64;
        let right = left + m.size().width as f64;
        x = x.min(right - ww - 8.0 * k).max(left + 8.0 * k);
    }
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("popover-shown", ());
}

/// Buttons in the popover and the island.
#[tauri::command]
fn tray_action(app: AppHandle, action: String, key: Option<String>) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
    }
    match action.as_str() {
        "open" => show_main(&app),
        "mini" => {
            show_main(&app);
            let _ = app.emit("set-mini", true);
        }
        "settings" => {
            show_main(&app);
            // the popover's "에이전트 연결하기" opens the settings on the agents tab
            let _ = app.emit("open-settings", key);
        }
        "select" => {
            show_main(&app);
            if let Some(k) = key {
                let _ = app.emit("select-session", k);
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

#[derive(Serialize)]
struct CharacterFile {
    name: String,
    bytes: Vec<u8>,
}

/// Custom character PNGs from ~/.agent-room/characters (local only; nothing is uploaded).
#[tauri::command]
fn list_characters() -> Vec<CharacterFile> {
    let dir = characters_dir();
    let _ = std::fs::create_dir_all(&dir);
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out = vec![];
    for e in rd.flatten() {
        let p = e.path();
        let png = p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("png"));
        let small = e.metadata().is_ok_and(|m| m.is_file() && m.len() <= 4 << 20);
        let Some(name) = p.file_stem().and_then(|x| x.to_str()) else { continue };
        if !png || !small {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&p) {
            out.push(CharacterFile { name: name.into(), bytes });
        }
        if out.len() >= 64 {
            break;
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

const SOUND_EVENTS: [&str; 4] = ["start", "done", "alert", "error"];
const SOUND_EXTS: [&str; 4] = ["mp3", "wav", "ogg", "m4a"];

#[derive(Serialize)]
struct SoundFile {
    event: String,
    bytes: Vec<u8>,
}

fn sounds_dir() -> std::path::PathBuf {
    agent_room_core::paths::data_dir().join("sounds")
}

/// The user's own effect sounds (~/.agent-room/sounds/<event>.<ext>); missing = built-in synth.
#[tauri::command]
fn list_sounds() -> Vec<SoundFile> {
    let mut out = vec![];
    for ev in SOUND_EVENTS {
        for ext in SOUND_EXTS {
            let p = sounds_dir().join(format!("{ev}.{ext}"));
            if p.metadata().is_ok_and(|m| m.is_file() && m.len() <= 2 << 20) {
                if let Ok(bytes) = std::fs::read(&p) {
                    out.push(SoundFile { event: ev.into(), bytes });
                    break;
                }
            }
        }
    }
    out
}

/// Stores a sound file the user picked for one event (replaces the previous one).
#[tauri::command]
fn save_sound(event: String, name: String, bytes: Vec<u8>) -> Result<(), String> {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !SOUND_EVENTS.contains(&event.as_str()) || !SOUND_EXTS.contains(&ext.as_str()) || bytes.len() > 2 << 20 {
        return Err("2MB 이하의 mp3·wav·ogg·m4a 파일만 쓸 수 있어요".into());
    }
    remove_sound(event.clone())?;
    std::fs::create_dir_all(sounds_dir()).map_err(|e| e.to_string())?;
    std::fs::write(sounds_dir().join(format!("{event}.{ext}")), &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_sound(event: String) -> Result<(), String> {
    if !SOUND_EVENTS.contains(&event.as_str()) {
        return Err("unknown sound event".into());
    }
    for ext in SOUND_EXTS {
        let _ = std::fs::remove_file(sounds_dir().join(format!("{event}.{ext}")));
    }
    Ok(())
}

fn characters_dir() -> std::path::PathBuf {
    agent_room_core::paths::data_dir().join("characters")
}

/// A file stem that is safe inside the characters folder: letters, digits, `-` and `_` only.
fn character_stem(name: &str) -> String {
    let stem: String = name.trim_end_matches(".png").trim_end_matches(".PNG").chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    if stem.is_empty() { "character".to_string() } else { stem }
}

/// `stem`, or `stem-2`, `stem-3`… when that name is taken.
fn free_character_stem(dir: &std::path::Path, stem: &str) -> String {
    let mut saved = stem.to_string();
    let mut n = 2;
    while dir.join(format!("{saved}.png")).exists() {
        saved = format!("{stem}-{n}");
        n += 1;
    }
    saved
}

fn check_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 4 << 20 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("4MB 이하의 PNG 파일만 추가할 수 있어요".into());
    }
    Ok(())
}

/// Path of a character file that is listed in the characters folder (any `.png` case, any name
/// the user gave it there). Only entries of that folder are matched, so a name can't reach outside it.
fn existing_character(name: &str) -> Result<std::path::PathBuf, String> {
    let found = std::fs::read_dir(characters_dir()).ok().and_then(|rd| {
        rd.flatten().map(|e| e.path()).find(|p| {
            p.is_file()
                && p.file_stem().and_then(|x| x.to_str()) == Some(name)
                && p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("png"))
        })
    });
    found.ok_or_else(|| "캐릭터 파일을 찾지 못했어요".into())
}

/// Copies a PNG the user picked into ~/.agent-room/characters (never overwrites). Returns the saved name.
#[tauri::command]
fn save_character(name: String, bytes: Vec<u8>) -> Result<String, String> {
    check_png(&bytes)?;
    let dir = characters_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let saved = free_character_stem(&dir, &character_stem(&name));
    std::fs::write(dir.join(format!("{saved}.png")), &bytes).map_err(|e| e.to_string())?;
    Ok(saved)
}

/// Swaps the picture of an added character, keeping its name.
#[tauri::command]
fn replace_character(name: String, bytes: Vec<u8>) -> Result<(), String> {
    check_png(&bytes)?;
    std::fs::write(existing_character(&name)?, &bytes).map_err(|e| e.to_string())
}

/// Renames an added character. Returns the new name (made unique if it is taken).
#[tauri::command]
fn rename_character(name: String, to: String) -> Result<String, String> {
    let from = existing_character(&name)?;
    let stem = character_stem(to.trim());
    if stem == name {
        return Ok(name);
    }
    let dir = characters_dir();
    let saved = free_character_stem(&dir, &stem);
    std::fs::rename(from, dir.join(format!("{saved}.png"))).map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn remove_character(name: String) -> Result<(), String> {
    std::fs::remove_file(existing_character(&name)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_dir() -> String {
    agent_room_core::paths::data_dir().display().to_string()
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
        &P::about(app, Some("Agent Room에 관하여"), None)?,
        &MenuItem::with_id(app, "app-update", "업데이트 확인…", true, None::<&str>)?,
        &sep()?,
        &MenuItem::with_id(app, "app-settings", "설정…", true, Some("CmdOrCtrl+,"))?,
        &sep()?,
        &P::hide(app, Some("Agent Room 가리기"))?,
        &P::hide_others(app, Some("기타 가리기"))?,
        &P::show_all(app, Some("모두 보기"))?,
        &sep()?,
        &P::quit(app, Some("Agent Room 종료"))?,
    ])?;
    let edit = Submenu::with_items(app, "편집", true, &[
        &P::undo(app, Some("실행 취소"))?,
        &P::redo(app, Some("실행 복귀"))?,
        &sep()?,
        &P::cut(app, Some("오려두기"))?,
        &P::copy(app, Some("복사하기"))?,
        &P::paste(app, Some("붙여넣기"))?,
        &P::select_all(app, Some("모두 선택"))?,
    ])?;
    let window = Submenu::with_items(app, "윈도우", true, &[
        &P::minimize(app, Some("최소화"))?,
        &P::maximize(app, Some("확대/축소"))?,
        &sep()?,
        &P::close_window(app, Some("윈도우 닫기"))?,
    ])?;
    let view = Submenu::with_items(app, "보기", true, &[
        &MenuItem::with_id(app, "zoom-in", "확대", true, Some("CmdOrCtrl+="))?,
        &MenuItem::with_id(app, "zoom-out", "축소", true, Some("CmdOrCtrl+-"))?,
        &MenuItem::with_id(app, "zoom-reset", "실제 크기", true, Some("CmdOrCtrl+0"))?,
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
            hooks_remove_all, focus_agent, double_click_ms, usage_history, demo_start, demo_stop, get_settings, save_settings, data_dir, list_characters, save_character, replace_character, rename_character, remove_character, list_sounds, save_sound, remove_sound, quit_app,
            tray_action, island_layout, notch_size, set_room_only
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
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
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
                    id if id.starts_with("session:") => {
                        show_main(app);
                        let _ = app.emit("select-session", id.trim_start_matches("session:"));
                    }
                    _ => {}
                })
                .build(app)?;

            show_island(&handle, island_on);
            sync_island(&handle);
            watch_hover(handle.clone());
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
}
