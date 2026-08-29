//! Signed production release, assignment, save, co-op, rollout, and health contracts for M9.

pub mod assignment;
pub mod common;
pub mod coop;
pub mod generation;
pub mod platform;
pub mod release;
pub mod rollout;
pub mod save;
pub mod telemetry;

pub use assignment::*;
pub use common::*;
pub use coop::*;
pub use generation::*;
pub use platform::*;
pub use release::*;
pub use rollout::*;
pub use save::*;
pub use telemetry::*;

use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProductionContractErrorV1 {
    #[error("production schema version is unsupported")]
    Schema,
    #[error("production identifier is invalid: {0}")]
    Identifier(&'static str),
    #[error("production digest is invalid")]
    Digest,
    #[error("production timestamp interval is invalid")]
    Time,
    #[error("production signature is invalid: {0}")]
    Signature(String),
    #[error("production artifact set is incomplete or inconsistent")]
    Artifact,
    #[error("production assignment is invalid: {0}")]
    Assignment(&'static str),
    #[error("production session pin is invalid: {0}")]
    Pin(&'static str),
    #[error("production generation registry is invalid: {0}")]
    Generation(&'static str),
    #[error("production save is invalid: {0}")]
    Save(&'static str),
    #[error("production co-op compatibility failed: {0}")]
    Coop(&'static str),
    #[error("production rollout policy is invalid: {0}")]
    Rollout(&'static str),
    #[error("production telemetry event is invalid: {0}")]
    Telemetry(&'static str),
    #[error("canonical production encoding failed: {0}")]
    Canonical(String),
}
