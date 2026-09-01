//! GameRuntimeV6 and the closed production GameActionV1 dispatcher.

use std::sync::Arc;

use er_battle::m7_resolver::{TurnAuthorityContextV1, resolve_turn_v5};
use er_progression::lifecycle::{release_stored_pokemon, reorder_party, transfer_all_held_items};
use er_progression::progression::{fuse_pokemon, replace_move};
use er_rng::audit::RngDraw;
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::GameStateV5;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_command::CommandSet;
use er_types::battle_model::BattleOutcome;
use er_types::{
    BootstrapActionV1, CaptureActionV1, EvolutionActionV1, FusionActionV1, GameActionContextV1,
    GameActionV1, GameContentIdentity, GameControlKindV2, GameControlPlanV2, InventoryActionV1,
    PartyActionV1, ProgressionActionV1, RewardActionV1, RunOutcome, SafeU53, SaveActionV1,
    ScenarioGameActionV1, TerminalActionV1, WorldActionV1,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_run_executor::{RunExecutionContextV1, execute_run_program_hook_v1};
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_material_v6::{
    AppliedGameMaterialLedgerV1, GameActionDomainV2, GameIdentityDomainV1,
    GameMaterialApplyOutcomeV6, GameMaterialV6, GameMutationEvidenceV2, GameMutationKindV2,
    GamePlatformEffectV2, GamePresentationEffectV2, GameTransitionMaterialV6,
    apply_game_material_v6, empty_game_state_digest, game_state_digest,
};

#[derive(Clone, Debug)]
pub enum GameDomainExecutionInputV1 {
    None,
    BootstrapCandidate(GameStateV6),
    BattleTurn {
        commands: CommandSet,
        authority: TurnAuthorityContextV1,
    },
    CaptureDraw(u32),
    SaveGeneration(SafeU53),
}

#[derive(Clone, Debug)]
pub struct GameActionDispatchContextV1 {
    pub action: GameActionContextV1,
    pub input: GameDomainExecutionInputV1,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PreparedGameTransitionV2 {
    pub candidate: GameStateV6,
    pub material: GameMaterialV6,
    pub material_bytes: Vec<u8>,
    pub next_control: GameControlPlanV2,
    pub mutations: Vec<GameMutationEvidenceV2>,
    pub rng_audit: Vec<RngDraw>,
    pub presentation: Vec<GamePresentationEffectV2>,
    pub platform_effects: Vec<GamePlatformEffectV2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameRuntimeSnapshotV6 {
    pub state: Option<GameStateV6>,
    pub material_ledger: AppliedGameMaterialLedgerV1,
}

#[derive(Clone, Debug)]
pub struct GameRuntimeV6 {
    state: Option<GameStateV6>,
    content: Arc<PreparedGameContentV2>,
    material_ledger: AppliedGameMaterialLedgerV1,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GameActionDispatcherV1;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameRuntimeV6Error {
    #[error("runtime V6 state, content, action, or domain input is invalid")]
    Invalid,
    #[error("runtime V6 action is not valid for the current state")]
    Action,
    #[error("runtime V6 domain execution failed: {0}")]
    Domain(String),
    #[error("runtime V6 material failed: {0}")]
    Material(String),
    #[error("runtime V6 candidate differs from common material application")]
    CandidateMismatch,
}

#[derive(Default)]
struct DomainExecutionV1 {
    candidate: Option<GameStateV6>,
    rng_audit: Vec<RngDraw>,
    presentation: Vec<GamePresentationEffectV2>,
    platform_effects: Vec<GamePlatformEffectV2>,
    allocated_identities: Vec<(GameIdentityDomainV1, SafeU53)>,
}

impl GameRuntimeV6 {
    pub fn new(
        state: Option<GameStateV6>,
        content: Arc<PreparedGameContentV2>,
        next_authority_revision: SafeU53,
    ) -> Result<Self, GameRuntimeV6Error> {
        if let Some(state) = &state {
            state
                .validate_with(content.as_ref())
                .map_err(|_| GameRuntimeV6Error::Invalid)?;
        }
        Ok(Self {
            state,
            content,
            material_ledger: AppliedGameMaterialLedgerV1::new(next_authority_revision)
                .map_err(material_error)?,
        })
    }

    pub fn from_snapshot(
        snapshot: GameRuntimeSnapshotV6,
        content: Arc<PreparedGameContentV2>,
    ) -> Result<Self, GameRuntimeV6Error> {
        snapshot
            .material_ledger
            .validate()
            .map_err(material_error)?;
        if let Some(state) = &snapshot.state {
            state
                .validate_with(content.as_ref())
                .map_err(|_| GameRuntimeV6Error::Invalid)?;
        }
        Ok(Self {
            state: snapshot.state,
            content,
            material_ledger: snapshot.material_ledger,
        })
    }

    pub fn snapshot(&self) -> GameRuntimeSnapshotV6 {
        GameRuntimeSnapshotV6 {
            state: self.state.clone(),
            material_ledger: self.material_ledger.clone(),
        }
    }

    pub fn state(&self) -> Option<&GameStateV6> {
        self.state.as_ref()
    }

    pub fn content(&self) -> &Arc<PreparedGameContentV2> {
        &self.content
    }

    pub fn material_ledger(&self) -> &AppliedGameMaterialLedgerV1 {
        &self.material_ledger
    }

    pub fn execute(
        &mut self,
        action: GameActionV1,
        context: GameActionDispatchContextV1,
    ) -> Result<PreparedGameTransitionV2, GameRuntimeV6Error> {
        let prepared = GameActionDispatcherV1::prepare(
            self.state.as_ref(),
            self.content.as_ref(),
            &self.material_ledger,
            action,
            context,
        )?;
        let outcome = apply_game_material_v6(
            &mut self.state,
            &mut self.material_ledger,
            self.content.as_ref(),
            &prepared.material_bytes,
        )
        .map_err(material_error)?;
        if outcome != GameMaterialApplyOutcomeV6::Applied
            || self.state.as_ref() != Some(&prepared.candidate)
        {
            return Err(GameRuntimeV6Error::CandidateMismatch);
        }
        Ok(prepared)
    }

    pub fn apply_material_bytes(
        &mut self,
        bytes: &[u8],
    ) -> Result<GameMaterialApplyOutcomeV6, GameRuntimeV6Error> {
        apply_game_material_v6(
            &mut self.state,
            &mut self.material_ledger,
            self.content.as_ref(),
            bytes,
        )
        .map_err(material_error)
    }
}

impl GameActionDispatcherV1 {
    pub fn prepare(
        before: Option<&GameStateV6>,
        content: &PreparedGameContentV2,
        ledger: &AppliedGameMaterialLedgerV1,
        action: GameActionV1,
        context: GameActionDispatchContextV1,
    ) -> Result<PreparedGameTransitionV2, GameRuntimeV6Error> {
        action.validate().map_err(|_| GameRuntimeV6Error::Action)?;
        if context.action.operation_id.as_str().is_empty()
            || context.action.authority_revision != ledger.next_authority_revision
        {
            return Err(GameRuntimeV6Error::Invalid);
        }
        let domain = action_domain(&action, &context.input)?;
        let execution = execute_domain(before, content, &action, &context)?;
        let mut candidate = execution.candidate.ok_or(GameRuntimeV6Error::Invalid)?;
        let next_control =
            normalize_next_control(&mut candidate, context.action.authority_revision)?;
        candidate
            .validate_with(content)
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
        let before_digest = match before {
            Some(state) => game_state_digest(state).map_err(material_error)?,
            None => empty_game_state_digest().map_err(material_error)?,
        };
        let after_digest = game_state_digest(&candidate).map_err(material_error)?;
        let mut mutations = Vec::new();
        if before != Some(&candidate) {
            mutations.push(GameMutationEvidenceV2 {
                ordinal: 0,
                domain,
                kind: GameMutationKindV2::StateChanged,
                before_digest: before_digest.clone(),
                after_digest: after_digest.clone(),
            });
        }
        for (identity_domain, identity) in execution.allocated_identities {
            let ordinal =
                u32::try_from(mutations.len()).map_err(|_| GameRuntimeV6Error::Invalid)?;
            mutations.push(GameMutationEvidenceV2 {
                ordinal,
                domain,
                kind: GameMutationKindV2::IdentityAllocated {
                    domain: identity_domain,
                    identity,
                },
                before_digest: before_digest.clone(),
                after_digest: after_digest.clone(),
            });
        }
        let transition = GameTransitionMaterialV6 {
            schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
            domain,
            operation_id: context.action.operation_id,
            authority_seat: context.action.authority_seat,
            authority_revision: context.action.authority_revision,
            content_identity: content.identity().clone(),
            accepted_action: Some(action),
            before_digest,
            after_digest,
            mutations: mutations.clone(),
            rng_audit: execution.rng_audit.clone(),
            after_state: candidate.clone(),
            next_control: next_control.clone(),
            presentation: execution.presentation.clone(),
            platform_effects: execution.platform_effects.clone(),
        };
        let material = material_for_domain(domain, transition)?;
        let material_bytes = material.canonical_bytes().map_err(material_error)?;
        let mut proof_state = before.cloned();
        let mut proof_ledger = ledger.clone();
        let outcome = apply_game_material_v6(
            &mut proof_state,
            &mut proof_ledger,
            content,
            &material_bytes,
        )
        .map_err(material_error)?;
        if outcome != GameMaterialApplyOutcomeV6::Applied
            || proof_state.as_ref() != Some(&candidate)
        {
            return Err(GameRuntimeV6Error::CandidateMismatch);
        }
        Ok(PreparedGameTransitionV2 {
            candidate,
            material,
            material_bytes,
            next_control,
            mutations,
            rng_audit: execution.rng_audit,
            presentation: execution.presentation,
            platform_effects: execution.platform_effects,
        })
    }
}

fn execute_domain(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &GameActionV1,
    context: &GameActionDispatchContextV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    match action {
        GameActionV1::Bootstrap { action: bootstrap } => {
            execute_bootstrap(before, content, bootstrap, &context.input)
        }
        GameActionV1::ExecuteRunProgram {
            program,
            hook,
            context: run_context,
        } => {
            require_none_input(&context.input)?;
            let before = require_state(before)?;
            let transition = execute_run_program_hook_v1(
                &project_v5(before),
                content,
                *program,
                *hook,
                RunExecutionContextV1 {
                    pokemon: run_context.pokemon,
                    scenario_target: run_context.scenario_target,
                },
            )
            .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            Ok(DomainExecutionV1 {
                candidate: Some(adopt_v5(before, transition.after_state)?),
                ..Default::default()
            })
        }
        GameActionV1::Battle { action } => execute_battle(before, content, action, &context.input),
        GameActionV1::Party { action } => execute_party(before, action, &context.input),
        GameActionV1::MoveLearning { action } => {
            execute_move_learning(before, action, &context.input)
        }
        GameActionV1::Fusion { action } => execute_fusion(before, action, &context.input),
        GameActionV1::World { action } => execute_world(before, action, &context.input),
        GameActionV1::Scenario { action } => execute_scenario(before, action, &context.input),
        GameActionV1::Save { action } => execute_save(before, action, &context.input),
        GameActionV1::Terminal { action } => execute_terminal(before, action, &context.input),
        GameActionV1::Capture { action } => execute_capture(
            before,
            content,
            action,
            context.action.authority_seat,
            &context.input,
        ),
        GameActionV1::Progression { action } => {
            execute_progression(before, content, action, &context.input)
        }
        GameActionV1::Evolution { action } => {
            execute_evolution(before, content, action, &context.input)
        }
        GameActionV1::Inventory { action } => execute_inventory(before, action, &context.input),
        GameActionV1::Reward { action } => execute_reward(before, action, &context.input),
    }
}

fn execute_bootstrap(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &BootstrapActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    if before.is_some() || !matches!(action, BootstrapActionV1::Confirm) {
        return Err(GameRuntimeV6Error::Action);
    }
    let GameDomainExecutionInputV1::BootstrapCandidate(candidate) = input else {
        return Err(GameRuntimeV6Error::Invalid);
    };
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    Ok(DomainExecutionV1 {
        candidate: Some(candidate.clone()),
        ..Default::default()
    })
}

fn execute_battle(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &er_types::BattleUiActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    let before = require_state(before)?;
    if let er_types::BattleUiActionV1::SelectReplacement {
        occurrence,
        field,
        party_slot,
    } = action
    {
        require_none_input(input)?;
        let mut candidate = before.clone();
        let run = candidate
            .active_run
            .as_mut()
            .ok_or(GameRuntimeV6Error::Action)?;
        let replacement = run
            .party
            .get(usize::from(party_slot.get()))
            .filter(|pokemon| !pokemon.fainted)
            .map(|pokemon| pokemon.id)
            .ok_or(GameRuntimeV6Error::Action)?;
        let battle = run.battle.as_mut().ok_or(GameRuntimeV6Error::Action)?;
        if battle
            .field
            .slots
            .iter()
            .any(|slot| slot.occupant == Some(replacement))
        {
            return Err(GameRuntimeV6Error::Action);
        }
        let faint = battle
            .faint_queue
            .iter_mut()
            .find(|faint| faint.id == *occurrence && faint.slot == *field)
            .ok_or(GameRuntimeV6Error::Action)?;
        let slot = battle
            .field
            .slots
            .iter_mut()
            .find(|slot| slot.slot == *field)
            .ok_or(GameRuntimeV6Error::Action)?;
        slot.occupant = Some(replacement);
        faint.replacement = er_types::battle_model::ReplacementProgress::Applied;
        return Ok(DomainExecutionV1 {
            candidate: Some(candidate),
            ..Default::default()
        });
    }
    let GameDomainExecutionInputV1::BattleTurn {
        commands,
        authority,
    } = input
    else {
        return Err(GameRuntimeV6Error::Invalid);
    };
    let transition = resolve_turn_v5(&project_v5(before), commands, &content.battle, authority)
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    Ok(DomainExecutionV1 {
        candidate: Some(adopt_v5(before, transition.after_state)?),
        rng_audit: transition.rng_audit,
        ..Default::default()
    })
}

fn execute_party(
    before: Option<&GameStateV6>,
    action: &PartyActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let before = require_state(before)?;
    match action {
        PartyActionV1::SendToStorage { pokemon } => {
            let (candidate, slot) = send_party_to_storage(before, *pokemon)
                .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            Ok(DomainExecutionV1 {
                candidate: Some(candidate),
                allocated_identities: vec![(GameIdentityDomainV1::StorageSlot, slot.get())],
                ..Default::default()
            })
        }
        PartyActionV1::ChooseFullPartyDestination { pokemon, replace } => {
            let candidate = choose_full_party_destination(before, *pokemon, *replace)
                .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            Ok(DomainExecutionV1 {
                candidate: Some(candidate),
                ..Default::default()
            })
        }
        _ => {
            let legacy = project_v5(before);
            let after = match action {
                PartyActionV1::Reorder { from, to } => {
                    reorder_party(&legacy, usize::from(from.get()), usize::from(to.get()))
                        .map(|value| value.0)
                }
                PartyActionV1::Release { storage_slot } => {
                    release_stored_pokemon(&legacy, *storage_slot).map(|value| value.0)
                }
                PartyActionV1::TransferHeldItems { source, target } => {
                    transfer_all_held_items(&legacy, *source, *target).map(|value| value.0)
                }
                PartyActionV1::Cancel => Ok(legacy),
                PartyActionV1::SendToStorage { .. }
                | PartyActionV1::ChooseFullPartyDestination { .. } => {
                    return Err(GameRuntimeV6Error::Action);
                }
            }
            .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            Ok(DomainExecutionV1 {
                candidate: Some(adopt_v5(before, after)?),
                ..Default::default()
            })
        }
    }
}

fn execute_move_learning(
    before: Option<&GameStateV6>,
    action: &er_types::MoveLearningActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let before = require_state(before)?;
    let after = match action {
        er_types::MoveLearningActionV1::Replace {
            pokemon,
            move_id,
            slot,
        } => replace_move(&project_v5(before), *pokemon, *slot, *move_id)
            .map(|transition| transition.after_state)
            .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?,
        er_types::MoveLearningActionV1::Refuse { .. } => project_v5(before),
    };
    Ok(DomainExecutionV1 {
        candidate: Some(adopt_v5(before, after)?),
        ..Default::default()
    })
}

fn execute_fusion(
    before: Option<&GameStateV6>,
    action: &FusionActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let before = require_state(before)?;
    let after = match action {
        FusionActionV1::Fuse { primary, partner } => {
            fuse_pokemon(&project_v5(before), *primary, *partner)
                .map(|transition| transition.after_state)
                .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?
        }
        FusionActionV1::Cancel => project_v5(before),
    };
    Ok(DomainExecutionV1 {
        candidate: Some(adopt_v5(before, after)?),
        ..Default::default()
    })
}

fn execute_world(
    before: Option<&GameStateV6>,
    action: &WorldActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    match action {
        WorldActionV1::SelectRoute { route } => run.world.route = *route,
        WorldActionV1::SelectBiome { biome } => {
            run.world.previous_biome = Some(run.world.biome);
            run.world.biome = *biome;
            run.world.travel_target = None;
        }
        WorldActionV1::Stay => run.world.leave_biome_now = false,
        WorldActionV1::Leave => run.world.leave_biome_now = true,
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn execute_scenario(
    before: Option<&GameStateV6>,
    action: &ScenarioGameActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let scenario = run.scenario.as_mut().ok_or(GameRuntimeV6Error::Action)?;
    let node = match action {
        ScenarioGameActionV1::Advance { node }
        | ScenarioGameActionV1::Choose { node, .. }
        | ScenarioGameActionV1::SelectPartyTarget { node, .. }
        | ScenarioGameActionV1::SelectItemTarget { node, .. }
        | ScenarioGameActionV1::Complete { node } => *node,
    };
    scenario.node = node;
    scenario.visit_count = safe_increment(scenario.visit_count)?;
    if matches!(action, ScenarioGameActionV1::Complete { .. }) {
        run.scenario = None;
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn execute_save(
    before: Option<&GameStateV6>,
    action: &SaveActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    let mut candidate = require_state(before)?.clone();
    let generation = match input {
        GameDomainExecutionInputV1::SaveGeneration(generation) => *generation,
        GameDomainExecutionInputV1::None if matches!(action, SaveActionV1::Cancel) => safe_one(),
        _ => return Err(GameRuntimeV6Error::Invalid),
    };
    let mut output = DomainExecutionV1::default();
    if let SaveActionV1::Write { slot } = action {
        let request = candidate
            .identities
            .allocate_platform_request_id()
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
        let save = GameSaveV2::new(
            candidate.content_identity.clone(),
            generation,
            candidate.clone(),
        )
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
        output
            .platform_effects
            .push(GamePlatformEffectV2::StorageWrite {
                request,
                slot: slot.clone(),
                generation,
                bytes: save
                    .encode()
                    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?,
            });
        output
            .allocated_identities
            .push((GameIdentityDomainV1::PlatformRequest, request.get()));
    } else if let SaveActionV1::Load { slot } | SaveActionV1::Delete { slot } = action {
        let request = candidate
            .identities
            .allocate_platform_request_id()
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
        let effect = if matches!(action, SaveActionV1::Load { .. }) {
            GamePlatformEffectV2::StorageRead {
                request,
                slot: slot.clone(),
            }
        } else {
            GamePlatformEffectV2::StorageDelete {
                request,
                slot: slot.clone(),
            }
        };
        output.platform_effects.push(effect);
        output
            .allocated_identities
            .push((GameIdentityDomainV1::PlatformRequest, request.get()));
    }
    output.candidate = Some(candidate);
    Ok(output)
}

fn execute_terminal(
    before: Option<&GameStateV6>,
    action: &TerminalActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    match action {
        TerminalActionV1::ConfirmOutcome { outcome } => {
            run.outcome = match outcome {
                BattleOutcome::Victory => RunOutcome::Victory,
                BattleOutcome::Defeat => RunOutcome::Defeat,
                BattleOutcome::Ongoing => return Err(GameRuntimeV6Error::Action),
            };
        }
        TerminalActionV1::ReturnToTitle => run.outcome = RunOutcome::Defeat,
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn execute_capture(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &CaptureActionV1,
    owner: er_types::SeatId,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    let before = require_state(before)?;
    let CaptureActionV1::Attempt { target, ball } = action else {
        require_none_input(input)?;
        return Ok(DomainExecutionV1 {
            candidate: Some(before.clone()),
            ..Default::default()
        });
    };
    let run = before
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let battle = run.battle.as_ref().ok_or(GameRuntimeV6Error::Action)?;
    let target_state = battle
        .enemy_party
        .iter()
        .find(|pokemon| pokemon.id == *target && !pokemon.fainted)
        .ok_or(GameRuntimeV6Error::Action)?;
    if !battle.field.slots.iter().any(|slot| {
        slot.slot.side == er_types::battle_ids::BattleSide::Enemy && slot.occupant == Some(*target)
    }) {
        return Err(GameRuntimeV6Error::Action);
    }
    let ball_definition = content
        .progression
        .capture_ball(*ball)
        .ok_or(GameRuntimeV6Error::Action)?;
    let species = content
        .progression
        .species(target_state.species_id, target_state.form_index)
        .ok_or(GameRuntimeV6Error::Action)?;
    let draw = match input {
        GameDomainExecutionInputV1::CaptureDraw(draw) if *draw < 256 => *draw,
        GameDomainExecutionInputV1::None if ball_definition.guaranteed => 0,
        _ => return Err(GameRuntimeV6Error::Invalid),
    };
    let threshold = if ball_definition.guaranteed {
        256
    } else {
        capture_threshold(
            target_state.hp,
            target_state.max_hp,
            species.catch_rate,
            ball_definition.catch_multiplier_numerator,
            ball_definition.catch_multiplier_denominator,
        )?
    };
    let captured = draw < threshold;
    let store_capture = captured && run.party.len() >= er_progression::lifecycle::PARTY_CAPACITY;
    let mut candidate = before.clone();
    let storage_slot = if store_capture {
        Some(
            candidate
                .identities
                .allocate_storage_slot_id()
                .map_err(|_| GameRuntimeV6Error::Invalid)?,
        )
    } else {
        None
    };
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let inventory_index = run
        .inventory
        .entries
        .iter()
        .position(|entry| entry.item == *ball && entry.count > 0)
        .ok_or(GameRuntimeV6Error::Action)?;
    run.inventory.entries[inventory_index].count -= 1;
    if run.inventory.entries[inventory_index].count == 0 {
        run.inventory.entries.remove(inventory_index);
    }
    if captured {
        let battle = run.battle.as_mut().ok_or(GameRuntimeV6Error::Action)?;
        let index = battle
            .enemy_party
            .iter()
            .position(|pokemon| pokemon.id == *target)
            .ok_or(GameRuntimeV6Error::Action)?;
        let mut pokemon = battle.enemy_party.remove(index);
        pokemon.owner_seat = Some(owner);
        pokemon.capture = Some(er_state::m7_state::CaptureMetadataV1 {
            ball: *ball,
            wave: run.wave,
            original_owner_seat: target_state.owner_seat,
            original_trainer_id: None,
        });
        for slot in &mut battle.field.slots {
            if slot.occupant == Some(*target) {
                slot.occupant = None;
            }
        }
        if let Some(slot) = storage_slot {
            run.storage
                .push(er_state::m7_state::StoredPokemonV1 { slot, pokemon });
            run.storage.sort_by_key(|entry| entry.slot);
        } else {
            run.party.push(pokemon);
        }
        candidate.profile.statistics.pokemon_captured =
            safe_increment(candidate.profile.statistics.pokemon_captured)?;
    }
    let mut output = DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    };
    if let Some(slot) = storage_slot {
        output
            .allocated_identities
            .push((GameIdentityDomainV1::StorageSlot, slot.get()));
    }
    Ok(output)
}

fn execute_progression(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &ProgressionActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let sequence = match action {
        ProgressionActionV1::AcceptTask { sequence }
        | ProgressionActionV1::DeclineTask { sequence } => *sequence,
    };
    let task = candidate
        .active_run
        .as_ref()
        .and_then(|run| {
            run.progression_queue
                .tasks
                .iter()
                .find(|task| task.sequence == sequence)
        })
        .cloned()
        .ok_or(GameRuntimeV6Error::Action)?;
    if matches!(action, ProgressionActionV1::AcceptTask { .. }) {
        match task.kind {
            er_state::m7_state::ProgressionTaskKindV2::GrantExperience(amount) => {
                grant_experience_v2(&mut candidate, content, task.pokemon, amount)?;
            }
            er_state::m7_state::ProgressionTaskKindV2::LearnMove(move_id) => {
                learn_move_v2(&mut candidate, task.pokemon, move_id)?;
            }
            er_state::m7_state::ProgressionTaskKindV2::Evolve(evolution) => {
                apply_evolution_v2(&mut candidate, content, task.pokemon, evolution)?;
            }
            er_state::m7_state::ProgressionTaskKindV2::ChangeForm(form) => {
                let pokemon = persistent_pokemon_mut(&mut candidate, task.pokemon)?;
                if content
                    .progression
                    .species(pokemon.species_id, form)
                    .is_none()
                {
                    return Err(GameRuntimeV6Error::Action);
                }
                pokemon.form_index = form;
            }
        }
    }
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let index = run
        .progression_queue
        .tasks
        .iter()
        .position(|task| task.sequence == sequence)
        .ok_or(GameRuntimeV6Error::Action)?;
    run.progression_queue.tasks.remove(index);
    run.progression_queue.active_index = None;
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn execute_evolution(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &EvolutionActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    match action {
        EvolutionActionV1::Complete { pokemon, evolution } => {
            apply_evolution_v2(&mut candidate, content, *pokemon, *evolution)?;
        }
        EvolutionActionV1::Cancel { pokemon, evolution } => {
            let pokemon = persistent_pokemon_mut(&mut candidate, *pokemon)?;
            if !pokemon.evolution.cancelled.contains(evolution) {
                pokemon.evolution.cancelled.push(*evolution);
                pokemon.evolution.cancelled.sort();
            }
        }
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn execute_inventory(
    before: Option<&GameStateV6>,
    action: &InventoryActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    match action {
        InventoryActionV1::Discard { item, count } => {
            if *count == 0 {
                return Err(GameRuntimeV6Error::Action);
            }
            let index = run
                .inventory
                .entries
                .iter()
                .position(|entry| entry.item == *item && entry.count >= *count)
                .ok_or(GameRuntimeV6Error::Action)?;
            run.inventory.entries[index].count -= *count;
            if run.inventory.entries[index].count == 0 {
                run.inventory.entries.remove(index);
            }
        }
        InventoryActionV1::Use { item, .. } => {
            let index = run
                .inventory
                .entries
                .iter()
                .position(|entry| entry.item == *item && entry.count > 0)
                .ok_or(GameRuntimeV6Error::Action)?;
            run.inventory.entries[index].count -= 1;
            if run.inventory.entries[index].count == 0 {
                run.inventory.entries.remove(index);
            }
        }
        InventoryActionV1::Transfer { .. } => return Err(GameRuntimeV6Error::Action),
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn execute_reward(
    before: Option<&GameStateV6>,
    action: &RewardActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    match action {
        RewardActionV1::Reroll => {
            run.world.encounter_sequence = safe_increment(run.world.encounter_sequence)?;
        }
        RewardActionV1::ToggleLock { option_ordinal } => {
            run.flags.insert(
                er_types::RunFlagId::new(safe_from_u64(u64::from(*option_ordinal) + 1)?),
                true,
            );
        }
        RewardActionV1::Select { option_ordinal } => {
            run.world.encounter_sequence = safe_increment(run.world.encounter_sequence)?;
            run.flags.insert(
                er_types::RunFlagId::new(safe_from_u64(u64::from(*option_ordinal) + 1)?),
                false,
            );
        }
        RewardActionV1::Decline => {}
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn action_domain(
    action: &GameActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<GameActionDomainV2, GameRuntimeV6Error> {
    Ok(match action {
        GameActionV1::Bootstrap { .. } => GameActionDomainV2::NewRun,
        GameActionV1::ExecuteRunProgram { .. } => GameActionDomainV2::RunProgram,
        GameActionV1::Battle {
            action: er_types::BattleUiActionV1::SelectReplacement { .. },
        } => GameActionDomainV2::BattleReplacement,
        GameActionV1::Battle { .. } => {
            if !matches!(input, GameDomainExecutionInputV1::BattleTurn { .. }) {
                return Err(GameRuntimeV6Error::Invalid);
            }
            GameActionDomainV2::BattleTurn
        }
        GameActionV1::Capture { .. } => GameActionDomainV2::Capture,
        GameActionV1::Party { .. } => GameActionDomainV2::Party,
        GameActionV1::Progression { .. } => GameActionDomainV2::Progression,
        GameActionV1::MoveLearning { .. } => GameActionDomainV2::MoveLearning,
        GameActionV1::Evolution { .. } => GameActionDomainV2::Evolution,
        GameActionV1::Fusion { .. } => GameActionDomainV2::Fusion,
        GameActionV1::Inventory { .. } => GameActionDomainV2::Inventory,
        GameActionV1::Reward { .. } => GameActionDomainV2::Reward,
        GameActionV1::World { .. } => GameActionDomainV2::World,
        GameActionV1::Scenario { .. } => GameActionDomainV2::Scenario,
        GameActionV1::Save { .. } => GameActionDomainV2::SaveControl,
        GameActionV1::Terminal { .. } => GameActionDomainV2::Terminal,
    })
}

fn material_for_domain(
    domain: GameActionDomainV2,
    transition: GameTransitionMaterialV6,
) -> Result<GameMaterialV6, GameRuntimeV6Error> {
    Ok(match domain {
        GameActionDomainV2::NewRun => GameMaterialV6::NewRun(transition),
        GameActionDomainV2::BattleTurn => GameMaterialV6::BattleTurn(transition),
        GameActionDomainV2::BattleReplacement => GameMaterialV6::BattleReplacement(transition),
        GameActionDomainV2::Terminal => GameMaterialV6::Terminal(transition),
        _ => GameMaterialV6::GameAction(transition),
    })
}

fn normalize_next_control(
    candidate: &mut GameStateV6,
    revision: SafeU53,
) -> Result<GameControlPlanV2, GameRuntimeV6Error> {
    let Some(run) = candidate.active_run.as_mut() else {
        return Ok(GameControlPlanV2 {
            schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
            revision,
            kind: GameControlKindV2::Title,
            owner_seat: None,
            action_context: None,
            menu: None,
            actionable: false,
        });
    };
    if run.control.revision == revision && run.control.validate().is_ok() {
        return Ok(run.control.clone());
    }
    let kind = if !matches!(run.outcome, RunOutcome::InProgress) {
        GameControlKindV2::Complete
    } else {
        GameControlKindV2::Waiting
    };
    run.control = GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision,
        kind,
        owner_seat: None,
        action_context: None,
        menu: None,
        actionable: false,
    };
    Ok(run.control.clone())
}

fn project_v5(state: &GameStateV6) -> GameStateV5 {
    GameStateV5 {
        schema_version: er_state::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: GameContentIdentity {
            oracle_sha: state.content_identity.oracle_sha.clone(),
            content_hash: state.content_identity.bundle_hash.clone(),
            battle_content_hash: state.content_identity.battle_hash.clone(),
            semantic_catalog_hash: state.content_identity.semantic_catalog_hash.clone(),
        },
        profile: state.profile.clone(),
        active_run: state.active_run.clone(),
    }
}

fn adopt_v5(before: &GameStateV6, after: GameStateV5) -> Result<GameStateV6, GameRuntimeV6Error> {
    after
        .validate()
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let candidate = GameStateV6 {
        schema_version: before.schema_version,
        content_identity: before.content_identity.clone(),
        identities: before.identities.clone(),
        profile: after.profile,
        active_run: after.active_run,
    };
    candidate
        .validate()
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    Ok(candidate)
}

fn send_party_to_storage(
    before: &GameStateV6,
    pokemon: er_types::battle_ids::PokemonId,
) -> Result<(GameStateV6, er_types::StorageSlotId), er_progression::lifecycle::LifecycleError> {
    let mut candidate = before.clone();
    let slot = candidate
        .identities
        .allocate_storage_slot_id()
        .map_err(|_| er_progression::lifecycle::LifecycleError::Overflow)?;
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(er_progression::lifecycle::LifecycleError::Party)?;
    let index = run
        .party
        .iter()
        .position(|entry| entry.id == pokemon)
        .ok_or(er_progression::lifecycle::LifecycleError::Party)?;
    let pokemon = run.party.remove(index);

    run.storage
        .push(er_state::m7_state::StoredPokemonV1 { slot, pokemon });
    run.storage.sort_by_key(|entry| entry.slot);
    Ok((candidate, slot))
}
fn grant_experience_v2(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    pokemon_id: er_types::battle_ids::PokemonId,
    amount: er_types::run_ids::Experience,
) -> Result<(), GameRuntimeV6Error> {
    let pokemon = persistent_pokemon(state, pokemon_id)?;
    let definition = content
        .progression
        .species(pokemon.species_id, pokemon.form_index)
        .ok_or(GameRuntimeV6Error::Action)?;
    let growth = content
        .progression
        .growth_rate(definition.growth_rate)
        .ok_or(GameRuntimeV6Error::Action)?;
    let experience = pokemon
        .experience
        .get()
        .get()
        .checked_add(amount.get().get())
        .ok_or(GameRuntimeV6Error::Invalid)?;
    let level = growth
        .experience_by_level
        .partition_point(|required| required.get().get() <= experience)
        .max(1);
    let level = u16::try_from(level).map_err(|_| GameRuntimeV6Error::Invalid)?;
    let pokemon = persistent_pokemon_mut(state, pokemon_id)?;
    pokemon.experience = er_types::run_ids::Experience::new(safe_from_u64(experience)?);
    pokemon.level = level;
    Ok(())
}

fn learn_move_v2(
    state: &mut GameStateV6,
    pokemon_id: er_types::battle_ids::PokemonId,
    move_id: er_types::battle_ids::MoveId,
) -> Result<(), GameRuntimeV6Error> {
    let pokemon = persistent_pokemon_mut(state, pokemon_id)?;
    if pokemon
        .moves
        .iter()
        .flatten()
        .any(|slot| slot.move_id == move_id)
    {
        return Ok(());
    }
    let slot = pokemon
        .moves
        .iter_mut()
        .find(|slot| slot.is_none())
        .ok_or(GameRuntimeV6Error::Action)?;
    *slot = Some(er_types::battle_model::MoveSlotState {
        move_id,
        pp_used: 0,
        pp_ups: 0,
        max_pp_override: None,
    });
    Ok(())
}

fn apply_evolution_v2(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    pokemon_id: er_types::battle_ids::PokemonId,
    evolution_id: er_types::EvolutionId,
) -> Result<(), GameRuntimeV6Error> {
    let evolution = content
        .progression
        .evolution(evolution_id)
        .ok_or(GameRuntimeV6Error::Action)?;
    let pokemon = persistent_pokemon(state, pokemon_id)?;
    if pokemon.pause_evolutions
        || pokemon.species_id != evolution.source_species
        || evolution
            .source_form
            .is_some_and(|form| pokemon.form_index != form)
        || !evolution_condition_met(&evolution.condition, pokemon)
    {
        return Err(GameRuntimeV6Error::Action);
    }
    if let Some(item) = evolution.consume_item {
        let run = state
            .active_run
            .as_mut()
            .ok_or(GameRuntimeV6Error::Action)?;
        let index = run
            .inventory
            .entries
            .iter()
            .position(|entry| entry.item == item && entry.count > 0)
            .ok_or(GameRuntimeV6Error::Action)?;
        run.inventory.entries[index].count -= 1;
        if run.inventory.entries[index].count == 0 {
            run.inventory.entries.remove(index);
        }
    }
    let pokemon = persistent_pokemon_mut(state, pokemon_id)?;
    pokemon.species_id = evolution.target_species;
    pokemon.form_index = evolution.target_form;
    pokemon.evolution.last_completed = Some(evolution_id);
    Ok(())
}

fn evolution_condition_met(
    condition: &er_progression::content_v2::EvolutionConditionV2,
    pokemon: &er_state::m7_state::PokemonStateV5,
) -> bool {
    use er_progression::content_v2::EvolutionConditionV2 as Condition;
    match condition {
        Condition::Always => true,
        Condition::MinimumLevel(level) => pokemon.level >= *level,
        Condition::MinimumFriendship(friendship) => pokemon.friendship >= *friendship,
        Condition::Gender(gender) => pokemon.gender == Some(*gender),
        Condition::KnownMove(move_id) => pokemon
            .moves
            .iter()
            .flatten()
            .any(|slot| slot.move_id == *move_id),
        Condition::Nature(natures) => natures.contains(&pokemon.nature.get()),
        Condition::HeldItemKey(key) => pokemon
            .held_items
            .iter()
            .any(|item| item.registry_key == *key),
        Condition::All(conditions) => conditions
            .iter()
            .all(|condition| evolution_condition_met(condition, pokemon)),
        Condition::Any(conditions) => conditions
            .iter()
            .any(|condition| evolution_condition_met(condition, pokemon)),
        Condition::Not(condition) => !evolution_condition_met(condition, pokemon),
        Condition::TimeOfDay(_)
        | Condition::KnownMoveType(_)
        | Condition::PartyType(_)
        | Condition::PartySpecies(_)
        | Condition::Biome(_)
        | Condition::Weather(_)
        | Condition::HeldItem(_)
        | Condition::TreasureAtLeast(_)
        | Condition::RandomForm(_)
        | Condition::SpeciesCaught(_)
        | Condition::FormKey(_)
        | Condition::Shedinja => false,
    }
}

fn persistent_pokemon(
    state: &GameStateV6,
    pokemon_id: er_types::battle_ids::PokemonId,
) -> Result<&er_state::m7_state::PokemonStateV5, GameRuntimeV6Error> {
    let run = state
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    run.party
        .iter()
        .find(|pokemon| pokemon.id == pokemon_id)
        .or_else(|| {
            run.storage
                .iter()
                .map(|stored| &stored.pokemon)
                .find(|pokemon| pokemon.id == pokemon_id)
        })
        .ok_or(GameRuntimeV6Error::Action)
}

fn choose_full_party_destination(
    before: &GameStateV6,
    pokemon: er_types::battle_ids::PokemonId,
    replace: Option<er_types::battle_ids::PartyIndex>,
) -> Result<GameStateV6, er_progression::lifecycle::LifecycleError> {
    let mut candidate = before.clone();
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(er_progression::lifecycle::LifecycleError::Party)?;
    let storage_index = run
        .storage
        .iter()
        .position(|entry| entry.pokemon.id == pokemon)
        .ok_or(er_progression::lifecycle::LifecycleError::Party)?;
    if let Some(replace) = replace {
        let index = usize::from(replace.get());
        if index >= run.party.len() {
            return Err(er_progression::lifecycle::LifecycleError::Party);
        }
        let selected = run.storage.remove(storage_index);
        let displaced = std::mem::replace(&mut run.party[index], selected.pokemon);
        run.storage.push(er_state::m7_state::StoredPokemonV1 {
            slot: selected.slot,
            pokemon: displaced,
        });
        run.storage.sort_by_key(|entry| entry.slot);
    }
    Ok(candidate)
}

fn persistent_pokemon_mut(
    state: &mut GameStateV6,
    pokemon_id: er_types::battle_ids::PokemonId,
) -> Result<&mut er_state::m7_state::PokemonStateV5, GameRuntimeV6Error> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    if let Some(index) = run
        .party
        .iter()
        .position(|pokemon| pokemon.id == pokemon_id)
    {
        return Ok(&mut run.party[index]);
    }
    if let Some(index) = run
        .storage
        .iter()
        .position(|stored| stored.pokemon.id == pokemon_id)
    {
        return Ok(&mut run.storage[index].pokemon);
    }
    Err(GameRuntimeV6Error::Action)
}

fn capture_threshold(
    hp: u32,
    max_hp: u32,
    catch_rate: u16,
    multiplier_numerator: u32,
    multiplier_denominator: u32,
) -> Result<u32, GameRuntimeV6Error> {
    if max_hp == 0 || multiplier_numerator == 0 || multiplier_denominator == 0 {
        return Err(GameRuntimeV6Error::Action);
    }
    let max_hp = u64::from(max_hp);
    let hp_factor = max_hp
        .checked_mul(3)
        .and_then(|value| value.checked_sub(u64::from(hp).checked_mul(2)?))
        .ok_or(GameRuntimeV6Error::Invalid)?;
    let numerator = u64::from(catch_rate)
        .checked_mul(u64::from(multiplier_numerator))
        .and_then(|value| value.checked_mul(hp_factor))
        .ok_or(GameRuntimeV6Error::Invalid)?;
    let denominator = u64::from(multiplier_denominator)
        .checked_mul(max_hp)
        .and_then(|value| value.checked_mul(3))
        .ok_or(GameRuntimeV6Error::Invalid)?;
    u32::try_from(
        numerator
            .checked_div(denominator)
            .ok_or(GameRuntimeV6Error::Invalid)?
            .min(255),
    )
    .map_err(|_| GameRuntimeV6Error::Invalid)
}

fn require_state(state: Option<&GameStateV6>) -> Result<&GameStateV6, GameRuntimeV6Error> {
    state.ok_or(GameRuntimeV6Error::Invalid)
}

fn require_none_input(input: &GameDomainExecutionInputV1) -> Result<(), GameRuntimeV6Error> {
    if matches!(input, GameDomainExecutionInputV1::None) {
        Ok(())
    } else {
        Err(GameRuntimeV6Error::Invalid)
    }
}

fn safe_increment(value: SafeU53) -> Result<SafeU53, GameRuntimeV6Error> {
    let value = value
        .get()
        .checked_add(1)
        .ok_or(GameRuntimeV6Error::Invalid)?;
    safe_from_u64(value)
}

fn safe_from_u64(value: u64) -> Result<SafeU53, GameRuntimeV6Error> {
    SafeU53::new(value).map_err(|_| GameRuntimeV6Error::Invalid)
}

fn safe_one() -> SafeU53 {
    SafeU53::new(1).unwrap_or(SafeU53::MAX)
}

fn material_error(error: crate::m9e_material_v6::GameMaterialV6Error) -> GameRuntimeV6Error {
    GameRuntimeV6Error::Material(error.to_string())
}
