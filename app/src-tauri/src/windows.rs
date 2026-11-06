//! The menu bar popover and the top-centre island windows (placement, hover, notch).

use super::*;

/// Window for the menu bar popover ("tray") and the top-centre status pill ("island").
/// Both load the same page; the UI picks its view from the window label.
pub(crate) fn extra_window(app: &AppHandle, label: &str, w: f64, h: f64, resizable: bool) -> tauri::Result<WebviewWindow> {
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
pub(crate) fn float_over_menu_bar(win: &WebviewWindow) {
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
pub(crate) const ISLAND_WIN: (f64, f64) = (640.0, 560.0);
/// The pill's current size in points, reported by the page; the hover check uses it.
pub(crate) static ISLAND_PILL: Mutex<(f64, f64)> = Mutex::new((366.0, 34.0));

pub(crate) fn show_island(app: &AppHandle, on: bool) {
    let existing = app.get_webview_window("island");
    if !on {
        if let Some(w) = existing {
            let _ = w.destroy();
        }
        return;
    }
    // already there: sync_island keeps it placed and shown or hidden. Showing it again on every
    // settings change took the focus from the main window and flashed a hidden island.
    if existing.is_some() {
        return;
    }
    let Ok(w) = extra_window(app, "island", ISLAND_WIN.0, ISLAND_WIN.1, true) else { return };
    place_island(app, &w, ISLAND_WIN.0, ISLAND_WIN.1);
    // the hover watcher turns clicks back on while the pointer is over the pill
    let _ = w.set_ignore_cursor_events(true);
}

pub(crate) fn place_island(app: &AppHandle, w: &WebviewWindow, width: f64, height: f64) {
    #[cfg(target_os = "macos")]
    {
        let mode = app.state::<Shared>().settings.lock().unwrap().island_screen.clone();
        if mac_set_frame(app, w, width, height, mode) {
            return;
        }
    }
    let Ok(Some(mon)) = app.primary_monitor() else { return };
    let k = mon.scale_factor();
    let x = mon.position().x as f64 / k + (mon.size().width as f64 / k - width) / 2.0;
    let y = mon.position().y as f64 / k;
    let _ = w.set_size(tauri::LogicalSize::new(width, height));
    let _ = w.set_position(tauri::LogicalPosition::new(x.round(), y));
}

/// Moves and resizes the island in one step to the top centre of the screen with the menu bar (and
/// the notch). Two separate calls (size, then position) showed a frame of the pill off-centre.
/// Both x and y come from that screen's Cocoa frame, the same coordinates `setFrame` uses, so a
/// second display, a changed resolution or a different scale can't put the island mid-screen.
/// Does nothing when the island is already there.
#[cfg(target_os = "macos")]
pub(crate) fn mac_set_frame(app: &AppHandle, w: &WebviewWindow, width: f64, height: f64, mode: String) -> bool {
    use objc2::runtime::AnyObject;
    use objc2::msg_send;
    let Ok(ptr) = w.ns_window() else { return false };
    let ns = ptr as usize;
    let app = app.clone();
    w.run_on_main_thread(move || unsafe {
        let ns = ns as *mut AnyObject;
        let Some((_, screen)) = mac_island_screen(&mode) else { return };
        if ns.is_null() {
            return;
        }
        // Cocoa puts the origin at the bottom-left of the first screen
        let frame: MacRect = msg_send![screen, frame];
        let r = MacRect((frame.0 + (frame.2 - width) / 2.0).round(), frame.1 + frame.3 - height, width, height);
        let now: MacRect = msg_send![ns, frame];
        if (now.0 - r.0).abs() < 0.5 && (now.1 - r.1).abs() < 0.5 && (now.2 - r.2).abs() < 0.5 && (now.3 - r.3).abs() < 0.5 {
            return;
        }
        let _: () = msg_send![ns, setFrame: r, display: true];
        // another display may have another notch (or none): the page sizes the pill again
        let _ = app.emit_to("island", "island-screen", ());
    })
    .is_ok()
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct MacInsets(f64, f64, f64, f64);

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for MacInsets {
    const ENCODING: objc2::encode::Encoding = {
        use objc2::encode::Encoding;
        Encoding::Struct("NSEdgeInsets", &[Encoding::Double, Encoding::Double, Encoding::Double, Encoding::Double])
    };
}

/// Height of the camera notch on a screen in points, or 0 without one (or before macOS 12).
#[cfg(target_os = "macos")]
pub(crate) unsafe fn mac_notch_h(screen: *mut objc2::runtime::AnyObject) -> f64 {
    use objc2::{msg_send, sel};
    let has: bool = msg_send![screen, respondsToSelector: sel!(auxiliaryTopLeftArea)];
    if !has {
        return 0.0;
    }
    let inset: MacInsets = msg_send![screen, safeAreaInsets];
    inset.0.max(0.0)
}

/// The display that holds the island (index in NSScreen.screens, screen) for the island_screen
/// setting. With several displays the notch is often on the laptop while the menu bar is on the
/// big monitor, so "auto" follows the notch and falls back to the menu bar's display.
#[cfg(target_os = "macos")]
pub(crate) unsafe fn mac_island_screen(mode: &str) -> Option<(usize, *mut objc2::runtime::AnyObject)> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
    let count: usize = if screens.is_null() { 0 } else { msg_send![screens, count] };
    if count == 0 {
        return None;
    }
    let at = |i: usize| -> *mut AnyObject { msg_send![screens, objectAtIndex: i] };
    let pick = match mode {
        "main" => None,
        "pointer" => {
            let p: MacPoint = msg_send![class!(NSEvent), mouseLocation];
            (0..count).find(|&i| {
                let f: MacRect = msg_send![at(i), frame];
                p.0 >= f.0 && p.0 < f.0 + f.2 && p.1 >= f.1 && p.1 <= f.1 + f.3
            })
        }
        _ => (0..count).find(|&i| mac_notch_h(at(i)) > 0.0),
    }
    .unwrap_or(0);
    Some((pick, at(pick)))
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct MacRect(f64, f64, f64, f64);

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct MacPoint(f64, f64);

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for MacPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGPoint", &[objc2::encode::Encoding::Double, objc2::encode::Encoding::Double]);
}

/// Runs `f` on the main thread (AppKit) and waits briefly for its answer. Called on the main
/// thread itself (sync commands, tray clicks) it runs `f` right away: waiting there for the main
/// thread would only time out.
#[cfg(target_os = "macos")]
pub(crate) fn mac_on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    use objc2::{class, msg_send};
    let on_main: bool = unsafe { msg_send![class!(NSThread), isMainThread] };
    if on_main {
        return Some(f());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .ok()?;
    rx.recv_timeout(Duration::from_millis(250)).ok()
}

/// The pointer inside the window, in points from its top-left (= CSS px), or None outside.
#[cfg(target_os = "macos")]
pub(crate) fn mac_pointer_in(app: &AppHandle, w: &WebviewWindow) -> Option<(i32, i32)> {
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
pub(crate) fn mac_place_popover(app: &AppHandle, w: &WebviewWindow) -> bool {
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
pub(crate) fn notch_size(app: AppHandle) -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        let mode = app.state::<Shared>().settings.lock().unwrap().island_screen.clone();
        return mac_on_main(&app, move || mac_notch(&mode)).flatten();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn mac_notch(mode: &str) -> Option<(f64, f64)> {
    use objc2::msg_send;
    unsafe {
        let (_, screen) = mac_island_screen(mode)?;
        let h = mac_notch_h(screen);
        if h <= 0.0 {
            return None;
        }
        let frame: MacRect = msg_send![screen, frame];
        let left: MacRect = msg_send![screen, auxiliaryTopLeftArea];
        let right: MacRect = msg_send![screen, auxiliaryTopRightArea];
        let width = frame.2 - left.2 - right.2;
        (width > 0.0).then_some((width, h))
    }
}

/// Tells the main window and the island where the pointer is. macOS sends no hover events to a
/// window of an app that is not frontmost, so without this the island only opened and the
/// room-only controls only showed after a click. Only the pointer position is read.
/// Each window gets its own event name: a page's `listen` hears events sent to any window.
/// "hover-island": true / false. "hover-main": the pointer in window (CSS px) or null outside.
pub(crate) fn watch_hover(app: AppHandle) {
    let _ = std::thread::Builder::new().name("agent-room-hover".into()).spawn(move || {
        let mut last_island: Option<bool> = None;
        let mut last_main: Option<Option<(i32, i32)>> = None;
        #[cfg(target_os = "macos")]
        let mut last_screen: Option<usize> = None;
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
            // "pointer": move the island when the pointer goes to another display
            #[cfg(target_os = "macos")]
            if app.get_webview_window("island").is_some() && app.state::<Shared>().settings.lock().unwrap().island_screen == "pointer" {
                let idx = mac_on_main(&app, || unsafe { mac_island_screen("pointer").map(|s| s.0) }).flatten();
                if idx.is_some() && idx != last_screen {
                    last_screen = idx;
                    sync_island(&app);
                }
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
pub(crate) fn set_room_only(app: AppHandle, on: bool) {
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
pub(crate) fn island_layout(width: f64, height: f64) {
    *ISLAND_PILL.lock().unwrap() = (width.clamp(120.0, ISLAND_WIN.0), height.clamp(24.0, ISLAND_WIN.1));
}

/// Opens the popover under the menu bar icon (or closes it when it is already open).
/// The popover's web view is made on the first click, not at launch.
pub(crate) fn toggle_popover(app: &AppHandle, rect: tauri::Rect) {
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
pub(crate) fn tray_action(app: AppHandle, action: String, key: Option<String>) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
    }
    match action.as_str() {
        "open" => show_main(&app),
        "mini" => {
            show_main(&app);
            let _ = app.emit("set-mini", true);
        }
        "dashboard" => {
            show_main(&app);
            let _ = app.emit("open-dashboard", ());
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
        // a session row: straight to that session's own terminal tab, editor or chat;
        // when it can't be found, show it in the room instead
        "focus" => {
            if let Some(k) = key {
                if focus_agent(app.clone(), k.clone()).is_err() {
                    show_main(&app);
                    let _ = app.emit("select-session", k);
                }
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
