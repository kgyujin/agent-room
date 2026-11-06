//! Headless monitor for debugging / verification (no GUI):
//!   cargo run -p agent-room-core --example monitor
//! Listens on the same socket as the app and prints each session change as one line.

use agent_room_core::adapters::normalize;
use agent_room_core::runtime::{spawn_server, ProcWatch};
use agent_room_core::session::SessionStore;
use std::sync::{Arc, Mutex};

fn main() {
    // optional: `--install <claude|codex> <path-to-agent-room-hook>` installs hooks first
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 4 && args[1] == "--install" {
        let t = agent_room_core::install::Target::parse(&args[2]).expect("claude|codex");
        let st = agent_room_core::install::install(t, Some(std::path::Path::new(&args[3]))).expect("install");
        eprintln!("installed: {} ({})", st.config_path, st.installed);
    }
    let store = Arc::new(Mutex::new(SessionStore::default()));
    let procs = Arc::new(Mutex::new(ProcWatch::default()));
    let (s2, p2) = (store.clone(), procs.clone());
    let handle = spawn_server(move |env| {
        let pid = env.ppid.and_then(|p| p2.lock().unwrap().resolve_agent_pid(p));
        let hook_event = env.event.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("?").to_string();
        for ev in normalize(&env) {
            let key = format!("{}:{}", ev.agent.as_str(), ev.session_id);
            let mut st = s2.lock().unwrap();
            if let Some(u) = st.apply(ev) {
                if let Some(pid) = pid {
                    st.set_pid(&key, pid);
                }
                let s = &u.snapshot;
                println!(
                    "{:<18} -> {:<10} activity={:<8} tool={:<10} detail={:<20} plan={}/{} limits={} pid={:?} timeline+{}",
                    hook_event,
                    format!("{:?}", s.state).to_lowercase(),
                    s.activity.map(|a| format!("{a:?}").to_lowercase()).unwrap_or_default(),
                    s.tool.clone().unwrap_or_default(),
                    s.detail.clone().unwrap_or_default(),
                    s.plan.iter().filter(|p| p.status == "completed").count(),
                    s.plan.len(),
                    s.limits.as_ref().map(|l| l.windows.iter().map(|w| format!("{}m:{:.0}%", w.minutes, w.used_pct)).collect::<Vec<_>>().join(",")).unwrap_or("-".into()),
                    pid,
                    u.appended.len()
                );
            }
        }
        None
    })
    .expect("start server");
    eprintln!("listening on {}", agent_room_core::paths::socket_path().display());
    handle.join().ok();
}
