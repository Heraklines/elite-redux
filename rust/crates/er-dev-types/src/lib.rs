//! Shared, gameplay-independent M7.1 developer-plane contracts.
pub mod causal;
pub mod compatibility;
pub mod digest;
pub mod identity;
pub mod observation;
pub mod performance;
pub mod snapshot_v7;
pub mod trace_v7;

pub use causal::*;
pub use compatibility::*;
pub use digest::*;
pub use identity::*;
pub use observation::*;
pub use performance::*;
pub use snapshot_v7::*;
pub use trace_v7::*;

use serde::{Deserialize, Serialize};

pub const EXECUTION_IDENTITY_VERSION_V1: u32 = 1;
pub const DEVELOPER_SESSION_VERSION_V1: u32 = 1;
pub const OBSERVATION_VERSION_V1: u32 = 1;
pub const CAUSAL_GRAPH_VERSION_V1: u32 = 1;
pub const DIAGNOSTIC_DIGEST_VERSION_V1: u32 = 1;
pub const RESTORABLE_SNAPSHOT_VERSION_V7: u32 = 7;
pub const KERNEL_TRACE_VERSION_V7: u32 = 7;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum KnownOrUnknownV1<T> {
    Known(T),
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionTopologyV1 {
    Solo,
    Pair,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObservationProfile {
    Player,
    Agent,
    Debug,
    Forensic,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceProfile {
    None,
    Causal,
    Full,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeveloperSessionPolicyV1 {
    pub maximum_observation_profile: ObservationProfile,
    pub evidence_profile: EvidenceProfile,
    pub maximum_checkpoint_bytes: usize,
    pub maximum_evidence_bytes: usize,
    pub maximum_telemetry_bytes: usize,
    pub allow_capsule_export: bool,
    pub allow_hidden_state: bool,
}
