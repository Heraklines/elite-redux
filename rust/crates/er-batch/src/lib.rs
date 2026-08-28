//! Deterministically ordered M7.1 batch environment contracts.

use serde::{Deserialize, Serialize};

pub const BATCH_ENVIRONMENT_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BatchEnvironmentIdV1(pub u64);

#[derive(Debug, Default)]
pub struct BatchEnvironmentV1 {
    pub entries: Vec<(BatchEnvironmentIdV1, er_devplane::DeveloperSession)>,
}
