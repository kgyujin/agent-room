//! Agent Room desktop shell: IPC server, session store, tray, notifications, commands.
//! The UI (React + Canvas) only renders snapshots pushed from here.

mod demo;

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
    pub notify_only_when_hidden: bool,
    pub stale_minutes: u32,
    pub panel_open: bool,
    pub always_on_top: bool,
    pub show_tokens: bool,
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            sfx: true,
            bgm: false,
            notify_complete: true,
            notify_approval: true,
            notify_only_when_hidden: true,
            stale_minutes: 3,
            panel_open: true,
            always_on_top: false,
            show_tokens: true,
            characters: Default::default(),
            critter_colors: Default::default(),
            ui_theme: "peach".into(),
            island: true,
            font: "mixed".into(),
            backdrop: String::new(),
            tag_style: "compact".into(),
            show_dock: true,
            show_tabs: true,
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
    std::fs::write(path, serde_json::to_string_pretty(&settings).unwrap()).map_err(|e| e.to_string())?;
    show_island(&app, settings.island);
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

/// Shows or hides the island at the top centre of the primary screen.
fn show_island(app: &AppHandle, on: bool) {
    let Some(w) = app.get_webview_window("island") else { return };
    if on {
        let size = w.inner_size().ok().map(|s| s.to_logical::<f64>(w.scale_factor().unwrap_or(1.0)));
        if let Some(s) = size {
            place_island(app, &w, s.width, s.height);
        }
        let _ = w.show();
    } else {
        let _ = w.hide();
    }
}

fn place_island(app: &AppHandle, w: &WebviewWindow, width: f64, height: f64) {
    let Ok(Some(mon)) = app.primary_monitor() else { return };
    let k = mon.scale_factor();
    let x = mon.position().x as f64 / k + (mon.size().width as f64 / k - width) / 2.0;
    let y = mon.position().y as f64 / k;
    let _ = w.set_size(tauri::LogicalSize::new(width, height));
    let _ = w.set_position(tauri::LogicalPosition::new(x.round(), y));
}

/// The island grows when hovered/clicked and shrinks back; it stays centred at the top.
#[tauri::command]
fn island_layout(app: AppHandle, width: f64, height: f64) {
    if let Some(w) = app.get_webview_window("island") {
        place_island(&app, &w, width.clamp(120.0, 640.0), height.clamp(24.0, 640.0));
    }
}

/// Opens the popover under the menu bar icon (or closes it when it is already open).
fn toggle_popover(app: &AppHandle, rect: tauri::Rect) {
    let Some(w) = app.get_webview_window("tray") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    if now_ms().saturating_sub(POPOVER_HIDDEN_AT.load(Ordering::SeqCst)) < 400 {
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
            let _ = app.emit("open-settings", ());
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
    let dir = agent_room_core::paths::data_dir().join("characters");
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

/// Copies a PNG the user picked into ~/.agent-room/characters (never overwrites). Returns the saved name.
#[tauri::command]
fn save_character(name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > 4 << 20 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("4MB 이하의 PNG 파일만 추가할 수 있어요".into());
    }
    let stem: String = name.trim_end_matches(".png").trim_end_matches(".PNG").chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    let stem = if stem.is_empty() { "character".to_string() } else { stem };
    let dir = agent_room_core::paths::data_dir().join("characters");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut saved = stem.clone();
    let mut n = 2;
    while dir.join(format!("{saved}.png")).exists() {
        saved = format!("{stem}-{n}");
        n += 1;
    }
    std::fs::write(dir.join(format!("{saved}.png")), &bytes).map_err(|e| e.to_string())?;
    Ok(saved)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![
            get_overview, get_timeline, remove_session, hooks_status, hooks_install, hooks_uninstall, hooks_restore,
            hooks_remove_all, demo_start, demo_stop, get_settings, save_settings, data_dir, list_characters, save_character, list_sounds, save_sound, remove_sound, quit_app,
            tray_action, island_layout
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
                    "quit" => app.exit(0),
                    id if id.starts_with("session:") => {
                        show_main(app);
                        let _ = app.emit("select-session", id.trim_start_matches("session:"));
                    }
                    _ => {}
                })
                .build(app)?;

            extra_window(&handle, "tray", 360.0, 480.0, false)?;
            extra_window(&handle, "island", 340.0, 34.0, true)?;
            show_island(&handle, island_on);
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
