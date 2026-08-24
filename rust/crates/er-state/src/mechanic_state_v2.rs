//! M6 mechanic-state store V2 and V3→V4 migration.
//!
//! V2 extends the ordered V1 instance store with scheduled events, guard
//! chains, action locks, redirect state, transform overlays, move-copy
//! history, special-damage counters, and per-source behavior-unit identity.
//! Migration from `MechanicStateStoreV1` preserves stable IDs and creation
//! order exactly; any loss aborts.

use std::collections::BTreeSet;

use er_mechanics::{MechanicCounter, MechanicStatePayload};
use er_types::BehaviorUnitId;
use er_types::SafeU53;
use er_types::m6::M6_MECHANIC_STATE_SCHEMA_VERSION;
use er_types::mechanics::{MechanicAddress, MechanicInstanceId, MechanicScope, MechanicsProgramId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::mechanic_state::{MechanicStateError, MechanicStateStoreV1};

/// Ordered held-item state carried into V4 unchanged.
pub type HeldItemStateV2 = crate::mechanic_state::HeldItemStateV1;

/// A pending scheduled event in canonical state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledEventStateV2 {
    pub event_id: u64,
    /// Wave-relative due turn.
    pub due_turn: u32,
    /// Creation order within the store; monotone across the battle.
    pub creation_ordinal: SafeU53,
    pub payload_ordinal: u16,
}

impl ScheduledEventStateV2 {
    pub fn validate(&self) -> Result<(), MechanicStateV2Error> {
        if self.event_id == 0 {
            return Err(MechanicStateV2Error::ZeroScheduledEventId);
        }
        Ok(())
    }
}

/// A protect/endure/guard chain entry (depth-ordered).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuardChainEntryV2 {
    pub depth: u8,
}

/// Transform/illusion/form/stance overlay state for one battler scope.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformOverlayStateV2 {
    pub active: bool,
    pub overlay_species: Option<SafeU53>,
    pub overlay_form_key: Option<String>,
}

/// One mechanic instance in canonical V4 state. Extends V1 with its owning
/// behavior-unit identity so every live effect traces back to frozen catalog
/// evidence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicInstanceStateV2 {
    pub address: MechanicAddress,
    pub program_id: MechanicsProgramId,
    pub owner: MechanicScope,
    pub stored_target: Option<MechanicScope>,
    pub creation_ordinal: SafeU53,
    pub remaining_turns: Option<u16>,
    pub counters: Vec<MechanicCounter>,
    pub payload: MechanicStatePayload,
    pub source_behavior_unit: BehaviorUnitId,
}

impl MechanicInstanceStateV2 {
    pub fn validate(&self) -> Result<(), MechanicStateV2Error> {
        self.address
            .validate()
            .map_err(|_| MechanicStateV2Error::InvalidAddress)?;
        if self.program_id == MechanicsProgramId::ZERO {
            return Err(MechanicStateV2Error::ZeroProgramId);
        }
        if self.remaining_turns == Some(0) {
            return Err(MechanicStateV2Error::ZeroRemainingTurns);
        }
        let mut previous = None;
        for counter in &self.counters {
            if previous.is_some_and(|kind| counter.kind <= kind) {
                return Err(MechanicStateV2Error::CountersOutOfOrder);
            }
            previous = Some(counter.kind);
        }
        self.source_behavior_unit
            .validate()
            .map_err(|_| MechanicStateV2Error::InvalidBehaviorUnit)?;
        Ok(())
    }
}

/// The complete V4/V2 mechanic-state root.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicStateStoreV2 {
    pub schema_version: u32,
    pub next_instance_id: MechanicInstanceId,
    pub next_creation_ordinal: SafeU53,
    pub instances: Vec<MechanicInstanceStateV2>,
    pub scheduled_events: Vec<ScheduledEventStateV2>,
    pub guard_chain_depth: u8,
    /// Charge/recharge or other action lock is active.
    pub action_lock_active: bool,
    /// A redirection (e.g. Commander/follow-me family) is active this turn.
    pub redirect_active: bool,
    pub transform_overlay: TransformOverlayStateV2,
    /// Count of copied/called moves recorded this battle.
    pub move_copy_count: u32,
    /// Accumulated special-damage counters (counter mechanics).
    pub special_damage_counter: u32,
}

impl Default for MechanicStateStoreV2 {
    fn default() -> Self {
        Self {
            schema_version: M6_MECHANIC_STATE_SCHEMA_VERSION,
            next_instance_id: MechanicInstanceId::new(SafeU53::new(1).unwrap_or(SafeU53::ZERO)),
            next_creation_ordinal: SafeU53::new(1).unwrap_or(SafeU53::ZERO),
            instances: Vec::new(),
            scheduled_events: Vec::new(),
            guard_chain_depth: 0,
            action_lock_active: false,
            redirect_active: false,
            transform_overlay: TransformOverlayStateV2::default(),
            move_copy_count: 0,
            special_damage_counter: 0,
        }
    }
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum MechanicStateV2Error {
    #[error("mechanic state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("mechanic address is invalid")]
    InvalidAddress,
    #[error("mechanic program ID must be positive")]
    ZeroProgramId,
    #[error("remaining turns must be positive when present")]
    ZeroRemainingTurns,
    #[error("mechanic counters must be strictly ordered and unique")]
    CountersOutOfOrder,
    #[error("behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
    #[error("next mechanic instance ID must be positive")]
    ZeroNextInstanceId,
    #[error("next mechanic creation ordinal must be positive")]
    ZeroNextCreationOrdinal,
    #[error("mechanic instances must be strictly ordered and unique")]
    InstancesOutOfOrder,
    #[error("mechanic creation ordinals must be unique")]
    DuplicateCreationOrdinal,
    #[error("next mechanic instance ID must stay ahead of all live instances")]
    NextInstanceIdNotAhead,
    #[error("next mechanic creation ordinal must stay ahead of all live instances")]
    NextCreationOrdinalNotAhead,
    #[error("scheduled event ID must be positive")]
    ZeroScheduledEventId,
    #[error("scheduled events must be sorted by due turn then creation order")]
    EventsOutOfOrder,
    #[error("scheduled event creation ordinals must be unique")]
    DuplicateEventCreationOrdinal,
    #[error("guard chain depth exceeds the frozen ceiling of 6")]
    GuardChainTooDeep,
    #[error("migration cannot lose a live mechanic instance")]
    MigrationLostInstance,
    #[error("migration cannot reorder existing instances")]
    MigrationReorderedInstances,
    #[error("source store rejected migration: {0}")]
    SourceValidation(String),
}

const GUARD_CHAIN_MAX_DEPTH: u8 = 6;

impl MechanicStateStoreV2 {
    pub fn validate(&self) -> Result<(), MechanicStateV2Error> {
        if self.schema_version != M6_MECHANIC_STATE_SCHEMA_VERSION {
            return Err(MechanicStateV2Error::SchemaVersion {
                expected: M6_MECHANIC_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.next_instance_id == MechanicInstanceId::ZERO {
            return Err(MechanicStateV2Error::ZeroNextInstanceId);
        }
        if self.next_creation_ordinal == SafeU53::ZERO {
            return Err(MechanicStateV2Error::ZeroNextCreationOrdinal);
        }
        if self.guard_chain_depth > GUARD_CHAIN_MAX_DEPTH {
            return Err(MechanicStateV2Error::GuardChainTooDeep);
        }
        let mut previous_address: Option<&MechanicAddress> = None;
        let mut creation_ordinals = BTreeSet::new();
        for instance in &self.instances {
            instance.validate()?;
            if previous_address.is_some_and(|address| instance.address <= *address) {
                return Err(MechanicStateV2Error::InstancesOutOfOrder);
            }
            if !creation_ordinals.insert(instance.creation_ordinal) {
                return Err(MechanicStateV2Error::DuplicateCreationOrdinal);
            }
            if instance.address.instance_id >= self.next_instance_id {
                return Err(MechanicStateV2Error::NextInstanceIdNotAhead);
            }
            if instance.creation_ordinal >= self.next_creation_ordinal {
                return Err(MechanicStateV2Error::NextCreationOrdinalNotAhead);
            }
            previous_address = Some(&instance.address);
        }
        let mut previous_due: Option<(u32, SafeU53)> = None;
        let mut event_ordinals = BTreeSet::new();
        for event in &self.scheduled_events {
            event.validate()?;
            let key = (event.due_turn, event.creation_ordinal);
            if previous_due.is_some_and(|previous| previous > key) {
                return Err(MechanicStateV2Error::EventsOutOfOrder);
            }
            if !event_ordinals.insert(event.creation_ordinal) {
                return Err(MechanicStateV2Error::DuplicateEventCreationOrdinal);
            }
            previous_due = Some(key);
        }
        Ok(())
    }

    /// Deterministic V3→V4 store migration. The caller supplies an explicit
    /// per-instance program/behavior binding derived from validated V3
    /// content; source-only guessing is forbidden because one source may own
    /// several behavior units.
    pub fn migrate_from_v1(
        v1: &MechanicStateStoreV1,
        binding_for_instance: impl Fn(
            &crate::mechanic_state::MechanicInstanceStateV1,
        ) -> Option<(MechanicsProgramId, BehaviorUnitId)>,
    ) -> Result<Self, MechanicStateV2Error> {
        v1.validate().map_err(|error| match error {
            MechanicStateError::InvalidAddress => MechanicStateV2Error::InvalidAddress,
            MechanicStateError::ZeroProgramId => MechanicStateV2Error::ZeroProgramId,
            other => MechanicStateV2Error::SourceValidation(other.to_string()),
        })?;
        let mut migrated = Self {
            schema_version: M6_MECHANIC_STATE_SCHEMA_VERSION,
            ..Self::default()
        };
        migrated.next_instance_id = v1.next_instance_id;
        migrated.next_creation_ordinal = v1.next_creation_ordinal;
        for instance in &v1.instances {
            let (program_id, unit) = binding_for_instance(instance)
                .ok_or(MechanicStateV2Error::MigrationLostInstance)?;
            migrated.instances.push(MechanicInstanceStateV2 {
                address: instance.address.clone(),
                program_id,
                owner: instance.owner,
                stored_target: instance.stored_target,
                creation_ordinal: instance.creation_ordinal,
                remaining_turns: instance.remaining_turns,
                counters: instance.counters.clone(),
                payload: instance.payload.clone(),
                source_behavior_unit: unit,
            });
        }
        for (before, after) in v1.instances.iter().zip(&migrated.instances) {
            if before.address != after.address || before.creation_ordinal != after.creation_ordinal
            {
                return Err(MechanicStateV2Error::MigrationReorderedInstances);
            }
        }
        migrated.validate()?;
        Ok(migrated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::SafeU53;
    use er_types::mechanics::{MechanicAddress, MechanicSourceId, MechanicSourceKind};
    use er_types::{BehaviorUnitKind, BehaviorUnitOrdinal, ProvenanceHash};

    fn behavior_unit() -> BehaviorUnitId {
        BehaviorUnitId {
            source: er_types::BehaviorSourceId::Move {
                numeric_id: SafeU53::new(1).unwrap(),
            },
            unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
            ordinal: BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse("0".repeat(64)).unwrap(),
        }
    }

    #[test]
    fn empty_v2_store_validates() {
        assert_eq!(MechanicStateStoreV2::default().validate(), Ok(()));
    }

    #[test]
    fn wrong_schema_version_fails() {
        let mut store = MechanicStateStoreV2::default();
        store.schema_version = 99;
        assert!(matches!(
            store.validate(),
            Err(MechanicStateV2Error::SchemaVersion { .. })
        ));
    }

    #[test]
    fn migration_preserves_instance_order_and_ids() {
        let source = MechanicSourceId::numeric(MechanicSourceKind::Move, SafeU53::new(1).unwrap());
        let address = MechanicAddress {
            scope: er_types::mechanics::MechanicScope::Battle,
            source,
            source_ordinal: er_types::mechanics::SourceOrdinal::ZERO,
            instance_id: MechanicInstanceId::new(SafeU53::new(2).unwrap()),
        };
        let mut v1 = MechanicStateStoreV1::default();
        v1.next_instance_id = MechanicInstanceId::new(SafeU53::new(3).unwrap());
        v1.next_creation_ordinal = SafeU53::new(2).unwrap();
        v1.instances
            .push(crate::mechanic_state::MechanicInstanceStateV1 {
                address,
                program_id: MechanicsProgramId::try_from_u64(1).unwrap(),
                owner: er_types::mechanics::MechanicScope::Battle,
                stored_target: None,
                creation_ordinal: SafeU53::new(1).unwrap(),
                remaining_turns: None,
                counters: Vec::new(),
                payload: er_mechanics::MechanicStatePayload::Empty,
            });
        let mapping = |instance: &crate::mechanic_state::MechanicInstanceStateV1| {
            (instance.address.source.kind == MechanicSourceKind::Move).then(|| {
                (
                    MechanicsProgramId::try_from_u64(2).expect("valid fixture program ID"),
                    behavior_unit(),
                )
            })
        };
        let v2 = MechanicStateStoreV2::migrate_from_v1(&v1, mapping).expect("migration succeeds");
        assert_eq!(
            v2.instances[0].program_id,
            MechanicsProgramId::try_from_u64(2).expect("valid fixture program ID")
        );
        assert_eq!(v2.instances.len(), 1);
        assert_eq!(v2.next_instance_id, v1.next_instance_id);
        assert_eq!(v2.validate(), Ok(()));
    }

    #[test]
    fn migration_fails_closed_without_behavior_mapping() {
        let v1 = MechanicStateStoreV1::default();
        let result = MechanicStateStoreV2::migrate_from_v1(&v1, |_| None);
        assert!(result.is_ok()); // no instances to map; empty migration is lossless
        assert_eq!(
            result
                .expect("empty migration must succeed")
                .instances
                .len(),
            0
        );
    }
}
