//! M3A-08 owns canonical state invariant validation.

use std::collections::BTreeSet;

use er_rng::phaser::RngError;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandError, BattleCommandOffer,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus,
    validate_player_command_operation_id, validate_scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, ContentPackHash, FieldSlot, PartyIndex, PokemonId,
};
use er_types::{SafeU53, SeatId};
use thiserror::Error;

use crate::battle::{BattleOutcome, BattleState, FaintOccurrence, ReplacementProgress};
use crate::conditions::{ConditionStateError, validate_m3_conditions};
use crate::field::FieldStateError;
use crate::format::{
    FormatTopologyError, human_seats, owner_seat_for, validate_m3_supported, validate_slot,
};
use crate::pokemon::{PokemonState, PokemonStateError};
use crate::snapshot::{GAME_STATE_SCHEMA_VERSION, GameState};

const MAX_PARTY_SIZE: usize = 6;

#[derive(Debug, Error)]
pub enum StateValidationError {
    #[error("GameState schema version must be {expected}, got {actual}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("next_battle_id must be positive")]
    ZeroNextBattleId,
    #[error("an active battle_id must be positive")]
    ZeroBattleId,
    #[error("active battle {battle_id:?} exhausts the checked battle-ID allocator")]
    BattleIdAllocatorExhausted { battle_id: BattleId },
    #[error(
        "next_battle_id must be {expected:?} while battle {battle_id:?} is active, got {actual:?}"
    )]
    NextBattleIdMismatch {
        battle_id: BattleId,
        expected: BattleId,
        actual: BattleId,
    },
    #[error("game wave {game:?} does not match battle wave {battle:?}")]
    WaveMismatch {
        game: er_types::battle_ids::WaveIndex,
        battle: er_types::battle_ids::WaveIndex,
    },
    #[error("battle turn {battle:?} does not match battle RNG turn {rng:?}")]
    BattleRngTurnMismatch {
        battle: er_types::battle_ids::TurnIndex,
        rng: er_types::battle_ids::TurnIndex,
    },
    #[error("run RNG state is invalid: {0}")]
    RunRng(#[source] RngError),
    #[error("battle RNG state is invalid: {0}")]
    BattleRng(#[source] RngError),
    #[error("battle format is invalid: {0}")]
    Format(#[from] FormatTopologyError),
    #[error("field state is invalid: {0}")]
    Field(#[from] FieldStateError),
    #[error("field conditions are invalid: {0}")]
    Conditions(#[from] ConditionStateError),
    #[error("{side:?} party has {actual} members; the maximum is {maximum}")]
    PartyTooLarge {
        side: BattleSide,
        actual: usize,
        maximum: usize,
    },
    #[error("{side:?} party member {index} is invalid: {source}")]
    Pokemon {
        side: BattleSide,
        index: usize,
        #[source]
        source: PokemonStateError,
    },
    #[error("Pokémon ID {pokemon:?} appears more than once across both parties")]
    DuplicatePokemonId { pokemon: PokemonId },
    #[error("player Pokémon {pokemon:?} has invalid owner {owner:?}")]
    InvalidPlayerOwner {
        pokemon: PokemonId,
        owner: Option<SeatId>,
    },
    #[error("enemy Pokémon {pokemon:?} must not have a human owner")]
    EnemyHasOwner { pokemon: PokemonId, owner: SeatId },
    #[error("authority seat {seat:?} is not a human seat in this format")]
    InvalidAuthoritySeat { seat: SeatId },
    #[error("M3 authority seat must be {expected:?}, got {actual:?}")]
    AuthoritySeatMismatch { expected: SeatId, actual: SeatId },
    #[error("field occupant {pokemon:?} in {slot:?} is absent from the matching party")]
    MissingFieldOccupant { slot: FieldSlot, pokemon: PokemonId },
    #[error("field occupant {pokemon:?} in {slot:?} has owner {actual:?}, expected {expected:?}")]
    FieldOwnerMismatch {
        slot: FieldSlot,
        pokemon: PokemonId,
        expected: Option<SeatId>,
        actual: Option<SeatId>,
    },
    #[error("command collection is invalid: {0}")]
    Command(#[from] BattleCommandError),
    #[error("command actor {actor:?} is not the current occupant of {slot:?}")]
    CommandActorMismatch { slot: FieldSlot, actor: PokemonId },
    #[error("command actor {actor:?} is fainted")]
    CommandActorFainted { actor: PokemonId },
    #[error("command frontier owner {actual:?} for {slot:?} must be {expected:?}")]
    CommandOwnerMismatch {
        slot: FieldSlot,
        expected: Option<SeatId>,
        actual: Option<SeatId>,
    },
    #[error("accepted command coordinates do not match the current battle")]
    CommandCoordinateMismatch,
    #[error("accepted command source does not match authority-relative ownership")]
    CommandAuthoritySourceMismatch,
    #[error("accepted command for actor {actor:?} is absent from its preserved offer")]
    CommandNotOffered { actor: PokemonId },
    #[error("enemy command frontier entry must preserve exactly one scripted offer, got {actual}")]
    InvalidEnemyOfferCardinality { actual: usize },
    #[error("enemy command operation does not contain a canonical safe script cursor")]
    InvalidEnemyScriptCursor,
    #[error("move slot {slot} is empty for command actor {actor:?}")]
    EmptyCommandMoveSlot { actor: PokemonId, slot: u8 },
    #[error("party choice {slot} does not identify Pokémon {pokemon:?} on {side:?}")]
    InvalidPartyChoice {
        side: BattleSide,
        slot: u8,
        pokemon: PokemonId,
    },
    #[error("party choice Pokémon {pokemon:?} is fainted or already on the field")]
    UnavailablePartyChoice { pokemon: PokemonId },
    #[error("party choice Pokémon {pokemon:?} does not have owner {expected:?}")]
    PartyChoiceOwnerMismatch {
        pokemon: PokemonId,
        expected: Option<SeatId>,
    },
    #[error("terminal battle outcome cannot retain a live command frontier")]
    TerminalCommandFrontier,
    #[error("faint occurrence ID {id:?} appears more than once")]
    DuplicateFaintOccurrence {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("unresolved faint subject {pokemon:?} in {slot:?} appears more than once")]
    DuplicateUnresolvedFaint { slot: FieldSlot, pokemon: PokemonId },
    #[error("faint occurrence {id:?} has a zero authority epoch")]
    ZeroFaintAuthorityEpoch {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("faint occurrence ID {id:?} is not below allocator {next:?}")]
    FaintAllocatorMismatch {
        id: er_types::battle_ids::FaintOccurrenceId,
        next: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("faint queue is not in causal allocation/source order")]
    NonCausalFaintQueue,
    #[error("faint occurrence {id:?} does not belong to the current battle coordinates")]
    FaintCoordinateMismatch {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("faint occurrence {id:?} references a missing or non-fainted Pokémon")]
    InvalidFaintPokemon {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("faint occurrence {id:?} owner does not match its slot/Pokémon")]
    FaintOwnerMismatch {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("unapplied faint occurrence {id:?} is detached from its field occupant")]
    DetachedFaintOccurrence {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("applied faint occurrence {id:?} still occupies its old field slot")]
    AppliedFaintStillOccupiesField {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("fainted field occupant {pokemon:?} in {slot:?} has no unresolved faint occurrence")]
    FaintedFieldOccupantWithoutQueue { slot: FieldSlot, pokemon: PokemonId },
    #[error("faint occurrence {id:?} has invalid replacement progress for its side/party")]
    InvalidReplacementProgress {
        id: er_types::battle_ids::FaintOccurrenceId,
    },
    #[error("battle outcome {outcome:?} disagrees with living party state")]
    OutcomeMismatch { outcome: BattleOutcome },
    #[error("content hash mismatch: expected {expected}, got {actual}")]
    ContentHashMismatch {
        expected: ContentPackHash,
        actual: ContentPackHash,
    },
}

/// Validate every intrinsic GameState and BattleState invariant that does not
/// require immutable content definitions or endpoint protocol role state.
pub fn validate_game_state(state: &GameState) -> Result<(), StateValidationError> {
    if state.schema_version != GAME_STATE_SCHEMA_VERSION {
        return Err(StateValidationError::SchemaVersionMismatch {
            expected: GAME_STATE_SCHEMA_VERSION,
            actual: state.schema_version,
        });
    }
    if state.next_battle_id == BattleId::ZERO {
        return Err(StateValidationError::ZeroNextBattleId);
    }
    state
        .run_rng
        .rdg
        .validate()
        .map_err(StateValidationError::RunRng)?;

    if let Some(battle) = &state.battle {
        if battle.battle_id == BattleId::ZERO {
            return Err(StateValidationError::ZeroBattleId);
        }
        if state.wave != battle.wave {
            return Err(StateValidationError::WaveMismatch {
                game: state.wave,
                battle: battle.wave,
            });
        }
        let next = battle
            .battle_id
            .get()
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .map(BattleId::new)
            .ok_or(StateValidationError::BattleIdAllocatorExhausted {
                battle_id: battle.battle_id,
            })?;
        if state.next_battle_id != next {
            return Err(StateValidationError::NextBattleIdMismatch {
                battle_id: battle.battle_id,
                expected: next,
                actual: state.next_battle_id,
            });
        }
        validate_battle_state(battle)?;
    }
    Ok(())
}

/// Validate intrinsic state plus exact immutable-pack identity.
///
/// Species, move, ability, capability, and content-derived PP checks remain at
/// the higher layer that owns a concrete `ContentPack`; `er-state` deliberately
/// has no dependency on `er-content`.
pub fn validate_game_state_for_content(
    state: &GameState,
    expected_content_hash: &ContentPackHash,
) -> Result<(), StateValidationError> {
    validate_game_state(state)?;
    if &state.content_hash == expected_content_hash {
        Ok(())
    } else {
        Err(StateValidationError::ContentHashMismatch {
            expected: expected_content_hash.clone(),
            actual: state.content_hash.clone(),
        })
    }
}

pub fn validate_battle_state(battle: &BattleState) -> Result<(), StateValidationError> {
    if battle.battle_id == BattleId::ZERO {
        return Err(StateValidationError::ZeroBattleId);
    }
    validate_m3_supported(&battle.format)?;
    battle.field.validate_for_format(&battle.format)?;
    validate_m3_conditions(
        &battle.weather,
        &battle.terrain,
        &battle.arena_conditions,
        &battle.global_ability_suppression,
    )?;
    battle
        .battle_rng
        .validate()
        .map_err(StateValidationError::BattleRng)?;
    if battle.turn != battle.battle_rng.turn {
        return Err(StateValidationError::BattleRngTurnMismatch {
            battle: battle.turn,
            rng: battle.battle_rng.turn,
        });
    }

    let seats = human_seats(&battle.format)?;
    if !seats.contains(&battle.authority_seat) {
        return Err(StateValidationError::InvalidAuthoritySeat {
            seat: battle.authority_seat,
        });
    }
    let expected_authority =
        seats
            .first()
            .copied()
            .ok_or(StateValidationError::InvalidAuthoritySeat {
                seat: battle.authority_seat,
            })?;
    if battle.authority_seat != expected_authority {
        return Err(StateValidationError::AuthoritySeatMismatch {
            expected: expected_authority,
            actual: battle.authority_seat,
        });
    }

    validate_party_sizes(battle)?;
    validate_parties(battle, &seats)?;
    validate_field_occupants(battle)?;
    validate_command_collection(battle)?;
    validate_faint_queue(battle)?;
    validate_outcome(battle)?;
    Ok(())
}

fn validate_party_sizes(battle: &BattleState) -> Result<(), StateValidationError> {
    for (side, party) in [
        (BattleSide::Player, battle.player_party.as_slice()),
        (BattleSide::Enemy, battle.enemy_party.as_slice()),
    ] {
        if party.len() > MAX_PARTY_SIZE {
            return Err(StateValidationError::PartyTooLarge {
                side,
                actual: party.len(),
                maximum: MAX_PARTY_SIZE,
            });
        }
    }
    Ok(())
}

fn validate_parties(battle: &BattleState, seats: &[SeatId]) -> Result<(), StateValidationError> {
    let mut ids = BTreeSet::new();
    for (side, party) in [
        (BattleSide::Player, battle.player_party.as_slice()),
        (BattleSide::Enemy, battle.enemy_party.as_slice()),
    ] {
        for (index, pokemon) in party.iter().enumerate() {
            pokemon
                .validate()
                .map_err(|source| StateValidationError::Pokemon {
                    side,
                    index,
                    source,
                })?;
            if !ids.insert(pokemon.id) {
                return Err(StateValidationError::DuplicatePokemonId {
                    pokemon: pokemon.id,
                });
            }
            match (side, pokemon.owner_seat) {
                (BattleSide::Player, Some(owner)) if seats.contains(&owner) => {}
                (BattleSide::Player, owner) => {
                    return Err(StateValidationError::InvalidPlayerOwner {
                        pokemon: pokemon.id,
                        owner,
                    });
                }
                (BattleSide::Enemy, Some(owner)) => {
                    return Err(StateValidationError::EnemyHasOwner {
                        pokemon: pokemon.id,
                        owner,
                    });
                }
                (BattleSide::Enemy, None) => {}
            }
        }
    }
    Ok(())
}

fn validate_field_occupants(battle: &BattleState) -> Result<(), StateValidationError> {
    for entry in &battle.field.slots {
        let Some(id) = entry.occupant else {
            continue;
        };
        let pokemon = find_pokemon(battle, entry.slot.side, id).ok_or(
            StateValidationError::MissingFieldOccupant {
                slot: entry.slot,
                pokemon: id,
            },
        )?;
        let expected = owner_seat_for(&battle.format, entry.slot)?;
        if pokemon.owner_seat != expected {
            return Err(StateValidationError::FieldOwnerMismatch {
                slot: entry.slot,
                pokemon: id,
                expected,
                actual: pokemon.owner_seat,
            });
        }
    }
    Ok(())
}

fn validate_command_collection(battle: &BattleState) -> Result<(), StateValidationError> {
    battle.command_state.validate()?;
    if battle.outcome != BattleOutcome::Ongoing && !battle.command_state.frontier.is_empty() {
        return Err(StateValidationError::TerminalCommandFrontier);
    }
    for entry in &battle.command_state.frontier {
        validate_command_entry(battle, entry)?;
    }
    Ok(())
}

fn validate_command_entry(
    battle: &BattleState,
    entry: &CommandFrontierEntry,
) -> Result<(), StateValidationError> {
    validate_slot(&battle.format, entry.field_slot)?;
    if battle.field.occupant(&battle.format, entry.field_slot)? != Some(entry.actor) {
        return Err(StateValidationError::CommandActorMismatch {
            slot: entry.field_slot,
            actor: entry.actor,
        });
    }
    let expected_owner = owner_seat_for(&battle.format, entry.field_slot)?;
    if entry.owner_seat != expected_owner {
        return Err(StateValidationError::CommandOwnerMismatch {
            slot: entry.field_slot,
            expected: expected_owner,
            actual: entry.owner_seat,
        });
    }

    match entry.field_slot.side {
        BattleSide::Player => validate_player_command_operation_id(
            &entry.operation_id,
            battle.battle_id,
            battle.wave,
            battle.turn,
            entry.field_slot,
            expected_owner.ok_or(StateValidationError::CommandOwnerMismatch {
                slot: entry.field_slot,
                expected: expected_owner,
                actual: entry.owner_seat,
            })?,
        )?,
        BattleSide::Enemy => {
            let cursor = match accepted_command(&entry.status).map(|(command, _)| command) {
                Some(AcceptedBattleCommand::ScriptedEnemy { command, .. }) => command.script_cursor,
                Some(AcceptedBattleCommand::Human { .. }) => {
                    return Err(StateValidationError::CommandAuthoritySourceMismatch);
                }
                None => parse_enemy_cursor(entry.operation_id.as_str())?,
            };
            validate_scripted_enemy_command_operation_id(
                &entry.operation_id,
                battle.battle_id,
                battle.wave,
                battle.turn,
                entry.field_slot,
                cursor,
            )?;
        }
    }

    let actor = find_pokemon(battle, entry.field_slot.side, entry.actor).ok_or(
        StateValidationError::CommandActorMismatch {
            slot: entry.field_slot,
            actor: entry.actor,
        },
    )?;
    if actor.fainted {
        return Err(StateValidationError::CommandActorFainted { actor: actor.id });
    }
    validate_offer(
        battle,
        entry.field_slot.side,
        expected_owner,
        actor,
        &entry.offer,
    )?;
    if entry.field_slot.side == BattleSide::Enemy {
        let offered_commands = entry.offer.switches.len()
            + entry
                .offer
                .fight
                .iter()
                .map(|offer| offer.legal_targets.len())
                .sum::<usize>();
        if offered_commands != 1 {
            return Err(StateValidationError::InvalidEnemyOfferCardinality {
                actual: offered_commands,
            });
        }
    }

    if let Some((accepted, source)) = accepted_command(&entry.status) {
        validate_accepted_context(battle, entry, accepted, source)?;
        match accepted {
            AcceptedBattleCommand::Human { proposal, .. } => validate_battle_command(
                battle,
                entry.field_slot.side,
                expected_owner,
                actor,
                &entry.offer,
                &proposal.command,
            )?,
            AcceptedBattleCommand::ScriptedEnemy { command, .. } => validate_battle_command(
                battle,
                entry.field_slot.side,
                expected_owner,
                actor,
                &entry.offer,
                &command.command,
            )?,
        }
    }
    Ok(())
}

fn accepted_command(
    status: &CommandFrontierStatus,
) -> Option<(&AcceptedBattleCommand, CommandAdmissionSource)> {
    match status {
        CommandFrontierStatus::Pending => None,
        CommandFrontierStatus::Retained { command, source }
        | CommandFrontierStatus::Admitted { command, source } => Some((command, *source)),
    }
}

fn validate_accepted_context(
    battle: &BattleState,
    entry: &CommandFrontierEntry,
    accepted: &AcceptedBattleCommand,
    source: CommandAdmissionSource,
) -> Result<(), StateValidationError> {
    match accepted {
        AcceptedBattleCommand::Human { proposal, .. } => {
            if proposal.battle_id != battle.battle_id
                || proposal.wave != battle.wave
                || proposal.turn != battle.turn
                || Some(proposal.owner_seat) != entry.owner_seat
            {
                return Err(StateValidationError::CommandCoordinateMismatch);
            }
            let expected_source = if proposal.owner_seat == battle.authority_seat {
                CommandAdmissionSource::AuthorityLocalInternal
            } else {
                CommandAdmissionSource::AuthorityRemoteProposal
            };
            if source != expected_source {
                return Err(StateValidationError::CommandAuthoritySourceMismatch);
            }
        }
        AcceptedBattleCommand::ScriptedEnemy { command, .. } => {
            if command.battle_id != battle.battle_id
                || command.wave != battle.wave
                || command.turn != battle.turn
                || source != CommandAdmissionSource::ScriptedEnemy
            {
                return Err(StateValidationError::CommandCoordinateMismatch);
            }
        }
    }
    Ok(())
}

fn validate_offer(
    battle: &BattleState,
    side: BattleSide,
    owner: Option<SeatId>,
    actor: &PokemonState,
    offer: &BattleCommandOffer,
) -> Result<(), StateValidationError> {
    for move_offer in &offer.fight {
        let index = usize::from(move_offer.move_slot.get());
        if actor.moves.get(index).and_then(Option::as_ref).is_none() {
            return Err(StateValidationError::EmptyCommandMoveSlot {
                actor: actor.id,
                slot: move_offer.move_slot.get(),
            });
        }
        for targets in &move_offer.legal_targets {
            validate_targets(&battle.format, targets)?;
        }
    }
    for switch in &offer.switches {
        validate_party_choice(battle, side, owner, switch.party_slot, switch.pokemon)?;
    }
    Ok(())
}

fn validate_battle_command(
    battle: &BattleState,
    side: BattleSide,
    owner: Option<SeatId>,
    actor: &PokemonState,
    offer: &BattleCommandOffer,
    command: &BattleCommand,
) -> Result<(), StateValidationError> {
    match command {
        BattleCommand::Fight {
            actor: command_actor,
            move_slot,
            targets,
        } => {
            if *command_actor != actor.id {
                return Err(StateValidationError::CommandActorMismatch {
                    slot: field_slot_for_actor(battle, actor.id)
                        .unwrap_or(FieldSlot { side, position: 0 }),
                    actor: *command_actor,
                });
            }
            if actor
                .moves
                .get(usize::from(move_slot.get()))
                .and_then(Option::as_ref)
                .is_none()
            {
                return Err(StateValidationError::EmptyCommandMoveSlot {
                    actor: actor.id,
                    slot: move_slot.get(),
                });
            }
            validate_targets(&battle.format, targets)?;
            if !offer.fight.iter().any(|offered| {
                offered.move_slot == *move_slot && offered.legal_targets.contains(targets)
            }) {
                return Err(StateValidationError::CommandNotOffered { actor: actor.id });
            }
            Ok(())
        }
        BattleCommand::Switch {
            actor: command_actor,
            party_slot,
        } => {
            if *command_actor != actor.id {
                return Err(StateValidationError::CommandActorMismatch {
                    slot: field_slot_for_actor(battle, actor.id)
                        .unwrap_or(FieldSlot { side, position: 0 }),
                    actor: *command_actor,
                });
            }
            let party = party_for_side(battle, side);
            let selected = party.get(usize::from(party_slot.get())).ok_or(
                StateValidationError::InvalidPartyChoice {
                    side,
                    slot: party_slot.get(),
                    pokemon: PokemonId::ZERO,
                },
            )?;
            validate_party_choice(battle, side, owner, *party_slot, selected.id)?;
            if !offer
                .switches
                .iter()
                .any(|offered| offered.party_slot == *party_slot && offered.pokemon == selected.id)
            {
                return Err(StateValidationError::CommandNotOffered { actor: actor.id });
            }
            Ok(())
        }
    }
}

fn validate_targets(
    format: &crate::format::BattleFormat,
    targets: &BattleTargetSelection,
) -> Result<(), StateValidationError> {
    if let BattleTargetSelection::Selected(targets) = targets {
        for target in targets {
            validate_slot(format, *target)?;
        }
    }
    Ok(())
}

fn validate_party_choice(
    battle: &BattleState,
    side: BattleSide,
    owner: Option<SeatId>,
    party_slot: PartyIndex,
    pokemon: PokemonId,
) -> Result<(), StateValidationError> {
    let selected = party_for_side(battle, side)
        .get(usize::from(party_slot.get()))
        .filter(|selected| selected.id == pokemon)
        .ok_or(StateValidationError::InvalidPartyChoice {
            side,
            slot: party_slot.get(),
            pokemon,
        })?;
    if selected.owner_seat != owner {
        return Err(StateValidationError::PartyChoiceOwnerMismatch {
            pokemon,
            expected: owner,
        });
    }
    if selected.fainted || field_slot_for_actor(battle, pokemon).is_some() {
        return Err(StateValidationError::UnavailablePartyChoice { pokemon });
    }
    Ok(())
}

fn parse_enemy_cursor(operation: &str) -> Result<SafeU53, StateValidationError> {
    let value = operation
        .rsplit('/')
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(StateValidationError::InvalidEnemyScriptCursor)?;
    Ok(value)
}

fn validate_faint_queue(battle: &BattleState) -> Result<(), StateValidationError> {
    let mut ids = BTreeSet::new();
    let mut unresolved_subjects = BTreeSet::new();
    let mut previous: Option<&FaintOccurrence> = None;
    for occurrence in &battle.faint_queue {
        if !ids.insert(occurrence.id) {
            return Err(StateValidationError::DuplicateFaintOccurrence { id: occurrence.id });
        }
        if occurrence.source.epoch == AuthorityEpoch::ZERO {
            return Err(StateValidationError::ZeroFaintAuthorityEpoch { id: occurrence.id });
        }
        if occurrence.replacement != ReplacementProgress::Applied
            && !unresolved_subjects.insert((occurrence.slot, occurrence.pokemon))
        {
            return Err(StateValidationError::DuplicateUnresolvedFaint {
                slot: occurrence.slot,
                pokemon: occurrence.pokemon,
            });
        }
        if occurrence.id >= battle.next_faint_occurrence {
            return Err(StateValidationError::FaintAllocatorMismatch {
                id: occurrence.id,
                next: battle.next_faint_occurrence,
            });
        }
        if let Some(previous) = previous
            && (previous.id >= occurrence.id
                || previous.source.resolved_turn > occurrence.source.resolved_turn
                || (previous.source.resolved_turn == occurrence.source.resolved_turn
                    && previous.source.turn_occurrence >= occurrence.source.turn_occurrence))
        {
            return Err(StateValidationError::NonCausalFaintQueue);
        }
        previous = Some(occurrence);

        if occurrence.source.wave != battle.wave
            || occurrence.source.resolved_turn > battle.turn
            || validate_slot(&battle.format, occurrence.slot).is_err()
        {
            return Err(StateValidationError::FaintCoordinateMismatch { id: occurrence.id });
        }
        let Some(pokemon) = find_pokemon(battle, occurrence.slot.side, occurrence.pokemon) else {
            return Err(StateValidationError::InvalidFaintPokemon { id: occurrence.id });
        };
        if !pokemon.fainted {
            return Err(StateValidationError::InvalidFaintPokemon { id: occurrence.id });
        }
        let expected_owner = owner_seat_for(&battle.format, occurrence.slot)?;
        if occurrence.owner_seat != expected_owner || pokemon.owner_seat != expected_owner {
            return Err(StateValidationError::FaintOwnerMismatch { id: occurrence.id });
        }
        let occupant = battle.field.occupant(&battle.format, occurrence.slot)?;
        if occurrence.replacement == ReplacementProgress::Applied {
            if occupant == Some(occurrence.pokemon) {
                return Err(StateValidationError::AppliedFaintStillOccupiesField {
                    id: occurrence.id,
                });
            }
        } else if occupant != Some(occurrence.pokemon) {
            return Err(StateValidationError::DetachedFaintOccurrence { id: occurrence.id });
        }
        validate_replacement_progress(battle, occurrence, expected_owner)?;
    }
    for entry in &battle.field.slots {
        let Some(pokemon_id) = entry.occupant else {
            continue;
        };
        let pokemon = find_pokemon(battle, entry.slot.side, pokemon_id).ok_or(
            StateValidationError::MissingFieldOccupant {
                slot: entry.slot,
                pokemon: pokemon_id,
            },
        )?;
        if pokemon.fainted
            && !battle.faint_queue.iter().any(|occurrence| {
                occurrence.slot == entry.slot
                    && occurrence.pokemon == pokemon_id
                    && occurrence.replacement != ReplacementProgress::Applied
            })
        {
            return Err(StateValidationError::FaintedFieldOccupantWithoutQueue {
                slot: entry.slot,
                pokemon: pokemon_id,
            });
        }
    }
    Ok(())
}

fn validate_replacement_progress(
    battle: &BattleState,
    occurrence: &FaintOccurrence,
    owner: Option<SeatId>,
) -> Result<(), StateValidationError> {
    match occurrence.replacement {
        ReplacementProgress::Pending if occurrence.slot.side == BattleSide::Player => Ok(()),
        ReplacementProgress::Selected {
            party_slot,
            pokemon,
        } if occurrence.slot.side == BattleSide::Player => {
            validate_party_choice(battle, BattleSide::Player, owner, party_slot, pokemon)
        }
        ReplacementProgress::NoLegalReplacement
            if occurrence.slot.side == BattleSide::Player
                && !has_legal_replacement(battle, owner) =>
        {
            Ok(())
        }
        ReplacementProgress::NotRequired
            if occurrence.slot.side == BattleSide::Enemy && owner.is_none() =>
        {
            Ok(())
        }
        ReplacementProgress::Applied => Ok(()),
        _ => Err(StateValidationError::InvalidReplacementProgress { id: occurrence.id }),
    }
}

fn has_legal_replacement(battle: &BattleState, owner: Option<SeatId>) -> bool {
    battle.player_party.iter().any(|pokemon| {
        pokemon.owner_seat == owner
            && !pokemon.fainted
            && field_slot_for_actor(battle, pokemon.id).is_none()
    })
}

fn validate_outcome(battle: &BattleState) -> Result<(), StateValidationError> {
    let player_alive = battle.player_party.iter().any(|pokemon| !pokemon.fainted);
    let enemy_alive = battle.enemy_party.iter().any(|pokemon| !pokemon.fainted);
    let unresolved_player_replacement = battle.faint_queue.iter().any(|occurrence| {
        occurrence.slot.side == BattleSide::Player
            && occurrence.replacement != ReplacementProgress::Applied
    });
    let valid = match battle.outcome {
        BattleOutcome::Ongoing => {
            (player_alive && enemy_alive) || (!player_alive && unresolved_player_replacement)
        }
        BattleOutcome::Victory => player_alive && !enemy_alive,
        BattleOutcome::Defeat => !player_alive && !unresolved_player_replacement,
    };
    if valid {
        Ok(())
    } else {
        Err(StateValidationError::OutcomeMismatch {
            outcome: battle.outcome,
        })
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

fn field_slot_for_actor(battle: &BattleState, id: PokemonId) -> Option<FieldSlot> {
    battle
        .field
        .slots
        .iter()
        .find(|entry| entry.occupant == Some(id))
        .map(|entry| entry.slot)
}
