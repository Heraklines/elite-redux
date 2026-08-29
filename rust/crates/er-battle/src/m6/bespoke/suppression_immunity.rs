//! M6C pure battle transitions for the suppression / unusual-immunity and
//! status-volatile-tag bespoke families, plus the closed custom ability
//! dispatcher.
//!
//! Every transition follows the clone-stage-validate pattern: the canonical
//! [`SuppressionImmunityStateV2`] input is never mutated — each function
//! clones, applies one atomic change, revalidates the clone, and returns the
//! new state with typed lifecycle evidence. Suppression overlays record full
//! source-scoped provenance, honor closed unsuppressibility kinds supplied
//! by content, and never rewrite an ability slot's identity: unsupported
//! abilities stay exactly what they are, never NONE.
//!
//! The custom dispatcher routes every `ACTIVE_ABILITY`/`PASSIVE_ABILITY`
//! behavior unit of the frozen closure through its closed
//! [`DispatchClass`] lane in active-before-passive order. Gated (suppressed)
//! units are reported with their gating origin instead of being silently
//! dropped, so no unit ever becomes an unreported residual.

use er_state::bespoke_v2::suppression_immunity::{
    AbilitySlot, DispatchClass, SlotSuppressionEntryV2, SuppressionImmunityStateV2,
    SuppressionOrigin, SuppressionStateError, VolatileTagInstanceV2, VolatileTagSubject,
    classify_behavior_unit,
};
use er_types::battle_ids::{AbilityId, PokemonId};
use er_types::battle_model::StatusKind;
use er_types::ids::SafeU53;
use er_types::m6::BehaviorUnitId;
use thiserror::Error;

/// Schema version of every evidence record emitted by this module.
pub const SUPPRESSION_TRANSITION_SCHEMA_VERSION: u32 = 1;

/// Closed unsuppressibility kind for a targeted slot's ability, resolved by
/// content before the transition runs. Unsuppressible abilities reject every
/// suppression overlay, matching the frozen `unsuppressable` content flag.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbilitySuppressibility {
    Suppressible,
    Unsuppressible,
}

/// A request to suppress one battler's ability slot from one source scope.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlotSuppressionRequest {
    pub owner: PokemonId,
    pub slot: AbilitySlot,
    pub origin: SuppressionOrigin,
    /// Timed window; `None` lasts until cleanup or source removal.
    pub remaining_turns: Option<u16>,
    pub suppressibility: AbilitySuppressibility,
    /// Current identity of the slot's ability. Echoed unchanged in the
    /// evidence to prove slots are overlaid, never rewritten.
    pub current_ability: AbilityId,
}

/// Evidence for one applied or refreshed slot-suppression overlay.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SlotSuppressionApplied {
    pub owner: PokemonId,
    pub slot: AbilitySlot,
    pub origin: SuppressionOrigin,
    pub creation_ordinal: SafeU53,
    /// `true` when an identical origin already covered the slot and only its
    /// timed window was refreshed.
    pub refreshed: bool,
    /// Highest-precedence origin governing the slot after the transition.
    pub governing_origin_after: SuppressionOrigin,
    /// The slot's ability identity after the transition — always identical
    /// to the request's `current_ability`.
    pub ability_preserved: AbilityId,
}

/// One removed suppression overlay.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct RemovedSuppression {
    pub owner: PokemonId,
    pub slot: AbilitySlot,
    pub origin: SuppressionOrigin,
    pub creation_ordinal: SafeU53,
}

/// Closed cleanup events that strip suppression overlays.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SuppressionCleanupEvent {
    /// The suppressed owner switched out or left the field.
    OwnerLeftField(PokemonId),
    /// The suppressed owner fainted.
    OwnerFainted(PokemonId),
    /// A field-ability suppressor source (Neutralizing Gas family) left.
    FieldSourceLeft(PokemonId),
    /// The global ignore-abilities switch cleared.
    GlobalCleared,
}

/// Evidence for a suppression cleanup transition.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuppressionCleanupEvidence {
    pub event: CleanupEventReport,
    pub removed: Vec<RemovedSuppression>,
    /// Owner/slot pairs whose last overlay was removed, i.e. the underlying
    /// ability acts again ("restoration after the last source clears").
    pub restored_slots: Vec<(PokemonId, AbilitySlot)>,
}

/// Serializable report of the cleanup event that drove the transition.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CleanupEventReport {
    OwnerLeftField { owner: PokemonId },
    OwnerFainted { owner: PokemonId },
    FieldSourceLeft { source_pokemon: PokemonId },
    GlobalCleared,
}

/// Typed wrapper bundling the new state with its evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuppressionTransition<E> {
    pub schema_version: u32,
    pub state: SuppressionImmunityStateV2,
    pub evidence: E,
}

impl<E> SuppressionTransition<E> {
    fn new(state: SuppressionImmunityStateV2, evidence: E) -> Self {
        Self {
            schema_version: SUPPRESSION_TRANSITION_SCHEMA_VERSION,
            state,
            evidence,
        }
    }
}

/// Errors raised by suppression/volatile-tag transitions and dispatch.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SuppressionTransitionError {
    #[error("ability in the targeted slot is unsuppressible by its closed content kind")]
    UnsuppressibleAbility {
        owner: PokemonId,
        slot: AbilitySlot,
        ability: AbilityId,
    },
    #[error("status/volatile/tag admission denied by native immunity")]
    TagDeniedByImmunity,
    #[error("behavior unit {hash} is not an immunity-gate lane")]
    NotAnImmunityUnit { hash: String },
    #[error("creation ordinal space exhausted")]
    OrdinalExhausted,
    #[error("canonical state rejected the staged result: {0}")]
    State(#[from] SuppressionStateError),
}

fn next_ordinal(state: &SuppressionImmunityStateV2) -> Result<SafeU53, SuppressionTransitionError> {
    let value = state.next_creation_ordinal.get();
    let bumped = value
        .checked_add(1)
        .ok_or(SuppressionTransitionError::OrdinalExhausted)?;
    SafeU53::try_from(bumped).map_err(|_| SuppressionTransitionError::OrdinalExhausted)
}

/// Applies (or refreshes) one slot-suppression overlay.
///
/// Pure: clones `state`, stages the entry, validates, and returns. An
/// identical `(owner, slot, origin)` triple refreshes the timed window in
/// place instead of stacking a duplicate; overlapping distinct origins stack
/// as separate entries with total precedence ordering.
pub fn apply_slot_suppression(
    state: &SuppressionImmunityStateV2,
    request: &SlotSuppressionRequest,
) -> Result<SuppressionTransition<SlotSuppressionApplied>, SuppressionTransitionError> {
    if request.suppressibility == AbilitySuppressibility::Unsuppressible {
        return Err(SuppressionTransitionError::UnsuppressibleAbility {
            owner: request.owner,
            slot: request.slot,
            ability: request.current_ability,
        });
    }
    let mut next = state.clone();
    let existing = next.slot_suppressions.iter_mut().find(|entry| {
        entry.owner == request.owner && entry.slot == request.slot && entry.origin == request.origin
    });
    let (ordinal, refreshed) = match existing {
        Some(entry) => {
            if request.remaining_turns.is_some() {
                entry.remaining_turns = request.remaining_turns;
            }
            (entry.creation_ordinal, true)
        }
        None => {
            let ordinal = next.next_creation_ordinal;
            next.slot_suppressions.push(SlotSuppressionEntryV2 {
                owner: request.owner,
                slot: request.slot,
                origin: request.origin.clone(),
                creation_ordinal: ordinal,
                remaining_turns: request.remaining_turns,
            });
            next.slot_suppressions.sort_by_key(|entry| {
                (
                    entry.owner.get().get(),
                    entry.slot.order(),
                    entry.origin.precedence(),
                    entry.creation_ordinal,
                )
            });
            next.next_creation_ordinal = next_ordinal(&next)?;
            (ordinal, false)
        }
    };
    next.validate()?;
    let governing_origin_after = next
        .governing_origin(request.owner, request.slot)
        .cloned()
        .expect("staged entry governs its own slot");
    Ok(SuppressionTransition::new(
        next,
        SlotSuppressionApplied {
            owner: request.owner,
            slot: request.slot,
            origin: request.origin.clone(),
            creation_ordinal: ordinal,
            refreshed,
            governing_origin_after,
            ability_preserved: request.current_ability,
        },
    ))
}

/// Strips suppression overlays for one closed cleanup event and reports
/// which slots were restored.
pub fn clear_suppressions(
    state: &SuppressionImmunityStateV2,
    event: SuppressionCleanupEvent,
) -> Result<SuppressionTransition<SuppressionCleanupEvidence>, SuppressionTransitionError> {
    let mut next = state.clone();
    let matches_event = |entry: &SlotSuppressionEntryV2| match event {
        SuppressionCleanupEvent::OwnerLeftField(owner)
        | SuppressionCleanupEvent::OwnerFainted(owner) => entry.owner == owner,
        SuppressionCleanupEvent::FieldSourceLeft(source) => {
            matches!(entry.origin, SuppressionOrigin::FieldAbility { source_pokemon } if source_pokemon == source)
        }
        SuppressionCleanupEvent::GlobalCleared => {
            matches!(entry.origin, SuppressionOrigin::GlobalIgnore)
        }
    };
    let mut removed = Vec::new();
    let mut restored_slots = Vec::new();
    let retained = next
        .slot_suppressions
        .iter()
        .filter(|entry| {
            if matches_event(entry) {
                removed.push(RemovedSuppression {
                    owner: entry.owner,
                    slot: entry.slot,
                    origin: entry.origin.clone(),
                    creation_ordinal: entry.creation_ordinal,
                });
                false
            } else {
                true
            }
        })
        .cloned()
        .collect::<Vec<_>>();
    for removed_entry in &removed {
        let still_covered = retained
            .iter()
            .any(|entry| entry.owner == removed_entry.owner && entry.slot == removed_entry.slot);
        if !still_covered && !restored_slots.contains(&(removed_entry.owner, removed_entry.slot)) {
            restored_slots.push((removed_entry.owner, removed_entry.slot));
        }
    }
    next.slot_suppressions = retained;
    next.validate()?;
    let event_report = match event {
        SuppressionCleanupEvent::OwnerLeftField(owner) => {
            CleanupEventReport::OwnerLeftField { owner }
        }
        SuppressionCleanupEvent::OwnerFainted(owner) => CleanupEventReport::OwnerFainted { owner },
        SuppressionCleanupEvent::FieldSourceLeft(source) => CleanupEventReport::FieldSourceLeft {
            source_pokemon: source,
        },
        SuppressionCleanupEvent::GlobalCleared => CleanupEventReport::GlobalCleared,
    };
    Ok(SuppressionTransition::new(
        next,
        SuppressionCleanupEvidence {
            event: event_report,
            removed,
            restored_slots,
        },
    ))
}

/// Decrements every timed suppression window by one turn, dropping entries
/// whose windows reached zero and reporting their restored slots.
pub fn advance_suppression_turns(
    state: &SuppressionImmunityStateV2,
) -> Result<SuppressionTransition<SuppressionCleanupEvidence>, SuppressionTransitionError> {
    let mut next = state.clone();
    let mut removed = Vec::new();
    let mut restored_slots = Vec::new();
    let mut retained = Vec::with_capacity(next.slot_suppressions.len());
    for entry in next.slot_suppressions.drain(..) {
        match entry.remaining_turns {
            Some(1) => {
                removed.push(RemovedSuppression {
                    owner: entry.owner,
                    slot: entry.slot,
                    origin: entry.origin.clone(),
                    creation_ordinal: entry.creation_ordinal,
                });
            }
            Some(turns) => {
                let mut decremented = entry.clone();
                decremented.remaining_turns = Some(turns - 1);
                retained.push(decremented);
            }
            None => retained.push(entry),
        }
    }
    for removed_entry in &removed {
        let still_covered = retained
            .iter()
            .any(|entry| entry.owner == removed_entry.owner && entry.slot == removed_entry.slot);
        if !still_covered && !restored_slots.contains(&(removed_entry.owner, removed_entry.slot)) {
            restored_slots.push((removed_entry.owner, removed_entry.slot));
        }
    }
    retained.sort_by_key(|entry| {
        (
            entry.owner.get().get(),
            entry.slot.order(),
            entry.origin.precedence(),
            entry.creation_ordinal,
        )
    });
    next.slot_suppressions = retained;
    next.validate()?;
    Ok(SuppressionTransition::new(
        next,
        SuppressionCleanupEvidence {
            event: CleanupEventReport::GlobalCleared,
            removed,
            restored_slots,
        },
    ))
}

// ---------------------------------------------------------------------------
// Immunity decisions.
// ---------------------------------------------------------------------------

/// Closed immunity subject surface evaluated against an owner's slot claim.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ImmunitySubject {
    Type(er_types::battle_model::PokemonType),
    Status(StatusKind),
}

/// Closed attacker-side bypass input. Bypass inputs outrank native immunity:
/// when set, a live immunity claim does not deny the interaction.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbilityBypassInput {
    None,
    IgnoreAbilities,
}

/// A claimed immunity behavior unit on one owner slot. The referenced unit
/// must classify into the [`DispatchClass::ImmunityGate`] lane.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ImmunityClaim<'a> {
    pub owner: PokemonId,
    pub slot: AbilitySlot,
    pub provenance_hash: &'a str,
}

/// Typed immunity decision with its deciding reason.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImmunityDecision {
    /// The interaction is allowed to proceed.
    Allowed {
        #[serde(rename = "reason")]
        reason: ImmunityAllowReason,
    },
    /// Native immunity denies the interaction.
    Denied,
}

/// Why an immune-looking interaction was allowed anyway.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImmunityAllowReason {
    /// The claiming slot is suppressed, so its immunity is inert.
    ClaimingSlotSuppressed,
    /// The attacker's bypass input outranks native immunity.
    BypassPrecedence,
}

/// Evaluates one immunity claim under current suppression state and the
/// attacker's bypass input. Precedence is fixed: suppressed slot first
/// (the defender's own ability is off), then bypass precedence, then native
/// denial.
pub fn evaluate_immunity(
    state: &SuppressionImmunityStateV2,
    claim: &ImmunityClaim<'_>,
    _subject: ImmunitySubject,
    bypass: AbilityBypassInput,
) -> Result<ImmunityDecision, SuppressionTransitionError> {
    let class = classify_behavior_unit(claim.provenance_hash)?;
    if class != DispatchClass::ImmunityGate {
        return Err(SuppressionTransitionError::NotAnImmunityUnit {
            hash: claim.provenance_hash.to_owned(),
        });
    }
    if state.slot_is_suppressed(claim.owner, claim.slot) {
        return Ok(ImmunityDecision::Allowed {
            reason: ImmunityAllowReason::ClaimingSlotSuppressed,
        });
    }
    if bypass == AbilityBypassInput::IgnoreAbilities {
        return Ok(ImmunityDecision::Allowed {
            reason: ImmunityAllowReason::BypassPrecedence,
        });
    }
    Ok(ImmunityDecision::Denied)
}

// ---------------------------------------------------------------------------
// Volatile tag instances.
// ---------------------------------------------------------------------------

/// Closed admission permission resolved by composing the immunity decision
/// above with the admitting subject.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TagAdmission {
    Permitted,
    BlockedByNativeImmunity,
}

/// A request to admit (stack/refresh) one typed status/volatile/tag subject.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VolatileTagAdmission {
    pub owner: PokemonId,
    pub subject: VolatileTagSubject,
    /// Layers to add; at least one. Stacks onto an existing instance of the
    /// same `(owner, subject)` within the frozen ceiling.
    pub layers_delta: u8,
    /// Timed window to refresh; `None` lapses only through cleanup.
    pub remaining_turns: Option<u16>,
    pub admission: TagAdmission,
}

/// Evidence for one admitted/stacked instance.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct TagAdmitted {
    pub owner: PokemonId,
    pub subject: VolatileTagSubject,
    pub layers_after: u8,
    pub creation_ordinal: SafeU53,
    /// `true` when stacked onto an existing instance.
    pub stacked: bool,
}

/// Admits one volatile/tag subject: stacking subjects accumulate layers
/// (checked against the frozen ceiling) and refresh their window; new
/// subjects append as fresh instances. Immunity-denied admissions are
/// rejected without touching state.
pub fn admit_volatile_tag(
    state: &SuppressionImmunityStateV2,
    request: &VolatileTagAdmission,
) -> Result<SuppressionTransition<TagAdmitted>, SuppressionTransitionError> {
    if request.admission == TagAdmission::BlockedByNativeImmunity {
        return Err(SuppressionTransitionError::TagDeniedByImmunity);
    }
    if request.layers_delta == 0 {
        return Err(SuppressionStateError::ZeroLayers.into());
    }
    let mut next = state.clone();
    let existing = next
        .volatile_tags
        .iter_mut()
        .find(|instance| instance.owner == request.owner && instance.subject == request.subject);
    let (ordinal, stacked, layers_after) = match existing {
        Some(instance) => {
            let combined = instance.layers.checked_add(request.layers_delta).ok_or(
                SuppressionStateError::LayerOverflow {
                    layers: u8::MAX,
                    ceiling: er_state::bespoke_v2::suppression_immunity::VOLATILE_TAG_MAX_LAYERS,
                },
            )?;
            if combined > er_state::bespoke_v2::suppression_immunity::VOLATILE_TAG_MAX_LAYERS {
                return Err(SuppressionStateError::LayerOverflow {
                    layers: combined,
                    ceiling: er_state::bespoke_v2::suppression_immunity::VOLATILE_TAG_MAX_LAYERS,
                }
                .into());
            }
            instance.layers = combined;
            if let Some(new_turns) = request.remaining_turns {
                instance.remaining_turns = Some(
                    instance
                        .remaining_turns
                        .map_or(new_turns, |current| current.max(new_turns)),
                );
            }
            (instance.creation_ordinal, true, instance.layers)
        }
        None => {
            let ordinal = next.next_creation_ordinal;
            let layers_after = request.layers_delta;
            next.volatile_tags.push(VolatileTagInstanceV2 {
                owner: request.owner,
                subject: request.subject.clone(),
                layers: layers_after,
                creation_ordinal: ordinal,
                remaining_turns: request.remaining_turns,
            });
            next.volatile_tags.sort_by_key(|instance| {
                (
                    instance.owner.get().get(),
                    subject_family_order(&instance.subject),
                    subject_identity_key(&instance.subject),
                    instance.creation_ordinal,
                )
            });
            next.next_creation_ordinal = next_ordinal(&next)?;
            (ordinal, false, layers_after)
        }
    };
    next.validate()?;
    Ok(SuppressionTransition::new(
        next,
        TagAdmitted {
            owner: request.owner,
            subject: request.subject.clone(),
            layers_after,
            creation_ordinal: ordinal,
            stacked,
        },
    ))
}

fn subject_family_order(subject: &VolatileTagSubject) -> u8 {
    match subject {
        VolatileTagSubject::MajorStatus(_) => 0,
        VolatileTagSubject::VolatileStatus { .. } => 1,
        VolatileTagSubject::BattlerTag { .. } => 2,
        VolatileTagSubject::PositionalTag { .. } => 3,
    }
}

fn subject_identity_key(subject: &VolatileTagSubject) -> String {
    match subject {
        VolatileTagSubject::MajorStatus(kind) => format!("STATUS:{kind:?}"),
        VolatileTagSubject::VolatileStatus { registry_key } => {
            format!("VOLATILE:{registry_key}")
        }
        VolatileTagSubject::BattlerTag { registry_key } => format!("TAG:{registry_key}"),
        VolatileTagSubject::PositionalTag { side, registry_key } => {
            format!("POSITIONAL:{side:?}:{registry_key}")
        }
    }
}

/// One expired timed instance.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiredTag {
    pub owner: PokemonId,
    pub subject: VolatileTagSubject,
    pub creation_ordinal: SafeU53,
}

/// Decrements every timed volatile-tag window by one turn and drops the
/// expired instances.
pub fn lapse_volatile_tags(
    state: &SuppressionImmunityStateV2,
) -> Result<SuppressionTransition<Vec<ExpiredTag>>, SuppressionTransitionError> {
    let mut next = state.clone();
    let mut expired = Vec::new();
    let mut retained = Vec::with_capacity(next.volatile_tags.len());
    for instance in next.volatile_tags.drain(..) {
        match instance.remaining_turns {
            Some(1) => expired.push(ExpiredTag {
                owner: instance.owner,
                subject: instance.subject,
                creation_ordinal: instance.creation_ordinal,
            }),
            Some(turns) => {
                let mut decremented = instance;
                decremented.remaining_turns = Some(turns - 1);
                retained.push(decremented);
            }
            None => retained.push(instance),
        }
    }
    next.volatile_tags = retained;
    next.validate()?;
    Ok(SuppressionTransition::new(next, expired))
}

/// Closed cleanup events for volatile/tag instances.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VolatileCleanupEvent {
    /// Switch-out clears battler tags, volatiles, and positional tags but
    /// preserves major statuses.
    SwitchOut(PokemonId),
    /// Fainting clears everything owned by the fainted battler.
    Faint(PokemonId),
}

/// Evidence for a volatile-tag cleanup transition.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct VolatileCleanupEvidence {
    pub removed: Vec<ExpiredTag>,
    /// Major-status subjects preserved across the event (switch-out only).
    pub preserved_major_statuses: Vec<StatusKind>,
}

/// Clears volatile/tag instances per the closed cleanup semantics.
pub fn clear_volatile_tags(
    state: &SuppressionImmunityStateV2,
    event: VolatileCleanupEvent,
) -> Result<SuppressionTransition<VolatileCleanupEvidence>, SuppressionTransitionError> {
    let mut next = state.clone();
    let mut removed = Vec::new();
    let mut preserved_major_statuses = Vec::new();
    let retained = next
        .volatile_tags
        .iter()
        .filter(|instance| {
            let clear = match event {
                VolatileCleanupEvent::SwitchOut(owner) => {
                    instance.owner == owner
                        && !matches!(instance.subject, VolatileTagSubject::MajorStatus(_))
                }
                VolatileCleanupEvent::Faint(owner) => instance.owner == owner,
            };
            if clear {
                removed.push(ExpiredTag {
                    owner: instance.owner,
                    subject: instance.subject.clone(),
                    creation_ordinal: instance.creation_ordinal,
                });
            }
            !clear
        })
        .cloned()
        .collect::<Vec<_>>();
    if matches!(event, VolatileCleanupEvent::SwitchOut(_)) {
        for instance in &retained {
            if let VolatileTagSubject::MajorStatus(kind) = &instance.subject
                && !preserved_major_statuses.contains(kind)
            {
                preserved_major_statuses.push(*kind);
            }
        }
    }
    next.volatile_tags = retained;
    next.validate()?;
    Ok(SuppressionTransition::new(
        next,
        VolatileCleanupEvidence {
            removed,
            preserved_major_statuses,
        },
    ))
}

// ---------------------------------------------------------------------------
// Closed custom ability dispatcher.
// ---------------------------------------------------------------------------

/// One behavior-unit identity routed through the dispatcher.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DispatchUnitInput<'a> {
    pub owner: PokemonId,
    pub slot: AbilitySlot,
    pub identity: &'a BehaviorUnitId,
}

/// Dispatcher context: live suppression state plus the closed
/// unsuppressible-slot exceptions supplied by content.
#[derive(Clone, Copy, Debug)]
pub struct DispatchContext<'a> {
    pub suppression: &'a SuppressionImmunityStateV2,
    /// Slots whose abilities carry the closed unsuppressible kind; these are
    /// never gated even under live suppressors.
    pub unsuppressible_slots: &'a [(PokemonId, AbilitySlot)],
}

/// How the dispatcher routed one unit.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "gate", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DispatchGate {
    /// Active slot, unsuppressed.
    Active,
    /// Passive slot in active-before-passive order, unsuppressed.
    PassiveOrdered,
    /// Every live overlay on the slot was rejected by the closed
    /// unsuppressible kind, so the unit participates normally.
    RetainedUnsuppressible {
        blocked_origins: Vec<SuppressionOrigin>,
    },
    /// The slot is suppressed; the unit is gated and reported with the
    /// governing origin instead of being dropped.
    GatedBySuppression { origin: SuppressionOrigin },
}

/// One routed dispatch with its class lane and gate.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct RoutedDispatch {
    pub owner: PokemonId,
    pub slot: AbilitySlot,
    pub provenance_hash: String,
    pub class: DispatchClass,
    pub gate: DispatchGate,
}

/// Deterministic routing plan over one dispatch wave.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct DispatchPlan {
    pub routed: Vec<RoutedDispatch>,
}

impl DispatchPlan {
    /// Count of units participating ungated (active/passive/retained).
    pub fn active_count(&self) -> usize {
        self.routed
            .iter()
            .filter(|unit| {
                matches!(
                    unit.gate,
                    DispatchGate::Active
                        | DispatchGate::PassiveOrdered
                        | DispatchGate::RetainedUnsuppressible { .. }
                )
            })
            .count()
    }

    /// Count of units gated by live suppression.
    pub fn gated_count(&self) -> usize {
        self.routed
            .iter()
            .filter(|unit| matches!(unit.gate, DispatchGate::GatedBySuppression { .. }))
            .count()
    }
}

/// Routes every input unit through its closed lane in deterministic
/// active-before-passive order (owner ascending, then slot order; ties keep
/// input order via stable sort). Every input appears exactly once in the
/// plan — gated units included — so the dispatcher has zero silent
/// residuals.
pub fn route_ability_dispatch(
    units: &[DispatchUnitInput<'_>],
    context: &DispatchContext<'_>,
) -> Result<DispatchPlan, SuppressionTransitionError> {
    let mut routed = Vec::with_capacity(units.len());
    for unit in units {
        let class = classify_behavior_unit(unit.identity.provenance_hash.as_str())?;
        let live_origins: Vec<SuppressionOrigin> = context
            .suppression
            .slot_suppressions
            .iter()
            .filter(|entry| entry.owner == unit.owner && entry.slot == unit.slot)
            .map(|entry| entry.origin.clone())
            .collect();
        let unsuppressible = context
            .unsuppressible_slots
            .contains(&(unit.owner, unit.slot));
        let gate = if live_origins.is_empty() {
            if unit.slot == AbilitySlot::Active {
                DispatchGate::Active
            } else {
                DispatchGate::PassiveOrdered
            }
        } else if unsuppressible {
            DispatchGate::RetainedUnsuppressible {
                blocked_origins: live_origins,
            }
        } else {
            let governing = context
                .suppression
                .governing_origin(unit.owner, unit.slot)
                .cloned()
                .expect("live origins imply a governor");
            DispatchGate::GatedBySuppression { origin: governing }
        };
        routed.push(RoutedDispatch {
            owner: unit.owner,
            slot: unit.slot,
            provenance_hash: unit.identity.provenance_hash.as_str().to_owned(),
            class,
            gate,
        });
    }
    routed.sort_by_key(|unit| (unit.owner.get().get(), unit.slot.order()));
    Ok(DispatchPlan { routed })
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::suppression_immunity::{
        CLASSIFIED_BEHAVIOR_UNIT_HASHES, CLASSIFIED_BEHAVIOR_UNITS,
    };

    const IMMUNITY_HASH_A: &str =
        "0ca297b1b4086db67f651ec8eee4b17a86b6a3c663993c7f2759b9742af65351";
    const IMMUNITY_HASH_B: &str =
        "3038cccc171fa428454e3783e7c8670b2004e6ebda27dc8502e4146234f47500";
    const CHARGED_TAG_HASH: &str =
        "aa7a41958d6b714055ee5b1009b59b94efc5d1a8d115297bb4f8f7fcbcfeb04f";
    const POROUS_CHARGE_HASH: &str =
        "8ccdbf8965d067c8390767eb77144e3a0ae9b147f01da49cf68be01e048fe846";

    fn pid(value: u64) -> PokemonId {
        PokemonId::new(SafeU53::new(value).unwrap())
    }

    fn mid(value: u64) -> er_types::battle_ids::MoveId {
        er_types::battle_ids::MoveId::new(SafeU53::new(value).unwrap())
    }

    fn aid(value: u64) -> AbilityId {
        AbilityId::new(SafeU53::new(value).unwrap())
    }

    fn behavior_unit(hash: &str) -> BehaviorUnitId {
        BehaviorUnitId {
            source: er_types::m6::BehaviorSourceId::ActiveAbility {
                numeric_id: SafeU53::new(1).unwrap(),
            },
            unit_kind: er_types::m6::BehaviorUnitKind::AbilityAttribute,
            ordinal: er_types::m6::BehaviorUnitOrdinal::ZERO,
            provenance_hash: er_types::m6::ProvenanceHash::parse(hash).unwrap(),
        }
    }

    fn suppressible(
        owner: PokemonId,
        slot: AbilitySlot,
        origin: SuppressionOrigin,
    ) -> SlotSuppressionRequest {
        SlotSuppressionRequest {
            owner,
            slot,
            origin,
            remaining_turns: None,
            suppressibility: AbilitySuppressibility::Suppressible,
            current_ability: aid(77),
        }
    }

    #[test]
    fn closure_constants_match_frozen_counts() {
        assert_eq!(CLASSIFIED_BEHAVIOR_UNITS, 1406);
        assert_eq!(CLASSIFIED_BEHAVIOR_UNIT_HASHES, 1002);
        assert_eq!(
            classify_behavior_unit(CHARGED_TAG_HASH).unwrap(),
            DispatchClass::SubjectDefinition
        );
        assert_eq!(
            classify_behavior_unit(POROUS_CHARGE_HASH).unwrap(),
            DispatchClass::PostDefendTrigger
        );
    }

    #[test]
    fn suppression_preserves_all_four_slots_and_provenance() {
        let loadout_before = er_types::battle_model::AbilityLoadout {
            active: aid(10),
            passives: [Some(aid(11)), Some(aid(12)), None],
            active_suppressed: false,
            passive_suppressed: [false; 3],
        };
        let owner = pid(1);
        let state = SuppressionImmunityStateV2::new();
        let transition = apply_slot_suppression(
            &state,
            &SlotSuppressionRequest {
                owner,
                slot: AbilitySlot::Active,
                origin: SuppressionOrigin::MoveApplied {
                    source_move: mid(206),
                },
                remaining_turns: None,
                suppressibility: AbilitySuppressibility::Suppressible,
                current_ability: loadout_before.active,
            },
        )
        .unwrap();
        // The owning loadout is untouched: ids are never rewritten to NONE
        // and the evidence echoes the preserved identity.
        assert_eq!(loadout_before.active, aid(10));
        assert_eq!(transition.evidence.ability_preserved, aid(10));
        assert!(!transition.evidence.refreshed);
        // All four slots addressable; only Active carries an overlay.
        for slot in AbilitySlot::ALL {
            let expected = slot == AbilitySlot::Active;
            assert_eq!(transition.state.slot_is_suppressed(owner, slot), expected);
        }
        transition.state.validate().unwrap();
    }

    #[test]
    fn unsuppressible_rejection_leaves_state_unchanged() {
        let owner = pid(2);
        let state = SuppressionImmunityStateV2::new();
        let error = apply_slot_suppression(
            &state,
            &SlotSuppressionRequest {
                owner,
                slot: AbilitySlot::Passive0,
                origin: SuppressionOrigin::MoveApplied {
                    source_move: mid(206),
                },
                remaining_turns: None,
                suppressibility: AbilitySuppressibility::Unsuppressible,
                current_ability: aid(5),
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            SuppressionTransitionError::UnsuppressibleAbility {
                owner,
                slot: AbilitySlot::Passive0,
                ability: aid(5),
            }
        );
        assert_eq!(state, SuppressionImmunityStateV2::new());
    }

    #[test]
    fn overlapping_suppressors_precede_then_restore() {
        let owner = pid(3);
        let state = SuppressionImmunityStateV2::new();
        let with_move = apply_slot_suppression(
            &state,
            &suppressible(
                owner,
                AbilitySlot::Active,
                SuppressionOrigin::MoveApplied {
                    source_move: mid(206),
                },
            ),
        )
        .unwrap();
        let with_field = apply_slot_suppression(
            &with_move.state,
            &suppressible(
                owner,
                AbilitySlot::Active,
                SuppressionOrigin::FieldAbility {
                    source_pokemon: pid(9),
                },
            ),
        )
        .unwrap();
        let with_global = apply_slot_suppression(
            &with_field.state,
            &suppressible(owner, AbilitySlot::Active, SuppressionOrigin::GlobalIgnore),
        )
        .unwrap();
        // Global outranks field, which outranks move-applied.
        assert_eq!(
            with_global.evidence.governing_origin_after,
            SuppressionOrigin::GlobalIgnore
        );
        assert_eq!(
            with_global
                .state
                .governing_origin(owner, AbilitySlot::Active),
            Some(&SuppressionOrigin::GlobalIgnore)
        );
        // Removing the global source falls back to field precedence.
        let after_clear =
            clear_suppressions(&with_global.state, SuppressionCleanupEvent::GlobalCleared).unwrap();
        assert_eq!(
            after_clear
                .state
                .governing_origin(owner, AbilitySlot::Active),
            Some(&SuppressionOrigin::FieldAbility {
                source_pokemon: pid(9)
            })
        );
        assert!(after_clear.evidence.restored_slots.is_empty());
        // Removing the field suppressor still leaves the move overlay.
        let after_source = clear_suppressions(
            &after_clear.state,
            SuppressionCleanupEvent::FieldSourceLeft(pid(9)),
        )
        .unwrap();
        assert_eq!(
            after_source
                .state
                .governing_origin(owner, AbilitySlot::Active),
            Some(&SuppressionOrigin::MoveApplied {
                source_move: mid(206)
            })
        );
        // Restoration happens only after the LAST source clears.
        let final_clear = clear_suppressions(
            &after_source.state,
            SuppressionCleanupEvent::OwnerLeftField(owner),
        )
        .unwrap();
        assert!(
            final_clear
                .state
                .governing_origin(owner, AbilitySlot::Active)
                .is_none()
        );
        assert_eq!(
            final_clear.evidence.restored_slots,
            vec![(owner, AbilitySlot::Active)]
        );
    }

    #[test]
    fn identical_origin_refreshes_instead_of_stacking() {
        let owner = pid(4);
        let state = SuppressionImmunityStateV2::new();
        let first = apply_slot_suppression(
            &state,
            &SlotSuppressionRequest {
                remaining_turns: Some(2),
                ..suppressible(
                    owner,
                    AbilitySlot::Passive1,
                    SuppressionOrigin::MoveApplied {
                        source_move: mid(206),
                    },
                )
            },
        )
        .unwrap();
        let second = apply_slot_suppression(
            &first.state,
            &SlotSuppressionRequest {
                remaining_turns: Some(5),
                ..suppressible(
                    owner,
                    AbilitySlot::Passive1,
                    SuppressionOrigin::MoveApplied {
                        source_move: mid(206),
                    },
                )
            },
        )
        .unwrap();
        assert!(second.evidence.refreshed);
        assert_eq!(
            second.evidence.creation_ordinal,
            first.evidence.creation_ordinal
        );
        assert_eq!(second.state.slot_suppressions.len(), 1);
        assert_eq!(second.state.slot_suppressions[0].remaining_turns, Some(5));
    }

    #[test]
    fn timed_windows_expire_and_restore() {
        let owner = pid(5);
        let state = SuppressionImmunityStateV2::new();
        let applied = apply_slot_suppression(
            &state,
            &SlotSuppressionRequest {
                remaining_turns: Some(2),
                ..suppressible(
                    owner,
                    AbilitySlot::Active,
                    SuppressionOrigin::MoveApplied {
                        source_move: mid(206),
                    },
                )
            },
        )
        .unwrap();
        let tick_one = advance_suppression_turns(&applied.state).unwrap();
        assert!(tick_one.evidence.removed.is_empty());
        assert_eq!(tick_one.state.slot_suppressions[0].remaining_turns, Some(1));
        let tick_two = advance_suppression_turns(&tick_one.state).unwrap();
        assert_eq!(tick_two.evidence.removed.len(), 1);
        assert!(tick_two.state.slot_suppressions.is_empty());
        assert_eq!(
            tick_two.evidence.restored_slots,
            vec![(owner, AbilitySlot::Active)]
        );
    }

    #[test]
    fn immunity_allow_deny_and_bypass_precedence() {
        let owner = pid(6);
        let state = SuppressionImmunityStateV2::new();
        let claim = ImmunityClaim {
            owner,
            slot: AbilitySlot::Active,
            provenance_hash: IMMUNITY_HASH_A,
        };
        // Native denial without any interference.
        assert_eq!(
            evaluate_immunity(
                &state,
                &claim,
                ImmunitySubject::Type(er_types::battle_model::PokemonType::Ground),
                AbilityBypassInput::None,
            )
            .unwrap(),
            ImmunityDecision::Denied
        );
        // Attacker bypass outranks native immunity.
        assert_eq!(
            evaluate_immunity(
                &state,
                &claim,
                ImmunitySubject::Type(er_types::battle_model::PokemonType::Ground),
                AbilityBypassInput::IgnoreAbilities,
            )
            .unwrap(),
            ImmunityDecision::Allowed {
                reason: ImmunityAllowReason::BypassPrecedence,
            }
        );
        // Suppressing the claiming slot makes its immunity inert even
        // without a bypass.
        let suppressed = apply_slot_suppression(
            &state,
            &suppressible(owner, AbilitySlot::Active, SuppressionOrigin::GlobalIgnore),
        )
        .unwrap();
        assert_eq!(
            evaluate_immunity(
                &suppressed.state,
                &claim,
                ImmunitySubject::Type(er_types::battle_model::PokemonType::Ground),
                AbilityBypassInput::None,
            )
            .unwrap(),
            ImmunityDecision::Allowed {
                reason: ImmunityAllowReason::ClaimingSlotSuppressed,
            }
        );
        // Non-immunity lanes are rejected as claims outright.
        let error = evaluate_immunity(
            &state,
            &ImmunityClaim {
                owner,
                slot: AbilitySlot::Active,
                provenance_hash: CHARGED_TAG_HASH,
            },
            ImmunitySubject::Status(StatusKind::Poison),
            AbilityBypassInput::None,
        )
        .unwrap_err();
        assert!(matches!(
            error,
            SuppressionTransitionError::NotAnImmunityUnit { .. }
        ));
    }

    #[test]
    fn second_immunity_lane_hash_also_denies_natively() {
        let owner = pid(7);
        let state = SuppressionImmunityStateV2::new();
        let decision = evaluate_immunity(
            &state,
            &ImmunityClaim {
                owner,
                slot: AbilitySlot::Passive0,
                provenance_hash: IMMUNITY_HASH_B,
            },
            ImmunitySubject::Status(StatusKind::Burn),
            AbilityBypassInput::None,
        )
        .unwrap();
        assert_eq!(decision, ImmunityDecision::Denied);
    }

    #[test]
    fn tag_admission_stacks_refreshes_expires_and_respects_immunity() {
        let owner = pid(8);
        let state = SuppressionImmunityStateV2::new();
        // Immunity-blocked admission is a hard rejection leaving state clean.
        let denied = admit_volatile_tag(
            &state,
            &VolatileTagAdmission {
                owner,
                subject: VolatileTagSubject::MajorStatus(StatusKind::Poison),
                layers_delta: 1,
                remaining_turns: Some(3),
                admission: TagAdmission::BlockedByNativeImmunity,
            },
        )
        .unwrap_err();
        assert_eq!(denied, SuppressionTransitionError::TagDeniedByImmunity);
        // Fresh admission.
        let admitted = admit_volatile_tag(
            &state,
            &VolatileTagAdmission {
                owner,
                subject: VolatileTagSubject::BattlerTag {
                    registry_key: "CHARGED".to_owned(),
                },
                layers_delta: 2,
                remaining_turns: Some(2),
                admission: TagAdmission::Permitted,
            },
        )
        .unwrap();
        assert!(!admitted.evidence.stacked);
        assert_eq!(admitted.evidence.layers_after, 2);
        // Stack + refresh: layers accumulate, window takes the max.
        let stacked = admit_volatile_tag(
            &admitted.state,
            &VolatileTagAdmission {
                owner,
                subject: VolatileTagSubject::BattlerTag {
                    registry_key: "CHARGED".to_owned(),
                },
                layers_delta: 3,
                remaining_turns: Some(6),
                admission: TagAdmission::Permitted,
            },
        )
        .unwrap();
        assert!(stacked.evidence.stacked);
        assert_eq!(stacked.evidence.layers_after, 5);
        assert_eq!(stacked.state.volatile_tags.len(), 1);
        assert_eq!(stacked.state.volatile_tags[0].remaining_turns, Some(6));
        // Layer overflow past the frozen ceiling is checked arithmetic.
        let overflow = admit_volatile_tag(
            &stacked.state,
            &VolatileTagAdmission {
                owner,
                subject: VolatileTagSubject::BattlerTag {
                    registry_key: "CHARGED".to_owned(),
                },
                layers_delta: u8::MAX,
                remaining_turns: None,
                admission: TagAdmission::Permitted,
            },
        )
        .unwrap_err();
        assert!(matches!(
            overflow,
            SuppressionTransitionError::State(SuppressionStateError::LayerOverflow { .. })
        ));
        // Expiry drops timed instances deterministically.
        let lapsed = lapse_volatile_tags(&stacked.state).unwrap();
        assert!(lapsed.evidence.is_empty());
        let lapsed_again = lapse_volatile_tags(&lapsed.state).unwrap();
        assert!(lapsed_again.evidence.is_empty());
    }

    #[test]
    fn switch_out_preserves_major_status_faint_clears_all() {
        let owner = pid(9);
        let state = SuppressionImmunityStateV2::new();
        let with_status = admit_volatile_tag(
            &state,
            &VolatileTagAdmission {
                owner,
                subject: VolatileTagSubject::MajorStatus(StatusKind::Sleep),
                layers_delta: 1,
                remaining_turns: None,
                admission: TagAdmission::Permitted,
            },
        )
        .unwrap();
        let with_tag = admit_volatile_tag(
            &with_status.state,
            &VolatileTagAdmission {
                owner,
                subject: VolatileTagSubject::PositionalTag {
                    side: er_types::battle_ids::BattleSide::Player,
                    registry_key: "STEALTH_ROCK".to_owned(),
                },
                layers_delta: 1,
                remaining_turns: Some(4),
                admission: TagAdmission::Permitted,
            },
        )
        .unwrap();
        let switched =
            clear_volatile_tags(&with_tag.state, VolatileCleanupEvent::SwitchOut(owner)).unwrap();
        assert_eq!(switched.evidence.removed.len(), 1);
        assert_eq!(
            switched.evidence.preserved_major_statuses,
            vec![StatusKind::Sleep]
        );
        assert_eq!(switched.state.volatile_tags.len(), 1);
        let fainted =
            clear_volatile_tags(&switched.state, VolatileCleanupEvent::Faint(owner)).unwrap();
        assert_eq!(fainted.evidence.removed.len(), 1);
        assert!(fainted.state.volatile_tags.is_empty());
        assert!(fainted.evidence.preserved_major_statuses.is_empty());
    }

    #[test]
    fn dispatcher_orders_active_before_passive_and_reports_gates() {
        let owner_a = pid(10);
        let owner_b = pid(11);
        let state = SuppressionImmunityStateV2::new();
        // Suppress owner_b's active slot; mark owner_a's Passive0 as an
        // unsuppressible exception and give it a live overlay too.
        let suppressed_b = apply_slot_suppression(
            &state,
            &suppressible(
                owner_b,
                AbilitySlot::Active,
                SuppressionOrigin::GlobalIgnore,
            ),
        )
        .unwrap();
        let suppressed_a_passive = apply_slot_suppression(
            &suppressed_b.state,
            &suppressible(
                owner_a,
                AbilitySlot::Passive0,
                SuppressionOrigin::GlobalIgnore,
            ),
        )
        .unwrap();
        let unsuppressible = [(owner_a, AbilitySlot::Passive0)];
        let context = DispatchContext {
            suppression: &suppressed_a_passive.state,
            unsuppressible_slots: &unsuppressible,
        };
        // Input deliberately out of order: passives first, actives last.
        let unit_passive2 = behavior_unit(IMMUNITY_HASH_B);
        let unit_active_a = behavior_unit(IMMUNITY_HASH_A);
        let unit_tag = behavior_unit(CHARGED_TAG_HASH);
        let unit_porous = behavior_unit(POROUS_CHARGE_HASH);
        let unit_passive0 = behavior_unit(IMMUNITY_HASH_A);
        let units = vec![
            DispatchUnitInput {
                owner: owner_a,
                slot: AbilitySlot::Passive2,
                identity: &unit_passive2,
            },
            DispatchUnitInput {
                owner: owner_a,
                slot: AbilitySlot::Active,
                identity: &unit_active_a,
            },
            DispatchUnitInput {
                owner: owner_b,
                slot: AbilitySlot::Passive1,
                identity: &unit_tag,
            },
            DispatchUnitInput {
                owner: owner_b,
                slot: AbilitySlot::Active,
                identity: &unit_porous,
            },
            DispatchUnitInput {
                owner: owner_a,
                slot: AbilitySlot::Passive0,
                identity: &unit_passive0,
            },
        ];
        let plan = route_ability_dispatch(&units, &context).unwrap();
        // Every unit is present exactly once: zero silent residuals.
        assert_eq!(plan.routed.len(), units.len());
        assert_eq!(
            plan.routed
                .iter()
                .map(|unit| (unit.owner, unit.slot))
                .collect::<Vec<_>>(),
            vec![
                (owner_a, AbilitySlot::Active),
                (owner_a, AbilitySlot::Passive0),
                (owner_a, AbilitySlot::Passive2),
                (owner_b, AbilitySlot::Active),
                (owner_b, AbilitySlot::Passive1),
            ]
        );
        // Gates reflect suppression, retention, and plain ordering.
        assert_eq!(plan.routed[0].gate, DispatchGate::Active);
        assert!(matches!(
            plan.routed[1].gate,
            DispatchGate::RetainedUnsuppressible { ref blocked_origins }
                if blocked_origins.len() == 1
        ));
        assert_eq!(plan.routed[2].gate, DispatchGate::PassiveOrdered);
        assert!(matches!(
            plan.routed[3].gate,
            DispatchGate::GatedBySuppression {
                origin: SuppressionOrigin::GlobalIgnore
            }
        ));
        assert_eq!(plan.active_count(), 4);
        assert_eq!(plan.gated_count(), 1);
    }

    #[test]
    fn dispatcher_rejects_units_outside_the_frozen_closure() {
        let state = SuppressionImmunityStateV2::new();
        let no_unsuppressible: [(PokemonId, AbilitySlot); 0] = [];
        let context = DispatchContext {
            suppression: &state,
            unsuppressible_slots: &no_unsuppressible,
        };
        let unknown_hash = "f".repeat(64);
        let unknown_unit = behavior_unit(&unknown_hash);
        let error = route_ability_dispatch(
            &[DispatchUnitInput {
                owner: pid(12),
                slot: AbilitySlot::Active,
                identity: &unknown_unit,
            }],
            &context,
        )
        .unwrap_err();
        assert!(matches!(
            error,
            SuppressionTransitionError::State(SuppressionStateError::UnknownBehaviorUnit { .. })
        ));
    }
}
