//! Deterministic M7.1 reproduction capsule contracts.

pub mod capsule;
pub mod corpus;
pub mod diff;
pub mod explain;
pub mod minimize;
pub mod replay;

pub use capsule::*;
pub use corpus::*;
pub use diff::*;
pub use explain::*;
pub use minimize::*;
pub use replay::*;

use serde::{Deserialize, Serialize};

pub const REPRO_CAPSULE_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapsuleModeV1 {
    Thin,
    SelfContained,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum FailureOracleV1 {
    InvariantViolation(String),
    DigestDivergence {
        path: Option<String>,
        expected: String,
    },
    TerminalReason(String),
    PanicSignature(String),
    ResourceLeak(String),
    PerformanceBudget {
        budget: String,
        observed: u64,
    },
}
