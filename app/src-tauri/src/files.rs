//! The user's own files on this computer: custom pets and sounds, saved reports and the
//! optional timeline history. Nothing here is sent anywhere.

use super::*;

#[derive(Serialize)]
pub(crate) struct CharacterFile {
    name: String,
    bytes: Vec<u8>,
}

/// Custom character PNGs from ~/.agent-room/characters (local only; nothing is uploaded).
#[tauri::command]
pub(crate) fn list_characters() -> Vec<CharacterFile> {
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

pub(crate) const SOUND_EVENTS: [&str; 4] = ["start", "done", "alert", "error"];
pub(crate) const SOUND_EXTS: [&str; 4] = ["mp3", "wav", "ogg", "m4a"];

#[derive(Serialize)]
pub(crate) struct SoundFile {
    event: String,
    bytes: Vec<u8>,
}

pub(crate) fn sounds_dir() -> std::path::PathBuf {
    agent_room_core::paths::data_dir().join("sounds")
}

/// The user's own effect sounds (~/.agent-room/sounds/<event>.<ext>); missing = built-in synth.
#[tauri::command]
pub(crate) fn list_sounds() -> Vec<SoundFile> {
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
pub(crate) fn save_sound(event: String, name: String, bytes: Vec<u8>) -> Result<(), String> {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !SOUND_EVENTS.contains(&event.as_str()) || !SOUND_EXTS.contains(&ext.as_str()) || bytes.len() > 2 << 20 {
        return Err(tr("2MB 이하의 mp3·wav·ogg·m4a 파일만 쓸 수 있어요", "Only mp3, wav, ogg or m4a files up to 2 MB").into());
    }
    remove_sound(event.clone())?;
    std::fs::create_dir_all(sounds_dir()).map_err(|e| e.to_string())?;
    std::fs::write(sounds_dir().join(format!("{event}.{ext}")), &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn remove_sound(event: String) -> Result<(), String> {
    if !SOUND_EVENTS.contains(&event.as_str()) {
        return Err("unknown sound event".into());
    }
    for ext in SOUND_EXTS {
        let _ = std::fs::remove_file(sounds_dir().join(format!("{event}.{ext}")));
    }
    Ok(())
}

pub(crate) fn characters_dir() -> std::path::PathBuf {
    agent_room_core::paths::data_dir().join("characters")
}

/// A file stem that is safe inside the characters folder: letters, digits, `-` and `_` only.
pub(crate) fn character_stem(name: &str) -> String {
    let stem: String = name.trim_end_matches(".png").trim_end_matches(".PNG").chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    if stem.is_empty() { "character".to_string() } else { stem }
}

/// `stem`, or `stem-2`, `stem-3`… when that name is taken.
pub(crate) fn free_character_stem(dir: &std::path::Path, stem: &str) -> String {
    let mut saved = stem.to_string();
    let mut n = 2;
    while dir.join(format!("{saved}.png")).exists() {
        saved = format!("{stem}-{n}");
        n += 1;
    }
    saved
}

pub(crate) fn check_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 4 << 20 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(tr("4MB 이하의 PNG 파일만 추가할 수 있어요", "Only PNG files up to 4 MB").into());
    }
    Ok(())
}

/// Path of a character file that is listed in the characters folder (any `.png` case, any name
/// the user gave it there). Only entries of that folder are matched, so a name can't reach outside it.
pub(crate) fn existing_character(name: &str) -> Result<std::path::PathBuf, String> {
    let found = std::fs::read_dir(characters_dir()).ok().and_then(|rd| {
        rd.flatten().map(|e| e.path()).find(|p| {
            p.is_file()
                && p.file_stem().and_then(|x| x.to_str()) == Some(name)
                && p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("png"))
        })
    });
    found.ok_or_else(|| tr("캐릭터 파일을 찾지 못했어요", "Couldn't find the character file").into())
}

/// Copies a PNG the user picked into ~/.agent-room/characters (never overwrites). Returns the saved name.
#[tauri::command]
pub(crate) fn save_character(name: String, bytes: Vec<u8>) -> Result<String, String> {
    check_png(&bytes)?;
    let dir = characters_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let saved = free_character_stem(&dir, &character_stem(&name));
    std::fs::write(dir.join(format!("{saved}.png")), &bytes).map_err(|e| e.to_string())?;
    Ok(saved)
}

/// Swaps the picture of an added character, keeping its name.
#[tauri::command]
pub(crate) fn replace_character(name: String, bytes: Vec<u8>) -> Result<(), String> {
    check_png(&bytes)?;
    std::fs::write(existing_character(&name)?, &bytes).map_err(|e| e.to_string())
}

/// Renames an added character. Returns the new name (made unique if it is taken).
#[tauri::command]
pub(crate) fn rename_character(name: String, to: String) -> Result<String, String> {
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
pub(crate) fn remove_character(name: String) -> Result<(), String> {
    std::fs::remove_file(existing_character(&name)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn data_dir() -> String {
    agent_room_core::paths::data_dir().display().to_string()
}

/// Saves a day report the user previewed to `~/Downloads/<name>` (a plain file name, `.md` only)
/// and returns where it went. Nothing else is written and nothing is sent anywhere.
#[tauri::command]
pub(crate) fn save_report(name: String, text: String) -> Result<String, String> {
    let ok = name.ends_with(".md") && name.len() <= 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !name.starts_with('.');
    if !ok {
        return Err(tr("파일 이름이 올바르지 않아요", "Invalid file name").into());
    }
    let dir = agent_room_core::paths::home().join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Timeline entries kept on disk between two times (only while the user keeps history).
#[tauri::command]
pub(crate) fn history_read(from: u64, to: u64) -> Vec<agent_room_core::history::HistLine> {
    agent_room_core::history::read(&agent_room_core::history::dir(), from, to)
}

#[tauri::command]
pub(crate) fn history_clear() {
    agent_room_core::history::prune(&agent_room_core::history::dir(), now_ms(), 0);
}
