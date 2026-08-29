//! Mechanical compatibility and diagnostic execution identity.

use er_types::GameContentIdentity;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::KnownOrUnknownV1;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanonicalModelIdentityV1 {
    pub slot: String,
    pub model_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicalCompatibilityIdentityV1 {
    pub game_content: GameContentIdentity,
    pub protocol_version: String,
    pub game_state_schema: u32,
    pub material_schema: u32,
    pub save_schema: u32,
    pub canonical_model_slots: Vec<CanonicalModelIdentityV1>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelBackendIdentityV1 {
    pub backend: String,
    pub version: KnownOrUnknownV1<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildDiagnosticIdentityV1 {
    pub kernel_commit: KnownOrUnknownV1<String>,
    pub cargo_lock_hash: KnownOrUnknownV1<String>,
    pub rust_toolchain: KnownOrUnknownV1<String>,
    pub target_triple: KnownOrUnknownV1<String>,
    pub build_profile: KnownOrUnknownV1<String>,
    pub feature_flags: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterStackIdentityV1 {
    pub platform: Option<String>,
    pub renderer: Option<String>,
    pub asset_pack: Option<String>,
    pub model_backends: Vec<ModelBackendIdentityV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelAbiIdentityV1 {
    pub game_state_schema: u32,
    pub kernel_input_schema: u32,
    pub kernel_effect_schema: u32,
    pub snapshot_schema: u32,
    pub trace_schema: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionIdentityV1 {
    pub mechanical: MechanicalCompatibilityIdentityV1,
    pub build: BuildDiagnosticIdentityV1,
    pub adapters: AdapterStackIdentityV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ExecutionIdentityErrorV1 {
    #[error("execution identity contains an empty known identity")]
    Empty,
    #[error("execution identity contains duplicate or unsorted entries")]
    Order,
    #[error("execution identity schema version is zero")]
    Schema,
}

impl ExecutionIdentityV1 {
    pub fn normalize(mut self) -> Result<Self, ExecutionIdentityErrorV1> {
        self.mechanical.canonical_model_slots.sort();
        self.build.feature_flags.sort();
        self.adapters.model_backends.sort();
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), ExecutionIdentityErrorV1> {
        if self.mechanical.protocol_version.is_empty()
            || self.mechanical.game_state_schema == 0
            || self.mechanical.material_schema == 0
            || self.mechanical.save_schema == 0
        {
            return Err(ExecutionIdentityErrorV1::Schema);
        }
        if self
            .mechanical
            .canonical_model_slots
            .iter()
            .any(|entry| entry.slot.is_empty() || entry.model_hash.is_empty())
            || self
                .adapters
                .model_backends
                .iter()
                .any(|entry| entry.backend.is_empty() || known_empty(&entry.version))
            || known_empty(&self.build.kernel_commit)
            || known_empty(&self.build.cargo_lock_hash)
            || known_empty(&self.build.rust_toolchain)
            || known_empty(&self.build.target_triple)
            || known_empty(&self.build.build_profile)
            || self.build.feature_flags.iter().any(String::is_empty)
        {
            return Err(ExecutionIdentityErrorV1::Empty);
        }
        if !strictly_sorted(&self.mechanical.canonical_model_slots)
            || !strictly_sorted(&self.build.feature_flags)
            || !strictly_sorted(&self.adapters.model_backends)
        {
            return Err(ExecutionIdentityErrorV1::Order);
        }
        Ok(())
    }

    pub fn mechanically_compatible(&self, other: &Self) -> bool {
        self.mechanical == other.mechanical
    }
}

fn known_empty(value: &KnownOrUnknownV1<String>) -> bool {
    matches!(value, KnownOrUnknownV1::Known(value) if value.is_empty())
}

fn strictly_sorted<T: Ord>(values: &[T]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}
