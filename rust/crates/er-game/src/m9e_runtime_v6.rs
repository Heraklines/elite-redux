//! GameRuntimeV6 and the closed production GameActionV1 dispatcher.

use std::sync::Arc;

use er_battle::m7_resolver::{TurnAuthorityContextV1, resolve_turn_v5};
use er_progression::lifecycle::{release_stored_pokemon, reorder_party, transfer_all_held_items};
use er_progression::progression::{fuse_pokemon, replace_move};
use er_rng::audit::RngDraw;
use er_rng::phaser::RunRngState;
use er_save::m9e_save_v2::GameSaveV2;
use er_scenario::content_v2::{ScenarioOptionProgramV2, ScenarioProgramHandlerV2};
use er_scenario::runtime_v2::{
    SCENARIO_RUNTIME_SCHEMA_VERSION_V2, ScenarioControlV2, ScenarioDomainFactoryV2,
    ScenarioInputV2, ScenarioRuntimeV2,
};
use er_state::m7_state::{
    GameStateV5, MapNodeKindV1, MapNodeStateV1, ProgressionTaskKindV2, ProgressionTaskV2,
    RouteRevealSourceV1, ScenarioRuntimeStageV2,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommandOffer, BattleCommandProposalV1, CommandAdmissionSource,
    CommandFrontierEntry, CommandFrontierStatus, CommandSet, OfferedMoveCommand,
    OfferedSwitchCommand,
};
use er_types::battle_ids::MenuInstanceId;
use er_types::battle_model::{BattleOutcome, MoveFlag};
use er_types::run_ids::Experience;
use er_types::{
    BootstrapActionV1, CaptureActionV1, EvolutionActionV1, FusionActionV1, GameActionContextV1,
    GameActionV1, GameContentIdentity, GameControlKindV2, GameControlPlanV2, GameMenuCancelV2,
    InventoryActionV1, OperationId, PartyActionV1, PresentationEventId, ProgressionActionV1,
    RewardActionV1, RunOutcome, SafeU53, SaveActionV1, ScenarioGameActionV1, TerminalActionV1,
    WorldActionV1,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_progression_control::generic_vertical_control_v2;
use crate::m7_run_executor::{RunExecutionContextV1, execute_run_program_hook_v1};
use crate::m9e_content_v2::{
    PreparedGameContentV2, PresentationCueFamilyV1, PresentationSemanticIdV1,
};
use crate::m9e_material_v6::{
    AppliedGameMaterialLedgerV1, AppliedMaterialRetentionV1, GameActionDomainV2,
    GameIdentityDomainV1, GameMaterialApplyOutcomeV6, GameMaterialV6, GameMutationEvidenceV2,
    GameMutationKindV2, GamePlatformEffectV2, GamePresentationEffectV2, GameTransitionMaterialV6,
    apply_game_material_v6_with_retention, empty_game_state_digest, game_state_digest,
};
use crate::m9e_new_run_v6::advance_to_next_encounter_v6;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InventoryUseEffectV1 {
    Heal { amount: u32 },
    CureStatus,
    GrantHeldItem { registry_key: String },
}

#[derive(Clone, Debug, PartialEq)]
#[expect(
    clippy::large_enum_variant,
    reason = "Preserve the public by-value bootstrap input; changing its ownership is a separate API change"
)]
pub enum GameDomainExecutionInputV1 {
    None,
    BootstrapCandidate(GameStateV6),
    BattleCommandRetention {
        proposal: BattleCommandProposalV1,
        source: CommandAdmissionSource,
        next_owner: er_types::SeatId,
    },
    BattleTurn {
        commands: CommandSet,
        authority: TurnAuthorityContextV1,
    },
    CaptureRng {
        draw: u32,
        run_rng: RunRngState,
        audit: Vec<RngDraw>,
    },
    SaveGeneration(SafeU53),
    InventoryUse(InventoryUseEffectV1),
    InventoryTransferKey(String),
    RewardGrant {
        item: er_types::InventoryItemId,
        registry_key: String,
        count: u32,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct GameActionDispatchContextV1 {
    pub action: GameActionContextV1,
    pub input: GameDomainExecutionInputV1,
    pub authority: bool,
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
    material_retention: AppliedMaterialRetentionV1,
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

// Private proof produced by common material application, never supplied by a
// caller through the public, mutable PreparedGameTransitionV2 value.
struct PreparedGameTransitionProof {
    prepared: PreparedGameTransitionV2,
    state: Option<GameStateV6>,
    ledger: AppliedGameMaterialLedgerV1,
}

impl GameRuntimeV6 {
    pub fn new(
        state: Option<GameStateV6>,
        content: Arc<PreparedGameContentV2>,
        next_authority_revision: SafeU53,
    ) -> Result<Self, GameRuntimeV6Error> {
        Self::new_with_retention(
            state,
            content,
            next_authority_revision,
            AppliedMaterialRetentionV1::HistoricalHardStop,
        )
    }

    pub fn new_with_retention(
        state: Option<GameStateV6>,
        content: Arc<PreparedGameContentV2>,
        next_authority_revision: SafeU53,
        material_retention: AppliedMaterialRetentionV1,
    ) -> Result<Self, GameRuntimeV6Error> {
        material_retention.validate().map_err(material_error)?;
        if let Some(state) = &state {
            state
                .validate_with(content.as_ref())
                .map_err(|_| GameRuntimeV6Error::Invalid)?;
        }
        let material_ledger =
            AppliedGameMaterialLedgerV1::new(next_authority_revision).map_err(material_error)?;
        validate_runtime_frontier(state.as_ref(), &material_ledger)?;
        Ok(Self {
            state,
            content,
            material_ledger,
            material_retention,
        })
    }

    pub fn from_snapshot(
        snapshot: GameRuntimeSnapshotV6,
        content: Arc<PreparedGameContentV2>,
    ) -> Result<Self, GameRuntimeV6Error> {
        Self::from_snapshot_with_retention(
            snapshot,
            content,
            AppliedMaterialRetentionV1::HistoricalHardStop,
        )
    }

    /// Policy is supplied explicitly by the restoring adapter, never by wire data.
    pub fn from_snapshot_with_retention(
        snapshot: GameRuntimeSnapshotV6,
        content: Arc<PreparedGameContentV2>,
        material_retention: AppliedMaterialRetentionV1,
    ) -> Result<Self, GameRuntimeV6Error> {
        snapshot
            .material_ledger
            .validate_with_retention(material_retention)
            .map_err(material_error)?;
        if let Some(state) = &snapshot.state {
            state
                .validate_with(content.as_ref())
                .map_err(|_| GameRuntimeV6Error::Invalid)?;
        }
        validate_runtime_frontier(snapshot.state.as_ref(), &snapshot.material_ledger)?;
        Ok(Self {
            state: snapshot.state,
            content,
            material_ledger: snapshot.material_ledger,
            material_retention,
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

    pub fn next_authority_revision(&self) -> SafeU53 {
        self.material_ledger.next_authority_revision
    }

    pub fn material_retention(&self) -> AppliedMaterialRetentionV1 {
        self.material_retention
    }

    pub fn install_control(
        &mut self,
        control: GameControlPlanV2,
    ) -> Result<(), GameRuntimeV6Error> {
        control
            .validate()
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
        if control.revision != self.material_ledger.next_authority_revision {
            return Err(GameRuntimeV6Error::Invalid);
        }
        let state = self.state.as_mut().ok_or(GameRuntimeV6Error::Action)?;
        let run = state
            .active_run
            .as_mut()
            .ok_or(GameRuntimeV6Error::Action)?;
        run.control = control;
        state
            .validate_with(self.content.as_ref())
            .map_err(|_| GameRuntimeV6Error::Invalid)
    }

    pub fn navigate_control(
        &mut self,
        direction: er_types::ui_menu::NavigationDirection,
    ) -> Result<(), GameRuntimeV6Error> {
        let state = self.state.as_mut().ok_or(GameRuntimeV6Error::Action)?;
        let run = state
            .active_run
            .as_mut()
            .ok_or(GameRuntimeV6Error::Action)?;
        if !run.control.actionable {
            return Err(GameRuntimeV6Error::Action);
        }
        let menu = run
            .control
            .menu
            .as_mut()
            .ok_or(GameRuntimeV6Error::Action)?;
        let next = menu
            .navigation
            .iter()
            .find(|edge| edge.from == menu.selected_option_id && edge.direction == direction)
            .map(|edge| edge.to.clone())
            .ok_or(GameRuntimeV6Error::Action)?;
        menu.selected_option_id = next;
        state
            .validate_with(self.content.as_ref())
            .map_err(|_| GameRuntimeV6Error::Invalid)
    }

    pub fn selected_action(
        &self,
    ) -> Result<(GameActionV1, GameActionContextV1), GameRuntimeV6Error> {
        let run = self
            .state
            .as_ref()
            .and_then(|state| state.active_run.as_ref())
            .ok_or(GameRuntimeV6Error::Action)?;
        if !run.control.actionable {
            return Err(GameRuntimeV6Error::Action);
        }
        let menu = run
            .control
            .menu
            .as_ref()
            .ok_or(GameRuntimeV6Error::Action)?;
        let action = menu
            .selected_action()
            .cloned()
            .ok_or(GameRuntimeV6Error::Action)?;
        let context = run
            .control
            .action_context
            .clone()
            .ok_or(GameRuntimeV6Error::Action)?;
        Ok((action, context))
    }

    pub fn cancel_action(&self) -> Result<(GameActionV1, GameActionContextV1), GameRuntimeV6Error> {
        let run = self
            .state
            .as_ref()
            .and_then(|state| state.active_run.as_ref())
            .ok_or(GameRuntimeV6Error::Action)?;
        if !run.control.actionable {
            return Err(GameRuntimeV6Error::Action);
        }
        let menu = run
            .control
            .menu
            .as_ref()
            .ok_or(GameRuntimeV6Error::Action)?;
        let action = match &menu.cancel {
            er_types::GameMenuCancelV2::Select { option_id } => menu
                .options
                .iter()
                .find(|option| option.option_id == *option_id && option.visible && option.enabled)
                .map(|option| option.action.clone())
                .ok_or(GameRuntimeV6Error::Action)?,
            er_types::GameMenuCancelV2::Back { action }
            | er_types::GameMenuCancelV2::Close { action } => (**action).clone(),
            er_types::GameMenuCancelV2::Disabled => return Err(GameRuntimeV6Error::Action),
        };
        let context = run
            .control
            .action_context
            .clone()
            .ok_or(GameRuntimeV6Error::Action)?;
        Ok((action, context))
    }
    pub fn execute(
        &mut self,
        action: GameActionV1,
        context: GameActionDispatchContextV1,
    ) -> Result<PreparedGameTransitionV2, GameRuntimeV6Error> {
        let proof = GameActionDispatcherV1::prepare_with_proof(
            self.state.as_ref(),
            self.content.as_ref(),
            &self.material_ledger,
            action,
            context,
            self.material_retention,
        )?;
        // Preparation already common-applied these bytes under this exact
        // retention policy and checked equality with the returned candidate.
        // No fallible work remains, and no live state changed during the proof.
        self.state = proof.state;
        self.material_ledger = proof.ledger;
        Ok(proof.prepared)
    }

    pub fn apply_material_bytes(
        &mut self,
        bytes: &[u8],
    ) -> Result<GameMaterialApplyOutcomeV6, GameRuntimeV6Error> {
        apply_game_material_v6_with_retention(
            &mut self.state,
            &mut self.material_ledger,
            self.content.as_ref(),
            bytes,
            self.material_retention,
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
        Self::prepare_with_retention(
            before,
            content,
            ledger,
            action,
            context,
            AppliedMaterialRetentionV1::HistoricalHardStop,
        )
    }

    pub fn prepare_with_retention(
        before: Option<&GameStateV6>,
        content: &PreparedGameContentV2,
        ledger: &AppliedGameMaterialLedgerV1,
        action: GameActionV1,
        context: GameActionDispatchContextV1,
        retention: AppliedMaterialRetentionV1,
    ) -> Result<PreparedGameTransitionV2, GameRuntimeV6Error> {
        Self::prepare_with_proof(before, content, ledger, action, context, retention)
            .map(|proof| proof.prepared)
    }

    fn prepare_with_proof(
        before: Option<&GameStateV6>,
        content: &PreparedGameContentV2,
        ledger: &AppliedGameMaterialLedgerV1,
        action: GameActionV1,
        context: GameActionDispatchContextV1,
        retention: AppliedMaterialRetentionV1,
    ) -> Result<PreparedGameTransitionProof, GameRuntimeV6Error> {
        if matches!(retention, AppliedMaterialRetentionV1::BoundedSuffix { .. }) {
            ledger
                .validate_with_retention(retention)
                .map_err(material_error)?;
        }
        action.validate().map_err(|_| GameRuntimeV6Error::Action)?;
        if !context.authority
            || context.action.operation_id.as_str().is_empty()
            || context.action.authority_revision != ledger.next_authority_revision
            || before
                .and_then(|state| state.active_run.as_ref())
                .is_some_and(|run| {
                    run.control.actionable
                        && !control_accepts_action_context(
                            &run.control,
                            &context.action,
                            &context.input,
                        )
                })
        {
            return Err(GameRuntimeV6Error::Invalid);
        }
        let domain = action_domain(&action, &context.input)?;
        let mut execution = execute_domain(before, content, &action, &context)?;
        if execution.presentation.is_empty() {
            let semantic = PresentationSemanticIdV1::Cue(domain_cue(domain));
            let mapping = content
                .presentation(semantic)
                .ok_or(GameRuntimeV6Error::Invalid)?;
            execution.presentation.push(GamePresentationEffectV2 {
                event_id: PresentationEventId::new(context.action.authority_revision),
                semantic,
                blocking: mapping.blocking,
                skip: mapping.skip,
            });
        }
        let mut candidate = execution.candidate.ok_or(GameRuntimeV6Error::Invalid)?;
        let next_control = normalize_next_control(
            &mut candidate,
            safe_increment(context.action.authority_revision)?,
        )?;
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
        let outcome = apply_game_material_v6_with_retention(
            &mut proof_state,
            &mut proof_ledger,
            content,
            &material_bytes,
            retention,
        )
        .map_err(material_error)?;
        if outcome != GameMaterialApplyOutcomeV6::Applied
            || proof_state.as_ref() != Some(&candidate)
        {
            return Err(GameRuntimeV6Error::CandidateMismatch);
        }
        Ok(PreparedGameTransitionProof {
            prepared: PreparedGameTransitionV2 {
                candidate,
                material,
                material_bytes,
                next_control,
                mutations,
                rng_audit: execution.rng_audit,
                presentation: execution.presentation,
                platform_effects: execution.platform_effects,
            },
            state: proof_state,
            ledger: proof_ledger,
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
        GameActionV1::Battle { action } => {
            execute_battle(before, content, action, &context.action, &context.input)
        }
        GameActionV1::Party { action } => execute_party(before, action, &context.input),
        GameActionV1::MoveLearning { action } => {
            execute_move_learning(before, action, &context.input)
        }
        GameActionV1::Fusion { action } => execute_fusion(before, action, &context.input),
        GameActionV1::World { action } => execute_world(before, action, &context.input),
        GameActionV1::Scenario { action } => {
            execute_scenario(before, content, action, &context.input)
        }
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
            execute_progression(before, content, action, &context.action, &context.input)
        }
        GameActionV1::Evolution { action } => {
            execute_evolution(before, content, action, &context.input)
        }
        GameActionV1::Inventory { action } => execute_inventory(before, action, &context.input),
        GameActionV1::Reward { action } => {
            execute_reward(before, content, action, &context.action, &context.input)
        }
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
    action_context: &GameActionContextV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    let before = require_state(before)?;
    if let GameDomainExecutionInputV1::BattleCommandRetention {
        proposal,
        source,
        next_owner,
    } = input
    {
        proposal.validate().map_err(|error| {
            GameRuntimeV6Error::Domain(format!("battle retention proposal: {error}"))
        })?;
        let mut candidate = before.clone();
        let offer = battle_command_offer(&candidate, proposal.actor).map_err(|error| {
            GameRuntimeV6Error::Domain(format!("battle retention offer: {error}"))
        })?;
        let accepted = AcceptedBattleCommand::human(proposal.clone());
        let run = candidate
            .active_run
            .as_mut()
            .ok_or(GameRuntimeV6Error::Action)?;
        let battle = run.battle.as_mut().ok_or(GameRuntimeV6Error::Action)?;
        if battle.battle_id != proposal.battle_id
            || battle.wave != proposal.wave
            || battle.turn != proposal.turn
            || battle.command_state.frontier.iter().any(|entry| {
                entry.operation_id == proposal.operation_id
                    || entry.field_slot == proposal.field_slot
                    || entry.actor == proposal.actor
            })
        {
            return Err(GameRuntimeV6Error::Action);
        }
        battle.command_state.frontier.push(
            CommandFrontierEntry::new(
                proposal.operation_id.clone(),
                Some(proposal.owner_seat),
                proposal.actor,
                proposal.field_slot,
                offer,
                CommandFrontierStatus::Retained {
                    command: accepted,
                    source: *source,
                },
            )
            .map_err(|error| {
                GameRuntimeV6Error::Domain(format!("battle retention frontier: {error}"))
            })?,
        );
        battle
            .command_state
            .frontier
            .sort_by_key(|entry| entry.field_slot);
        battle.command_state.validate().map_err(|error| {
            GameRuntimeV6Error::Domain(format!("battle retention state: {error}"))
        })?;
        install_battle_command_control(
            &mut candidate,
            *next_owner,
            action_context.authority_seat,
            safe_increment(action_context.authority_revision)?,
            action_context.menu_instance,
        )
        .map_err(|error| {
            GameRuntimeV6Error::Domain(format!("battle retention control: {error}"))
        })?;
        return Ok(DomainExecutionV1 {
            candidate: Some(candidate),
            ..Default::default()
        });
    }
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
    let outcome = transition.outcome;
    let rng_audit = transition.rng_audit;
    let mut candidate = adopt_v5(before, transition.after_state)?;
    match outcome {
        BattleOutcome::Victory => {
            let final_wave = candidate
                .active_run
                .as_ref()
                .is_some_and(|run| is_final_wave(content, run.mode, run.wave));
            if final_wave {
                candidate
                    .active_run
                    .as_mut()
                    .ok_or(GameRuntimeV6Error::Action)?
                    .outcome = RunOutcome::Victory;
                candidate.profile.statistics.battles_won =
                    safe_increment(candidate.profile.statistics.battles_won)?;
                candidate.profile.statistics.runs_won =
                    safe_increment(candidate.profile.statistics.runs_won)?;
            } else {
                prepare_post_battle_progression(&mut candidate, content, action_context)?;
            }
        }
        BattleOutcome::Defeat => {
            candidate
                .active_run
                .as_mut()
                .ok_or(GameRuntimeV6Error::Action)?
                .outcome = RunOutcome::Defeat;
        }
        BattleOutcome::Ongoing => {
            install_battle_command_control(
                &mut candidate,
                action_context.authority_seat,
                action_context.authority_seat,
                safe_increment(action_context.authority_revision)?,
                action_context.menu_instance,
            )
            .map_err(|error| {
                GameRuntimeV6Error::Domain(format!("next battle command control: {error}"))
            })?;
        }
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        rng_audit,
        ..Default::default()
    })
}

fn battle_command_offer(
    state: &GameStateV6,
    actor: er_types::battle_ids::PokemonId,
) -> Result<BattleCommandOffer, GameRuntimeV6Error> {
    let run = state
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?;
    let battle = run.battle.as_ref().ok_or(GameRuntimeV6Error::Action)?;
    let pokemon = run
        .party
        .iter()
        .find(|pokemon| pokemon.id == actor && !pokemon.fainted)
        .ok_or(GameRuntimeV6Error::Action)?;
    let fight = pokemon
        .moves
        .iter()
        .enumerate()
        .filter_map(|(index, slot)| {
            slot.as_ref()?;
            let move_slot =
                er_types::battle_ids::MoveSlotIndex::new(u8::try_from(index).ok()?).ok()?;
            OfferedMoveCommand::new(
                move_slot,
                vec![er_types::battle_command::BattleTargetSelection::implicit()],
            )
            .ok()
        })
        .collect::<Vec<_>>();
    let switches = run
        .party
        .iter()
        .enumerate()
        .filter(|(_, candidate)| {
            candidate.owner_seat == pokemon.owner_seat
                && !candidate.fainted
                && !battle
                    .field
                    .slots
                    .iter()
                    .any(|slot| slot.occupant == Some(candidate.id))
        })
        .filter_map(|(index, candidate)| {
            Some(OfferedSwitchCommand::new(
                er_types::battle_ids::PartyIndex::new(u8::try_from(index).ok()?).ok()?,
                candidate.id,
            ))
        })
        .collect::<Vec<_>>();
    BattleCommandOffer::new(fight, switches).map_err(|_| GameRuntimeV6Error::Action)
}

fn prepare_post_battle_progression(
    candidate: &mut GameStateV6,
    content: &PreparedGameContentV2,
    action_context: &GameActionContextV1,
) -> Result<(), GameRuntimeV6Error> {
    let tasks = {
        let run = candidate
            .active_run
            .as_ref()
            .ok_or(GameRuntimeV6Error::Action)?;
        if !run.progression_queue.tasks.is_empty() {
            return Err(GameRuntimeV6Error::Action);
        }
        run.party
            .iter()
            .filter(|pokemon| !pokemon.fainted && pokemon.level < 100)
            .filter_map(|pokemon| {
                let species = content
                    .progression
                    .species(pokemon.species_id, pokemon.form_index)?;
                let growth = content.progression.growth_rate(species.growth_rate)?;
                let threshold = growth
                    .experience_by_level
                    .get(usize::from(pokemon.level) + 1)?;
                let amount = threshold
                    .get()
                    .get()
                    .checked_sub(pokemon.experience.get().get())?;
                (amount > 0).then_some((pokemon.id, amount))
            })
            .collect::<Vec<_>>()
    };
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    run.outcome = RunOutcome::InProgress;
    for (pokemon, amount) in tasks {
        let sequence = run.progression_queue.next_sequence;
        run.progression_queue.next_sequence = safe_increment(sequence)?;
        run.progression_queue.tasks.push(ProgressionTaskV2 {
            sequence,
            pokemon,
            kind: ProgressionTaskKindV2::GrantExperience(Experience::new(safe_from_u64(amount)?)),
        });
    }
    candidate.profile.statistics.battles_won =
        safe_increment(candidate.profile.statistics.battles_won)?;
    install_progression_or_reward_control(
        candidate,
        content,
        action_context.authority_seat,
        safe_increment(action_context.authority_revision)?,
        action_context.menu_instance,
    )
}

fn install_progression_or_reward_control(
    candidate: &mut GameStateV6,
    content: &PreparedGameContentV2,
    owner: er_types::SeatId,
    revision: SafeU53,
    base_instance: MenuInstanceId,
) -> Result<(), GameRuntimeV6Error> {
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let current_instance = run
        .control
        .menu
        .as_ref()
        .map(|menu| menu.instance_id)
        .or_else(|| {
            run.control
                .action_context
                .as_ref()
                .map(|context| context.menu_instance)
        })
        .unwrap_or(base_instance);
    let menu_instance = MenuInstanceId::new(safe_increment(current_instance.get())?);
    let (kind, operation, control_id, entries) =
        if let Some(task) = run.progression_queue.tasks.first() {
            (
                GameControlKindV2::Progression,
                OperationId::new(format!(
                    "progression/wave/{}/task/{}",
                    run.wave.get().get(),
                    task.sequence.get()
                ))
                .map_err(|_| GameRuntimeV6Error::Invalid)?,
                "m9e/progression",
                vec![(
                    format!("progression/task/{}/accept", task.sequence.get()),
                    GameActionV1::Progression {
                        action: ProgressionActionV1::AcceptTask {
                            sequence: task.sequence,
                        },
                    },
                )],
            )
        } else {
            let mut entries = reward_offer(content, run.world.encounter_sequence)?
                .into_iter()
                .enumerate()
                .map(|(ordinal, (_, registry_key))| {
                    Ok((
                        format!("reward/item/{registry_key}"),
                        GameActionV1::Reward {
                            action: RewardActionV1::Select {
                                option_ordinal: u32::try_from(ordinal)
                                    .map_err(|_| GameRuntimeV6Error::Invalid)?,
                            },
                        },
                    ))
                })
                .collect::<Result<Vec<_>, GameRuntimeV6Error>>()?;
            entries.push((
                "reward/reroll".to_owned(),
                GameActionV1::Reward {
                    action: RewardActionV1::Reroll,
                },
            ));
            entries.push((
                "reward/decline".to_owned(),
                GameActionV1::Reward {
                    action: RewardActionV1::Decline,
                },
            ));
            (
                GameControlKindV2::Reward,
                OperationId::new(format!(
                    "reward/wave/{}/offer/{}",
                    run.wave.get().get(),
                    run.world.encounter_sequence.get()
                ))
                .map_err(|_| GameRuntimeV6Error::Invalid)?,
                "m9e/reward",
                entries,
            )
        };
    run.control = generic_vertical_control_v2(
        menu_instance,
        revision,
        owner,
        operation,
        kind,
        control_id,
        &entries,
        GameMenuCancelV2::Disabled,
    )
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    Ok(())
}

fn reward_offer(
    content: &PreparedGameContentV2,
    sequence: SafeU53,
) -> Result<Vec<(er_types::InventoryItemId, String)>, GameRuntimeV6Error> {
    let balls = &content.progression.pack().capture_balls;
    if balls.is_empty() {
        return Err(GameRuntimeV6Error::Invalid);
    }
    let offset =
        usize::try_from(sequence.get()).map_err(|_| GameRuntimeV6Error::Invalid)? % balls.len();
    Ok((0..balls.len().min(3))
        .map(|ordinal| {
            let ball = &balls[(offset + ordinal) % balls.len()];
            (ball.item, ball.registry_key.clone())
        })
        .collect())
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
    content: &PreparedGameContentV2,
    action: &ScenarioGameActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let current = candidate
        .active_run
        .as_ref()
        .and_then(|run| run.scenario.as_ref())
        .cloned()
        .ok_or(GameRuntimeV6Error::Action)?;
    let action_node = match action {
        ScenarioGameActionV1::Advance { node }
        | ScenarioGameActionV1::Choose { node, .. }
        | ScenarioGameActionV1::SelectPartyTarget { node, .. }
        | ScenarioGameActionV1::SelectItemTarget { node, .. }
        | ScenarioGameActionV1::Complete { node } => *node,
    };
    if action_node != current.node {
        return Err(GameRuntimeV6Error::Action);
    }
    let factory = ScenarioDomainFactoryV2::new(content.scenarios.clone());
    let mut runtime = ScenarioRuntimeV2 {
        schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
        scenario: current.scenario,
        current_node: current.node,
        selected_option: current.selected_option,
        completed_outcome: None,
    };
    let mut compiled_program = None;
    let complete = match action {
        ScenarioGameActionV1::Advance { .. } => {
            factory
                .apply(&mut runtime, ScenarioInputV2::AcknowledgeMessage)
                .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            false
        }
        ScenarioGameActionV1::Choose { option_ordinal, .. } => {
            let option = u8::try_from(*option_ordinal).map_err(|_| GameRuntimeV6Error::Action)?;
            factory
                .apply(&mut runtime, ScenarioInputV2::Choose(option))
                .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            if matches!(
                factory
                    .control(&runtime)
                    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?,
                ScenarioControlV2::ExecuteOption {
                    primary_party_target: false,
                    secondary_party_target: false,
                    nested_battle: false,
                    ..
                }
            ) {
                compiled_program = Some(
                    factory
                        .program(&runtime)
                        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?
                        .clone(),
                );
                factory
                    .apply(&mut runtime, ScenarioInputV2::OptionApplied)
                    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
            }
            runtime.completed_outcome.is_some()
        }
        ScenarioGameActionV1::Complete { .. } => {
            if !matches!(
                factory
                    .control(&runtime)
                    .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?,
                ScenarioControlV2::Complete { .. }
            ) {
                return Err(GameRuntimeV6Error::Action);
            }
            true
        }
        ScenarioGameActionV1::SelectPartyTarget { .. }
        | ScenarioGameActionV1::SelectItemTarget { .. } => {
            return Err(GameRuntimeV6Error::Action);
        }
    };
    let stage = match factory
        .control(&runtime)
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?
    {
        ScenarioControlV2::Message { .. } => ScenarioRuntimeStageV2::Intro,
        ScenarioControlV2::Choice { .. } => ScenarioRuntimeStageV2::Choice,
        ScenarioControlV2::ExecuteOption {
            primary_party_target,
            secondary_party_target,
            nested_battle,
            ..
        } => {
            if primary_party_target || secondary_party_target {
                ScenarioRuntimeStageV2::AwaitingTarget
            } else if nested_battle {
                ScenarioRuntimeStageV2::AwaitingBattle
            } else {
                ScenarioRuntimeStageV2::ApplyOption
            }
        }
        ScenarioControlV2::Complete { .. } => ScenarioRuntimeStageV2::Complete,
    };
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    apply_scenario_program(run, content, compiled_program.as_ref())?;
    let scenario = run.scenario.as_mut().ok_or(GameRuntimeV6Error::Action)?;
    scenario.node = runtime.current_node;
    scenario.stage = stage;
    scenario.selected_option = runtime.selected_option;
    scenario.visit_count = safe_increment(scenario.visit_count)?;
    if complete {
        run.scenario = None;
    }
    Ok(DomainExecutionV1 {
        candidate: Some(candidate),
        ..Default::default()
    })
}

fn apply_scenario_program(
    run: &mut er_state::m7_state::RunStateV3,
    content: &PreparedGameContentV2,
    program: Option<&ScenarioOptionProgramV2>,
) -> Result<(), GameRuntimeV6Error> {
    let Some(program) = program else {
        return Ok(());
    };
    if callback_has_no_canonical_effects(&program.apply_callback_sha256) {
        return Ok(());
    }
    match (
        program.handler,
        program.scenario.get().get(),
        program.option_index,
        program.apply_callback_sha256.as_str(),
    ) {
        (
            ScenarioProgramHandlerV2::GroupG,
            73,
            0,
            "36655e9af0ef2718fc59812babf5584af44146d289918d3c5037e4f59eb36a8d",
        ) => {
            restore_scenario_party(run);
            Ok(())
        }
        (
            ScenarioProgramHandlerV2::GroupA,
            4,
            1,
            "fa50234acea6f6652b11515d3b8910cbfcddf7c4a4dd76963dadac0d0e658731",
        ) => {
            restore_scenario_party(run);
            Ok(())
        }
        (
            ScenarioProgramHandlerV2::GroupA,
            10,
            2,
            "c11b99dfc3c2dde19a351130662c85c66f8075ee5b0212c3453c7dd2fc29cf10",
        ) => {
            damage_scenario_party_quarter(run);
            Ok(())
        }
        (
            ScenarioProgramHandlerV2::GroupF,
            61,
            0,
            "edccabcc68275abcbc045dbd22d706749ff8527743c818cc4afb953367ae4ba8",
        ) => {
            add_scenario_treasure_fragments(run, 1)?;
            chart_scenario_onward_routes(run, content)?;
            Ok(())
        }
        (
            ScenarioProgramHandlerV2::GroupF,
            62,
            1,
            "7ec44c68dfd01f50a90e34b2c25165642c5b2aa59f5230d3a1c96b9fc7bdaa2b",
        ) => {
            add_scenario_treasure_fragments(run, 1)?;
            Ok(())
        }
        (
            ScenarioProgramHandlerV2::GroupF,
            63,
            0,
            "fe0639d6ddacaaa555ab20219ce82bbf42299e89875b04d356a99f47220d3726",
        ) => {
            chart_scenario_onward_routes(run, content)?;
            add_scenario_landmark(run, "The Observatory");
            Ok(())
        }
        (
            ScenarioProgramHandlerV2::GroupF,
            64,
            0,
            "6edfc6c144ba7e250512ee63fff3e4468b104e442d3d5b3ec9c5586a3c8e6f88",
        ) => reveal_echo_chamber_routes(run, content),
        (
            ScenarioProgramHandlerV2::GroupG,
            68,
            0,
            "e9f78701c9129968acca7db729690b25f5aaa00523640564ba4987c649ed0c5c",
        )
        | (
            ScenarioProgramHandlerV2::GroupG,
            69,
            0,
            "20c5590a30b2e3f16cca401d8c8bb23d76f2c621c9d2b15a42ff19275a3f6a26",
        ) => {
            add_scenario_treasure_fragments(run, 1)?;
            chart_scenario_onward_routes(run, content)?;
            Ok(())
        }
        _ => Err(GameRuntimeV6Error::Domain(format!(
            "scenario option program {}/{} is not implemented",
            program.scenario, program.option_index
        ))),
    }
}

fn restore_scenario_party(run: &mut er_state::m7_state::RunStateV3) {
    for pokemon in &mut run.party {
        pokemon.hp = pokemon.max_hp;
        pokemon.fainted = false;
        pokemon.status = er_types::battle_model::StatusState {
            kind: er_types::battle_model::StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        };
        for move_slot in pokemon.moves.iter_mut().flatten() {
            move_slot.pp_used = 0;
        }
    }
}

fn damage_scenario_party_quarter(run: &mut er_state::m7_state::RunStateV3) {
    for pokemon in &mut run.party {
        if pokemon.fainted || pokemon.hp == 0 {
            continue;
        }
        let damage = pokemon.max_hp / 4;
        pokemon.hp = pokemon.hp.saturating_sub(damage).max(1);
        pokemon.fainted = false;
    }
}

fn callback_has_no_canonical_effects(callback_sha: &str) -> bool {
    matches!(
        callback_sha,
        "0d9b385a5bba574f55206f9496c997e746819d5ac19037c726d85554e683d6e7"
            | "0ff710dbeec3f9391911e04c6f07c2a34337e636fc95c15e5bd987def7d1a3db"
            | "13484df1f54c53b3513cd65088304bce401cfa7b6d025a7aef9e3163155ee5f1"
            | "17af498336692497e12accd41e9ddc96e05cf87dbb434ee2d9518012c61f284d"
            | "188171dc06049055f94986b51f5290336fefbd457dba7cbb8fcf951c2878ebf1"
            | "1b72e5886eef0862a7f7d3ca268fab29cac9bc3ede551be008432b93ca3958ba"
            | "20939cce20593b9fc96c0dc0aa5c3b662fa050eff8e2b8d449fa10d236350d6c"
            | "218119858149664f3451ce2f82721cb0d4f7c16598aef87f1d0c4c833a68973f"
            | "28cd4c21286bf25d28679ae39ba1501fcce646dbf9a482f6c211cedeba77ef73"
            | "2a8866df33e2b28c1cb7da66f541037b06f88efc5e72099bfa000c404d3693e0"
            | "2e5a16437bafb073b6748ff78f231246e5ccd3cb36a1235f6dd2d8067cf950ed"
            | "32b2d65acb8c0f7746a6dcc11ec7146d7747a9985d3060d4e389048d6767e0ab"
            | "34a1e26e75ca230e5ebc7cb8ce9b0d67e2c436d7b4aa2fba212c30dc3b468933"
            | "390a2abdad17a286818992e2b25e8e018a1995a6f31a4bd7420890362cc53502"
            | "40576c026beae347e9578566bc960101ad8380b1a91877f861225cb68f6b4dfc"
            | "40e5ffa91d14ffdba01123bcbc55f3e1816f78d5c75f882d6bfc971ef8e25239"
            | "4760208b5f29f5eaa69f7ea25872b80a24d9b5fdf383704ba16ce0f7600f1241"
            | "4a04e15b9a0ab193243051c410197b6c2d57e7143748e03181785a102dd52d34"
            | "56983a3558f11829cfe3859f5d8208745ebf330985d1f206f9bddba41ac024ef"
            | "595e251bff89b957beb7f0f3d4c206e6e2524746ad9622d5b16cc8246871a729"
            | "5a6fe8a4fe48dcbcbec55a435e3172900290dc9153f497578e19fe0136fdc679"
            | "60e6e36b04b8dfa563a2e73760d5a680c7de169dbcc876d15246fa76ccbc393b"
            | "61dce4a35f5a93a241835ab034b8b134a96cfe3852ab867a6dfe2186399bf282"
            | "6922cfc90eba99fcd167d9b568ddc899949056983628d66bb0eafb3a282b510d"
            | "7bd8ab95d4bb77ef199fdffe380afd7fbf56624f68799f2fc3465864c420ae4f"
            | "7c895423366e4e122aaf0ea921fde40c20d788ccb084933a8ca59eb6b1065b11"
            | "823e4cfc692840b8d3029a1844f484c08fadc9585bd5d326fcef40e01ab1ec35"
            | "854ce78df5492daafab96c59aa472eff0e1252b721ed7e0759584d7a5aba4efb"
            | "8f4ab225958f2af1e22f9338a7e20a585328ab8e5d81694c6a47a6fddd6ee3b3"
            | "91d61fd6bdb2cd4bab1538b368b6bcab31bc7c8272c677f33b4b4212d5a5f422"
            | "964d1ce44377d70bbfb915840f6b63f53d59737c2acc070eefd13c7a26e60711"
            | "9e29526e0a872e6433f1349408461e4bf12060753fd13c5dfdd860b803b89cea"
            | "a0becc89fab74950c546e89418275473d32c6ae24e6d180b1d75b05d2bdf7730"
            | "a6562cb1c78f03fc4161e3203e3693122801cc6de6094403f3ca1a6dc630bcbf"
            | "a922d0edc76e7bdcf28dbfd02f30fd0a7351f46c26d00d5438bf5d04402c3393"
            | "b596fde89014c3a0ed2348614d37ae384e08e11e8b25bb0296b6f9116bc1c970"
            | "c68aa8d562cc335018b2089341fe647ecb7ca7d2dcad70c1dd98cb97b952bfd5"
            | "cc448f6acc803ef023f2c214442161bef9c1eaf613b0059965b871c0f4a72c17"
            | "d860f6f3bddfd1e9cb72910a736c7bbd23e82838577daf1b236ef11c5f9c98f8"
            | "dede57a6ef8cedd950e154987dc1330d9c6023bf98d74c4c12a410fcd2624dbc"
            | "df5d64ce53df9de6d44212a0dc4b134f86ed8ccee8278acef87591716a6d0d73"
            | "e0ce48c46d8c6dc284e7e30c4cd84f93d0f330cd9c107494011230da7f67925e"
            | "e9f3012576babdce31ce1f5096821d1b191034c6a478859ea157d0df912659cb"
            | "eaa369bd3a2b26bdf3518a156e55f99574da049b1daef46a4f6500de14b71361"
            | "eef4cd0ef004d296fe1fde2cffb6a8e9c4d8acc498ead47d415e15f9dc39e49c"
            | "f6845e6f72508eb1a86ad9faa81e9cef6683dd39d3efb11f7ea454b4caf5be09"
            | "fe7d5ed79aaf17174e1db717bb6c30bfe63810b1faf2a0921ccc885779d11336"
    )
}

fn add_scenario_treasure_fragments(
    run: &mut er_state::m7_state::RunStateV3,
    amount: u32,
) -> Result<(), GameRuntimeV6Error> {
    run.world.treasure_fragments = run
        .world
        .treasure_fragments
        .checked_add(amount)
        .ok_or_else(|| GameRuntimeV6Error::Domain("treasure fragments overflow".to_owned()))?;
    Ok(())
}

fn chart_scenario_onward_routes(
    run: &mut er_state::m7_state::RunStateV3,
    content: &PreparedGameContentV2,
) -> Result<(), GameRuntimeV6Error> {
    for pending in &mut run.world.pending_nodes {
        if !pending.revealed {
            pending.revealed = true;
            pending.source = RouteRevealSourceV1::Event;
        }
    }
    let links = &content
        .world
        .biome(run.world.biome)
        .ok_or(GameRuntimeV6Error::Invalid)?
        .links;
    for link in links {
        let definition = content
            .world
            .biome(link.biome)
            .ok_or(GameRuntimeV6Error::Invalid)?;
        if !run
            .world
            .map_nodes
            .iter()
            .any(|node| node.biome == link.biome && node.label == definition.key)
        {
            run.world.map_nodes.push(MapNodeStateV1 {
                biome: link.biome,
                label: definition.key.clone(),
                kind: MapNodeKindV1::Biome,
            });
        }
    }
    Ok(())
}

fn add_scenario_landmark(run: &mut er_state::m7_state::RunStateV3, label: &str) {
    if !run
        .world
        .map_nodes
        .iter()
        .any(|node| node.biome == run.world.biome && node.label == label)
    {
        run.world.map_nodes.push(MapNodeStateV1 {
            biome: run.world.biome,
            label: label.to_owned(),
            kind: MapNodeKindV1::Landmark,
        });
    }
}

fn reveal_echo_chamber_routes(
    run: &mut er_state::m7_state::RunStateV3,
    content: &PreparedGameContentV2,
) -> Result<(), GameRuntimeV6Error> {
    let mut has_sound_move = false;
    for move_slot in run
        .party
        .iter()
        .flat_map(|pokemon| pokemon.moves.iter().flatten())
    {
        let definition = content
            .battle
            .move_definition(move_slot.move_id)
            .map_err(|_| GameRuntimeV6Error::Invalid)?;
        if definition.flags.contains(&MoveFlag::SoundBased) {
            has_sound_move = true;
            break;
        }
    }
    if has_sound_move {
        for pending in &mut run.world.pending_nodes {
            if !pending.revealed {
                pending.revealed = true;
                pending.source = RouteRevealSourceV1::Event;
            }
        }
    } else if let Some(pending) = run
        .world
        .pending_nodes
        .iter_mut()
        .find(|node| !node.revealed)
    {
        pending.revealed = true;
        pending.source = RouteRevealSourceV1::Event;
    }
    Ok(())
}
fn execute_save(
    before: Option<&GameStateV6>,
    action: &SaveActionV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    let mut candidate = require_state(before)?.clone();
    let generation = match (action, input) {
        (SaveActionV1::Write { .. }, GameDomainExecutionInputV1::SaveGeneration(generation)) => {
            Some(*generation)
        }
        (
            SaveActionV1::Load { .. } | SaveActionV1::Delete { .. } | SaveActionV1::Cancel,
            GameDomainExecutionInputV1::None,
        ) => None,
        _ => return Err(GameRuntimeV6Error::Invalid),
    };
    let mut output = DomainExecutionV1::default();
    if let SaveActionV1::Write { slot } = action {
        let generation = generation.ok_or(GameRuntimeV6Error::Invalid)?;
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
    match action {
        TerminalActionV1::ConfirmOutcome { outcome } => {
            let run = candidate
                .active_run
                .as_mut()
                .ok_or(GameRuntimeV6Error::Action)?;
            run.outcome = match outcome {
                BattleOutcome::Victory => RunOutcome::Victory,
                BattleOutcome::Defeat => RunOutcome::Defeat,
                BattleOutcome::Ongoing => return Err(GameRuntimeV6Error::Action),
            };
        }
        TerminalActionV1::ReturnToTitle => candidate.active_run = None,
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
    let (draw, next_run_rng, rng_audit) = match input {
        GameDomainExecutionInputV1::CaptureRng {
            draw,
            run_rng,
            audit,
        } if *draw < 256 && !ball_definition.guaranteed && !audit.is_empty() => {
            (*draw, Some(run_rng.clone()), audit.clone())
        }
        GameDomainExecutionInputV1::None if ball_definition.guaranteed => (0, None, Vec::new()),
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
    if let Some(next_run_rng) = next_run_rng {
        run.run_rng = next_run_rng;
    }
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
        rng_audit,
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
    action_context: &GameActionContextV1,
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
    {
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
    }
    install_progression_or_reward_control(
        &mut candidate,
        content,
        action_context.authority_seat,
        safe_increment(action_context.authority_revision)?,
        action_context.menu_instance,
    )?;
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
    let mut candidate = require_state(before)?.clone();
    let mut output = DomainExecutionV1::default();
    match action {
        InventoryActionV1::Discard { item, count } => {
            require_none_input(input)?;
            if *count == 0 {
                return Err(GameRuntimeV6Error::Action);
            }
            remove_inventory(&mut candidate, *item, *count)?;
        }
        InventoryActionV1::Use { item, target } => {
            let GameDomainExecutionInputV1::InventoryUse(effect) = input else {
                return Err(GameRuntimeV6Error::Invalid);
            };
            remove_inventory(&mut candidate, *item, 1)?;
            let target = target.ok_or(GameRuntimeV6Error::Action)?;
            match effect {
                InventoryUseEffectV1::Heal { amount } => {
                    let pokemon = persistent_pokemon_mut(&mut candidate, target)?;
                    pokemon.hp = pokemon.hp.saturating_add(*amount).min(pokemon.max_hp);
                    pokemon.fainted = pokemon.hp == 0;
                }
                InventoryUseEffectV1::CureStatus => {
                    persistent_pokemon_mut(&mut candidate, target)?.status =
                        er_types::battle_model::StatusState {
                            kind: er_types::battle_model::StatusKind::None,
                            toxic_turn_count: 0,
                            sleep_turns_remaining: None,
                        };
                }
                InventoryUseEffectV1::GrantHeldItem { registry_key } => {
                    if registry_key.is_empty() {
                        return Err(GameRuntimeV6Error::Action);
                    }
                    let instance = candidate
                        .identities
                        .allocate_held_item_instance_id()
                        .map_err(|_| GameRuntimeV6Error::Invalid)?;
                    let pokemon = persistent_pokemon_mut(&mut candidate, target)?;
                    pokemon
                        .held_items
                        .push(er_state::m7_state::HeldItemOwnershipStateV1 {
                            instance_id: instance,
                            registry_key: registry_key.clone(),
                            source_ordinal: er_types::SourceOrdinal::ZERO,
                            stack_count: 1,
                        });
                    pokemon.held_items.sort_by_key(|item| item.instance_id);
                    output
                        .allocated_identities
                        .push((GameIdentityDomainV1::ModifierInstance, instance.get()));
                }
            }
        }
        InventoryActionV1::Transfer { source, target, .. } => {
            let GameDomainExecutionInputV1::InventoryTransferKey(registry_key) = input else {
                return Err(GameRuntimeV6Error::Invalid);
            };
            if registry_key.is_empty() || source == target {
                return Err(GameRuntimeV6Error::Action);
            }
            transfer_one_held_item(&mut candidate, *source, *target, registry_key)?;
        }
    }
    output.candidate = Some(candidate);
    Ok(output)
}

fn execute_reward(
    before: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    action: &RewardActionV1,
    action_context: &GameActionContextV1,
    input: &GameDomainExecutionInputV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(input)?;
    let mut candidate = require_state(before)?.clone();
    let mut advance = false;
    match action {
        RewardActionV1::Reroll => {
            let run = candidate
                .active_run
                .as_mut()
                .ok_or(GameRuntimeV6Error::Action)?;
            run.world.encounter_sequence = safe_increment(run.world.encounter_sequence)?;
        }
        RewardActionV1::ToggleLock { option_ordinal } => {
            let run = candidate
                .active_run
                .as_mut()
                .ok_or(GameRuntimeV6Error::Action)?;
            let flag = er_types::RunFlagId::new(safe_from_u64(u64::from(*option_ordinal) + 1)?);
            let next = !run.flags.get(&flag).copied().unwrap_or(false);
            run.flags.insert(flag, next);
        }
        RewardActionV1::Select { option_ordinal } => {
            let offered = {
                let run = candidate
                    .active_run
                    .as_ref()
                    .ok_or(GameRuntimeV6Error::Action)?;
                reward_offer(content, run.world.encounter_sequence)?
            };
            let (item, registry_key) = offered
                .get(usize::try_from(*option_ordinal).map_err(|_| GameRuntimeV6Error::Action)?)
                .cloned()
                .ok_or(GameRuntimeV6Error::Action)?;
            let run = candidate
                .active_run
                .as_mut()
                .ok_or(GameRuntimeV6Error::Action)?;
            if let Some(entry) = run
                .inventory
                .entries
                .iter_mut()
                .find(|entry| entry.item == item)
            {
                if entry.registry_key != registry_key {
                    return Err(GameRuntimeV6Error::Action);
                }
                entry.count = entry
                    .count
                    .checked_add(1)
                    .ok_or(GameRuntimeV6Error::Invalid)?;
            } else {
                run.inventory
                    .entries
                    .push(er_state::m7_state::InventoryEntryV1 {
                        item,
                        registry_key,
                        count: 1,
                    });
                run.inventory.entries.sort_by_key(|entry| entry.item);
            }
            advance = true;
        }
        RewardActionV1::Decline => advance = true,
    }
    let next_revision = safe_increment(action_context.authority_revision)?;
    if advance {
        let (mut next, rng_audit) = advance_to_next_encounter_v6(&candidate, content)
            .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
        install_battle_command_control(
            &mut next,
            action_context.authority_seat,
            action_context.authority_seat,
            next_revision,
            action_context.menu_instance,
        )?;
        Ok(DomainExecutionV1 {
            candidate: Some(next),
            rng_audit,
            ..Default::default()
        })
    } else {
        install_progression_or_reward_control(
            &mut candidate,
            content,
            action_context.authority_seat,
            next_revision,
            action_context.menu_instance,
        )?;
        Ok(DomainExecutionV1 {
            candidate: Some(candidate),
            ..Default::default()
        })
    }
}

fn install_battle_command_control(
    candidate: &mut GameStateV6,
    owner: er_types::SeatId,
    authority: er_types::SeatId,
    revision: SafeU53,
    base_instance: MenuInstanceId,
) -> Result<(), GameRuntimeV6Error> {
    let run = candidate
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let battle = run.battle.as_ref().ok_or(GameRuntimeV6Error::Action)?;
    let field = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player
                && slot.occupant.is_some_and(|pokemon| {
                    run.party.iter().any(|candidate| {
                        candidate.id == pokemon && candidate.owner_seat == Some(owner)
                    })
                })
        })
        .ok_or_else(|| {
            GameRuntimeV6Error::Domain(format!(
                "battle command owner {} has no active field actor",
                owner.get().get()
            ))
        })?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field.slot,
        owner,
    )
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let current_instance = run
        .control
        .menu
        .as_ref()
        .map(|menu| menu.instance_id)
        .or_else(|| {
            run.control
                .action_context
                .as_ref()
                .map(|context| context.menu_instance)
        })
        .unwrap_or(base_instance);
    let menu_instance = MenuInstanceId::new(safe_increment(current_instance.get())?);
    let mut control = generic_vertical_control_v2(
        menu_instance,
        revision,
        owner,
        operation,
        GameControlKindV2::BattleCommand,
        "m9e/battle/command",
        &[
            (
                "battle/command/fight".to_owned(),
                GameActionV1::Battle {
                    action: er_types::BattleUiActionV1::OpenFight,
                },
            ),
            (
                "battle/command/party".to_owned(),
                GameActionV1::Battle {
                    action: er_types::BattleUiActionV1::OpenParty,
                },
            ),
        ],
        GameMenuCancelV2::Disabled,
    )
    .map_err(|_| GameRuntimeV6Error::Invalid)?;
    control
        .action_context
        .as_mut()
        .ok_or(GameRuntimeV6Error::Invalid)?
        .authority_seat = authority;
    run.control = control;
    Ok(())
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
            if !matches!(
                input,
                GameDomainExecutionInputV1::BattleTurn { .. }
                    | GameDomainExecutionInputV1::BattleCommandRetention { .. }
            ) {
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

fn domain_cue(domain: GameActionDomainV2) -> PresentationCueFamilyV1 {
    match domain {
        GameActionDomainV2::NewRun | GameActionDomainV2::World => PresentationCueFamilyV1::World,
        GameActionDomainV2::BattleTurn | GameActionDomainV2::BattleReplacement => {
            PresentationCueFamilyV1::Move
        }
        GameActionDomainV2::RunProgram | GameActionDomainV2::Progression => {
            PresentationCueFamilyV1::Progression
        }
        GameActionDomainV2::Capture => PresentationCueFamilyV1::Capture,
        GameActionDomainV2::Party => PresentationCueFamilyV1::Switch,
        GameActionDomainV2::MoveLearning => PresentationCueFamilyV1::Progression,
        GameActionDomainV2::Evolution => PresentationCueFamilyV1::Evolution,
        GameActionDomainV2::Fusion => PresentationCueFamilyV1::Fusion,
        GameActionDomainV2::Inventory => PresentationCueFamilyV1::HeldItem,
        GameActionDomainV2::Reward => PresentationCueFamilyV1::Reward,
        GameActionDomainV2::Scenario => PresentationCueFamilyV1::Scenario,
        GameActionDomainV2::SaveControl => PresentationCueFamilyV1::Save,
        GameActionDomainV2::Terminal => PresentationCueFamilyV1::Terminal,
    }
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

fn remove_inventory(
    state: &mut GameStateV6,
    item: er_types::InventoryItemId,
    count: u32,
) -> Result<(), GameRuntimeV6Error> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let index = run
        .inventory
        .entries
        .iter()
        .position(|entry| entry.item == item && entry.count >= count)
        .ok_or(GameRuntimeV6Error::Action)?;
    run.inventory.entries[index].count -= count;
    if run.inventory.entries[index].count == 0 {
        run.inventory.entries.remove(index);
    }
    Ok(())
}

fn transfer_one_held_item(
    state: &mut GameStateV6,
    source: er_types::battle_ids::PokemonId,
    target: er_types::battle_ids::PokemonId,
    registry_key: &str,
) -> Result<(), GameRuntimeV6Error> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(GameRuntimeV6Error::Action)?;
    let source_index = run
        .party
        .iter()
        .position(|pokemon| pokemon.id == source)
        .ok_or(GameRuntimeV6Error::Action)?;
    let target_index = run
        .party
        .iter()
        .position(|pokemon| pokemon.id == target)
        .ok_or(GameRuntimeV6Error::Action)?;
    let held_index = run.party[source_index]
        .held_items
        .iter()
        .position(|item| item.registry_key == registry_key)
        .ok_or(GameRuntimeV6Error::Action)?;
    let held_item = run.party[source_index].held_items.remove(held_index);
    run.party[target_index].held_items.push(held_item);
    run.party[target_index]
        .held_items
        .sort_by_key(|item| item.instance_id);
    Ok(())
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
fn is_final_wave(
    content: &PreparedGameContentV2,
    mode: er_types::battle_ids::GameModeId,
    wave: er_types::battle_ids::WaveIndex,
) -> bool {
    let Some(mode) = content.world.mode(mode) else {
        return false;
    };
    match mode.key.as_str() {
        "CLASSIC" | "CHALLENGE" | "LLM_DIRECTOR" | "COOP" | "FUN" => wave.get().get() == 200,
        "DAILY" => wave.get().get() == 50,
        "SHOWDOWN" => wave.get().get() == 1,
        "ENDLESS" | "SPLICED_ENDLESS" => false,
        _ => false,
    }
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

fn control_accepts_action_context(
    control: &GameControlPlanV2,
    context: &GameActionContextV1,
    input: &GameDomainExecutionInputV1,
) -> bool {
    if control.action_context.as_ref() == Some(context) {
        return true;
    }
    let Some(root) = control.action_context.as_ref() else {
        return false;
    };
    matches!(
        input,
        GameDomainExecutionInputV1::BattleCommandRetention { .. }
            | GameDomainExecutionInputV1::BattleTurn { .. }
    ) && control.kind == GameControlKindV2::BattleCommand
        && context.operation_id == root.operation_id
        && context.authority_seat == root.authority_seat
        && context.authority_revision == root.authority_revision
        && context.menu_instance > root.menu_instance
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

fn validate_runtime_frontier(
    state: Option<&GameStateV6>,
    ledger: &AppliedGameMaterialLedgerV1,
) -> Result<(), GameRuntimeV6Error> {
    if state
        .and_then(|state| state.active_run.as_ref())
        .is_some_and(|run| run.control.revision > ledger.next_authority_revision)
    {
        return Err(GameRuntimeV6Error::Invalid);
    }
    Ok(())
}

fn material_error(error: crate::m9e_material_v6::GameMaterialV6Error) -> GameRuntimeV6Error {
    GameRuntimeV6Error::Material(error.to_string())
}
