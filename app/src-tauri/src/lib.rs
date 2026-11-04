//! Agent Room desktop shell: IPC server, session store, tray, notifications, commands.
//! The UI (React + Canvas) only renders snapshots pushed from here.

mod demo;

use agent_room_core::adapters::{normalize, Envelope};
use agent_room_core::install::{self, HookStatus, Target};
use agent_room_core::model::{now_ms, AgentState, NormEvent};
use agent_room_core::runtime::{self, ProcWatch};
use agent_room_core::session::{Notice, SessionStore, Snapshot, TimelineEntry, Update};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// Set only when this process bound the hook socket, so a second instance
/// (which fails with AddrInUse) never unlinks the running instance's socket.
static OWNS_SOCKET: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub sfx: bool,
    pub bgm: bool,
    pub notify_complete: bool,
    pub notify_approval: bool,
    pub notify_only_when_hidden: bool,
    pub stale_minutes: u32,
    pub panel_open: bool,
    pub always_on_top: bool,
    pub show_tokens: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "day".into(),
            sfx: true,
            bgm: false,
            notify_complete: true,
            notify_approval: true,
            notify_only_when_hidden: true,
            stale_minutes: 3,
            panel_open: true,
            always_on_top: false,
            show_tokens: true,
        }
    }
}

#[derive(Default)]
struct Shared {
    store: Mutex<SessionStore>,
    procs: Mutex<ProcWatch>,
    settings: Mutex<Settings>,
    detected: Mutex<(u32, u32)>,
    server_error: Mutex<Option<String>>,
    demo_stop: Mutex<Option<Arc<AtomicBool>>>,
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
    refresh_tray(app);
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
    let _ = tray.set_tooltip(Some(title.as_deref().unwrap_or("Agent Room · 연결된 Agent 없음")));
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
        menu.append(&MenuItem::with_id(app, "none", "연결된 Agent 세션 없음", false, None::<&str>)?)?;
    }
    for s in sessions.iter().take(8) {
        let label = format!("{} · {} — {}", agent_label(s), s.project.clone().unwrap_or_else(|| "?".into()), state_label(s));
        menu.append(&MenuItem::with_id(app, format!("session:{}", s.key), label, true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
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
    std::fs::write(path, serde_json::to_string_pretty(&settings).unwrap()).map_err(|e| e.to_string())
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![
            get_overview, get_timeline, remove_session, hooks_status, hooks_install, hooks_uninstall, hooks_restore,
            hooks_remove_all, demo_start, demo_stop, get_settings, save_settings, data_dir, quit_app
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);
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
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => show_main(app),
                    "mini" => {
                        show_main(app);
                        let _ = app.emit("set-mini", true);
                    }
                    "quit" => app.exit(0),
                    id if id.starts_with("session:") => {
                        show_main(app);
                        let _ = app.emit("select-session", id.trim_start_matches("session:"));
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the window keeps Agent Room in the menu bar
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
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
