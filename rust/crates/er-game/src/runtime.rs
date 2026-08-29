//! Deterministic game-owned battle runtime.
//!
//! This module owns the logical command frontier, control projection, and
//! game-local admission ledgers.  Mechanics remain in `er-battle`; the
//! kernel-owned protocol and cross-owner transaction consume the typed
//! reductions exposed here.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_battle::error::BattleResolveError;
use er_battle::legality::{
    build_command_offer_trusted, build_scripted_enemy_offer_trusted,
    validate_command_proposal_trusted, validate_replacement_proposal_trusted,
    validate_replacement_selection_trusted, validate_state_content_trusted,
};
use er_battle::{
    BattleNextDecision, resolve_replacement_trusted, resolve_turn_trusted_with_finalizer,
    validate_battle_mutation_evidence,
};
use er_content::pack::{ContentPack, ContentPackError};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_state::battle::BattleState;
use er_state::conditions::{GlobalAbilitySuppressionState, TerrainState, WeatherState};
use er_state::digest::MechanicalStateDigest;
use er_state::field::{FieldSlotState, FieldState, FieldStateError};
use er_state::format::{
    FormatTopologyError, canonical_player_slots, canonical_slots, human_seats, owner_seat_for,
    validate_m3_supported,
};
use er_state::snapshot::GameState;
use er_state::validation::StateValidationError;
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandError, BattleCommandOffer,
    BattleCommandProposalV1, BattleReplacementProposalV1, BattleTargetSelection,
    CommandAdmissionSource, CommandCollectionState, CommandFingerprintEntry, CommandFrontierEntry,
    CommandFrontierStatus, ReplacementProposalFingerprintEntry, ReplacementSelection,
    player_command_operation_id, replacement_operation_id, scripted_enemy_command_operation_id,
    turn_result_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlError, BattleControlPlan,
    BattleControlPlanError, BattleMenu, SeatBattleControl, SeatMenuInstanceAllocator,
    WaitingControl, WaitingReason,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleFormat, BattleId, BattleSide, FaintOccurrenceId, FieldSlot,
    MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex,
};
use er_types::battle_model::BattleOutcome;
use er_types::battle_model::ReplacementProgress;
use er_types::battle_ui::NavigationDirection;
use er_types::ids::{MenuOptionId, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::authority_commands::{
    PreparedAuthorityAdmission, PreparedAuthorityMenuPath, PreparedAuthorityReplacement,
    PreparedAuthorityTurn, PreparedReplacementFingerprintEvidence,
};
use crate::command_menu::{
    CommandChoice, CommandMenuError, CommandRootSelection, build_command_root_control,
    select_command,
};
use crate::internal_event::{
    BattleResolvedPayload, CausalIdentity, GameEventPayload, GameIntent, InternalEvent,
    PreparedBattleResolution, TurnDigestEvidence, UiEventPayload,
};
use crate::move_menu::{
    MoveActivation, MoveMenuEntry, MoveMenuError, MoveSelectionError, build_move_control,
    move_option_id, select_move,
};
use crate::party_menu::{PartyMenuError, build_party_select, navigate_party_menu, party_option_id};
use crate::party_option_menu::{
    PARTY_OPTION_CANCEL_ID, PARTY_OPTION_SEND_OUT_ID, PartyOptionMenuError,
    open_party_option_menu_from_control, restore_parent_menu,
};
use crate::replacement_menu::{
    ReplacementMenuError, ReplacementMenuResult, build_replacement_menu, navigate_replacement_menu,
};
use crate::snapshot::{
    GameRuntimeSnapshotBridge, GameRuntimeSnapshotV2, SeatControlHistorySnapshotV1, SnapshotError,
    bounded_control_history,
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
    /// The exact production `BattleScene.waveSeed` value.  This is part of the
    /// canonical game boundary so a fresh runtime cannot silently diverge from
    /// the Phaser/Rust battle RNG stream.
    pub wave_seed: String,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
}

/// The runtime-local conversion of C01's private UI action.  The kernel passes
/// an opaque `UiEventPayload` to `reduce_ui`; it never needs this semantic
/// type or a public action constructor.
#[derive(Clone, Debug, Eq, PartialEq)]
enum RuntimeUiAction {
    Activate {
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: String,
        option_id: MenuOptionId,
    },
    Cancel {
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: String,
        option_id: MenuOptionId,
    },
}

/// Result of a semantic UI transition.  Submenu/cancel transitions return no
/// proposal; only a validated final confirmation crosses this boundary.
#[doc(hidden)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BattleUiResult {
    ControlChanged,
    CommandProposal(BattleCommandProposalV1),
    ReplacementProposal(BattleReplacementProposalV1),
}

/// Private authority-side replay evidence.  C06 owns the public
/// `authority_commands::{PreparedAuthorityAdmission, PreparedAuthorityMenuPath}`
/// handoff on the integrated branch; this isolated runtime keeps only a
/// renamed, equivalent local proof record so it does not duplicate those
/// public types.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeAuthorityMenuPath {
    pub(crate) operation_id: er_types::OperationId,
    pub(crate) control: BattleControl,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PendingNoLegalReplacementFollowup {
    occurrence: FaintOccurrenceId,
    authority_epoch: AuthorityEpoch,
    operation_id: er_types::OperationId,
    prepared_control: BattleControlPlan,
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
    #[error("command menu projection failed: {0}")]
    CommandMenu(#[from] CommandMenuError),
    #[error("replacement menu projection failed: {0}")]
    ReplacementMenu(#[from] ReplacementMenuError),
    #[error("move menu projection failed: {0}")]
    MoveMenu(#[from] MoveMenuError),
    #[error("move selection failed: {0}")]
    MoveSelection(#[from] MoveSelectionError),
    #[error("party menu projection failed: {0}")]
    PartyMenu(#[from] PartyMenuError),
    #[error("party-option menu projection failed: {0}")]
    PartyOptionMenu(#[from] PartyOptionMenuError),
    #[error("target menu projection failed: {0}")]
    TargetMenu(#[from] crate::target_menu::TargetMenuError),
    #[error("battle UI transition rejected: {message}")]
    UiTransition { message: String },
    #[error("the battle game config is invalid: {message}")]
    InvalidConfig { message: String },
    #[error("a command proposal conflicts with retained operation {operation_id}")]
    CommandConflict { operation_id: er_types::OperationId },
    #[error("a replacement proposal conflicts with retained operation {operation_id}")]
    ReplacementConflict { operation_id: er_types::OperationId },
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
    #[error("the prepared material operation identity is stale or malformed")]
    MaterialOperationMismatch,
    #[error("the prepared transition kind or coordinates are inconsistent")]
    TransitionIdentityMismatch,
    #[error("the prepared control is not the exact semantic projection")]
    ControlProjectionMismatch,
    #[error("the installed menu allocator regressed or skipped its exact next value")]
    AllocatorMismatch,
    #[error("the current logical operation binding does not match the transition")]
    CurrentOperationMismatch,
    #[error("the no-legal replacement event was not scheduled by the runtime")]
    UnscheduledNoLegalReplacement,
    #[error("replica proposals must use the explicit retention boundary")]
    ReplicaAuthorityReductionForbidden,
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
    authority_remote_paths: BTreeMap<er_types::OperationId, RuntimeAuthorityMenuPath>,
    pending_no_legal_replacement: Option<PendingNoLegalReplacementFollowup>,
    pub(crate) content: Arc<ContentPack>,
}

#[derive(Clone, Copy)]
enum MaterialInstallValidation {
    Full,
    CommonApplierVerified,
}

impl GameRuntime {
    /// Construct a fresh battle from one canonical, serializable game config.
    /// The config carries the exact production wave seed; no adapter-only seed
    /// path or fallback is permitted at this boundary.
    pub fn new_battle(
        config: BattleGameConfig,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        let wave_seed = config.wave_seed.clone();
        Self::new_battle_inner(config, &wave_seed, content)
    }

    pub fn new(
        config: BattleGameConfig,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        Self::new_battle(config, content)
    }

    /// Rehydrates the battle runtime from an already-created canonical battle
    /// without consuming battle/run RNG or allocating a new battle identity.
    pub fn from_existing_battle(
        mut state: GameState,
        local_seat: SeatId,
        scripted_enemy_policy: ScriptedEnemyPolicyV1,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        content.validate()?;
        scripted_enemy_policy.validate()?;
        validate_state_content_trusted(&state, content.as_ref()).map_err(map_legality_error)?;
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| invalid_config("existing battle state is missing"))?;
        let human_seat_values = human_seats(&battle.format)?;
        if !human_seat_values.contains(&local_seat) {
            return Err(invalid_config("local_seat is not a human battle seat"));
        }
        let (frontier, scripted_enemy_policy) =
            build_command_frontier(&state, &scripted_enemy_policy, content.as_ref())?;
        state
            .battle
            .as_mut()
            .ok_or(GameRuntimeError::NoActiveBattle)?
            .command_state = CommandCollectionState::new(frontier, Vec::new())?;
        validate_state_content_trusted(&state, content.as_ref()).map_err(map_legality_error)?;
        let allocators = initial_allocators(&human_seat_values)?;
        let control =
            project_command_frontier(&state, &human_seat_values, &allocators, content.as_ref())?;
        let runtime = Self {
            state,
            control,
            local_seat,
            scripted_enemy_policy,
            menu_history: Vec::new(),
            command_fingerprints: Vec::new(),
            replacement_fingerprints: Vec::new(),
            authority_remote_paths: BTreeMap::new(),
            pending_no_legal_replacement: None,
            content,
        };
        runtime.validate()?;
        Ok(runtime)
    }

    fn new_battle_inner(
        config: BattleGameConfig,
        wave_seed: &str,
        content: Arc<ContentPack>,
    ) -> Result<Self, BattleInitializationError> {
        if wave_seed.is_empty() {
            return Err(invalid_config("wave_seed must not be empty"));
        }
        content.validate()?;
        config.scripted_enemy_policy.validate()?;
        validate_state_content_trusted(&config.run_state, content.as_ref())
            .map_err(map_legality_error)?;
        if config.run_state.battle.is_some() {
            return Err(invalid_config(
                "run_state.battle must be None at battle start",
            ));
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

        let (frontier, scripted_enemy_policy) =
            build_command_frontier(&state, &config.scripted_enemy_policy, content.as_ref())?;
        state
            .battle
            .as_mut()
            .ok_or(GameRuntimeError::NoActiveBattle)?
            .command_state = CommandCollectionState::new(frontier, Vec::new())?;
        validate_state_content_trusted(&state, content.as_ref()).map_err(map_legality_error)?;

        let allocators = initial_allocators(&human_seat_values)?;
        let control =
            project_command_frontier(&state, &human_seat_values, &allocators, content.as_ref())?;
        let runtime = Self {
            state,
            control,
            local_seat: config.local_seat,
            scripted_enemy_policy,
            menu_history: Vec::new(),
            command_fingerprints: Vec::new(),
            replacement_fingerprints: Vec::new(),
            authority_remote_paths: BTreeMap::new(),
            pending_no_legal_replacement: None,
            content,
        };
        runtime.validate()?;
        Ok(runtime)
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
            authority_remote_paths: BTreeMap::new(),
            pending_no_legal_replacement: None,
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

    /// Return the exact menu anchors retained by live remote admissions.
    /// Snapshot serialization uses these anchors when the public control
    /// history is compacted; deriving them from the installed replay paths
    /// keeps the snapshot boundary aligned with restoration rather than with
    /// every historical menu transition.
    pub(crate) fn restorable_remote_control_anchors(&self) -> BTreeMap<SeatId, Vec<BattleControl>> {
        let mut anchors = BTreeMap::new();
        for path in self.authority_remote_paths.values() {
            let Some(seat) = path.control.owner_seat() else {
                continue;
            };
            let retained = anchors.entry(seat).or_insert_with(Vec::new);
            collect_remote_control_anchors(&path.control, retained);
        }
        anchors
    }

    pub fn content(&self) -> &ContentPack {
        self.content.as_ref()
    }

    fn prepared_authority_admission(&self) -> PreparedAuthorityAdmission {
        let remote_paths = self
            .authority_remote_paths
            .iter()
            .map(|(operation_id, path)| {
                (
                    operation_id.clone(),
                    PreparedAuthorityMenuPath::from_game_runtime(
                        path.operation_id.clone(),
                        path.control.clone(),
                    ),
                )
            })
            .collect();
        PreparedAuthorityAdmission::from_game_runtime(
            self.control.menu_allocators.clone(),
            remote_paths,
        )
    }

    /// Close one runtime-produced TURN resolution into C06's authority-only
    /// handoff. The transition and projected control are revalidated against
    /// this exact runtime, so the kernel cannot combine loose candidates.
    #[doc(hidden)]
    pub fn prepare_authority_turn(
        &self,
        digest_evidence: TurnDigestEvidence,
        material_operation_id: &er_types::OperationId,
        control_plan: BattleControlPlan,
    ) -> Result<PreparedAuthorityTurn, GameRuntimeError> {
        let transition = digest_evidence.transition();
        validate_reducer_issued_turn_transition_identity(self, transition, material_operation_id)?;
        let expected = project_battle_control_plan(
            &transition.after_state,
            transition.next_decision,
            &self.control.menu_allocators,
            self.content.as_ref(),
        )?;
        if expected != control_plan {
            return Err(GameRuntimeError::ControlProjectionMismatch);
        }
        Ok(PreparedAuthorityTurn::from_game_runtime(
            digest_evidence,
            control_plan,
            self.prepared_authority_admission(),
        ))
    }

    /// Replacement counterpart to [`Self::prepare_authority_turn`]. The
    /// fingerprint evidence is copied read-only from the runtime's sole
    /// mutable ledger.
    #[doc(hidden)]
    pub fn prepare_authority_replacement(
        &self,
        transition: er_battle::BattleReplacementTransition,
        material_operation_id: &er_types::OperationId,
        control_plan: BattleControlPlan,
    ) -> Result<PreparedAuthorityReplacement, GameRuntimeError> {
        validate_replacement_transition_identity(self, &transition, material_operation_id)?;
        let expected = project_battle_control_plan(
            &transition.after_state,
            transition.next_decision,
            &self.control.menu_allocators,
            self.content.as_ref(),
        )?;
        if expected != control_plan {
            return Err(GameRuntimeError::ControlProjectionMismatch);
        }
        let replacement_fingerprints = PreparedReplacementFingerprintEvidence::from_game_runtime(
            self.replacement_fingerprints.clone(),
        )
        .map_err(|_| invalid_config("replacement fingerprint evidence is invalid"))?;
        Ok(PreparedAuthorityReplacement {
            transition,
            control_plan,
            admission: self.prepared_authority_admission(),
            replacement_fingerprints,
        })
    }

    pub fn validate(&self) -> Result<(), GameRuntimeError> {
        self.content.validate()?;
        self.validate_transactional()
    }

    /// Validate a staged runtime after its immutable content pack has already
    /// passed a construction or restore boundary.
    ///
    /// This preserves state/content membership, policy, control, ledger, and
    /// pending-work checks, but intentionally skips `ContentPack::validate()`
    /// and its canonical hash recomputation.  The battle kernel uses this only
    /// inside its clone-and-swap transaction; public and snapshot boundaries
    /// must call [`Self::validate`] instead.
    #[doc(hidden)]
    pub fn validate_transactional(&self) -> Result<(), GameRuntimeError> {
        validate_state_content_trusted(&self.state, self.content.as_ref())
            .map_err(map_legality_error)?;
        self.scripted_enemy_policy.validate()?;
        self.control.validate()?;
        let battle = self
            .state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?;
        let decision = decision_for_state(&self.state)?;
        let expected_control_turn = expected_control_plan_turn(battle, decision)?;
        if self.control.battle_id != battle.battle_id
            || self.control.wave != battle.wave
            || self.control.turn != expected_control_turn
        {
            return Err(invalid_config(
                "control plan coordinates do not match its logical decision",
            ));
        }
        let seats = human_seats(&battle.format)?;
        if seats.len() != self.control.seats.len()
            || seats
                .iter()
                .zip(&self.control.seats)
                .any(|(expected, actual)| expected != &actual.seat)
        {
            return Err(invalid_config(
                "control plan does not cover the canonical human seats",
            ));
        }
        if !seats.contains(&self.local_seat) {
            return Err(invalid_config("local_seat is not a canonical human seat"));
        }
        validate_command_ledger(&self.command_fingerprints)?;
        validate_replacement_ledger(&self.replacement_fingerprints)?;
        for (operation_id, path) in &self.authority_remote_paths {
            if path.operation_id != *operation_id {
                return Err(GameRuntimeError::ControlIdentityMismatch);
            }
            path.control.validate()?;
        }
        if let Some(pending) = &self.pending_no_legal_replacement {
            let faint = battle
                .faint_queue
                .iter()
                .find(|candidate| candidate.id == pending.occurrence)
                .ok_or_else(|| invalid_config("pending no-legal replacement is not stored"))?;
            if faint.source.epoch != pending.authority_epoch {
                return Err(GameRuntimeError::ReplacementEpochMismatch);
            }
            if !pending
                .prepared_control
                .seats
                .iter()
                .any(|entry| match &entry.control {
                    BattleControl::Waiting(waiting) => {
                        waiting.operation_ids.contains(&pending.operation_id)
                    }
                    _ => false,
                })
            {
                return Err(GameRuntimeError::CurrentOperationMismatch);
            }
        }
        Ok(())
    }

    /// Reduce one private game intent.  The caller owns the surrounding
    /// transaction and appends returned events to the kernel FIFO.
    pub fn reduce(&mut self, intent: GameIntent) -> Result<GameReduction, GameRuntimeError> {
        let mut candidate = self.clone();
        let reduction = candidate.reduce_inner(intent)?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(reduction)
    }

    fn reduce_inner(&mut self, intent: GameIntent) -> Result<GameReduction, GameRuntimeError> {
        match intent {
            GameIntent::CommandProposal { .. } if self.is_replica_role() => {
                Err(GameRuntimeError::ReplicaAuthorityReductionForbidden)
            }
            GameIntent::CommandProposal {
                proposal,
                authority_epoch,
            } => self.admit_command(proposal, authority_epoch),
            GameIntent::ReplacementProposal { .. } if self.is_replica_role() => {
                Err(GameRuntimeError::ReplicaAuthorityReductionForbidden)
            }
            GameIntent::ReplacementProposal {
                proposal,
                authority_epoch,
            } => self.admit_replacement(proposal, authority_epoch),
            GameIntent::NoLegalReplacement { .. } if self.is_replica_role() => {
                Err(GameRuntimeError::ReplicaAuthorityReductionForbidden)
            }
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

    /// Retain the replica's own final command without invoking authority
    /// resolution.  The common authority/material path later reconciles the
    /// admitted command; a local replica must only move its own seat to
    /// Waiting and retain the authority-relative remote source.
    #[doc(hidden)]
    pub fn retain_replica_command(
        &mut self,
        proposal: BattleCommandProposalV1,
    ) -> Result<CommandAdmission, GameRuntimeError> {
        let mut candidate = self.clone();
        let admission = candidate.retain_replica_command_in_kernel_transaction(proposal)?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(admission)
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    pub fn retain_replica_command_in_kernel_transaction(
        &mut self,
        proposal: BattleCommandProposalV1,
    ) -> Result<CommandAdmission, GameRuntimeError> {
        self.retain_replica_command_inner(proposal)
    }

    fn retain_replica_command_inner(
        &mut self,
        proposal: BattleCommandProposalV1,
    ) -> Result<CommandAdmission, GameRuntimeError> {
        if !self.is_replica_role() || proposal.owner_seat != self.local_seat {
            return Err(GameRuntimeError::ReplicaAuthorityReductionForbidden);
        }
        proposal.validate()?;
        if let Some(existing) = self
            .command_fingerprints
            .iter()
            .find(|entry| entry.operation_id == proposal.operation_id)
        {
            if existing.fingerprint == proposal.fingerprint() {
                return Ok(CommandAdmission::IdempotentDuplicate {
                    operation_id: proposal.operation_id,
                });
            }
            return Err(GameRuntimeError::CommandConflict {
                operation_id: proposal.operation_id,
            });
        }
        validate_command_proposal_trusted(&self.state, &proposal, self.content.as_ref())
            .map_err(map_legality_error)?;
        if !control_accepts_command(&self.state, &self.control, &proposal) {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let accepted = AcceptedBattleCommand::human(proposal.clone());
        let command_state = {
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
                .ok_or_else(|| {
                    GameRuntimeError::StateContent(
                        er_battle::legality::CommandLegalityError::MissingCommandFrontier {
                            operation_id: proposal.operation_id.clone(),
                        },
                    )
                })?;
            match entry.status.clone() {
                CommandFrontierStatus::Pending => {
                    entry.status = CommandFrontierStatus::Retained {
                        command: accepted,
                        source: CommandAdmissionSource::AuthorityRemoteProposal,
                    };
                }
                CommandFrontierStatus::Retained { command, .. }
                | CommandFrontierStatus::Admitted { command, .. } => {
                    if command == accepted {
                        return Ok(CommandAdmission::IdempotentDuplicate {
                            operation_id: proposal.operation_id,
                        });
                    }
                    return Err(GameRuntimeError::CommandConflict {
                        operation_id: proposal.operation_id,
                    });
                }
            }
            battle.command_state.clone()
        };
        self.advance_allocator_through_menu_instance(
            proposal.owner_seat,
            proposal.menu_instance_id,
        )?;
        self.command_fingerprints.push(CommandFingerprintEntry::new(
            proposal.operation_id.clone(),
            proposal.fingerprint(),
        )?);
        self.command_fingerprints
            .sort_unstable_by(|left, right| left.operation_id.cmp(&right.operation_id));
        let waiting =
            project_waiting_after_command(&self.control, proposal.owner_seat, &command_state)?;
        self.remember_control(proposal.owner_seat, waiting.clone())?;
        self.control = waiting;
        Ok(CommandAdmission::Accepted {
            operation_id: proposal.operation_id,
            frontier_complete: false,
        })
    }

    /// Retain the replica's own final replacement without invoking the
    /// authority resolver.  Its owner seat becomes Waiting until common
    /// authority material installs the selected replacement.
    #[doc(hidden)]
    pub fn retain_replica_replacement(
        &mut self,
        proposal: BattleReplacementProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Result<CommandAdmission, GameRuntimeError> {
        let mut candidate = self.clone();
        let admission = candidate
            .retain_replica_replacement_in_kernel_transaction(proposal, authority_epoch)?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(admission)
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    pub fn retain_replica_replacement_in_kernel_transaction(
        &mut self,
        proposal: BattleReplacementProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Result<CommandAdmission, GameRuntimeError> {
        self.retain_replica_replacement_inner(proposal, authority_epoch)
    }

    fn retain_replica_replacement_inner(
        &mut self,
        proposal: BattleReplacementProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Result<CommandAdmission, GameRuntimeError> {
        if !self.is_replica_role() || proposal.owner_seat != self.local_seat {
            return Err(GameRuntimeError::ReplicaAuthorityReductionForbidden);
        }
        proposal.validate_with_epoch(authority_epoch)?;
        if let Some(existing) = self
            .replacement_fingerprints
            .iter()
            .find(|entry| entry.operation_id == proposal.operation_id)
        {
            if existing.fingerprint == proposal.fingerprint() {
                return Ok(CommandAdmission::IdempotentDuplicate {
                    operation_id: proposal.operation_id,
                });
            }
            return Err(GameRuntimeError::ReplacementConflict {
                operation_id: proposal.operation_id,
            });
        }
        validate_replacement_proposal_trusted(&self.state, &proposal, self.content.as_ref())
            .map_err(map_legality_error)?;
        if !control_accepts_replacement(&self.state, &self.control, &proposal) {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        if stored_replacement_epoch(&self.state, proposal.occurrence)? != authority_epoch {
            return Err(GameRuntimeError::ReplacementEpochMismatch);
        }
        self.advance_allocator_through_menu_instance(
            proposal.owner_seat,
            proposal.menu_instance_id,
        )?;
        self.replacement_fingerprints
            .push(ReplacementProposalFingerprintEntry::new(
                proposal.operation_id.clone(),
                proposal.fingerprint(),
            )?);
        self.replacement_fingerprints
            .sort_unstable_by(|left, right| left.operation_id.cmp(&right.operation_id));
        let waiting = project_waiting_after_replacement(
            &self.control,
            proposal.owner_seat,
            &proposal.operation_id,
        )?;
        self.remember_control(proposal.owner_seat, waiting.clone())?;
        self.control = waiting;
        Ok(CommandAdmission::Accepted {
            operation_id: proposal.operation_id,
            frontier_complete: false,
        })
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
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(())
    }

    fn install_resolution_inner(
        &mut self,
        resolution: &PreparedBattleResolution,
    ) -> Result<(), GameRuntimeError> {
        match resolution {
            PreparedBattleResolution::Turn {
                digest_evidence,
                material_operation_id,
                next_control,
            } => {
                let transition = digest_evidence.transition();
                validate_turn_transition_identity(self, transition, material_operation_id)?;
                let allocator_before = self.control.menu_allocators.clone();
                self.install_material_inner(
                    &transition.before_digest,
                    transition.after_state.clone(),
                    &transition.after_digest,
                    material_operation_id,
                    transition.next_decision,
                    allocator_before,
                    next_control.clone(),
                    MaterialInstallValidation::Full,
                )
            }
            PreparedBattleResolution::Replacement {
                transition,
                material_operation_id,
                next_control,
            } => {
                validate_replacement_transition_identity(self, transition, material_operation_id)?;
                let allocator_before = self.control.menu_allocators.clone();
                self.install_material_inner(
                    &transition.before_digest,
                    transition.after_state.clone(),
                    &transition.after_digest,
                    material_operation_id,
                    transition.next_decision,
                    allocator_before,
                    next_control.clone(),
                    MaterialInstallValidation::Full,
                )
            }
        }
    }

    fn is_replica_role(&self) -> bool {
        self.state
            .battle
            .as_ref()
            .is_some_and(|battle| self.local_seat != battle.authority_seat)
    }

    /// Install one common-applier result for either authority or replica.
    ///
    /// The serialized frontier is the only policy evidence: the method
    /// reconstructs the scripted entries from the current cursor, compares
    /// them byte-for-byte with the material after-state, and commits the
    /// cloned cursor exactly once.  State, allocator high-water marks, and
    /// control are then swapped together, so neither role can take a
    /// host-only policy path or advance twice.
    #[doc(hidden)]
    #[allow(clippy::too_many_arguments)]
    pub fn install_material(
        &mut self,
        _before_digest: &MechanicalStateDigest,
        after: GameState,
        after_digest: &MechanicalStateDigest,
        material_operation_id: &er_types::OperationId,
        next_decision: BattleNextDecision,
        allocator_before: Vec<SeatMenuInstanceAllocator>,
        next_control: BattleControlPlan,
    ) -> Result<(), GameRuntimeError> {
        let mut candidate = self.clone();
        candidate.install_material_inner(
            _before_digest,
            after,
            after_digest,
            material_operation_id,
            next_decision,
            allocator_before,
            next_control,
            MaterialInstallValidation::Full,
        )?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(())
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    #[allow(clippy::too_many_arguments)]
    pub fn install_material_in_kernel_transaction(
        &mut self,
        _before_digest: &MechanicalStateDigest,
        after: GameState,
        after_digest: &MechanicalStateDigest,
        material_operation_id: &er_types::OperationId,
        next_decision: BattleNextDecision,
        allocator_before: Vec<SeatMenuInstanceAllocator>,
        next_control: BattleControlPlan,
    ) -> Result<(), GameRuntimeError> {
        self.install_material_inner(
            _before_digest,
            after,
            after_digest,
            material_operation_id,
            next_decision,
            allocator_before,
            next_control,
            MaterialInstallValidation::CommonApplierVerified,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn install_material_inner(
        &mut self,
        _before_digest: &MechanicalStateDigest,
        after: GameState,
        after_digest: &MechanicalStateDigest,
        material_operation_id: &er_types::OperationId,
        next_decision: BattleNextDecision,
        allocator_before: Vec<SeatMenuInstanceAllocator>,
        next_control: BattleControlPlan,
        validation: MaterialInstallValidation,
    ) -> Result<(), GameRuntimeError> {
        // The common material applier has already authenticated/reconciled
        // `before_digest`.  A replica may intentionally retain a compatible
        // partial TURN frontier, so comparing that complete digest with this
        // local snapshot would reject a valid material result.  Keep the
        // role-neutral checks below on coordinates and operation binding.
        // Independently callable installation also recomputes the after
        // digest and exact projected control; the staged kernel path reuses
        // those proofs from the common applier in this same transaction.
        validate_state_coordinate_progression(&self.state, &after)?;
        if matches!(validation, MaterialInstallValidation::Full) {
            validate_state_content_trusted(&after, self.content.as_ref())
                .map_err(map_legality_error)?;
            let actual_after = MechanicalStateDigest::compute(&after)
                .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?;
            if &actual_after != after_digest {
                return Err(GameRuntimeError::TransitionDigestMismatch);
            }
        }
        if expected_material_operation_id(&self.state)? != *material_operation_id {
            return Err(GameRuntimeError::MaterialOperationMismatch);
        }
        validate_current_operation_binding(&self.state, &self.control, material_operation_id)?;
        if decision_for_state(&after)? != next_decision {
            return Err(GameRuntimeError::TransitionIdentityMismatch);
        }
        if matches!(validation, MaterialInstallValidation::Full) {
            let expected_control = project_battle_control_plan(
                &after,
                next_decision,
                &allocator_before,
                self.content.as_ref(),
            )?;
            if expected_control != next_control {
                return Err(GameRuntimeError::ControlProjectionMismatch);
            }
            validate_allocator_installation(
                &self.control.menu_allocators,
                &allocator_before,
                &next_control.menu_allocators,
            )?;
            next_control.validate()?;
        }

        // This is deliberately after every material/equality check.  A
        // rejected or partially decoded material cannot consume a scripted
        // cursor, and both endpoint roles execute this same operation.
        self.advance_scripted_policy_for_material(&after, next_decision)?;
        self.remember_control_plan(&next_control)?;
        self.state = after;
        self.control = next_control;
        self.authority_remote_paths.clear();
        self.schedule_no_legal_replacement_followup(&next_decision)?;
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
        validate_state_content_trusted(&after, candidate.content.as_ref())
            .map_err(map_legality_error)?;
        validate_state_coordinate_progression(&candidate.state, &after)?;
        let decision = decision_for_state(&after)?;
        candidate.advance_scripted_policy_for_material(&after, decision)?;
        candidate.state = after;
        *self = candidate;
        Ok(())
    }

    /// Install a control plan after a common material applier has installed
    /// the matching mechanical state.
    pub fn install_control(&mut self, control: BattleControlPlan) -> Result<(), GameRuntimeError> {
        let mut candidate = self.clone();
        candidate.install_control_inner(control)?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(())
    }

    fn install_control_inner(
        &mut self,
        control: BattleControlPlan,
    ) -> Result<(), GameRuntimeError> {
        control.validate()?;
        let battle = self
            .state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?;
        let decision = decision_for_state(&self.state)?;
        let expected_control_turn = expected_control_plan_turn(battle, decision)?;
        if control.battle_id != battle.battle_id
            || control.wave != battle.wave
            || control.turn != expected_control_turn
        {
            return Err(invalid_config(
                "installed control has stale logical coordinates",
            ));
        }
        let expected = project_battle_control_plan(
            &self.state,
            decision,
            &self.control.menu_allocators,
            self.content.as_ref(),
        )?;
        if expected != control {
            return Err(GameRuntimeError::ControlProjectionMismatch);
        }
        self.remember_control_plan(&control)?;
        self.control = control;
        self.authority_remote_paths.clear();
        self.schedule_no_legal_replacement_followup(&decision)?;
        Ok(())
    }

    fn advance_scripted_policy_for_material(
        &mut self,
        after: &GameState,
        decision: BattleNextDecision,
    ) -> Result<(), GameRuntimeError> {
        if decision != BattleNextDecision::CommandFrontier {
            let battle = after
                .battle
                .as_ref()
                .ok_or(GameRuntimeError::NoActiveBattle)?;
            if !battle.command_state.frontier.is_empty() {
                return Err(GameRuntimeError::TransitionIdentityMismatch);
            }
            return Ok(());
        }
        let battle = after
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?;
        let (expected_frontier, next_policy) =
            build_command_frontier(after, &self.scripted_enemy_policy, self.content.as_ref())?;
        if battle.command_state.frontier != expected_frontier {
            return Err(GameRuntimeError::MaterialOperationMismatch);
        }
        self.scripted_enemy_policy = next_policy;
        Ok(())
    }

    /// Begin a game-local clone-and-validate transaction.
    pub fn transaction(&self) -> crate::transaction::GameTransaction {
        crate::transaction::GameTransaction::begin(self)
    }

    /// Reduce a C01 UI payload while keeping its semantic fields inside
    /// `er-game`.  The kernel only dequeues the typed payload; it does not
    /// inspect private event fields or construct a campaign-facing action.
    #[doc(hidden)]
    pub fn reduce_ui(
        &mut self,
        payload: UiEventPayload,
    ) -> Result<BattleUiResult, GameRuntimeError> {
        let mut candidate = self.clone();
        let result = candidate.reduce_ui_in_kernel_transaction(payload)?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(result)
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    pub fn reduce_ui_in_kernel_transaction(
        &mut self,
        payload: UiEventPayload,
    ) -> Result<BattleUiResult, GameRuntimeError> {
        let (endpoint, menu_instance_id, action) = payload.into_parts();
        match action {
            crate::internal_event::BattleUiAction::Activate {
                control_id,
                option_id,
            } => self.handle_ui_action_inner(RuntimeUiAction::Activate {
                seat: endpoint,
                menu_instance_id,
                control_id,
                option_id,
            }),
            crate::internal_event::BattleUiAction::Cancel { control_id } => {
                let option_id = self
                    .control
                    .seat(endpoint)
                    .and_then(|entry| control_menu(&entry.control))
                    .map(|menu| menu.selected_option_id.clone())
                    .ok_or_else(|| ui_rejected("Cancel has no live actionable menu"))?;
                self.handle_ui_action_inner(RuntimeUiAction::Cancel {
                    seat: endpoint,
                    menu_instance_id,
                    control_id,
                    option_id,
                })
            }
        }
    }

    /// Reduce a C01 game payload at the game-owned semantic boundary.  The
    /// causal identity remains kernel bookkeeping; only the typed GameIntent
    /// crosses into this reducer.
    #[doc(hidden)]
    pub fn reduce_game(
        &mut self,
        payload: GameEventPayload,
    ) -> Result<GameReduction, GameRuntimeError> {
        let mut candidate = self.clone();
        let reduction = candidate.reduce_game_in_kernel_transaction(payload)?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(reduction)
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    pub fn reduce_game_in_kernel_transaction(
        &mut self,
        payload: GameEventPayload,
    ) -> Result<GameReduction, GameRuntimeError> {
        let (intent, _causal) = payload.into_parts();
        self.reduce_inner(intent)
    }

    fn handle_ui_action_inner(
        &mut self,
        action: RuntimeUiAction,
    ) -> Result<BattleUiResult, GameRuntimeError> {
        let (seat, menu_instance_id, control_id, option_id, is_cancel) = match action {
            RuntimeUiAction::Activate {
                seat,
                menu_instance_id,
                control_id,
                option_id,
            } => (seat, menu_instance_id, control_id, option_id, false),
            RuntimeUiAction::Cancel {
                seat,
                menu_instance_id,
                control_id,
                option_id,
            } => (seat, menu_instance_id, control_id, option_id, true),
        };
        let current = self.live_ui_control(seat, menu_instance_id, &control_id, &option_id)?;
        if is_cancel {
            self.cancel_ui_control(seat, current)
        } else {
            self.activate_ui_control(seat, current)
        }
    }

    /// Synchronize the exact typed graph after the raw UI reducer moved only
    /// its selected option projection.  This method accepts no direction or
    /// index; it proves the requested identity is a legal edge/option in the
    /// current graph and atomically installs the rebuilt typed control.
    #[doc(hidden)]
    pub fn sync_battle_ui_selection(
        &mut self,
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: &str,
        option_id: MenuOptionId,
    ) -> Result<(), GameRuntimeError> {
        let mut candidate = self.clone();
        candidate.sync_battle_ui_selection_in_kernel_transaction(
            seat,
            menu_instance_id,
            control_id,
            option_id,
        )?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(())
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    pub fn sync_battle_ui_selection_in_kernel_transaction(
        &mut self,
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: &str,
        option_id: MenuOptionId,
    ) -> Result<(), GameRuntimeError> {
        self.sync_battle_ui_selection_inner(seat, menu_instance_id, control_id, option_id)
    }

    #[doc(hidden)]
    pub fn sync_ui_selection(
        &mut self,
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: &str,
        option_id: MenuOptionId,
    ) -> Result<(), GameRuntimeError> {
        self.sync_battle_ui_selection(seat, menu_instance_id, control_id, option_id)
    }

    fn sync_battle_ui_selection_inner(
        &mut self,
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: &str,
        option_id: MenuOptionId,
    ) -> Result<(), GameRuntimeError> {
        let current =
            self.live_ui_control_for_sync(seat, menu_instance_id, control_id, &option_id)?;
        let battle = self.active_battle()?.clone();
        let next = match current {
            BattleControl::CommandRoot(value) => {
                let (field_slot, offer) =
                    self.command_context(seat, value.actor, value.field_slot)?;
                let selected = command_root_selection(&option_id)?;
                BattleControl::CommandRoot(build_command_root_control(
                    value.menu.instance_id,
                    seat,
                    value.menu.control_id,
                    value.actor,
                    field_slot,
                    &offer,
                    selected,
                )?)
            }
            BattleControl::MoveSelect(value) => {
                let (_field_slot, offer) =
                    self.command_context(seat, value.actor, value.field_slot)?;
                let entries = self.move_entries(value.actor, &offer)?;
                let selected_slot = parse_move_option_id(value.actor, &option_id)?;
                BattleControl::MoveSelect(build_move_control(
                    value.menu.instance_id,
                    seat,
                    value.menu.control_id,
                    value.actor,
                    value.field_slot,
                    &entries,
                    Some(selected_slot),
                    false,
                    value.cancel_to.as_ref().clone(),
                )?)
            }
            BattleControl::TargetSelect(value) => {
                let selected_target = parse_target_option_id(&option_id)?;
                if !value.candidate_targets.contains(&selected_target) {
                    return Err(ui_rejected("target option is not a live candidate"));
                }
                BattleControl::TargetSelect(crate::target_menu::build_target_control(
                    value.menu.instance_id,
                    seat,
                    value.menu.control_id,
                    value.actor,
                    value.field_slot,
                    value.move_slot,
                    value.multiple,
                    &value.candidate_targets,
                    Some(selected_target),
                    None,
                    value.cancel_to.as_ref().clone(),
                )?)
            }
            BattleControl::PartySelect(value) => {
                let next = self.sync_party_selection(&battle, &value, option_id)?;
                BattleControl::PartySelect(next)
            }
            BattleControl::PartyOptionSelect(value) => {
                if option_id
                    != MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID).map_err(|error| {
                        GameRuntimeError::PartyOptionMenu(PartyOptionMenuError::OptionId(error))
                    })?
                    && option_id
                        != MenuOptionId::new(PARTY_OPTION_CANCEL_ID).map_err(|error| {
                            GameRuntimeError::PartyOptionMenu(PartyOptionMenuError::OptionId(error))
                        })?
                {
                    return Err(ui_rejected(
                        "party-option identity is not in the frozen graph",
                    ));
                }
                let menu = BattleMenu::new(
                    value.menu.instance_id,
                    value.menu.owner_seat,
                    value.menu.control_id.clone(),
                    option_id,
                    value.menu.options.clone(),
                    value.menu.navigation.clone(),
                )
                .map_err(|error| GameRuntimeError::ControlNode(BattleControlError::from(error)))?;
                BattleControl::PartyOptionSelect(
                    er_types::battle_control::PartyOptionSelectControl::new(
                        value.actor,
                        value.field_slot,
                        value.selected_party_slot,
                        menu,
                        value.cancel_to.clone(),
                    )?,
                )
            }
            BattleControl::ReplacementSelect(value) => {
                let next = self.sync_replacement_selection(&battle, &value, option_id)?;
                BattleControl::ReplacementSelect(next)
            }
            BattleControl::Waiting(_) | BattleControl::Complete(_) => {
                return Err(ui_rejected(
                    "non-actionable control cannot synchronize selection",
                ));
            }
        };
        self.install_seat_control(seat, next)
    }

    fn activate_ui_control(
        &mut self,
        seat: SeatId,
        current: BattleControl,
    ) -> Result<BattleUiResult, GameRuntimeError> {
        let battle = self.active_battle()?.clone();
        match current {
            BattleControl::CommandRoot(value) => match select_command(&value.menu)? {
                CommandChoice::Fight => {
                    let (_field_slot, offer) =
                        self.command_context(seat, value.actor, value.field_slot)?;
                    let entries = self.move_entries(value.actor, &offer)?;
                    let menu_id = self.allocate_menu_instance(seat)?;
                    let control_id =
                        replace_control_leaf(&value.menu.control_id, "command", "move")?;
                    let next = BattleControl::MoveSelect(build_move_control(
                        menu_id,
                        seat,
                        control_id,
                        value.actor,
                        value.field_slot,
                        &entries,
                        None,
                        true,
                        BattleControl::CommandRoot(value),
                    )?);
                    self.install_seat_control(seat, next)?;
                    Ok(BattleUiResult::ControlChanged)
                }
                CommandChoice::Switch => {
                    let menu_id = self.allocate_menu_instance(seat)?;
                    let next = BattleControl::PartySelect(build_party_select(
                        &battle,
                        value.actor,
                        value.field_slot,
                        seat,
                        menu_id,
                        BattleControl::CommandRoot(value),
                    )?);
                    self.install_seat_control(seat, next)?;
                    Ok(BattleUiResult::ControlChanged)
                }
            },
            BattleControl::MoveSelect(value) => {
                let (_field_slot, offer) =
                    self.command_context(seat, value.actor, value.field_slot)?;
                let entries = self.move_entries(value.actor, &offer)?;
                match select_move(&value.menu, value.actor, &entries)? {
                    MoveActivation::Immediate { move_slot, targets } => {
                        let command = BattleCommand::fight(value.actor, move_slot, targets)?;
                        Ok(BattleUiResult::CommandProposal(self.command_proposal(
                            seat,
                            &value.menu,
                            value.actor,
                            value.field_slot,
                            command,
                        )?))
                    }
                    MoveActivation::TargetSelect {
                        move_slot,
                        multiple,
                        candidate_targets,
                    } => {
                        let menu_id = self.allocate_menu_instance(seat)?;
                        let control_id =
                            replace_control_leaf(&value.menu.control_id, "move", "target")?;
                        let next =
                            BattleControl::TargetSelect(crate::target_menu::build_target_control(
                                menu_id,
                                seat,
                                control_id,
                                value.actor,
                                value.field_slot,
                                move_slot,
                                multiple,
                                &candidate_targets,
                                None,
                                None,
                                BattleControl::MoveSelect(value),
                            )?);
                        self.install_seat_control(seat, next)?;
                        Ok(BattleUiResult::ControlChanged)
                    }
                }
            }
            BattleControl::TargetSelect(value) => {
                let targets = crate::target_menu::select_target_control(&value)?;
                let command = BattleCommand::fight(value.actor, value.move_slot, targets)?;
                Ok(BattleUiResult::CommandProposal(self.command_proposal(
                    seat,
                    &value.menu,
                    value.actor,
                    value.field_slot,
                    command,
                )?))
            }
            BattleControl::PartySelect(value) => {
                if value.menu.selected_option_id.as_str()
                    == crate::party_menu::PARTY_CANCEL_OPTION_ID
                {
                    let menu_id = self.allocate_menu_instance(seat)?;
                    let next = rebind_command_root(value.cancel_to.as_ref(), menu_id)?;
                    self.install_seat_control(seat, next)?;
                    return Ok(BattleUiResult::ControlChanged);
                }
                let menu_id = self.allocate_menu_instance(seat)?;
                let parent_instance_id = value.menu.instance_id;
                let parent = BattleControl::PartySelect(value);
                let option = open_party_option_menu_from_control(
                    &battle,
                    &parent,
                    parent_instance_id,
                    menu_id,
                )?;
                self.install_seat_control(seat, BattleControl::PartyOptionSelect(option))?;
                Ok(BattleUiResult::ControlChanged)
            }
            BattleControl::PartyOptionSelect(value) => {
                let send_out = MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID).map_err(|error| {
                    GameRuntimeError::PartyOptionMenu(PartyOptionMenuError::OptionId(error))
                })?;
                let cancel = MenuOptionId::new(PARTY_OPTION_CANCEL_ID).map_err(|error| {
                    GameRuntimeError::PartyOptionMenu(PartyOptionMenuError::OptionId(error))
                })?;
                if value.menu.selected_option_id == cancel {
                    let menu_id = self.allocate_menu_instance(seat)?;
                    let restored =
                        restore_parent_menu(&battle, &value, value.menu.instance_id, menu_id)?;
                    self.install_seat_control(seat, restored)?;
                    return Ok(BattleUiResult::ControlChanged);
                }
                if value.menu.selected_option_id != send_out {
                    return Err(ui_rejected("party-option selection is not final Send Out"));
                }
                match value.cancel_to.as_ref() {
                    BattleControl::PartySelect(_) => {
                        let command = BattleCommand::switch(value.actor, value.selected_party_slot);
                        Ok(BattleUiResult::CommandProposal(self.command_proposal(
                            seat,
                            &value.menu,
                            value.actor,
                            value.field_slot,
                            command,
                        )?))
                    }
                    BattleControl::ReplacementSelect(parent) => Ok(
                        BattleUiResult::ReplacementProposal(self.replacement_proposal(
                            seat,
                            &value.menu,
                            parent,
                            value.selected_party_slot,
                        )?),
                    ),
                    _ => Err(ui_rejected("party-option parent is not a valid final path")),
                }
            }
            BattleControl::ReplacementSelect(value) => {
                let menu_id = self.allocate_menu_instance(seat)?;
                let option = open_party_option_menu_from_control(
                    &battle,
                    &BattleControl::ReplacementSelect(value.clone()),
                    value.menu.instance_id,
                    menu_id,
                )?;
                self.install_seat_control(seat, BattleControl::PartyOptionSelect(option))?;
                Ok(BattleUiResult::ControlChanged)
            }
            BattleControl::Waiting(_) | BattleControl::Complete(_) => {
                Err(ui_rejected("non-actionable control cannot activate"))
            }
        }
    }

    fn cancel_ui_control(
        &mut self,
        seat: SeatId,
        current: BattleControl,
    ) -> Result<BattleUiResult, GameRuntimeError> {
        let battle = self.active_battle()?.clone();
        let new_id = match &current {
            BattleControl::MoveSelect(_)
            | BattleControl::TargetSelect(_)
            | BattleControl::PartySelect(_)
            | BattleControl::PartyOptionSelect(_) => self.allocate_menu_instance(seat),
            BattleControl::CommandRoot(_)
            | BattleControl::ReplacementSelect(_)
            | BattleControl::Waiting(_)
            | BattleControl::Complete(_) => Err(ui_rejected("Cancel is disabled for this control")),
        }?;
        let next = match current {
            BattleControl::MoveSelect(value) => {
                rebind_command_root(value.cancel_to.as_ref(), new_id)?
            }
            BattleControl::TargetSelect(value) => {
                rebind_control_menu(value.cancel_to.as_ref(), new_id)?
            }
            BattleControl::PartySelect(value) => {
                rebind_command_root(value.cancel_to.as_ref(), new_id)?
            }
            BattleControl::PartyOptionSelect(value) => {
                restore_parent_menu(&battle, &value, value.menu.instance_id, new_id)?
            }
            _ => return Err(ui_rejected("Cancel is disabled for this control")),
        };
        self.install_seat_control(seat, next)?;
        Ok(BattleUiResult::ControlChanged)
    }

    fn live_ui_control(
        &self,
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: &str,
        option_id: &MenuOptionId,
    ) -> Result<BattleControl, GameRuntimeError> {
        let entry = self
            .control
            .seat(seat)
            .ok_or_else(|| ui_rejected("UI action seat is not in the live plan"))?;
        let menu = control_menu(&entry.control)
            .ok_or_else(|| ui_rejected("UI action targets a non-actionable control"))?;
        if menu.instance_id != menu_instance_id
            || menu.control_id != control_id
            || menu.selected_option_id != *option_id
        {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let option = menu
            .option(option_id.clone())
            .ok_or_else(|| ui_rejected("UI action option is absent from the live graph"))?;
        if !option.visibility.is_visible() {
            return Err(ui_rejected("UI action option is hidden"));
        }
        Ok(entry.control.clone())
    }

    fn live_ui_control_for_sync(
        &self,
        seat: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: &str,
        option_id: &MenuOptionId,
    ) -> Result<BattleControl, GameRuntimeError> {
        let entry = self
            .control
            .seat(seat)
            .ok_or_else(|| ui_rejected("UI selection seat is not in the live plan"))?;
        let menu = control_menu(&entry.control)
            .ok_or_else(|| ui_rejected("UI selection targets a non-actionable control"))?;
        if menu.instance_id != menu_instance_id || menu.control_id != control_id {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let option = menu
            .option(option_id.clone())
            .ok_or_else(|| ui_rejected("UI selection option is absent from the live graph"))?;
        if !option.visibility.is_visible() {
            return Err(ui_rejected("UI selection option is hidden"));
        }
        Ok(entry.control.clone())
    }

    fn install_seat_control(
        &mut self,
        seat: SeatId,
        next_control: BattleControl,
    ) -> Result<(), GameRuntimeError> {
        let mut entries = self.control.seats.clone();
        let entry = entries
            .iter_mut()
            .find(|entry| entry.seat == seat)
            .ok_or_else(|| ui_rejected("UI control seat is absent from the live plan"))?;
        entry.control = next_control;
        let next = BattleControlPlan::new(
            self.control.schema_version,
            self.control.battle_id,
            self.control.wave,
            self.control.turn,
            entries,
            self.control.menu_allocators.clone(),
        )?;
        self.remember_control_plan(&next)?;
        self.control = next;
        Ok(())
    }

    fn allocate_menu_instance(&mut self, seat: SeatId) -> Result<MenuInstanceId, GameRuntimeError> {
        let allocator = self
            .control
            .menu_allocators
            .iter_mut()
            .find(|allocator| allocator.seat == seat)
            .ok_or_else(|| invalid_config("missing UI menu allocator"))?;
        let current = allocator.next_menu_instance_id;
        allocator.next_menu_instance_id =
            menu_id(increment_safe(current.get(), "menu allocator exhausted")?);
        Ok(current)
    }

    fn advance_allocator_through_menu_instance(
        &mut self,
        seat: SeatId,
        consumed: MenuInstanceId,
    ) -> Result<(), GameRuntimeError> {
        let allocator = self
            .control
            .menu_allocators
            .iter_mut()
            .find(|allocator| allocator.seat == seat)
            .ok_or_else(|| invalid_config("missing UI menu allocator"))?;
        let required = menu_id(increment_safe(consumed.get(), "menu allocator exhausted")?);
        if required > allocator.next_menu_instance_id {
            allocator.next_menu_instance_id = required;
        }
        Ok(())
    }

    fn remote_menu_sequence(
        &self,
        seat: SeatId,
        final_menu_instance_id: MenuInstanceId,
        count: usize,
    ) -> Result<Vec<MenuInstanceId>, GameRuntimeError> {
        if count == 0 {
            return Err(GameRuntimeError::AllocatorMismatch);
        }
        let allocator = self
            .control
            .allocator(seat)
            .ok_or_else(|| invalid_config("missing UI menu allocator"))?;
        let mut next = allocator.next_menu_instance_id;
        let mut sequence = Vec::with_capacity(count);
        for index in 0..count {
            if index + 1 == count && next != final_menu_instance_id {
                return Err(GameRuntimeError::AllocatorMismatch);
            }
            sequence.push(next);
            next = menu_id(increment_safe(next.get(), "menu allocator exhausted")?);
        }
        Ok(sequence)
    }

    fn active_battle(&self) -> Result<&er_state::battle::BattleState, GameRuntimeError> {
        self.state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)
    }

    fn command_context(
        &self,
        seat: SeatId,
        actor: PokemonId,
        field_slot: FieldSlot,
    ) -> Result<(FieldSlot, BattleCommandOffer), GameRuntimeError> {
        let battle = self.active_battle()?;
        let entry = battle
            .command_state
            .frontier
            .iter()
            .find(|entry| entry.owner_seat == Some(seat))
            .ok_or_else(|| ui_rejected("human command entry is absent from the exact frontier"))?;
        if entry.actor != actor || entry.field_slot != field_slot {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        Ok((entry.field_slot, entry.offer.clone()))
    }

    fn move_entries(
        &self,
        actor: PokemonId,
        offer: &BattleCommandOffer,
    ) -> Result<[MoveMenuEntry; crate::move_menu::MOVE_SLOT_COUNT], GameRuntimeError> {
        let battle = self.active_battle()?;
        let pokemon = battle
            .player_party
            .iter()
            .find(|pokemon| pokemon.id == actor)
            .ok_or_else(|| ui_rejected("move actor is absent from the player party"))?;
        let mut entries = Vec::with_capacity(crate::move_menu::MOVE_SLOT_COUNT);
        for raw in 0_u8..4 {
            let slot = MoveSlotIndex::new(raw).map_err(|_| ui_rejected("move slot is invalid"))?;
            let entry = if let Some(move_offer) = offer
                .fight
                .iter()
                .find(|move_offer| move_offer.move_slot == slot)
            {
                let move_state = pokemon.moves[usize::from(raw)]
                    .ok_or_else(|| ui_rejected("offered move is absent from the actor state"))?;
                MoveMenuEntry::from_offer(move_state.move_id, move_offer)
                    .map_err(|error| GameRuntimeError::MoveMenu(MoveMenuError::Entry(error)))?
            } else if let Some(move_state) = pokemon.moves[usize::from(raw)] {
                MoveMenuEntry::disabled(move_state.move_id)
            } else {
                MoveMenuEntry::empty()
            };
            entries.push(entry);
        }
        entries
            .try_into()
            .map_err(|_| ui_rejected("move menu must contain exactly four cells"))
    }

    fn sync_party_selection(
        &self,
        battle: &er_state::battle::BattleState,
        control: &er_types::battle_control::PartySelectControl,
        option_id: MenuOptionId,
    ) -> Result<er_types::battle_control::PartySelectControl, GameRuntimeError> {
        crate::party_menu::validate_party_control(battle, control, Some(control.menu.instance_id))?;
        if option_id == control.menu.selected_option_id {
            return Ok(control.clone());
        }
        let direction = control
            .menu
            .navigation
            .iter()
            .find(|edge| edge.from == control.menu.selected_option_id && edge.to == option_id)
            .map(|edge| edge.direction)
            .ok_or_else(|| ui_rejected("party selection is not an explicit live edge"))?;
        Ok(navigate_party_menu(
            battle,
            control,
            control.menu.instance_id,
            direction,
        )?)
    }

    fn sync_replacement_selection(
        &self,
        battle: &er_state::battle::BattleState,
        control: &er_types::battle_control::ReplacementSelectControl,
        option_id: MenuOptionId,
    ) -> Result<er_types::battle_control::ReplacementSelectControl, GameRuntimeError> {
        crate::replacement_menu::validate_replacement_control(
            battle,
            control,
            Some(control.menu.instance_id),
        )?;
        if option_id == control.menu.selected_option_id {
            return Ok(control.clone());
        }
        let direction = control
            .menu
            .navigation
            .iter()
            .find(|edge| edge.from == control.menu.selected_option_id && edge.to == option_id)
            .map(|edge| edge.direction)
            .ok_or_else(|| ui_rejected("replacement selection is not an explicit live edge"))?;
        Ok(navigate_replacement_menu(
            battle,
            control,
            control.menu.instance_id,
            direction,
        )?)
    }

    fn command_proposal(
        &self,
        seat: SeatId,
        menu: &BattleMenu,
        actor: PokemonId,
        field_slot: FieldSlot,
        command: BattleCommand,
    ) -> Result<BattleCommandProposalV1, GameRuntimeError> {
        let battle = self.active_battle()?;
        let operation_id = self
            .control
            .seat(seat)
            .and_then(|entry| entry.decision_operation_id.clone())
            .ok_or_else(|| ui_rejected("final command control has no operation binding"))?;
        Ok(BattleCommandProposalV1::new(
            operation_id,
            battle.battle_id,
            battle.wave,
            battle.turn,
            seat,
            actor,
            field_slot,
            command,
            menu.instance_id,
            menu.control_id.clone(),
        )?)
    }

    fn replacement_proposal(
        &self,
        seat: SeatId,
        menu: &BattleMenu,
        parent: &er_types::battle_control::ReplacementSelectControl,
        party_slot: PartyIndex,
    ) -> Result<BattleReplacementProposalV1, GameRuntimeError> {
        let battle = self.active_battle()?;
        let pokemon = battle
            .player_party
            .get(usize::from(party_slot.get()))
            .ok_or_else(|| ui_rejected("replacement party slot is absent"))?;
        let operation_id = self
            .control
            .seat(seat)
            .and_then(|entry| entry.decision_operation_id.clone())
            .ok_or_else(|| ui_rejected("replacement control has no operation binding"))?;
        Ok(BattleReplacementProposalV1::new(
            operation_id,
            battle.battle_id,
            battle.wave,
            parent.source.resolved_turn,
            seat,
            parent.occurrence,
            parent.source.turn_occurrence,
            parent.field_slot,
            ReplacementSelection::selected(party_slot, pokemon.id),
            menu.instance_id,
            menu.control_id.clone(),
        )?)
    }

    /// Rebuild a remote proposal's final leaf from the authority-installed
    /// root.  The guest's menu instance is evidence for this immutable replay,
    /// not an authority control lookup: the authority root remains the only
    /// installed control and every parent is rebuilt through the canonical
    /// game-owned menu builders.
    fn prepare_remote_command_path(
        &self,
        proposal: &BattleCommandProposalV1,
    ) -> Result<RuntimeAuthorityMenuPath, GameRuntimeError> {
        let battle = self.active_battle()?;
        let seat = self
            .control
            .seat(proposal.owner_seat)
            .ok_or_else(|| ui_rejected("remote command seat is absent from the live plan"))?;
        let BattleControl::CommandRoot(root) = &seat.control else {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        };
        if root.actor != proposal.actor || root.field_slot != proposal.field_slot {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let (_, offer) =
            self.command_context(proposal.owner_seat, proposal.actor, proposal.field_slot)?;
        let root_selection = match &proposal.command {
            BattleCommand::Fight { .. } => CommandRootSelection::Fight,
            BattleCommand::Switch { .. } => CommandRootSelection::Switch,
        };
        let authority_root = BattleControl::CommandRoot(build_command_root_control(
            root.menu.instance_id,
            proposal.owner_seat,
            root.menu.control_id.clone(),
            root.actor,
            root.field_slot,
            &offer,
            root_selection,
        )?);

        let leaf = match &proposal.command {
            BattleCommand::Fight {
                move_slot, targets, ..
            } => {
                let entries = self.move_entries(proposal.actor, &offer)?;
                // The command's serialized target selection is not the menu
                // path.  In particular, a spread-target move may carry a
                // concrete Selected target set while the canonical move
                // activation is still immediate.  Build the move control at
                // the allocator cursor first, classify that exact control,
                // then validate the guest's final menu against the resulting
                // path length.
                let move_menu_id = self
                    .control
                    .allocator(proposal.owner_seat)
                    .ok_or_else(|| invalid_config("remote command seat allocator is absent"))?
                    .next_menu_instance_id;
                let move_control_id =
                    replace_control_leaf(&root.menu.control_id, "command", "move")?;
                let move_control = build_move_control(
                    move_menu_id,
                    proposal.owner_seat,
                    move_control_id.clone(),
                    proposal.actor,
                    proposal.field_slot,
                    &entries,
                    Some(*move_slot),
                    false,
                    authority_root.clone(),
                )?;
                match select_move(&move_control.menu, proposal.actor, &entries)? {
                    MoveActivation::Immediate {
                        move_slot: selected_slot,
                        targets: selected_targets,
                    } if selected_slot == *move_slot && selected_targets == targets.clone() => {
                        let menu_ids = self.remote_menu_sequence(
                            proposal.owner_seat,
                            proposal.menu_instance_id,
                            1,
                        )?;
                        if menu_ids[0] != move_control.menu.instance_id
                            || proposal.control_id != move_control.menu.control_id
                        {
                            return Err(GameRuntimeError::ControlIdentityMismatch);
                        }
                        BattleControl::MoveSelect(move_control)
                    }
                    MoveActivation::TargetSelect {
                        move_slot: selected_slot,
                        multiple,
                        candidate_targets,
                    } => {
                        let menu_ids = self.remote_menu_sequence(
                            proposal.owner_seat,
                            proposal.menu_instance_id,
                            2,
                        )?;
                        if menu_ids[0] != move_control.menu.instance_id {
                            return Err(GameRuntimeError::ControlIdentityMismatch);
                        }
                        let BattleTargetSelection::Selected(selected_targets) = targets else {
                            return Err(GameRuntimeError::ControlIdentityMismatch);
                        };
                        if selected_slot != *move_slot
                            || (multiple && selected_targets != &candidate_targets)
                            || (!multiple
                                && (selected_targets.len() != 1
                                    || !candidate_targets.contains(&selected_targets[0])))
                        {
                            return Err(GameRuntimeError::ControlIdentityMismatch);
                        }
                        let target_control_id =
                            replace_control_leaf(&root.menu.control_id, "command", "target")?;
                        let default_target = selected_targets.first().copied();
                        let target_control = crate::target_menu::build_target_control(
                            menu_ids[1],
                            proposal.owner_seat,
                            target_control_id,
                            proposal.actor,
                            proposal.field_slot,
                            *move_slot,
                            multiple,
                            &candidate_targets,
                            default_target,
                            None,
                            BattleControl::MoveSelect(move_control),
                        )?;
                        if crate::target_menu::select_target_control(&target_control)?
                            != targets.clone()
                            || target_control.menu.control_id != proposal.control_id
                        {
                            return Err(GameRuntimeError::ControlIdentityMismatch);
                        }
                        BattleControl::TargetSelect(target_control)
                    }
                    _ => return Err(GameRuntimeError::ControlIdentityMismatch),
                }
            }
            BattleCommand::Switch { party_slot, .. } => {
                let Some(switch) = offer
                    .switches
                    .iter()
                    .find(|switch| switch.party_slot == *party_slot)
                else {
                    return Err(GameRuntimeError::ControlIdentityMismatch);
                };
                let menu_ids =
                    self.remote_menu_sequence(proposal.owner_seat, proposal.menu_instance_id, 2)?;
                let party_control = build_party_select(
                    battle,
                    proposal.actor,
                    proposal.field_slot,
                    proposal.owner_seat,
                    menu_ids[0],
                    authority_root.clone(),
                )?;
                let selected_option = party_option_id(switch.pokemon, *party_slot)
                    .map_err(|_| ui_rejected("remote switch party option is malformed"))?;
                let party_control =
                    replay_party_selection(battle, party_control, &selected_option)?;
                let option_control = open_party_option_menu_from_control(
                    battle,
                    &BattleControl::PartySelect(party_control),
                    menu_ids[0],
                    menu_ids[1],
                )?;
                if option_control.menu.selected_option_id
                    != MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID).map_err(|error| {
                        GameRuntimeError::PartyOptionMenu(PartyOptionMenuError::OptionId(error))
                    })?
                    || option_control.menu.control_id != proposal.control_id
                {
                    return Err(GameRuntimeError::ControlIdentityMismatch);
                }
                BattleControl::PartyOptionSelect(option_control)
            }
        };
        leaf.validate()?;
        Ok(RuntimeAuthorityMenuPath {
            operation_id: proposal.operation_id.clone(),
            control: leaf,
        })
    }

    fn prepare_remote_replacement_path(
        &self,
        proposal: &BattleReplacementProposalV1,
    ) -> Result<RuntimeAuthorityMenuPath, GameRuntimeError> {
        let battle = self.active_battle()?;
        let seat = self
            .control
            .seat(proposal.owner_seat)
            .ok_or_else(|| ui_rejected("remote replacement seat is absent from the live plan"))?;
        let BattleControl::ReplacementSelect(current) = &seat.control else {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        };
        if current.occurrence != proposal.occurrence
            || current.field_slot != proposal.field_slot
            || current.owner_seat != proposal.owner_seat
        {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let menu_id =
            self.remote_menu_sequence(proposal.owner_seat, proposal.menu_instance_id, 1)?[0];
        crate::replacement_menu::validate_replacement_control(
            battle,
            current,
            Some(current.menu.instance_id),
        )?;
        let ReplacementSelection::Selected {
            party_slot,
            pokemon,
        } = proposal.selection
        else {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        };
        let selected_option = party_option_id(pokemon, party_slot)
            .map_err(|_| ui_rejected("remote replacement party option is malformed"))?;
        if !current
            .menu
            .option(selected_option.clone())
            .is_some_and(|option| option.enabled)
        {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let selected = replay_replacement_selection(battle, current.clone(), &selected_option)?;
        let option_control = open_party_option_menu_from_control(
            battle,
            &BattleControl::ReplacementSelect(selected),
            current.menu.instance_id,
            menu_id,
        )?;
        if option_control.menu.selected_option_id
            != MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID).map_err(|error| {
                GameRuntimeError::PartyOptionMenu(PartyOptionMenuError::OptionId(error))
            })?
            || option_control.menu.control_id != proposal.control_id
        {
            return Err(GameRuntimeError::ControlIdentityMismatch);
        }
        let leaf = BattleControl::PartyOptionSelect(option_control);
        leaf.validate()?;
        Ok(RuntimeAuthorityMenuPath {
            operation_id: proposal.operation_id.clone(),
            control: leaf,
        })
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
        validate_command_proposal_trusted(&self.state, &proposal, self.content.as_ref())
            .map_err(map_legality_error)?;
        let authority_seat = self
            .state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?
            .authority_seat;
        if proposal.owner_seat == authority_seat {
            if !control_accepts_command(&self.state, &self.control, &proposal) {
                return Err(GameRuntimeError::ControlIdentityMismatch);
            }
        } else {
            let replay = self.prepare_remote_command_path(&proposal)?;
            self.authority_remote_paths
                .insert(proposal.operation_id.clone(), replay);
        }
        let accepted = AcceptedBattleCommand::human(proposal.clone());
        let source = if proposal.owner_seat == authority_seat {
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
                .ok_or_else(|| {
                    GameRuntimeError::StateContent(
                        er_battle::legality::CommandLegalityError::MissingCommandFrontier {
                            operation_id: proposal.operation_id.clone(),
                        },
                    )
                })?;
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
            let complete = battle.command_state.frontier.iter().all(|entry| {
                matches!(
                    &entry.status,
                    CommandFrontierStatus::Retained { .. } | CommandFrontierStatus::Admitted { .. }
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
        self.advance_allocator_through_menu_instance(
            proposal.owner_seat,
            proposal.menu_instance_id,
        )?;
        let fingerprint =
            CommandFingerprintEntry::new(proposal.operation_id.clone(), proposal.fingerprint())?;
        self.command_fingerprints.push(fingerprint);
        self.command_fingerprints
            .sort_unstable_by(|left, right| left.operation_id.cmp(&right.operation_id));
        let operation_id = proposal.operation_id.clone();
        if !complete {
            let waiting =
                project_waiting_after_command(&self.control, proposal.owner_seat, &command_state)?;
            self.remember_control(proposal.owner_seat, waiting.clone())?;
            self.control = waiting;
            self.validate_transactional()?
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

        let commands = commands
            .ok_or_else(|| invalid_config("complete frontier did not produce a command set"))?;
        let material_operation_id = turn_result_operation_id(battle_id, wave, turn)?;
        let transition = resolve_turn_trusted_with_finalizer(
            &self.state,
            &commands,
            authority_epoch,
            &material_operation_id,
            self.content.as_ref(),
            |_, after_state, mutations, next_decision| {
                self.finalize_command_frontier(after_state, mutations, next_decision)
            },
        )?;
        let (next_control, followup_events) = self
            .project_next_control_and_events(&transition.after_state, &transition.next_decision)?;
        let digest_evidence = TurnDigestEvidence::from_finalized_transition(transition);
        let mut events = vec![InternalEvent::BattleResolved(BattleResolvedPayload {
            resolution: PreparedBattleResolution::Turn {
                digest_evidence,
                material_operation_id,
                next_control,
            },
        })];
        events.extend(followup_events);
        Ok(GameReduction {
            admission: Some(CommandAdmission::Accepted {
                operation_id,
                frontier_complete: true,
            }),
            events,
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
        validate_replacement_proposal_trusted(&self.state, &proposal, self.content.as_ref())
            .map_err(map_legality_error)?;
        let authority_seat = self
            .state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?
            .authority_seat;
        if proposal.owner_seat == authority_seat {
            if !control_accepts_replacement(&self.state, &self.control, &proposal) {
                return Err(GameRuntimeError::ControlIdentityMismatch);
            }
        } else {
            let replay = self.prepare_remote_replacement_path(&proposal)?;
            self.authority_remote_paths
                .insert(proposal.operation_id.clone(), replay);
        }
        let source_epoch = stored_replacement_epoch(&self.state, proposal.occurrence)?;
        if source_epoch != authority_epoch {
            return Err(GameRuntimeError::ReplacementEpochMismatch);
        }
        self.advance_allocator_through_menu_instance(
            proposal.owner_seat,
            proposal.menu_instance_id,
        )?;
        self.replacement_fingerprints
            .push(ReplacementProposalFingerprintEntry::new(
                proposal.operation_id.clone(),
                proposal.fingerprint(),
            )?);
        self.replacement_fingerprints
            .sort_unstable_by(|left, right| left.operation_id.cmp(&right.operation_id));
        let mut transition = resolve_replacement_trusted(
            &self.state,
            proposal.occurrence,
            &proposal.selection,
            &proposal.operation_id,
            self.content.as_ref(),
        )?;
        self.finalize_replacement_frontier(&mut transition)?;
        let (next_control, followup_events) = self
            .project_next_control_and_events(&transition.after_state, &transition.next_decision)?;
        let mut events = vec![InternalEvent::BattleResolved(BattleResolvedPayload {
            resolution: PreparedBattleResolution::Replacement {
                transition,
                material_operation_id: proposal.operation_id.clone(),
                next_control,
            },
        })];
        events.extend(followup_events);
        Ok(GameReduction {
            admission: Some(CommandAdmission::Accepted {
                operation_id: proposal.operation_id.clone(),
                frontier_complete: true,
            }),
            events,
        })
    }

    fn resolve_no_legal_replacement(
        &mut self,
        occurrence: FaintOccurrenceId,
        authority_epoch: AuthorityEpoch,
    ) -> Result<GameReduction, GameRuntimeError> {
        let Some(pending) = self.pending_no_legal_replacement.as_ref() else {
            return Err(GameRuntimeError::UnscheduledNoLegalReplacement);
        };
        if pending.occurrence != occurrence || pending.authority_epoch != authority_epoch {
            return Err(GameRuntimeError::UnscheduledNoLegalReplacement);
        }
        self.pending_no_legal_replacement = None;
        validate_replacement_selection_trusted(
            &self.state,
            occurrence,
            &ReplacementSelection::NoLegalReplacement,
            self.content.as_ref(),
        )
        .map_err(map_legality_error)?;
        let Some(battle) = self.state.battle.as_ref() else {
            return Err(GameRuntimeError::NoActiveBattle);
        };
        let Some(faint) = battle
            .faint_queue
            .iter()
            .find(|faint| faint.id == occurrence)
        else {
            return Err(invalid_config(
                "no-legal replacement occurrence is not stored",
            ));
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
            faint
                .owner_seat
                .ok_or_else(|| invalid_config("enemy faint has no human replacement owner"))?,
        )?;
        let mut transition = resolve_replacement_trusted(
            &self.state,
            occurrence,
            &ReplacementSelection::NoLegalReplacement,
            &material_operation_id,
            self.content.as_ref(),
        )?;
        self.finalize_replacement_frontier(&mut transition)?;
        let (next_control, followup_events) = self
            .project_next_control_and_events(&transition.after_state, &transition.next_decision)?;
        let mut events = vec![InternalEvent::BattleResolved(BattleResolvedPayload {
            resolution: PreparedBattleResolution::Replacement {
                transition,
                material_operation_id,
                next_control,
            },
        })];
        events.extend(followup_events);
        Ok(GameReduction {
            admission: None,
            events,
        })
    }

    fn finalize_replacement_frontier(
        &mut self,
        transition: &mut er_battle::BattleReplacementTransition,
    ) -> Result<(), GameRuntimeError> {
        if !matches!(
            transition.next_decision,
            BattleNextDecision::CommandFrontier
        ) {
            return Ok(());
        }
        self.finalize_command_frontier(
            &mut transition.after_state,
            &mut transition.mutations,
            transition.next_decision,
        )?;
        validate_state_content_trusted(&transition.after_state, self.content.as_ref())
            .map_err(map_legality_error)?;
        transition.after_digest = MechanicalStateDigest::compute(&transition.after_state)
            .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?;
        validate_battle_mutation_evidence(
            &transition.before_state,
            &transition.after_state,
            &transition.mutations,
        )
        .map_err(|error| GameRuntimeError::Resolve(BattleResolveError::Invariant(error)))?;
        Ok(())
    }

    /// The resolver intentionally clears the completed command collection
    /// before it selects the next logical decision.  A command frontier is
    /// therefore finalized here, still inside the typed resolver candidate,
    /// so the serialized material sees the same state the control projector
    /// sees.  Building from the cloned policy advances its cursor once per
    /// enemy actor.  The returned frontier is only a candidate here: the
    /// cursor is committed later by the role-neutral material installer after
    /// the serialized after-state has passed the common material boundary.
    fn finalize_command_frontier(
        &self,
        after_state: &mut GameState,
        mutations: &mut Vec<er_battle::BattleMutation>,
        next_decision: BattleNextDecision,
    ) -> Result<(), GameRuntimeError> {
        if !matches!(next_decision, BattleNextDecision::CommandFrontier) {
            return Ok(());
        }
        let (frontier, _next_policy) = build_command_frontier(
            after_state,
            &self.scripted_enemy_policy,
            self.content.as_ref(),
        )?;
        let battle = after_state
            .battle
            .as_mut()
            .ok_or(GameRuntimeError::NoActiveBattle)?;
        let before = battle.command_state.clone();
        let after = CommandCollectionState::new(frontier, before.tombstones.clone())?;
        if before != after {
            battle.command_state = after.clone();
            mutations.push(er_battle::BattleMutation::CommandCollectionChanged { before, after });
        }
        Ok(())
    }

    fn project_next_control(
        &self,
        state: &GameState,
        decision: &BattleNextDecision,
    ) -> Result<BattleControlPlan, GameRuntimeError> {
        project_battle_control_plan(
            state,
            *decision,
            &self.control.menu_allocators,
            self.content.as_ref(),
        )
    }

    fn project_next_control_and_events(
        &self,
        state: &GameState,
        decision: &BattleNextDecision,
    ) -> Result<(BattleControlPlan, Vec<InternalEvent>), GameRuntimeError> {
        let control = self.project_next_control(state, decision)?;
        // Keep the operation/occurrence derivation as a preflight check, but
        // defer the marker write until the transition's after-state and control
        // have been installed.  The reducer validates its pre-material clone;
        // recording the marker here would name an occurrence that is not yet in
        // that clone's state.
        let _ = self.no_legal_replacement_followup(state, decision)?;
        Ok((control, Vec::new()))
    }

    fn schedule_no_legal_replacement_followup(
        &mut self,
        decision: &BattleNextDecision,
    ) -> Result<(), GameRuntimeError> {
        let Some((occurrence, epoch, operation_id)) =
            self.no_legal_replacement_followup(&self.state, decision)?
        else {
            return Ok(());
        };
        // Do not return a Game event beside BattleResolved.  The kernel FIFO
        // appends reducer output behind AuthorityEntryReady/MaterialInstalled
        // work emitted by BattleResolved, so such an event would resolve the
        // faint against the pre-material state.  Store the typed marker only
        // after the matching state/control pair is live; it is consumed by
        // `take_pending_no_legal_replacement` after ControlInstalled.
        self.pending_no_legal_replacement = Some(PendingNoLegalReplacementFollowup {
            occurrence,
            authority_epoch: epoch,
            operation_id,
            prepared_control: self.control.clone(),
        });
        Ok(())
    }

    /// Enqueue the deterministic no-legal replacement work after the common
    /// material/control chain has committed.  Kernel code calls this only from
    /// its causal ControlInstalled reducer; calling earlier is rejected by the
    /// prepared-control/state checks below.  The event constructor is the
    /// crate-private C01 internal-event seam, not a public semantic surface.
    #[doc(hidden)]
    pub fn take_pending_no_legal_replacement(
        &mut self,
    ) -> Result<Option<InternalEvent>, GameRuntimeError> {
        let mut candidate = self.clone();
        let event = candidate.take_pending_no_legal_replacement_in_kernel_transaction()?;
        candidate.validate_transactional()?;
        *self = candidate;
        Ok(event)
    }

    /// Mutate the private candidate already owned by the enclosing battle
    /// transaction. The caller must discard the whole candidate on error and
    /// validate it once after the internal FIFO reaches quiescence.
    #[doc(hidden)]
    pub fn take_pending_no_legal_replacement_in_kernel_transaction(
        &mut self,
    ) -> Result<Option<InternalEvent>, GameRuntimeError> {
        self.take_pending_no_legal_replacement_inner()
    }

    fn take_pending_no_legal_replacement_inner(
        &mut self,
    ) -> Result<Option<InternalEvent>, GameRuntimeError> {
        let Some(pending) = self.pending_no_legal_replacement.clone() else {
            return Ok(None);
        };
        if self.control != pending.prepared_control {
            return Err(GameRuntimeError::ControlProjectionMismatch);
        }
        let battle = self
            .state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?;
        let faint = battle
            .faint_queue
            .iter()
            .find(|candidate| candidate.id == pending.occurrence)
            .ok_or_else(|| invalid_config("pending no-legal replacement occurrence is absent"))?;
        if faint.source.epoch != pending.authority_epoch
            || faint.replacement != ReplacementProgress::Pending
        {
            return Err(GameRuntimeError::ReplacementEpochMismatch);
        }
        let allocator = self
            .control
            .allocator(
                faint.owner_seat.ok_or_else(|| {
                    invalid_config("pending no-legal replacement has no human owner")
                })?,
            )
            .ok_or_else(|| invalid_config("pending no-legal replacement allocator is absent"))?;
        if !matches!(
            build_replacement_menu(battle, pending.occurrence, allocator.next_menu_instance_id)?,
            ReplacementMenuResult::NoLegalReplacement { .. }
        ) {
            return Err(GameRuntimeError::ControlProjectionMismatch);
        }
        // Keep the marker live until the returned typed event is reduced.  The
        // event is only a causal view of this pending identity; clearing it
        // here would make the immediately-following GameIntent appear
        // unscheduled to the reducer.
        Ok(Some(InternalEvent::no_legal_replacement(
            pending.occurrence,
            pending.authority_epoch,
            CausalIdentity::new(Some(pending.operation_id), None),
        )))
    }

    fn no_legal_replacement_followup(
        &self,
        state: &GameState,
        decision: &BattleNextDecision,
    ) -> Result<Option<(FaintOccurrenceId, AuthorityEpoch, er_types::OperationId)>, GameRuntimeError>
    {
        let BattleNextDecision::Replacement { occurrence } = decision else {
            return Ok(None);
        };
        let battle = state
            .battle
            .as_ref()
            .ok_or(GameRuntimeError::NoActiveBattle)?;
        let faint = battle
            .faint_queue
            .iter()
            .find(|candidate| candidate.id == *occurrence)
            .ok_or_else(|| invalid_config("replacement decision occurrence is not stored"))?;
        let owner = faint
            .owner_seat
            .ok_or_else(|| invalid_config("enemy faint cannot create a human replacement owner"))?;
        let allocator = self
            .control
            .allocator(owner)
            .ok_or_else(|| invalid_config("missing replacement owner allocator"))?;
        let projection =
            build_replacement_menu(battle, *occurrence, allocator.next_menu_instance_id)?;
        if !matches!(projection, ReplacementMenuResult::NoLegalReplacement { .. }) {
            return Ok(None);
        }
        let operation_id = replacement_operation_id(
            faint.source.epoch,
            battle.battle_id,
            faint.source.wave,
            faint.source.resolved_turn,
            faint.source.turn_occurrence,
            faint.slot,
            owner,
        )?;
        Ok(Some((*occurrence, faint.source.epoch, operation_id)))
    }

    fn remember_control(
        &mut self,
        seat: SeatId,
        next: BattleControlPlan,
    ) -> Result<(), GameRuntimeError> {
        if let Some(previous) = self.control.seat(seat).map(|entry| entry.control.clone())
            && let Some(next_entry) = next.seat(seat)
        {
            self.menu_history.push(MenuHistoryEntry {
                seat,
                from: previous,
                to: next_entry.control.clone(),
            });
        }
        self.compact_menu_history(&next)
    }

    fn remember_control_plan(&mut self, next: &BattleControlPlan) -> Result<(), GameRuntimeError> {
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
        self.compact_menu_history(next)
    }

    /// Retain only the control graph that the snapshot bridge can restore:
    /// the current Cancel ancestry plus live remote replay anchors.  The
    /// complete transition log is diagnostic history, not live game state;
    /// keeping it unbounded makes every outer and inner transactional clone
    /// copy an ever-growing vector.
    fn compact_menu_history(
        &mut self,
        current: &BattleControlPlan,
    ) -> Result<(), GameRuntimeError> {
        let mut historical = BTreeMap::<SeatId, Vec<BattleControl>>::new();
        for entry in &self.menu_history {
            let controls = historical.entry(entry.seat).or_default();
            if let Some(previous) = controls.last()
                && previous != &entry.from
            {
                return Err(invalid_config(
                    "live menu transition history is not contiguous",
                ));
            }
            if controls.is_empty() {
                controls.push(entry.from.clone());
            }
            controls.push(entry.to.clone());
        }

        let remote_anchors = self.restorable_remote_control_anchors();
        for seat in remote_anchors.keys() {
            historical.entry(*seat).or_default();
        }

        let mut compacted = Vec::new();
        for (seat, history) in historical {
            let current_control = current
                .seat(seat)
                .ok_or_else(|| invalid_config("live menu history seat is absent from control"))?;
            let anchors = remote_anchors.get(&seat).map(Vec::as_slice).unwrap_or(&[]);
            let controls =
                bounded_control_history(seat, history, &current_control.control, anchors).map_err(
                    |error| GameRuntimeError::InvalidConfig {
                        message: format!("live menu history is not snapshot-restorable: {error}"),
                    },
                )?;
            compacted.extend(controls.windows(2).map(|pair| MenuHistoryEntry {
                seat,
                from: pair[0].clone(),
                to: pair[1].clone(),
            }));
        }
        self.menu_history = compacted;
        Ok(())
    }
}

impl GameRuntimeSnapshotBridge for GameRuntime {
    fn snapshot_v2(&self) -> Result<GameRuntimeSnapshotV2, SnapshotError> {
        if self.pending_no_legal_replacement.is_some() {
            return Err(snapshot_invalid(
                "pending_no_legal_replacement",
                "an internal FIFO marker cannot cross the public snapshot boundary",
            ));
        }
        self.validate()
            .map_err(|error| snapshot_runtime_invalid("runtime", error))?;

        let snapshot = GameRuntimeSnapshotV2::from_runtime(self)?;
        validate_snapshot_control_consistency(&snapshot)?;
        let menu_history = menu_history_from_snapshot(&snapshot.control_history)?;
        let mut public_candidate = self.clone();
        public_candidate.menu_history = menu_history;
        ensure_public_quiescent_boundary(&public_candidate)?;

        let rebuilt_paths =
            rebuild_authority_remote_paths(&public_candidate, &snapshot.control_history)?;
        if rebuilt_paths != self.authority_remote_paths {
            return Err(snapshot_invalid(
                "authority_remote_paths",
                "live remote admission evidence is missing, ambiguous, or differs from the runtime proof",
            ));
        }
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: GameRuntimeSnapshotV2,
        local_seat: SeatId,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate()?;
        validate_snapshot_control_consistency(&snapshot)?;
        if snapshot.state.content_hash != content.hash {
            return Err(snapshot_invalid(
                "state.content_hash",
                "snapshot content identity differs from supplied ContentPack",
            ));
        }
        content
            .validate()
            .map_err(|error| snapshot_invalid("content", error.to_string()))?;
        if snapshot.current_control.seat(local_seat).is_none() {
            return Err(snapshot_invalid(
                "local_seat",
                "seat must have a current control entry",
            ));
        }

        let menu_history = menu_history_from_snapshot(&snapshot.control_history)?;
        let GameRuntimeSnapshotV2 {
            state,
            current_control,
            control_history,
            command_admission,
            scripted_enemy_policy,
            ..
        } = snapshot;
        let mut runtime = Self {
            state,
            control: current_control,
            local_seat,
            scripted_enemy_policy,
            menu_history,
            command_fingerprints: command_admission.command_tombstones,
            replacement_fingerprints: command_admission.replacement_tombstones,
            authority_remote_paths: BTreeMap::new(),
            pending_no_legal_replacement: None,
            content,
        };
        runtime
            .validate()
            .map_err(|error| snapshot_runtime_invalid("runtime", error))?;
        ensure_public_quiescent_boundary(&runtime)?;
        runtime.authority_remote_paths =
            rebuild_authority_remote_paths(&runtime, &control_history)?;
        runtime
            .validate()
            .map_err(|error| snapshot_runtime_invalid("runtime", error))?;
        Ok(runtime)
    }
}

fn snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn snapshot_runtime_invalid(path: &str, error: GameRuntimeError) -> SnapshotError {
    snapshot_invalid(path, error.to_string())
}

fn menu_history_from_snapshot(
    histories: &[SeatControlHistorySnapshotV1],
) -> Result<Vec<MenuHistoryEntry>, SnapshotError> {
    let mut menu_history = Vec::new();
    for (history_index, history) in histories.iter().enumerate() {
        if let [control] = history.controls.as_slice() {
            // A singleton is retained seat-local snapshot evidence rather
            // than a control transition. Preserve it as a private no-op
            // marker so an immediate capture after restore remains exact;
            // the next real control transition compacts the marker away.
            menu_history.push(MenuHistoryEntry {
                seat: history.seat,
                from: control.clone(),
                to: control.clone(),
            });
            continue;
        }
        for pair in history.controls.windows(2) {
            if pair[0] == pair[1] {
                return Err(snapshot_invalid(
                    format!("control_history[{history_index}].controls"),
                    "causal history cannot contain an unchanged control transition",
                ));
            }
            menu_history.push(MenuHistoryEntry {
                seat: history.seat,
                from: pair[0].clone(),
                to: pair[1].clone(),
            });
        }
    }
    Ok(menu_history)
}

fn validate_snapshot_control_consistency(
    snapshot: &GameRuntimeSnapshotV2,
) -> Result<(), SnapshotError> {
    let battle = snapshot.state.battle.as_ref().ok_or_else(|| {
        snapshot_invalid("state.battle", "M3 game snapshots require an active battle")
    })?;
    let completed_from_state = battle.outcome != BattleOutcome::Ongoing;
    if snapshot.completed != completed_from_state {
        return Err(snapshot_invalid(
            "completed",
            "completion flag must equal the canonical battle outcome",
        ));
    }
    for seat in &snapshot.current_control.seats {
        if completed_from_state {
            if seat.decision_operation_id.is_some()
                || !matches!(&seat.control, BattleControl::Complete(outcome) if *outcome == battle.outcome)
            {
                return Err(snapshot_invalid(
                    "current_control",
                    "a completed battle must expose the exact matching Complete control for every seat",
                ));
            }
        } else if matches!(&seat.control, BattleControl::Complete(_)) {
            return Err(snapshot_invalid(
                "current_control",
                "an ongoing battle cannot expose a Complete control",
            ));
        }
    }
    Ok(())
}

fn ensure_public_quiescent_boundary(runtime: &GameRuntime) -> Result<(), SnapshotError> {
    if runtime.pending_no_legal_replacement.is_some() {
        return Err(snapshot_invalid(
            "pending_no_legal_replacement",
            "an internal FIFO marker cannot be restored as public state",
        ));
    }
    let decision = decision_for_state(&runtime.state)
        .map_err(|error| snapshot_runtime_invalid("state", error))?;
    if runtime
        .no_legal_replacement_followup(&runtime.state, &decision)
        .map_err(|error| snapshot_runtime_invalid("current_control", error))?
        .is_some()
    {
        return Err(snapshot_invalid(
            "current_control",
            "the DTO is at the internal no-legal-replacement FIFO boundary rather than a public quiescent boundary",
        ));
    }
    Ok(())
}

fn rebuild_authority_remote_paths(
    runtime: &GameRuntime,
    histories: &[SeatControlHistorySnapshotV1],
) -> Result<BTreeMap<er_types::OperationId, RuntimeAuthorityMenuPath>, SnapshotError> {
    let battle = runtime.state.battle.as_ref().ok_or_else(|| {
        snapshot_invalid("state.battle", "M3 game snapshots require an active battle")
    })?;
    let authority_runtime = runtime.local_seat == battle.authority_seat;
    let mut paths = BTreeMap::new();

    for frontier in &battle.command_state.frontier {
        let (accepted, source) = match &frontier.status {
            CommandFrontierStatus::Retained { command, source }
            | CommandFrontierStatus::Admitted { command, source } => (command, *source),
            CommandFrontierStatus::Pending => continue,
        };
        if !authority_runtime || source != CommandAdmissionSource::AuthorityRemoteProposal {
            continue;
        }
        let AcceptedBattleCommand::Human { proposal, .. } = accepted else {
            return Err(snapshot_invalid(
                "state.battle.command_state.frontier",
                "a remote proposal proof must retain a human command proposal",
            ));
        };
        if proposal.owner_seat == battle.authority_seat {
            return Err(snapshot_invalid(
                "state.battle.command_state.frontier",
                "AuthorityRemoteProposal cannot belong to the authority seat",
            ));
        }
        let Some(tombstone) = runtime
            .command_fingerprints
            .iter()
            .find(|entry| entry.operation_id == proposal.operation_id)
        else {
            return Err(snapshot_invalid(
                "command_admission.command_tombstones",
                "a retained/admitted remote command is missing its admission tombstone",
            ));
        };
        if tombstone.fingerprint != proposal.fingerprint() {
            return Err(snapshot_invalid(
                "command_admission.command_tombstones",
                "remote command tombstone does not match the retained/admitted proposal",
            ));
        }

        let path = rebuild_remote_command_path(runtime, histories, proposal)?;
        if paths.insert(proposal.operation_id.clone(), path).is_some() {
            return Err(snapshot_invalid(
                "authority_remote_paths",
                "remote command proofs contain a duplicate operation identity",
            ));
        }
    }

    let decision = decision_for_state(&runtime.state)
        .map_err(|error| snapshot_runtime_invalid("state", error))?;
    if let BattleNextDecision::Replacement { occurrence } = decision {
        let faint = battle
            .faint_queue
            .iter()
            .find(|candidate| candidate.id == occurrence)
            .copied()
            .ok_or_else(|| {
                snapshot_invalid(
                    "state.battle.faint_queue",
                    "replacement decision occurrence is not stored",
                )
            })?;
        let Some(owner) = faint.owner_seat else {
            return Err(snapshot_invalid(
                "state.battle.faint_queue",
                "a player replacement occurrence must have a human owner",
            ));
        };
        if authority_runtime && owner != battle.authority_seat {
            let operation_id = replacement_operation_id(
                faint.source.epoch,
                battle.battle_id,
                faint.source.wave,
                faint.source.resolved_turn,
                faint.source.turn_occurrence,
                faint.slot,
                owner,
            )
            .map_err(|error| {
                snapshot_invalid(
                    "command_admission.replacement_tombstones",
                    error.to_string(),
                )
            })?;
            if let Some(tombstone) = runtime
                .replacement_fingerprints
                .iter()
                .find(|entry| entry.operation_id == operation_id)
            {
                let path = rebuild_remote_replacement_path(
                    runtime,
                    histories,
                    occurrence,
                    owner,
                    &operation_id,
                    tombstone,
                )?;
                if paths.insert(operation_id, path).is_some() {
                    return Err(snapshot_invalid(
                        "authority_remote_paths",
                        "remote command and replacement proofs share an operation identity",
                    ));
                }
            }
        }
    }

    Ok(paths)
}

fn rebuild_remote_command_path(
    runtime: &GameRuntime,
    histories: &[SeatControlHistorySnapshotV1],
    proposal: &BattleCommandProposalV1,
) -> Result<RuntimeAuthorityMenuPath, SnapshotError> {
    let menu_counts: &[usize] = match &proposal.command {
        BattleCommand::Fight { .. } => &[1, 2],
        BattleCommand::Switch { .. } => &[2],
    };
    let mut paths = Vec::new();
    let mut first_failure = None;
    let mut prior_controls = Vec::new();
    // A remote proof replays from the authority-installed root without
    // installing its leaf.  If the proposal completes the frontier before a
    // history transition is emitted, that live root is the only exact replay
    // source available to snapshot/restore.
    if let Some(control) = runtime
        .control
        .seat(proposal.owner_seat)
        .map(|entry| &entry.control)
        && matches!(control, BattleControl::CommandRoot(_))
    {
        push_unique_replay_control(&mut prior_controls, control);
    }
    for history in histories
        .iter()
        .filter(|history| history.seat == proposal.owner_seat)
    {
        for control in &history.controls {
            if !matches!(control, BattleControl::CommandRoot(_)) {
                continue;
            }
            push_unique_replay_control(&mut prior_controls, control);
        }
    }
    for prior_control in prior_controls {
        for menu_count in menu_counts {
            let first_menu_instance_id = match remote_menu_allocator_before_final(
                runtime,
                proposal.owner_seat,
                proposal.menu_instance_id,
                *menu_count,
                "authority_remote_paths.command",
            ) {
                Ok(first_menu_instance_id) => first_menu_instance_id,
                Err(error) => {
                    if first_failure.is_none() {
                        first_failure = Some(error.to_string());
                    }
                    continue;
                }
            };
            let candidate = match runtime_with_prior_control(
                runtime,
                proposal.owner_seat,
                &prior_control,
                &proposal.operation_id,
                first_menu_instance_id,
            ) {
                Ok(candidate) => candidate,
                Err(error) => {
                    if first_failure.is_none() {
                        first_failure = Some(error.to_string());
                    }
                    continue;
                }
            };
            match candidate.prepare_remote_command_path(proposal) {
                Ok(path) => paths.push(path),
                Err(error) => {
                    if first_failure.is_none() {
                        first_failure = Some(error.to_string());
                    }
                }
            }
        }
    }
    match paths.len() {
        1 => paths.into_iter().next().ok_or_else(|| {
            snapshot_invalid(
                "authority_remote_paths.command",
                "remote command proof disappeared",
            )
        }),
        0 => Err(snapshot_invalid(
            "authority_remote_paths.command",
            format!(
                "no matching prior CommandRoot control can replay the retained proposal{}",
                first_failure
                    .map(|failure| format!(": {failure}"))
                    .unwrap_or_default()
            ),
        )),
        _ => Err(snapshot_invalid(
            "authority_remote_paths.command",
            "more than one prior CommandRoot control can replay the retained proposal",
        )),
    }
}

fn rebuild_remote_replacement_path(
    runtime: &GameRuntime,
    histories: &[SeatControlHistorySnapshotV1],
    occurrence: FaintOccurrenceId,
    owner: SeatId,
    operation_id: &er_types::OperationId,
    tombstone: &ReplacementProposalFingerprintEntry,
) -> Result<RuntimeAuthorityMenuPath, SnapshotError> {
    let allocator = runtime.control.allocator(owner).ok_or_else(|| {
        snapshot_invalid(
            "menu_allocators",
            "remote replacement owner allocator is absent",
        )
    })?;
    let next_value = allocator.next_menu_instance_id.get().get();
    if next_value <= 1 {
        return Err(snapshot_invalid(
            "menu_allocators",
            "remote replacement allocator has no consumed menu instance to replay",
        ));
    }
    let final_menu_instance_id = MenuInstanceId::new(
        SafeU53::new(next_value - 1)
            .map_err(|error| snapshot_invalid("menu_allocators", error.to_string()))?,
    );
    let battle = runtime.state.battle.as_ref().ok_or_else(|| {
        snapshot_invalid("state.battle", "M3 game snapshots require an active battle")
    })?;
    let faint = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence)
        .copied()
        .ok_or_else(|| {
            snapshot_invalid(
                "state.battle.faint_queue",
                "replacement occurrence is absent",
            )
        })?;
    let mut prior_controls = Vec::new();
    // Replacement proofs use the same installed-parent rule as commands: the
    // current replacement control is a valid prior when admission is captured
    // before the common material boundary records a history transition.
    if let Some(control) = runtime.control.seat(owner).map(|entry| &entry.control)
        && let BattleControl::ReplacementSelect(value) = control
        && value.occurrence == occurrence
        && value.owner_seat == owner
        && value.field_slot == faint.slot
        && value.source == faint.source
    {
        push_unique_replay_control(&mut prior_controls, control);
    }
    for history in histories.iter().filter(|history| history.seat == owner) {
        for control in &history.controls {
            let BattleControl::ReplacementSelect(value) = control else {
                continue;
            };
            if value.occurrence != occurrence
                || value.owner_seat != owner
                || value.field_slot != faint.slot
                || value.source != faint.source
            {
                continue;
            }
            push_unique_replay_control(&mut prior_controls, control);
        }
    }

    let mut matches = Vec::new();
    let mut matched_proposals = Vec::new();
    let mut first_failure = None;
    for prior_control in prior_controls {
        let candidate = match runtime_with_prior_control(
            runtime,
            owner,
            &prior_control,
            operation_id,
            final_menu_instance_id,
        ) {
            Ok(candidate) => candidate,
            Err(error) => {
                if first_failure.is_none() {
                    first_failure = Some(error.to_string());
                }
                continue;
            }
        };
        let BattleControl::ReplacementSelect(current) = &prior_control else {
            continue;
        };
        for (index, pokemon) in battle.player_party.iter().enumerate() {
            let Ok(index) = u8::try_from(index) else {
                continue;
            };
            let Ok(party_slot) = PartyIndex::new(index) else {
                continue;
            };
            if pokemon.owner_seat != Some(owner) || pokemon.fainted {
                continue;
            }
            let Ok(selected_option) = party_option_id(pokemon.id, party_slot) else {
                continue;
            };
            if !current
                .menu
                .option(selected_option.clone())
                .is_some_and(|option| option.enabled)
            {
                continue;
            }
            let selected =
                match replay_replacement_selection(battle, current.clone(), &selected_option) {
                    Ok(selected) => selected,
                    Err(error) => {
                        if first_failure.is_none() {
                            first_failure = Some(error.to_string());
                        }
                        continue;
                    }
                };
            let option_control = match open_party_option_menu_from_control(
                battle,
                &BattleControl::ReplacementSelect(selected),
                current.menu.instance_id,
                final_menu_instance_id,
            ) {
                Ok(option_control) => option_control,
                Err(error) => {
                    if first_failure.is_none() {
                        first_failure = Some(error.to_string());
                    }
                    continue;
                }
            };
            let proposal = match BattleReplacementProposalV1::new(
                operation_id.clone(),
                battle.battle_id,
                battle.wave,
                current.source.resolved_turn,
                owner,
                occurrence,
                current.source.turn_occurrence,
                current.field_slot,
                ReplacementSelection::selected(party_slot, pokemon.id),
                final_menu_instance_id,
                option_control.menu.control_id.clone(),
            ) {
                Ok(proposal) => proposal,
                Err(error) => {
                    if first_failure.is_none() {
                        first_failure = Some(error.to_string());
                    }
                    continue;
                }
            };
            if proposal.fingerprint() != tombstone.fingerprint {
                continue;
            }
            if matched_proposals
                .iter()
                .any(|previous| previous == &proposal)
            {
                continue;
            }
            matched_proposals.push(proposal.clone());
            match candidate.prepare_remote_replacement_path(&proposal) {
                Ok(path) => matches.push(path),
                Err(error) => {
                    if first_failure.is_none() {
                        first_failure = Some(error.to_string());
                    }
                }
            }
        }
    }
    match matches.len() {
        1 => matches.into_iter().next().ok_or_else(|| {
            snapshot_invalid(
                "authority_remote_paths.replacement",
                "remote replacement proof disappeared",
            )
        }),
        0 => Err(snapshot_invalid(
            "authority_remote_paths.replacement",
            format!(
                "no matching prior ReplacementSelect control and proposal can replay the live tombstone{}",
                first_failure
                    .map(|failure| format!(": {failure}"))
                    .unwrap_or_default()
            ),
        )),
        _ => Err(snapshot_invalid(
            "authority_remote_paths.replacement",
            "more than one replacement proposal matches the live tombstone",
        )),
    }
}

fn push_unique_replay_control(prior_controls: &mut Vec<BattleControl>, control: &BattleControl) {
    if !prior_controls.iter().any(|previous| previous == control) {
        prior_controls.push(control.clone());
    }
}

fn collect_remote_control_anchors(control: &BattleControl, anchors: &mut Vec<BattleControl>) {
    match control {
        BattleControl::CommandRoot(_) | BattleControl::ReplacementSelect(_) => {
            push_unique_replay_control(anchors, control);
        }
        BattleControl::MoveSelect(value) => {
            collect_remote_control_anchors(value.cancel_to.as_ref(), anchors);
        }
        BattleControl::TargetSelect(value) => {
            collect_remote_control_anchors(value.cancel_to.as_ref(), anchors);
        }
        BattleControl::PartySelect(value) => {
            collect_remote_control_anchors(value.cancel_to.as_ref(), anchors);
        }
        BattleControl::PartyOptionSelect(value) => {
            collect_remote_control_anchors(value.cancel_to.as_ref(), anchors);
        }
        BattleControl::Waiting(_) | BattleControl::Complete(_) => {}
    }
}

fn remote_menu_allocator_before_final(
    runtime: &GameRuntime,
    seat: SeatId,
    final_menu_instance_id: MenuInstanceId,
    menu_count: usize,
    path: &str,
) -> Result<MenuInstanceId, SnapshotError> {
    if menu_count == 0 {
        return Err(snapshot_invalid(
            path,
            "remote menu replay must consume at least one menu instance",
        ));
    }
    let allocator = runtime
        .control
        .allocator(seat)
        .ok_or_else(|| snapshot_invalid(path, "remote proposal owner allocator is absent"))?;
    let final_value = final_menu_instance_id.get().get();
    let expected_next = final_value.checked_add(1).ok_or_else(|| {
        snapshot_invalid(
            path,
            "remote proposal menu instance exhausted its allocator",
        )
    })?;
    if allocator.next_menu_instance_id.get().get() != expected_next {
        return Err(snapshot_invalid(
            path,
            "remote proposal menu instance is not the exact consumed allocator value",
        ));
    }
    let first_value = final_value
        .checked_sub((menu_count - 1) as u64)
        .ok_or_else(|| snapshot_invalid(path, "remote proposal menu sequence underflowed"))?;
    if first_value == 0 {
        return Err(snapshot_invalid(
            path,
            "remote proposal menu sequence contains zero",
        ));
    }
    Ok(MenuInstanceId::new(SafeU53::new(first_value).map_err(
        |error| snapshot_invalid(path, error.to_string()),
    )?))
}

fn runtime_with_prior_control(
    runtime: &GameRuntime,
    seat: SeatId,
    prior_control: &BattleControl,
    operation_id: &er_types::OperationId,
    allocator_before: MenuInstanceId,
) -> Result<GameRuntime, SnapshotError> {
    if prior_control
        .owner_seat()
        .is_some_and(|owner| owner != seat)
    {
        return Err(snapshot_invalid(
            "control_history",
            "a replay prior control belongs to a different seat",
        ));
    }
    let mut seats = runtime.control.seats.clone();
    let Some(seat_control) = seats.iter_mut().find(|entry| entry.seat == seat) else {
        return Err(snapshot_invalid(
            "control_history",
            "a replay prior control has no current seat entry",
        ));
    };
    seat_control.control = prior_control.clone();
    seat_control.decision_operation_id = Some(operation_id.clone());
    let mut allocators = runtime.control.menu_allocators.clone();
    let Some(allocator) = allocators
        .iter_mut()
        .find(|allocator| allocator.seat == seat)
    else {
        return Err(snapshot_invalid(
            "menu_allocators",
            "a replay prior control has no seat allocator",
        ));
    };
    allocator.next_menu_instance_id = allocator_before;
    let control = BattleControlPlan::new(
        runtime.control.schema_version,
        runtime.control.battle_id,
        runtime.control.wave,
        runtime.control.turn,
        seats,
        allocators,
    )
    .map_err(|error| snapshot_invalid("control_history", error.to_string()))?;
    let mut candidate = runtime.clone();
    candidate.control = control;
    candidate.authority_remote_paths.clear();
    candidate.pending_no_legal_replacement = None;
    candidate
        .validate()
        .map_err(|error| snapshot_runtime_invalid("control_history", error))?;
    Ok(candidate)
}

fn control_menu(control: &BattleControl) -> Option<&BattleMenu> {
    match control {
        BattleControl::CommandRoot(value) => Some(&value.menu),
        BattleControl::MoveSelect(value) => Some(&value.menu),
        BattleControl::TargetSelect(value) => Some(&value.menu),
        BattleControl::PartySelect(value) => Some(&value.menu),
        BattleControl::PartyOptionSelect(value) => Some(&value.menu),
        BattleControl::ReplacementSelect(value) => Some(&value.menu),
        BattleControl::Waiting(_) | BattleControl::Complete(_) => None,
    }
}

fn replay_party_selection(
    battle: &BattleState,
    mut control: er_types::battle_control::PartySelectControl,
    selected_option: &MenuOptionId,
) -> Result<er_types::battle_control::PartySelectControl, GameRuntimeError> {
    for _ in 0..=battle.player_party.len() {
        if control.menu.selected_option_id == *selected_option {
            return Ok(control);
        }
        control = navigate_party_menu(
            battle,
            &control,
            control.menu.instance_id,
            NavigationDirection::Down,
        )?;
    }
    Err(ui_rejected(
        "party replay could not reach the submitted option",
    ))
}

fn replay_replacement_selection(
    battle: &BattleState,
    mut control: er_types::battle_control::ReplacementSelectControl,
    selected_option: &MenuOptionId,
) -> Result<er_types::battle_control::ReplacementSelectControl, GameRuntimeError> {
    for _ in 0..=battle.player_party.len() {
        if control.menu.selected_option_id == *selected_option {
            return Ok(control);
        }
        control = navigate_replacement_menu(
            battle,
            &control,
            control.menu.instance_id,
            NavigationDirection::Down,
        )?;
    }
    Err(ui_rejected(
        "replacement replay could not reach the submitted option",
    ))
}

fn command_root_selection(
    option_id: &MenuOptionId,
) -> Result<CommandRootSelection, GameRuntimeError> {
    match option_id.as_str() {
        crate::command_menu::COMMAND_FIGHT_OPTION_ID => Ok(CommandRootSelection::Fight),
        crate::command_menu::COMMAND_SWITCH_OPTION_ID => Ok(CommandRootSelection::Switch),
        _ => Err(ui_rejected("command-root option identity is stale")),
    }
}

fn parse_move_option_id(
    actor: PokemonId,
    option_id: &MenuOptionId,
) -> Result<MoveSlotIndex, GameRuntimeError> {
    let prefix = format!("move/{actor}/slot/");
    let Some(raw) = option_id.as_str().strip_prefix(&prefix) else {
        return Err(ui_rejected("move option identity is stale"));
    };
    if raw.is_empty()
        || (raw.len() > 1 && raw.starts_with('0'))
        || !raw.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ui_rejected("move option number is not canonical"));
    }
    let raw = raw
        .parse::<u8>()
        .map_err(|_| ui_rejected("move option number is invalid"))?;
    MoveSlotIndex::new(raw).map_err(|_| ui_rejected("move option is outside the four-slot graph"))
}

fn parse_target_option_id(option_id: &MenuOptionId) -> Result<FieldSlot, GameRuntimeError> {
    let mut parts = option_id.as_str().split('/');
    let (Some(kind), Some(side), Some(position), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(ui_rejected("target option identity is stale"));
    };
    if kind != "target"
        || position.is_empty()
        || (position.len() > 1 && position.starts_with('0'))
        || !position.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ui_rejected("target option number is not canonical"));
    }
    let position = position
        .parse::<u8>()
        .map_err(|_| ui_rejected("target option number is invalid"))?;
    let side = match side {
        "player" => BattleSide::Player,
        "enemy" => BattleSide::Enemy,
        _ => return Err(ui_rejected("target option side is invalid")),
    };
    Ok(FieldSlot { side, position })
}

fn replace_control_leaf(
    control_id: &str,
    expected_leaf: &str,
    next_leaf: &str,
) -> Result<String, GameRuntimeError> {
    let suffix = format!("/{expected_leaf}");
    let Some(prefix) = control_id.strip_suffix(&suffix) else {
        return Err(GameRuntimeError::ControlIdentityMismatch);
    };
    Ok(format!("{prefix}/{next_leaf}"))
}

fn rebind_menu(
    menu: &BattleMenu,
    new_instance_id: MenuInstanceId,
) -> Result<BattleMenu, GameRuntimeError> {
    BattleMenu::new(
        new_instance_id,
        menu.owner_seat,
        menu.control_id.clone(),
        menu.selected_option_id.clone(),
        menu.options.clone(),
        menu.navigation.clone(),
    )
    .map_err(|error| GameRuntimeError::ControlNode(BattleControlError::from(error)))
}

fn rebind_command_root(
    control: &BattleControl,
    new_instance_id: MenuInstanceId,
) -> Result<BattleControl, GameRuntimeError> {
    let BattleControl::CommandRoot(value) = control else {
        return Err(ui_rejected("Cancel parent is not CommandRoot"));
    };
    Ok(BattleControl::CommandRoot(
        er_types::battle_control::CommandRootControl::new(
            value.actor,
            value.field_slot,
            rebind_menu(&value.menu, new_instance_id)?,
        )?,
    ))
}

fn rebind_control_menu(
    control: &BattleControl,
    new_instance_id: MenuInstanceId,
) -> Result<BattleControl, GameRuntimeError> {
    match control {
        BattleControl::CommandRoot(value) => Ok(BattleControl::CommandRoot(
            er_types::battle_control::CommandRootControl::new(
                value.actor,
                value.field_slot,
                rebind_menu(&value.menu, new_instance_id)?,
            )?,
        )),
        BattleControl::MoveSelect(value) => Ok(BattleControl::MoveSelect(
            er_types::battle_control::MoveSelectControl::new(
                value.actor,
                value.field_slot,
                rebind_menu(&value.menu, new_instance_id)?,
                value.cancel_to.clone(),
            )?,
        )),
        BattleControl::TargetSelect(value) => Ok(BattleControl::TargetSelect(
            er_types::battle_control::TargetSelectControl::new(
                value.actor,
                value.field_slot,
                value.move_slot,
                value.multiple,
                value.candidate_targets.clone(),
                rebind_menu(&value.menu, new_instance_id)?,
                value.cancel_to.clone(),
            )?,
        )),
        BattleControl::PartySelect(value) => Ok(BattleControl::PartySelect(
            er_types::battle_control::PartySelectControl::new(
                value.actor,
                value.field_slot,
                rebind_menu(&value.menu, new_instance_id)?,
                value.last_left_option_id.clone(),
                value.last_right_option_id.clone(),
                value.cancel_to.clone(),
            )?,
        )),
        BattleControl::PartyOptionSelect(value) => Ok(BattleControl::PartyOptionSelect(
            er_types::battle_control::PartyOptionSelectControl::new(
                value.actor,
                value.field_slot,
                value.selected_party_slot,
                rebind_menu(&value.menu, new_instance_id)?,
                value.cancel_to.clone(),
            )?,
        )),
        BattleControl::ReplacementSelect(value) => Ok(BattleControl::ReplacementSelect(
            er_types::battle_control::ReplacementSelectControl::new(
                value.occurrence,
                value.source,
                value.actor,
                value.field_slot,
                value.owner_seat,
                rebind_menu(&value.menu, new_instance_id)?,
                value.last_left_option_id.clone(),
                value.last_right_option_id.clone(),
            )?,
        )),
        BattleControl::Waiting(_) | BattleControl::Complete(_) => {
            Err(ui_rejected("non-actionable control has no menu to rebind"))
        }
    }
}

fn ui_rejected(message: &str) -> GameRuntimeError {
    GameRuntimeError::UiTransition {
        message: message.to_owned(),
    }
}

fn decision_for_state(state: &GameState) -> Result<BattleNextDecision, GameRuntimeError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    if battle.outcome != BattleOutcome::Ongoing {
        return Ok(BattleNextDecision::Complete(battle.outcome));
    }
    if let Some(faint) = battle
        .faint_queue
        .iter()
        .find(|faint| faint.replacement != ReplacementProgress::Applied)
    {
        return Ok(BattleNextDecision::Replacement {
            occurrence: faint.id,
        });
    }
    Ok(BattleNextDecision::CommandFrontier)
}

fn expected_control_plan_turn(
    battle: &BattleState,
    decision: BattleNextDecision,
) -> Result<TurnIndex, GameRuntimeError> {
    match decision {
        BattleNextDecision::CommandFrontier | BattleNextDecision::Complete(_) => Ok(battle.turn),
        BattleNextDecision::Replacement { occurrence } => battle
            .faint_queue
            .iter()
            .find(|faint| faint.id == occurrence)
            .map(|faint| faint.source.resolved_turn)
            .ok_or_else(|| invalid_config("replacement decision occurrence is not stored")),
    }
}

fn validate_state_coordinate_progression(
    before: &GameState,
    after: &GameState,
) -> Result<(), GameRuntimeError> {
    let before_battle = before
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let after_battle = after
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    if before_battle.battle_id != after_battle.battle_id
        || before_battle.wave != after_battle.wave
        || before_battle.format != after_battle.format
        || after_battle.turn < before_battle.turn
    {
        return Err(GameRuntimeError::TransitionIdentityMismatch);
    }
    Ok(())
}

fn expected_material_operation_id(
    state: &GameState,
) -> Result<er_types::OperationId, GameRuntimeError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    if !battle.command_state.frontier.is_empty() {
        return Ok(turn_result_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
        )?);
    }
    let faint = battle
        .faint_queue
        .iter()
        .find(|faint| faint.replacement != ReplacementProgress::Applied)
        .ok_or_else(|| invalid_config("material has no current turn or replacement operation"))?;
    let owner = faint
        .owner_seat
        .ok_or_else(|| invalid_config("enemy faint cannot create a human replacement owner"))?;
    Ok(replacement_operation_id(
        faint.source.epoch,
        battle.battle_id,
        faint.source.wave,
        faint.source.resolved_turn,
        faint.source.turn_occurrence,
        faint.slot,
        owner,
    )?)
}

fn validate_current_operation_binding(
    state: &GameState,
    control: &BattleControlPlan,
    material_operation_id: &er_types::OperationId,
) -> Result<(), GameRuntimeError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    if !battle.command_state.frontier.is_empty() {
        for entry in &control.seats {
            let Some(operation_id) = entry.decision_operation_id.as_ref() else {
                continue;
            };
            let bound = battle.command_state.frontier.iter().any(|frontier| {
                frontier.owner_seat == Some(entry.seat)
                    && frontier.operation_id == *operation_id
                    && frontier.field_slot.side == BattleSide::Player
            });
            if !bound || *operation_id == *material_operation_id {
                return Err(GameRuntimeError::CurrentOperationMismatch);
            }
        }
        return Ok(());
    }

    let expected = expected_material_operation_id(state)?;
    if expected != *material_operation_id {
        return Err(GameRuntimeError::CurrentOperationMismatch);
    }
    let owner = battle
        .faint_queue
        .iter()
        .find(|faint| faint.replacement != ReplacementProgress::Applied)
        .and_then(|faint| faint.owner_seat)
        .ok_or_else(|| invalid_config("replacement operation has no human owner"))?;
    for entry in &control.seats {
        if entry.decision_operation_id.is_some()
            && (entry.seat != owner
                || entry.decision_operation_id.as_ref() != Some(material_operation_id))
        {
            return Err(GameRuntimeError::CurrentOperationMismatch);
        }
    }
    Ok(())
}

fn validate_allocator_installation(
    current: &[SeatMenuInstanceAllocator],
    allocator_before: &[SeatMenuInstanceAllocator],
    after: &[SeatMenuInstanceAllocator],
) -> Result<(), GameRuntimeError> {
    if current.len() != allocator_before.len() || current.len() != after.len() {
        return Err(GameRuntimeError::AllocatorMismatch);
    }
    for (current, before) in current.iter().zip(allocator_before) {
        if current.seat != before.seat {
            return Err(GameRuntimeError::AllocatorMismatch);
        }
    }
    for after in after {
        let Some(current) = current.iter().find(|value| value.seat == after.seat) else {
            return Err(GameRuntimeError::AllocatorMismatch);
        };
        let Some(before) = allocator_before
            .iter()
            .find(|value| value.seat == after.seat)
        else {
            return Err(GameRuntimeError::AllocatorMismatch);
        };
        if after.next_menu_instance_id < current.next_menu_instance_id
            || after.next_menu_instance_id < before.next_menu_instance_id
        {
            return Err(GameRuntimeError::AllocatorMismatch);
        }
    }
    Ok(())
}

fn validate_turn_transition_identity(
    runtime: &GameRuntime,
    transition: &er_battle::BattleTransition,
    material_operation_id: &er_types::OperationId,
) -> Result<(), GameRuntimeError> {
    validate_turn_transition_identity_inner(
        runtime,
        transition,
        TurnTransitionDigestValidation::Full,
        material_operation_id,
    )
}

fn validate_reducer_issued_turn_transition_identity(
    runtime: &GameRuntime,
    transition: &er_battle::BattleTransition,
    material_operation_id: &er_types::OperationId,
) -> Result<(), GameRuntimeError> {
    validate_turn_transition_identity_inner(
        runtime,
        transition,
        TurnTransitionDigestValidation::ReducerIssued,
        material_operation_id,
    )
}

#[derive(Clone, Copy)]
enum TurnTransitionDigestValidation {
    Full,
    ReducerIssued,
}

fn validate_turn_transition_identity_inner(
    runtime: &GameRuntime,
    transition: &er_battle::BattleTransition,
    digest_validation: TurnTransitionDigestValidation,
    material_operation_id: &er_types::OperationId,
) -> Result<(), GameRuntimeError> {
    if runtime.state != transition.before_state {
        return Err(GameRuntimeError::TransitionBeforeMismatch);
    }
    let before = transition
        .before_state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let after = transition
        .after_state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    match digest_validation {
        TurnTransitionDigestValidation::Full => {
            if transition.before_digest
                != MechanicalStateDigest::compute(&transition.before_state)
                    .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?
                || transition.after_digest
                    != MechanicalStateDigest::compute(&transition.after_state)
                        .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?
            {
                return Err(GameRuntimeError::TransitionDigestMismatch);
            }
        }
        TurnTransitionDigestValidation::ReducerIssued => {}
    }
    let expected_next_turn = before
        .turn
        .get()
        .get()
        .checked_add(1)
        .ok_or_else(|| invalid_config("turn allocator exhausted"))?;
    if before.battle_id != after.battle_id
        || before.wave != after.wave
        || (after.outcome == BattleOutcome::Ongoing && after.turn.get().get() != expected_next_turn)
        || (after.outcome != BattleOutcome::Ongoing && after.turn != before.turn)
    {
        return Err(GameRuntimeError::TransitionIdentityMismatch);
    }
    if transition.outcome != after.outcome
        || transition.next_decision != decision_for_state(&transition.after_state)?
        || *material_operation_id
            != turn_result_operation_id(before.battle_id, before.wave, before.turn)?
    {
        return Err(GameRuntimeError::TransitionIdentityMismatch);
    }
    if before
        .command_state
        .frontier
        .iter()
        .any(|entry| !matches!(&entry.status, CommandFrontierStatus::Admitted { .. }))
        || transition.accepted_commands != before.command_state.admitted_command_set()?
    {
        return Err(GameRuntimeError::CurrentOperationMismatch);
    }
    match digest_validation {
        TurnTransitionDigestValidation::Full => {
            validate_state_content_trusted(&transition.after_state, runtime.content.as_ref())
                .map_err(map_legality_error)?;
            validate_battle_mutation_evidence(
                &transition.before_state,
                &transition.after_state,
                &transition.mutations,
            )
            .map_err(|error| GameRuntimeError::Resolve(BattleResolveError::Invariant(error)))?;
        }
        TurnTransitionDigestValidation::ReducerIssued => {}
    }
    Ok(())
}

fn validate_replacement_transition_identity(
    runtime: &GameRuntime,
    transition: &er_battle::BattleReplacementTransition,
    material_operation_id: &er_types::OperationId,
) -> Result<(), GameRuntimeError> {
    if runtime.state != transition.before_state {
        return Err(GameRuntimeError::TransitionBeforeMismatch);
    }
    let before = transition
        .before_state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let after = transition
        .after_state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let stored = before
        .faint_queue
        .iter()
        .find(|faint| faint.id == transition.occurrence.id)
        .ok_or_else(|| invalid_config("replacement transition occurrence is not stored"))?;
    let owner = stored
        .owner_seat
        .ok_or_else(|| invalid_config("replacement occurrence has no human owner"))?;
    let expected_operation_id = replacement_operation_id(
        stored.source.epoch,
        before.battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence,
        stored.slot,
        owner,
    )?;
    if transition.before_digest
        != MechanicalStateDigest::compute(&transition.before_state)
            .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?
        || transition.after_digest
            != MechanicalStateDigest::compute(&transition.after_state)
                .map_err(|_| GameRuntimeError::TransitionDigestMismatch)?
        || before.battle_id != after.battle_id
        || before.wave != after.wave
        || before.turn != after.turn
        || *material_operation_id != expected_operation_id
        || transition.outcome != after.outcome
        || transition.next_decision != decision_for_state(&transition.after_state)?
    {
        return Err(GameRuntimeError::TransitionIdentityMismatch);
    }
    validate_state_content_trusted(&transition.after_state, runtime.content.as_ref())
        .map_err(map_legality_error)?;
    validate_battle_mutation_evidence(
        &transition.before_state,
        &transition.after_state,
        &transition.mutations,
    )
    .map_err(|error| GameRuntimeError::Resolve(BattleResolveError::Invariant(error)))?;
    Ok(())
}

/// Project one exact `BattleNextDecision` through the game-owned control
/// projector.  Material appliers use this same role-neutral function with
/// the allocator-before vector carried by the typed material; they must not
/// recreate a second control validator or menu builder.
#[doc(hidden)]
pub fn project_battle_control_plan(
    state: &GameState,
    decision: BattleNextDecision,
    allocator_before: &[SeatMenuInstanceAllocator],
    content: &ContentPack,
) -> Result<BattleControlPlan, GameRuntimeError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let seats = human_seats(&battle.format)?;
    match decision {
        BattleNextDecision::CommandFrontier => {
            project_command_frontier(state, &seats, allocator_before, content)
        }
        BattleNextDecision::Replacement { occurrence } => {
            project_replacement(state, occurrence, &seats, allocator_before)
        }
        BattleNextDecision::Complete(outcome) => {
            let entries = seats
                .iter()
                .map(|seat| {
                    Ok(SeatBattleControl::new(
                        *seat,
                        None,
                        BattleControl::complete(outcome)?,
                    ))
                })
                .collect::<Result<Vec<_>, GameRuntimeError>>()?;
            BattleControlPlan::new(
                BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
                battle.battle_id,
                battle.wave,
                battle.turn,
                entries,
                allocator_before.to_vec(),
            )
            .map_err(GameRuntimeError::Control)
        }
    }
}

fn invalid_config(message: &str) -> GameRuntimeError {
    GameRuntimeError::InvalidConfig {
        message: message.to_owned(),
    }
}

fn map_legality_error(source: er_battle::legality::CommandLegalityError) -> GameRuntimeError {
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

fn initial_allocators(
    seats: &[SeatId],
) -> Result<Vec<SeatMenuInstanceAllocator>, GameRuntimeError> {
    seats
        .iter()
        .map(|seat| {
            SeatMenuInstanceAllocator::new(
                *seat,
                menu_id(
                    SafeU53::new(1)
                        .map_err(|_| invalid_config("invalid initial menu allocator"))?,
                ),
            )
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
    validate_leads(
        &start.player_party,
        &start.player_leads,
        Some(human_seats),
        BattleSide::Player,
    )?;
    validate_leads(
        &start.enemy_party,
        &start.enemy_leads,
        None,
        BattleSide::Enemy,
    )?;
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
            return Err(invalid_config(
                "lead vectors must contain unique party slots",
            ));
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
                    return Err(invalid_config(
                        "player lead owner does not match canonical seat",
                    ));
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
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let mut next_policy = policy.clone();
    let mut frontier = Vec::new();
    for slot in canonical_slots(&battle.format)? {
        let Some(actor) = battle.field.occupant(&battle.format, slot)? else {
            continue;
        };
        let (owner_seat, operation_id, offer, status) = match slot.side {
            BattleSide::Player => {
                let owner = owner_seat_for(&battle.format, slot)?
                    .ok_or_else(|| invalid_config("player slot has no owner"))?;
                let operation = player_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    slot,
                    owner,
                )?;
                let offer = build_command_offer_trusted(state, slot, content)
                    .map_err(map_legality_error)?;
                (
                    Some(owner),
                    operation,
                    offer,
                    CommandFrontierStatus::Pending,
                )
            }
            BattleSide::Enemy => {
                let scripted = next_policy.next_command().cloned().ok_or_else(|| {
                    invalid_config("scripted enemy policy has no command at cursor")
                })?;
                if scripted.battle_id != battle.battle_id
                    || scripted.wave != battle.wave
                    || scripted.turn != battle.turn
                    || scripted.field_slot != slot
                    || scripted.actor != actor
                {
                    return Err(invalid_config(
                        "scripted enemy command coordinates are stale",
                    ));
                }
                let operation = scripted_enemy_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    slot,
                    scripted.script_cursor,
                )?;
                let offer =
                    build_scripted_enemy_offer_trusted(state, slot, &scripted.command, content)
                        .map_err(map_legality_error)?;
                let accepted = AcceptedBattleCommand::scripted_enemy(scripted);
                next_policy.cursor =
                    increment_safe(next_policy.cursor, "scripted enemy cursor exhausted")?;
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
    _content: &ContentPack,
) -> Result<BattleControlPlan, GameRuntimeError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    battle.command_state.validate()?;
    // Runtime and snapshot invariants keep every canonical human seat in the
    // plan.  The pending frontier controls actionability; seats excluded from
    // that frontier wait on the exact operations that can advance it.
    let pending_entries = battle
        .command_state
        .frontier
        .iter()
        .filter(|entry| matches!(&entry.status, CommandFrontierStatus::Pending))
        .collect::<Vec<_>>();
    if pending_entries.is_empty() {
        return Err(invalid_config("command frontier has no pending decision"));
    }
    for entry in &pending_entries {
        let owner = entry
            .owner_seat
            .ok_or_else(|| invalid_config("pending command entry has no human owner"))?;
        if entry.field_slot.side != BattleSide::Player || !seats.contains(&owner) {
            return Err(invalid_config(
                "pending command entry is not owned by a canonical human seat",
            ));
        }
    }
    let pending_operation_ids = pending_entries
        .iter()
        .map(|entry| entry.operation_id.clone())
        .collect::<Vec<_>>();
    let mut seat_entries = Vec::with_capacity(seats.len());
    let mut next_allocators = allocators.to_vec();
    for seat in seats {
        let mut matching_entries = pending_entries
            .iter()
            .copied()
            .filter(|entry| entry.owner_seat == Some(*seat));
        let Some(entry) = matching_entries.next() else {
            seat_entries.push(SeatBattleControl::new(
                *seat,
                None,
                BattleControl::Waiting(WaitingControl::new(
                    WaitingReason::PartnerCommand,
                    pending_operation_ids.clone(),
                )?),
            ));
            continue;
        };
        if matching_entries.next().is_some() {
            return Err(invalid_config(
                "human seat owns duplicate pending command entries",
            ));
        }
        let slot = entry.field_slot;
        let actor = entry.actor;
        let offer = entry.offer.clone();
        let operation_id = entry.operation_id.clone();
        let allocator = next_allocators
            .iter_mut()
            .find(|allocator| allocator.seat == *seat)
            .ok_or_else(|| invalid_config("missing human menu allocator"))?;
        let instance_id = allocator.next_menu_instance_id;
        allocator.next_menu_instance_id = menu_id(increment_safe(
            instance_id.get(),
            "menu allocator exhausted",
        )?);
        let control_id = format!(
            "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
            battle.battle_id, battle.wave, battle.turn, slot.position, seat,
        );
        let control = BattleControl::CommandRoot(build_command_root_control(
            instance_id,
            *seat,
            control_id,
            actor,
            slot,
            &offer,
            CommandRootSelection::Fight,
        )?);
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

fn normalize_replacement_selection(
    battle: &BattleState,
    mut control: er_types::battle_control::ReplacementSelectControl,
) -> Result<er_types::battle_control::ReplacementSelectControl, GameRuntimeError> {
    // The canonical replacement builder preserves party order for stable
    // identity, so its first option may be the fainted active.  A projected
    // actionable control must nevertheless start on an enabled visible
    // option.  Replay the canonical Down edges rather than editing the menu
    // cursor directly; this preserves menu instance, control ID, and memory.
    let max_steps = control.menu.options.len().saturating_add(1);
    for _ in 0..max_steps {
        let selected = control
            .menu
            .option(control.menu.selected_option_id.clone())
            .ok_or_else(|| invalid_config("replacement menu selection is absent"))?;
        if selected.enabled && selected.visibility.is_visible() {
            return Ok(control);
        }
        let previous = control.menu.selected_option_id.clone();
        let next = navigate_replacement_menu(
            battle,
            &control,
            control.menu.instance_id,
            NavigationDirection::Down,
        )?;
        if next.menu.selected_option_id == previous {
            break;
        }
        control = next;
    }
    Err(invalid_config(
        "replacement menu has no enabled visible selection",
    ))
}

fn project_replacement(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    seats: &[SeatId],
    allocators: &[SeatMenuInstanceAllocator],
) -> Result<BattleControlPlan, GameRuntimeError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    let faint = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence)
        .ok_or_else(|| invalid_config("replacement decision occurrence is not stored"))?;
    // A turn resolver may already have advanced `battle.turn` while this
    // forced replacement still belongs to the turn that caused the faint.
    // Replacement control IDs and source identity are keyed by that resolved
    // turn, so the plan coordinate follows `source.resolved_turn`.
    let control_turn = faint.source.resolved_turn;
    let owner = faint
        .owner_seat
        .ok_or_else(|| invalid_config("enemy faint cannot create a human replacement control"))?;
    let operation_id = replacement_operation_id(
        faint.source.epoch,
        battle.battle_id,
        faint.source.wave,
        faint.source.resolved_turn,
        faint.source.turn_occurrence,
        faint.slot,
        owner,
    )?;
    let owner_allocator = allocators
        .iter()
        .find(|allocator| allocator.seat == owner)
        .ok_or_else(|| invalid_config("missing replacement owner allocator"))?;
    let projection =
        build_replacement_menu(battle, occurrence, owner_allocator.next_menu_instance_id)?;
    if matches!(projection, ReplacementMenuResult::NoLegalReplacement { .. }) {
        let entries = seats
            .iter()
            .map(|seat| {
                WaitingControl::new(WaitingReason::ReplacementOwner, vec![operation_id.clone()])
                    .map(|waiting| {
                        SeatBattleControl::new(*seat, None, BattleControl::Waiting(waiting))
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        return BattleControlPlan::new(
            BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
            battle.battle_id,
            battle.wave,
            control_turn,
            entries,
            allocators.to_vec(),
        )
        .map_err(GameRuntimeError::Control);
    }
    let ReplacementMenuResult::Menu(replacement_control) = projection else {
        return Err(invalid_config(
            "replacement menu projection changed classification",
        ));
    };
    let replacement_control = normalize_replacement_selection(battle, replacement_control)?;
    let mut next_allocators = allocators.to_vec();
    let mut entries = Vec::with_capacity(seats.len());
    for seat in seats {
        if *seat == owner {
            let allocator = next_allocators
                .iter_mut()
                .find(|allocator| allocator.seat == *seat)
                .ok_or_else(|| invalid_config("missing replacement owner allocator"))?;
            allocator.next_menu_instance_id = menu_id(increment_safe(
                allocator.next_menu_instance_id.get(),
                "menu allocator exhausted",
            )?);
            entries.push(SeatBattleControl::new(
                *seat,
                Some(operation_id.clone()),
                BattleControl::ReplacementSelect(replacement_control.clone()),
            ));
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
        control_turn,
        entries,
        next_allocators,
    )
    .map_err(GameRuntimeError::Control)
}

fn control_accepts_command(
    state: &GameState,
    control: &BattleControlPlan,
    proposal: &BattleCommandProposalV1,
) -> bool {
    let Some(seat) = control.seat(proposal.owner_seat) else {
        return false;
    };
    if seat.decision_operation_id.as_ref() != Some(&proposal.operation_id) {
        return false;
    }

    let menu_matches = |menu: &BattleMenu, actor: PokemonId, slot: FieldSlot| {
        menu.instance_id == proposal.menu_instance_id
            && menu.control_id.as_str() == proposal.control_id.as_str()
            && actor == proposal.actor
            && slot == proposal.field_slot
    };
    match (&seat.control, &proposal.command) {
        (
            BattleControl::MoveSelect(value),
            BattleCommand::Fight {
                move_slot, targets, ..
            },
        ) if menu_matches(&value.menu, value.actor, value.field_slot) => {
            move_option_id(value.actor, *move_slot)
                .is_ok_and(|option| value.menu.selected_option_id == option)
                && matches!(targets, BattleTargetSelection::Implicit)
        }
        (
            BattleControl::TargetSelect(value),
            BattleCommand::Fight {
                move_slot, targets, ..
            },
        ) if menu_matches(&value.menu, value.actor, value.field_slot)
            && value.move_slot == *move_slot =>
        {
            crate::target_menu::select_target_control(value)
                .is_ok_and(|selected| selected == *targets)
        }
        // A voluntary Switch is final only at the Send Out leaf reached from
        // the PartySelect path.  Accepting it from a root/PartySelect menu
        // would bypass the explicit option confirmation.
        (BattleControl::PartyOptionSelect(value), BattleCommand::Switch { party_slot, .. })
            if menu_matches(&value.menu, value.actor, value.field_slot)
                && value.menu.selected_option_id.as_str() == PARTY_OPTION_SEND_OUT_ID
                && value.selected_party_slot == *party_slot =>
        {
            let BattleControl::PartySelect(parent) = value.cancel_to.as_ref() else {
                return false;
            };
            let Some(battle) = state.battle.as_ref() else {
                return false;
            };
            if crate::party_menu::validate_party_control(battle, parent, None).is_err() {
                return false;
            }
            let Some(pokemon) = battle.player_party.get(usize::from(party_slot.get())) else {
                return false;
            };
            party_option_id(pokemon.id, *party_slot)
                .is_ok_and(|option| parent.menu.selected_option_id == option)
                && value
                    .menu
                    .option(value.menu.selected_option_id.clone())
                    .is_some_and(|option| option.enabled)
        }
        _ => false,
    }
}

fn control_accepts_replacement(
    state: &GameState,
    control: &BattleControlPlan,
    proposal: &BattleReplacementProposalV1,
) -> bool {
    let Some(seat) = control.seat(proposal.owner_seat) else {
        return false;
    };
    if seat.decision_operation_id.as_ref() != Some(&proposal.operation_id) {
        return false;
    }
    let (parent, leaf) = match &seat.control {
        BattleControl::ReplacementSelect(value) => (value, None),
        BattleControl::PartyOptionSelect(value) => {
            let BattleControl::ReplacementSelect(parent) = value.cancel_to.as_ref() else {
                return false;
            };
            (parent, Some(value))
        }
        _ => return false,
    };
    let ReplacementSelection::Selected {
        party_slot,
        pokemon,
    } = proposal.selection
    else {
        return false;
    };
    let Ok(expected_parent_option) = party_option_id(pokemon, party_slot) else {
        return false;
    };
    let Some(battle) = state.battle.as_ref() else {
        return false;
    };
    let Some(member) = battle.player_party.get(usize::from(party_slot.get())) else {
        return false;
    };
    if member.id != pokemon {
        return false;
    }
    if !replacement_operation_id(
        parent.source.epoch,
        battle.battle_id,
        parent.source.wave,
        parent.source.resolved_turn,
        parent.source.turn_occurrence,
        parent.field_slot,
        parent.owner_seat,
    )
    .is_ok_and(|operation_id| operation_id == proposal.operation_id)
        || crate::replacement_menu::validate_replacement_control(
            battle,
            parent,
            Some(parent.menu.instance_id),
        )
        .is_err()
        || parent.owner_seat != proposal.owner_seat
        || parent.occurrence != proposal.occurrence
        || parent.field_slot != proposal.field_slot
        || parent.menu.selected_option_id != expected_parent_option
        || !parent
            .menu
            .option(parent.menu.selected_option_id.clone())
            .is_some_and(|option| option.enabled && option.visibility.is_visible())
    {
        return false;
    }

    match leaf {
        None => {
            parent.menu.instance_id == proposal.menu_instance_id
                && parent.menu.control_id.as_str() == proposal.control_id.as_str()
        }
        Some(value) => {
            let Ok(send_out) = MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID) else {
                return false;
            };
            value.actor == parent.actor
                && value.field_slot == parent.field_slot
                && value.selected_party_slot == party_slot
                && value.menu.instance_id == proposal.menu_instance_id
                && value.menu.control_id.as_str() == proposal.control_id.as_str()
                && value.menu.selected_option_id == send_out
                && value
                    .menu
                    .option(value.menu.selected_option_id.clone())
                    .is_some_and(|option| option.enabled && option.visibility.is_visible())
        }
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
        return Err(invalid_config(
            "accepted command seat is absent from control plan",
        ));
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

fn project_waiting_after_replacement(
    current: &BattleControlPlan,
    owner: SeatId,
    operation_id: &er_types::OperationId,
) -> Result<BattleControlPlan, GameRuntimeError> {
    let waiting = BattleControl::Waiting(WaitingControl::new(
        WaitingReason::ReplacementOwner,
        vec![operation_id.clone()],
    )?);
    let mut seats = current.seats.clone();
    let Some(entry) = seats.iter_mut().find(|entry| entry.seat == owner) else {
        return Err(invalid_config(
            "replacement owner is absent from control plan",
        ));
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
            return Err(invalid_config(
                "command fingerprint ledger is not canonical",
            ));
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
            return Err(invalid_config(
                "replacement fingerprint ledger is not canonical",
            ));
        }
    }
    Ok(())
}
