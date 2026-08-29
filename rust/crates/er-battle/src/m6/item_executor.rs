//! Battle-side executor for M6B held-item routine programs.
//!
//! This module executes the closed held-item lifecycle subset of
//! [`MechanicOperationV2`] against the per-Pokemon mechanic extensions of a
//! game state: activation checks, stack adjustments, consumption,
//! preservation, and removal. It is the V2 counterpart of the V1 item
//! mutations in `crate::mechanics_mutation` and mirrors their observable
//! semantics:
//!
//! - `HeldItemConsume` decrements remaining charges first and marks the item
//!   consumed once no charges remain;
//! - `HeldItemPreserve` clears the consumed flag (the berry is kept);
//! - `HeldItemStack` adjusts the charge count with checked arithmetic — an
//!   overflow or underflow is a typed error, never a silent clamp;
//! - `HeldItemRemove` drops the entry.
//!
//! Anything outside that surface fails closed: creation needs a run-layer
//! grant context, transfer needs selector targets, and every other operation
//! kind is not held-item lifecycle at all. None of them become no-ops; each
//! yields a typed [`ItemExecutorError`]. Query operations never appear in a
//! trigger routine's executable slice and are rejected here as well.
//!
//! The executor takes the extension slice rather than a whole game state so
//! it stays independent of state assembly; callers pass
//! `&mut state.pokemon_extensions`.

use er_mechanics::selector_operation_v2::MechanicOperationV2;
use er_state::mechanic_state::HeldItemStateV1;
use er_state::migration_v3::PokemonMechanicExtensionV3;
use er_types::battle_ids::PokemonId;
use thiserror::Error;

/// Before/after evidence for one executed held-item operation. Removal
/// clears the optional after-values so consumers can distinguish "restored"
/// from "gone".
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ItemMutationEvidence {
    /// Ordinal of the operation inside the routine's executable slice.
    pub operation_ordinal: u16,
    pub charges_before: u16,
    /// `None` once the item has been removed.
    pub charges_after: Option<u16>,
    pub consumed_before: bool,
    /// `None` once the item has been removed.
    pub consumed_after: Option<bool>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ItemExecutorError {
    #[error("holder {0:?} has no battle-state extension")]
    MissingHolder(PokemonId),
    #[error("holder carries no held item with key {registry_key:?}")]
    MissingHeldItem { registry_key: String },
    #[error("stack adjustment for {registry_key:?} leaves the charge count out of range")]
    ChargesOverflow { registry_key: String },
    #[error("operation {index} is not part of the closed held-item lifecycle subset")]
    UnsupportedOperation { index: usize },
}

/// Activation gate for a mapped item routine: true when the holder carries at
/// least one unconsumed stack of the item. A consumed single-use item is no
/// longer active; charged items stay active while charges remain.
pub fn item_is_active(
    extensions: &[PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
) -> Result<bool, ItemExecutorError> {
    Ok(find_held_item(extensions, holder, registry_key)?.is_some_and(|item| !item.consumed))
}

/// Applies the closed held-item lifecycle subset of one mapped item routine
/// to the extension slice, returning before/after evidence per executed
/// operation.
///
/// Operations apply in slice order against the same staged state so a
/// consume followed by a preserve inside one routine observes the prior
/// mutation, exactly like the V1 hook executor.
pub fn apply_item_routine(
    extensions: &mut [PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
    operations: &[MechanicOperationV2],
) -> Result<Vec<ItemMutationEvidence>, ItemExecutorError> {
    let mut evidence = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let ordinal =
            u16::try_from(index).map_err(|_| ItemExecutorError::UnsupportedOperation { index })?;
        match operation {
            MechanicOperationV2::HeldItemStack { delta } => {
                let before = current_charges(extensions, holder, registry_key)?;
                let adjusted = apply_delta(before, *delta).ok_or_else(|| {
                    ItemExecutorError::ChargesOverflow {
                        registry_key: registry_key.to_owned(),
                    }
                })?;
                set_charges(extensions, holder, registry_key, adjusted)?;
                evidence.push(ItemMutationEvidence {
                    operation_ordinal: ordinal,
                    charges_before: before,
                    charges_after: Some(adjusted),
                    consumed_before: false,
                    consumed_after: Some(false),
                });
            }
            MechanicOperationV2::HeldItemConsume => {
                let item = held_item_mut(extensions, holder, registry_key)?;
                let charges_before = item.charges;
                let consumed_before = item.consumed;
                if item.charges > 0 {
                    item.charges -= 1;
                }
                item.consumed = true;
                evidence.push(ItemMutationEvidence {
                    operation_ordinal: ordinal,
                    charges_before,
                    charges_after: Some(item.charges),
                    consumed_before,
                    consumed_after: Some(true),
                });
            }
            MechanicOperationV2::HeldItemPreserve => {
                let item = held_item_mut(extensions, holder, registry_key)?;
                let charges_before = item.charges;
                let consumed_before = item.consumed;
                item.consumed = false;
                evidence.push(ItemMutationEvidence {
                    operation_ordinal: ordinal,
                    charges_before,
                    charges_after: Some(item.charges),
                    consumed_before,
                    consumed_after: Some(false),
                });
            }
            MechanicOperationV2::HeldItemRemove => {
                let removed = remove_held_item(extensions, holder, registry_key)?;
                evidence.push(ItemMutationEvidence {
                    operation_ordinal: ordinal,
                    charges_before: removed.charges,
                    charges_after: None,
                    consumed_before: removed.consumed,
                    consumed_after: None,
                });
            }
            _ => return Err(ItemExecutorError::UnsupportedOperation { index }),
        }
    }
    Ok(evidence)
}

fn extension_index(
    extensions: &[PokemonMechanicExtensionV3],
    holder: PokemonId,
) -> Result<usize, ItemExecutorError> {
    extensions
        .iter()
        .position(|extension| extension.pokemon_id == holder)
        .ok_or(ItemExecutorError::MissingHolder(holder))
}

/// Locates the held item by its sorted registry key (held-item entries are
/// validated as sorted by registry key).
fn find_held_item<'a>(
    extensions: &'a [PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
) -> Result<Option<&'a HeldItemStateV1>, ItemExecutorError> {
    let items = &extensions[extension_index(extensions, holder)?].held_items;
    Ok(items
        .binary_search_by(|item| item.registry_key.as_str().cmp(registry_key))
        .ok()
        .map(|position| &items[position]))
}

fn current_charges(
    extensions: &[PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
) -> Result<u16, ItemExecutorError> {
    find_held_item(extensions, holder, registry_key)?
        .map(|item| item.charges)
        .ok_or_else(|| ItemExecutorError::MissingHeldItem {
            registry_key: registry_key.to_owned(),
        })
}

fn set_charges(
    extensions: &mut [PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
    charges: u16,
) -> Result<(), ItemExecutorError> {
    held_item_mut(extensions, holder, registry_key)?.charges = charges;
    Ok(())
}

fn held_item_mut<'a>(
    extensions: &'a mut [PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
) -> Result<&'a mut HeldItemStateV1, ItemExecutorError> {
    let items = &mut extensions[extension_index(extensions, holder)?].held_items;
    let position = items
        .binary_search_by(|item| item.registry_key.as_str().cmp(registry_key))
        .map_err(|_| ItemExecutorError::MissingHeldItem {
            registry_key: registry_key.to_owned(),
        })?;
    Ok(&mut items[position])
}

fn remove_held_item(
    extensions: &mut [PokemonMechanicExtensionV3],
    holder: PokemonId,
    registry_key: &str,
) -> Result<HeldItemStateV1, ItemExecutorError> {
    let items = &mut extensions[extension_index(extensions, holder)?].held_items;
    let position = items
        .binary_search_by(|item| item.registry_key.as_str().cmp(registry_key))
        .map_err(|_| ItemExecutorError::MissingHeldItem {
            registry_key: registry_key.to_owned(),
        })?;
    Ok(items.remove(position))
}

/// Checked stack arithmetic. Positive deltas add; negative deltas subtract.
/// Crossing zero in either direction is an error, not saturation.
fn apply_delta(charges: u16, delta: i16) -> Option<u16> {
    if delta >= 0 {
        charges.checked_add(u16::try_from(delta).ok()?)
    } else {
        charges.checked_sub(u16::try_from(-delta).ok()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::mechanic_state::{HeldItemStateV1, MechanicStateStoreV1};
    use er_types::{SafeU53, SourceOrdinal};

    fn holder() -> PokemonId {
        PokemonId::try_from_u64(1).expect("positive")
    }

    fn held_item(key: &str, id: u64) -> HeldItemStateV1 {
        HeldItemStateV1 {
            item_id: SafeU53::new(id).expect("in range"),
            registry_key: key.to_owned(),
            source_ordinal: SourceOrdinal::ZERO,
            consumed: false,
            charges: 1,
        }
    }

    fn extensions_with(key: &str, id: u64) -> Vec<PokemonMechanicExtensionV3> {
        vec![PokemonMechanicExtensionV3 {
            pokemon_id: holder(),
            held_items: vec![held_item(key, id)],
            mechanics: MechanicStateStoreV1::default(),
        }]
    }

    #[test]
    fn consume_then_preserve_restores_the_item() {
        let mut extensions = extensions_with("SCOPE_LENS", 7);
        let evidence = apply_item_routine(
            &mut extensions,
            holder(),
            "SCOPE_LENS",
            &[MechanicOperationV2::HeldItemConsume],
        )
        .expect("consume");
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].consumed_after, Some(true));

        assert_eq!(
            apply_item_routine(
                &mut extensions,
                holder(),
                "SCOPE_LENS",
                &[MechanicOperationV2::HeldItemPreserve],
            )
            .expect("preserve")[0]
                .consumed_after,
            Some(false)
        );
    }

    #[test]
    fn stack_underflow_fails_closed() {
        let mut extensions = extensions_with("ER_LIFE_ORB", 9);
        assert_eq!(
            apply_item_routine(
                &mut extensions,
                holder(),
                "ER_LIFE_ORB",
                &[MechanicOperationV2::HeldItemStack { delta: -2 }],
            ),
            Err(ItemExecutorError::ChargesOverflow {
                registry_key: "ER_LIFE_ORB".to_owned(),
            })
        );
    }

    #[test]
    fn non_lifecycle_operations_are_rejected_not_no_ops() {
        let mut extensions = extensions_with("BERRY", 11);
        assert_eq!(
            apply_item_routine(
                &mut extensions,
                holder(),
                "BERRY",
                &[MechanicOperationV2::HpHeal { amount: 10 }],
            ),
            Err(ItemExecutorError::UnsupportedOperation { index: 0 })
        );
    }

    #[test]
    fn missing_holder_and_missing_item_fail_typed() {
        let mut extensions = extensions_with("LEFTOVERS", 13);
        let other = PokemonId::try_from_u64(2).expect("positive");
        assert!(matches!(
            apply_item_routine(
                &mut extensions,
                other,
                "LEFTOVERS",
                &[MechanicOperationV2::HeldItemConsume],
            ),
            Err(ItemExecutorError::MissingHolder(_))
        ));
        assert_eq!(
            apply_item_routine(
                &mut extensions,
                holder(),
                "ABSENT_ITEM",
                &[MechanicOperationV2::HeldItemConsume],
            ),
            Err(ItemExecutorError::MissingHeldItem {
                registry_key: "ABSENT_ITEM".to_owned(),
            })
        );
    }

    #[test]
    fn activation_requires_an_unconsumed_stack() {
        let mut extensions = extensions_with("LEFTOVERS", 13);
        assert!(item_is_active(&extensions, holder(), "LEFTOVERS").expect("present"));
        apply_item_routine(
            &mut extensions,
            holder(),
            "LEFTOVERS",
            &[MechanicOperationV2::HeldItemRemove],
        )
        .expect("remove");
        assert!(!item_is_active(&extensions, holder(), "LEFTOVERS").expect("holder exists"));
    }

    #[test]
    fn stack_arithmetic_is_checked_in_both_directions() {
        assert_eq!(apply_delta(0, 0), Some(0));
        assert_eq!(apply_delta(1, 2), Some(3));
        assert_eq!(apply_delta(3, -2), Some(1));
        assert_eq!(apply_delta(0, -1), None);
        assert_eq!(apply_delta(u16::MAX, 1), None);
    }
}
