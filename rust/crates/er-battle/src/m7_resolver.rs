//! Direct GameStateV5 battle resolution over prepared M6 content.

use er_canonical::content_digest;
use er_content::pack::m6_pack::MoveDefinitionV3;
use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_mechanics::selector_operation_v2::{MechanicOperationV2, SelectorNodeV2};
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_state::current_battle_source_events::CurrentBattleSourceEventV1;
use er_state::m7_state::{BattleStateV5, GameStateV5, PokemonStateV5, RunStateV3};
use er_state::pokemon::calculate_max_pp;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleTargetSelection, CommandSet,
};
use er_types::battle_ids::{
    BattleSide, FieldSlot, MoveId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex,
};
use er_types::battle_model::{
    ActionDisposition, BattleOutcome, MoveAccuracy, MoveCategory, MovePower, ResolvedAction,
    ResolvedActionKind, SingleTypeMultiplier,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BehaviorClassificationKindV2, BehaviorSourceId, BehaviorUnitId, GameControlKindV2, SafeU53,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::current_target_execution::CurrentTargetExecution;
use crate::m6::bespoke::handlers_for;
use crate::m6::routine_executor::execute_after_damage_actor_hook_v2;
use crate::m6::{
    MechanicsContextV2, MechanicsOperationEvidenceV2, QueryValueV2, execute_hook_v2,
    execute_query_v2,
};
use crate::resolver::BattleMutation;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurnAuthorityContextV1 {
    pub authority_seat: er_types::SeatId,
    pub revision: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BattlePresentationCueV5 {
    MoveUsed {
        pokemon: PokemonId,
        move_id: MoveId,
    },
    HpChanged {
        pokemon: PokemonId,
        before: u32,
        after: u32,
    },
    AbilityShown {
        pokemon: PokemonId,
        ability: er_types::battle_ids::AbilityId,
        innate_slot: Option<u8>,
    },
    AbilityHeal {
        pokemon: PokemonId,
        before: u32,
        after: u32,
        requested_heal: u32,
    },
    AbilityHidden {
        pokemon: PokemonId,
        ability: er_types::battle_ids::AbilityId,
        innate_slot: Option<u8>,
    },
    RecoilMessage {
        pokemon: PokemonId,
    },
    MoveNoEffect {
        pokemon: PokemonId,
        move_id: MoveId,
    },
    Switched {
        slot: FieldSlot,
        pokemon: PokemonId,
    },
    Fainted {
        pokemon: PokemonId,
    },
    BattleWon,
    BattleLost,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicsOperationEvidenceV5 {
    pub program: MechanicsProgramId,
    pub behavior_unit: BehaviorUnitId,
    pub binding_ordinal: u16,
    pub operation_ordinal: u16,
    pub condition_matched: bool,
    pub operation: MechanicOperationV2,
}

impl From<MechanicsOperationEvidenceV2> for MechanicsOperationEvidenceV5 {
    fn from(value: MechanicsOperationEvidenceV2) -> Self {
        Self {
            program: value.program,
            behavior_unit: value.behavior_unit,
            binding_ordinal: value.binding_ordinal,
            operation_ordinal: value.operation_ordinal,
            condition_matched: value.condition_matched,
            operation: value.operation,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleTransitionV5 {
    pub before_digest: String,
    pub after_state: GameStateV5,
    pub after_digest: String,
    pub accepted_commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationCueV5>,
    /// Actual decisions from the owned current phase path; absent historically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_events: Option<Vec<CurrentBattleSourceEventV1>>,
    pub mechanics_evidence: Vec<MechanicsOperationEvidenceV5>,
    pub rng_audit: Vec<RngDraw>,
    pub outcome: BattleOutcome,
    pub next_control: GameControlKindV2,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleV5Error {
    #[error("GameStateV5 is invalid: {0}")]
    State(String),
    #[error("no active run or battle exists")]
    NoBattle,
    #[error("authority seat does not match the active battle")]
    AuthoritySeat,
    #[error("command set is invalid: {0}")]
    Commands(String),
    #[error("command actor {0:?} is not active in its stated field slot")]
    InactiveActor(PokemonId),
    #[error("command move slot or PP is invalid")]
    MoveSlot,
    #[error("command switch target is invalid")]
    SwitchTarget,
    #[error("command target is invalid")]
    Target,
    #[error("prepared content lookup failed: {0}")]
    Content(String),
    #[error("Mechanics IR V2 execution failed: {0}")]
    Mechanics(String),
    #[error("RNG execution failed: {0}")]
    Rng(String),
    #[error("numeric battle calculation overflowed")]
    Overflow,
    #[error("prepared content contains unsupported behavior")]
    UnsupportedContent,
    #[error("compiled or bespoke dispatch closure is invalid")]
    DispatchClosure,
    #[error("canonical digest failed: {0}")]
    Digest(String),
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct V5DispatchClosure {
    pub compiled_behaviors: usize,
    pub bespoke_behaviors: usize,
    pub bespoke_handlers: usize,
}

pub fn verify_v5_dispatch_closure(
    content: &PreparedBattleContentV3,
) -> Result<V5DispatchClosure, BattleV5Error> {
    let mut compiled_behaviors = 0;
    let mut bespoke_behaviors = 0;
    let mut bespoke_handlers = 0;
    for classification in &content.pack().classifications.0 {
        match classification.kind {
            BehaviorClassificationKindV2::Compiled => {
                for program in &classification.programs {
                    content
                        .program(*program)
                        .map_err(|error| BattleV5Error::Content(error.to_string()))?;
                }
                compiled_behaviors += 1;
            }
            BehaviorClassificationKindV2::Bespoke => {
                let mechanic = classification
                    .bespoke
                    .ok_or(BattleV5Error::DispatchClosure)?;
                let handlers = handlers_for(mechanic);
                if handlers.is_empty() {
                    return Err(BattleV5Error::DispatchClosure);
                }
                bespoke_behaviors += 1;
                bespoke_handlers += handlers.len();
            }
            BehaviorClassificationKindV2::Unsupported => {
                return Err(BattleV5Error::UnsupportedContent);
            }
        }
    }
    Ok(V5DispatchClosure {
        compiled_behaviors,
        bespoke_behaviors,
        bespoke_handlers,
    })
}

type PendingAction = er_state::current_turn_execution::CurrentTurnActionV1;

#[path = "current_defender_execution.rs"]
mod current_defender_execution;

#[path = "current_turn_continuation.rs"]
mod current_turn_continuation;
pub use current_turn_continuation::{
    CurrentTurnChunkV1, begin_current_turn, finish_current_turn, step_current_turn,
};

pub fn resolve_turn_v5(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
) -> Result<BattleTransitionV5, BattleV5Error> {
    resolve_turn_v5_inner(before, commands, content, authority, None)
}

/// Current live target ownership; historical callers retain their original path.
pub fn resolve_turn_v5_with_current_targets(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
    targeting: &CurrentTargetExecution<'_>,
) -> Result<BattleTransitionV5, BattleV5Error> {
    resolve_turn_v5_inner(before, commands, content, authority, Some(targeting))
}

fn resolve_turn_v5_inner(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
    targeting: Option<&CurrentTargetExecution<'_>>,
) -> Result<BattleTransitionV5, BattleV5Error> {
    verify_v5_dispatch_closure(content)?;
    before
        .validate()
        .map_err(|error| BattleV5Error::State(error.to_string()))?;
    commands
        .validate()
        .map_err(|error| BattleV5Error::Commands(error.to_string()))?;
    let before_digest = mechanical_digest(before)?;
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(BattleV5Error::NoBattle)?;
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    if battle.authority_seat != authority.authority_seat {
        return Err(BattleV5Error::AuthoritySeat);
    }
    let mut rng = RngRuntime::from_states(run.run_rng.clone(), Some(battle.battle_rng.clone()))
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    let mut pending = build_actions(run, commands, content, targeting, &mut rng)?;
    rng.speed_order_shuffle(&mut pending, &battle.wave_seed, battle.turn)
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    pending.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| right.effective_speed.cmp(&left.effective_speed))
    });

    let mut action_order = Vec::with_capacity(pending.len());
    let mut mutations = Vec::new();
    let mut presentation = Vec::new();
    let mut mechanics_evidence = Vec::new();
    for index in 0..pending.len() {
        let action = pending[index].clone();
        let mutation_before = mutations.len();
        let sequence = SafeU53::new(index as u64).map_err(|_| BattleV5Error::Overflow)?;
        let disposition = if !actor_is_active(run, action.source_slot, action.command.actor()) {
            ActionDisposition::SkippedActorInactive
        } else {
            execute_action(
                run,
                &action,
                content,
                targeting,
                &mut rng,
                &mut mutations,
                &mut presentation,
                &mut mechanics_evidence,
                None,
            )?
        };
        if let Some(owner) = targeting {
            // Source MoveEffect descendants complete their deferred Faint work
            // before the next base MovePhase. Mirror its narrow pending-target
            // redirection here; unrelated source Faint child hooks remain outside
            // this current resolver's qualified damage/phase scope.
            for mutation in &mutations[mutation_before..] {
                if let BattleMutation::HpChanged {
                    pokemon,
                    before,
                    after,
                } = mutation
                {
                    if *before == 0 || *after != 0 {
                        continue;
                    }
                    for queued in &mut pending[index + 1..] {
                        if let Some(retained) = &mut queued.current_targets {
                            owner
                                .retarget_pending_after_faint(
                                    run,
                                    *pokemon,
                                    queued.command.actor(),
                                    retained,
                                )
                                .map_err(|_| BattleV5Error::Target)?;
                        }
                    }
                }
            }
        }
        action_order.push(ResolvedAction {
            sequence,
            kind: match action.command {
                BattleCommand::Fight { .. } => ResolvedActionKind::Move,
                BattleCommand::Switch { .. } => ResolvedActionKind::Switch,
            },
            actor: action.command.actor(),
            source_slot: action.source_slot,
            command_operation_id: Some(action.accepted.operation_id().clone()),
            effective_speed: action.effective_speed,
            timing_modifier: if matches!(action.command, BattleCommand::Switch { .. }) {
                6
            } else {
                0
            },
            move_priority: action.priority,
            bracket_modifier: 0,
            tie_order: sequence,
            disposition,
        });
    }

    finalize_turn(run, &mut rng, &mut mutations, &mut presentation)?;
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    let outcome = battle.outcome;
    let next_control = if !matches!(outcome, BattleOutcome::Ongoing) {
        GameControlKindV2::Waiting
    } else if battle.faint_queue.iter().any(|occurrence| {
        occurrence.slot.side == BattleSide::Player
            && matches!(
                occurrence.replacement,
                er_types::battle_model::ReplacementProgress::Pending
                    | er_types::battle_model::ReplacementProgress::Selected { .. }
            )
    }) {
        GameControlKindV2::BattleReplacement
    } else {
        GameControlKindV2::BattleCommand
    };
    run.control.kind = next_control;
    run.control.actionable = false;
    run.control.action_context = None;
    run.control.menu = None;
    run.run_rng = rng.run_state();
    after
        .validate()
        .map_err(|error| BattleV5Error::State(error.to_string()))?;
    let after_digest = mechanical_digest(&after)?;
    Ok(BattleTransitionV5 {
        before_digest,
        after_state: after,
        after_digest,
        accepted_commands: commands.clone(),
        action_order,
        mutations,
        presentation,
        source_events: None,
        mechanics_evidence: mechanics_evidence.into_iter().map(Into::into).collect(),
        rng_audit: rng.audit_entries().to_vec(),
        outcome,
        next_control,
    })
}

/// Run the same resolver once and expose its ordered field/HP evidence to the opt-in
/// current owner. No TS phase scheduling or XP award semantics are implied.
pub fn resolve_turn_v5_with_current_observations(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
) -> Result<
    (
        BattleTransitionV5,
        Vec<er_state::current_battle_participation::CurrentBattleObservationEventV1>,
    ),
    BattleV5Error,
> {
    let transition = resolve_turn_v5(before, commands, content, authority)?;
    let events = current_observation_events(&transition)?;
    Ok((transition, events))
}

/// Preserve the mutation-order observation projection for either resolver.
pub fn current_observation_events(
    transition: &BattleTransitionV5,
) -> Result<
    Vec<er_state::current_battle_participation::CurrentBattleObservationEventV1>,
    BattleV5Error,
> {
    use er_state::current_battle_participation::{
        CurrentBattleObservationEventV1, MAX_CURRENT_PARTICIPATION_EVENTS_V1,
    };
    let events = transition
        .mutations
        .iter()
        .filter_map(|mutation| match mutation {
            BattleMutation::FieldChanged {
                slot,
                before,
                after,
            } => Some(CurrentBattleObservationEventV1::FieldChanged {
                slot: *slot,
                before: *before,
                after: *after,
            }),
            BattleMutation::HpChanged {
                pokemon,
                before,
                after,
            } => Some(CurrentBattleObservationEventV1::HpChanged {
                pokemon: *pokemon,
                before: *before,
                after: *after,
            }),
            _ => None,
        })
        .take(MAX_CURRENT_PARTICIPATION_EVENTS_V1 + 1)
        .collect::<Vec<_>>();
    if events.len() > MAX_CURRENT_PARTICIPATION_EVENTS_V1 {
        return Err(BattleV5Error::State(
            "current battle observation capacity exceeded".to_owned(),
        ));
    }
    Ok(events)
}
/// Resolve the command's effective move without mutating PP or consuming RNG.
/// An exhausted selected slot falls back only when every real move is exhausted.
pub fn effective_move_definition_v5<'a>(
    content: &'a PreparedBattleContentV3,
    actor: &PokemonStateV5,
    move_slot: MoveSlotIndex,
) -> Result<(&'a MoveDefinitionV3, bool), BattleV5Error> {
    let selected = move_slot_state(actor, move_slot)?;
    let definition = content
        .move_definition(selected.move_id)
        .map_err(|error| BattleV5Error::Content(error.to_string()))?;
    let maximum = calculate_max_pp(
        definition.base_pp,
        selected.pp_ups,
        selected.max_pp_override,
    )
    .map_err(|_| BattleV5Error::MoveSlot)?;
    if selected.pp_used < maximum {
        return Ok((definition, false));
    }
    for slot in actor.moves.iter().flatten() {
        let candidate = content
            .move_definition(slot.move_id)
            .map_err(|error| BattleV5Error::Content(error.to_string()))?;
        let maximum = calculate_max_pp(candidate.base_pp, slot.pp_ups, slot.max_pp_override)
            .map_err(|_| BattleV5Error::MoveSlot)?;
        if slot.pp_used < maximum {
            return Err(BattleV5Error::MoveSlot);
        }
    }
    let struggle = MoveId::new(SafeU53::new(165).map_err(|_| BattleV5Error::MoveSlot)?);
    let definition = content
        .move_definition(struggle)
        .map_err(|error| BattleV5Error::Content(error.to_string()))?;
    Ok((definition, true))
}

fn build_actions(
    run: &RunStateV3,
    commands: &CommandSet,
    content: &PreparedBattleContentV3,
    targeting: Option<&CurrentTargetExecution<'_>>,
    rng: &mut RngRuntime,
) -> Result<Vec<PendingAction>, BattleV5Error> {
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    let mut actions = Vec::with_capacity(commands.entries.len());
    for accepted in &commands.entries {
        let source_slot = accepted.field_slot();
        let command = command_of(accepted).clone();
        if !actor_is_active(run, source_slot, command.actor()) {
            return Err(BattleV5Error::InactiveActor(command.actor()));
        }
        let actor =
            pokemon(run, command.actor()).ok_or(BattleV5Error::InactiveActor(command.actor()))?;
        let (priority, effective_speed) = match &command {
            BattleCommand::Switch { .. } => (i8::MAX, actor.stats.speed),
            BattleCommand::Fight { move_slot, .. } => {
                let (definition, _) = effective_move_definition_v5(content, actor, *move_slot)?;
                let sources = current_or_legacy_sources(run, actor, definition.id, targeting)?;
                let context = mechanics_context(actor, battle, &sources);
                let priority = execute_query_v2(
                    content,
                    &context,
                    MechanicQueryV2::ActionPriority,
                    QueryValueV2::Signed(i64::from(definition.priority)),
                )
                .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
                let speed = execute_query_v2(
                    content,
                    &context,
                    MechanicQueryV2::EffectiveSpeed,
                    QueryValueV2::Unsigned(u64::from(actor.stats.speed)),
                )
                .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
                (query_i8(priority.after)?, query_u32(speed.after)?)
            }
        };
        let current_targets = match (&command, targeting) {
            (
                BattleCommand::Fight {
                    actor: actor_id,
                    move_slot,
                    targets,
                },
                Some(owner),
            ) => {
                let (definition, struggle) =
                    effective_move_definition_v5(content, actor, *move_slot)?;
                if definition.id.get().get() == 165 && !struggle {
                    return Err(BattleV5Error::UnsupportedContent);
                }
                Some(
                    owner
                        .retain_command_targets(run, *actor_id, definition, targets, accepted, rng)
                        .map_err(|_| BattleV5Error::Target)?,
                )
            }
            _ => None,
        };
        actions.push(PendingAction {
            accepted: accepted.clone(),
            command,
            source_slot,
            priority,
            effective_speed,
            current_targets,
        });
    }
    Ok(actions)
}

#[allow(clippy::too_many_arguments)]
fn execute_action(
    run: &mut RunStateV3,
    action: &PendingAction,
    content: &PreparedBattleContentV3,
    targeting: Option<&CurrentTargetExecution<'_>>,
    rng: &mut RngRuntime,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
    mechanics_evidence: &mut Vec<MechanicsOperationEvidenceV2>,
    source_events: Option<&mut Vec<CurrentBattleSourceEventV1>>,
) -> Result<ActionDisposition, BattleV5Error> {
    match &action.command {
        BattleCommand::Switch { actor, party_slot } => execute_switch(
            run,
            action.source_slot,
            *actor,
            *party_slot,
            mutations,
            presentation,
        ),
        BattleCommand::Fight {
            actor,
            move_slot,
            targets,
        } => execute_move(
            run,
            action.source_slot,
            *actor,
            *move_slot,
            targets,
            action.current_targets.as_deref(),
            content,
            targeting,
            rng,
            mutations,
            presentation,
            mechanics_evidence,
            source_events,
        ),
    }
}

fn execute_switch(
    run: &mut RunStateV3,
    source_slot: FieldSlot,
    actor: PokemonId,
    party_slot: PartyIndex,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
) -> Result<ActionDisposition, BattleV5Error> {
    let index = usize::from(party_slot.get());
    let owner = pokemon(run, actor)
        .ok_or(BattleV5Error::InactiveActor(actor))?
        .owner_seat;
    let replacement_id = match source_slot.side {
        BattleSide::Player => run
            .party
            .iter()
            .filter(|replacement| replacement.owner_seat == owner)
            .nth(index)
            .filter(|replacement| {
                !replacement.fainted
                    && replacement.id != actor
                    && !field_contains(run, replacement.id)
            })
            .map(|replacement| replacement.id),
        BattleSide::Enemy => run
            .battle
            .as_ref()
            .and_then(|battle| battle.enemy_party.get(index))
            .filter(|replacement| {
                !replacement.fainted
                    && replacement.id != actor
                    && !field_contains(run, replacement.id)
            })
            .map(|replacement| replacement.id),
    }
    .ok_or(BattleV5Error::SwitchTarget)?;
    let battle = run.battle.as_mut().ok_or(BattleV5Error::NoBattle)?;
    let field = battle
        .field
        .slots
        .iter_mut()
        .find(|entry| entry.slot == source_slot)
        .ok_or(BattleV5Error::SwitchTarget)?;
    let before = field.occupant;
    field.occupant = Some(replacement_id);
    mutations.push(BattleMutation::FieldChanged {
        slot: source_slot,
        before,
        after: field.occupant,
    });
    presentation.push(BattlePresentationCueV5::Switched {
        slot: source_slot,
        pokemon: replacement_id,
    });
    Ok(ActionDisposition::Executed)
}

#[allow(clippy::too_many_arguments)]
fn execute_move(
    run: &mut RunStateV3,
    source_slot: FieldSlot,
    actor_id: PokemonId,
    move_slot: MoveSlotIndex,
    targets: &BattleTargetSelection,
    retained_targets: Option<&[FieldSlot]>,
    content: &PreparedBattleContentV3,
    targeting: Option<&CurrentTargetExecution<'_>>,
    rng: &mut RngRuntime,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
    mechanics_evidence: &mut Vec<MechanicsOperationEvidenceV2>,
    source_events: Option<&mut Vec<CurrentBattleSourceEventV1>>,
) -> Result<ActionDisposition, BattleV5Error> {
    let battle_snapshot = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?.clone();
    let actor_snapshot = pokemon(run, actor_id)
        .ok_or(BattleV5Error::InactiveActor(actor_id))?
        .clone();
    let (definition, struggle) = effective_move_definition_v5(content, &actor_snapshot, move_slot)?;
    let current_target_slots = match (targeting, retained_targets) {
        (Some(owner), Some(retained)) => Some(
            owner
                .execution_targets(run, actor_id, definition, retained)
                .map_err(|_| BattleV5Error::Target)?,
        ),
        (None, None) => None,
        _ => return Err(BattleV5Error::Target),
    };
    // Retained targets fainting earlier do not retarget another opponent.
    if current_target_slots.as_ref().is_some_and(Vec::is_empty) {
        return Ok(ActionDisposition::NoEffect);
    }
    if !struggle {
        let actor = pokemon_mut(run, actor_id).ok_or(BattleV5Error::InactiveActor(actor_id))?;
        let slot = move_slot_state_mut(actor, move_slot)?;
        let before_pp = slot.pp_used;
        slot.pp_used = slot.pp_used.checked_add(1).ok_or(BattleV5Error::Overflow)?;
        mutations.push(BattleMutation::PpChanged {
            pokemon: actor_id,
            move_slot,
            before: before_pp,
            after: slot.pp_used,
        });
    }
    presentation.push(BattlePresentationCueV5::MoveUsed {
        pokemon: actor_id,
        move_id: definition.id,
    });

    let sources = current_or_legacy_sources(run, &actor_snapshot, definition.id, targeting)?;
    let context = mechanics_context(&actor_snapshot, &battle_snapshot, &sources);
    let before_move = execute_hook_v2(content, &context, MechanicHookV2::BeforeMove)
        .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    mechanics_evidence.extend(before_move.operations);
    // Preserve historical target resolution after BeforeMove; only the current
    // retained-target path performs source cancellation before spending PP.
    let target_slots = match current_target_slots {
        Some(slots) => slots,
        None => resolve_targets(run, source_slot, targets)?,
    };
    if let Some(owner) = targeting {
        return current_defender_execution::execute(
            run,
            current_defender_execution::CurrentMoveContext {
                content,
                targeting: owner,
                definition,
                actor: &actor_snapshot,
                source_slot,
                source_events,
                mechanics: &context,
            },
            target_slots,
            rng,
            mutations,
            presentation,
            mechanics_evidence,
        );
    }
    if matches!(definition.category, MoveCategory::Status)
        || matches!(definition.power, MovePower::None)
    {
        let after_move = execute_hook_v2(content, &context, MechanicHookV2::AfterMove)
            .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
        mechanics_evidence.extend(after_move.operations);
        return Ok(ActionDisposition::Executed);
    }
    if !accuracy_hits(content, &context, definition, rng)? {
        return Ok(ActionDisposition::Missed);
    }
    let critical = critical_hits(content, &context, rng)?;
    let mut hit_any = false;
    let mut total_damage_dealt = 0_u64;
    for target_slot in target_slots {
        let target_id = occupant(run, target_slot).ok_or(BattleV5Error::Target)?;
        let target_snapshot = pokemon(run, target_id)
            .ok_or(BattleV5Error::Target)?
            .clone();
        if target_snapshot.fainted {
            continue;
        }
        let damage = calculate_damage(
            content,
            &context,
            definition,
            &actor_snapshot,
            &target_snapshot,
            critical,
            rng,
        )?;
        if damage == 0 {
            continue;
        }
        let target = pokemon_mut(run, target_id).ok_or(BattleV5Error::Target)?;
        let before_hp = target.hp;
        target.hp = target.hp.saturating_sub(damage);
        target.fainted = target.hp == 0;
        mutations.push(BattleMutation::HpChanged {
            pokemon: target_id,
            before: before_hp,
            after: target.hp,
        });
        presentation.push(BattlePresentationCueV5::HpChanged {
            pokemon: target_id,
            before: before_hp,
            after: target.hp,
        });
        if target.fainted {
            presentation.push(BattlePresentationCueV5::Fainted { pokemon: target_id });
        }
        let damage_dealt = before_hp - target.hp;
        total_damage_dealt = total_damage_dealt
            .checked_add(u64::from(damage_dealt))
            .ok_or(BattleV5Error::Overflow)?;
        apply_move_drain_after_damage(
            run,
            MoveDamageHit {
                actor: actor_id,
                move_id: definition.id,
                damage_dealt,
            },
            content,
            targeting,
            mutations,
            presentation,
            mechanics_evidence,
        )?;
        hit_any = true;
    }
    apply_move_recoil_after_damage(
        run,
        actor_id,
        definition.id,
        total_damage_dealt,
        content,
        targeting,
        mutations,
        presentation,
        mechanics_evidence,
    )?;
    let after_hit = execute_hook_v2(content, &context, MechanicHookV2::AfterHit)
        .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    mechanics_evidence.extend(after_hit.operations);
    let after_move = execute_hook_v2(content, &context, MechanicHookV2::AfterMove)
        .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    mechanics_evidence.extend(after_move.operations);
    if struggle && hit_any {
        let actor = pokemon_mut(run, actor_id).ok_or(BattleV5Error::InactiveActor(actor_id))?;
        let before_hp = actor.hp;
        let recoil = (actor.max_hp / 4).max(1);
        actor.hp = actor.hp.saturating_sub(recoil);
        actor.fainted = actor.hp == 0;
        mutations.push(BattleMutation::HpChanged {
            pokemon: actor_id,
            before: before_hp,
            after: actor.hp,
        });
        presentation.push(BattlePresentationCueV5::HpChanged {
            pokemon: actor_id,
            before: before_hp,
            after: actor.hp,
        });
        if actor.fainted {
            presentation.push(BattlePresentationCueV5::Fainted { pokemon: actor_id });
        }
    }
    Ok(if hit_any {
        ActionDisposition::Executed
    } else {
        ActionDisposition::NoEffect
    })
}

struct MoveDamageHit {
    actor: PokemonId,
    move_id: MoveId,
    damage_dealt: u32,
}

fn apply_move_drain_after_damage(
    run: &mut RunStateV3,
    hit: MoveDamageHit,
    content: &PreparedBattleContentV3,
    targeting: Option<&CurrentTargetExecution<'_>>,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
    mechanics_evidence: &mut Vec<MechanicsOperationEvidenceV2>,
) -> Result<(), BattleV5Error> {
    if hit.damage_dealt == 0 {
        return Ok(());
    }
    let after_damage = {
        let actor = pokemon(run, hit.actor).ok_or(BattleV5Error::InactiveActor(hit.actor))?;
        let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
        let sources = current_or_legacy_sources(run, actor, hit.move_id, targeting)?;
        let context = mechanics_context(actor, battle, &sources);
        execute_after_damage_actor_hook_v2(content, &context)
            .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?
    };
    for evidence in &after_damage.operations {
        if !evidence.condition_matched
            || evidence.behavior_unit.source
                != (BehaviorSourceId::Move {
                    numeric_id: hit.move_id.get(),
                })
        {
            continue;
        }
        let MechanicOperationV2::DrainFraction {
            numerator,
            denominator,
        } = evidence.operation
        else {
            continue;
        };
        let program = content
            .program(evidence.program)
            .map_err(|error| BattleV5Error::Content(error.to_string()))?;
        let binding = program
            .bindings
            .iter()
            .find(|binding| binding.binding_ordinal == evidence.binding_ordinal)
            .ok_or(BattleV5Error::DispatchClosure)?;
        let selector = binding
            .selector_root
            .and_then(|root| program.selectors.0.get(root.index()));
        if !matches!(selector, Some(SelectorNodeV2::Actor)) {
            return Err(BattleV5Error::UnsupportedContent);
        }
        let actor = pokemon_mut(run, hit.actor).ok_or(BattleV5Error::InactiveActor(hit.actor))?;
        if actor.fainted || actor.hp >= actor.max_hp {
            continue;
        }
        // The pinned HitHealAttr floors the fraction of actual HP lost on this
        // hit, with a minimum of one; overkill never increases drain healing.
        let amount = (u64::from(hit.damage_dealt) * u64::from(numerator))
            .checked_div(u64::from(denominator))
            .ok_or(BattleV5Error::Overflow)?
            .max(1)
            .min(u64::from(actor.max_hp - actor.hp));
        let before = actor.hp;
        actor.hp += u32::try_from(amount).map_err(|_| BattleV5Error::Overflow)?;
        mutations.push(BattleMutation::HpChanged {
            pokemon: hit.actor,
            before,
            after: actor.hp,
        });
        presentation.push(BattlePresentationCueV5::HpChanged {
            pokemon: hit.actor,
            before,
            after: actor.hp,
        });
    }
    mechanics_evidence.extend(after_damage.operations.into_iter().filter(|evidence| {
        !matches!(
            evidence.operation,
            MechanicOperationV2::RecoilFraction { .. }
        )
    }));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_move_recoil_after_damage(
    run: &mut RunStateV3,
    actor_id: PokemonId,
    move_id: MoveId,
    total_damage_dealt: u64,
    content: &PreparedBattleContentV3,
    targeting: Option<&CurrentTargetExecution<'_>>,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
    mechanics_evidence: &mut Vec<MechanicsOperationEvidenceV2>,
) -> Result<(), BattleV5Error> {
    if total_damage_dealt == 0 {
        return Ok(());
    }
    let after_damage = {
        let actor = pokemon(run, actor_id).ok_or(BattleV5Error::InactiveActor(actor_id))?;
        let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
        let sources = current_or_legacy_sources(run, actor, move_id, targeting)?;
        let context = mechanics_context(actor, battle, &sources);
        execute_after_damage_actor_hook_v2(content, &context)
            .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?
    };
    for evidence in after_damage.operations {
        let MechanicOperationV2::RecoilFraction {
            numerator,
            denominator,
        } = evidence.operation
        else {
            continue;
        };
        if !evidence.condition_matched
            || evidence.behavior_unit.source
                != (BehaviorSourceId::Move {
                    numeric_id: move_id.get(),
                })
        {
            continue;
        }
        let program = content
            .program(evidence.program)
            .map_err(|error| BattleV5Error::Content(error.to_string()))?;
        let binding = program
            .bindings
            .iter()
            .find(|binding| binding.binding_ordinal == evidence.binding_ordinal)
            .ok_or(BattleV5Error::DispatchClosure)?;
        let selector = binding
            .selector_root
            .and_then(|root| program.selectors.0.get(root.index()));
        if !matches!(selector, Some(SelectorNodeV2::Actor)) {
            return Err(BattleV5Error::UnsupportedContent);
        }
        let actor = pokemon_mut(run, actor_id).ok_or(BattleV5Error::InactiveActor(actor_id))?;
        if !actor.fainted {
            // Pinned RecoilAttr uses cumulative actual damage, once at last hit.
            // Only binary-exact ordinary fractions enter this M9 admission.
            let amount = total_damage_dealt
                .checked_mul(u64::from(numerator))
                .and_then(|value| value.checked_div(u64::from(denominator)))
                .ok_or(BattleV5Error::Overflow)?
                .max(1)
                .min(u64::from(actor.hp));
            let before = actor.hp;
            actor.hp -= u32::try_from(amount).map_err(|_| BattleV5Error::Overflow)?;
            actor.fainted = actor.hp == 0;
            mutations.push(BattleMutation::HpChanged {
                pokemon: actor_id,
                before,
                after: actor.hp,
            });
            presentation.push(BattlePresentationCueV5::HpChanged {
                pokemon: actor_id,
                before,
                after: actor.hp,
            });
            if actor.fainted {
                presentation.push(BattlePresentationCueV5::Fainted { pokemon: actor_id });
            }
        }
        mechanics_evidence.push(evidence);
    }
    Ok(())
}

fn finalize_turn(
    run: &mut RunStateV3,
    rng: &mut RngRuntime,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
) -> Result<(), BattleV5Error> {
    let player_defeated = run.party.iter().all(|pokemon| pokemon.fainted);
    let battle = run.battle.as_mut().ok_or(BattleV5Error::NoBattle)?;
    let enemy_defeated = battle.enemy_party.iter().all(|pokemon| pokemon.fainted);
    let previous_outcome = battle.outcome;
    battle.outcome = if player_defeated {
        BattleOutcome::Defeat
    } else if enemy_defeated {
        BattleOutcome::Victory
    } else {
        BattleOutcome::Ongoing
    };
    if battle.outcome != previous_outcome {
        mutations.push(BattleMutation::OutcomeChanged {
            before: previous_outcome,
            after: battle.outcome,
        });
        presentation.push(match battle.outcome {
            BattleOutcome::Victory => BattlePresentationCueV5::BattleWon,
            BattleOutcome::Defeat => BattlePresentationCueV5::BattleLost,
            BattleOutcome::Ongoing => return Err(BattleV5Error::Overflow),
        });
    }
    let before_commands = battle.command_state.clone();
    battle.command_state.frontier.clear();
    battle.command_state.tombstones.clear();
    mutations.push(BattleMutation::CommandCollectionChanged {
        before: before_commands,
        after: battle.command_state.clone(),
    });
    let before_turn = battle.turn;
    rng.increment_turn()
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    battle.turn = TurnIndex::new(
        SafeU53::new(
            before_turn
                .get()
                .get()
                .checked_add(1)
                .ok_or(BattleV5Error::Overflow)?,
        )
        .map_err(|_| BattleV5Error::Overflow)?,
    )
    .map_err(|_| BattleV5Error::Overflow)?;
    battle.battle_rng = rng.battle_state().cloned().ok_or(BattleV5Error::NoBattle)?;
    mutations.push(BattleMutation::TurnAdvanced {
        before: before_turn,
        after: battle.turn,
    });
    Ok(())
}

fn accuracy_hits(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    definition: &MoveDefinitionV3,
    rng: &mut RngRuntime,
) -> Result<bool, BattleV5Error> {
    let base = match definition.accuracy {
        MoveAccuracy::AlwaysHits => return Ok(true),
        MoveAccuracy::Percent(value) => i64::from(value),
    };
    let query = execute_query_v2(
        content,
        context,
        MechanicQueryV2::Accuracy,
        QueryValueV2::Signed(base),
    )
    .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    if query.cancelled || query.allowed == Some(false) {
        return Ok(false);
    }
    let accuracy = query_i64(query.after)?.clamp(0, 100);
    let draw = rng
        .battle_rand_seed_int(
            SafeU53::new(100).map_err(|_| BattleV5Error::Overflow)?,
            SafeU53::ZERO,
            RngReason::Accuracy,
            RngCallsiteId::accuracy(),
        )
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    Ok(draw.get() < accuracy as u64)
}

fn critical_hits(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    rng: &mut RngRuntime,
) -> Result<bool, BattleV5Error> {
    let query = execute_query_v2(
        content,
        context,
        MechanicQueryV2::CriticalRate,
        QueryValueV2::Signed(0),
    )
    .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    if query.cancelled || query.allowed == Some(false) {
        return Ok(false);
    }
    let stage = query_i64(query.after)?.clamp(0, 4);
    let denominator = match stage {
        0 => 24,
        1 => 8,
        2 => 2,
        _ => 1,
    };
    if denominator == 1 {
        return Ok(true);
    }
    let draw = rng
        .battle_rand_seed_int(
            SafeU53::new(denominator).map_err(|_| BattleV5Error::Overflow)?,
            SafeU53::ZERO,
            RngReason::CriticalHit,
            RngCallsiteId::critical_hit(),
        )
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    Ok(draw == SafeU53::ZERO)
}

/// Query current-resolver damage for one active move/target without changing state.
///
/// This is an ordinary noncritical, full-variance (100%) estimate. It shares the
/// current move-power/damage queries, stats, STAB and type calculation; it does
/// not roll accuracy/critical/variance or execute move hooks, PP/HP mutations.
/// It is not the complete source AI simulation: forced criticals and other
/// missing current-resolver modifiers are not added. The legacy entry has no
/// current defender owner; the typed current entry additionally recognizes the
/// qualified5082 absorb predicate. A zero ordinary type multiplier returns zero,
/// but source move-attribute overrides still require their own implementations.
/// No RNG runtime is accepted or constructed.
pub fn query_simulated_move_damage_v5(
    content: &PreparedBattleContentV3,
    run: &RunStateV3,
    source_slot: FieldSlot,
    move_slot: MoveSlotIndex,
    target_slot: FieldSlot,
) -> Result<u32, BattleV5Error> {
    query_simulated_move_damage_inner(content, run, source_slot, move_slot, target_slot, None)
}

/// Same bounded noncritical estimate, using the actual current eligible ability
/// sources and the owned5082 pre-hit immunity. It does not claim full source AI parity.
pub fn query_simulated_move_damage_with_current_targets(
    content: &PreparedBattleContentV3,
    run: &RunStateV3,
    source_slot: FieldSlot,
    move_slot: MoveSlotIndex,
    target_slot: FieldSlot,
    targeting: &CurrentTargetExecution<'_>,
) -> Result<u32, BattleV5Error> {
    targeting
        .validate_run(run)
        .map_err(|_| BattleV5Error::UnsupportedContent)?;
    query_simulated_move_damage_inner(
        content,
        run,
        source_slot,
        move_slot,
        target_slot,
        Some(targeting),
    )
}

fn query_simulated_move_damage_inner(
    content: &PreparedBattleContentV3,
    run: &RunStateV3,
    source_slot: FieldSlot,
    move_slot: MoveSlotIndex,
    target_slot: FieldSlot,
    targeting: Option<&CurrentTargetExecution<'_>>,
) -> Result<u32, BattleV5Error> {
    verify_v5_dispatch_closure(content)?;
    run.validate()
        .map_err(|error| BattleV5Error::State(error.to_string()))?;
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    let actor_id = occupant(run, source_slot).ok_or(BattleV5Error::Target)?;
    if !actor_is_active(run, source_slot, actor_id) {
        return Err(BattleV5Error::InactiveActor(actor_id));
    }
    let actor = pokemon(run, actor_id).ok_or(BattleV5Error::InactiveActor(actor_id))?;
    let (definition, _) = effective_move_definition_v5(content, actor, move_slot)?;
    let target_id = occupant(run, target_slot).ok_or(BattleV5Error::Target)?;
    let target = pokemon(run, target_id).ok_or(BattleV5Error::Target)?;
    if target.fainted {
        return Err(BattleV5Error::Target);
    }
    if let Some(owner) = targeting
        && crate::current_defender_abilities::pre_hit_absorb(
            owner, run, actor, target, definition, false,
        )
        .map_err(|_| BattleV5Error::UnsupportedContent)?
        .is_some()
    {
        return Ok(0);
    }
    if matches!(definition.category, MoveCategory::Status)
        || matches!(definition.power, MovePower::None)
    {
        return Ok(0);
    }
    let sources = current_or_legacy_sources(run, actor, definition.id, targeting)?;
    let context = mechanics_context(actor, battle, &sources);
    calculate_damage_with_variance(content, &context, definition, actor, target, false, || {
        Ok(100)
    })
    .map(|result| result.damage)
}

#[allow(clippy::too_many_arguments)]
fn calculate_damage(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    definition: &MoveDefinitionV3,
    actor: &PokemonStateV5,
    target: &PokemonStateV5,
    critical: bool,
    rng: &mut RngRuntime,
) -> Result<u32, BattleV5Error> {
    calculate_damage_observed(content, context, definition, actor, target, critical, rng)
        .map(|result| result.damage)
}

#[derive(Default)]
struct CalculatedDamage {
    damage: u32,
    super_effective: bool,
}

fn calculate_damage_observed(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    definition: &MoveDefinitionV3,
    actor: &PokemonStateV5,
    target: &PokemonStateV5,
    critical: bool,
    rng: &mut RngRuntime,
) -> Result<CalculatedDamage, BattleV5Error> {
    calculate_damage_with_variance(
        content,
        context,
        definition,
        actor,
        target,
        critical,
        || {
            rng.battle_rand_seed_int_range(
                SafeU53::new(85).map_err(|_| BattleV5Error::Overflow)?,
                SafeU53::new(100).map_err(|_| BattleV5Error::Overflow)?,
                RngReason::DamageVariance,
                RngCallsiteId::damage_variance(),
            )
            .map(SafeU53::get)
            .map_err(|error| BattleV5Error::Rng(error.to_string()))
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn calculate_damage_with_variance(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    definition: &MoveDefinitionV3,
    actor: &PokemonStateV5,
    target: &PokemonStateV5,
    critical: bool,
    variance: impl FnOnce() -> Result<u64, BattleV5Error>,
) -> Result<CalculatedDamage, BattleV5Error> {
    let MovePower::Value(base_power) = definition.power else {
        return Ok(CalculatedDamage::default());
    };
    let power = execute_query_v2(
        content,
        context,
        MechanicQueryV2::MovePower,
        QueryValueV2::Unsigned(u64::from(base_power)),
    )
    .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    if power.cancelled || power.allowed == Some(false) {
        return Ok(CalculatedDamage::default());
    }
    let power = query_u64(power.after)?;
    let (attack, defense) = match definition.category {
        MoveCategory::Physical => (actor.stats.attack, target.stats.defense),
        MoveCategory::Special => (actor.stats.special_attack, target.stats.special_defense),
        MoveCategory::Status => return Ok(CalculatedDamage::default()),
    };
    if defense == 0 {
        return Err(BattleV5Error::Overflow);
    }
    let level_term = u64::from(actor.level)
        .checked_mul(2)
        .and_then(|value| value.checked_div(5))
        .and_then(|value| value.checked_add(2))
        .ok_or(BattleV5Error::Overflow)?;
    let mut damage = level_term
        .checked_mul(power)
        .and_then(|value| value.checked_mul(u64::from(attack)))
        .and_then(|value| value.checked_div(u64::from(defense)))
        .and_then(|value| value.checked_div(50))
        .and_then(|value| value.checked_add(2))
        .ok_or(BattleV5Error::Overflow)?;
    let typeless = definition.id.get().get() == 165;
    if !typeless
        && (actor.types.primary == definition.move_type
            || actor.types.secondary == Some(definition.move_type))
    {
        damage = damage
            .checked_mul(3)
            .and_then(|value| value.checked_div(2))
            .ok_or(BattleV5Error::Overflow)?;
    }
    let effectiveness = if typeless {
        (1, 1)
    } else {
        type_effectiveness(content, definition.move_type, target)
    };
    // The pinned damage calculation returns immunity before damage variance.
    // A true zero multiplier must not become the minimum one point of damage.
    if effectiveness.0 == 0 {
        return Ok(CalculatedDamage::default());
    }
    damage = damage
        .checked_mul(effectiveness.0)
        .and_then(|value| value.checked_div(effectiveness.1))
        .ok_or(BattleV5Error::Overflow)?;
    if critical {
        damage = damage
            .checked_mul(3)
            .and_then(|value| value.checked_div(2))
            .ok_or(BattleV5Error::Overflow)?;
    }
    let variance = variance()?;
    damage = damage
        .checked_mul(variance)
        .and_then(|value| value.checked_div(100))
        .ok_or(BattleV5Error::Overflow)?;
    let query = execute_query_v2(
        content,
        context,
        MechanicQueryV2::Damage,
        QueryValueV2::Unsigned(damage),
    )
    .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    if query.cancelled || query.allowed == Some(false) {
        return Ok(CalculatedDamage::default());
    }
    let damage = query_u64(query.after)?;
    Ok(CalculatedDamage {
        damage: u32::try_from(damage.max(1)).map_err(|_| BattleV5Error::Overflow)?,
        super_effective: effectiveness.0 > effectiveness.1,
    })
}

fn type_effectiveness(
    content: &PreparedBattleContentV3,
    attack: er_types::battle_model::PokemonType,
    target: &PokemonStateV5,
) -> (u64, u64) {
    let mut numerator = 1_u64;
    let mut denominator = 1_u64;
    for defense in [Some(target.types.primary), target.types.secondary]
        .into_iter()
        .flatten()
    {
        match content.pack().type_chart.multiplier(attack, defense) {
            SingleTypeMultiplier::Zero => return (0, 1),
            SingleTypeMultiplier::Half => denominator *= 2,
            SingleTypeMultiplier::One => {}
            SingleTypeMultiplier::Two => numerator *= 2,
        }
    }
    (numerator, denominator)
}

fn resolve_targets(
    run: &RunStateV3,
    source: FieldSlot,
    selection: &BattleTargetSelection,
) -> Result<Vec<FieldSlot>, BattleV5Error> {
    match selection {
        BattleTargetSelection::Selected(slots) => {
            if slots.iter().any(|slot| occupant(run, *slot).is_none()) {
                return Err(BattleV5Error::Target);
            }
            Ok(slots.clone())
        }
        BattleTargetSelection::Implicit => run
            .battle
            .as_ref()
            .ok_or(BattleV5Error::NoBattle)?
            .field
            .slots
            .iter()
            .find(|entry| {
                entry.slot.side != source.side
                    && entry.occupant.is_some_and(|id| {
                        pokemon(run, id).is_some_and(|target| !target.fainted && target.hp > 0)
                    })
            })
            // If all opponents fainted earlier in this turn, preserve the
            // existing no-hit action handling for the last occupied slot.
            .or_else(|| {
                run.battle
                    .as_ref()?
                    .field
                    .slots
                    .iter()
                    .find(|entry| entry.slot.side != source.side && entry.occupant.is_some())
            })
            .map(|entry| vec![entry.slot])
            .ok_or(BattleV5Error::Target),
    }
}

fn current_or_legacy_sources(
    run: &RunStateV3,
    actor: &PokemonStateV5,
    move_id: MoveId,
    targeting: Option<&CurrentTargetExecution<'_>>,
) -> Result<Vec<BehaviorSourceId>, BattleV5Error> {
    let mut sources = active_sources(actor, move_id);
    if let Some(owner) = targeting {
        sources.retain(|source| {
            !matches!(
                source,
                BehaviorSourceId::ActiveAbility { .. } | BehaviorSourceId::PassiveAbility { .. }
            )
        });
        sources.extend(
            owner
                .ability_sources(run, actor)
                .map_err(|_| BattleV5Error::UnsupportedContent)?,
        );
        sources.sort();
        sources.dedup();
    }
    Ok(sources)
}

fn active_sources(actor: &PokemonStateV5, move_id: MoveId) -> Vec<BehaviorSourceId> {
    let mut sources = vec![
        BehaviorSourceId::Move {
            numeric_id: move_id.get(),
        },
        BehaviorSourceId::Species {
            numeric_id: actor.species_id.get(),
        },
        BehaviorSourceId::ActiveAbility {
            numeric_id: actor.abilities.active.get(),
        },
    ];
    for ability in actor.abilities.passives.iter().flatten() {
        sources.push(BehaviorSourceId::PassiveAbility {
            numeric_id: ability.get(),
        });
    }
    for item in &actor.held_items {
        sources.push(BehaviorSourceId::HeldItem {
            registry_key: item.registry_key.clone(),
        });
    }
    sources.sort();
    sources.dedup();
    sources
}

fn mechanics_context<'a>(
    actor: &'a PokemonStateV5,
    battle: &'a BattleStateV5,
    sources: &'a [BehaviorSourceId],
) -> MechanicsContextV2<'a> {
    MechanicsContextV2 {
        active_sources: sources,
        suppressed_sources: &[],
        instance_counter: 0,
        hp_current: i64::from(actor.hp),
        hp_max: i64::from(actor.max_hp),
        turn_index: battle.turn.get().get() as i64,
        wave_index: battle.wave.get().get() as i64,
        level: i64::from(actor.level),
    }
}

fn command_of(accepted: &AcceptedBattleCommand) -> &BattleCommand {
    match accepted {
        AcceptedBattleCommand::Human { proposal, .. } => &proposal.command,
        AcceptedBattleCommand::ScriptedEnemy { command, .. } => &command.command,
    }
}

fn actor_is_active(run: &RunStateV3, slot: FieldSlot, actor: PokemonId) -> bool {
    occupant(run, slot) == Some(actor) && pokemon(run, actor).is_some_and(|value| !value.fainted)
}

fn occupant(run: &RunStateV3, slot: FieldSlot) -> Option<PokemonId> {
    run.battle
        .as_ref()?
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == slot)
        .and_then(|entry| entry.occupant)
}

fn field_contains(run: &RunStateV3, pokemon: PokemonId) -> bool {
    run.battle.as_ref().is_some_and(|battle| {
        battle
            .field
            .slots
            .iter()
            .any(|entry| entry.occupant == Some(pokemon))
    })
}

fn pokemon(run: &RunStateV3, id: PokemonId) -> Option<&PokemonStateV5> {
    run.party
        .iter()
        .find(|pokemon| pokemon.id == id)
        .or_else(|| {
            run.battle
                .as_ref()?
                .enemy_party
                .iter()
                .find(|pokemon| pokemon.id == id)
        })
}

fn pokemon_mut(run: &mut RunStateV3, id: PokemonId) -> Option<&mut PokemonStateV5> {
    if let Some(index) = run.party.iter().position(|pokemon| pokemon.id == id) {
        return run.party.get_mut(index);
    }
    let battle = run.battle.as_mut()?;
    let index = battle
        .enemy_party
        .iter()
        .position(|pokemon| pokemon.id == id)?;
    battle.enemy_party.get_mut(index)
}

fn move_slot_state(
    pokemon: &PokemonStateV5,
    slot: MoveSlotIndex,
) -> Result<&er_types::battle_model::MoveSlotState, BattleV5Error> {
    pokemon
        .moves
        .get(usize::from(slot.get()))
        .and_then(Option::as_ref)
        .ok_or(BattleV5Error::MoveSlot)
}

fn move_slot_state_mut(
    pokemon: &mut PokemonStateV5,
    slot: MoveSlotIndex,
) -> Result<&mut er_types::battle_model::MoveSlotState, BattleV5Error> {
    pokemon
        .moves
        .get_mut(usize::from(slot.get()))
        .and_then(Option::as_mut)
        .ok_or(BattleV5Error::MoveSlot)
}

fn query_i64(value: QueryValueV2) -> Result<i64, BattleV5Error> {
    match value {
        QueryValueV2::Signed(value) => Ok(value),
        QueryValueV2::Unsigned(value) => i64::try_from(value).map_err(|_| BattleV5Error::Overflow),
        _ => Err(BattleV5Error::Mechanics(
            "query returned wrong value kind".to_owned(),
        )),
    }
}

fn query_u64(value: QueryValueV2) -> Result<u64, BattleV5Error> {
    match value {
        QueryValueV2::Unsigned(value) => Ok(value),
        QueryValueV2::Signed(value) => u64::try_from(value).map_err(|_| BattleV5Error::Overflow),
        _ => Err(BattleV5Error::Mechanics(
            "query returned wrong value kind".to_owned(),
        )),
    }
}

fn query_i8(value: QueryValueV2) -> Result<i8, BattleV5Error> {
    i8::try_from(query_i64(value)?).map_err(|_| BattleV5Error::Overflow)
}

fn query_u32(value: QueryValueV2) -> Result<u32, BattleV5Error> {
    u32::try_from(query_u64(value)?).map_err(|_| BattleV5Error::Overflow)
}

fn mechanical_digest(state: &GameStateV5) -> Result<String, BattleV5Error> {
    let digest = content_digest(state).map_err(|error| BattleV5Error::Digest(error.to_string()))?;
    Ok(format!("blake3-v1:{digest}"))
}
