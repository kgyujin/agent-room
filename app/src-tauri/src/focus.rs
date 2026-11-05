//! Bringing up the exact place a session runs: its terminal tab, its editor window, its Codex chat.
//! Only process ids, the terminal device (tty), the working folder and the session id are used.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::Path;

/// How to reach one session inside the app it runs in.
#[derive(Debug, PartialEq)]
pub enum Reach {
    /// Terminal.app or iTerm2: select the tab whose terminal device is this tty
    Tab { app: &'static str, tty: String },
    /// an editor: open the session's folder, which raises the window that has it open
    Folder,
    /// the Claude Code extension in an editor: raise the folder's window, then this link focuses
    /// the session's tab (it resumes the session there when no tab has it)
    EditorTab(String),
    /// the Codex app or Claude's desktop app: their link to one chat
    Link(String),
    /// Ghostty: focus the terminal whose working folder is the session's (it has no tty property)
    Ghostty,
    /// only the app itself (no way to point at the session)
    App,
}

/// Editors that raise the window already showing a folder when asked to open it.
const EDITORS: &[&str] = &[
    "Visual Studio Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf", "Zed", "Trae", "Kiro",
    "IntelliJ IDEA", "PyCharm", "WebStorm", "GoLand", "RustRover", "CLion", "Rider", "PhpStorm", "RubyMine", "Android Studio", "Fleet",
];

pub fn reach(host: &Path, codex: bool, session_id: &str, tty: Option<String>, has_cwd: bool) -> Reach {
    let name = host.file_stem().and_then(|n| n.to_str()).unwrap_or("");
    match name {
        "Terminal" if tty.is_some() => Reach::Tab { app: "Terminal", tty: tty.unwrap() },
        "iTerm" | "iTerm2" if tty.is_some() => Reach::Tab { app: "iTerm2", tty: tty.unwrap() },
        // thread ids are uuids; anything else is not put in a link
        "Codex" if codex && is_uuid(session_id) => Reach::Link(format!("codex://threads/{session_id}")),
        // the desktop app opens one Claude Code session by its id (as other notch apps do)
        "Claude" if !codex && is_uuid(session_id) => Reach::Link(format!("claude://resume?session={session_id}")),
        "Ghostty" if has_cwd => Reach::Ghostty,
        // no terminal device: the extension's own panel, not a `claude` typed in the editor's terminal
        _ if has_cwd && !codex && tty.is_none() && is_uuid(session_id) && editor_scheme(name).is_some() => {
            Reach::EditorTab(format!("{}://anthropic.claude-code/open?session={session_id}", editor_scheme(name).unwrap()))
        }
        _ if has_cwd && EDITORS.iter().any(|e| name.starts_with(e)) => Reach::Folder,
        _ => Reach::App,
    }
}

/// URL scheme of the editors that run VS Code extensions (the Claude Code extension's link handler)
fn editor_scheme(app: &str) -> Option<&'static str> {
    Some(match app {
        "Visual Studio Code" => "vscode",
        "Visual Studio Code - Insiders" | "Code - Insiders" => "vscode-insiders",
        "VSCodium" => "vscodium",
        "Cursor" => "cursor",
        "Windsurf" => "windsurf",
        _ => return None,
    })
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// AppleScript that selects the tab (and its window) on this terminal device, then raises the app.
/// The tty comes from `ps` and is checked to be a plain device name before it is put in the script.
pub fn tab_script(app: &str, tty: &str) -> Option<String> {
    if !tty.starts_with("/dev/tty") || !tty[8..].chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(match app {
        "Terminal" => format!(
            r#"tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "{tty}" then
        set selected of t to true
        set index of w to 1
      end if
    end repeat
  end repeat
  activate
end tell"#
        ),
        _ => format!(
            r#"tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "{tty}" then
          select w
          tell t to select
          tell s to select
        end if
      end repeat
    end repeat
  end repeat
  activate
end tell"#
        ),
    })
}

/// AppleScript that focuses the Ghostty terminal working in this folder, then raises Ghostty.
/// A folder with quotes or backslashes is not put in a script.
pub fn ghostty_script(cwd: &str) -> Option<String> {
    let cwd = cwd.trim_end_matches('/');
    if cwd.is_empty() || cwd.contains(['"', '\\', '\n']) {
        return None;
    }
    Some(format!(
        r#"tell application "Ghostty"
  try
    set m to (every terminal whose working directory is "{cwd}")
    if (count of m) > 0 then focus (item 1 of m)
  end try
  activate
end tell"#
    ))
}

/// `/dev/ttys003` for a process on a terminal, None for one without (an app, a daemon).
#[cfg(target_os = "macos")]
pub fn tty_of(pid: u32) -> Option<String> {
    let out = std::process::Command::new("/bin/ps").args(["-o", "tty=", "-p", &pid.to_string()]).output().ok()?;
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (t.starts_with("tty") && t != "??").then(|| format!("/dev/{t}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_way_to_the_session() {
        let tty = || Some("/dev/ttys003".to_string());
        let id = "019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";
        assert_eq!(reach(Path::new("/System/Applications/Utilities/Terminal.app"), false, "x", tty(), true), Reach::Tab { app: "Terminal", tty: "/dev/ttys003".into() });
        assert_eq!(reach(Path::new("/Applications/iTerm.app"), false, "x", tty(), true), Reach::Tab { app: "iTerm2", tty: "/dev/ttys003".into() });
        assert_eq!(reach(Path::new("/Applications/Visual Studio Code.app"), false, "x", tty(), true), Reach::Folder);
        assert_eq!(reach(Path::new("/Applications/Cursor.app"), false, "x", None, false), Reach::App);
        assert_eq!(reach(Path::new("/Applications/Codex.app"), true, id, None, true), Reach::Link(format!("codex://threads/{id}")));
        assert_eq!(reach(Path::new("/Applications/Codex.app"), true, "../evil", None, true), Reach::App);
        assert_eq!(reach(Path::new("/Applications/Claude.app"), false, id, None, true), Reach::Link(format!("claude://resume?session={id}")));
        assert_eq!(reach(Path::new("/Applications/Claude.app"), false, "x", None, true), Reach::App);
        assert_eq!(reach(Path::new("/Applications/Ghostty.app"), false, "x", tty(), true), Reach::Ghostty);
        assert_eq!(reach(Path::new("/Applications/Ghostty.app"), false, "x", tty(), false), Reach::App);
        // the extension's panel has no terminal; `claude` in the editor's own terminal does
        assert_eq!(reach(Path::new("/Applications/Visual Studio Code.app"), false, id, None, true), Reach::EditorTab(format!("vscode://anthropic.claude-code/open?session={id}")));
        assert_eq!(reach(Path::new("/Applications/Cursor.app"), false, id, None, true), Reach::EditorTab(format!("cursor://anthropic.claude-code/open?session={id}")));
        assert_eq!(reach(Path::new("/Applications/Visual Studio Code.app"), false, id, tty(), true), Reach::Folder);
        assert_eq!(reach(Path::new("/Applications/Visual Studio Code.app"), true, id, None, true), Reach::Folder);
    }

    #[test]
    fn tab_script_only_takes_device_names() {
        assert!(tab_script("Terminal", "/dev/ttys003").unwrap().contains(r#"tty of t is "/dev/ttys003""#));
        assert!(tab_script("iTerm2", "/dev/ttys003").unwrap().contains("sessions of t"));
        assert_eq!(tab_script("Terminal", "/dev/ttys0\" & do shell script \"x"), None);
        assert_eq!(tab_script("Terminal", "/tmp/x"), None);
        assert!(ghostty_script("/Users/kim/web-app/").unwrap().contains(r#"working directory is "/Users/kim/web-app""#));
        assert_eq!(ghostty_script("/x\" & do shell script \"y"), None);
    }
}
