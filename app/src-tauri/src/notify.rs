//! System notifications: approvals, finished work, low usage, quiet hours.

use super::*;

/// One notification per usage window and reset period once 10% or less is left.
pub(crate) fn notify_low_limits(app: &AppHandle, s: &Snapshot, l: &agent_room_core::model::RateLimits) {
    let shared = app.state::<Shared>();
    {
        let st = shared.settings.lock().unwrap();
        if s.is_demo || !st.notify_limits || quiet_now(&st) {
            return;
        }
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

/// inside the user's quiet hours (local time)
pub(crate) fn quiet_now(st: &Settings) -> bool {
    if !st.quiet_hours {
        return false;
    }
    let mins = ((now_ms() / 60_000) as i64 + TZ_OFFSET_MIN.load(Ordering::Relaxed)).rem_euclid(1440);
    let h = (mins / 60) as u32;
    let (from, to) = (st.quiet_from % 24, st.quiet_to % 24);
    if from <= to { h >= from && h < to } else { h >= from || h < to }
}

pub(crate) fn notify(app: &AppHandle, s: &Snapshot, n: Notice) {
    let shared = app.state::<Shared>();
    let st = shared.settings.lock().unwrap().clone();
    if quiet_now(&st) {
        return;
    }
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
    // the project leads the title, so a glance at the banner says which session it is
    let agent = agent_label(s);
    let project = s.project.clone().unwrap_or_else(|| agent.into());
    let tool = s.waiting.as_ref().and_then(|w| w.tool.clone()).unwrap_or_else(|| "도구".into());
    let (title, body) = match n {
        Notice::Completed => (format!("{project} · 작업 완료"), format!("{agent} 작업이 끝났어요.")),
        Notice::Failed => (format!("{project} · 오류"), s.error.as_ref().map(|e| e.message.clone()).unwrap_or_else(|| format!("{agent}에서 오류가 났어요."))),
        Notice::NeedsApproval => (format!("{project} · {tool} 승인 필요"), format!("{agent}가 {tool} 실행 승인을 기다리고 있어요.")),
        Notice::NeedsInput => (format!("{project} · 입력 대기"), format!("{agent}가 답을 기다리고 있어요.")),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

/// One more notification for a request that has waited `renotify_min` minutes (once per request).
pub(crate) fn renotify(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let after = shared.settings.lock().unwrap().renotify_min as u64 * 60_000;
    if after == 0 {
        return;
    }
    let now = now_ms();
    let waiting: Vec<Snapshot> = shared.store.lock().unwrap().snapshots().into_iter().filter(|s| !s.is_demo && s.waiting.as_ref().is_some_and(|w| now.saturating_sub(w.since) >= after)).collect();
    for s in waiting {
        let w = s.waiting.as_ref().unwrap();
        if shared.renotified.lock().unwrap().insert((s.key.clone(), w.since)) {
            notify(app, &s, if w.kind == "approval" { Notice::NeedsApproval } else { Notice::NeedsInput });
        }
    }
}

/// A plain notification from the UI (the evening summary, which has its own setting).
#[tauri::command]
pub(crate) fn notify_text(app: AppHandle, title: String, body: String) {
    if quiet_now(&app.state::<Shared>().settings.lock().unwrap()) {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}
