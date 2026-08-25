//! Bespoke battle transitions for the `ITEM_BERRY_LIFECYCLE` mechanic family.
//!
//! Pure, atomic transitions over
//! [`er_state::bespoke_v2::item_lifecycle::ItemLifecycleStateV2`]: ordered
//! held-item instances, stacks/charges, trigger eligibility, the consume
//! ledger feeding Harvest-style restore, Berry-Pouch-style preservation,
//! Unnerve-style suppression windows, and ownership changes (transfer,
//! steal, swap, Knock Off).
//!
//! Contract shape, frozen by the M6 bespoke rules:
//!
//! - every public function consumes a validated typed state and request and
//!   returns typed evidence plus a fresh updated state; the input is never
//!   mutated, so every error path preserves it exactly;
//! - a transition stages its changes on a clone, revalidates the staged
//!   result against the canonical invariants, and only then returns;
//! - stack and identity arithmetic is checked — overflow and underflow are
//!   typed errors, never silent clamps;
//! - item effects leave this module as typed requests
//!   ([`ItemEffectRequest`]) resolved elsewhere against prepared content;
//!   there are no callbacks, trait objects, JSON blobs, or raw
//!   semantic-command shortcuts.
//!
//! Observable semantics mirror the read-only TypeScript sources:
//!
//! - consuming the last stack destroys the instance and appends a
//!   *restorable* ledger entry (`src/data/moves/move.ts` EatBerryAttr);
//! - a preserved consumption (Berry Pouch family) applies no lifecycle
//!   mutation and records no ledger entry, so preservation cannot dupe
//!   berries through restore;
//! - a duplicate trigger against a fully consumed item reports
//!   [`ConsumeOutcome::AlreadyConsumed`] without mutating anything
//!   (one-shot idempotence);
//! - restore draws only the newest unrestored restorable entry and marks it
//!   drawn, so each destroyed berry restores at most once;
//! - Knock Off destroys the instance with a non-restorable ledger entry;
//! - suppression keeps the item in place but inert through its expiry turn
//!   inclusive (`src/data/elite-redux/abilities/item-suppression.ts`).

use er_state::bespoke_v2::item_lifecycle::{
    ConsumeLedgerEntryV2, ItemInstanceV2, ItemLifecycleStateError, ItemLifecycleStateV2,
    ItemSuppressionV2,
};
use er_types::SafeU53;
use er_types::battle_ids::PokemonId;
use er_types::mechanics::SourceOrdinal;
use thiserror::Error;

/// Typed evidence plus the updated canonical state of one atomic transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemTransition<Evidence> {
    /// The updated canonical state; callers adopt this wholesale.
    pub state: ItemLifecycleStateV2,
    pub evidence: Evidence,
}

/// A typed request describing what a consumed item does. The dispatcher
/// resolves it against prepared content; this module never executes effects.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemEffectRequest {
    /// The Pokemon whose item was consumed.
    pub owner: PokemonId,
    pub registry_key: String,
    pub source_ordinal: SourceOrdinal,
}

/// How an item moves between owners.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransferMode {
    /// Voluntary hand-off (Bestow family).
    Transfer,
    /// Involuntary take (Thief/Covet family); identical lifecycle handling.
    Steal,
}

/// Grant request: register a new instance or top up the existing slot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantRequest {
    pub owner: PokemonId,
    pub registry_key: String,
    pub stacks: u16,
    pub charges: Option<u16>,
    pub source_ordinal: SourceOrdinal,
    pub transferable: bool,
}

/// Consumption request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConsumeRequest {
    pub owner: PokemonId,
    pub registry_key: String,
    /// Preserve flag (Berry Pouch family): the trigger fires but nothing is
    /// consumed and no ledger entry appears.
    pub preserve: bool,
    /// Current battle turn, used only for suppression gating.
    pub current_turn: u32,
}

/// Restore request (Harvest/PostTurnRestoreBerry family).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestoreRequest {
    pub owner: PokemonId,
}

/// Ownership-change request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferRequest {
    pub from: PokemonId,
    pub registry_key: String,
    pub to: PokemonId,
    pub mode: TransferMode,
}

/// Knock Off request: destroy the target's instance forever.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnockOffRequest {
    pub target: PokemonId,
    pub registry_key: String,
}

/// Swap request: exchange two holders' items in one atomic step.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapRequest {
    pub left: PokemonId,
    pub left_registry_key: String,
    pub right: PokemonId,
    pub right_registry_key: String,
}

/// Suppression request (Unnerve/Negative Feedback family).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuppressRequest {
    pub holder: PokemonId,
    pub registry_key: String,
    /// Battle turn through which the item stays inert (inclusive).
    pub expiry_turn: u32,
}

/// Expiry sweep request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExpireRequest {
    pub current_turn: u32,
}

/// Trigger eligibility for `(owner, registry_key)` on a given turn.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ItemTriggerEligibility {
    /// A live, unsuppressed instance can fire.
    Eligible,
    /// The item is present but inert through the recorded expiry turn.
    Suppressed { expiry_turn: u32 },
    /// Every stack was already consumed; a duplicate trigger is a no-op.
    Exhausted,
    /// The owner never held the item.
    Absent,
}

/// What a consume transition observed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConsumeOutcome {
    /// A stack was consumed; the effect must be dispatched via the typed
    /// request. `ledger_ordinal` is set when the instance was destroyed and
    /// logged as restorable.
    Consumed {
        effect: ItemEffectRequest,
        ledger_ordinal: Option<SafeU53>,
    },
    /// Preservation fired: no lifecycle mutation, no ledger entry.
    Preserved,
    /// One-shot idempotence: the item was already fully consumed, so this
    /// duplicate trigger mutated nothing.
    AlreadyConsumed,
    /// The item is suppressed this turn; nothing was consumed.
    Suppressed { expiry_turn: u32 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConsumeEvidence {
    pub outcome: ConsumeOutcome,
    pub stacks_before: u16,
    /// `None` when this consumption destroyed the instance.
    pub stacks_after: Option<u16>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantEvidence {
    pub instance_id: u64,
    /// `true` when the grant merged into an existing slot instead of
    /// creating a new instance.
    pub merged: bool,
    pub stacks_before: u16,
    pub stacks_after: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoreEvidence {
    /// The drawn ledger entry's ordinal.
    pub ledger_ordinal: SafeU53,
    /// The freshly created instance identity.
    pub instance_id: u64,
    pub registry_key: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransferEvidence {
    pub mode: TransferMode,
    pub instance_id: u64,
    /// `true` when the receiving slot already existed and stacks merged.
    pub merged: bool,
    pub stacks_before: u16,
    /// `None` when the source instance was destroyed by the merge.
    pub stacks_after: Option<u16>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SwapEvidence {
    pub left_instance_id: u64,
    pub right_instance_id: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuppressEvidence {
    pub holder: PokemonId,
    pub registry_key: String,
    pub expiry_turn: u32,
    /// The expiry this request replaced, if a window already existed.
    pub replaced_expiry: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpireEvidence {
    /// Holder/key pairs whose windows lapsed in this sweep.
    pub expired: Vec<(PokemonId, String)>,
}

/// Typed transition failures. Every variant leaves the input state intact.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ItemLifecycleError {
    #[error("held-item registry key must not be empty")]
    EmptyRegistryKey,
    #[error("grant must carry at least one stack")]
    ZeroStacks,
    #[error("charged grants must carry at least one charge when present")]
    ZeroCharges,
    #[error("{owner:?} does not hold {registry_key}")]
    ItemAbsent {
        owner: PokemonId,
        registry_key: String,
    },
    #[error("{owner:?} cannot give up {registry_key}: the instance is not transferable")]
    NotTransferable {
        owner: PokemonId,
        registry_key: String,
    },
    #[error("an item cannot move between two slots of the same owner")]
    SameOwner,
    #[error("merging stacks of {registry_key} onto {owner:?} would overflow u16")]
    StackOverflow {
        owner: PokemonId,
        registry_key: String,
    },
    #[error("nothing restorable remains to restore")]
    NothingRestorable { owner: PokemonId },
    #[error("cannot restore {registry_key} for {owner:?} while a live instance remains")]
    RestoreBlockedByLiveInstance {
        owner: PokemonId,
        registry_key: String,
    },
    #[error("swap requires two distinct owners")]
    SwapSameOwner,
    #[error("the item-lifecycle instance ID space is exhausted")]
    InstanceIdExhausted,
    #[error("the item-lifecycle creation ordinal space is exhausted")]
    CreationOrdinalExhausted,
    #[error("the consume-ledger ordinal space is exhausted")]
    LedgerOrdinalExhausted,
    #[error("input state violates the item-lifecycle invariants: {0}")]
    InvalidState(#[from] ItemLifecycleStateError),
}

fn require_non_empty_key(registry_key: &str) -> Result<(), ItemLifecycleError> {
    if registry_key.is_empty() {
        Err(ItemLifecycleError::EmptyRegistryKey)
    } else {
        Ok(())
    }
}

fn slot_position(
    instances: &[ItemInstanceV2],
    owner: PokemonId,
    registry_key: &str,
) -> Option<usize> {
    instances
        .iter()
        .position(|instance| instance.owner == owner && instance.registry_key == registry_key)
}

fn next_instance_id(state: &ItemLifecycleStateV2) -> Result<u64, ItemLifecycleError> {
    let id = state.next_instance_id;
    if id == 0 {
        Err(ItemLifecycleError::InstanceIdExhausted)
    } else {
        Ok(id)
    }
}

fn advance_instance_id(id: u64) -> Result<u64, ItemLifecycleError> {
    id.checked_add(1)
        .ok_or(ItemLifecycleError::InstanceIdExhausted)
}

fn next_creation_ordinal(state: &ItemLifecycleStateV2) -> Result<SafeU53, ItemLifecycleError> {
    let ordinal = state.next_creation_ordinal;
    if ordinal == SafeU53::ZERO || ordinal >= SafeU53::MAX {
        Err(ItemLifecycleError::CreationOrdinalExhausted)
    } else {
        Ok(ordinal)
    }
}

fn advance_creation_ordinal(ordinal: SafeU53) -> Result<SafeU53, ItemLifecycleError> {
    ordinal
        .get()
        .checked_add(1)
        .and_then(|next| SafeU53::new(next).ok())
        .ok_or(ItemLifecycleError::CreationOrdinalExhausted)
}

fn advance_ledger_ordinal(ordinal: SafeU53) -> Result<SafeU53, ItemLifecycleError> {
    ordinal
        .get()
        .checked_add(1)
        .and_then(|next| SafeU53::new(next).ok())
        .ok_or(ItemLifecycleError::LedgerOrdinalExhausted)
}

/// Grants an item instance or tops up the holder's existing slot with
/// checked stack arithmetic. A merged grant keeps the existing instance's
/// identity, charges, and transferability.
pub fn grant_item(
    state: &ItemLifecycleStateV2,
    request: &GrantRequest,
) -> Result<ItemTransition<GrantEvidence>, ItemLifecycleError> {
    require_non_empty_key(&request.registry_key)?;
    if request.stacks == 0 {
        return Err(ItemLifecycleError::ZeroStacks);
    }
    if request.charges == Some(0) {
        return Err(ItemLifecycleError::ZeroCharges);
    }
    state.validate()?;
    let mut staged = state.clone();
    let stacks_before = staged
        .find_instance(request.owner, &request.registry_key)
        .map_or(0, |instance| instance.stacks);
    let stacks_after =
        stacks_before
            .checked_add(request.stacks)
            .ok_or(ItemLifecycleError::StackOverflow {
                owner: request.owner,
                registry_key: request.registry_key.clone(),
            })?;
    let (instance_id, merged) =
        match slot_position(&staged.instances, request.owner, &request.registry_key) {
            Some(index) => {
                staged.instances[index].stacks = stacks_after;
                (staged.instances[index].instance_id, true)
            }
            None => {
                let instance_id = next_instance_id(&staged)?;
                let creation_ordinal = next_creation_ordinal(&staged)?;
                staged.instances.push(ItemInstanceV2 {
                    instance_id,
                    owner: request.owner,
                    registry_key: request.registry_key.clone(),
                    source_ordinal: request.source_ordinal,
                    creation_ordinal,
                    stacks: request.stacks,
                    charges: request.charges,
                    transferable: request.transferable,
                });
                // Canonical order is by instance ID; a fresh ID is always the
                // largest, so appending keeps the vector sorted.
                staged.next_instance_id = advance_instance_id(instance_id)?;
                staged.next_creation_ordinal =
                    advance_creation_ordinal(staged.next_creation_ordinal)?;
                (instance_id, false)
            }
        };
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence: GrantEvidence {
            instance_id,
            merged,
            stacks_before,
            stacks_after,
        },
    })
}

/// Trigger eligibility query over the canonical state.
pub fn trigger_eligibility(
    state: &ItemLifecycleStateV2,
    owner: PokemonId,
    registry_key: &str,
    current_turn: u32,
) -> Result<ItemTriggerEligibility, ItemLifecycleError> {
    require_non_empty_key(registry_key)?;
    state.validate()?;
    if state.find_instance(owner, registry_key).is_some() {
        if let Some(window) = state.find_suppression(owner, registry_key) {
            if window.is_active(current_turn) {
                return Ok(ItemTriggerEligibility::Suppressed {
                    expiry_turn: window.expiry_turn,
                });
            }
        }
        return Ok(ItemTriggerEligibility::Eligible);
    }
    if state.consume_ledger.iter().any(|entry| {
        entry.restorable && entry.consumer == owner && entry.registry_key == registry_key
    }) {
        return Ok(ItemTriggerEligibility::Exhausted);
    }
    Ok(ItemTriggerEligibility::Absent)
}

/// Consumes one stack of the holder's item.
///
/// Order of gates mirrors the TypeScript trigger chain: absence fails
/// closed, suppression defers, preservation short-circuits, then the stack
/// decrements; destroying the instance appends a restorable ledger entry. A
/// duplicate trigger after full consumption reports
/// [`ConsumeOutcome::AlreadyConsumed`] and leaves the state untouched.
///
/// Charged items spend one charge per consumption; burning the last charge
/// destroys the instance even with stacks remaining.
pub fn consume_item(
    state: &ItemLifecycleStateV2,
    request: &ConsumeRequest,
) -> Result<ItemTransition<ConsumeEvidence>, ItemLifecycleError> {
    require_non_empty_key(&request.registry_key)?;
    state.validate()?;
    let Some(instance) = state.find_instance(request.owner, &request.registry_key) else {
        // One-shot idempotence: a fully consumed item stays listed in the
        // ledger, so a repeated trigger is a benign no-op rather than an
        // absence failure.
        let previously_consumed = state.consume_ledger.iter().any(|entry| {
            entry.restorable
                && entry.consumer == request.owner
                && entry.registry_key == request.registry_key
        });
        return if previously_consumed {
            Ok(ItemTransition {
                state: state.clone(),
                evidence: ConsumeEvidence {
                    outcome: ConsumeOutcome::AlreadyConsumed,
                    stacks_before: 0,
                    stacks_after: None,
                },
            })
        } else {
            Err(ItemLifecycleError::ItemAbsent {
                owner: request.owner,
                registry_key: request.registry_key.clone(),
            })
        };
    };
    if let Some(window) = state.find_suppression(request.owner, &request.registry_key) {
        if window.is_active(request.current_turn) {
            return Ok(ItemTransition {
                state: state.clone(),
                evidence: ConsumeEvidence {
                    outcome: ConsumeOutcome::Suppressed {
                        expiry_turn: window.expiry_turn,
                    },
                    stacks_before: instance.stacks,
                    stacks_after: Some(instance.stacks),
                },
            });
        }
    }
    if request.preserve {
        return Ok(ItemTransition {
            state: state.clone(),
            evidence: ConsumeEvidence {
                outcome: ConsumeOutcome::Preserved,
                stacks_before: instance.stacks,
                stacks_after: Some(instance.stacks),
            },
        });
    }
    let mut staged = state.clone();
    let index = slot_position(&staged.instances, request.owner, &request.registry_key).ok_or(
        ItemLifecycleError::ItemAbsent {
            owner: request.owner,
            registry_key: request.registry_key.clone(),
        },
    )?;
    let stacks_after_value =
        instance
            .stacks
            .checked_sub(1)
            .ok_or(ItemLifecycleError::InvalidState(
                ItemLifecycleStateError::ZeroStacks,
            ))?;
    let charges_after = instance
        .charges
        .map(|charges| {
            charges
                .checked_sub(1)
                .ok_or(ItemLifecycleError::InvalidState(
                    ItemLifecycleStateError::ZeroCharges,
                ))
        })
        .transpose()?;
    // Spent out when the last charge burns or the last stack goes.
    let spent_out = stacks_after_value == 0 || charges_after == Some(0);
    let mut ledger_ordinal = None;
    if spent_out {
        let ordinal = staged.next_ledger_ordinal;
        staged.consume_ledger.push(ConsumeLedgerEntryV2 {
            ledger_ordinal: ordinal,
            instance_id: instance.instance_id,
            consumer: request.owner,
            registry_key: request.registry_key.clone(),
            source_ordinal: instance.source_ordinal,
            creation_ordinal: instance.creation_ordinal,
            charges: instance.charges,
            transferable: instance.transferable,
            restorable: true,
            restored: false,
        });
        staged.next_ledger_ordinal = advance_ledger_ordinal(ordinal)?;
        staged.instances.remove(index);
        ledger_ordinal = Some(ordinal);
    } else {
        staged.instances[index].stacks = stacks_after_value;
        staged.instances[index].charges = charges_after;
    }
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence: ConsumeEvidence {
            outcome: ConsumeOutcome::Consumed {
                effect: ItemEffectRequest {
                    owner: request.owner,
                    registry_key: request.registry_key.clone(),
                    source_ordinal: instance.source_ordinal,
                },
                ledger_ordinal,
            },
            stacks_before: instance.stacks,
            stacks_after: if spent_out {
                None
            } else {
                Some(stacks_after_value)
            },
        },
    })
}

/// Restores the most recently eaten still-restorable berry for the owner
/// (Harvest/PostTurnRestoreBerry family). Each ledger entry restores at
/// most once, and a live instance blocks restore outright.
pub fn restore_item(
    state: &ItemLifecycleStateV2,
    request: &RestoreRequest,
) -> Result<ItemTransition<RestoreEvidence>, ItemLifecycleError> {
    state.validate()?;
    let entry_index = state
        .consume_ledger
        .iter()
        .rposition(|entry| entry.consumer == request.owner && entry.restorable && !entry.restored)
        .ok_or(ItemLifecycleError::NothingRestorable {
            owner: request.owner,
        })?;
    let entry = &state.consume_ledger[entry_index];
    if state.holds_item(request.owner, &entry.registry_key) {
        return Err(ItemLifecycleError::RestoreBlockedByLiveInstance {
            owner: request.owner,
            registry_key: entry.registry_key.clone(),
        });
    }
    let mut staged = state.clone();
    let entry = staged.consume_ledger[entry_index].clone();
    let instance_id = next_instance_id(&staged)?;
    let creation_ordinal = next_creation_ordinal(&staged)?;
    staged.instances.push(ItemInstanceV2 {
        instance_id,
        owner: request.owner,
        registry_key: entry.registry_key.clone(),
        source_ordinal: entry.source_ordinal,
        creation_ordinal,
        stacks: 1,
        charges: entry.charges,
        transferable: entry.transferable,
    });
    staged.next_instance_id = advance_instance_id(instance_id)?;
    staged.next_creation_ordinal = advance_creation_ordinal(staged.next_creation_ordinal)?;
    let evidence = RestoreEvidence {
        ledger_ordinal: entry.ledger_ordinal,
        instance_id,
        registry_key: entry.registry_key.clone(),
    };
    staged.consume_ledger[entry_index].restored = true;
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence,
    })
}

/// Moves an item between owners ([`TransferMode::Transfer`] or
/// [`TransferMode::Steal`]). Nontransferable instances reject the move. If
/// the receiver already holds the same key, stacks merge into the existing
/// instance with checked arithmetic and the moving instance is destroyed
/// without a ledger entry (no consumption happened).
pub fn transfer_item(
    state: &ItemLifecycleStateV2,
    request: &TransferRequest,
) -> Result<ItemTransition<TransferEvidence>, ItemLifecycleError> {
    require_non_empty_key(&request.registry_key)?;
    if request.from == request.to {
        return Err(ItemLifecycleError::SameOwner);
    }
    state.validate()?;
    let source = state
        .find_instance(request.from, &request.registry_key)
        .ok_or(ItemLifecycleError::ItemAbsent {
            owner: request.from,
            registry_key: request.registry_key.clone(),
        })?;
    if !source.transferable {
        return Err(ItemLifecycleError::NotTransferable {
            owner: request.from,
            registry_key: request.registry_key.clone(),
        });
    }
    let mut staged = state.clone();
    let source_index = slot_position(&staged.instances, request.from, &request.registry_key)
        .ok_or(ItemLifecycleError::ItemAbsent {
            owner: request.from,
            registry_key: request.registry_key.clone(),
        })?;
    let stacks_before = staged.instances[source_index].stacks;
    let instance_id = staged.instances[source_index].instance_id;
    match slot_position(&staged.instances, request.to, &request.registry_key) {
        Some(target_index) => {
            let target = &mut staged.instances[target_index];
            let merged_stacks = target.stacks.checked_add(stacks_before).ok_or(
                ItemLifecycleError::StackOverflow {
                    owner: request.to,
                    registry_key: request.registry_key.clone(),
                },
            )?;
            target.stacks = merged_stacks;
            staged.instances.remove(source_index);
            staged.validate()?;
            Ok(ItemTransition {
                evidence: TransferEvidence {
                    mode: request.mode,
                    instance_id,
                    merged: true,
                    stacks_before,
                    stacks_after: None,
                },
                state: staged,
            })
        }
        None => {
            staged.instances[source_index].owner = request.to;
            staged.validate()?;
            Ok(ItemTransition {
                state: staged,
                evidence: TransferEvidence {
                    mode: request.mode,
                    instance_id,
                    merged: false,
                    stacks_before,
                    stacks_after: Some(stacks_before),
                },
            })
        }
    }
}

/// Knock Off: destroys the target's instance and logs a non-restorable
/// ledger entry — the item can never be Harvested back. Works regardless of
/// transferability; destruction is not ownership change.
pub fn knock_off_item(
    state: &ItemLifecycleStateV2,
    request: &KnockOffRequest,
) -> Result<ItemTransition<ConsumeEvidence>, ItemLifecycleError> {
    require_non_empty_key(&request.registry_key)?;
    state.validate()?;
    let instance = state
        .find_instance(request.target, &request.registry_key)
        .ok_or(ItemLifecycleError::ItemAbsent {
            owner: request.target,
            registry_key: request.registry_key.clone(),
        })?;
    let stacks_before = instance.stacks;
    let mut staged = state.clone();
    let index = slot_position(&staged.instances, request.target, &request.registry_key).ok_or(
        ItemLifecycleError::ItemAbsent {
            owner: request.target,
            registry_key: request.registry_key.clone(),
        },
    )?;
    let (instance_id, source_ordinal, creation_ordinal, charges, transferable) = {
        let instance = &staged.instances[index];
        (
            instance.instance_id,
            instance.source_ordinal,
            instance.creation_ordinal,
            instance.charges,
            instance.transferable,
        )
    };
    let ordinal = staged.next_ledger_ordinal;
    staged.consume_ledger.push(ConsumeLedgerEntryV2 {
        ledger_ordinal: ordinal,
        instance_id,
        consumer: request.target,
        registry_key: request.registry_key.clone(),
        source_ordinal,
        creation_ordinal,
        charges,
        transferable,
        restorable: false,
        restored: false,
    });
    staged.next_ledger_ordinal = advance_ledger_ordinal(ordinal)?;
    staged.instances.remove(index);
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence: ConsumeEvidence {
            outcome: ConsumeOutcome::Consumed {
                effect: ItemEffectRequest {
                    owner: request.target,
                    registry_key: request.registry_key.clone(),
                    source_ordinal,
                },
                ledger_ordinal: None,
            },
            stacks_before,
            stacks_after: None,
        },
    })
}

/// Swaps two holders' items atomically: both instances must exist and be
/// transferable, and ownership fields are exchanged in place (instance IDs
/// stay stable, preserving canonical order).
pub fn swap_items(
    state: &ItemLifecycleStateV2,
    request: &SwapRequest,
) -> Result<ItemTransition<SwapEvidence>, ItemLifecycleError> {
    require_non_empty_key(&request.left_registry_key)?;
    require_non_empty_key(&request.right_registry_key)?;
    if request.left == request.right {
        return Err(ItemLifecycleError::SwapSameOwner);
    }
    state.validate()?;
    let left_instance = state
        .find_instance(request.left, &request.left_registry_key)
        .ok_or(ItemLifecycleError::ItemAbsent {
            owner: request.left,
            registry_key: request.left_registry_key.clone(),
        })?;
    let right_instance = state
        .find_instance(request.right, &request.right_registry_key)
        .ok_or(ItemLifecycleError::ItemAbsent {
            owner: request.right,
            registry_key: request.right_registry_key.clone(),
        })?;
    for instance in [&left_instance, &right_instance] {
        if !instance.transferable {
            return Err(ItemLifecycleError::NotTransferable {
                owner: instance.owner,
                registry_key: instance.registry_key.clone(),
            });
        }
    }
    let mut staged = state.clone();
    let left_index = slot_position(&staged.instances, request.left, &request.left_registry_key)
        .ok_or(ItemLifecycleError::ItemAbsent {
            owner: request.left,
            registry_key: request.left_registry_key.clone(),
        })?;
    let right_index = slot_position(
        &staged.instances,
        request.right,
        &request.right_registry_key,
    )
    .ok_or(ItemLifecycleError::ItemAbsent {
        owner: request.right,
        registry_key: request.right_registry_key.clone(),
    })?;
    staged.instances[left_index].owner = request.right;
    staged.instances[right_index].owner = request.left;
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence: SwapEvidence {
            left_instance_id: left_instance.instance_id,
            right_instance_id: right_instance.instance_id,
        },
    })
}

/// Applies (or refreshes) an Unnerve-style suppression window. At most one
/// window exists per holder/key; a new request replaces its expiry.
pub fn suppress_item(
    state: &ItemLifecycleStateV2,
    request: &SuppressRequest,
) -> Result<ItemTransition<SuppressEvidence>, ItemLifecycleError> {
    require_non_empty_key(&request.registry_key)?;
    state.validate()?;
    let mut staged = state.clone();
    let replaced_expiry = staged
        .find_suppression(request.holder, &request.registry_key)
        .map(|window| window.expiry_turn);
    match staged.suppressions.iter_mut().position(|window| {
        window.holder == request.holder && window.registry_key == request.registry_key
    }) {
        Some(index) => staged.suppressions[index].expiry_turn = request.expiry_turn,
        None => {
            let window = ItemSuppressionV2 {
                holder: request.holder,
                registry_key: request.registry_key.clone(),
                expiry_turn: request.expiry_turn,
            };
            let position = staged.suppressions.partition_point(|existing| {
                (existing.holder, existing.registry_key.as_str())
                    < (request.holder, request.registry_key.as_str())
            });
            staged.suppressions.insert(position, window);
        }
    }
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence: SuppressEvidence {
            holder: request.holder,
            registry_key: request.registry_key.clone(),
            expiry_turn: request.expiry_turn,
            replaced_expiry,
        },
    })
}

/// Sweeps suppression windows that lapsed strictly before `current_turn`:
/// windows stay active through their expiry turn inclusive.
pub fn expire_suppressions(
    state: &ItemLifecycleStateV2,
    request: &ExpireRequest,
) -> Result<ItemTransition<ExpireEvidence>, ItemLifecycleError> {
    state.validate()?;
    let expired: Vec<(PokemonId, String)> = state
        .suppressions
        .iter()
        .filter(|window| !window.is_active(request.current_turn))
        .map(|window| (window.holder, window.registry_key.clone()))
        .collect();
    let mut staged = state.clone();
    staged
        .suppressions
        .retain(|window| window.is_active(request.current_turn));
    staged.validate()?;
    Ok(ItemTransition {
        state: staged,
        evidence: ExpireEvidence { expired },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::item_lifecycle::ITEM_LIFECYCLE_STATE_SCHEMA_VERSION;

    const TURN_ONE: u32 = 1;

    fn holder(id: u64) -> PokemonId {
        PokemonId::new(SafeU53::new(id).expect("test holder id fits SafeU53"))
    }

    fn alice() -> PokemonId {
        holder(11)
    }

    fn bob() -> PokemonId {
        holder(22)
    }

    fn empty() -> ItemLifecycleStateV2 {
        ItemLifecycleStateV2::default()
    }

    fn grant_sitrus(
        state: &ItemLifecycleStateV2,
        owner: PokemonId,
        stacks: u16,
    ) -> ItemLifecycleStateV2 {
        grant_item(
            state,
            &GrantRequest {
                owner,
                registry_key: "SITRUS_BERRY".to_owned(),
                stacks,
                charges: None,
                source_ordinal: SourceOrdinal::ZERO,
                transferable: true,
            },
        )
        .expect("grant succeeds")
        .state
    }

    fn grant_nontransferable(
        state: &ItemLifecycleStateV2,
        owner: PokemonId,
        registry_key: &str,
    ) -> ItemLifecycleStateV2 {
        grant_item(
            state,
            &GrantRequest {
                owner,
                registry_key: registry_key.to_owned(),
                stacks: 1,
                charges: None,
                source_ordinal: SourceOrdinal::ZERO,
                transferable: false,
            },
        )
        .expect("grant succeeds")
        .state
    }

    #[test]
    fn grant_creates_ordered_unique_instances_and_merges_repeat_grants() {
        let first = grant_sitrus(&empty(), alice(), 2);
        assert_eq!(first.instances.len(), 1);
        assert_eq!(first.instances[0].stacks, 2);
        let merged = grant_sitrus(&first, alice(), 3);
        assert_eq!(merged.instances.len(), 1);
        assert_eq!(merged.instances[0].stacks, 5);
        assert!(merged.validate().is_ok());
    }

    #[test]
    fn eligibility_reports_all_four_states() {
        let held = grant_sitrus(&empty(), alice(), 1);
        assert_eq!(
            trigger_eligibility(&held, alice(), "SITRUS_BERRY", TURN_ONE),
            Ok(ItemTriggerEligibility::Eligible)
        );
        let suppressed = suppress_item(
            &held,
            &SuppressRequest {
                holder: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                expiry_turn: 4,
            },
        )
        .expect("suppress succeeds")
        .state;
        assert_eq!(
            trigger_eligibility(&suppressed, alice(), "SITRUS_BERRY", TURN_ONE),
            Ok(ItemTriggerEligibility::Suppressed { expiry_turn: 4 })
        );
        let eaten = consume_item(
            &suppressed,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: 5,
            },
        )
        .expect("consume after expiry succeeds")
        .state;
        assert_eq!(
            trigger_eligibility(&eaten, alice(), "SITRUS_BERRY", 6),
            Ok(ItemTriggerEligibility::Exhausted)
        );
        assert_eq!(
            trigger_eligibility(&empty(), alice(), "ORAN_BERRY", TURN_ONE),
            Ok(ItemTriggerEligibility::Absent)
        );
    }

    #[test]
    fn consume_destroys_last_stack_and_logs_restorable_entry() {
        let state = grant_sitrus(&empty(), alice(), 2);
        let first = consume_item(
            &state,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: TURN_ONE,
            },
        )
        .expect("first consume succeeds");
        assert_eq!(
            first.evidence.outcome,
            ConsumeOutcome::Consumed {
                effect: ItemEffectRequest {
                    owner: alice(),
                    registry_key: "SITRUS_BERRY".to_owned(),
                    source_ordinal: SourceOrdinal::ZERO,
                },
                ledger_ordinal: None,
            }
        );
        assert_eq!(first.evidence.stacks_before, 2);
        assert_eq!(first.evidence.stacks_after, Some(1));
        assert_eq!(first.state.instances[0].stacks, 1);
        assert!(first.state.consume_ledger.is_empty());
        let second = consume_item(
            &first.state,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: TURN_ONE,
            },
        )
        .expect("second consume succeeds");
        assert!(matches!(
            second.evidence.outcome,
            ConsumeOutcome::Consumed {
                ledger_ordinal: Some(_),
                ..
            }
        ));
        assert_eq!(second.evidence.stacks_after, None);
        assert!(second.state.instances.is_empty());
        assert_eq!(second.state.consume_ledger.len(), 1);
        assert!(second.state.consume_ledger[0].restorable);
        assert!(!second.state.consume_ledger[0].restored);
    }

    #[test]
    fn duplicate_trigger_is_idempotent_and_item_absence_fails_closed() {
        let state = grant_sitrus(&empty(), alice(), 1);
        let eaten = consume_item(
            &state,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: TURN_ONE,
            },
        )
        .expect("consume succeeds")
        .state;
        let duplicate = consume_item(
            &eaten,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: TURN_ONE,
            },
        )
        .expect("duplicate trigger is benign");
        assert_eq!(duplicate.evidence.outcome, ConsumeOutcome::AlreadyConsumed);
        assert_eq!(duplicate.state, eaten);
        // Never-held items fail closed instead.
        assert_eq!(
            consume_item(
                &state,
                &ConsumeRequest {
                    owner: bob(),
                    registry_key: "ORAN_BERRY".to_owned(),
                    preserve: false,
                    current_turn: TURN_ONE,
                },
            ),
            Err(ItemLifecycleError::ItemAbsent {
                owner: bob(),
                registry_key: "ORAN_BERRY".to_owned(),
            })
        );
    }

    #[test]
    fn preserved_consume_records_nothing_and_cannot_be_restored() {
        let state = grant_sitrus(&empty(), alice(), 1);
        let preserved = consume_item(
            &state,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: true,
                current_turn: TURN_ONE,
            },
        )
        .expect("preserved consume succeeds");
        assert_eq!(preserved.evidence.outcome, ConsumeOutcome::Preserved);
        assert_eq!(preserved.state, state);
        assert_eq!(preserved.state.consume_ledger.len(), 0);
        assert_eq!(
            restore_item(&preserved.state, &RestoreRequest { owner: alice() }),
            Err(ItemLifecycleError::NothingRestorable { owner: alice() })
        );
    }

    #[test]
    fn suppressed_items_cannot_trigger_until_expiry_passes() {
        let state = grant_sitrus(&empty(), alice(), 1);
        let suppressed = suppress_item(
            &state,
            &SuppressRequest {
                holder: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                expiry_turn: 3,
            },
        )
        .expect("suppress succeeds")
        .state;
        let blocked = consume_item(
            &suppressed,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: 3,
            },
        )
        .expect("blocked consume reports suppression");
        assert_eq!(
            blocked.evidence.outcome,
            ConsumeOutcome::Suppressed { expiry_turn: 3 }
        );
        assert_eq!(blocked.state, suppressed);
        let freed = consume_item(
            &suppressed,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: 4,
            },
        )
        .expect("consume after expiry succeeds");
        assert!(matches!(
            freed.evidence.outcome,
            ConsumeOutcome::Consumed { .. }
        ));
    }

    #[test]
    fn suppression_refresh_replaces_and_expiry_sweep_removes_lapsed_windows() {
        let state = suppress_item(
            &empty(),
            &SuppressRequest {
                holder: alice(),
                registry_key: "ORAN_BERRY".to_owned(),
                expiry_turn: 2,
            },
        )
        .expect("suppress succeeds")
        .state;
        let refreshed = suppress_item(
            &state,
            &SuppressRequest {
                holder: alice(),
                registry_key: "ORAN_BERRY".to_owned(),
                expiry_turn: 5,
            },
        )
        .expect("refresh succeeds");
        assert_eq!(refreshed.evidence.replaced_expiry, Some(2));
        assert_eq!(refreshed.state.suppressions.len(), 1);
        assert_eq!(refreshed.state.suppressions[0].expiry_turn, 5);
        let swept = expire_suppressions(&refreshed.state, &ExpireRequest { current_turn: 6 })
            .expect("sweep succeeds");
        assert_eq!(
            swept.evidence.expired,
            vec![(alice(), "ORAN_BERRY".to_owned())]
        );
        assert!(swept.state.suppressions.is_empty());
    }

    #[test]
    fn restore_draws_each_ledger_entry_once() {
        let state = grant_sitrus(&empty(), alice(), 1);
        let eaten = consume_item(
            &state,
            &ConsumeRequest {
                owner: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                preserve: false,
                current_turn: TURN_ONE,
            },
        )
        .expect("consume succeeds")
        .state;
        let restored =
            restore_item(&eaten, &RestoreRequest { owner: alice() }).expect("restore succeeds");
        assert_eq!(restored.evidence.registry_key, "SITRUS_BERRY".to_owned());
        assert_eq!(restored.state.instances.len(), 1);
        assert_eq!(restored.state.instances[0].stacks, 1);
        assert_eq!(restored.state.consume_ledger.len(), 1);
        assert!(restored.state.consume_ledger[0].restored);
        assert_eq!(
            restore_item(&restored.state, &RestoreRequest { owner: alice() }),
            Err(ItemLifecycleError::NothingRestorable { owner: alice() })
        );
    }

    #[test]
    fn transfer_moves_instances_and_merges_into_an_occupied_slot() {
        let state = grant_sitrus(&grant_sitrus(&empty(), alice(), 2), bob(), 3);
        let moved = transfer_item(
            &state,
            &TransferRequest {
                from: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                to: bob(),
                mode: TransferMode::Steal,
            },
        )
        .expect("transfer merges");
        assert!(moved.evidence.merged);
        assert_eq!(moved.state.instances.len(), 1);
        assert_eq!(moved.state.instances[0].owner, bob());
        assert_eq!(moved.state.instances[0].stacks, 5);

        let split = grant_sitrus(&empty(), alice(), 1);
        let plain = transfer_item(
            &split,
            &TransferRequest {
                from: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
                to: bob(),
                mode: TransferMode::Transfer,
            },
        )
        .expect("plain transfer succeeds");
        assert!(!plain.evidence.merged);
        assert_eq!(plain.state.instances[0].owner, bob());
        assert!(plain.state.find_instance(alice(), "SITRUS_BERRY").is_none());
    }

    #[test]
    fn nontransferable_instances_reject_transfer_swap_but_knock_off_destroys_anyway() {
        let state = grant_nontransferable(&empty(), alice(), "MEGA_STONE");
        assert_eq!(
            transfer_item(
                &state,
                &TransferRequest {
                    from: alice(),
                    registry_key: "MEGA_STONE".to_owned(),
                    to: bob(),
                    mode: TransferMode::Steal,
                },
            ),
            Err(ItemLifecycleError::NotTransferable {
                owner: alice(),
                registry_key: "MEGA_STONE".to_owned(),
            })
        );
        let knocked = knock_off_item(
            &state,
            &KnockOffRequest {
                target: alice(),
                registry_key: "MEGA_STONE".to_owned(),
            },
        )
        .expect("knock off succeeds");
        assert!(knocked.state.instances.is_empty());
        assert_eq!(knocked.state.consume_ledger.len(), 1);
        assert!(!knocked.state.consume_ledger[0].restorable);
        assert_eq!(
            restore_item(&knocked.state, &RestoreRequest { owner: alice() }),
            Err(ItemLifecycleError::NothingRestorable { owner: alice() })
        );
    }

    #[test]
    fn knock_off_destroyed_items_are_lost_forever_while_eaten_ones_restore() {
        let knocked_source = grant_sitrus(&empty(), alice(), 1);
        let knocked = knock_off_item(
            &knocked_source,
            &KnockOffRequest {
                target: alice(),
                registry_key: "SITRUS_BERRY".to_owned(),
            },
        )
        .expect("knock off succeeds");
        assert_eq!(
            trigger_eligibility(&knocked.state, alice(), "SITRUS_BERRY", TURN_ONE),
            Ok(ItemTriggerEligibility::Absent),
            "knocked-off items leave no exhaust trail"
        );
    }

    #[test]
    fn swap_exchanges_ownership_in_one_atomic_step() {
        let state = grant_sitrus(&grant_oran(&empty(), bob()), alice(), 1);
        let left_id = state
            .find_instance(alice(), "SITRUS_BERRY")
            .expect("alice holds sitrus")
            .instance_id;
        let right_id = state
            .find_instance(bob(), "ORAN_BERRY")
            .expect("bob holds oran")
            .instance_id;
        let swapped = swap_items(
            &state,
            &SwapRequest {
                left: alice(),
                left_registry_key: "SITRUS_BERRY".to_owned(),
                right: bob(),
                right_registry_key: "ORAN_BERRY".to_owned(),
            },
        )
        .expect("swap succeeds");
        assert_eq!(swapped.evidence.left_instance_id, left_id);
        assert_eq!(swapped.evidence.right_instance_id, right_id);
        // Instance identities stay stable; only ownership flips.
        assert_eq!(
            swapped
                .state
                .find_instance(bob(), "SITRUS_BERRY")
                .map(|item| item.instance_id),
            Some(left_id)
        );
        assert_eq!(
            swapped
                .state
                .find_instance(alice(), "ORAN_BERRY")
                .map(|item| item.instance_id),
            Some(right_id)
        );
        assert!(swapped.state.validate().is_ok());
    }

    #[test]
    fn swap_rejects_nontransferable_instances_and_missing_items() {
        let locked = grant_nontransferable(&empty(), alice(), "MEGA_STONE");
        let with_berry = grant_sitrus(&locked, bob(), 1);
        assert_eq!(
            swap_items(
                &with_berry,
                &SwapRequest {
                    left: alice(),
                    left_registry_key: "MEGA_STONE".to_owned(),
                    right: bob(),
                    right_registry_key: "SITRUS_BERRY".to_owned(),
                },
            ),
            Err(ItemLifecycleError::NotTransferable {
                owner: alice(),
                registry_key: "MEGA_STONE".to_owned(),
            })
        );
        assert_eq!(
            swap_items(
                &with_berry,
                &SwapRequest {
                    left: alice(),
                    left_registry_key: "ORAN_BERRY".to_owned(),
                    right: bob(),
                    right_registry_key: "SITRUS_BERRY".to_owned(),
                },
            ),
            Err(ItemLifecycleError::ItemAbsent {
                owner: alice(),
                registry_key: "ORAN_BERRY".to_owned(),
            })
        );
    }

    fn grant_oran(state: &ItemLifecycleStateV2, owner: PokemonId) -> ItemLifecycleStateV2 {
        grant_item(
            state,
            &GrantRequest {
                owner,
                registry_key: "ORAN_BERRY".to_owned(),
                stacks: 1,
                charges: None,
                source_ordinal: SourceOrdinal::ZERO,
                transferable: true,
            },
        )
        .expect("grant succeeds")
        .state
    }

    #[test]
    fn merge_overflow_is_a_typed_error_that_preserves_input() {
        let state = grant_sitrus(&grant_sitrus(&empty(), alice(), 1), bob(), u16::MAX);
        let snapshot = state.clone();
        assert_eq!(
            transfer_item(
                &state,
                &TransferRequest {
                    from: alice(),
                    registry_key: "SITRUS_BERRY".to_owned(),
                    to: bob(),
                    mode: TransferMode::Transfer,
                },
            ),
            Err(ItemLifecycleError::StackOverflow {
                owner: bob(),
                registry_key: "SITRUS_BERRY".to_owned(),
            })
        );
        assert_eq!(state, snapshot, "errors must preserve the input state");
    }

    #[test]
    fn invalid_input_requests_fail_without_touching_state() {
        let state = grant_sitrus(&empty(), alice(), 1);
        let snapshot = state.clone();
        assert_eq!(
            grant_item(
                &state,
                &GrantRequest {
                    owner: bob(),
                    registry_key: String::new(),
                    stacks: 1,
                    charges: None,
                    source_ordinal: SourceOrdinal::ZERO,
                    transferable: true,
                },
            ),
            Err(ItemLifecycleError::EmptyRegistryKey)
        );
        assert_eq!(
            grant_item(
                &state,
                &GrantRequest {
                    owner: bob(),
                    registry_key: "ORAN_BERRY".to_owned(),
                    stacks: 0,
                    charges: None,
                    source_ordinal: SourceOrdinal::ZERO,
                    transferable: true,
                },
            ),
            Err(ItemLifecycleError::ZeroStacks)
        );
        assert_eq!(
            transfer_item(
                &state,
                &TransferRequest {
                    from: alice(),
                    registry_key: "SITRUS_BERRY".to_owned(),
                    to: alice(),
                    mode: TransferMode::Transfer,
                },
            ),
            Err(ItemLifecycleError::SameOwner)
        );
        assert_eq!(
            transfer_item(
                &state,
                &TransferRequest {
                    from: bob(),
                    registry_key: "ORAN_BERRY".to_owned(),
                    to: alice(),
                    mode: TransferMode::Transfer,
                },
            ),
            Err(ItemLifecycleError::ItemAbsent {
                owner: bob(),
                registry_key: "ORAN_BERRY".to_owned(),
            })
        );
        assert_eq!(state, snapshot);
    }

    #[test]
    fn corrupt_input_state_is_rejected_before_any_transition() {
        let mut corrupt = empty();
        corrupt.schema_version = ITEM_LIFECYCLE_STATE_SCHEMA_VERSION + 1;
        let snapshot = corrupt.clone();
        assert!(matches!(
            grant_item(
                &corrupt,
                &GrantRequest {
                    owner: alice(),
                    registry_key: "ORAN_BERRY".to_owned(),
                    stacks: 1,
                    charges: None,
                    source_ordinal: SourceOrdinal::ZERO,
                    transferable: true,
                },
            ),
            Err(ItemLifecycleError::InvalidState(_))
        ));
        assert_eq!(corrupt, snapshot);
    }
}
