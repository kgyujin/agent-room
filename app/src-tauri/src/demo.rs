//! Demo mode: replays a scripted, clearly labelled session (agent = "demo") through the
//! same reducer as real events. It never touches real sessions.

use agent_room_core::model::{Activity, AgentKind, EvKind, NormEvent, PlanItem, TokenUsage};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const DEMO_SESSION: &str = "demo-session";

fn plan(done: usize, active: Option<usize>) -> EvKind {
    let steps = ["요구사항 읽기", "UI 컴포넌트 수정", "테스트 작성", "빌드 확인"];
    EvKind::Plan {
        items: steps
            .iter()
            .enumerate()
            .map(|(i, s)| PlanItem {
                text: (*s).into(),
                status: if i < done { "completed" } else if Some(i) == active { "in_progress" } else { "pending" }.into(),
            })
            .collect(),
    }
}

fn tool(t: &str, a: Activity, d: &str) -> EvKind {
    EvKind::ToolStart { tool: t.into(), activity: a, detail: Some(d.into()) }
}

fn end(t: &str, a: Activity, ok: Option<bool>) -> EvKind {
    EvKind::ToolEnd { tool: t.into(), activity: a, ok, error: if ok == Some(false) { Some("2 tests failed".into()) } else { None } }
}

fn script() -> Vec<(u64, EvKind)> {
    use Activity::*;
    vec![
        (1500, EvKind::SessionStart { source: Some("startup".into()) }),
        (6000, EvKind::PromptSubmitted),
        (3000, tool("TodoWrite", Plan, "")),
        (0, plan(0, Some(0))),
        (4000, end("TodoWrite", Plan, Some(true))),
        (2500, tool("Grep", Search, "useSession")),
        (4000, end("Grep", Search, Some(true))),
        (1000, tool("Read", Read, "Room.tsx")),
        (5000, end("Read", Read, Some(true))),
        (0, plan(1, Some(1))),
        (2500, tool("Edit", Edit, "Room.tsx")),
        (7000, end("Edit", Edit, Some(true))),
        (1500, tool("Edit", Edit, "hud.css")),
        (5000, end("Edit", Edit, Some(true))),
        (0, plan(2, Some(2))),
        (1500, tool("Write", Edit, "room.test.ts")),
        (5000, end("Write", Edit, Some(true))),
        (1500, tool("Bash", Test, "npm test")),
        (7000, end("Bash", Test, Some(false))),
        (4000, tool("Read", Read, "room.test.ts")),
        (3500, end("Read", Read, Some(true))),
        (1000, tool("Edit", Edit, "Room.tsx")),
        (5000, end("Edit", Edit, Some(true))),
        (1500, tool("Bash", Test, "npm test")),
        (7000, end("Bash", Test, Some(true))),
        (0, plan(3, Some(3))),
        (3000, tool("Bash", Run, "npm run build")),
        (800, EvKind::PermissionRequest { tool: Some("Bash".into()), detail: Some("npm run build".into()) }),
        (9000, end("Bash", Run, Some(true))),
        (0, plan(4, None)),
        (0, EvKind::Tokens { usage: TokenUsage { input: 18_240, output: 6_310, cache_read: 152_000, cache_write: 9_800, source: "demo".into() } }),
        (2000, EvKind::TurnComplete),
        (25_000, EvKind::NeedsInput { message: Some("다음 요청을 기다리는 중".into()) }),
        (12_000, EvKind::PromptSubmitted),
        (2500, tool("Bash", Run, "git status")),
        (2000, end("Bash", Run, Some(true))),
        (3000, EvKind::TurnFailed { error: "overloaded".into() }),
        (14_000, EvKind::Interrupted),
    ]
}

pub fn spawn(stop: Arc<AtomicBool>, emit: impl Fn(NormEvent) + Send + 'static) {
    std::thread::Builder::new()
        .name("agent-room-demo".into())
        .spawn(move || {
            'outer: loop {
                for (delay, kind) in script() {
                    let mut left = delay;
                    while left > 0 {
                        if stop.load(Ordering::Relaxed) {
                            break 'outer;
                        }
                        let step = left.min(200);
                        std::thread::sleep(Duration::from_millis(step));
                        left -= step;
                    }
                    if stop.load(Ordering::Relaxed) {
                        break 'outer;
                    }
                    emit(NormEvent {
                        agent: AgentKind::Demo,
                        session_id: DEMO_SESSION.into(),
                        ts: agent_room_core::model::now_ms(),
                        cwd: Some("/demo/cozy-project".into()),
                        model: Some("demo".into()),
                        transcript_path: None,
                        permission_mode: None,
                        kind,
                    });
                }
            }
        })
        .expect("spawn demo thread");
}
