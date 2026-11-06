//! Session reducer: common events -> per-session state the UI renders.
//!
//! Pure and deterministic. `apply` returns an [`Update`] only when something changed,
//! so the UI receives changed sessions only.

use crate::model::*;
use crate::limits::CodexLogReader;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

const TIMELINE_MAX: usize = 300;
const FILES_MAX: usize = 30;
/// ended / lost sessions are dropped from the list after this long
const FORGET_AFTER_MS: u64 = 30 * 60 * 1000;
/// a session that just sent an event is alive, whatever process the event came through
const LOST_GRACE_MS: u64 = 15 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Connection {
    /// events are arriving / the agent process is alive
    Live,
    /// in an active state but no event for a while - state is not certain
    Stale,
    /// the agent reported the session ended
    Ended,
    /// the agent process is gone without reporting an end
    Lost,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Waiting {
    /// "approval" | "input"
    pub kind: String,
    pub tool: Option<String>,
    pub message: Option<String>,
    pub since: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub message: String,
    pub tool: Option<String>,
    pub at: u64,
    /// true when the whole turn failed (vs. a single tool call that the agent may recover from)
    pub fatal: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    /// None = finished but the agent did not report a result
    pub ok: Option<bool>,
    pub at: u64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub key: String,
    pub agent: AgentKind,
    pub session_id: String,
    pub is_demo: bool,
    pub project: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub state: AgentState,
    pub activity: Option<Activity>,
    pub tool: Option<String>,
    pub detail: Option<String>,
    pub started_at: u64,
    /// false when the app first saw this session mid-way (start time = first observed event)
    pub start_exact: bool,
    pub turn_started_at: Option<u64>,
    pub turn_ended_at: Option<u64>,
    pub last_event_at: u64,
    pub connection: Connection,
    pub waiting: Option<Waiting>,
    pub error: Option<ErrorInfo>,
    pub last_test: Option<TestResult>,
    /// explicit task list reported by the agent; empty = progress unknown
    pub plan: Vec<PlanItem>,
    /// remaining plan usage last reported in this session (account-wide, so the newest one wins)
    pub limits: Option<RateLimits>,
    pub completed_turns: u32,
    pub tool_count: u32,
    pub files_edited: Vec<String>,
    pub subagents: u32,
    /// where a Claude session was started from: "desktop", "remote" or "project" (the desktop app's records)
    pub origin: Option<String>,
    /// the desktop app's title for the session
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    pub id: u64,
    pub at: u64,
    /// "session_start" | "session_end" | "turn_start" | "tool" | "tool_fail" | "test" | "approval" | "input"
    /// | "turn_complete" | "turn_failed" | "interrupted" | "compacting" | "subagent" | "plan"
    pub kind: String,
    pub activity: Option<Activity>,
    pub tool: Option<String>,
    pub detail: Option<String>,
    pub ok: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Notice {
    Completed,
    NeedsApproval,
    NeedsInput,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub snapshot: Snapshot,
    pub appended: Vec<TimelineEntry>,
    pub removed: bool,
    #[serde(skip)]
    pub notice: Option<Notice>,
}

struct Session {
    snap: Snapshot,
    timeline: VecDeque<TimelineEntry>,
    tasks: Vec<(String, PlanItem)>,
    pid: Option<u32>,
    transcript: Option<String>,
    usage: CodexLogReader,
    last_usage_poll: u64,
    ended_at: Option<u64>,
}

pub struct SessionStore {
    sessions: HashMap<String, Session>,
    seq: u64,
    pub stale_after_ms: u64,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self { sessions: HashMap::new(), seq: 0, stale_after_ms: 3 * 60 * 1000 }
    }
}

fn is_active(s: AgentState) -> bool {
    matches!(s, AgentState::Starting | AgentState::Planning | AgentState::Reading | AgentState::Editing | AgentState::Running | AgentState::Testing)
}

impl SessionStore {
    pub fn snapshots(&self) -> Vec<Snapshot> {
        let mut v: Vec<Snapshot> = self.sessions.values().map(|s| s.snap.clone()).collect();
        v.sort_by_key(|s| std::cmp::Reverse(s.last_event_at));
        v
    }

    pub fn timeline(&self, key: &str) -> Vec<TimelineEntry> {
        self.sessions.get(key).map(|s| s.timeline.iter().cloned().collect()).unwrap_or_default()
    }

    pub fn pid_of(&self, key: &str) -> Option<u32> {
        self.sessions.get(key).and_then(|s| s.pid)
    }

    pub fn set_pid(&mut self, key: &str, pid: u32) {
        if let Some(s) = self.sessions.get_mut(key) {
            s.pid = Some(pid);
        }
    }

    /// Records where the session came from; an update only when that changed.
    pub fn set_origin(&mut self, key: &str, origin: Option<String>, title: Option<String>) -> Option<Update> {
        let s = self.sessions.get_mut(key)?;
        if s.snap.origin == origin && s.snap.title == title {
            return None;
        }
        s.snap.origin = origin;
        s.snap.title = title;
        Some(Update { snapshot: s.snap.clone(), appended: vec![], removed: false, notice: None })
    }

    pub fn remove(&mut self, key: &str) -> Option<Update> {
        self.sessions.remove(key).map(|s| Update { snapshot: s.snap, appended: vec![], removed: true, notice: None })
    }

    pub fn apply(&mut self, ev: NormEvent) -> Option<Update> {
        let key = format!("{}:{}", ev.agent.as_str(), ev.session_id);
        // Claude's status line repeats the same numbers several times a second while it streams;
        // unchanged numbers are not news (and would redraw the UI and the tray menu each time)
        if let (EvKind::Limits { limits }, Some(sess)) = (&ev.kind, self.sessions.get(&key)) {
            if sess.snap.limits.as_ref().is_some_and(|l| l.windows == limits.windows) {
                return None;
            }
        }
        let is_start = matches!(ev.kind, EvKind::SessionStart { .. });
        let sess = self.sessions.entry(key.clone()).or_insert_with(|| Session {
            snap: Snapshot {
                key: key.clone(),
                agent: ev.agent,
                session_id: ev.session_id.clone(),
                is_demo: ev.agent == AgentKind::Demo,
                project: None,
                cwd: None,
                model: None,
                permission_mode: None,
                state: AgentState::Idle,
                activity: None,
                tool: None,
                detail: None,
                started_at: ev.ts,
                start_exact: is_start,
                turn_started_at: None,
                turn_ended_at: None,
                last_event_at: ev.ts,
                connection: Connection::Live,
                waiting: None,
                error: None,
                last_test: None,
                plan: vec![],
                limits: None,
                completed_turns: 0,
                tool_count: 0,
                files_edited: vec![],
                subagents: 0,
                origin: None,
                title: None,
            },
            timeline: VecDeque::new(),
            tasks: vec![],
            pid: None,
            transcript: None,
            usage: CodexLogReader::default(),
            last_usage_poll: 0,
            ended_at: None,
        });
        let before = sess.snap.clone();
        let s = &mut sess.snap;
        s.last_event_at = s.last_event_at.max(ev.ts);
        if let Some(cwd) = &ev.cwd {
            s.project = Some(crate::adapters::basename(cwd));
            s.cwd = Some(cwd.clone());
        }
        if ev.model.is_some() {
            s.model = ev.model.clone();
        }
        if ev.permission_mode.is_some() {
            s.permission_mode = ev.permission_mode.clone();
        }
        if let Some(t) = &ev.transcript_path {
            sess.transcript = Some(t.clone());
        }
        if s.connection != Connection::Ended {
            s.connection = Connection::Live;
        }

        let mut entries: Vec<TimelineEntry> = Vec::new();
        let mut notice = None;
        let mut entry = |kind: &str, activity: Option<Activity>, tool: Option<String>, detail: Option<String>, ok: Option<bool>| {
            entries.push(TimelineEntry { id: 0, at: ev.ts, kind: kind.into(), activity, tool, detail, ok });
        };

        match ev.kind.clone() {
            EvKind::SessionStart { source } => {
                if is_start && !s.start_exact && s.tool_count == 0 {
                    s.start_exact = true;
                    s.started_at = ev.ts;
                }
                s.connection = Connection::Live;
                sess.ended_at = None;
                if s.turn_started_at.is_none() {
                    s.state = AgentState::Idle;
                }
                entry("session_start", None, None, source, None);
            }
            EvKind::SessionEnd { reason } => {
                s.connection = Connection::Ended;
                s.state = AgentState::Disconnected;
                s.waiting = None;
                s.tool = None;
                s.activity = None;
                sess.ended_at = Some(ev.ts);
                entry("session_end", None, None, reason, None);
            }
            EvKind::PromptSubmitted => {
                s.state = AgentState::Starting;
                s.turn_started_at = Some(ev.ts);
                s.turn_ended_at = None;
                s.waiting = None;
                s.error = None;
                s.tool = None;
                s.detail = None;
                s.activity = None;
                entry("turn_start", None, None, None, None);
            }
            EvKind::ToolStart { tool, activity, detail } => {
                s.tool_count += 1;
                s.waiting = None;
                s.error = None;
                s.activity = Some(activity);
                s.tool = Some(tool.clone());
                s.detail = detail.clone();
                if s.turn_started_at.is_none() {
                    s.turn_started_at = Some(ev.ts);
                }
                if activity == Activity::Ask {
                    s.state = AgentState::Waiting;
                    s.waiting = Some(Waiting { kind: "input".into(), tool: Some(tool.clone()), message: None, since: ev.ts });
                    notice = Some(Notice::NeedsInput);
                    entry("input", Some(activity), Some(tool), detail, None);
                } else {
                    s.state = activity.state();
                    if activity == Activity::Edit {
                        if let Some(f) = &detail {
                            s.files_edited.retain(|x| x != f);
                            s.files_edited.push(f.clone());
                            if s.files_edited.len() > FILES_MAX {
                                s.files_edited.remove(0);
                            }
                        }
                    }
                    entry("tool", Some(activity), Some(tool), detail, None);
                }
            }
            EvKind::ToolEnd { tool, activity, ok, error } => {
                s.waiting = None;
                if activity == Activity::Test {
                    s.last_test = Some(TestResult { ok, at: ev.ts, detail: s.detail.clone() });
                    entry("test", Some(activity), Some(tool.clone()), s.detail.clone(), ok);
                }
                if ok == Some(false) && activity != Activity::Test {
                    s.state = AgentState::Error;
                    s.error = Some(ErrorInfo { message: error.unwrap_or_default(), tool: Some(tool.clone()), at: ev.ts, fatal: false });
                    entry("tool_fail", Some(activity), Some(tool), s.detail.clone(), Some(false));
                } else if activity == Activity::Test {
                    // keep showing the test bench result until the next event
                    s.state = if ok == Some(false) { AgentState::Error } else { AgentState::Testing };
                    s.tool = None;
                    if ok == Some(false) {
                        s.error = Some(ErrorInfo { message: error.unwrap_or_default(), tool: Some(tool), at: ev.ts, fatal: false });
                    }
                } else if s.state != AgentState::Completed {
                    s.state = AgentState::Planning;
                    s.activity = Some(Activity::Think);
                    s.tool = None;
                    s.detail = None;
                }
            }
            EvKind::PermissionRequest { tool, detail } => {
                let already = matches!(&s.waiting, Some(w) if w.kind == "approval");
                if !already || tool.is_some() {
                    s.state = AgentState::Waiting;
                    let message = if tool.is_none() { detail.clone() } else { None };
                    s.waiting = Some(Waiting { kind: "approval".into(), tool: tool.clone().or(s.tool.clone()), message, since: ev.ts });
                    if !already {
                        notice = Some(Notice::NeedsApproval);
                        entry("approval", None, tool, detail, None);
                    }
                }
            }
            EvKind::NeedsInput { message } => {
                if s.waiting.is_none() {
                    s.state = AgentState::Waiting;
                    s.waiting = Some(Waiting { kind: "input".into(), tool: None, message: message.clone(), since: ev.ts });
                    notice = Some(Notice::NeedsInput);
                    entry("input", None, None, message, None);
                }
            }
            EvKind::TurnComplete => {
                s.state = AgentState::Completed;
                s.turn_ended_at = Some(ev.ts);
                s.completed_turns += 1;
                s.waiting = None;
                s.tool = None;
                s.detail = None;
                s.activity = None;
                notice = Some(Notice::Completed);
                entry("turn_complete", None, None, None, Some(true));
            }
            EvKind::TurnFailed { error } => {
                s.state = AgentState::Error;
                s.turn_ended_at = Some(ev.ts);
                s.waiting = None;
                s.error = Some(ErrorInfo { message: error.clone(), tool: None, at: ev.ts, fatal: true });
                notice = Some(Notice::Failed);
                entry("turn_failed", None, None, Some(error), Some(false));
            }
            EvKind::Interrupted => {
                s.state = AgentState::Idle;
                s.turn_ended_at = Some(ev.ts);
                s.waiting = None;
                s.tool = None;
                s.activity = None;
                entry("interrupted", None, None, None, None);
            }
            EvKind::Compacting => {
                s.state = AgentState::Planning;
                s.activity = Some(Activity::Think);
                s.tool = None;
                s.detail = None;
                entry("compacting", None, None, None, None);
            }
            EvKind::SubagentStart { agent_type } => {
                s.subagents += 1;
                entry("subagent", Some(Activity::Delegate), None, agent_type, None);
            }
            EvKind::SubagentStop { .. } => {
                s.subagents = s.subagents.saturating_sub(1);
            }
            EvKind::Plan { items } => {
                let done_before = s.plan.iter().filter(|p| p.status == "completed").count();
                let done_after = items.iter().filter(|p| p.status == "completed").count();
                let changed = s.plan.len() != items.len() || done_before != done_after;
                s.plan = items;
                sess.tasks.clear();
                if changed {
                    entry("plan", None, None, Some(format!("{done_after}/{}", s.plan.len())), None);
                }
            }
            EvKind::TaskUpdate { id, text, status } => {
                if let Some((_, item)) = sess.tasks.iter_mut().find(|(i, _)| *i == id) {
                    if let Some(t) = text {
                        item.text = t;
                    }
                    if let Some(st) = status {
                        item.status = st;
                    }
                } else if let Some(t) = text {
                    sess.tasks.push((id, PlanItem { text: t, status: status.unwrap_or_else(|| "pending".into()) }));
                }
                let items: Vec<PlanItem> = sess.tasks.iter().filter(|(_, p)| p.status != "deleted").map(|(_, p)| p.clone()).collect();
                // once task tracking has begun, the task list is authoritative (deleting the last task clears it)
                if !sess.tasks.is_empty() {
                    s.plan = items;
                }
            }
            EvKind::Limits { limits } => {
                s.limits = Some(limits);
            }
            EvKind::StillWorking => {}
        }

        let mut appended = Vec::with_capacity(entries.len());
        for mut e in entries {
            self.seq += 1;
            e.id = self.seq;
            appended.push(e.clone());
            sess.timeline.push_back(e);
        }
        while sess.timeline.len() > TIMELINE_MAX {
            sess.timeline.pop_front();
        }

        // Codex: remaining usage from its own rollout log (throttled)
        if let (Some(path), AgentKind::Codex) = (sess.transcript.clone(), ev.agent) {
            // log-only sessions (desktop app, VS Code) only ever send StillWorking / PromptSubmitted;
            // the end of a turn always reads the rest of the log, so a skipped read is never the last
            let due = matches!(ev.kind, EvKind::TurnComplete)
                || (matches!(ev.kind, EvKind::ToolEnd { .. } | EvKind::SessionStart { .. } | EvKind::StillWorking | EvKind::PromptSubmitted)
                    && ev.ts.saturating_sub(sess.last_usage_poll) > 1500);
            if due {
                sess.last_usage_poll = ev.ts;
                if let Some(l) = sess.usage.poll(&path, ev.ts) {
                    sess.snap.limits = Some(l);
                }
            }
        }

        if sess.snap != before || !appended.is_empty() {
            Some(Update { snapshot: sess.snap.clone(), appended, removed: false, notice })
        } else {
            None
        }
    }

    /// Re-evaluates connection health. `alive(pid)` checks the agent process.
    pub fn tick(&mut self, now: u64, alive: &mut dyn FnMut(u32) -> bool) -> Vec<Update> {
        let mut out = Vec::new();
        let mut forget = Vec::new();
        for (key, sess) in self.sessions.iter_mut() {
            let s = &mut sess.snap;
            if s.is_demo {
                continue;
            }
            let prev = s.connection;
            let prev_state = s.state;
            match s.connection {
                Connection::Ended | Connection::Lost => {
                    let since = sess.ended_at.unwrap_or(s.last_event_at);
                    if now.saturating_sub(since) > FORGET_AFTER_MS {
                        forget.push(key.clone());
                    }
                    continue;
                }
                _ => {}
            }
            if let Some(pid) = sess.pid {
                if now.saturating_sub(s.last_event_at) > LOST_GRACE_MS && !alive(pid) {
                    s.connection = Connection::Lost;
                    s.state = AgentState::Disconnected;
                    s.waiting = None;
                    sess.ended_at = Some(now);
                }
            }
            if s.connection != Connection::Lost {
                s.connection = if is_active(s.state) && now.saturating_sub(s.last_event_at) > self.stale_after_ms {
                    Connection::Stale
                } else {
                    Connection::Live
                };
            }
            if s.connection != prev || s.state != prev_state {
                out.push(Update { snapshot: s.clone(), appended: vec![], removed: false, notice: None });
            }
        }
        for k in forget {
            if let Some(u) = self.remove(&k) {
                out.push(u);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: EvKind, ts: u64) -> NormEvent {
        NormEvent { agent: AgentKind::Claude, session_id: "s".into(), ts, cwd: Some("/x/proj".into()), model: None, transcript_path: None, permission_mode: None, kind }
    }

    #[test]
    fn full_turn_flow() {
        let mut st = SessionStore::default();
        st.apply(ev(EvKind::SessionStart { source: Some("startup".into()) }, 1)).unwrap();
        let u = st.apply(ev(EvKind::PromptSubmitted, 2)).unwrap();
        assert_eq!(u.snapshot.state, AgentState::Starting);
        assert_eq!(u.snapshot.project.as_deref(), Some("proj"));
        let u = st.apply(ev(EvKind::ToolStart { tool: "Edit".into(), activity: Activity::Edit, detail: Some("a.rs".into()) }, 3)).unwrap();
        assert_eq!(u.snapshot.state, AgentState::Editing);
        assert_eq!(u.appended.len(), 1);
        let u = st.apply(ev(EvKind::PermissionRequest { tool: Some("Bash".into()), detail: None }, 4)).unwrap();
        assert_eq!(u.snapshot.state, AgentState::Waiting);
        assert_eq!(u.notice, Some(Notice::NeedsApproval));
        let u = st.apply(ev(EvKind::ToolEnd { tool: "Bash".into(), activity: Activity::Test, ok: Some(true), error: None }, 5)).unwrap();
        assert!(u.snapshot.waiting.is_none());
        assert_eq!(u.snapshot.last_test.as_ref().unwrap().ok, Some(true));
        let u = st.apply(ev(EvKind::TurnComplete, 6)).unwrap();
        assert_eq!(u.snapshot.state, AgentState::Completed);
        assert_eq!(u.notice, Some(Notice::Completed));
        assert!(u.snapshot.start_exact);
    }

    #[test]
    fn mid_session_start_is_not_exact_and_plan_is_explicit_only() {
        let mut st = SessionStore::default();
        let u = st.apply(ev(EvKind::ToolStart { tool: "Read".into(), activity: Activity::Read, detail: None }, 10)).unwrap();
        assert!(!u.snapshot.start_exact);
        assert!(u.snapshot.plan.is_empty());
    }

    #[test]
    fn stale_and_lost_connection() {
        let mut st = SessionStore::default();
        st.apply(ev(EvKind::ToolStart { tool: "Bash".into(), activity: Activity::Run, detail: None }, 0));
        assert!(st.tick(1000, &mut |_| true).is_empty());
        let u = st.tick(st.stale_after_ms + 1, &mut |_| true);
        assert_eq!(u[0].snapshot.connection, Connection::Stale);
        st.set_pid("claude:s", 42);
        let u = st.tick(st.stale_after_ms + 2, &mut |_| false);
        assert_eq!(u[0].snapshot.connection, Connection::Lost);
        assert_eq!(u[0].snapshot.state, AgentState::Disconnected);
    }

    #[test]
    fn a_fresh_event_keeps_the_session_even_if_its_process_is_gone() {
        let mut st = SessionStore::default();
        st.apply(ev(EvKind::ToolStart { tool: "Bash".into(), activity: Activity::Run, detail: None }, 1000));
        st.set_pid("claude:s", 42);
        // the hook came through a short-lived process: not lost while events are fresh
        assert!(st.tick(2000, &mut |_| false).is_empty());
        let u = st.tick(1000 + LOST_GRACE_MS + 1, &mut |_| false);
        assert_eq!(u[0].snapshot.connection, Connection::Lost);
    }

    #[test]
    fn task_hooks_build_progress() {
        let mut st = SessionStore::default();
        st.apply(ev(EvKind::TaskUpdate { id: "1".into(), text: Some("A".into()), status: Some("pending".into()) }, 1));
        st.apply(ev(EvKind::TaskUpdate { id: "2".into(), text: Some("B".into()), status: Some("pending".into()) }, 2));
        let u = st.apply(ev(EvKind::TaskUpdate { id: "1".into(), text: None, status: Some("completed".into()) }, 3)).unwrap();
        assert_eq!(u.snapshot.plan.iter().filter(|p| p.status == "completed").count(), 1);
        assert_eq!(u.snapshot.plan.len(), 2);
    }

    #[test]
    fn deleting_last_task_clears_plan() {
        let mut st = SessionStore::default();
        st.apply(ev(EvKind::TaskUpdate { id: "1".into(), text: Some("A".into()), status: Some("pending".into()) }, 1));
        let u = st.apply(ev(EvKind::TaskUpdate { id: "1".into(), text: None, status: Some("deleted".into()) }, 2)).unwrap();
        assert!(u.snapshot.plan.is_empty());
    }

    #[test]
    fn repeated_limits_are_not_an_update() {
        let mut st = SessionStore::default();
        let l = |used: f64| EvKind::Limits { limits: RateLimits { windows: vec![LimitWindow { minutes: 300, used_pct: used, resets_at: Some(9) }], at: 1 } };
        assert!(st.apply(ev(l(10.0), 1)).is_some(), "first report creates/updates the session");
        assert!(st.apply(ev(l(10.0), 2)).is_none(), "same numbers: no update");
        let u = st.apply(ev(l(11.0), 3)).unwrap();
        assert_eq!(u.snapshot.limits.unwrap().windows[0].used_pct, 11.0);
    }
}
