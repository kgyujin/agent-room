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
    // NSStatusWindowLevel = 25; canJoinAllSpaces (1) | transient (8: Mission Control leaves it out instead of redrawing it) | fullScreenAuxiliary (256)
    unsafe {
        let _: () = msg_send![ns, setLevel: 25isize];
        let _: () = msg_send![ns, setCollectionBehavior: (1usize | 8 | 256)];
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

/// The display (index in NSScreen.screens, screen) for the island_screen or desk_screen setting.
/// With several displays the notch is often on the laptop while the menu bar is on the big
/// monitor, so "auto" follows the notch and falls back to the menu bar's display. "pointer" is the
/// display the pointer settled on (see `watch_hover`), not every display it passes over.
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
        "pointer" => Some(POINTER_SCREEN.load(Ordering::Relaxed)).filter(|&i| i < count).or_else(|| mac_pointer_screen()),
        _ => (0..count).find(|&i| mac_notch_h(at(i)) > 0.0),
    }
    .unwrap_or(0);
    Some((pick, at(pick)))
}

/// The display the pointer has stayed on for `SCREEN_DWELL`; usize::MAX until the hover watcher
/// first looks. Windows set to follow the pointer go there.
#[cfg(target_os = "macos")]
static POINTER_SCREEN: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(usize::MAX);
/// How long the pointer stays on another display before the windows follow it, so passing over a
/// display on the way to another one moves nothing.
#[cfg(target_os = "macos")]
const SCREEN_DWELL: Duration = Duration::from_millis(400);

/// The display under the pointer right now (index in NSScreen.screens). Main thread only.
#[cfg(target_os = "macos")]
unsafe fn mac_pointer_screen() -> Option<usize> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
    let count: usize = if screens.is_null() { 0 } else { msg_send![screens, count] };
    let p: MacPoint = msg_send![class!(NSEvent), mouseLocation];
    (0..count).find(|&i| {
        let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
        let f: MacRect = msg_send![screen, frame];
        p.0 >= f.0 && p.0 < f.0 + f.2 && p.1 >= f.1 && p.1 <= f.1 + f.3
    })
}

/// Moves a window that follows the pointer to the display the pointer settled on, quietly: the page
/// fades out ("<label>-leaving"), the window moves while it can't be seen, and the page fades back in
/// when told it arrived ("island-screen" / "desk-screen"). The display `to` becomes the target only
/// after the fade out, so a placement in between (the 10 s tick) can't move a window still in view.
#[cfg(target_os = "macos")]
fn follow_pointer_screen(app: &AppHandle, to: usize, island: bool, desk: bool) {
    for (on, label) in [(island, "island"), (desk, "desk")] {
        if on {
            let _ = app.emit_to(label, &format!("{label}-leaving"), ());
        }
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("agent-room-move".into()).spawn(move || {
        // a little longer than the page's fade out
        std::thread::sleep(Duration::from_millis(180));
        POINTER_SCREEN.store(to, Ordering::Relaxed);
        if island {
            sync_island(&app);
        }
        if let Some(w) = app.get_webview_window("desk").filter(|_| desk) {
            place_desk(&app, &w);
        }
    });
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct MacRect(f64, f64, f64, f64);

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct MacPoint(f64, f64);

/// Where the pointer is, read off the main thread (CoreGraphics, global display coordinates).
#[cfg(target_os = "macos")]
fn mac_pointer() -> Option<(f64, f64)> {
    use std::ffi::c_void;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *const c_void;
        fn CGEventGetLocation(event: *const c_void) -> MacPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    unsafe {
        let e = CGEventCreate(std::ptr::null());
        if e.is_null() {
            return None;
        }
        let p = CGEventGetLocation(e);
        CFRelease(e);
        Some((p.0, p.1))
    }
}

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
/// With `reach_up`, a pointer above the window on the same display counts too (negative y).
pub(crate) fn mac_pointer_in(app: &AppHandle, w: &WebviewWindow, reach_up: bool) -> Option<(i32, i32)> {
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
        let mut top = 0.0;
        if reach_up {
            let screen: *mut AnyObject = msg_send![ns, screen];
            if !screen.is_null() {
                let d: MacRect = msg_send![screen, frame];
                top = -(d.1 + d.3 - (f.1 + f.3));
            }
        }
        (x >= 0.0 && y >= top && x < f.2 && y < f.3).then(|| (x as i32, y as i32))
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
/// Set while the main window shows only the room: the hover watcher then reports the pointer on
/// every tick, so the page always knows whether a click should pass through the clear part.
static ROOM_ONLY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) fn watch_hover(app: AppHandle) {
    let _ = std::thread::Builder::new().name("agent-room-hover".into()).spawn(move || {
        let mut last_island: Option<bool> = None;
        let mut last_main: Option<Option<(i32, i32)>> = None;
        let mut last_desk: Option<Option<(i32, i32)>> = None;
        // the display the pointer moved to and since when, until it has stayed there SCREEN_DWELL
        #[cfg(target_os = "macos")]
        let mut pending_screen: Option<(usize, std::time::Instant)> = None;
        let mut last_pointer: Option<(f64, f64)> = None;
        let mut still = 0u32;
        loop {
            let room_only = ROOM_ONLY.load(std::sync::atomic::Ordering::Relaxed);
            // desktop pets move: a click must find the pet where it is now, not where it was
            let desk_on = app.get_webview_window("desk").is_some();
            std::thread::sleep(Duration::from_millis(if room_only || desk_on { 50 } else { 120 }));
            #[cfg(not(target_os = "macos"))]
            let Ok(c) = app.cursor_position() else { continue };
            #[cfg(not(target_os = "macos"))]
            let pointer = Some((c.x, c.y));
            #[cfg(target_os = "macos")]
            let pointer = mac_pointer();
            // the windows are only looked at (on the main thread) when the pointer moved, and every
            // 20th tick in case a window moved or opened under a still pointer. Checking them on every
            // tick kept the main thread and the page busy while nobody touched the mouse
            still += 1;
            #[cfg(target_os = "macos")]
            let waiting = pending_screen.is_some();
            #[cfg(not(target_os = "macos"))]
            let waiting = false;
            if pointer == last_pointer && still < 20 && !waiting {
                continue;
            }
            last_pointer = pointer;
            still = 0;
            let at_reach = |label: &str, reach_up: bool| -> Option<(i32, i32)> {
                let w = app.get_webview_window(label)?;
                if !w.is_visible().unwrap_or(false) {
                    return None;
                }
                // macOS: the pointer and the window frame both in global points, so displays with
                // different scaling (a Retina laptop next to a plain monitor) can't mix up
                #[cfg(target_os = "macos")]
                return mac_pointer_in(&app, &w, reach_up);
                #[cfg(not(target_os = "macos"))]
                {
                    let (p, s, k) = (w.inner_position().ok()?, w.inner_size().ok()?, w.scale_factor().ok()?);
                    let (x, y) = (c.x - p.x as f64, c.y - p.y as f64);
                    let top = match (reach_up, w.current_monitor().ok().flatten()) {
                        (true, Some(m)) => (m.position().y - p.y) as f64,
                        _ => 0.0,
                    };
                    (x >= 0.0 && y >= top && x < s.width as f64 && y < s.height as f64).then(|| ((x / k) as i32, (y / k) as i32))
                }
            };
            let at = |label: &str| at_reach(label, false);
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
            // "pointer": the island and the desktop pets follow the pointer to another display once
            // it has stayed there a moment, fading out and back in instead of jumping
            #[cfg(target_os = "macos")]
            {
                let (island_mode, desk_mode) = {
                    let shared = app.state::<Shared>();
                    let st = shared.settings.lock().unwrap();
                    (st.island_screen == "pointer", st.desk_screen == "pointer")
                };
                let island_follows = island_mode && app.get_webview_window("island").is_some();
                let desk_follows = desk_mode && desk_on;
                if island_follows || desk_follows {
                    let idx = mac_on_main(&app, || unsafe { mac_pointer_screen() }).flatten();
                    let settled = POINTER_SCREEN.load(Ordering::Relaxed);
                    match idx {
                        // first look: the windows were just placed on the pointer's display
                        Some(i) if settled == usize::MAX => POINTER_SCREEN.store(i, Ordering::Relaxed),
                        Some(i) if i != settled => match pending_screen {
                            Some((p, since)) if p == i && since.elapsed() >= SCREEN_DWELL => {
                                // set again after this move's fade out, so the dwell starts over meanwhile
                                pending_screen = None;
                                follow_pointer_screen(&app, i, island_follows, desk_follows);
                            }
                            Some((p, _)) if p == i => {}
                            _ => pending_screen = Some((i, std::time::Instant::now())),
                        },
                        _ => pending_screen = None,
                    }
                } else {
                    pending_screen = None;
                }
            }
            // the desktop pets' strip: the pointer on every tick while it is over the strip, so the
            // page can let clicks through everywhere but on a pet. Above the strip on the same display
            // counts too (y < 0, never on a pet), so a pet that needs the user can come over to them
            let desk = if desk_on { at_reach("desk", true) } else { None };
            if desk.is_some() || last_desk != Some(desk) {
                last_desk = Some(desk);
                let _ = app.emit_to("desk", "hover-desk", desk);
            }
            let main = at("main");
            if last_main != Some(main) || (room_only && main.is_some()) {
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
    ROOM_ONLY.store(on, std::sync::atomic::Ordering::Relaxed);
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

// ------------------------------------------------------------------ desktop pets

/// Height in points of the see-through strip along the bottom of the screen where the desktop
/// pets walk (sitting on the Dock, or on the screen's bottom edge when the Dock hides).
pub(crate) const DESK_H: f64 = 240.0;

/// The pet each session has in the room (session key -> pet name). The room tells the app, so the
/// same session's desktop pet looks the same.
static PET_SKINS: Mutex<std::collections::BTreeMap<String, String>> = Mutex::new(std::collections::BTreeMap::new());

#[tauri::command]
pub(crate) fn set_pet_skins(app: AppHandle, by_session: std::collections::BTreeMap<String, String>) {
    *PET_SKINS.lock().unwrap() = by_session.clone();
    let _ = app.emit_to("desk", "pet-skins", by_session);
}

#[tauri::command]
pub(crate) fn pet_skins() -> std::collections::BTreeMap<String, String> {
    PET_SKINS.lock().unwrap().clone()
}

/// Puts the desktop pets' strip on screen, or removes it. Like the island, its web view only exists
/// while the setting is on, so turned off it costs nothing. The strip lets every click through
/// except on a pet (the page decides, from the pointer the hover watcher reports).
pub(crate) fn show_desk(app: &AppHandle, on: bool) {
    let existing = app.get_webview_window("desk");
    if !on {
        if let Some(w) = existing {
            let _ = w.destroy();
        }
        return;
    }
    if existing.is_some() {
        return;
    }
    let Ok(w) = WebviewWindowBuilder::new(app, "desk", WebviewUrl::App("index.html".into()))
        .title("Agent Room")
        .inner_size(800.0, DESK_H)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        // clicking a pet must not pull Agent Room in front of the app being used
        .focusable(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .build()
    else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        if let Ok(ptr) = w.ns_window() {
            let ns = ptr as *mut AnyObject;
            // NSFloatingWindowLevel = 3: over app windows, under the menu bar, the island and menus.
            // canJoinAllSpaces (1) | transient (8: left out of Mission Control) | ignoresCycle (64); not over full-screen apps.
            unsafe {
                let _: () = msg_send![ns, setLevel: 3isize];
                let _: () = msg_send![ns, setCollectionBehavior: (1usize | 8 | 64)];
            }
        }
    }
    place_desk(app, &w);
    let _ = w.show();
    // after show: on Linux the window must exist on screen before it can let clicks through
    let _ = w.set_ignore_cursor_events(true);
}

/// Lays the strip along the bottom of the display picked in settings (desk_screen, same choices as
/// the island's), just above the Dock.
pub(crate) fn place_desk(app: &AppHandle, w: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::msg_send;
        let Ok(ptr) = w.ns_window() else { return };
        let ns = ptr as usize;
        let mode = app.state::<Shared>().settings.lock().unwrap().desk_screen.clone();
        let app = app.clone();
        let _ = w.run_on_main_thread(move || unsafe {
            let ns = ns as *mut AnyObject;
            let Some((_, screen)) = mac_island_screen(&mode) else { return };
            if ns.is_null() {
                return;
            }
            // Cocoa's origin is at the bottom-left
            let vis: MacRect = msg_send![screen, visibleFrame];
            let r = MacRect(vis.0, vis.1, vis.2, DESK_H.min(vis.3));
            let now: MacRect = msg_send![ns, frame];
            if (now.0 - r.0).abs() < 0.5 && (now.1 - r.1).abs() < 0.5 && (now.2 - r.2).abs() < 0.5 && (now.3 - r.3).abs() < 0.5 {
                return;
            }
            let _: () = msg_send![ns, setFrame: r, display: true];
            // the page fades the pets back in
            let _ = app.emit_to("desk", "desk-screen", ());
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let Ok(Some(mon)) = app.primary_monitor() else { return };
        let k = mon.scale_factor();
        let area = mon.work_area();
        let (x, y) = (area.position.x as f64 / k, area.position.y as f64 / k);
        let (width, height) = (area.size.width as f64 / k, area.size.height as f64 / k);
        let h = DESK_H.min(height);
        let _ = w.set_size(tauri::LogicalSize::new(width, h));
        let _ = w.set_position(tauri::LogicalPosition::new(x, y + height - h));
    }
}
