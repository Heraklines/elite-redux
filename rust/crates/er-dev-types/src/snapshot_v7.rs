//! Generic V7 snapshot wrapper preserving an unchanged M7 kernel snapshot value.

use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{EvidenceProfile, identity::ExecutionIdentityV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeveloperSnapshotStateV1 {
    pub external_sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub session_root: String,
    pub session_branch: String,
    pub checkpoint_identity: String,
    pub evidence_profile: EvidenceProfile,
    pub causal_frontier_digest: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV7<K> {
    pub schema_version: u32,
    pub identity: ExecutionIdentityV1,
    pub kernel: K,
    pub developer: DeveloperSnapshotStateV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotV7Error {
    #[error("snapshot V7 schema version must be 7")]
    Version,
    #[error("snapshot V7 lineage/checkpoint identity is empty")]
    Identity,
}

impl<K> RestorableKernelSnapshotV7<K> {
    pub fn from_v6(
        kernel: K,
        identity: ExecutionIdentityV1,
        developer: DeveloperSnapshotStateV1,
    ) -> Result<Self, SnapshotV7Error> {
        let value = Self {
            schema_version: 7,
            identity,
            kernel,
            developer,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn into_v6(self) -> K {
        self.kernel
    }

    pub fn validate(&self) -> Result<(), SnapshotV7Error> {
        if self.schema_version != 7 {
            return Err(SnapshotV7Error::Version);
        }
        if self.developer.session_root.is_empty()
            || self.developer.session_branch.is_empty()
            || self.developer.checkpoint_identity.is_empty()
        {
            return Err(SnapshotV7Error::Identity);
        }
        Ok(())
    }
}
