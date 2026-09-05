//! Canonical state for the `ITEM_BERRY_LIFECYCLE` bespoke mechanic family.
//!
//! Holds the ordered held-item instance store, the consume ledger that feeds
//! Harvest-style restore, and Unnerve-style item suppression windows. This
//! store is the single source of truth for berry/held-item lifecycle
//! transitions in `er-battle::m6::bespoke::item_lifecycle`; it never stores
//! callbacks, JSON, or TypeScript identities.
//!
//! Canonical ordering and uniqueness:
//!
//! - instances are strictly ordered by `instance_id`, which is unique,
//!   positive, and stays below `next_instance_id`;
//! - at most one live instance exists per `(owner, registry_key)` slot —
//!   additional grants merge stacks into the existing instance;
//! - ledger entries are strictly ordered by `ledger_ordinal`, unique, and
//!   stay below `next_ledger_ordinal`;
//! - suppression windows are strictly ordered by `(holder, registry_key)`
//!   with at most one window per pair.

use std::collections::BTreeSet;

use er_types::SafeU53;
use er_types::battle_ids::PokemonId;
use er_types::mechanics::SourceOrdinal;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Schema version of the item-lifecycle bespoke state root.
pub const ITEM_LIFECYCLE_STATE_SCHEMA_VERSION: u32 = 1;

/// One live held-item instance (a berry stack or a charged held item).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemInstanceV2 {
    /// Unique, positive instance identity; the canonical sort key.
    pub instance_id: u64,
    pub owner: PokemonId,
    pub registry_key: String,
    pub source_ordinal: SourceOrdinal,
    pub creation_ordinal: SafeU53,
    /// Remaining stacks; a live instance always holds at least one.
    pub stacks: u16,
    /// Remaining trigger charges for charged items; `None` for plain stacks.
    pub charges: Option<u16>,
    /// Whether the instance may move between owners via transfer/steal/swap.
    pub transferable: bool,
}

impl ItemInstanceV2 {
    pub fn validate(&self) -> Result<(), ItemLifecycleStateError> {
        if self.instance_id == 0 {
            return Err(ItemLifecycleStateError::ZeroInstanceId);
        }
        if self.registry_key.is_empty() {
            return Err(ItemLifecycleStateError::EmptyRegistryKey);
        }
        if self.stacks == 0 {
            return Err(ItemLifecycleStateError::ZeroStacks);
        }
        if self.charges == Some(0) {
            return Err(ItemLifecycleStateError::ZeroCharges);
        }
        Ok(())
    }
}

/// One consume-ledger entry: a destroyed instance recorded so a later
/// restore (Harvest family) can reinstate exactly what was lost. Preserved
/// consumptions (Berry Pouch family) never append entries, so preserved
/// berries cannot dupe through restore.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsumeLedgerEntryV2 {
    /// Unique, positive ledger position; the canonical sort key.
    pub ledger_ordinal: SafeU53,
    /// The destroyed instance's identity.
    pub instance_id: u64,
    /// The Pokemon whose consumption destroyed the instance.
    pub consumer: PokemonId,
    pub registry_key: String,
    pub source_ordinal: SourceOrdinal,
    pub creation_ordinal: SafeU53,
    /// Charge count the instance carried when it was destroyed.
    pub charges: Option<u16>,
    /// Whether the instance was transferable before destruction.
    pub transferable: bool,
    /// `true` while the entry can still feed a restore; knocked-off items
    /// are lost forever and consumed items lose eligibility once restored.
    pub restorable: bool,
    /// Set when a restore has already drawn this entry.
    pub restored: bool,
}

impl ConsumeLedgerEntryV2 {
    pub fn validate(&self) -> Result<(), ItemLifecycleStateError> {
        if self.ledger_ordinal == SafeU53::ZERO {
            return Err(ItemLifecycleStateError::ZeroLedgerOrdinal);
        }
        if self.instance_id == 0 {
            return Err(ItemLifecycleStateError::ZeroInstanceId);
        }
        if self.registry_key.is_empty() {
            return Err(ItemLifecycleStateError::EmptyRegistryKey);
        }
        Ok(())
    }
}

/// One Unnerve-style suppression window: the held item stays in place but is
/// inert through `expiry_turn` inclusive (active while
/// `current_turn <= expiry_turn`), mirroring the read-only TypeScript
/// item-suppression primitive.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemSuppressionV2 {
    pub holder: PokemonId,
    pub registry_key: String,
    pub expiry_turn: u32,
}

impl ItemSuppressionV2 {
    pub fn validate(&self) -> Result<(), ItemLifecycleStateError> {
        if self.registry_key.is_empty() {
            return Err(ItemLifecycleStateError::EmptyRegistryKey);
        }
        Ok(())
    }

    /// Active while the current turn has not passed the expiry turn.
    pub fn is_active(&self, current_turn: u32) -> bool {
        current_turn <= self.expiry_turn
    }
}

/// The complete item-lifecycle state root.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemLifecycleStateV2 {
    pub schema_version: u32,
    pub next_instance_id: u64,
    pub next_creation_ordinal: SafeU53,
    pub next_ledger_ordinal: SafeU53,
    pub instances: Vec<ItemInstanceV2>,
    pub consume_ledger: Vec<ConsumeLedgerEntryV2>,
    pub suppressions: Vec<ItemSuppressionV2>,
}

impl Default for ItemLifecycleStateV2 {
    fn default() -> Self {
        Self {
            schema_version: ITEM_LIFECYCLE_STATE_SCHEMA_VERSION,
            next_instance_id: 1,
            next_creation_ordinal: SafeU53::new(1).unwrap_or(SafeU53::ZERO),
            next_ledger_ordinal: SafeU53::new(1).unwrap_or(SafeU53::ZERO),
            instances: Vec::new(),
            consume_ledger: Vec::new(),
            suppressions: Vec::new(),
        }
    }
}

impl ItemLifecycleStateV2 {
    /// Locates the live instance for `(owner, registry_key)`, if any.
    pub fn find_instance(&self, owner: PokemonId, registry_key: &str) -> Option<&ItemInstanceV2> {
        self.instances
            .iter()
            .find(|item| item.owner == owner && item.registry_key == registry_key)
    }

    /// Whether any live instance with `registry_key` exists for `owner`,
    /// regardless of remaining stacks or suppression windows.
    pub fn holds_item(&self, owner: PokemonId, registry_key: &str) -> bool {
        self.find_instance(owner, registry_key).is_some()
    }

    /// The suppression window for `(holder, registry_key)`, if any.
    pub fn find_suppression(
        &self,
        holder: PokemonId,
        registry_key: &str,
    ) -> Option<&ItemSuppressionV2> {
        self.suppressions
            .iter()
            .find(|window| window.holder == holder && window.registry_key == registry_key)
    }

    /// Whether `(holder, registry_key)` is suppressed on `current_turn`.
    pub fn is_suppressed(&self, holder: PokemonId, registry_key: &str, current_turn: u32) -> bool {
        self.find_suppression(holder, registry_key)
            .is_some_and(|window| window.is_active(current_turn))
    }

    pub fn validate(&self) -> Result<(), ItemLifecycleStateError> {
        if self.schema_version != ITEM_LIFECYCLE_STATE_SCHEMA_VERSION {
            return Err(ItemLifecycleStateError::SchemaVersion {
                expected: ITEM_LIFECYCLE_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.next_instance_id == 0 {
            return Err(ItemLifecycleStateError::ZeroNextInstanceId);
        }
        if self.next_creation_ordinal == SafeU53::ZERO {
            return Err(ItemLifecycleStateError::ZeroNextCreationOrdinal);
        }
        if self.next_ledger_ordinal == SafeU53::ZERO {
            return Err(ItemLifecycleStateError::ZeroNextLedgerOrdinal);
        }
        let mut previous_instance_id: Option<u64> = None;
        let mut creation_ordinals = BTreeSet::new();
        let mut occupied_slots = BTreeSet::new();
        for instance in &self.instances {
            instance.validate()?;
            if previous_instance_id.is_some_and(|previous| instance.instance_id <= previous) {
                return Err(ItemLifecycleStateError::InstancesOutOfOrder);
            }
            if !creation_ordinals.insert(instance.creation_ordinal) {
                return Err(ItemLifecycleStateError::DuplicateCreationOrdinal);
            }
            if instance.instance_id >= self.next_instance_id {
                return Err(ItemLifecycleStateError::NextInstanceIdNotAhead);
            }
            if instance.creation_ordinal >= self.next_creation_ordinal {
                return Err(ItemLifecycleStateError::NextCreationOrdinalNotAhead);
            }
            if !occupied_slots.insert((instance.owner, instance.registry_key.clone())) {
                return Err(ItemLifecycleStateError::DuplicateOwnerSlot {
                    owner: instance.owner,
                    registry_key: instance.registry_key.clone(),
                });
            }
            previous_instance_id = Some(instance.instance_id);
        }
        let mut previous_ledger_ordinal = SafeU53::ZERO;
        for entry in &self.consume_ledger {
            entry.validate()?;
            if entry.ledger_ordinal <= previous_ledger_ordinal {
                return Err(ItemLifecycleStateError::LedgerOutOfOrder);
            }
            if entry.ledger_ordinal >= self.next_ledger_ordinal {
                return Err(ItemLifecycleStateError::NextLedgerOrdinalNotAhead);
            }
            previous_ledger_ordinal = entry.ledger_ordinal;
        }
        let mut previous_window: Option<(PokemonId, &str)> = None;
        for window in &self.suppressions {
            window.validate()?;
            if previous_window
                .is_some_and(|previous| previous >= (window.holder, window.registry_key.as_str()))
            {
                return Err(ItemLifecycleStateError::SuppressionsOutOfOrder);
            }
            previous_window = Some((window.holder, window.registry_key.as_str()));
        }
        Ok(())
    }
}

/// Typed validation failures for the item-lifecycle state root.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ItemLifecycleStateError {
    #[error("item-lifecycle state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("item instance ID must be positive")]
    ZeroInstanceId,
    #[error("next item instance ID must be positive")]
    ZeroNextInstanceId,
    #[error("item creation ordinal must be positive")]
    ZeroNextCreationOrdinal,
    #[error("next consume-ledger ordinal must be positive")]
    ZeroNextLedgerOrdinal,
    #[error("consume-ledger ordinal must be positive")]
    ZeroLedgerOrdinal,
    #[error("held-item registry key must not be empty")]
    EmptyRegistryKey,
    #[error("live item instances must hold at least one stack")]
    ZeroStacks,
    #[error("charged item instances must hold at least one charge when present")]
    ZeroCharges,
    #[error("item instances must be strictly ordered and unique by instance ID")]
    InstancesOutOfOrder,
    #[error("item creation ordinals must be unique")]
    DuplicateCreationOrdinal,
    #[error("next item instance ID must stay ahead of every live instance")]
    NextInstanceIdNotAhead,
    #[error("next item creation ordinal must stay ahead of every live instance")]
    NextCreationOrdinalNotAhead,
    #[error("an owner cannot hold two instances of the same registry key")]
    DuplicateOwnerSlot {
        owner: PokemonId,
        registry_key: String,
    },
    #[error("consume-ledger entries must be strictly ordered and unique")]
    LedgerOutOfOrder,
    #[error("next consume-ledger ordinal must stay ahead of every ledger entry")]
    NextLedgerOrdinalNotAhead,
    #[error("suppression windows must be strictly ordered and unique per holder and key")]
    SuppressionsOutOfOrder,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn holder(id: u64) -> PokemonId {
        PokemonId::new(SafeU53::new(id).expect("test holder id fits SafeU53"))
    }

    fn instance(instance_id: u64, owner: u64, registry_key: &str) -> ItemInstanceV2 {
        ItemInstanceV2 {
            instance_id,
            owner: holder(owner),
            registry_key: registry_key.to_owned(),
            source_ordinal: SourceOrdinal::ZERO,
            creation_ordinal: SafeU53::new(instance_id).expect("test ordinal fits SafeU53"),
            stacks: 1,
            charges: None,
            transferable: true,
        }
    }

    /// A default state with the next-ID/ordinal cursors raised so fixtures
    /// can hold instances without tripping the ahead-of-cursor invariants
    /// before the property under test is reached.
    fn seeded() -> ItemLifecycleStateV2 {
        ItemLifecycleStateV2 {
            next_instance_id: 3,
            next_creation_ordinal: SafeU53::new(3).expect("test creation cursor fits SafeU53"),
            next_ledger_ordinal: SafeU53::new(3).expect("test ledger cursor fits SafeU53"),
            ..Default::default()
        }
    }

    #[test]
    fn default_state_validates_and_rejects_schema_drift() {
        assert_eq!(ItemLifecycleStateV2::default().validate(), Ok(()));
        let mut drifted = ItemLifecycleStateV2::default();
        drifted.schema_version += 1;
        assert_eq!(
            drifted.validate(),
            Err(ItemLifecycleStateError::SchemaVersion {
                expected: ITEM_LIFECYCLE_STATE_SCHEMA_VERSION,
                actual: ITEM_LIFECYCLE_STATE_SCHEMA_VERSION + 1,
            })
        );
    }

    #[test]
    fn duplicate_owner_slot_is_rejected() {
        let mut state = seeded();
        state.instances.push(instance(1, 7, "SITRUS_BERRY"));
        // Same owner+key under a different instance ID violates slot
        // uniqueness even though instance IDs stay ordered.
        state.instances.push(instance(2, 7, "SITRUS_BERRY"));
        assert_eq!(
            state.validate(),
            Err(ItemLifecycleStateError::DuplicateOwnerSlot {
                owner: holder(7),
                registry_key: "SITRUS_BERRY".to_owned(),
            })
        );
    }

    #[test]
    fn out_of_order_instances_are_rejected() {
        let mut state = seeded();
        state.instances.push(instance(2, 7, "SITRUS_BERRY"));
        state.instances.push(instance(1, 8, "ORAN_BERRY"));
        assert_eq!(
            state.validate(),
            Err(ItemLifecycleStateError::InstancesOutOfOrder)
        );
    }

    #[test]
    fn zero_stacks_and_empty_keys_are_rejected() {
        let mut state = ItemLifecycleStateV2::default();
        let mut empty = instance(1, 7, "");
        state.instances.push(empty.clone());
        assert_eq!(
            state.validate(),
            Err(ItemLifecycleStateError::EmptyRegistryKey)
        );
        empty.registry_key = "SITRUS_BERRY".to_owned();
        empty.stacks = 0;
        state.instances[0] = empty;
        assert_eq!(state.validate(), Err(ItemLifecycleStateError::ZeroStacks));
    }

    #[test]
    fn suppression_windows_must_stay_sorted() {
        let mut state = ItemLifecycleStateV2::default();
        state.suppressions.push(ItemSuppressionV2 {
            holder: holder(3),
            registry_key: "SITRUS_BERRY".to_owned(),
            expiry_turn: 4,
        });
        state.suppressions.push(ItemSuppressionV2 {
            holder: holder(3),
            registry_key: "ORAN_BERRY".to_owned(),
            expiry_turn: 2,
        });
        assert_eq!(
            state.validate(),
            Err(ItemLifecycleStateError::SuppressionsOutOfOrder)
        );
    }
}
