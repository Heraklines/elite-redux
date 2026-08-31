//! Fail-closed command, target, switch, and forced-replacement legality.
//!
//! Every public entry point validates the complete mechanical state and exact
//! immutable content identity before inspecting a command. These functions
//! are pure: rejection cannot consume PP or advance either RNG stream.

use er_content::abilities::find_ability;
use er_content::moves::{MoveDefinition, find_move};
use er_content::pack::{ContentPack, ContentPackError};
use er_content::species::find_species;
use er_state::battle::{BattleOutcome, BattleState, FaintOccurrence, ReplacementProgress};
use er_state::pokemon::{PokemonState, PpValidationError, move_slot_is_usable, validate_move_slot};
use er_state::snapshot::GameState;
use er_state::validation::{StateValidationError, validate_game_state_for_content};
use er_types::OperationId;
use er_types::SeatId;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandError, BattleCommandOffer,
    BattleCommandProposalV1, BattleReplacementProposalV1, BattleTargetSelection,
    CommandFrontierEntry, CommandFrontierStatus, CommandSet, OfferedMoveCommand,
    OfferedSwitchCommand, ReplacementSelection,
};
use er_types::battle_ids::{
    AbilityId, BattleSide, FaintOccurrenceId, FieldSlot, MoveId, MoveSlotIndex, PartyIndex,
    PokemonId, SpeciesId,
};
use er_types::battle_model::{CapabilityStatus, CapabilitySubject, MoveTarget, StatusKind};
use thiserror::Error;

use crate::command::{NormalizedBattleCommand, NormalizedCommandSet};

/// A fail-closed legality or immutable-content validation failure.
#[derive(Debug, Error)]
pub enum CommandLegalityError {
    #[error("immutable content pack is invalid: {0}")]
    Content(#[from] ContentPackError),
    #[error("mechanical state is invalid: {0}")]
    State(#[from] StateValidationError),
    #[error("command DTO is invalid: {0}")]
    Command(#[from] BattleCommandError),
    #[error("there is no active battle")]
    MissingBattle,
    #[error("battle outcome {outcome:?} does not accept a command frontier")]
    BattleNotOngoing { outcome: BattleOutcome },
    #[error("field slot {slot:?} has no active Pokémon")]
    EmptyFieldSlot { slot: FieldSlot },
    #[error("command actor {actor:?} is not the current occupant of {slot:?}")]
    ActorMismatch { slot: FieldSlot, actor: PokemonId },
    #[error("command actor {actor:?} is fainted")]
    ActorFainted { actor: PokemonId },
    #[error("species {species:?} for Pokémon {pokemon:?} is absent from the content pack")]
    UnknownSpecies {
        pokemon: PokemonId,
        species: SpeciesId,
    },
    #[error("form {form_index} for Pokémon {pokemon:?} is outside the selected content pack")]
    UnsupportedForm { pokemon: PokemonId, form_index: u16 },
    #[error("effective typing for Pokémon {pokemon:?} is outside the selected content pack")]
    UnsupportedEffectiveTyping { pokemon: PokemonId },
    #[error("move {move_id:?} for Pokémon {pokemon:?} is absent from the content pack")]
    UnknownMove { pokemon: PokemonId, move_id: MoveId },
    #[error("ability {ability_id:?} for Pokémon {pokemon:?} is absent from the content pack")]
    UnknownAbility {
        pokemon: PokemonId,
        ability_id: AbilityId,
    },
    #[error("capability {subject:?} is not supported by the immutable content pack")]
    UnsupportedCapability { subject: CapabilitySubject },
    #[error("move slot {move_slot} for Pokémon {pokemon:?} has invalid PP: {source}")]
    InvalidPp {
        pokemon: PokemonId,
        move_slot: usize,
        #[source]
        source: PpValidationError,
    },
    #[error("field slot {slot:?} is not owned by a human seat")]
    HumanCommandRequired { slot: FieldSlot },
    #[error("field slot {slot:?} is not an enemy slot")]
    EnemyCommandRequired { slot: FieldSlot },
    #[error("actor {actor:?} has no supported legal Fight or Switch command")]
    NoLegalCommand { actor: PokemonId },
    #[error("command for actor {actor:?} was not in the exact current legal offer")]
    CommandNotOffered { actor: PokemonId },
    #[error("preserved command offer for {slot:?} is stale or not exact")]
    StaleOffer { slot: FieldSlot },
    #[error("scripted enemy offer for {slot:?} must contain exactly one command")]
    InvalidScriptedOffer { slot: FieldSlot },
    #[error("accepted command coordinates do not match the current battle frontier")]
    StaleCommandCoordinates,
    #[error("accepted command kind does not match field side {side:?}")]
    WrongAcceptedCommandKind { side: BattleSide },
    #[error("command operation {operation_id} has no current frontier entry")]
    MissingCommandFrontier { operation_id: OperationId },
    #[error("command frontier entry is retained but not admitted at resolution")]
    CommandNotAdmitted,
    #[error("command set does not exactly match the admitted canonical frontier")]
    CommandSetMismatch,
    #[error("a different command is already retained for this decision window")]
    ConflictingFrontierCommand,
    #[error("command frontier does not cover every living active actor exactly once")]
    IncompleteCommandFrontier,
    #[error("more than one switch command selects Pokémon {pokemon:?}")]
    DuplicateSwitchDestination { pokemon: PokemonId },
    #[error("an unresolved faint occurrence blocks command resolution")]
    UnresolvedFaint,
    #[error("internal slot index {index} is outside the frozen M3 bound")]
    SlotIndexInvariant { index: usize },
    #[error("faint occurrence {occurrence:?} is not the current forced-replacement head")]
    ReplacementNotCurrent { occurrence: FaintOccurrenceId },
    #[error("faint occurrence {occurrence:?} does not require a human replacement")]
    ReplacementNotRequired { occurrence: FaintOccurrenceId },
    #[error("replacement proposal coordinates do not match the stored faint occurrence")]
    StaleReplacementCoordinates,
    #[error("replacement selection is not one of the exact current same-owner candidates")]
    ReplacementNotOffered,
    #[error("NO_LEGAL_REPLACEMENT is invalid while a replacement candidate exists")]
    LegalReplacementExists,
}

/// Validate state-local invariants, exact content identity, selected content
/// membership, capability closure, and content-derived PP bounds.
pub fn validate_state_content(
    state: &GameState,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    content.validate()?;
    validate_state_content_trusted(state, content)
}

/// Validate state-local content membership after the immutable pack has
/// already been validated by its owning construction or restore boundary.
///
/// This deliberately skips [`ContentPack::validate`] and its canonical hash
/// recomputation.  Runtime transactions may use this narrower check because
/// they retain the same immutable `Arc<ContentPack>`; public/configuration and
/// snapshot boundaries must call [`validate_state_content`] instead.
#[doc(hidden)]
pub fn validate_state_content_trusted(
    state: &GameState,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_game_state_for_content(state, &content.hash)?;

    let Some(battle) = &state.battle else {
        return Ok(());
    };

    require_supported(
        content,
        CapabilitySubject::Weather(battle.weather.kind.clone()),
    )?;
    require_supported(
        content,
        CapabilitySubject::Terrain(battle.terrain.kind.clone()),
    )?;

    for pokemon in battle.player_party.iter().chain(&battle.enemy_party) {
        validate_pokemon_content(pokemon, content)?;
    }
    Ok(())
}

/// Build the complete deterministic offer for one human-controlled actor.
pub fn build_command_offer(
    state: &GameState,
    field_slot: FieldSlot,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    validate_state_content(state, content)?;
    build_command_offer_validated(state, field_slot, content)
}

/// Build a command offer after the enclosing immutable-content owner has
/// already validated the retained content pack.
#[doc(hidden)]
pub fn build_command_offer_trusted(
    state: &GameState,
    field_slot: FieldSlot,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    build_command_offer_validated(state, field_slot, content)
}

fn build_command_offer_validated(
    state: &GameState,
    field_slot: FieldSlot,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    let battle = active_ongoing_battle(state)?;
    if field_slot.side != BattleSide::Player {
        return Err(CommandLegalityError::HumanCommandRequired { slot: field_slot });
    }
    build_full_offer(battle, field_slot, content)
}

/// Build the exact singleton offer retained for a typed scripted-enemy
/// command after checking that command against ordinary mechanics legality.
pub fn build_scripted_enemy_offer(
    state: &GameState,
    field_slot: FieldSlot,
    command: &BattleCommand,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    validate_state_content(state, content)?;
    build_scripted_enemy_offer_validated(state, field_slot, command, content)
}

/// Build a scripted offer after the enclosing immutable-content owner has
/// already validated the retained content pack.
#[doc(hidden)]
pub fn build_scripted_enemy_offer_trusted(
    state: &GameState,
    field_slot: FieldSlot,
    command: &BattleCommand,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    build_scripted_enemy_offer_validated(state, field_slot, command, content)
}

fn build_scripted_enemy_offer_validated(
    state: &GameState,
    field_slot: FieldSlot,
    command: &BattleCommand,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    let battle = active_ongoing_battle(state)?;
    if field_slot.side != BattleSide::Enemy {
        return Err(CommandLegalityError::EnemyCommandRequired { slot: field_slot });
    }
    let actor = active_actor(battle, field_slot)?;
    ensure_command_in_full_offer(battle, field_slot, actor, command, content)?;
    singleton_offer_for_command(battle, field_slot, command)
}

/// Recompute and compare a retained command-frontier offer against current
/// state/content. Human offers are complete; enemy offers are one legal
/// scripted command.
pub fn validate_preserved_offer(
    state: &GameState,
    entry: &CommandFrontierEntry,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_state_content(state, content)?;
    validate_preserved_offer_validated(state, entry, content)
}

/// Validate a preserved offer after the enclosing immutable-content owner has
/// already validated the retained content pack.
#[doc(hidden)]
pub fn validate_preserved_offer_trusted(
    state: &GameState,
    entry: &CommandFrontierEntry,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    validate_preserved_offer_validated(state, entry, content)
}

fn validate_preserved_offer_validated(
    state: &GameState,
    entry: &CommandFrontierEntry,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    let battle = active_ongoing_battle(state)?;
    let current = battle
        .command_state
        .frontier
        .iter()
        .find(|current| current.operation_id == entry.operation_id)
        .ok_or_else(|| CommandLegalityError::MissingCommandFrontier {
            operation_id: entry.operation_id.clone(),
        })?;
    if current != entry {
        return Err(CommandLegalityError::StaleCommandCoordinates);
    }
    validate_preserved_offer_in_battle(battle, entry, content)
}

/// Validate one human proposal against its exact current frontier window and
/// return its mechanics-facing normalized command.
pub fn validate_command_proposal(
    state: &GameState,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
) -> Result<NormalizedBattleCommand, CommandLegalityError> {
    validate_state_content(state, content)?;
    validate_command_proposal_validated(state, proposal, content)
}

/// Validate a proposal after the enclosing immutable-content owner has
/// already validated the retained content pack.
#[doc(hidden)]
pub fn validate_command_proposal_trusted(
    state: &GameState,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
) -> Result<NormalizedBattleCommand, CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    validate_command_proposal_validated(state, proposal, content)
}

fn validate_command_proposal_validated(
    state: &GameState,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
) -> Result<NormalizedBattleCommand, CommandLegalityError> {
    proposal.validate()?;
    let battle = active_ongoing_battle(state)?;
    let entry = battle
        .command_state
        .frontier
        .iter()
        .find(|entry| entry.operation_id == proposal.operation_id)
        .ok_or_else(|| CommandLegalityError::MissingCommandFrontier {
            operation_id: proposal.operation_id.clone(),
        })?;
    validate_preserved_offer_in_battle(battle, entry, content)?;
    if entry.field_slot.side != BattleSide::Player
        || entry.actor != proposal.actor
        || entry.field_slot != proposal.field_slot
        || entry.owner_seat != Some(proposal.owner_seat)
        || proposal.battle_id != battle.battle_id
        || proposal.wave != battle.wave
        || proposal.turn != battle.turn
    {
        return Err(CommandLegalityError::StaleCommandCoordinates);
    }
    let accepted = AcceptedBattleCommand::human(proposal.clone());
    match &entry.status {
        CommandFrontierStatus::Pending => {}
        CommandFrontierStatus::Retained { command, .. }
        | CommandFrontierStatus::Admitted { command, .. }
            if command == &accepted => {}
        CommandFrontierStatus::Retained { .. } | CommandFrontierStatus::Admitted { .. } => {
            return Err(CommandLegalityError::ConflictingFrontierCommand);
        }
    }
    normalize_command_in_battle(
        battle,
        entry.field_slot,
        &proposal.command,
        proposal.operation_id.clone(),
        content,
    )
}

/// Revalidate a complete admitted command set immediately before mechanics
/// resolution. The returned set is concrete and canonical by field slot.
pub fn normalize_command_set(
    state: &GameState,
    commands: &CommandSet,
    content: &ContentPack,
) -> Result<NormalizedCommandSet, CommandLegalityError> {
    validate_state_content(state, content)?;
    normalize_command_set_validated(state, commands, content)
}

/// Normalize an admitted command set after the enclosing immutable-content
/// owner has already validated the retained content pack.
#[doc(hidden)]
pub fn normalize_command_set_trusted(
    state: &GameState,
    commands: &CommandSet,
    content: &ContentPack,
) -> Result<NormalizedCommandSet, CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    normalize_command_set_validated(state, commands, content)
}

fn normalize_command_set_validated(
    state: &GameState,
    commands: &CommandSet,
    content: &ContentPack,
) -> Result<NormalizedCommandSet, CommandLegalityError> {
    commands.validate()?;
    let battle = active_ongoing_battle(state)?;

    if battle
        .faint_queue
        .iter()
        .any(|occurrence| occurrence.replacement != ReplacementProgress::Applied)
    {
        return Err(CommandLegalityError::UnresolvedFaint);
    }

    let expected_slots = living_active_slots(battle)?;
    let has_player = expected_slots
        .iter()
        .any(|slot| slot.side == BattleSide::Player);
    let has_enemy = expected_slots
        .iter()
        .any(|slot| slot.side == BattleSide::Enemy);
    if !has_player
        || !has_enemy
        || battle.command_state.frontier.len() != expected_slots.len()
        || battle
            .command_state
            .frontier
            .iter()
            .zip(&expected_slots)
            .any(|(entry, expected)| entry.field_slot != *expected)
        || commands.entries.len() != battle.command_state.frontier.len()
    {
        return Err(CommandLegalityError::IncompleteCommandFrontier);
    }

    let mut normalized = Vec::with_capacity(commands.entries.len());
    for (entry, supplied) in battle.command_state.frontier.iter().zip(&commands.entries) {
        let CommandFrontierStatus::Admitted { command, .. } = &entry.status else {
            return Err(CommandLegalityError::CommandNotAdmitted);
        };
        if command != supplied {
            return Err(CommandLegalityError::CommandSetMismatch);
        }
        validate_preserved_offer_in_battle(battle, entry, content)?;
        normalized.push(normalize_accepted_in_battle(
            battle, entry, supplied, content,
        )?);
    }
    validate_unique_switch_destinations(&normalized)?;
    Ok(NormalizedCommandSet::new(normalized))
}

/// Return the exact canonical same-owner options for the current forced
/// replacement queue head.
pub fn build_replacement_offer(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    content: &ContentPack,
) -> Result<Vec<OfferedSwitchCommand>, CommandLegalityError> {
    validate_state_content(state, content)?;
    let battle = active_battle(state)?;
    let faint = current_replacement(battle, occurrence)?;
    replacement_candidates(battle, faint)
}

/// Validate either a selected forced replacement or the internal explicit
/// no-candidate decision. This function never accepts omission as a default.
pub fn validate_replacement_selection(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_state_content(state, content)?;
    validate_replacement_selection_validated(state, occurrence, selection)
}

/// Validate a replacement selection after the enclosing immutable-content
/// owner has already validated the retained content pack.
#[doc(hidden)]
pub fn validate_replacement_selection_trusted(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    validate_replacement_selection_validated(state, occurrence, selection)
}

fn validate_replacement_selection_validated(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
) -> Result<(), CommandLegalityError> {
    selection.validate_internal()?;
    let battle = active_battle(state)?;
    let faint = current_replacement(battle, occurrence)?;
    validate_replacement_selection_in_battle(battle, faint, selection)
}

/// Validate an external forced-replacement proposal against the stored queue
/// head, including both occurrence identities and the exact operation grammar.
pub fn validate_replacement_proposal(
    state: &GameState,
    proposal: &BattleReplacementProposalV1,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_state_content(state, content)?;
    validate_replacement_proposal_validated(state, proposal)
}

/// Validate a replacement proposal after the enclosing immutable-content
/// owner has already validated the retained content pack.
#[doc(hidden)]
pub fn validate_replacement_proposal_trusted(
    state: &GameState,
    proposal: &BattleReplacementProposalV1,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    validate_state_content_trusted(state, content)?;
    validate_replacement_proposal_validated(state, proposal)
}

fn validate_replacement_proposal_validated(
    state: &GameState,
    proposal: &BattleReplacementProposalV1,
) -> Result<(), CommandLegalityError> {
    let battle = active_battle(state)?;
    let faint = current_replacement(battle, proposal.occurrence)?;
    proposal.validate_with_epoch(faint.source.epoch)?;
    if proposal.battle_id != battle.battle_id
        || proposal.wave != faint.source.wave
        || proposal.resolved_turn != faint.source.resolved_turn
        || proposal.turn_occurrence != faint.source.turn_occurrence
        || proposal.field_slot != faint.slot
        || Some(proposal.owner_seat) != faint.owner_seat
    {
        return Err(CommandLegalityError::StaleReplacementCoordinates);
    }
    validate_replacement_selection_in_battle(battle, faint, &proposal.selection)
}

fn validate_pokemon_content(
    pokemon: &PokemonState,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    let species = find_species(&content.species, pokemon.species_id).map_err(|_| {
        CommandLegalityError::UnknownSpecies {
            pokemon: pokemon.id,
            species: pokemon.species_id,
        }
    })?;
    if pokemon.form_index != 0 {
        return Err(CommandLegalityError::UnsupportedForm {
            pokemon: pokemon.id,
            form_index: pokemon.form_index,
        });
    }
    if pokemon.types != species.base_types {
        return Err(CommandLegalityError::UnsupportedEffectiveTyping {
            pokemon: pokemon.id,
        });
    }

    validate_ability_content(pokemon.id, pokemon.abilities.active, content)?;
    for ability in pokemon.abilities.passives.into_iter().flatten() {
        validate_ability_content(pokemon.id, ability, content)?;
    }

    if pokemon.status.kind != StatusKind::None {
        require_supported(content, CapabilitySubject::Status(pokemon.status.kind))?;
    }

    for (move_slot, slot) in pokemon.moves.iter().enumerate() {
        let Some(slot) = slot else {
            continue;
        };
        let definition = find_move(&content.moves, slot.move_id).map_err(|_| {
            CommandLegalityError::UnknownMove {
                pokemon: pokemon.id,
                move_id: slot.move_id,
            }
        })?;
        require_supported(content, CapabilitySubject::Move(slot.move_id))?;
        validate_move_slot(slot, definition.base_pp).map_err(|source| {
            CommandLegalityError::InvalidPp {
                pokemon: pokemon.id,
                move_slot,
                source,
            }
        })?;
    }
    Ok(())
}

fn validate_ability_content(
    pokemon: PokemonId,
    ability_id: AbilityId,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    find_ability(&content.abilities, ability_id).map_err(|_| {
        CommandLegalityError::UnknownAbility {
            pokemon,
            ability_id,
        }
    })?;
    require_supported(content, CapabilitySubject::Ability(ability_id))
}

fn require_supported(
    content: &ContentPack,
    subject: CapabilitySubject,
) -> Result<(), CommandLegalityError> {
    let supported = content
        .capability_manifest
        .find(&subject)
        .is_some_and(|entry| matches!(&entry.status, CapabilityStatus::Supported));
    if supported {
        Ok(())
    } else {
        Err(CommandLegalityError::UnsupportedCapability { subject })
    }
}

fn active_battle(state: &GameState) -> Result<&BattleState, CommandLegalityError> {
    state
        .battle
        .as_ref()
        .ok_or(CommandLegalityError::MissingBattle)
}

fn active_ongoing_battle(state: &GameState) -> Result<&BattleState, CommandLegalityError> {
    let battle = active_battle(state)?;
    if battle.outcome == BattleOutcome::Ongoing {
        Ok(battle)
    } else {
        Err(CommandLegalityError::BattleNotOngoing {
            outcome: battle.outcome,
        })
    }
}

fn active_actor(
    battle: &BattleState,
    field_slot: FieldSlot,
) -> Result<&PokemonState, CommandLegalityError> {
    let actor_id = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == field_slot)
        .and_then(|entry| entry.occupant)
        .ok_or(CommandLegalityError::EmptyFieldSlot { slot: field_slot })?;
    let actor = find_pokemon(battle, field_slot.side, actor_id).ok_or(
        CommandLegalityError::ActorMismatch {
            slot: field_slot,
            actor: actor_id,
        },
    )?;
    if actor.fainted {
        return Err(CommandLegalityError::ActorFainted { actor: actor.id });
    }
    Ok(actor)
}

fn build_full_offer(
    battle: &BattleState,
    field_slot: FieldSlot,
    content: &ContentPack,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    let actor = active_actor(battle, field_slot)?;
    let mut fight = Vec::new();
    for (index, move_slot) in actor.moves.iter().enumerate() {
        let Some(move_slot) = move_slot else {
            continue;
        };
        let definition = find_move(&content.moves, move_slot.move_id).map_err(|_| {
            CommandLegalityError::UnknownMove {
                pokemon: actor.id,
                move_id: move_slot.move_id,
            }
        })?;
        let usable = move_slot_is_usable(move_slot, definition.base_pp).map_err(|source| {
            CommandLegalityError::InvalidPp {
                pokemon: actor.id,
                move_slot: index,
                source,
            }
        })?;
        if !usable {
            continue;
        }
        let legal_targets = legal_target_selections(battle, field_slot, definition);
        if legal_targets.is_empty() {
            continue;
        }
        let move_slot = MoveSlotIndex::new(
            u8::try_from(index).map_err(|_| CommandLegalityError::SlotIndexInvariant { index })?,
        )
        .map_err(|_| CommandLegalityError::SlotIndexInvariant { index })?;
        fight.push(OfferedMoveCommand::new(move_slot, legal_targets)?);
    }

    let switches = switch_candidates(battle, field_slot.side, actor.owner_seat)?;
    if fight.is_empty() && switches.is_empty() {
        return Err(CommandLegalityError::NoLegalCommand { actor: actor.id });
    }
    Ok(BattleCommandOffer::new(fight, switches)?)
}

fn legal_target_selections(
    battle: &BattleState,
    actor_slot: FieldSlot,
    definition: &MoveDefinition,
) -> Vec<BattleTargetSelection> {
    let candidates = canonical_target_candidates(battle, actor_slot, definition.target);
    if matches!(
        definition.target,
        MoveTarget::UserSide
            | MoveTarget::EnemySide
            | MoveTarget::BothSides
            | MoveTarget::Party
            | MoveTarget::Curse
    ) {
        return vec![BattleTargetSelection::Implicit];
    }
    if single_target_kind(definition.target) {
        return match candidates.as_slice() {
            [] => Vec::new(),
            [_] => vec![BattleTargetSelection::Implicit],
            _ => candidates
                .into_iter()
                .map(|target| BattleTargetSelection::Selected(vec![target]))
                .collect(),
        };
    }
    if candidates.is_empty() {
        Vec::new()
    } else {
        vec![BattleTargetSelection::Selected(candidates)]
    }
}

pub(crate) fn canonical_target_candidates(
    battle: &BattleState,
    actor_slot: FieldSlot,
    target_kind: MoveTarget,
) -> Vec<FieldSlot> {
    let mut candidates = battle
        .field
        .slots
        .iter()
        .filter_map(|entry| {
            if !slot_within_format_capacity(battle, entry.slot) {
                return None;
            }
            let is_actor = entry.slot == actor_slot;
            let same_side = entry.slot.side == actor_slot.side;
            let near = is_actor || are_adjacent(battle, actor_slot, entry.slot);
            let allowed = match target_kind {
                MoveTarget::User => is_actor,
                MoveTarget::Other | MoveTarget::AllOthers => !is_actor,
                MoveTarget::NearOther | MoveTarget::AllNearOthers => !is_actor && near,
                MoveTarget::NearEnemy
                | MoveTarget::AllNearEnemies
                | MoveTarget::RandomNearEnemy => !same_side && near,
                MoveTarget::AllEnemies => !same_side,
                MoveTarget::Attacker => !is_actor,
                MoveTarget::NearAlly => same_side && !is_actor && near,
                MoveTarget::Ally => same_side && !is_actor,
                MoveTarget::UserOrNearAlly => same_side && near,
                MoveTarget::UserAndAllies => same_side,
                MoveTarget::All => true,
                MoveTarget::UserSide
                | MoveTarget::EnemySide
                | MoveTarget::BothSides
                | MoveTarget::Party
                | MoveTarget::Curse => false,
            };
            if !allowed {
                return None;
            }
            let occupant = entry.occupant?;
            let pokemon = find_pokemon(battle, entry.slot.side, occupant)?;
            (!pokemon.fainted && pokemon.hp > 0).then_some(entry.slot)
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable();
    candidates
}

const fn single_target_kind(target: MoveTarget) -> bool {
    matches!(
        target,
        MoveTarget::User
            | MoveTarget::Other
            | MoveTarget::NearOther
            | MoveTarget::NearEnemy
            | MoveTarget::RandomNearEnemy
            | MoveTarget::Attacker
            | MoveTarget::NearAlly
            | MoveTarget::Ally
            | MoveTarget::UserOrNearAlly
    )
}

fn slot_within_format_capacity(battle: &BattleState, slot: FieldSlot) -> bool {
    let capacity = match slot.side {
        BattleSide::Player => battle.format.player_capacity,
        BattleSide::Enemy => battle.format.enemy_capacity,
    };
    slot.position < capacity
}

fn are_adjacent(battle: &BattleState, left: FieldSlot, right: FieldSlot) -> bool {
    battle.format.adjacency.iter().any(|edge| {
        (edge.first == left && edge.second == right) || (edge.first == right && edge.second == left)
    })
}

fn switch_candidates(
    battle: &BattleState,
    side: BattleSide,
    owner: Option<SeatId>,
) -> Result<Vec<OfferedSwitchCommand>, CommandLegalityError> {
    let mut candidates = Vec::new();
    for (index, pokemon) in party_for_side(battle, side).iter().enumerate() {
        if pokemon.owner_seat != owner || pokemon.fainted || is_on_field(battle, pokemon.id) {
            continue;
        }
        let party_slot = PartyIndex::new(
            u8::try_from(index).map_err(|_| CommandLegalityError::SlotIndexInvariant { index })?,
        )
        .map_err(|_| CommandLegalityError::SlotIndexInvariant { index })?;
        candidates.push(OfferedSwitchCommand::new(party_slot, pokemon.id));
    }
    Ok(candidates)
}

fn ensure_command_in_full_offer(
    battle: &BattleState,
    field_slot: FieldSlot,
    actor: &PokemonState,
    command: &BattleCommand,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    command.validate()?;
    if command.actor() != actor.id {
        return Err(CommandLegalityError::ActorMismatch {
            slot: field_slot,
            actor: command.actor(),
        });
    }
    let offer = build_full_offer(battle, field_slot, content)?;
    let offered = match command {
        BattleCommand::Fight {
            move_slot, targets, ..
        } => offer.fight.iter().any(|candidate| {
            candidate.move_slot == *move_slot && candidate.legal_targets.contains(targets)
        }),
        BattleCommand::Switch { party_slot, .. } => offer
            .switches
            .iter()
            .any(|candidate| candidate.party_slot == *party_slot),
    };
    if offered {
        Ok(())
    } else {
        Err(CommandLegalityError::CommandNotOffered { actor: actor.id })
    }
}

fn singleton_offer_for_command(
    battle: &BattleState,
    field_slot: FieldSlot,
    command: &BattleCommand,
) -> Result<BattleCommandOffer, CommandLegalityError> {
    match command {
        BattleCommand::Fight {
            move_slot, targets, ..
        } => Ok(BattleCommandOffer::new(
            vec![OfferedMoveCommand::new(*move_slot, vec![targets.clone()])?],
            Vec::new(),
        )?),
        BattleCommand::Switch { party_slot, .. } => {
            let incoming = party_for_side(battle, field_slot.side)
                .get(usize::from(party_slot.get()))
                .ok_or(CommandLegalityError::CommandNotOffered {
                    actor: command.actor(),
                })?;
            Ok(BattleCommandOffer::new(
                Vec::new(),
                vec![OfferedSwitchCommand::new(*party_slot, incoming.id)],
            )?)
        }
    }
}

fn command_from_scripted_offer(
    entry: &CommandFrontierEntry,
) -> Result<BattleCommand, CommandLegalityError> {
    let cardinality = entry.offer.switches.len()
        + entry
            .offer
            .fight
            .iter()
            .map(|offer| offer.legal_targets.len())
            .sum::<usize>();
    if cardinality != 1 {
        return Err(CommandLegalityError::InvalidScriptedOffer {
            slot: entry.field_slot,
        });
    }
    if let Some(switch) = entry.offer.switches.first() {
        return Ok(BattleCommand::Switch {
            actor: entry.actor,
            party_slot: switch.party_slot,
        });
    }
    let Some(move_offer) = entry.offer.fight.first() else {
        return Err(CommandLegalityError::InvalidScriptedOffer {
            slot: entry.field_slot,
        });
    };
    let Some(targets) = move_offer.legal_targets.first() else {
        return Err(CommandLegalityError::InvalidScriptedOffer {
            slot: entry.field_slot,
        });
    };
    Ok(BattleCommand::Fight {
        actor: entry.actor,
        move_slot: move_offer.move_slot,
        targets: targets.clone(),
    })
}

fn validate_preserved_offer_in_battle(
    battle: &BattleState,
    entry: &CommandFrontierEntry,
    content: &ContentPack,
) -> Result<(), CommandLegalityError> {
    let actor = active_actor(battle, entry.field_slot)?;
    if actor.id != entry.actor {
        return Err(CommandLegalityError::ActorMismatch {
            slot: entry.field_slot,
            actor: entry.actor,
        });
    }
    match entry.field_slot.side {
        BattleSide::Player => {
            let expected = build_full_offer(battle, entry.field_slot, content)?;
            if entry.offer == expected {
                Ok(())
            } else {
                Err(CommandLegalityError::StaleOffer {
                    slot: entry.field_slot,
                })
            }
        }
        BattleSide::Enemy => {
            let offered = command_from_scripted_offer(entry)?;
            ensure_command_in_full_offer(battle, entry.field_slot, actor, &offered, content)
                .map_err(|_| CommandLegalityError::StaleOffer {
                    slot: entry.field_slot,
                })?;
            let expected = singleton_offer_for_command(battle, entry.field_slot, &offered)?;
            if entry.offer == expected {
                Ok(())
            } else {
                Err(CommandLegalityError::StaleOffer {
                    slot: entry.field_slot,
                })
            }
        }
    }
}

fn normalize_accepted_in_battle(
    battle: &BattleState,
    entry: &CommandFrontierEntry,
    accepted: &AcceptedBattleCommand,
    content: &ContentPack,
) -> Result<NormalizedBattleCommand, CommandLegalityError> {
    accepted.validate()?;
    let (operation_id, command) = match accepted {
        AcceptedBattleCommand::Human { proposal, .. } => {
            if entry.field_slot.side != BattleSide::Player {
                return Err(CommandLegalityError::WrongAcceptedCommandKind {
                    side: entry.field_slot.side,
                });
            }
            if proposal.battle_id != battle.battle_id
                || proposal.wave != battle.wave
                || proposal.turn != battle.turn
                || proposal.actor != entry.actor
                || proposal.field_slot != entry.field_slot
                || Some(proposal.owner_seat) != entry.owner_seat
            {
                return Err(CommandLegalityError::StaleCommandCoordinates);
            }
            (&proposal.operation_id, &proposal.command)
        }
        AcceptedBattleCommand::ScriptedEnemy { command, .. } => {
            if entry.field_slot.side != BattleSide::Enemy {
                return Err(CommandLegalityError::WrongAcceptedCommandKind {
                    side: entry.field_slot.side,
                });
            }
            if command.battle_id != battle.battle_id
                || command.wave != battle.wave
                || command.turn != battle.turn
                || command.actor != entry.actor
                || command.field_slot != entry.field_slot
            {
                return Err(CommandLegalityError::StaleCommandCoordinates);
            }
            let offered = command_from_scripted_offer(entry)?;
            if command.command != offered {
                return Err(CommandLegalityError::CommandNotOffered { actor: entry.actor });
            }
            (&command.operation_id, &command.command)
        }
    };
    if operation_id != &entry.operation_id {
        return Err(CommandLegalityError::StaleCommandCoordinates);
    }
    normalize_command_in_battle(
        battle,
        entry.field_slot,
        command,
        operation_id.clone(),
        content,
    )
}

fn normalize_command_in_battle(
    battle: &BattleState,
    field_slot: FieldSlot,
    command: &BattleCommand,
    operation_id: OperationId,
    content: &ContentPack,
) -> Result<NormalizedBattleCommand, CommandLegalityError> {
    let actor = active_actor(battle, field_slot)?;
    ensure_command_in_full_offer(battle, field_slot, actor, command, content)?;
    match command {
        BattleCommand::Fight {
            move_slot, targets, ..
        } => {
            let slot = actor
                .moves
                .get(usize::from(move_slot.get()))
                .and_then(Option::as_ref)
                .ok_or(CommandLegalityError::CommandNotOffered { actor: actor.id })?;
            let definition = find_move(&content.moves, slot.move_id).map_err(|_| {
                CommandLegalityError::UnknownMove {
                    pokemon: actor.id,
                    move_id: slot.move_id,
                }
            })?;
            let concrete_targets = match targets {
                BattleTargetSelection::Implicit => {
                    canonical_target_candidates(battle, field_slot, definition.target)
                }
                BattleTargetSelection::Selected(targets) => targets.clone(),
            };
            Ok(NormalizedBattleCommand::fight(
                operation_id,
                actor.id,
                field_slot,
                *move_slot,
                slot.move_id,
                concrete_targets,
            ))
        }
        BattleCommand::Switch { party_slot, .. } => {
            let incoming = party_for_side(battle, field_slot.side)
                .get(usize::from(party_slot.get()))
                .ok_or(CommandLegalityError::CommandNotOffered { actor: actor.id })?;
            Ok(NormalizedBattleCommand::switch(
                operation_id,
                actor.id,
                field_slot,
                *party_slot,
                incoming.id,
            ))
        }
    }
}

fn living_active_slots(battle: &BattleState) -> Result<Vec<FieldSlot>, CommandLegalityError> {
    let mut slots = Vec::new();
    for entry in &battle.field.slots {
        let Some(occupant) = entry.occupant else {
            continue;
        };
        let pokemon = find_pokemon(battle, entry.slot.side, occupant).ok_or(
            CommandLegalityError::ActorMismatch {
                slot: entry.slot,
                actor: occupant,
            },
        )?;
        if pokemon.fainted {
            return Err(CommandLegalityError::UnresolvedFaint);
        }
        slots.push(entry.slot);
    }
    Ok(slots)
}

fn validate_unique_switch_destinations(
    commands: &[NormalizedBattleCommand],
) -> Result<(), CommandLegalityError> {
    let mut destinations = std::collections::BTreeSet::new();
    for command in commands {
        let NormalizedBattleCommand::Switch { incoming, .. } = command else {
            continue;
        };
        if !destinations.insert(*incoming) {
            return Err(CommandLegalityError::DuplicateSwitchDestination { pokemon: *incoming });
        }
    }
    Ok(())
}

fn current_replacement(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<&FaintOccurrence, CommandLegalityError> {
    let current = battle
        .faint_queue
        .iter()
        .find(|faint| faint.replacement != ReplacementProgress::Applied)
        .ok_or(CommandLegalityError::ReplacementNotCurrent { occurrence })?;
    if current.id != occurrence {
        return Err(CommandLegalityError::ReplacementNotCurrent { occurrence });
    }
    if current.replacement != ReplacementProgress::Pending
        || current.slot.side != BattleSide::Player
        || current.owner_seat.is_none()
    {
        return Err(CommandLegalityError::ReplacementNotRequired { occurrence });
    }
    Ok(current)
}

fn replacement_candidates(
    battle: &BattleState,
    faint: &FaintOccurrence,
) -> Result<Vec<OfferedSwitchCommand>, CommandLegalityError> {
    switch_candidates(battle, faint.slot.side, faint.owner_seat)
}

fn validate_replacement_selection_in_battle(
    battle: &BattleState,
    faint: &FaintOccurrence,
    selection: &ReplacementSelection,
) -> Result<(), CommandLegalityError> {
    let candidates = replacement_candidates(battle, faint)?;
    match selection {
        ReplacementSelection::Selected {
            party_slot,
            pokemon,
        } if candidates.iter().any(|candidate| {
            candidate.party_slot == *party_slot && candidate.pokemon == *pokemon
        }) =>
        {
            Ok(())
        }
        ReplacementSelection::Selected { .. } => Err(CommandLegalityError::ReplacementNotOffered),
        ReplacementSelection::NoLegalReplacement if candidates.is_empty() => Ok(()),
        ReplacementSelection::NoLegalReplacement => {
            Err(CommandLegalityError::LegalReplacementExists)
        }
    }
}

fn party_for_side(battle: &BattleState, side: BattleSide) -> &[PokemonState] {
    match side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    }
}

fn find_pokemon(battle: &BattleState, side: BattleSide, id: PokemonId) -> Option<&PokemonState> {
    party_for_side(battle, side)
        .iter()
        .find(|pokemon| pokemon.id == id)
}

fn is_on_field(battle: &BattleState, pokemon: PokemonId) -> bool {
    battle
        .field
        .slots
        .iter()
        .any(|entry| entry.occupant == Some(pokemon))
}
