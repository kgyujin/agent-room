//! User settings, saved as JSON in the app's config folder.

use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    /// room camera: "iso" (diagonal) or "top" (top-down); the furniture layout is shared
    pub room_view: String,
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
    /// pets that may appear (built-in ids as `builtin/<id>` or PNG names); empty means all built-ins
    pub pet_pool: Vec<String>,
    /// pet drawn in the menu bar icon (`builtin/<id>` or a PNG name)
    pub tray_pet: String,
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
    /// pet name tags: "compact", "full", "hover" or "off"
    pub tag_style: String,
    /// name tag outline: "soft" or "pixel"
    pub tag_look: String,
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
    /// which display holds the island: "auto" (the one with the camera notch, else the menu bar's),
    /// "main" (the menu bar's) or "pointer" (the one the pointer is on)
    pub island_screen: String,
    /// "작업 완료" notifications only for turns at least this long (seconds, 0 = all)
    pub notify_min_turn_sec: u32,
    /// look for a new version at launch and every few hours, and ask before installing it
    pub auto_update_check: bool,
    /// size of the whole main window's contents (text, panels, room), 1.0 = 100%
    pub ui_zoom: f64,
    /// Claude usage from the account (macOS): the login Claude Code keeps in the Keychain is read
    /// in memory and sent only to Anthropic's usage endpoint; nothing is stored
    pub claude_account_limits: bool,
    /// token counts as "si" (12.4K, 340M) or "ko" (1.2만, 3.4억)
    pub token_unit: String,
    /// dashboard cards the user turned off ("map", "activity", "usage", "board", "sessions", "picked")
    pub dash_hidden: Vec<String>,
    /// a notification with the day's numbers once a day after `daily_summary_hour` (local)
    pub daily_summary: bool,
    pub daily_summary_hour: u32,
    /// estimated API cost from these blended USD prices per million tokens (0 = not set)
    pub show_cost: bool,
    pub cost_claude_per_m: f64,
    pub cost_codex_per_m: f64,
    /// days of timeline kept on disk (`~/.agent-room/history`), 0 = none kept
    pub history_days: u32,
    /// answer Claude Code permission requests in Agent Room (the hook waits up to `approve_wait_sec`
    /// for the answer; without one Claude Code asks in its own dialog)
    pub approve_in_app: bool,
    pub approve_wait_sec: u32,
    /// no notifications between these local hours (from..to, may wrap past midnight)
    pub quiet_hours: bool,
    pub quiet_from: u32,
    pub quiet_to: u32,
    /// notify once more when a request has waited this many minutes (0 = never)
    pub renotify_min: u32,
    /// the island opens for a moment when a session starts waiting on the user
    pub island_peek: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            room_view: "iso".into(),
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
            pet_pool: Vec::new(),
            tray_pet: "builtin/shiba".into(),
            critter_colors: Default::default(),
            ui_theme: "peach".into(),
            island: true,
            font: "mixed".into(),
            backdrop: String::new(),
            tag_style: "compact".into(),
            tag_look: "soft".into(),
            show_dock: true,
            show_tabs: false,
            pet_energy: "normal".into(),
            island_open: "hover".into(),
            done_shown_sec: 60,
            idle_tags: "dim".into(),
            pet_bubbles: true,
            island_hide_idle: false,
            island_usage: true,
            island_screen: "auto".into(),
            notify_min_turn_sec: 0,
            auto_update_check: true,
            ui_zoom: 1.0,
            claude_account_limits: true,
            token_unit: "si".into(),
            dash_hidden: Vec::new(),
            daily_summary: false,
            daily_summary_hour: 18,
            show_cost: false,
            cost_claude_per_m: 0.0,
            cost_codex_per_m: 0.0,
            history_days: 0,
            approve_in_app: false,
            approve_wait_sec: 30,
            quiet_hours: false,
            quiet_from: 22,
            quiet_to: 8,
            renotify_min: 5,
            island_peek: true,
        }
    }
}

pub(crate) fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub(crate) fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
