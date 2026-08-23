use std::collections::BTreeSet;

use er_mechanics::{MechanicCounter, MechanicStatePayload};
use er_types::SafeU53;
use er_types::mechanics::{
    MECHANIC_STATE_SCHEMA_VERSION, MechanicAddress, MechanicInstanceId, MechanicScope,
    MechanicsProgramId, SourceOrdinal,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldItemStateV1 {
    pub item_id: SafeU53,
    pub registry_key: String,
    pub source_ordinal: SourceOrdinal,
    pub consumed: bool,
    pub charges: u16,
}

impl HeldItemStateV1 {
    pub fn validate(&self) -> Result<(), MechanicStateError> {
        if self.registry_key.is_empty() {
            return Err(MechanicStateError::EmptyHeldItemRegistryKey);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicInstanceStateV1 {
    pub address: MechanicAddress,
    pub program_id: MechanicsProgramId,
    pub owner: MechanicScope,
    pub stored_target: Option<MechanicScope>,
    pub creation_ordinal: SafeU53,
    pub remaining_turns: Option<u16>,
    pub counters: Vec<MechanicCounter>,
    pub payload: MechanicStatePayload,
}

impl MechanicInstanceStateV1 {
    pub fn validate(&self) -> Result<(), MechanicStateError> {
        self.address
            .validate()
            .map_err(|_| MechanicStateError::InvalidAddress)?;
        if self.program_id == MechanicsProgramId::ZERO {
            return Err(MechanicStateError::ZeroProgramId);
        }
        if self.remaining_turns == Some(0) {
            return Err(MechanicStateError::ZeroRemainingTurns);
        }
        let mut previous = None;
        for counter in &self.counters {
            if previous.is_some_and(|kind| counter.kind <= kind) {
                return Err(MechanicStateError::CountersOutOfOrder);
            }
            previous = Some(counter.kind);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicStateStoreV1 {
    pub schema_version: u32,
    pub next_instance_id: MechanicInstanceId,
    pub next_creation_ordinal: SafeU53,
    pub instances: Vec<MechanicInstanceStateV1>,
}

impl Default for MechanicStateStoreV1 {
    fn default() -> Self {
        Self {
            schema_version: MECHANIC_STATE_SCHEMA_VERSION,
            next_instance_id: MechanicInstanceId::new(SafeU53::new(1).unwrap_or(SafeU53::ZERO)),
            next_creation_ordinal: SafeU53::new(1).unwrap_or(SafeU53::ZERO),
            instances: Vec::new(),
        }
    }
}

impl MechanicStateStoreV1 {
    pub fn validate(&self) -> Result<(), MechanicStateError> {
        if self.schema_version != MECHANIC_STATE_SCHEMA_VERSION {
            return Err(MechanicStateError::SchemaVersion {
                expected: MECHANIC_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.next_instance_id == MechanicInstanceId::ZERO {
            return Err(MechanicStateError::ZeroNextInstanceId);
        }
        if self.next_creation_ordinal == SafeU53::ZERO {
            return Err(MechanicStateError::ZeroNextCreationOrdinal);
        }
        let mut previous_address: Option<&MechanicAddress> = None;
        let mut creation_ordinals = BTreeSet::new();
        for instance in &self.instances {
            instance.validate()?;
            if previous_address.is_some_and(|address| instance.address <= *address) {
                return Err(MechanicStateError::InstancesOutOfOrder);
            }
            if !creation_ordinals.insert(instance.creation_ordinal) {
                return Err(MechanicStateError::DuplicateCreationOrdinal);
            }
            if instance.address.instance_id >= self.next_instance_id {
                return Err(MechanicStateError::NextInstanceIdNotAhead);
            }
            if instance.creation_ordinal >= self.next_creation_ordinal {
                return Err(MechanicStateError::NextCreationOrdinalNotAhead);
            }
            previous_address = Some(&instance.address);
        }
        Ok(())
    }
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum MechanicStateError {
    #[error("mechanic state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("held-item registry key must not be empty")]
    EmptyHeldItemRegistryKey,
    #[error("mechanic address is invalid")]
    InvalidAddress,
    #[error("mechanic program ID must be positive")]
    ZeroProgramId,
    #[error("remaining turns must be positive when present")]
    ZeroRemainingTurns,
    #[error("mechanic counters must be strictly ordered and unique")]
    CountersOutOfOrder,
    #[error("next mechanic instance ID must be positive")]
    ZeroNextInstanceId,
    #[error("next mechanic creation ordinal must be positive")]
    ZeroNextCreationOrdinal,
    #[error("mechanic instances must be strictly ordered and unique")]
    InstancesOutOfOrder,
    #[error("mechanic creation ordinals must be unique")]
    DuplicateCreationOrdinal,
    #[error("next mechanic instance ID must exceed every live instance")]
    NextInstanceIdNotAhead,
    #[error("next mechanic creation ordinal must exceed every live instance")]
    NextCreationOrdinalNotAhead,
}
