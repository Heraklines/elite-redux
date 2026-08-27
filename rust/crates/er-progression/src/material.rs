//! Role-neutral canonical lifecycle material for co-op and recovery.

use er_canonical::{canonical_bytes, content_digest};
use er_state::m7_state::GameStateV5;
use er_types::{GameContentIdentity, OperationId, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::lifecycle::LifecycleMutationV1;
use crate::progression::ProgressionMutationV1;

pub const LIFECYCLE_MATERIAL_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "domain", content = "value")]
pub enum LifecycleMaterialMutationV1 {
    Party(LifecycleMutationV1),
    Progression(ProgressionMutationV1),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LifecycleMaterialV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub authority_seat: SeatId,
    pub authority_revision: SafeU53,
    pub content_identity: GameContentIdentity,
    pub before_digest: String,
    pub after_digest: String,
    pub mutations: Vec<LifecycleMaterialMutationV1>,
    pub after_state: GameStateV5,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleMaterialApplyV1 {
    Applied,
    Duplicate,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LifecycleMaterialError {
    #[error("lifecycle material schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("lifecycle material content identity differs from the expected identity")]
    ContentIdentity,
    #[error("lifecycle material before digest differs from the live frontier")]
    BeforeDigest,
    #[error("lifecycle material after digest differs from its after-state")]
    AfterDigest,
    #[error("lifecycle material state is invalid: {0}")]
    State(String),
    #[error("lifecycle material canonical encoding failed: {0}")]
    Canonical(String),
    #[error("lifecycle material decode failed: {0}")]
    Decode(String),
}

impl LifecycleMaterialV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        operation_id: OperationId,
        authority_seat: SeatId,
        authority_revision: SafeU53,
        content_identity: GameContentIdentity,
        before: &GameStateV5,
        after_state: GameStateV5,
        mutations: Vec<LifecycleMaterialMutationV1>,
    ) -> Result<Self, LifecycleMaterialError> {
        let value = Self {
            schema_version: LIFECYCLE_MATERIAL_SCHEMA_VERSION_V1,
            operation_id,
            authority_seat,
            authority_revision,
            content_identity,
            before_digest: digest(before)?,
            after_digest: digest(&after_state)?,
            mutations,
            after_state,
        };
        value.validate(&value.content_identity)?;
        Ok(value)
    }

    pub fn validate(
        &self,
        expected_identity: &GameContentIdentity,
    ) -> Result<(), LifecycleMaterialError> {
        if self.schema_version != LIFECYCLE_MATERIAL_SCHEMA_VERSION_V1 {
            return Err(LifecycleMaterialError::SchemaVersion {
                expected: LIFECYCLE_MATERIAL_SCHEMA_VERSION_V1,
                actual: self.schema_version,
            });
        }
        if &self.content_identity != expected_identity
            || self.after_state.content_identity != self.content_identity
        {
            return Err(LifecycleMaterialError::ContentIdentity);
        }
        self.after_state
            .validate()
            .map_err(|error| LifecycleMaterialError::State(error.to_string()))?;
        if digest(&self.after_state)? != self.after_digest {
            return Err(LifecycleMaterialError::AfterDigest);
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, LifecycleMaterialError> {
        canonical_bytes(self).map_err(|error| LifecycleMaterialError::Canonical(error.to_string()))
    }

    pub fn decode_canonical(bytes: &[u8]) -> Result<Self, LifecycleMaterialError> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|error| LifecycleMaterialError::Decode(error.to_string()))?;
        if value.canonical_bytes()? != bytes {
            return Err(LifecycleMaterialError::Canonical(
                "input bytes are not canonical".to_owned(),
            ));
        }
        Ok(value)
    }
}

pub fn apply_lifecycle_material_v1(
    live: &mut GameStateV5,
    expected_identity: &GameContentIdentity,
    material: &LifecycleMaterialV1,
) -> Result<LifecycleMaterialApplyV1, LifecycleMaterialError> {
    material.validate(expected_identity)?;
    let frontier = digest(live)?;
    if frontier == material.after_digest {
        return Ok(LifecycleMaterialApplyV1::Duplicate);
    }
    if frontier != material.before_digest {
        return Err(LifecycleMaterialError::BeforeDigest);
    }
    let staged = material.after_state.clone();
    staged
        .validate()
        .map_err(|error| LifecycleMaterialError::State(error.to_string()))?;
    *live = staged;
    Ok(LifecycleMaterialApplyV1::Applied)
}

pub fn apply_serialized_lifecycle_material_v1(
    live: &mut GameStateV5,
    expected_identity: &GameContentIdentity,
    bytes: &[u8],
) -> Result<LifecycleMaterialApplyV1, LifecycleMaterialError> {
    let material = LifecycleMaterialV1::decode_canonical(bytes)?;
    apply_lifecycle_material_v1(live, expected_identity, &material)
}

fn digest(state: &GameStateV5) -> Result<String, LifecycleMaterialError> {
    content_digest(state)
        .map(|value| format!("blake3-v1:{value}"))
        .map_err(|error| LifecycleMaterialError::Canonical(error.to_string()))
}
