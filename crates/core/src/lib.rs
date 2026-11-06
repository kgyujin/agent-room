//! Agent Room core: turns local agent hook events into room state.
//!
//! Zero-token guarantee: this crate has no HTTP client and never talks to any model.
//! Inputs are hook payloads on a local socket and the agents' own local log files.

pub mod adapters;
pub mod install;
pub mod model;
pub mod paths;
pub mod sanitize;
pub mod session;
pub mod limits;
pub mod logs;
pub mod usage;
pub mod desktop;
pub mod history;

#[cfg(feature = "runtime")]
pub mod runtime;
