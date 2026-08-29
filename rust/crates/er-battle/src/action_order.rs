//! Frozen M3 action construction and dynamic action ordering.
//!
//! The oracle has two distinct ordering stages.  Command construction puts
//! ordinary switches before fights, while the phase queues then reorder their
//! own entries immediately before every pop.  This module keeps those stages
//! separate so a later resolver can consume one [`PendingAction`] at a time
//! without inventing an actor or field-slot tie-break.

use std::cmp::Reverse;

use er_content::moves::find_move;
use er_content::pack::{ContentPack, ContentPackError};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_state::battle::BattleState;
use er_state::pokemon::{MAX_STAT_STAGE, MIN_STAT_STAGE, PokemonState};
use er_state::snapshot::GameState;
use er_state::validation::StateValidationError;
use er_types::battle_ids::{BattleSide, FieldSlot, MoveId, MoveSlotIndex, PartyIndex, PokemonId};
use er_types::battle_model::{ResolvedActionKind, StatusKind};
use er_types::{OperationId, SafeU53};
use thiserror::Error;

use crate::command::{NormalizedBattleCommand, NormalizedCommandSet};

const NORMAL_MOVE_TIMING: i8 = 1;
const SWITCH_TIMING: i8 = 0;
const NORMAL_MOVE_BRACKET: i8 = 1;
const SWITCH_BRACKET: i8 = 0;

/// Ordering branches that are represented by the oracle but rejected by the
/// selected M3 capability slice.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum UnsupportedOrdering {
    #[error("Trick Room ordering is outside the selected M3 slice")]
    TrickRoom,
    #[error("explicit set-order ordering is outside the selected M3 slice")]
    ExplicitSetOrder,
    #[error("Pursuit/interception ordering is outside the selected M3 slice")]
    PursuitInterception,
    #[error("self-switching move ordering is outside the selected M3 slice")]
    SelfSwitchingMove,
    #[error("non-neutral arena conditions are outside the selected M3 slice")]
    ArenaCondition,
}

/// Optional oracle branches supplied by an integration boundary.
///
/// The selected M3 slice has no supported value for any of these switches.
/// They are explicit so a caller cannot accidentally turn an unsupported
/// ordering mode into an ordinary speed sort.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ActionOrderOptions {
    pub trick_room: bool,
    pub set_order: Option<Vec<FieldSlot>>,
    pub pursuit_interception: bool,
    pub self_switching_move: bool,
}

/// A fail-closed action-ordering failure.
#[derive(Debug, Error)]
pub enum ActionOrderError {
    #[error("there is no active battle")]
    MissingBattle,
    #[error("mechanical state is invalid: {0}")]
    State(#[source] StateValidationError),
    #[error("immutable content pack is invalid: {0}")]
    Content(#[source] ContentPackError),
    #[error("action ordering RNG failed: {0}")]
    Rng(#[source] RngError),
    #[error("unsupported action ordering: {0}")]
    Unsupported(#[source] UnsupportedOrdering),
    #[error("normalized command count {actual} does not match active slot count {expected}")]
    CommandCountMismatch { expected: usize, actual: usize },
    #[error("normalized command references inactive field slot {slot:?}")]
    UnexpectedCommand { slot: FieldSlot },
    #[error("normalized commands contain duplicate field slot {slot:?}")]
    DuplicateCommand { slot: FieldSlot },
    #[error("active field slot {slot:?} has no normalized command")]
    MissingCommand { slot: FieldSlot },
    #[error("command actor {actor:?} does not occupy field slot {slot:?}")]
    ActorMismatch { slot: FieldSlot, actor: PokemonId },
    #[error("command actor {actor:?} is absent from the battle party")]
    UnknownActor { actor: PokemonId },
    #[error("command actor {actor:?} is fainted")]
    FaintedActor { actor: PokemonId },
    #[error("switch destination for actor {actor:?} does not match party slot {party_slot:?}")]
    SwitchDestinationMismatch {
        actor: PokemonId,
        party_slot: PartyIndex,
        incoming: PokemonId,
    },
    #[error("switch destination {incoming:?} is fainted")]
    SwitchDestinationFainted { incoming: PokemonId },
    #[error("move slot {move_slot:?} is absent for actor {actor:?}")]
    MissingMoveSlot {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
    },
    #[error("move identity for actor {actor:?} at slot {move_slot:?} is not current")]
    MoveIdentityMismatch {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        move_id: MoveId,
    },
    #[error("move {move_id:?} is outside the selected M3 content slice")]
    UnsupportedMove { move_id: MoveId },
    #[error("status {status:?} for actor {actor:?} is unsupported by effective Speed ordering")]
    UnsupportedSpeedStatus {
        actor: PokemonId,
        status: StatusKind,
    },
    #[error("speed stage {stage} for actor {actor:?} is outside [{min}, {max}]")]
    InvalidSpeedStage {
        actor: PokemonId,
        stage: i8,
        min: i8,
        max: i8,
    },
    #[error("effective speed for actor {actor:?} exceeds the u32 action-order domain")]
    SpeedOverflow { actor: PokemonId },
    #[error("seeded tie position exceeds the SafeU53 domain")]
    TieOrderOverflow,
}

/// One normalized command waiting in the staged dynamic queue.
///
/// The command is retained verbatim for B10.  The copied operation identity
/// is intentionally exposed beside it because later action evidence must not
/// reconstruct identity from actor or field position.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingAction {
    pub command: NormalizedBattleCommand,
    pub kind: ResolvedActionKind,
    pub actor: PokemonId,
    pub source_slot: FieldSlot,
    pub command_operation_id: OperationId,
    pub move_slot: Option<MoveSlotIndex>,
    pub move_id: Option<MoveId>,
    pub targets: Vec<FieldSlot>,
    pub party_slot: Option<PartyIndex>,
    pub incoming: Option<PokemonId>,
    pub effective_speed: u32,
    pub timing_modifier: i8,
    pub move_priority: i8,
    pub bracket_modifier: i8,
    pub tie_order: SafeU53,
}

impl PendingAction {
    pub fn operation_id(&self) -> &OperationId {
        &self.command_operation_id
    }

    pub const fn is_switch(&self) -> bool {
        matches!(self.kind, ResolvedActionKind::Switch)
    }

    pub const fn is_move(&self) -> bool {
        matches!(self.kind, ResolvedActionKind::Move)
    }

    pub fn into_command(self) -> NormalizedBattleCommand {
        self.command
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PendingStage {
    Switches,
    Moves,
    Done,
}

/// Deterministic pending actions separated at the same phase-tree boundary
/// used by the oracle: ordinary switches are popped before move phases.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingActionQueue {
    switches: Vec<PendingAction>,
    moves: Vec<PendingAction>,
    stage: PendingStage,
    options: ActionOrderOptions,
}

impl PendingActionQueue {
    fn new(
        switches: Vec<PendingAction>,
        moves: Vec<PendingAction>,
        options: ActionOrderOptions,
    ) -> Self {
        let stage = if switches.is_empty() {
            if moves.is_empty() {
                PendingStage::Done
            } else {
                PendingStage::Moves
            }
        } else {
            PendingStage::Switches
        };
        Self {
            switches,
            moves,
            stage,
            options,
        }
    }

    /// Number of actions not yet popped.
    pub fn len(&self) -> usize {
        self.switches.len() + self.moves.len()
    }

    pub fn is_empty(&self) -> bool {
        self.switches.is_empty() && self.moves.is_empty()
    }

    /// Current-stage entries before the next dynamic reorder.
    pub fn current_stage(&self) -> &[PendingAction] {
        match self.stage {
            PendingStage::Switches => &self.switches,
            PendingStage::Moves => &self.moves,
            PendingStage::Done => &[],
        }
    }

    /// Reorder the current dynamic queue and pop exactly one action.
    ///
    /// Effective speed is read from the supplied live state before each pop.
    /// The seed-offset Fisher-Yates transaction is therefore repeated for
    /// every queue pop, matching the source priority-queue boundary.
    pub fn pop_next(
        &mut self,
        state: &GameState,
        rng: &mut RngRuntime,
    ) -> Result<Option<PendingAction>, ActionOrderError> {
        let battle = state
            .battle
            .as_ref()
            .ok_or(ActionOrderError::MissingBattle)?;
        validate_supported_ordering(battle, &self.options)?;

        if self.stage == PendingStage::Switches && self.switches.is_empty() {
            self.stage = if self.moves.is_empty() {
                PendingStage::Done
            } else {
                PendingStage::Moves
            };
        }
        if self.stage == PendingStage::Moves && self.moves.is_empty() {
            self.stage = PendingStage::Done;
        }
        if self.stage == PendingStage::Done {
            return Ok(None);
        }

        let is_move_queue = self.stage == PendingStage::Moves;
        let action = {
            let actions = if is_move_queue {
                &mut self.moves
            } else {
                &mut self.switches
            };
            reorder_actions(actions, is_move_queue, battle, rng)?;

            if actions.is_empty() {
                None
            } else {
                actions.drain(..1).next()
            }
        };
        if action.is_none() {
            self.stage = if is_move_queue {
                PendingStage::Done
            } else {
                PendingStage::Moves
            };
        }
        Ok(action)
    }

    /// Alias named for callers that model the queue as a conventional popper.
    pub fn pop(
        &mut self,
        state: &GameState,
        rng: &mut RngRuntime,
    ) -> Result<Option<PendingAction>, ActionOrderError> {
        self.pop_next(state, rng)
    }
}

/// Calculate the selected-slice live effective Speed for one Pokémon.
///
/// The current stat is stage-adjusted first.  Paralysis then applies the
/// oracle's JavaScript right shift, and the final value is clamped to one.
pub fn effective_speed(pokemon: &PokemonState) -> Result<u32, ActionOrderError> {
    if matches!(pokemon.status.kind, StatusKind::Toxic | StatusKind::Sleep) {
        return Err(ActionOrderError::UnsupportedSpeedStatus {
            actor: pokemon.id,
            status: pokemon.status.kind,
        });
    }

    let stage = pokemon.stat_stages.speed;
    if !(MIN_STAT_STAGE..=MAX_STAT_STAGE).contains(&stage) {
        return Err(ActionOrderError::InvalidSpeedStage {
            actor: pokemon.id,
            stage,
            min: MIN_STAT_STAGE,
            max: MAX_STAT_STAGE,
        });
    }

    let magnitude = u64::from(stage.unsigned_abs());
    let numerator = if stage >= 0 {
        2_u64
            .checked_add(magnitude)
            .ok_or(ActionOrderError::SpeedOverflow { actor: pokemon.id })?
    } else {
        2_u64
    };
    let denominator = if stage < 0 {
        2_u64
            .checked_add(magnitude)
            .ok_or(ActionOrderError::SpeedOverflow { actor: pokemon.id })?
    } else {
        2_u64
    };
    let adjusted = u64::from(pokemon.stats.speed)
        .checked_mul(numerator)
        .ok_or(ActionOrderError::SpeedOverflow { actor: pokemon.id })?
        / denominator;
    let adjusted = u32::try_from(adjusted)
        .map_err(|_| ActionOrderError::SpeedOverflow { actor: pokemon.id })?;

    let adjusted = if pokemon.status.kind == StatusKind::Paralysis {
        // `ret >>= 1` is an arithmetic signed-32-bit shift in JavaScript.
        // The selected M3 state keeps effective stats in the exported u32
        // domain, so this conversion is exact for all accepted values.
        ((adjusted as i32) >> 1).max(1) as u32
    } else {
        adjusted
    };

    Ok(adjusted.max(1))
}

/// Build the staged pending-action queue from the canonical normalized set.
pub fn build_pending_action_queue(
    state: &GameState,
    commands: &NormalizedCommandSet,
    content: &ContentPack,
) -> Result<PendingActionQueue, ActionOrderError> {
    build_pending_action_queue_with_options(
        state,
        commands.entries(),
        content,
        &ActionOrderOptions::default(),
    )
}

/// Build a staged pending-action queue from a normalized command slice.
///
/// This narrow form is useful to integration tests and adapters that already
/// hold the legality-checked entries but have not yet assembled a set DTO.
pub fn build_pending_action_queue_from_commands(
    state: &GameState,
    commands: &[NormalizedBattleCommand],
    content: &ContentPack,
) -> Result<PendingActionQueue, ActionOrderError> {
    build_pending_action_queue_with_options(
        state,
        commands,
        content,
        &ActionOrderOptions::default(),
    )
}

/// Build the default queue after the enclosing turn resolver has already
/// validated the immutable content pack and complete state/content binding.
pub(crate) fn build_pending_action_queue_from_commands_validated(
    state: &GameState,
    commands: &[NormalizedBattleCommand],
    content: &ContentPack,
) -> Result<PendingActionQueue, ActionOrderError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(ActionOrderError::MissingBattle)?;
    let options = ActionOrderOptions::default();
    validate_supported_ordering(battle, &options)?;
    build_pending_action_queue_validated(battle, commands, content, &options)
}

/// Build a staged queue while explicitly classifying unsupported oracle modes.
pub fn build_pending_action_queue_with_options(
    state: &GameState,
    commands: &[NormalizedBattleCommand],
    content: &ContentPack,
    options: &ActionOrderOptions,
) -> Result<PendingActionQueue, ActionOrderError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(ActionOrderError::MissingBattle)?;
    validate_supported_ordering(battle, options)?;
    content.validate().map_err(ActionOrderError::Content)?;
    state.validate().map_err(ActionOrderError::State)?;

    build_pending_action_queue_validated(battle, commands, content, options)
}

fn build_pending_action_queue_validated(
    battle: &BattleState,
    commands: &[NormalizedBattleCommand],
    content: &ContentPack,
    options: &ActionOrderOptions,
) -> Result<PendingActionQueue, ActionOrderError> {
    let active_slots: Vec<FieldSlot> = battle
        .field
        .slots
        .iter()
        .filter_map(|entry| entry.occupant.map(|_| entry.slot))
        .collect();
    if commands.len() != active_slots.len() {
        return Err(ActionOrderError::CommandCountMismatch {
            expected: active_slots.len(),
            actual: commands.len(),
        });
    }

    let mut seen_slots = Vec::with_capacity(commands.len());
    for command in commands {
        let slot = command.field_slot();
        if !active_slots.contains(&slot) {
            return Err(ActionOrderError::UnexpectedCommand { slot });
        }
        if seen_slots.contains(&slot) {
            return Err(ActionOrderError::DuplicateCommand { slot });
        }
        seen_slots.push(slot);
        validate_command_actor(battle, command)?;
    }
    for slot in active_slots.iter().copied() {
        if !seen_slots.contains(&slot) {
            return Err(ActionOrderError::MissingCommand { slot });
        }
    }

    let mut switches = Vec::new();
    let mut moves = Vec::new();

    // `active_slots` is already player-first then enemy in canonical field
    // order.  Iterating it twice is the exact FIGHT/non-FIGHT command
    // comparator for the supported two-command slice; input vector order is
    // deliberately not used as a hidden tie-break.
    for slot in active_slots.iter().copied() {
        let Some(command) = commands.iter().find(|command| command.field_slot() == slot) else {
            return Err(ActionOrderError::MissingCommand { slot });
        };
        if matches!(command, NormalizedBattleCommand::Switch { .. }) {
            switches.push(build_switch_action(battle, command)?);
        }
    }
    for slot in active_slots.iter().copied() {
        let Some(command) = commands.iter().find(|command| command.field_slot() == slot) else {
            return Err(ActionOrderError::MissingCommand { slot });
        };
        if matches!(command, NormalizedBattleCommand::Fight { .. }) {
            moves.push(build_move_action(battle, command, content)?);
        }
    }

    Ok(PendingActionQueue::new(switches, moves, options.clone()))
}

/// Resolve the queue into pending entries, retaining every staged ordering
/// fact for B10 and the later `ResolvedAction` conversion.
pub fn order_pending_actions(
    state: &GameState,
    commands: &NormalizedCommandSet,
    content: &ContentPack,
    rng: &mut RngRuntime,
) -> Result<Vec<PendingAction>, ActionOrderError> {
    order_pending_actions_with_options(
        state,
        commands.entries(),
        content,
        &ActionOrderOptions::default(),
        rng,
    )
}

/// Slice-based convenience form of [`order_pending_actions`].
pub fn order_pending_actions_from_commands(
    state: &GameState,
    commands: &[NormalizedBattleCommand],
    content: &ContentPack,
    rng: &mut RngRuntime,
) -> Result<Vec<PendingAction>, ActionOrderError> {
    order_pending_actions_with_options(
        state,
        commands,
        content,
        &ActionOrderOptions::default(),
        rng,
    )
}

/// Resolve a normalized command slice with explicit unsupported-branch
/// classification.
pub fn order_pending_actions_with_options(
    state: &GameState,
    commands: &[NormalizedBattleCommand],
    content: &ContentPack,
    options: &ActionOrderOptions,
    rng: &mut RngRuntime,
) -> Result<Vec<PendingAction>, ActionOrderError> {
    let mut queue = build_pending_action_queue_with_options(state, commands, content, options)?;
    let mut ordered = Vec::with_capacity(queue.len());
    while let Some(action) = queue.pop_next(state, rng)? {
        ordered.push(action);
    }
    Ok(ordered)
}

fn validate_supported_ordering(
    battle: &BattleState,
    options: &ActionOrderOptions,
) -> Result<(), ActionOrderError> {
    if options.trick_room {
        return Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::TrickRoom,
        ));
    }
    if options.set_order.is_some() {
        return Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::ExplicitSetOrder,
        ));
    }
    if options.pursuit_interception {
        return Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::PursuitInterception,
        ));
    }
    if options.self_switching_move {
        return Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::SelfSwitchingMove,
        ));
    }
    if !battle.arena_conditions.is_empty() {
        return Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::ArenaCondition,
        ));
    }
    Ok(())
}

fn validate_command_actor(
    battle: &BattleState,
    command: &NormalizedBattleCommand,
) -> Result<(), ActionOrderError> {
    let slot = command.field_slot();
    let occupant = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == slot)
        .and_then(|entry| entry.occupant);
    if occupant != Some(command.actor()) {
        return Err(ActionOrderError::ActorMismatch {
            slot,
            actor: command.actor(),
        });
    }
    let pokemon = find_pokemon(battle, command.actor())?;
    if pokemon.fainted {
        return Err(ActionOrderError::FaintedActor {
            actor: command.actor(),
        });
    }
    Ok(())
}

fn build_switch_action(
    battle: &BattleState,
    command: &NormalizedBattleCommand,
) -> Result<PendingAction, ActionOrderError> {
    let NormalizedBattleCommand::Switch {
        operation_id,
        actor,
        field_slot,
        party_slot,
        incoming,
    } = command
    else {
        return Err(ActionOrderError::ActorMismatch {
            slot: command.field_slot(),
            actor: command.actor(),
        });
    };
    let actor_state = find_pokemon(battle, *actor)?;
    let party = party_for_side(battle, field_slot.side);
    let Some(destination) = party.get(usize::from(party_slot.get())) else {
        return Err(ActionOrderError::SwitchDestinationMismatch {
            actor: *actor,
            party_slot: *party_slot,
            incoming: *incoming,
        });
    };
    if destination.id != *incoming {
        return Err(ActionOrderError::SwitchDestinationMismatch {
            actor: *actor,
            party_slot: *party_slot,
            incoming: *incoming,
        });
    }
    if destination.fainted {
        return Err(ActionOrderError::SwitchDestinationFainted {
            incoming: *incoming,
        });
    }
    Ok(PendingAction {
        command: command.clone(),
        kind: ResolvedActionKind::Switch,
        actor: *actor,
        source_slot: *field_slot,
        command_operation_id: operation_id.clone(),
        move_slot: None,
        move_id: None,
        targets: Vec::new(),
        party_slot: Some(*party_slot),
        incoming: Some(*incoming),
        effective_speed: effective_speed(actor_state)?,
        timing_modifier: SWITCH_TIMING,
        move_priority: 0,
        bracket_modifier: SWITCH_BRACKET,
        tie_order: SafeU53::ZERO,
    })
}

fn build_move_action(
    battle: &BattleState,
    command: &NormalizedBattleCommand,
    content: &ContentPack,
) -> Result<PendingAction, ActionOrderError> {
    let NormalizedBattleCommand::Fight {
        operation_id,
        actor,
        field_slot,
        move_slot,
        move_id,
        targets,
    } = command
    else {
        return Err(ActionOrderError::ActorMismatch {
            slot: command.field_slot(),
            actor: command.actor(),
        });
    };
    let actor_state = find_pokemon(battle, *actor)?;
    let Some(slot) = actor_state
        .moves
        .get(usize::from(move_slot.get()))
        .and_then(|slot| slot.as_ref())
    else {
        return Err(ActionOrderError::MissingMoveSlot {
            actor: *actor,
            move_slot: *move_slot,
        });
    };
    if slot.move_id != *move_id {
        return Err(ActionOrderError::MoveIdentityMismatch {
            actor: *actor,
            move_slot: *move_slot,
            move_id: *move_id,
        });
    }
    let definition = find_move(&content.moves, *move_id)
        .map_err(|_| ActionOrderError::UnsupportedMove { move_id: *move_id })?;
    Ok(PendingAction {
        command: command.clone(),
        kind: ResolvedActionKind::Move,
        actor: *actor,
        source_slot: *field_slot,
        command_operation_id: operation_id.clone(),
        move_slot: Some(*move_slot),
        move_id: Some(*move_id),
        targets: targets.clone(),
        party_slot: None,
        incoming: None,
        effective_speed: effective_speed(actor_state)?,
        timing_modifier: NORMAL_MOVE_TIMING,
        move_priority: definition.priority,
        bracket_modifier: NORMAL_MOVE_BRACKET,
        tie_order: SafeU53::ZERO,
    })
}

fn reorder_actions(
    actions: &mut Vec<PendingAction>,
    is_move_queue: bool,
    battle: &BattleState,
    rng: &mut RngRuntime,
) -> Result<(), ActionOrderError> {
    if actions.is_empty() {
        return Ok(());
    }

    // Resolve all live values before opening the seed-offset transaction.  A
    // malformed state therefore cannot consume a speed-tie draw.
    for action in actions.as_slice() {
        effective_speed(find_pokemon(battle, action.actor)?)?;
    }

    let mut groups = consecutive_groups(actions);
    rng.speed_order_shuffle(&mut groups, &battle.wave_seed, battle.turn)
        .map_err(ActionOrderError::Rng)?;
    let mut shuffled = Vec::with_capacity(actions.len());
    for group in groups {
        shuffled.extend(group);
    }
    for action in &mut shuffled {
        action.effective_speed = effective_speed(find_pokemon(battle, action.actor)?)?;
    }

    // Slice::sort_by is stable.  Equal speeds compare equal, so the seeded
    // group order remains the only tie input.
    shuffled.sort_by_key(|action| Reverse(action.effective_speed));
    assign_tie_orders(&mut shuffled)?;

    if is_move_queue {
        // This is the exact post-speed comparator: timing, then move
        // priority, then bracket modifier, all descending.  No final key is
        // appended for actor, field slot, side, or command identity.
        shuffled.sort_by(|left, right| {
            right
                .timing_modifier
                .cmp(&left.timing_modifier)
                .then_with(|| right.move_priority.cmp(&left.move_priority))
                .then_with(|| right.bracket_modifier.cmp(&left.bracket_modifier))
        });
    }
    *actions = shuffled;
    Ok(())
}

fn consecutive_groups(actions: &[PendingAction]) -> Vec<Vec<PendingAction>> {
    let mut groups: Vec<Vec<PendingAction>> = Vec::new();
    for action in actions {
        let same_actor = groups
            .last()
            .and_then(|group| group.first())
            .is_some_and(|first| first.actor == action.actor);
        if same_actor && let Some(group) = groups.last_mut() {
            group.push(action.clone());
        } else {
            groups.push(vec![action.clone()]);
        }
    }
    groups
}

fn assign_tie_orders(actions: &mut [PendingAction]) -> Result<(), ActionOrderError> {
    let mut previous_speed = None;
    let mut previous_actor = None;
    let mut group_position = 0_u64;
    for action in actions {
        if previous_speed != Some(action.effective_speed) {
            group_position = 0;
        } else if previous_actor != Some(action.actor) {
            group_position = group_position
                .checked_add(1)
                .ok_or(ActionOrderError::TieOrderOverflow)?;
        }
        action.tie_order =
            SafeU53::new(group_position).map_err(|_| ActionOrderError::TieOrderOverflow)?;
        previous_speed = Some(action.effective_speed);
        previous_actor = Some(action.actor);
    }
    Ok(())
}

fn party_for_side(battle: &BattleState, side: BattleSide) -> &[PokemonState] {
    match side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    }
}

fn find_pokemon(battle: &BattleState, actor: PokemonId) -> Result<&PokemonState, ActionOrderError> {
    let mut found = None;
    for pokemon in battle.player_party.iter().chain(battle.enemy_party.iter()) {
        if pokemon.id == actor {
            if found.is_some() {
                return Err(ActionOrderError::UnknownActor { actor });
            }
            found = Some(pokemon);
        }
    }
    found.ok_or(ActionOrderError::UnknownActor { actor })
}
