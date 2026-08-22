//! Pure, allocator-free-ID presentation planning for M3 battle material.
//!
//! The resolver owns the causal mechanics trace.  This module only turns that
//! already-typed trace into closed [`BattlePresentationEvent`] values.  In
//! particular, it does not read or write battle state, consume RNG, allocate
//! presentation identities, or depend on a renderer or protocol runtime.

use crate::error::BattleInvariantError;
use crate::resolver::BattleMutation;
use er_types::OperationId;
use er_types::SafeU53;
use er_types::battle_ids::{AbilityId, BattlePresentationEventId, FieldSlot, MoveId, PokemonId};
use er_types::battle_model::{
    ActionDisposition, BattleOutcome, BattleStat, ResolvedAction, ResolvedActionKind,
};
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationBlockingPolicy,
    PresentationSkipPolicy,
};

/// The ordered result consumed by TURN/REPLACEMENT material.
pub type PresentationPlan = Vec<BattlePresentationEvent>;

/// The M3 presentation policy is intentionally centralized so every event,
/// including terminal events, enters the same exact barrier set.  The
/// contract's settlement path does not authorize a renderer to skip any
/// emitted event.
pub const PRESENTATION_BLOCKING_POLICY: PresentationBlockingPolicy =
    PresentationBlockingPolicy::BlocksHumanInput;
pub const PRESENTATION_SKIP_POLICY: PresentationSkipPolicy = PresentationSkipPolicy::Forbidden;

/// Typed causal evidence that is not reconstructible from a mechanical
/// mutation alone.
///
/// `BattleMutation` carries the state delta, while move targets/move IDs and
/// ability activations are semantic observations produced at the same causal
/// boundary by the resolver.  The vector supplied to a builder is already in
/// resolver causal order.  Keeping this order explicit is important: the
/// oracle distinguishes plans whose final mechanical state is equal.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PresentationCausalEvent {
    MoveUsed {
        action_sequence: SafeU53,
        actor: PokemonId,
        move_id: MoveId,
        targets: Vec<FieldSlot>,
    },
    AbilityActivated {
        pokemon: PokemonId,
        ability_id: AbilityId,
    },
    #[cfg_attr(test, allow(dead_code))]
    StatStageAttempted {
        pokemon: PokemonId,
        stat: BattleStat,
        before: i8,
        after: i8,
    },
    Mutation(Box<BattleMutation>),
}

impl PresentationCausalEvent {
    pub fn move_used(
        action_sequence: SafeU53,
        actor: PokemonId,
        move_id: MoveId,
        targets: Vec<FieldSlot>,
    ) -> Self {
        Self::MoveUsed {
            action_sequence,
            actor,
            move_id,
            targets,
        }
    }

    pub const fn ability_activated(pokemon: PokemonId, ability_id: AbilityId) -> Self {
        Self::AbilityActivated {
            pokemon,
            ability_id,
        }
    }

    #[cfg_attr(test, allow(dead_code))]
    pub const fn stat_stage_attempted(
        pokemon: PokemonId,
        stat: BattleStat,
        before: i8,
        after: i8,
    ) -> Self {
        Self::StatStageAttempted {
            pokemon,
            stat,
            before,
            after,
        }
    }

    pub fn mutation(mutation: BattleMutation) -> Self {
        Self::Mutation(Box::new(mutation))
    }
}

/// Compatibility names for callers that describe the input as a cause or a
/// step rather than a causal event.
pub type PresentationCause = PresentationCausalEvent;
pub type PresentationStep = PresentationCausalEvent;

/// Inputs needed to build a TURN presentation plan.
#[derive(Clone, Debug)]
pub struct TurnPresentationInput<'a> {
    pub material_operation_id: &'a OperationId,
    pub action_order: &'a [ResolvedAction],
    pub causal_events: &'a [PresentationCausalEvent],
    pub outcome: BattleOutcome,
}

impl<'a> TurnPresentationInput<'a> {
    pub const fn new(
        material_operation_id: &'a OperationId,
        action_order: &'a [ResolvedAction],
        causal_events: &'a [PresentationCausalEvent],
        outcome: BattleOutcome,
    ) -> Self {
        Self {
            material_operation_id,
            action_order,
            causal_events,
            outcome,
        }
    }
}

/// Inputs needed to build a REPLACEMENT presentation plan.
#[derive(Clone, Debug)]
pub struct ReplacementPresentationInput<'a> {
    pub material_operation_id: &'a OperationId,
    pub causal_events: &'a [PresentationCausalEvent],
    pub outcome: BattleOutcome,
}

impl<'a> ReplacementPresentationInput<'a> {
    pub const fn new(
        material_operation_id: &'a OperationId,
        causal_events: &'a [PresentationCausalEvent],
        outcome: BattleOutcome,
    ) -> Self {
        Self {
            material_operation_id,
            causal_events,
            outcome,
        }
    }
}

/// The two accepted material boundaries for the common plan builder.
#[derive(Clone, Debug)]
pub enum PresentationTransitionInput<'a> {
    Turn(TurnPresentationInput<'a>),
    Replacement(ReplacementPresentationInput<'a>),
}

/// Build the ordered presentation plan for an accepted TURN transition.
pub fn build_turn_presentation_plan(
    input: TurnPresentationInput<'_>,
) -> Result<PresentationPlan, BattleInvariantError> {
    build_plan(
        input.material_operation_id,
        input.action_order,
        input.causal_events,
        input.outcome,
    )
}

/// Build the ordered presentation plan for an accepted REPLACEMENT
/// transition.  Replacement has no dynamic action-order vector; its causal
/// order is the supplied mutation/ability trace.
pub fn build_replacement_presentation_plan(
    input: ReplacementPresentationInput<'_>,
) -> Result<PresentationPlan, BattleInvariantError> {
    build_plan(
        input.material_operation_id,
        &[],
        input.causal_events,
        input.outcome,
    )
}

/// Dispatch the common builder at either material boundary.
pub fn build_presentation_plan(
    input: PresentationTransitionInput<'_>,
) -> Result<PresentationPlan, BattleInvariantError> {
    match input {
        PresentationTransitionInput::Turn(input) => build_turn_presentation_plan(input),
        PresentationTransitionInput::Replacement(input) => {
            build_replacement_presentation_plan(input)
        }
    }
}

/// Compatibility aliases for integrations that use the shorter plan names.
pub fn build_turn_plan(
    input: TurnPresentationInput<'_>,
) -> Result<PresentationPlan, BattleInvariantError> {
    build_turn_presentation_plan(input)
}

pub fn build_replacement_plan(
    input: ReplacementPresentationInput<'_>,
) -> Result<PresentationPlan, BattleInvariantError> {
    build_replacement_presentation_plan(input)
}

/// Derive one event identity from an exact zero-based plan position.
///
/// This narrow helper is public so overflow can be tested without attempting
/// to allocate a `Vec` containing `SafeU53::MAX + 1` events.  There is no
/// presentation allocator: the material operation and array position are the
/// complete identity.
pub fn presentation_event_id_for_position(
    material_operation_id: &OperationId,
    position: usize,
) -> Result<BattlePresentationEventId, BattleInvariantError> {
    let original_position = position;
    let position = u64::try_from(position)
        .map_err(|_| BattleInvariantError::presentation_sequence_overflow(original_position))?;
    let sequence = SafeU53::new(position)
        .map_err(|_| BattleInvariantError::presentation_sequence_overflow(original_position))?;
    Ok(BattlePresentationEventId::new(
        material_operation_id.clone(),
        sequence,
    ))
}

fn build_plan(
    material_operation_id: &OperationId,
    action_order: &[ResolvedAction],
    causal_events: &[PresentationCausalEvent],
    outcome: BattleOutcome,
) -> Result<PresentationPlan, BattleInvariantError> {
    let mut plan = Vec::new();

    for causal_event in causal_events {
        match causal_event {
            PresentationCausalEvent::MoveUsed {
                action_sequence,
                actor,
                move_id,
                targets,
            } if move_is_presentable(*action_sequence, action_order) => {
                push_event(
                    &mut plan,
                    material_operation_id,
                    BattlePresentationKind::MoveUsed {
                        actor: *actor,
                        move_id: *move_id,
                        targets: targets.clone(),
                    },
                )?;
            }
            PresentationCausalEvent::MoveUsed { .. } => {}
            PresentationCausalEvent::AbilityActivated {
                pokemon,
                ability_id,
                ..
            } if *ability_id != AbilityId::ZERO => {
                push_event(
                    &mut plan,
                    material_operation_id,
                    BattlePresentationKind::AbilityActivated {
                        pokemon: *pokemon,
                        ability_id: *ability_id,
                    },
                )?;
            }
            PresentationCausalEvent::AbilityActivated { .. } => {}
            PresentationCausalEvent::StatStageAttempted {
                pokemon,
                stat,
                before,
                after,
            } => {
                push_event(
                    &mut plan,
                    material_operation_id,
                    BattlePresentationKind::StatStageChanged {
                        pokemon: *pokemon,
                        stat: *stat,
                        before: *before,
                        after: *after,
                    },
                )?;
            }
            PresentationCausalEvent::Mutation(mutation) => {
                if let Some(kind) = presentation_kind_from_mutation(mutation) {
                    push_event(&mut plan, material_operation_id, kind)?;
                }
            }
        }
    }

    let terminal = terminal_outcome(outcome, causal_events);
    if let Some(kind) = terminal.and_then(terminal_kind) {
        push_event(&mut plan, material_operation_id, kind)?;
    }

    Ok(plan)
}

fn move_is_presentable(action_sequence: SafeU53, action_order: &[ResolvedAction]) -> bool {
    let Some(action) = action_order
        .iter()
        .find(|action| action.sequence == action_sequence)
    else {
        // A replacement-free causal trace may be assembled before the final
        // action-order DTO is attached.  The typed move evidence is still
        // authoritative in that case.
        return true;
    };

    matches!(action.kind, ResolvedActionKind::Move)
        && !matches!(
            action.disposition,
            ActionDisposition::SkippedActorInactive
                | ActionDisposition::CancelledByParalysis
                | ActionDisposition::CancelledByFlinch
        )
}

fn presentation_kind_from_mutation(mutation: &BattleMutation) -> Option<BattlePresentationKind> {
    match mutation {
        BattleMutation::HpChanged {
            pokemon,
            before,
            after,
        } if before != after => Some(BattlePresentationKind::HpChanged {
            pokemon: *pokemon,
            before: *before,
            after: *after,
        }),
        BattleMutation::StatusChanged {
            pokemon,
            before,
            after,
        } if before != after && before.kind != after.kind => {
            Some(BattlePresentationKind::StatusApplied {
                pokemon: *pokemon,
                before: *before,
                after: *after,
            })
        }
        BattleMutation::StatStageChanged {
            pokemon,
            stat,
            before,
            after,
        } if before != after => Some(BattlePresentationKind::StatStageChanged {
            pokemon: *pokemon,
            stat: *stat,
            before: *before,
            after: *after,
        }),
        BattleMutation::FieldChanged {
            slot,
            before,
            after: Some(incoming),
        } if before.as_ref() != Some(incoming) => Some(BattlePresentationKind::Switched {
            slot: *slot,
            outgoing: *before,
            incoming: *incoming,
        }),
        BattleMutation::FaintQueued { occurrence } => Some(BattlePresentationKind::Fainted {
            pokemon: occurrence.pokemon,
            occurrence: occurrence.id,
        }),
        _ => None,
    }
}

fn terminal_outcome(
    explicit_outcome: BattleOutcome,
    causal_events: &[PresentationCausalEvent],
) -> Option<BattleOutcome> {
    if explicit_outcome != BattleOutcome::Ongoing {
        return Some(explicit_outcome);
    }

    causal_events.iter().rev().find_map(|event| {
        let PresentationCausalEvent::Mutation(mutation) = event else {
            return None;
        };
        let BattleMutation::OutcomeChanged { after, .. } = mutation.as_ref() else {
            return None;
        };
        (*after != BattleOutcome::Ongoing).then_some(*after)
    })
}

const fn terminal_kind(outcome: BattleOutcome) -> Option<BattlePresentationKind> {
    match outcome {
        BattleOutcome::Victory => Some(BattlePresentationKind::BattleWon),
        BattleOutcome::Defeat => Some(BattlePresentationKind::BattleLost),
        BattleOutcome::Ongoing => None,
    }
}

fn push_event(
    plan: &mut PresentationPlan,
    material_operation_id: &OperationId,
    kind: BattlePresentationKind,
) -> Result<(), BattleInvariantError> {
    let event_id = presentation_event_id_for_position(material_operation_id, plan.len())?;
    plan.push(BattlePresentationEvent::new(
        event_id,
        PRESENTATION_BLOCKING_POLICY,
        PRESENTATION_SKIP_POLICY,
        kind,
    ));
    Ok(())
}
