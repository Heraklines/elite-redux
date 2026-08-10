//! Deterministic game-owned battle runtime.
//!
//! This module owns the logical command frontier, control projection, and
//! game-local admission ledgers.  Mechanics remain in `er-battle`; the
//! kernel-owned protocol and cross-owner transaction consume the typed
//! reductions exposed here.

use std::sync::Arc;

use er_battle::legality::{
    build_command_offer, build_replacement_offer, build_scripted_enemy_offer,
    validate_command_proposal, validate_replacement_proposal, validate_replacement_selection,
    validate_state_content,
};
use er_battle::{
    BattleNextDecision, BattleResolveError, resolve_replacement, resolve_turn,
};
use er_content::pack::{ContentPack, ContentPackError};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_state::battle::BattleState;
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainState, WeatherState,
};
use er_state::digest::MechanicalStateDigest;
use er_state::field::{FieldSlotState, FieldState, FieldStateError};
use er_state::format::{
    FormatTopologyError, canonical_player_slots, canonical_slots, human_seats, owner_seat_for,
    validate_m3_supported,
};
use er_state::snapshot::GameState;
use er_state::validation::StateValidationError;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommandError, BattleCommandOffer, BattleCommandProposalV1,
    BattleReplacementProposalV1, CommandAdmissionSource, CommandCollectionState,
    CommandFingerprintEntry, CommandFrontierEntry, CommandFrontierStatus,
    ReplacementProposalFingerprintEntry, ReplacementSelection, player_command_operation_id,
    replacement_operation_id, scripted_enemy_command_operation_id, turn_result_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlError, BattleControlPlan,
    BattleControlPlanError, BattleMenu, BattleMenuError, BattleMenuOption, CommandRootControl,
    ReplacementSelectControl, SeatBattleControl, SeatMenuInstanceAllocator, WaitingControl,
    WaitingReason,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleFormat, BattleId, BattleSide, FaintOccurrenceId, FieldSlot,
    MenuInstanceId, PartyIndex, PokemonId,
};
use er_types::battle_model::BattleOutcome;
use er_types::ids::{MenuOptionId, SafeU53, SeatId, StringIdError};
use er_types::battle_ui::{
    BattleMenuOptionError, MenuNavigationEdge, MenuOptionLayout, MenuOptionVisibility,
    NavigationDirection,
};
use er_types::battle_command::ScriptedEnemyPolicyV1;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::internal_event::{
    BattleResolvedPayload, GameIntent, InternalEvent, PreparedBattleResolution,
};

/// The frozen game configuration schema version.
pub const BATTLE_START_SCHEMA_VERSION: u32 = 1;

/// The logical battle-start DTO.  Battle IDs, turn, outcome, command state,
/// faint state, and arena conditions are all derived by the constructor.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleStartV1 {
    pub schema_version: u32,
    pub format: BattleFormat,
    pub player_party: Vec<er_state::pokemon::PokemonState>,
    pub enemy_party: Vec<er_state::pokemon::PokemonState>,
    pub player_leads: Vec<PartyIndex>,
    pub enemy_leads: Vec<PartyIndex>,
}

/// Game-owned battle configuration.  Protocol role/configuration is kept in
/// `er-kernel` and is intentionally not folded into this value.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleGameConfig {
    pub run_state: GameState,
    pub start: BattleStartV1,
    pub local_seat: SeatId,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
}

/// The runtime's bounded reducer output.  The kernel appends the returned
/// events to its private FIFO in this exact order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameReduction {
    pub admission: Option<CommandAdmission>,
    pub events: Vec<InternalEvent>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandAdmission {
    Accepted {
        operation_id: er_types::OperationId,
        frontier_complete: bool,
    },
    IdempotentDuplicate {
        operation_id: er_types::OperationId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MenuHistoryEntry {
    pub seat: SeatId,
    pub from: BattleControl,
    pub to: BattleControl,
}

/// Runtime failures are closed and fail-closed.  In particular, no variant
/// represents a repair, default seed, or silent unsupported-content fallback.
#[derive(Debug, Error)]
pub enum GameRuntimeError {
    #[error("immutable content pack is invalid: {0}")]
    Content(#[from] ContentPackError),
    #[error("mechanical state is invalid: {0}")]
    State(#[from] StateValidationError),
    #[error("state/content validation failed: {0}")]
    StateContent(#[source] er_battle::legality::CommandLegalityError),
    #[error("unsupported immutable content capability: {subject:?}")]
    UnsupportedContent {
        subject: er_types::battle_model::CapabilitySubject,
    },
    #[error("command validation failed: {0}")]
    Command(#[from] BattleCommandError),
    #[error("battle resolution failed: {0}")]
    Resolve(#[from] BattleResolveError),
    #[error("battle RNG construction failed: {0}")]
    Rng(#[from] RngError),
    #[error("field construction failed: {0}")]
    Field(#[from] FieldStateError),
    #[error("format topology is invalid: {0}")]
    Format(#[from] FormatTopologyError),
    #[error("control projection failed: {0}")]
    Control(#[from] BattleControlPlanError),
    #[error("control node is invalid: {0}")]
    ControlNode(#[from] BattleControlError),
    #[error("menu construction failed: {0}")]
    Menu(#[from] BattleMenuError),
    #[error("menu option construction failed: {0}")]
    MenuOption(#[from] BattleMenuOptionError),
    #[error("menu option identity is invalid: {0}")]
    MenuOptionId(#[from] StringIdError),
    #[error("the battle game config is invalid: {message}")]
    InvalidConfig { message: String },
    #[error("the exact production wave seed is required at the game boundary")]
    WaveSeedRequired,
    #[error("a command proposal conflicts with retained operation {operation_id}")]
    CommandConflict {
        operation_id: er_types::OperationId,
    },
    #[error("a replacement proposal conflicts with retained operation {operation_id}")]
    ReplacementConflict {
        operation_id: er_types::OperationId,
    },
    #[error("no active battle is available")]
    NoActiveBattle,
    #[error("the supplied runtime state does not match the prepared transition")]
    TransitionBeforeMismatch,
    #[error("the supplied runtime state does not match the prepared transition digest")]
    TransitionDigestMismatch,
    #[error("the current logical control does not match the submitted operation/menu identity")]
    ControlIdentityMismatch,
    #[error("the replacement epoch does not match the stored faint source")]
    ReplacementEpochMismatch,
}

/// The public initialization error name used by the kernel constructor.
pub type BattleInitializationError = GameRuntimeError;

/// All game-owned deterministic state and admission bookkeeping.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameRuntime {
    state: GameState,
    control: BattleControlPlan,
    local_seat: SeatId,
    scripted_enemy_policy: ScriptedEnemyPolicyV1,
    menu_history: Vec<MenuHistoryEntry>,
    command_fingerprints: Vec<CommandFingerprintEntry>,
    replacement_fingerprints: Vec<ReplacementProposalFingerprintEntry>,
    pub(crate) content: Arc<ContentPack>,
}

impl GameRuntime {
    /// Configuration-only construction is intentionally rejected because the
    /// frozen `BattleGameConfig` carries no production `wave_seed` field.
    pub fn new_battle(
        _config: BattleGameConfig,
        _content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        Err(GameRuntimeError::WaveSeedRequired)
    }

    pub fn new(
        config: BattleGameConfig,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        Self::new_battle(config, content)
    }

    /// Construct a fresh battle when the adapter supplies the exact
    /// production `BattleScene.waveSeed` separately from game config.
    pub fn new_battle_with_wave_seed(
        config: BattleGameConfig,
        wave_seed: &str,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        if wave_seed.is_empty() {
            return Err(invalid_config("wave_seed must not be empty"));
        }
        content.validate()?;
        config.scripted_enemy_policy.validate()?;
        validate_state_content(&config.run_state, content.as_ref()).map_err(map_legality_error)?;
        if config.run_state.battle.is_some() {
            return Err(invalid_config("run_state.battle must be None at battle start"));
        }
        if config.run_state.wave.get().get() == 0 {
            return Err(invalid_config("run_state.wave must be one-based"));
        }
        if config.run_state.next_battle_id.get().get() == 0 {
            return Err(invalid_config("run_state.next_battle_id must be positive"));
        }
        validate_m3_supported(&config.start.format)?;
        let human_seat_values = human_seats(&config.start.format)?;
        if !human_seat_values.contains(&config.local_seat) {
            return Err(invalid_config("local_seat is not a human battle seat"));
        }
        validate_start_parties(&config.start, &human_seat_values)?;
        if config.start.schema_version != BATTLE_START_SCHEMA_VERSION {
            return Err(invalid_config("unsupported BattleStartV1 schema version"));
        }

        let battle_id = config.run_state.next_battle_id;
        let next_battle_id = increment_battle_id(battle_id)?;
        let mut rng = RngRuntime::from_states(config.run_state.run_rng.clone(), None)?;
        let battle_rng = rng.initialize_battle(wave_seed, config.run_state.wave)?;
        let turn = battle_rng.turn;
        let field = initial_field(&config.start)?;
        let command_state = CommandCollectionState::new(Vec::new(), Vec::new())?;
        let battle = BattleState {
            battle_id,
            wave: config.run_state.wave,
            wave_seed: wave_seed.to_owned(),
            turn,
            format: config.start.format.clone(),
            authority_seat: human_seat_values[0],
            player_party: config.start.player_party.clone(),
            enemy_party: config.start.enemy_party.clone(),
            field,
            weather: WeatherState {
                kind: er_types::battle_model::WeatherKind::None,
                remaining_turns: 0,
            },
            terrain: TerrainState {
                kind: er_types::battle_model::TerrainKind::None,
                remaining_turns: 0,
            },
            arena_conditions: Vec::new(),
            global_ability_suppression: GlobalAbilitySuppressionState {
                ignore_abilities: false,
                source: None,
            },
            battle_rng,
            command_state,
            faint_queue: Vec::new(),
            next_faint_occurrence: FaintOccurrenceId::ZERO,
            outcome: BattleOutcome::Ongoing,
        };
        let mut state = GameState::new(
            content.hash.clone(),
            config.run_state.mode,
            config.run_state.wave,
            next_battle_id,
            rng.run_state(),
            Some(battle),
        )?;

        let (frontier, scripted_enemy_policy) = build_command_frontier(
            &state,
            &config.scripted_enemy_policy,
            content.as_ref(),
        )?;
        state
            .battle
            .as_mut()
            .ok_or(GameRuntimeError::NoActiveBattle)?
            .command_state = CommandCollectionState::new(frontier, Vec::new())?;
        validate_state_content(&state, content.as_ref()).map_err(map_legality_error)?;

        let allocators = initial_allocators(&human_seat_values)?;
        let control = project_command_frontier(
            &state,
            &human_seat_values,
            &allocators,
            content.as_ref(),
        )?;
        let runtime = Self {
            state,
            control,
            local_seat: config.local_seat,
            scripted_enemy_policy,
            menu_history: Vec::new(),
            command_fingerprints: Vec::new(),
            replacement_fingerprints: Vec::new(),
            content,
        };
        runtime.validate()?;
        Ok(runtime)
    }

    /// Alias with a name suitable for an integration adapter that obtains the
    /// seed from protocol/environment construction.
    pub fn from_battle_config(
        config: BattleGameConfig,
        wave_seed: &str,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        Self::new_battle_with_wave_seed(config, wave_seed, content)
    }

    pub fn with_wave_seed(
        config: BattleGameConfig,
        wave_seed: &str,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        Self::new_battle_with_wave_seed(config, wave_seed, content)
    }

    /// Rehydrate a game-owned runtime from canonical state and explicit
    /// logical-control/ledger values.  Snapshot owners use this instead of
    /// fresh-battle construction.
    #[allow(clippy::too_many_arguments)]
    pub fn from_parts(
        state: GameState,
        control: BattleControlPlan,
        local_seat: SeatId,
        scripted_enemy_policy: ScriptedEnemyPolicyV1,
        command_fingerprints: Vec<CommandFingerprintEntry>,
        replacement_fingerprints: Vec<ReplacementProposalFingerprintEntry>,
        content: Arc<ContentPack>,
    ) -> Result<Self, GameRuntimeError> {
        let runtime = Self {
            state,
            control,
            local_seat,
            scripted_enemy_policy,
            menu_history: Vec::new(),
            command_fingerprints,
            replacement_fingerprints,
            content,
        };
        runtime.validate()?;
        Ok(runtime)
    }

    pub fn state(&self) -> &GameState {
        &self.state
    }

    pub fn control(&self) -> &BattleControlPlan {
        &self.control
    }

    pub fn local_seat(&self) -> SeatId {
        self.local_seat
    }

    pub fn scripted_enemy_policy(&self) -> &ScriptedEnemyPolicyV1 {
        &self.scripted_enemy_policy
    }

    pub fn menu_history(&self) -> &[MenuHistoryEntry] {
        &self.menu_history
    }

    pub fn command_fingerprints(&self) -> &[CommandFingerprintEntry] {
        &self.command_fingerprints
    }

    pub fn replacement_fingerprints(&self) -> &[ReplacementProposalFingerprintEntry] {
        &self.replacement_fingerprints
    }

    pub fn content(&self) -> &ContentPack {
        self.content.as_ref()
    }

    pub fn validate(&self) -> Result<(), GameRuntimeError> {
        self.content.validate()?;
        validate_state_content(&self.state, self.content.as_ref()).map_err(map_legality_error)?;
        self.scripted_enemy_policy.validate()?;
        self.control.validate()?;
        let battle = self.state.battle.as_ref().ok_or(GameRuntimeError::NoActiveBattle)?;
        if self.control.battle_id != battle.battle_id
            || self.control.wave != battle.wave
            || self.control.turn != battle.turn
        {
            return Err(invalid_config("control plan coordinates do not match battle state"));
        }
        let seats = human_seats(&battle.format)?;
        if seats.len() != self.control.seats.len()
            || seats
                .iter()
                .zip(&self.control.seats)
                .any(|(expected, actual)| expected != &actual.seat)
        {
            return Err(invalid_config("control plan does not cover the canonical human seats"));
        }
        if !seats.contains(&self.local_seat) {
            return Err(invalid_config("local_seat is not a canonical human seat"));
        }
        validate_command_ledger(&self.command_fingerprints)?;
        validate_replacement_ledger(&self.replacement_fingerprints)?;
        Ok(())
    }

    /// Reduce one private game intent.  The caller owns the surrounding
    /// transaction and appends returned events to the kernel FIFO.
    pub fn reduce(&mut self, intent: GameIntent) -> Result<GameReduction, GameRuntimeError> {
        let mut candidate = self.clone();
        let reduction = candidate.reduce_inner(intent)?;
        candidate.validate()?;
        *self = candidate;
        Ok(reduction)
    }

    fn reduce_inner(&mut self, intent: GameIntent) -> Result<GameReduction, GameRuntimeError> {
        match intent {
            GameIntent::CommandProposal {
                proposal,
                authority_epoch,
            } => self.admit_command(proposal, authority_epoch),
            GameIntent::ReplacementProposal {
                proposal,
                authority_epoch,
            } => self.admit_replacement(proposal, authority_epoch),
            GameIntent::NoLegalReplacement {
                occurrence,
                authority_epoch,
            } => self.resolve_no_legal_replacement(occurrence, authority_epoch),
        }
    }

    /// Naming alias used by kernel reducers that call this boundary an
    /// intent handler rather than a state reducer.
    pub fn handle_intent(&mut self, intent: GameIntent) -> Result<GameReduction, GameRuntimeError> {
        self.reduce(intent)
    }

    /// Apply a prepared resolver result at the game-local material boundary.
    /// The kernel's common material applier remains the authoritative owner of
    /// serialized cross-owner material; this method only installs an already
    /// validated typed candidate into a staged game clone.
    pub fn install_resolution(
        &mut self,
        resolution: &PreparedBattleResolution,
    ) -> Result<(), GameRuntimeError> {
        let mut candidate = self.clone();
        candidate.install_resolution_inner(resolution)?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    fn install_resolution_inner(
        &mut self,
        resolution: &PreparedBattleResolution,
    ) -> Result<(), GameRuntimeError> {
        let (before, before_digest, after, after_digest, next_control) = match resolution {
            PreparedBattleResolution::Turn {
                transition,
                next_control,
                ..
            } => (
                &transition.before_state,
                &transition.before_digest,
                &transition.after_state,
                &transition.after_digest,
                next_control,
            ),
            PreparedBattleResolution::Replacement {
                transition,
                next_control,
                ..
            } => (
                &transition.before_state,
                &transition.before_digest,
                &transition.after_state,
                &transition.after_digest,
                next_control,
            ),
        };
        if &self.state != before {
            return Err(GameRuntimeError::TransitionBeforeMismatch);
        }
        let actual_before = er_state::digest::compute_mechanical_state_digest(&self.state)
            .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?;
        if &actual_before != before_digest {
            return Err(GameRuntimeError::TransitionDigestMismatch);
        }
        let actual_after = er_state::digest::compute_mechanical_state_digest(after)
            .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?;
        if &actual_after != after_digest {
            return Err(GameRuntimeError::TransitionDigestMismatch);
        }
        validate_state_content(after, self.content.as_ref()).map_err(map_legality_error)?;
        next_control.validate()?;
        self.remember_control_plan(next_control);
        self.state = after.clone();
        self.control = next_control.clone();
        Ok(())
    }

    /// Install a common-applier candidate after proving the exact live
    /// before-state digest.  Control installation remains a separate call so
    /// the kernel can preserve the frozen MaterialInstalled -> ControlInstalled
    /// causal boundary.  The staged runtime may temporarily carry the prior
    /// control coordinates; `GameTransaction::commit`/`validate` require the
    /// matching control before publication.
    pub fn install_state(
        &mut self,
        before_digest: &MechanicalStateDigest,
        after: GameState,
    ) -> Result<(), GameRuntimeError> {
        let mut candidate = self.clone();
        let actual_before = MechanicalStateDigest::compute(&candidate.state)
            .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?;
        if &actual_before != before_digest {
            return Err(GameRuntimeError::TransitionDigestMismatch);
        }
        validate_state_content(&after, candidate.content.as_ref()).map_err(map_legality_error)?;
        candidate.state = after;
        *self = candidate;
        Ok(())
    }

    /// Install a control plan after a common material applier has installed
    /// the matching mechanical state.
    pub fn install_control(&mut self, control: BattleControlPlan) -> Result<(), GameRuntimeError> {
        let mut candidate = self.clone();
        candidate.install_control_inner(control)?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    fn install_control_inner(&mut self, control: BattleControlPlan) -> Result<(), GameRuntimeError> {
        control.validate()?;
        let battle = self.state.battle.as_ref().ok_or(GameRuntimeError::NoActiveBattle)?;
        if control.battle_id != battle.battle_id
            || control.wave != battle.wave
            || control.turn != battle.turn
        {
            return Err(invalid_config("installed control has stale battle coordinates"));
        }
        self.remember_control_plan(&control);
        self.control = control;
        Ok(())
    }

    /// Begin a game-local clone-and-validate transaction.
    pub fn transaction(&self) -> crate::transaction::GameTransaction {
        crate::transaction::GameTransaction::begin(self)
    }

    fn admit_command(
        &mut self,
        proposal: BattleCommandProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Result<GameReduction, GameRuntimeError> {
        proposal.validate()?;
        if let Some(existing) = self
            .command_fingerprints
            .iter()
            .find(|entry| entry.operation_id == proposal.operation_id)
        {
            if existing.fingerprint == proposal.fingerprint() {
                return Ok(GameReduction {
                    admission: Some(CommandAdmission::IdempotentDuplicate {
                        operation_id: proposal.operation_id,
                    }),
                    events: Vec::new(),
                });
            }
            return Err(GameRuntimeError::CommandConflict {
                operation_id: proposal.operation_id,
            });
        }
        validate_command_proposal(&self.state, &proposal, self.content.as_ref())
            .map_err(map_legality_error)?;
        if !control_accepts_command(&self.control, &proposal) {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }

        let accepted = AcceptedBattleCommand::human(proposal.clone());
        let source = if proposal.owner_seat == self.local_seat {
            CommandAdmissionSource::AuthorityLocalInternal
        } else {
            CommandAdmissionSource::AuthorityRemoteProposal
        };
        let (complete, command_state, commands, battle_id, wave, turn) = {
            let battle = self
                .state
                .battle
                .as_mut()
                .ok_or(GameRuntimeError::NoActiveBattle)?;
            let entry = battle
                .command_state
                .frontier
                .iter_mut()
                .find(|entry| entry.operation_id == proposal.operation_id)
                .ok_or_else(|| GameRuntimeError::StateContent(
                    er_battle::legality::CommandLegalityError::MissingCommandFrontier {
                        operation_id: proposal.operation_id.clone(),
                    },
                ))?;
            match entry.status.clone() {
                CommandFrontierStatus::Pending => {
                    entry.status = CommandFrontierStatus::Retained {
                        command: accepted,
                        source,
                    };
                }
                CommandFrontierStatus::Retained { command, .. }
                | CommandFrontierStatus::Admitted { command, .. } => {
                    if command != accepted {
                        return Err(GameRuntimeError::CommandConflict {
                            operation_id: proposal.operation_id,
                        });
                    }
                    return Ok(GameReduction {
                        admission: Some(CommandAdmission::IdempotentDuplicate {
                            operation_id: proposal.operation_id,
                        }),
                        events: Vec::new(),
                    });
                }
            }
        let fingerprint = CommandFingerprintEntry::new(
            proposal.operation_id.clone(),
            proposal.fingerprint(),
        )?;
        self.command_fingerprints.push(fingerprint);
        self.command_fingerprints.sort_unstable_by(|left, right| {
            left.operation_id.cmp(&right.operation_id)
        });

            let complete = battle.command_state.frontier.iter().all(|entry| {
                matches!(
                    &entry.status,
                    CommandFrontierStatus::Retained { .. }
                        | CommandFrontierStatus::Admitted { .. }
                )
            });
            if complete {
                for entry in &mut battle.command_state.frontier {
                    if let CommandFrontierStatus::Retained { command, source } = &entry.status {
                        entry.status = CommandFrontierStatus::Admitted {
                            command: command.clone(),
                            source: *source,
                        };
                    }
                }
                battle.command_state.validate()?
            }
            let command_state = battle.command_state.clone();
            let commands = if complete {
                Some(command_state.admitted_command_set()?)
            } else {
                None
            };
            (
                complete,
                command_state,
                commands,
                battle.battle_id,
                battle.wave,
                battle.turn,
            )
        };
        let operation_id = proposal.operation_id.clone();
        if !complete {
            let waiting = project_waiting_after_command(
                &self.control,
                proposal.owner_seat,
                &command_state,
            )?;
            self.remember_control(proposal.owner_seat, waiting.clone());
            self.control = waiting;
            self.validate()?
        }
        if !complete {
            return Ok(GameReduction {
                admission: Some(CommandAdmission::Accepted {
                    operation_id,
                    frontier_complete: false,
                }),
                events: Vec::new(),
            });
        }

        let commands = commands.ok_or_else(|| invalid_config("complete frontier did not produce a command set"))?;
        let material_operation_id = turn_result_operation_id(battle_id, wave, turn)?;
        let transition = resolve_turn(
            &self.state,
            &commands,
            authority_epoch,
            &material_operation_id,
            self.content.as_ref(),
        )?;
        let next_control = self.project_next_control(&transition.after_state, &transition.next_decision)?;
        Ok(GameReduction {
            admission: Some(CommandAdmission::Accepted {
                operation_id,
                frontier_complete: true,
            }),
            events: vec![InternalEvent::BattleResolved(BattleResolvedPayload {
                resolution: PreparedBattleResolution::Turn {
                    transition,
                    material_operation_id,
                    next_control,
                },
            })],
        })
    }

    fn admit_replacement(
        &mut self,
        proposal: BattleReplacementProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Result<GameReduction, GameRuntimeError> {
        proposal.validate_with_epoch(authority_epoch)?;
        if let Some(existing) = self
            .replacement_fingerprints
            .iter()
            .find(|entry| entry.operation_id == proposal.operation_id)
        {
            if existing.fingerprint == proposal.fingerprint() {
                return Ok(GameReduction {
                    admission: Some(CommandAdmission::IdempotentDuplicate {
                        operation_id: proposal.operation_id,
                    }),
                    events: Vec::new(),
                });
            }
            return Err(GameRuntimeError::ReplacementConflict {
                operation_id: proposal.operation_id,
            });
        }
        validate_replacement_proposal(&self.state, &proposal, self.content.as_ref())
            .map_err(map_legality_error)?;
        if !control_accepts_replacement(&self.control, &proposal) {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let source_epoch = stored_replacement_epoch(&self.state, proposal.occurrence)?;
        if source_epoch != authority_epoch {
            return Err(GameRuntimeError::ReplacementEpochMismatch);
        }
        self.replacement_fingerprints.push(
            ReplacementProposalFingerprintEntry::new(
                proposal.operation_id.clone(),
                proposal.fingerprint(),
            )?,
        );
        self.replacement_fingerprints.sort_unstable_by(|left, right| {
            left.operation_id.cmp(&right.operation_id)
        });
        let transition = resolve_replacement(
            &self.state,
            proposal.occurrence,
            &proposal.selection,
            &proposal.operation_id,
            self.content.as_ref(),
        )?;
        let next_control = self.project_next_control(&transition.after_state, &transition.next_decision)?;
        Ok(GameReduction {
            admission: Some(CommandAdmission::Accepted {
                operation_id: proposal.operation_id.clone(),
                frontier_complete: true,
            }),
            events: vec![InternalEvent::BattleResolved(BattleResolvedPayload {
                resolution: PreparedBattleResolution::Replacement {
                    transition,
                    material_operation_id: proposal.operation_id,
                    next_control,
                },
            })],
        })
    }

    fn resolve_no_legal_replacement(
        &mut self,
        occurrence: FaintOccurrenceId,
        authority_epoch: AuthorityEpoch,
    ) -> Result<GameReduction, GameRuntimeError> {
        validate_replacement_selection(
            &self.state,
            occurrence,
            &ReplacementSelection::NoLegalReplacement,
            self.content.as_ref(),
        )
        .map_err(map_legality_error)?;
        let Some(battle) = self.state.battle.as_ref() else {
            return Err(GameRuntimeError::NoActiveBattle);
        };
        let Some(faint) = battle.faint_queue.iter().find(|faint| faint.id == occurrence) else {
            return Err(invalid_config("no-legal replacement occurrence is not stored"));
        };
        if faint.source.epoch != authority_epoch {
            return Err(GameRuntimeError::ReplacementEpochMismatch);
        }
        let material_operation_id = replacement_operation_id(
            faint.source.epoch,
            battle.battle_id,
            faint.source.wave,
            faint.source.resolved_turn,
            faint.source.turn_occurrence,
            faint.slot,
            faint.owner_seat.ok_or_else(|| invalid_config("enemy faint has no human replacement owner"))?,
        )?;
        let transition = resolve_replacement(
            &self.state,
            occurrence,
            &ReplacementSelection::NoLegalReplacement,
            &material_operation_id,
            self.content.as_ref(),
        )?;
        let next_control = self.project_next_control(&transition.after_state, &transition.next_decision)?;
        Ok(GameReduction {
            admission: None,
            events: vec![InternalEvent::BattleResolved(BattleResolvedPayload {
                resolution: PreparedBattleResolution::Replacement {
                    transition,
                    material_operation_id,
                    next_control,
                },
            })],
        })
    }

    fn project_next_control(
        &self,
        state: &GameState,
        decision: &BattleNextDecision,
    ) -> Result<BattleControlPlan, GameRuntimeError> {
        let battle = state.battle.as_ref().ok_or(GameRuntimeError::NoActiveBattle)?;
        let seats = human_seats(&battle.format)?;
        match decision {
            BattleNextDecision::CommandFrontier => {
                project_command_frontier(state, &seats, &self.control.menu_allocators, self.content.as_ref())
            }
            BattleNextDecision::Replacement { occurrence } => {
                project_replacement(state, *occurrence, &seats, &self.control.menu_allocators, self.content.as_ref())
            }
            BattleNextDecision::Complete(outcome) => {
                let mut entries = Vec::with_capacity(seats.len());
                for seat in &seats {
                    entries.push(SeatBattleControl::new(
                        *seat,
                        None,
                        BattleControl::complete(*outcome)?,
                    ));
                }
                BattleControlPlan::new(
                    BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    entries,
                    self.control.menu_allocators.clone(),
                )
                .map_err(GameRuntimeError::Control)
            }
        }
    }

    fn remember_control(&mut self, seat: SeatId, next: BattleControlPlan) {
        if let Some(previous) = self.control.seat(seat).map(|entry| entry.control.clone()) {
            if let Some(next_entry) = next.seat(seat) {
                self.menu_history.push(MenuHistoryEntry {
                    seat,
                    from: previous,
                    to: next_entry.control.clone(),
                });
            }
        }
    }

    fn remember_control_plan(&mut self, next: &BattleControlPlan) {
        let current = self.control.clone();
        for current_entry in current.seats {
            let Some(next_entry) = next.seat(current_entry.seat) else {
                continue;
            };
            if current_entry.control != next_entry.control {
                self.menu_history.push(MenuHistoryEntry {
                    seat: current_entry.seat,
                    from: current_entry.control,
                    to: next_entry.control.clone(),
                });
            }
        }
    }
}

fn invalid_config(message: &str) -> GameRuntimeError {
    GameRuntimeError::InvalidConfig {
        message: message.to_owned(),
    }
}

fn map_legality_error(
    source: er_battle::legality::CommandLegalityError,
) -> GameRuntimeError {
    match source {
        er_battle::legality::CommandLegalityError::Content(source) => {
            GameRuntimeError::Content(source)
        }
        er_battle::legality::CommandLegalityError::State(source) => GameRuntimeError::State(source),
        er_battle::legality::CommandLegalityError::Command(source) => {
            GameRuntimeError::Command(source)
        }
        er_battle::legality::CommandLegalityError::UnsupportedCapability { subject } => {
            GameRuntimeError::UnsupportedContent { subject }
        }
        source => GameRuntimeError::StateContent(source),
    }
}

fn increment_battle_id(value: BattleId) -> Result<BattleId, GameRuntimeError> {
    let next = value
        .get()
        .get()
        .checked_add(1)
        .ok_or_else(|| invalid_config("battle ID allocator exhausted"))?;
    let safe = SafeU53::new(next).map_err(|_| invalid_config("battle ID allocator exhausted"))?;
    Ok(BattleId::new(safe))
}

fn increment_safe(value: SafeU53, context: &'static str) -> Result<SafeU53, GameRuntimeError> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or_else(|| invalid_config(context))?;
    SafeU53::new(next).map_err(|_| invalid_config(context))
}

fn menu_id(value: SafeU53) -> MenuInstanceId {
    MenuInstanceId::new(value)
}

fn initial_allocators(seats: &[SeatId]) -> Result<Vec<SeatMenuInstanceAllocator>, GameRuntimeError> {
    seats
        .iter()
        .map(|seat| {
            SeatMenuInstanceAllocator::new(*seat, menu_id(SafeU53::new(1).map_err(|_| invalid_config("invalid initial menu allocator"))?))
                .map_err(|error| GameRuntimeError::Control(BattleControlPlanError::Allocator(error)))
        })
        .collect()
}

fn validate_start_parties(
    start: &BattleStartV1,
    human_seats: &[SeatId],
) -> Result<(), GameRuntimeError> {
    if start.player_leads.len() != usize::from(start.format.player_capacity)
        || start.enemy_leads.len() != usize::from(start.format.enemy_capacity)
    {
        return Err(invalid_config("lead vectors must match battle capacities"));
    }
    validate_leads(&start.player_party, &start.player_leads, Some(human_seats), BattleSide::Player)?;
    validate_leads(&start.enemy_party, &start.enemy_leads, None, BattleSide::Enemy)?;
    Ok(())
}

fn validate_leads(
    party: &[er_state::pokemon::PokemonState],
    leads: &[PartyIndex],
    human_seats: Option<&[SeatId]>,
    side: BattleSide,
) -> Result<(), GameRuntimeError> {
    let mut seen = Vec::new();
    for (position, lead) in leads.iter().enumerate() {
        if !seen.iter().all(|previous| previous != lead) {
            return Err(invalid_config("lead vectors must contain unique party slots"));
        }
        seen.push(*lead);
        let pokemon = party
            .get(usize::from(lead.get()))
            .ok_or_else(|| invalid_config("lead party slot is out of range"))?;
        if pokemon.fainted || pokemon.hp == 0 {
            return Err(invalid_config("lead party slot must be living"));
        }
        match (side, human_seats) {
            (BattleSide::Player, Some(seats)) => {
                let expected = seats
                    .get(position)
                    .copied()
                    .ok_or_else(|| invalid_config("player lead has no human owner"))?;
                if pokemon.owner_seat != Some(expected) {
                    return Err(invalid_config("player lead owner does not match canonical seat"));
                }
            }
            (BattleSide::Enemy, None) if pokemon.owner_seat.is_some() => {
                return Err(invalid_config("enemy lead must not have a human owner"));
            }
            _ => {}
        }
    }
    Ok(())
}

fn initial_field(start: &BattleStartV1) -> Result<FieldState, GameRuntimeError> {
    let player_slots = canonical_player_slots(&start.format)?;
    let enemy_slots: Vec<FieldSlot> = canonical_slots(&start.format)?
        .into_iter()
        .filter(|slot| slot.side == BattleSide::Enemy)
        .collect();
    let mut occupants = Vec::new();
    for (slot, party_slot) in player_slots.into_iter().zip(&start.player_leads) {
        let pokemon = start
            .player_party
            .get(usize::from(party_slot.get()))
            .ok_or_else(|| invalid_config("player lead party slot is out of range"))?;
        occupants.push(FieldSlotState::new(slot, Some(pokemon.id)));
    }
    for (slot, party_slot) in enemy_slots.into_iter().zip(&start.enemy_leads) {
        let pokemon = start
            .enemy_party
            .get(usize::from(party_slot.get()))
            .ok_or_else(|| invalid_config("enemy lead party slot is out of range"))?;
        occupants.push(FieldSlotState::new(slot, Some(pokemon.id)));
    }
    FieldState::new_for_format(&start.format, occupants).map_err(GameRuntimeError::Field)
}

fn build_command_frontier(
    state: &GameState,
    policy: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<(Vec<CommandFrontierEntry>, ScriptedEnemyPolicyV1), GameRuntimeError> {
    let battle = state.battle.as_ref().ok_or(GameRuntimeError::NoActiveBattle)?;
    let mut next_policy = policy.clone();
    let mut frontier = Vec::new();
    for slot in canonical_slots(&battle.format)? {
        let Some(actor) = battle.field.occupant(&battle.format, slot)? else {
            continue;
        };
        let (owner_seat, operation_id, offer, status) = match slot.side {
            BattleSide::Player => {
                let owner = owner_seat_for(&battle.format, slot)?.ok_or_else(|| invalid_config("player slot has no owner"))?;
                let operation = player_command_operation_id(battle.battle_id, battle.wave, battle.turn, slot, owner)?;
                let offer = build_command_offer(state, slot, content).map_err(map_legality_error)?;
                (Some(owner), operation, offer, CommandFrontierStatus::Pending)
            }
            BattleSide::Enemy => {
                let scripted = next_policy
                    .next_command()
                    .cloned()
                    .ok_or_else(|| invalid_config("scripted enemy policy has no command at cursor"))?;
                if scripted.battle_id != battle.battle_id
                    || scripted.wave != battle.wave
                    || scripted.turn != battle.turn
                    || scripted.field_slot != slot
                    || scripted.actor != actor
                {
                    return Err(invalid_config("scripted enemy command coordinates are stale"));
                }
                let operation = scripted_enemy_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    slot,
                    scripted.script_cursor,
                )?;
                let offer = build_scripted_enemy_offer(state, slot, &scripted.command, content)
                    .map_err(map_legality_error)?;
                let accepted = AcceptedBattleCommand::scripted_enemy(scripted);
                next_policy.cursor = increment_safe(next_policy.cursor, "scripted enemy cursor exhausted")?;
                (
                    None,
                    operation,
                    offer,
                    CommandFrontierStatus::Admitted {
                        command: accepted,
                        source: CommandAdmissionSource::ScriptedEnemy,
                    },
                )
            }
        };
        frontier.push(CommandFrontierEntry::new(
            operation_id,
            owner_seat,
            actor,
            slot,
            offer,
            status,
        )?);
    }
    Ok((frontier, next_policy))
}

fn project_command_frontier(
    state: &GameState,
    seats: &[SeatId],
    allocators: &[SeatMenuInstanceAllocator],
    content: &ContentPack,
) -> Result<BattleControlPlan, GameRuntimeError> {
    let battle = state.battle.as_ref().ok_or(GameRuntimeError::NoActiveBattle)?;
    let mut seat_entries = Vec::new();
    let mut next_allocators = allocators.to_vec();
    for seat in seats {
        let slot = FieldSlot {
            side: BattleSide::Player,
            position: seat.get().get().checked_sub(1).ok_or_else(|| invalid_config("seat is not one-based"))? as u8,
        };
        let actor = battle
            .field
            .occupant(&battle.format, slot)?
            .ok_or_else(|| invalid_config("human command slot is empty"))?;
        let offer = build_command_offer(state, slot, content).map_err(map_legality_error)?;
        let operation_id = player_command_operation_id(battle.battle_id, battle.wave, battle.turn, slot, *seat)?;
        let allocator = next_allocators
            .iter_mut()
            .find(|allocator| allocator.seat == *seat)
            .ok_or_else(|| invalid_config("missing human menu allocator"))?;
        let instance_id = allocator.next_menu_instance_id;
        allocator.next_menu_instance_id = menu_id(increment_safe(instance_id.get(), "menu allocator exhausted")?);
        let control_id = format!(
            "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
            battle.battle_id, battle.wave, battle.turn, slot.position, seat,
        );
        let menu = command_menu(instance_id, *seat, &control_id, &offer)?;
        let control = BattleControl::CommandRoot(CommandRootControl::new(actor, slot, menu)?);
        seat_entries.push(SeatBattleControl::new(*seat, Some(operation_id), control));
    }
    BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        battle.battle_id,
        battle.wave,
        battle.turn,
        seat_entries,
        next_allocators,
    )
    .map_err(GameRuntimeError::Control)
}

fn project_replacement(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    seats: &[SeatId],
    allocators: &[SeatMenuInstanceAllocator],
    content: &ContentPack,
) -> Result<BattleControlPlan, GameRuntimeError> {
    let battle = state.battle.as_ref().ok_or(GameRuntimeError::NoActiveBattle)?;
    let faint = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence)
        .ok_or_else(|| invalid_config("replacement decision occurrence is not stored"))?;
    let owner = faint
        .owner_seat
        .ok_or_else(|| invalid_config("enemy faint cannot create a human replacement control"))?;
    let offer = build_replacement_offer(state, occurrence, content).map_err(map_legality_error)?;
    let operation_id = replacement_operation_id(
        faint.source.epoch,
        battle.battle_id,
        faint.source.wave,
        faint.source.resolved_turn,
        faint.source.turn_occurrence,
        faint.slot,
        owner,
    )?;
    if offer.is_empty() {
        let entries = seats
            .iter()
            .map(|seat| {
                WaitingControl::new(
                    WaitingReason::ReplacementOwner,
                    vec![operation_id.clone()],
                )
                .map(|waiting| SeatBattleControl::new(*seat, None, BattleControl::Waiting(waiting)))
            })
            .collect::<Result<Vec<_>, _>>()?;
        return BattleControlPlan::new(
            BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
            battle.battle_id,
            battle.wave,
            battle.turn,
            entries,
            allocators.to_vec(),
        )
        .map_err(GameRuntimeError::Control);
    }
    let mut next_allocators = allocators.to_vec();
    let mut entries = Vec::with_capacity(seats.len());
    for seat in seats {
        if *seat == owner {
            let allocator = next_allocators
                .iter_mut()
                .find(|allocator| allocator.seat == *seat)
                .ok_or_else(|| invalid_config("missing replacement owner allocator"))?;
            let instance_id = allocator.next_menu_instance_id;
            allocator.next_menu_instance_id = menu_id(increment_safe(instance_id.get(), "menu allocator exhausted")?);
            let control_id = format!("{operation_id}/control/replacement");
            let menu = replacement_menu(instance_id, *seat, &control_id, &offer)?;
            let last = menu
                .options
                .first()
                .ok_or_else(|| invalid_config("replacement menu has no options"))?
                .option_id
                .clone();
            let last_right = menu
                .options
                .last()
                .ok_or_else(|| invalid_config("replacement menu has no options"))?
                .option_id
                .clone();
            let control = BattleControl::ReplacementSelect(ReplacementSelectControl::new(
                occurrence,
                faint.source,
                faint.pokemon,
                faint.slot,
                owner,
                menu,
                last,
                last_right,
            )?);
            entries.push(SeatBattleControl::new(*seat, Some(operation_id.clone()), control));
        } else {
            entries.push(SeatBattleControl::new(
                *seat,
                None,
                BattleControl::Waiting(WaitingControl::new(
                    WaitingReason::ReplacementOwner,
                    vec![operation_id.clone()],
                )?),
            ));
        }
    }
    BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        battle.battle_id,
        battle.wave,
        battle.turn,
        entries,
        next_allocators,
    )
    .map_err(GameRuntimeError::Control)
}

fn command_menu(
    instance_id: MenuInstanceId,
    owner: SeatId,
    control_id: &str,
    offer: &BattleCommandOffer,
) -> Result<BattleMenu, GameRuntimeError> {
    let mut options = Vec::new();
    for move_offer in &offer.fight {
        let id = MenuOptionId::new(format!("command/fight/{}", move_offer.move_slot.get()))?;
        options.push(BattleMenuOption::new(
            id.clone(),
            "battle.command.fight",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(id, options.len() as u16, 0, 0),
        )?);
    }
    for switch in &offer.switches {
        let id = MenuOptionId::new(format!("command/switch/{}", switch.party_slot.get()))?;
        options.push(BattleMenuOption::new(
            id.clone(),
            "battle.command.switch",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(id, options.len() as u16, 0, 0),
        )?);
    }
    let selected = options
        .first()
        .ok_or_else(|| invalid_config("legal command offer is empty"))?
        .option_id
        .clone();
    let navigation = adjacent_navigation(&options);
    BattleMenu::new(instance_id, owner, control_id, selected, options, navigation)
        .map_err(GameRuntimeError::Menu)
}

fn replacement_menu(
    instance_id: MenuInstanceId,
    owner: SeatId,
    control_id: &str,
    offer: &[er_types::battle_command::OfferedSwitchCommand],
) -> Result<BattleMenu, GameRuntimeError> {
    let mut options = Vec::new();
    for switch in offer {
        let id = MenuOptionId::new(format!("party/{}/slot/{}", switch.pokemon, switch.party_slot.get()))?;
        options.push(BattleMenuOption::new(
            id.clone(),
            "battle.replacement.select",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(id, options.len() as u16, 0, 0),
        )?);
    }
    let selected = options
        .first()
        .ok_or_else(|| invalid_config("replacement offer is empty"))?
        .option_id
        .clone();
    BattleMenu::new(
        instance_id,
        owner,
        control_id,
        selected,
        options.clone(),
        adjacent_navigation(&options),
    )
    .map_err(GameRuntimeError::Menu)
}

fn adjacent_navigation(options: &[BattleMenuOption]) -> Vec<MenuNavigationEdge> {
    let mut edges = Vec::new();
    for pair in options.windows(2) {
        edges.push(MenuNavigationEdge::new(
            pair[0].option_id.clone(),
            NavigationDirection::Down,
            pair[1].option_id.clone(),
        ));
        edges.push(MenuNavigationEdge::new(
            pair[1].option_id.clone(),
            NavigationDirection::Up,
            pair[0].option_id.clone(),
        ));
    }
    edges
}

fn control_accepts_command(control: &BattleControlPlan, proposal: &BattleCommandProposalV1) -> bool {
    let Some(seat) = control.seat(proposal.owner_seat) else {
        return false;
    };
    if seat.decision_operation_id.as_ref() != Some(&proposal.operation_id) {
        return false;
    }
    command_menu_identity(&seat.control)
        .is_some_and(|(menu, actor, slot)| {
            menu.instance_id == proposal.menu_instance_id
                && menu.control_id.as_str() == proposal.control_id.as_str()
                && actor == proposal.actor
                && slot == proposal.field_slot
        })
}

fn command_menu_identity(control: &BattleControl) -> Option<(&BattleMenu, PokemonId, FieldSlot)> {
    match control {
        BattleControl::CommandRoot(value) => Some((&value.menu, value.actor, value.field_slot)),
        BattleControl::MoveSelect(value) => Some((&value.menu, value.actor, value.field_slot)),
        BattleControl::TargetSelect(value) => Some((&value.menu, value.actor, value.field_slot)),
        BattleControl::PartySelect(value) => Some((&value.menu, value.actor, value.field_slot)),
        BattleControl::PartyOptionSelect(value) => Some((&value.menu, value.actor, value.field_slot)),
        BattleControl::ReplacementSelect(_) | BattleControl::Waiting(_) | BattleControl::Complete(_) => None,
    }
}

fn control_accepts_replacement(
    control: &BattleControlPlan,
    proposal: &BattleReplacementProposalV1,
) -> bool {
    let Some(seat) = control.seat(proposal.owner_seat) else {
        return false;
    };
    if seat.decision_operation_id.as_ref() != Some(&proposal.operation_id) {
        return false;
    }
    match &seat.control {
        BattleControl::ReplacementSelect(value) => {
            value.occurrence == proposal.occurrence
                && value.field_slot == proposal.field_slot
                && value.menu.instance_id == proposal.menu_instance_id
                && value.menu.control_id.as_str() == proposal.control_id.as_str()
        }
        _ => false,
    }
}

fn project_waiting_after_command(
    current: &BattleControlPlan,
    accepted_seat: SeatId,
    command_state: &CommandCollectionState,
) -> Result<BattleControlPlan, GameRuntimeError> {
    let remaining = command_state
        .frontier
        .iter()
        .filter(|entry| matches!(&entry.status, CommandFrontierStatus::Pending))
        .map(|entry| entry.operation_id.clone())
        .collect::<Vec<_>>();
    let waiting = BattleControl::Waiting(WaitingControl::new(
        WaitingReason::PartnerCommand,
        remaining,
    )?);
    let mut seats = current.seats.clone();
    let Some(entry) = seats.iter_mut().find(|entry| entry.seat == accepted_seat) else {
        return Err(invalid_config("accepted command seat is absent from control plan"));
    };
    entry.decision_operation_id = None;
    entry.control = waiting;
    BattleControlPlan::new(
        current.schema_version,
        current.battle_id,
        current.wave,
        current.turn,
        seats,
        current.menu_allocators.clone(),
    )
    .map_err(GameRuntimeError::Control)
}

fn stored_replacement_epoch(
    state: &GameState,
    occurrence: FaintOccurrenceId,
) -> Result<AuthorityEpoch, GameRuntimeError> {
    state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?
        .faint_queue
        .iter()
        .find(|faint| faint.id == occurrence)
        .map(|faint| faint.source.epoch)
        .ok_or_else(|| invalid_config("replacement occurrence is not stored"))
}

fn validate_command_ledger(entries: &[CommandFingerprintEntry]) -> Result<(), GameRuntimeError> {
    for entry in entries {
        entry.validate()?;
    }
    for pair in entries.windows(2) {
        if pair[0].operation_id >= pair[1].operation_id {
            return Err(invalid_config("command fingerprint ledger is not canonical"));
        }
    }
    Ok(())
}

fn validate_replacement_ledger(
    entries: &[ReplacementProposalFingerprintEntry],
) -> Result<(), GameRuntimeError> {
    for entry in entries {
        entry.validate()?;
    }
    for pair in entries.windows(2) {
        if pair[0].operation_id >= pair[1].operation_id {
            return Err(invalid_config("replacement fingerprint ledger is not canonical"));
        }
    }
    Ok(())
}
