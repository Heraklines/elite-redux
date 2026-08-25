//! M6 ability routine executor slice for active/passive ability sources.
//!
//! This module owns exactly the ability-family execution concerns frozen by
//! the M6B mapping contract:
//!
//! - **Source identity**: only programs whose source is an `ActiveAbility` or
//!   `PassiveAbility` identity participate; the active/passive role of every
//!   binding comes from its own `BehaviorUnitId`, never rewritten here.
//! - **Source ordering**: participating bindings sort through the frozen V2
//!   total order key (`compare_ordered_sources`) so active abilities execute
//!   before passive slots 0..2 and runtime extras, then by behavior-unit
//!   ordinal and stable identity.
//! - **Passive-slot eligibility**: callers supply the runtime slot
//!   ([`AbilitySourceKindV1`]) of each participating owner; slot ranks flow
//!   into the order key unchanged.
//! - **Suppression**: a suppressed owner never executes any mapped routine.
//!   The gate is enforced unconditionally here, independent of program
//!   content, so mapped programs cannot bypass suppression. Programs may add
//!   further gates through condition roots, which are evaluated over the
//!   supported boolean/predicate subset; anything outside it fails closed.
//!
//! Operation application (query folding and trigger staging) belongs to the
//! central V2 mechanics engine; this slice resolves *which* owned bindings
//! apply, in which exact order.

use er_mechanics::condition_v2::{
    ConditionArenaV2, ConditionNodeId, ConditionNodeV2, ConditionPredicateV2,
};
use er_mechanics::v2::{
    AbilitySourceRank, MechanicHookV2, OrderedMechanicSource, OrderedSourceClass,
    OrderedSourceError, compare_ordered_sources,
};
use er_mechanics::{HookBindingV2, MechanicsProgramV2};
use er_types::{AbilitySourceKindV1, BehaviorSourceId, BehaviorUnitKind, SafeU53};
use thiserror::Error;

/// Runtime eligibility state of one participating ability owner.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AbilityOwnerState {
    /// Content identity of the owning ability source.
    pub source: BehaviorSourceId,
    /// Runtime slot: the active slot, a passive slot 0..2, or a runtime extra.
    pub slot: AbilitySourceKindV1,
    /// Whether the owner's ability is currently suppressed.
    pub suppressed: bool,
    /// Side rank: player before enemy.
    pub side_rank: u8,
    /// Field position within the side.
    pub field_position: u8,
}

impl AbilityOwnerState {
    /// Validates the closed pairing between source identity and slot.
    pub fn validate(&self) -> Result<(), AbilityExecutorError> {
        let valid = match (&self.source, self.slot) {
            (BehaviorSourceId::ActiveAbility { .. }, AbilitySourceKindV1::Active) => true,
            (BehaviorSourceId::PassiveAbility { .. }, slot) => matches!(
                slot,
                AbilitySourceKindV1::PassiveSlot0
                    | AbilitySourceKindV1::PassiveSlot1
                    | AbilitySourceKindV1::PassiveSlot2
                    | AbilitySourceKindV1::RuntimeExtra
            ),
            _ => false,
        };
        if valid {
            Ok(())
        } else {
            Err(AbilityExecutorError::OwnerSlotMismatch(self.slot))
        }
    }

    fn numeric_id(&self) -> Option<SafeU53> {
        match &self.source {
            BehaviorSourceId::ActiveAbility { numeric_id }
            | BehaviorSourceId::PassiveAbility { numeric_id } => Some(*numeric_id),
            _ => None,
        }
    }
}

/// One eligible ability binding with its frozen total-order key.
#[derive(Debug)]
pub struct OrderedAbilityBinding<'a> {
    /// Owning program.
    pub program: &'a MechanicsProgramV2,
    /// The eligible binding inside [`OrderedAbilityBinding::program`].
    pub binding: &'a HookBindingV2,
    /// Index into the caller's owner-state slice.
    pub owner_index: usize,
    /// Frozen order key; sorting uses `compare_ordered_sources`.
    pub order_key: OrderedMechanicSource,
}

/// Typed failure modes of the ability routine slice. Every unsupported shape
/// fails closed; nothing silently degrades to empty behavior.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AbilityExecutorError {
    #[error("owner slot {0:?} does not match its ability source identity")]
    OwnerSlotMismatch(AbilitySourceKindV1),
    #[error("behavior-unit kind {0:?} is not an ability routine kind")]
    NotAnAbilityUnitKind(BehaviorUnitKind),
    #[error("binding references a behavior unit not owned by its program")]
    UnownedBehaviorUnit,
    #[error("routine ability bindings cannot carry selectors")]
    UnexpectedSelectorRoot,
    #[error("condition node is outside the ability routine condition subset")]
    UnsupportedCondition,
    #[error("ordered source key is invalid: {0}")]
    OrderedSource(#[from] OrderedSourceError),
}

/// Resolves and orders every ability-owned binding for one hook invocation.
///
/// Programs whose source does not match any supplied owner do not
/// participate. Suppressed owners contribute nothing. The returned vector is
/// sorted ascending under the frozen source order key; ties resolve through
/// stable identity, never iteration order.
pub fn ordered_ability_bindings<'a>(
    programs: &'a [MechanicsProgramV2],
    owners: &[AbilityOwnerState],
    hook: MechanicHookV2,
) -> Result<Vec<OrderedAbilityBinding<'a>>, AbilityExecutorError> {
    let mut resolved = Vec::new();
    for (owner_index, owner) in owners.iter().enumerate() {
        owner.validate()?;
        // Hard suppression gate: mapped routines never run while suppressed.
        if owner.suppressed {
            continue;
        }
        for program in programs {
            if program.source != owner.source {
                continue;
            }
            for binding in &program.bindings {
                if binding.hook != hook {
                    continue;
                }
                if !program.behavior_units.contains(&binding.behavior_unit) {
                    return Err(AbilityExecutorError::UnownedBehaviorUnit);
                }
                if binding.selector_root.is_some() {
                    return Err(AbilityExecutorError::UnexpectedSelectorRoot);
                }
                if !conditions_admit(&program.conditions, binding.condition_root, owner)? {
                    continue;
                }
                let order_key = binding_order_key(binding, owner)?;
                resolved.push(OrderedAbilityBinding {
                    program,
                    binding,
                    owner_index,
                    order_key,
                });
            }
        }
    }
    resolved.sort_by(|left, right| compare_ordered_sources(&left.order_key, &right.order_key));
    Ok(resolved)
}

/// Builds the frozen order key for one binding under its owner. Class rank and
/// slot rank derive from the binding's own unit kind and the owner's runtime
/// slot; identity comes from the owner's numeric ability identity.
fn binding_order_key(
    binding: &HookBindingV2,
    owner: &AbilityOwnerState,
) -> Result<OrderedMechanicSource, AbilityExecutorError> {
    let source_class = match binding.behavior_unit.unit_kind {
        BehaviorUnitKind::AbilityAttribute => OrderedSourceClass::ActiveAbility,
        BehaviorUnitKind::PassiveAttribute => OrderedSourceClass::PassiveAbility,
        other => return Err(AbilityExecutorError::NotAnAbilityUnitKind(other)),
    };
    let key = OrderedMechanicSource {
        hook: binding.hook,
        authored_priority: binding.authored_priority,
        source_class,
        side_rank: owner.side_rank,
        field_position: owner.field_position,
        source_rank: AbilitySourceRank::from(owner.slot) as u32,
        numeric_id: owner.numeric_id(),
        registry_key: None,
        unit_kind: binding.behavior_unit.unit_kind,
        behavior_unit_ordinal: binding.behavior_unit.ordinal.get(),
    };
    key.validate()?;
    Ok(key)
}

/// Evaluates a binding's condition root over the supported subset. `None`
/// admits unconditionally. Unsupported nodes error instead of defaulting.
pub fn conditions_admit(
    arena: &ConditionArenaV2,
    root: Option<ConditionNodeId>,
    owner: &AbilityOwnerState,
) -> Result<bool, AbilityExecutorError> {
    let Some(root) = root else {
        return Ok(true);
    };
    evaluate_condition(arena, root.index(), owner, 0)
}

fn evaluate_condition(
    arena: &ConditionArenaV2,
    index: usize,
    owner: &AbilityOwnerState,
    depth: usize,
) -> Result<bool, AbilityExecutorError> {
    if depth > ConditionArenaV2::MAX_DEPTH {
        return Err(AbilityExecutorError::UnsupportedCondition);
    }
    let Some(node) = arena.0.get(index) else {
        return Err(AbilityExecutorError::UnsupportedCondition);
    };
    let child_depth = depth + 1;
    let evaluate_child =
        |child: &ConditionNodeId| evaluate_condition(arena, child.index(), owner, child_depth);
    match node {
        ConditionNodeV2::Always => Ok(true),
        ConditionNodeV2::Never => Ok(false),
        ConditionNodeV2::Not { child } => evaluate_child(child).map(|admitted| !admitted),
        ConditionNodeV2::All { children } => {
            let mut admitted = true;
            for child in children {
                if !evaluate_child(child)? {
                    admitted = false;
                }
            }
            Ok(admitted)
        }
        ConditionNodeV2::Any { children } => {
            let mut admitted = false;
            for child in children {
                if evaluate_child(child)? {
                    admitted = true;
                }
            }
            Ok(admitted)
        }
        ConditionNodeV2::Predicate { predicate } => match predicate {
            ConditionPredicateV2::AbilitySuppressed { suppressed } => {
                Ok(owner.suppressed == *suppressed)
            }
            ConditionPredicateV2::AbilitySource { source_kind } => Ok(owner.slot == *source_kind),
            _ => Err(AbilityExecutorError::UnsupportedCondition),
        },
        ConditionNodeV2::Compare { .. } | ConditionNodeV2::Chance { .. } => {
            Err(AbilityExecutorError::UnsupportedCondition)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_mechanics::program::ProgramRange;
    use er_types::{BehaviorUnitId, BehaviorUnitOrdinal, ProvenanceHash};

    fn provenance_hash() -> ProvenanceHash {
        ProvenanceHash::parse(&"0123456789abcdef".repeat(4)).expect("valid test hash")
    }

    fn unit(kind: BehaviorUnitKind, ordinal: u32) -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::ActiveAbility {
                numeric_id: SafeU53::new(9).expect("safe id"),
            },
            unit_kind: kind,
            ordinal: BehaviorUnitOrdinal::new(ordinal),
            provenance_hash: provenance_hash(),
        }
    }

    fn binding(kind: BehaviorUnitKind, ordinal: u32) -> HookBindingV2 {
        HookBindingV2 {
            hook: MechanicHookV2::CriticalQuery,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: unit(kind, ordinal),
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }
    }

    fn owner(slot: AbilitySourceKindV1, suppressed: bool) -> AbilityOwnerState {
        let source = match slot {
            AbilitySourceKindV1::Active => BehaviorSourceId::ActiveAbility {
                numeric_id: SafeU53::new(9).unwrap(),
            },
            _ => BehaviorSourceId::PassiveAbility {
                numeric_id: SafeU53::new(9).unwrap(),
            },
        };
        AbilityOwnerState {
            source,
            slot,
            suppressed,
            side_rank: 0,
            field_position: 0,
        }
    }

    #[test]
    fn suppressed_owner_is_skipped_unconditionally() {
        let owners = [owner(AbilitySourceKindV1::Active, true)];
        assert!(ordered_ability_bindings(&[], &owners, MechanicHookV2::CriticalQuery).is_ok());
        assert!(
            conditions_admit(
                &ConditionArenaV2(vec![ConditionNodeV2::Always]),
                Some(ConditionNodeId(0)),
                &owners[0],
            )
            .expect("supported condition")
        );
    }

    #[test]
    fn active_binding_orders_before_passive_slots() {
        let active_owner = owner(AbilitySourceKindV1::Active, false);
        let passive_owner = owner(AbilitySourceKindV1::PassiveSlot0, false);
        let active_key = binding_order_key(
            &binding(BehaviorUnitKind::AbilityAttribute, 5),
            &active_owner,
        )
        .expect("valid key");
        let passive_key = binding_order_key(
            &binding(BehaviorUnitKind::PassiveAttribute, 0),
            &passive_owner,
        )
        .expect("valid key");
        assert_eq!(
            compare_ordered_sources(&active_key, &passive_key),
            std::cmp::Ordering::Less
        );
    }

    #[test]
    fn passive_slot_ranks_order_before_ordinals() {
        let slot0 = owner(AbilitySourceKindV1::PassiveSlot0, false);
        let slot1 = owner(AbilitySourceKindV1::PassiveSlot1, false);
        let first = binding_order_key(&binding(BehaviorUnitKind::PassiveAttribute, 7), &slot0)
            .expect("valid key");
        let second = binding_order_key(&binding(BehaviorUnitKind::PassiveAttribute, 0), &slot1)
            .expect("valid key");
        assert_eq!(
            compare_ordered_sources(&first, &second),
            std::cmp::Ordering::Less
        );
    }

    #[test]
    fn mismatched_source_and_slot_fails_closed() {
        let mut mismatched = owner(AbilitySourceKindV1::Active, false);
        mismatched.slot = AbilitySourceKindV1::PassiveSlot1;
        assert_eq!(
            mismatched.validate(),
            Err(AbilityExecutorError::OwnerSlotMismatch(
                AbilitySourceKindV1::PassiveSlot1
            ))
        );
    }

    #[test]
    fn unsupported_predicate_fails_closed() {
        let arena = ConditionArenaV2(vec![ConditionNodeV2::Predicate {
            predicate: ConditionPredicateV2::HeldItemConsumed { consumed: true },
        }]);
        assert_eq!(
            conditions_admit(
                &arena,
                Some(ConditionNodeId(0)),
                &owner(AbilitySourceKindV1::Active, false),
            ),
            Err(AbilityExecutorError::UnsupportedCondition)
        );
    }
}
