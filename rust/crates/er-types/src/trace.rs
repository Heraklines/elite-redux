//! Deterministic boundary trace schema.

use serde::{Deserialize, Serialize};

use crate::{KernelInput, KernelSnapshot, LiveResourceSnapshot, SafeU53};

pub const KERNEL_TRACE_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct KernelTraceHeader {
    pub trace_version: u32,
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub protocol_version: String,
    pub content_hash: String,
    pub rust_toolchain: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelTrace {
    pub header: KernelTraceHeader,
    pub initial_snapshot: KernelSnapshot,
    pub events: Vec<KernelTraceEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelTraceEvent {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input: KernelInput,
    pub expected_effect_digest: String,
    pub expected_state_digest: String,
    pub expected_ui_digest: String,
    pub expected_live_resources: LiveResourceSnapshot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceDivergence {
    pub sequence: SafeU53,
    pub expected_effect_digest: String,
    pub actual_effect_digest: String,
    pub expected_state_digest: String,
    pub actual_state_digest: String,
    pub expected_ui_digest: String,
    pub actual_ui_digest: String,
    pub expected_live_resources: LiveResourceSnapshot,
    pub actual_live_resources: LiveResourceSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TraceReplayReport {
    pub replayed_events: SafeU53,
    pub first_divergent_sequence: Option<SafeU53>,
}
