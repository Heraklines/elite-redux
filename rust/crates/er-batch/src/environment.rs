//! Deterministic batch lifecycle, compatibility, and resource accounting.

use er_dev_types::MechanicalCompatibilityIdentityV1;
use serde::{Deserialize, Serialize};

use crate::{BatchEnvironmentIdV1, BatchEnvironmentV1, BatchErrorV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatchResourceSnapshotV1 {
    pub environment_count: usize,
    pub environment_ids: Vec<BatchEnvironmentIdV1>,
    pub all_closed: bool,
}

impl BatchEnvironmentV1 {
    pub fn environment_ids(&self) -> Vec<BatchEnvironmentIdV1> {
        self.entries.keys().copied().collect()
    }

    pub fn maximum_environments(&self) -> usize {
        self.maximum_environments
    }

    pub fn remove(&mut self, id: BatchEnvironmentIdV1, reason: &str) -> Result<(), BatchErrorV1> {
        if reason.is_empty() {
            return Err(BatchErrorV1::Invalid);
        }
        let mut session = self.entries.remove(&id).ok_or(BatchErrorV1::Missing)?;
        session
            .close(reason)
            .map_err(|error| BatchErrorV1::Environment(error.to_string()))
    }

    pub fn validate_mechanical_compatibility(
        &self,
    ) -> Result<Option<MechanicalCompatibilityIdentityV1>, BatchErrorV1> {
        let mut identities = self
            .entries
            .values()
            .map(|session| &session.identity.mechanical);
        let Some(first) = identities.next() else {
            return Ok(None);
        };
        if identities.any(|identity| identity != first) {
            return Err(BatchErrorV1::Invalid);
        }
        Ok(Some(first.clone()))
    }

    pub fn resource_snapshot(&self) -> BatchResourceSnapshotV1 {
        BatchResourceSnapshotV1 {
            environment_count: self.entries.len(),
            environment_ids: self.environment_ids(),
            all_closed: self.entries.values().all(|session| session.is_closed()),
        }
    }
}
