//! The menu bar icon (animated from the session states) and its menu.

use super::*;

/// Menu bar icon frames: the pet waddles while agents work (faster with more of them), shows a "!"
/// when one waits for the user, a check right after work finishes, dozes when all are idle, and
/// fades to grey when none is connected. Only the session states are read. These bundled shiba
/// frames show until the app sends frames drawn from the pet picked in settings.
pub(crate) const TRAY_RUN: [&[u8]; 4] = [
    include_bytes!("../icons/tray_run0.png"),
    include_bytes!("../icons/tray_run1.png"),
    include_bytes!("../icons/tray_run2.png"),
    include_bytes!("../icons/tray_run3.png"),
];
pub(crate) const TRAY_WAIT: &[u8] = include_bytes!("../icons/tray_wait.png");
pub(crate) const TRAY_DONE: &[u8] = include_bytes!("../icons/tray_done.png");
pub(crate) const TRAY_IDLE: &[u8] = include_bytes!("../icons/tray_idle.png");
pub(crate) const TRAY_OFF: &[u8] = include_bytes!("../icons/tray_off.png");

pub(crate) fn animate_tray(app: AppHandle) {
    let _ = std::thread::Builder::new().name("agent-room-tray".into()).spawn(move || {
        use agent_room_core::session::Connection;
        let mut frame = 0usize;
        let mut last = (0u64, usize::MAX);
        loop {
            let shared = app.state::<Shared>();
            let done_ms = shared.settings.lock().unwrap().done_shown_sec as u64 * 1000;
            let now = now_ms();
            let live: Vec<Snapshot> = shared.store.lock().unwrap().snapshots().into_iter().filter(|s| matches!(s.connection, Connection::Live | Connection::Stale)).collect();
            let working = live.iter().filter(|s| matches!(s.state, AgentState::Starting | AgentState::Planning | AgentState::Reading | AgentState::Editing | AgentState::Running | AgentState::Testing)).count();
            // same rule as the number beside the icon: only sessions still sending events count as asking
            let waiting = live.iter().any(|s| s.connection == Connection::Live && matches!(s.state, AgentState::Waiting | AgentState::Error));
            let done = live.iter().any(|s| s.state == AgentState::Completed && (done_ms == 0 || s.turn_ended_at.is_some_and(|t| now.saturating_sub(t) < done_ms)));
            // frame index: run0..3, wait, done, idle, off
            let (idx, wait_ms): (usize, u64) = if waiting {
                (4, 400)
            } else if working > 0 {
                frame = (frame + 1) % TRAY_RUN.len();
                (frame, match working { 1 => 220, 2 | 3 => 150, _ => 100 })
            } else if done {
                (5, 400)
            } else if !live.is_empty() {
                (6, 600)
            } else {
                (7, 600)
            };
            let custom = shared.tray_frames.lock().unwrap().clone();
            let key = (custom.as_ref().map_or(0, |f| f.0), idx);
            if key != last {
                last = key;
                let builtin = [TRAY_RUN[0], TRAY_RUN[1], TRAY_RUN[2], TRAY_RUN[3], TRAY_WAIT, TRAY_DONE, TRAY_IDLE, TRAY_OFF];
                let bytes = custom.as_ref().map_or(builtin[idx], |f| f.1[idx].as_slice());
                if let (Some(tray), Ok(img)) = (app.tray_by_id("main"), tauri::image::Image::from_bytes(bytes)) {
                    #[cfg(target_os = "macos")]
                    mac_tray_image(&tray, bytes.to_vec(), img.width(), img.height());
                    #[cfg(not(target_os = "macos"))]
                    let _ = tray.set_icon(Some(img));
                }
            }
            std::thread::sleep(Duration::from_millis(wait_ms));
        }
    });
}

/// tray-icon draws every icon 18pt tall. The frames are drawn at 2 px per point, so each one is put
/// on the menu bar button at its own size (a 44 px frame shows 22pt tall and the pet fills the menu
/// bar like other icons), in one step on the main thread: setting the icon through tray-icon first
/// and resizing it after showed some frames at 18pt and others at 22pt.
#[cfg(target_os = "macos")]
pub(crate) fn mac_tray_image(tray: &tauri::tray::TrayIcon, png: Vec<u8>, w_px: u32, h_px: u32) {
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let _ = tray.with_inner_tray_icon(move |t| unsafe {
        let Some(item) = t.ns_status_item() else { return };
        let item = objc2::rc::Retained::as_ptr(&item) as *mut AnyObject;
        let button: *mut AnyObject = msg_send![item, button];
        if button.is_null() {
            return;
        }
        let data: *mut AnyObject = msg_send![class!(NSData), dataWithBytes: png.as_ptr().cast::<std::ffi::c_void>(), length: png.len()];
        let alloc: Allocated<AnyObject> = msg_send![class!(NSImage), alloc];
        let Some(image): Option<Retained<AnyObject>> = msg_send![alloc, initWithData: data] else { return };
        let _: () = msg_send![&*image, setSize: MacSize(w_px as f64 / 2.0, h_px as f64 / 2.0)];
        let _: () = msg_send![button, setImage: &*image];
        // tray-icon's click target sits over the button at the button's size; keep it matching
        let frame: MacRect = msg_send![button, frame];
        let subviews: *mut AnyObject = msg_send![button, subviews];
        let count: usize = if subviews.is_null() { 0 } else { msg_send![subviews, count] };
        for i in 0..count {
            let v: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
            let name: *const std::ffi::c_char = objc2::ffi::object_getClassName(v);
            if !name.is_null() && std::ffi::CStr::from_ptr(name).to_bytes() == b"TaoTrayTarget" {
                let _: () = msg_send![v, setFrame: frame];
            }
        }
    });
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct MacSize(f64, f64);

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for MacSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGSize", &[objc2::encode::Encoding::Double, objc2::encode::Encoding::Double]);
}

pub(crate) fn agent_label(s: &Snapshot) -> &'static str {
    match s.agent {
        agent_room_core::model::AgentKind::Claude => "Claude Code",
        agent_room_core::model::AgentKind::Codex => "Codex",
        agent_room_core::model::AgentKind::Demo => tr("데모", "Demo"),
    }
}

pub(crate) fn state_label(s: &Snapshot) -> &'static str {
    use agent_room_core::session::Connection;
    if s.connection == Connection::Stale {
        return tr("응답 없음", "Not responding");
    }
    match s.state {
        AgentState::Idle => tr("대기 중", "Idle"),
        AgentState::Starting => tr("작업 시작", "Starting"),
        AgentState::Planning => tr("분석 중", "Thinking"),
        AgentState::Reading => tr("파일 확인", "Reading"),
        AgentState::Editing => tr("코드 작성", "Editing"),
        AgentState::Running => tr("명령 실행", "Running"),
        AgentState::Testing => tr("테스트", "Testing"),
        AgentState::Waiting => {
            if s.waiting.as_ref().is_some_and(|w| w.kind == "approval") { tr("승인 필요", "Needs approval") } else { tr("입력 대기", "Waiting for input") }
        }
        AgentState::Completed => tr("완료", "Done"),
        AgentState::Error => tr("오류", "Error"),
        AgentState::Disconnected => tr("연결 끊김", "Disconnected"),
    }
}

/// Most important session first: waiting > error > working > rest.
/// menu order: what needs the user first (the longest-waiting at the top), then work, then the rest newest first
pub(crate) fn order_key(s: &Snapshot) -> (u8, u64) {
    let asked = s.waiting.as_ref().map(|w| w.since).or_else(|| (s.state == AgentState::Error).then(|| s.error.as_ref().map_or(s.last_event_at, |e| e.at)));
    (priority(s), asked.unwrap_or(u64::MAX - s.last_event_at))
}

pub(crate) fn priority(s: &Snapshot) -> u8 {
    match s.state {
        AgentState::Waiting => 0,
        AgentState::Error => 1,
        AgentState::Starting | AgentState::Planning | AgentState::Reading | AgentState::Editing | AgentState::Running | AgentState::Testing => 2,
        AgentState::Completed => 3,
        AgentState::Idle => 4,
        AgentState::Disconnected => 5,
    }
}

pub(crate) fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let mut sessions: Vec<Snapshot> = app.state::<Shared>().store.lock().unwrap().snapshots().into_iter().filter(|s| !s.is_demo).collect();
    sessions.sort_by_key(order_key);
    let summary = sessions.first().map(|s| {
        let extra = if sessions.len() > 1 { format!(" +{}", sessions.len() - 1) } else { String::new() };
        format!("{}{}", state_label(s), extra)
    });
    // the icon itself shows the state (see animate_tray); the text beside it is only the number of
    // agents waiting for the user, so the menu bar stays short
    let waiting = sessions.iter().filter(|s| s.connection == agent_room_core::session::Connection::Live && matches!(s.state, AgentState::Waiting | AgentState::Error)).count();
    let _ = tray.set_title((waiting > 0).then(|| waiting.to_string()).as_deref());
    let _ = tray.set_tooltip(Some(summary.as_deref().unwrap_or(tr("Agent Room · 연결된 에이전트 없음", "Agent Room · no agents connected"))));
    if let Ok(menu) = build_menu(app, &sessions) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub(crate) fn build_menu(app: &AppHandle, sessions: &[Snapshot]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "open", tr("Agent Room 열기", "Open Agent Room"), true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "mini", tr("방만 띄우기", "Room Only"), true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if sessions.is_empty() {
        menu.append(&MenuItem::with_id(app, "none", tr("연결된 에이전트 없음", "No agents connected"), false, None::<&str>)?)?;
    }
    for s in sessions.iter().take(8) {
        let label = format!("{} · {} — {}", agent_label(s), s.project.clone().unwrap_or_else(|| "?".into()), state_label(s));
        menu.append(&MenuItem::with_id(app, format!("session:{}", s.key), label, true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "settings", tr("설정…", "Settings…"), true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "update", tr("업데이트 확인…", "Check for Updates…"), true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", tr("종료", "Quit"), true, None::<&str>)?)?;
    Ok(menu)
}
