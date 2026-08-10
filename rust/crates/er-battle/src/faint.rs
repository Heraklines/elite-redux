//! Causal faint discovery and the closed battle faint queue.
//!
//! This module is deliberately smaller than turn orchestration.  It accepts a
//! target that has already reached zero HP, validates that target against the
//! canonical field and party, allocates the diagnostic queue identity, and
//! records the supplied causal order.  It does not remove a fainted occupant
//! from the field; that is the replacement lane's resolution step.

use std::collections::HashSet;

use er_state::battle::BattleState;
use er_state::field::FieldStateError;
use er_state::format::{FormatTopologyError, owner_seat_for, validate_slot};
use er_state::pokemon::PokemonState;
use er_types::battle_ids::{
    AuthorityEpoch, BattleSide, FaintOccurrenceId, FieldSlot, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{FaintOccurrence, FaintSource, ReplacementProgress};
use er_types::{SafeU53, SeatId};
use thiserror::Error;

use crate::move_effect::FaintRequest;
use crate::resolver::BattleMutation;

/// The narrow target identity shared by move damage and residual damage.
///
/// Damage and status pipelines own their own provenance.  Queue insertion only
/// needs the exact canonical target identity and slot, so it must not grow a
/// second command or wire DTO.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct FaintCandidate {
    pub pokemon: PokemonId,
    pub slot: FieldSlot,
}

impl FaintCandidate {
    pub const fn new(pokemon: PokemonId, slot: FieldSlot) -> Self {
        Self { pokemon, slot }
    }
}

impl From<&FaintRequest> for FaintCandidate {
    fn from(request: &FaintRequest) -> Self {
        Self::new(request.pokemon, request.slot)
    }
}

/// Evidence for one successful queue insertion.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FaintQueueResult {
    pub occurrence: FaintOccurrence,
    pub mutation: BattleMutation,
}

/// Fail-closed errors from faint candidate validation and queue allocation.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FaintQueueError {
    #[error("faint field is invalid: {source}")]
    InvalidField {
        #[source]
        source: FieldStateError,
    },
    #[error("faint candidate slot {slot:?} has invalid topology: {source}")]
    InvalidSlot {
        slot: FieldSlot,
        #[source]
        source: FormatTopologyError,
    },
    #[error("faint candidate slot {slot:?} is absent from the canonical field")]
    CandidateSlotMissing { slot: FieldSlot },
    #[error("faint candidate slot {slot:?} is empty")]
    CandidateSlotEmpty { slot: FieldSlot },
    #[error("faint candidate Pokémon {pokemon:?} does not occupy its supplied slot {slot:?}")]
    CandidateActorMismatch { slot: FieldSlot, pokemon: PokemonId },
    #[error("faint candidate Pokémon {pokemon:?} is absent from the {side:?} party")]
    CandidatePartyMissing {
        pokemon: PokemonId,
        side: BattleSide,
    },
    #[error("faint candidate Pokémon {pokemon:?} appears more than once in its party")]
    CandidatePartyDuplicate { pokemon: PokemonId },
    #[error("faint candidate Pokémon {pokemon:?} has owner {actual:?}, expected {expected:?}")]
    CandidateOwnerMismatch {
        pokemon: PokemonId,
        actual: Option<SeatId>,
        expected: Option<SeatId>,
    },
    #[error("faint candidate Pokémon {pokemon:?} has nonzero HP {hp}")]
    CandidateHpNonZero { pokemon: PokemonId, hp: u32 },
    #[error("faint candidate Pokémon {pokemon:?} is not marked fainted")]
    CandidateNotFainted { pokemon: PokemonId },
    #[error("faint candidate Pokémon {pokemon:?} in {slot:?} already has an unresolved occurrence")]
    CandidateAlreadyQueued { pokemon: PokemonId, slot: FieldSlot },
    #[error("faint occurrence allocator is exhausted at {next:?}")]
    OccurrenceAllocatorExhausted { next: FaintOccurrenceId },
    #[error("faint source turn occurrence overflowed u32")]
    TurnOccurrenceOverflow,
    #[error("faint source wave/turn does not match the current battle")]
    SourceCoordinateMismatch { wave: WaveIndex, turn: TurnIndex },
    #[error("faint queue contains duplicate occurrence {id:?}")]
    DuplicateQueueOccurrence { id: FaintOccurrenceId },
    #[error("faint queue contains duplicate unresolved subject {pokemon:?} in {slot:?}")]
    DuplicateQueueSubject { slot: FieldSlot, pokemon: PokemonId },
    #[error("faint authority epoch must be greater than zero")]
    ZeroAuthorityEpoch,
    #[error("faint queue occurrence {id:?} is not below allocator {next:?}")]
    QueueAllocatorMismatch {
        id: FaintOccurrenceId,
        next: FaintOccurrenceId,
    },
    #[error("faint queue is not in supplied causal order")]
    NonCausalQueue,
    #[error("stored faint occurrence {id:?} is not canonical")]
    InvalidStoredOccurrence { id: FaintOccurrenceId },
}

/// Validate one already-zero-HP target without changing the battle.
pub fn validate_faint_candidate(
    battle: &BattleState,
    candidate: FaintCandidate,
) -> Result<(), FaintQueueError> {
    validate_queue_shape(battle)?;
    validate_candidate_against(battle, &battle.faint_queue, candidate)
}

/// Queue one move or residual faint with an exact authenticated epoch and
/// source-local turn occurrence.
pub fn queue_faint(
    battle: &mut BattleState,
    candidate: FaintCandidate,
    authority_epoch: AuthorityEpoch,
    turn_occurrence: u32,
) -> Result<FaintQueueResult, FaintQueueError> {
    let mut results = queue_faints(
        battle,
        std::slice::from_ref(&candidate),
        authority_epoch,
        turn_occurrence,
    )?;
    match results.pop() {
        Some(result) => Ok(result),
        None => Err(FaintQueueError::TurnOccurrenceOverflow),
    }
}

/// Queue a causal batch in exactly the supplied slice order.
///
/// `first_turn_occurrence` is the zero-based source-local occurrence assigned
/// to the first candidate.  Subsequent candidates use checked increments; the
/// global `next_faint_occurrence` allocator remains independent.
pub fn queue_faints(
    battle: &mut BattleState,
    candidates: &[FaintCandidate],
    authority_epoch: AuthorityEpoch,
    first_turn_occurrence: u32,
) -> Result<Vec<FaintQueueResult>, FaintQueueError> {
    if authority_epoch == AuthorityEpoch::ZERO {
        return Err(FaintQueueError::ZeroAuthorityEpoch);
    }
    validate_queue_shape(battle)?;

    let mut working_queue = battle.faint_queue.clone();
    let mut working_next = battle.next_faint_occurrence;
    let mut occurrences = Vec::with_capacity(candidates.len());

    for (index, candidate) in candidates.iter().copied().enumerate() {
        let offset = u32::try_from(index).map_err(|_| FaintQueueError::TurnOccurrenceOverflow)?;
        let turn_occurrence = first_turn_occurrence
            .checked_add(offset)
            .ok_or(FaintQueueError::TurnOccurrenceOverflow)?;
        validate_candidate_against(battle, &working_queue, candidate)?;

        let id = working_next;
        let next_value = id
            .get()
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .map(FaintOccurrenceId::new)
            .ok_or(FaintQueueError::OccurrenceAllocatorExhausted { next: id })?;
        let owner_seat = owner_seat_for(&battle.format, candidate.slot).map_err(|source| {
            FaintQueueError::InvalidSlot {
                slot: candidate.slot,
                source,
            }
        })?;
        let occurrence = FaintOccurrence {
            id,
            source: FaintSource {
                epoch: authority_epoch,
                wave: battle.wave,
                resolved_turn: battle.turn,
                turn_occurrence,
            },
            slot: candidate.slot,
            pokemon: candidate.pokemon,
            owner_seat,
            replacement: replacement_progress_for_slot(candidate.slot, owner_seat),
        };

        validate_new_causal_tail(&working_queue, &occurrence)?;
        working_queue.push(occurrence);
        working_next = next_value;
        occurrences.push(occurrence);
    }

    battle.faint_queue = working_queue;
    battle.next_faint_occurrence = working_next;

    Ok(occurrences
        .into_iter()
        .map(|occurrence| FaintQueueResult {
            mutation: BattleMutation::FaintQueued { occurrence },
            occurrence,
        })
        .collect())
}

/// Queue a B06 move-effect request without carrying its unrelated provenance
/// into the canonical faint queue.
pub fn queue_faint_request(
    battle: &mut BattleState,
    request: &FaintRequest,
    authority_epoch: AuthorityEpoch,
    turn_occurrence: u32,
) -> Result<FaintQueueResult, FaintQueueError> {
    queue_faint(
        battle,
        FaintCandidate::from(request),
        authority_epoch,
        turn_occurrence,
    )
}

/// Queue an occurrence from a fully typed source.  The battle still supplies
/// its exact wave and pre-advance turn; mismatches fail closed rather than
/// being normalized.
pub fn queue_faint_with_source(
    battle: &mut BattleState,
    candidate: FaintCandidate,
    source: FaintSource,
) -> Result<FaintQueueResult, FaintQueueError> {
    if source.epoch == AuthorityEpoch::ZERO {
        return Err(FaintQueueError::ZeroAuthorityEpoch);
    }
    if source.wave != battle.wave || source.resolved_turn != battle.turn {
        return Err(FaintQueueError::SourceCoordinateMismatch {
            wave: source.wave,
            turn: source.resolved_turn,
        });
    }
    queue_faint(battle, candidate, source.epoch, source.turn_occurrence)
}

/// Compatibility spelling used by integration callers that name queue writes
/// as enqueue operations.
pub fn enqueue_faint(
    battle: &mut BattleState,
    candidate: FaintCandidate,
    authority_epoch: AuthorityEpoch,
    turn_occurrence: u32,
) -> Result<FaintQueueResult, FaintQueueError> {
    queue_faint(battle, candidate, authority_epoch, turn_occurrence)
}

fn replacement_progress_for_slot(
    slot: FieldSlot,
    owner_seat: Option<SeatId>,
) -> ReplacementProgress {
    if slot.side == BattleSide::Player && owner_seat.is_some() {
        ReplacementProgress::Pending
    } else {
        ReplacementProgress::NotRequired
    }
}

fn validate_queue_shape(battle: &BattleState) -> Result<(), FaintQueueError> {
    battle
        .field
        .validate_for_format(&battle.format)
        .map_err(|source| FaintQueueError::InvalidField { source })?;

    let mut ids = HashSet::with_capacity(battle.faint_queue.len());
    let mut unresolved_subjects = HashSet::with_capacity(battle.faint_queue.len());
    let mut previous: Option<&FaintOccurrence> = None;
    for occurrence in &battle.faint_queue {
        if !ids.insert(occurrence.id) {
            return Err(FaintQueueError::DuplicateQueueOccurrence { id: occurrence.id });
        }
        if occurrence.source.epoch == AuthorityEpoch::ZERO {
            return Err(FaintQueueError::ZeroAuthorityEpoch);
        }
        if occurrence.replacement != ReplacementProgress::Applied
            && !unresolved_subjects.insert((occurrence.slot, occurrence.pokemon))
        {
            return Err(FaintQueueError::DuplicateQueueSubject {
                slot: occurrence.slot,
                pokemon: occurrence.pokemon,
            });
        }
        if occurrence.id >= battle.next_faint_occurrence {
            return Err(FaintQueueError::QueueAllocatorMismatch {
                id: occurrence.id,
                next: battle.next_faint_occurrence,
            });
        }
        if occurrence.source.wave != battle.wave || occurrence.source.resolved_turn > battle.turn {
            return Err(FaintQueueError::SourceCoordinateMismatch {
                wave: occurrence.source.wave,
                turn: occurrence.source.resolved_turn,
            });
        }
        if let Some(previous) = previous
            && (previous.id >= occurrence.id
                || previous.source.resolved_turn > occurrence.source.resolved_turn
                || (previous.source.resolved_turn == occurrence.source.resolved_turn
                    && previous.source.turn_occurrence >= occurrence.source.turn_occurrence))
        {
            return Err(FaintQueueError::NonCausalQueue);
        }
        validate_stored_occurrence(battle, occurrence)?;
        previous = Some(occurrence);
    }
    Ok(())
}

fn validate_candidate_against(
    battle: &BattleState,
    queue: &[FaintOccurrence],
    candidate: FaintCandidate,
) -> Result<(), FaintQueueError> {
    validate_slot(&battle.format, candidate.slot).map_err(|source| {
        FaintQueueError::InvalidSlot {
            slot: candidate.slot,
            source,
        }
    })?;

    let field_entry = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == candidate.slot)
        .ok_or(FaintQueueError::CandidateSlotMissing {
            slot: candidate.slot,
        })?;
    match field_entry.occupant {
        None => {
            return Err(FaintQueueError::CandidateSlotEmpty {
                slot: candidate.slot,
            });
        }
        Some(occupant) if occupant != candidate.pokemon => {
            return Err(FaintQueueError::CandidateActorMismatch {
                slot: candidate.slot,
                pokemon: candidate.pokemon,
            });
        }
        Some(_) => {}
    }

    let party = party_for_side(battle, candidate.slot.side);
    let mut found: Option<&PokemonState> = None;
    for pokemon in party {
        if pokemon.id != candidate.pokemon {
            continue;
        }
        if found.is_some() {
            return Err(FaintQueueError::CandidatePartyDuplicate {
                pokemon: candidate.pokemon,
            });
        }
        found = Some(pokemon);
    }
    let pokemon = found.ok_or(FaintQueueError::CandidatePartyMissing {
        pokemon: candidate.pokemon,
        side: candidate.slot.side,
    })?;

    let expected_owner = owner_seat_for(&battle.format, candidate.slot).map_err(|source| {
        FaintQueueError::InvalidSlot {
            slot: candidate.slot,
            source,
        }
    })?;
    if pokemon.owner_seat != expected_owner {
        return Err(FaintQueueError::CandidateOwnerMismatch {
            pokemon: candidate.pokemon,
            actual: pokemon.owner_seat,
            expected: expected_owner,
        });
    }
    if pokemon.hp != 0 {
        return Err(FaintQueueError::CandidateHpNonZero {
            pokemon: candidate.pokemon,
            hp: pokemon.hp,
        });
    }
    if !pokemon.fainted {
        return Err(FaintQueueError::CandidateNotFainted {
            pokemon: candidate.pokemon,
        });
    }
    if queue.iter().any(|occurrence| {
        occurrence.replacement != ReplacementProgress::Applied
            && (occurrence.pokemon == candidate.pokemon || occurrence.slot == candidate.slot)
    }) {
        return Err(FaintQueueError::CandidateAlreadyQueued {
            pokemon: candidate.pokemon,
            slot: candidate.slot,
        });
    }
    Ok(())
}

fn validate_stored_occurrence(
    battle: &BattleState,
    occurrence: &FaintOccurrence,
) -> Result<(), FaintQueueError> {
    validate_slot(&battle.format, occurrence.slot).map_err(|source| {
        FaintQueueError::InvalidSlot {
            slot: occurrence.slot,
            source,
        }
    })?;
    let expected_owner = owner_seat_for(&battle.format, occurrence.slot).map_err(|source| {
        FaintQueueError::InvalidSlot {
            slot: occurrence.slot,
            source,
        }
    })?;
    if occurrence.owner_seat != expected_owner {
        return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
    }

    let party = party_for_side(battle, occurrence.slot.side);
    let mut found: Option<&PokemonState> = None;
    for pokemon in party {
        if pokemon.id != occurrence.pokemon {
            continue;
        }
        if found.is_some() {
            return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
        }
        found = Some(pokemon);
    }
    let pokemon = found.ok_or(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id })?;
    if pokemon.owner_seat != expected_owner || pokemon.hp != 0 || !pokemon.fainted {
        return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
    }

    let occupant = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == occurrence.slot)
        .and_then(|entry| entry.occupant);
    if occurrence.replacement != ReplacementProgress::Applied
        && occupant != Some(occurrence.pokemon)
    {
        return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
    }
    if occurrence.replacement == ReplacementProgress::Applied
        && occupant == Some(occurrence.pokemon)
    {
        return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
    }

    let progress_is_valid = match occurrence.replacement {
        ReplacementProgress::Pending
        | ReplacementProgress::Selected { .. }
        | ReplacementProgress::NoLegalReplacement
        | ReplacementProgress::Applied
            if occurrence.slot.side == BattleSide::Player && expected_owner.is_some() =>
        {
            true
        }
        ReplacementProgress::NotRequired | ReplacementProgress::Applied
            if occurrence.slot.side == BattleSide::Enemy && expected_owner.is_none() =>
        {
            true
        }
        _ => false,
    };
    if !progress_is_valid {
        return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
    }

    if let ReplacementProgress::Selected {
        party_slot,
        pokemon,
    } = occurrence.replacement
    {
        let Some(selected) = party.get(usize::from(party_slot.get())) else {
            return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
        };
        if selected.id != pokemon
            || selected.owner_seat != expected_owner
            || selected.fainted
            || selected.hp == 0
            || battle
                .field
                .slots
                .iter()
                .any(|entry| entry.occupant == Some(pokemon))
        {
            return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
        }
    }
    if occurrence.replacement == ReplacementProgress::NoLegalReplacement
        && battle.player_party.iter().any(|pokemon| {
            pokemon.owner_seat == expected_owner
                && !pokemon.fainted
                && pokemon.hp != 0
                && !battle
                    .field
                    .slots
                    .iter()
                    .any(|entry| entry.occupant == Some(pokemon.id))
        })
    {
        return Err(FaintQueueError::InvalidStoredOccurrence { id: occurrence.id });
    }
    Ok(())
}

fn validate_new_causal_tail(
    queue: &[FaintOccurrence],
    occurrence: &FaintOccurrence,
) -> Result<(), FaintQueueError> {
    let Some(previous) = queue.last() else {
        return Ok(());
    };
    if previous.id >= occurrence.id
        || previous.source.resolved_turn > occurrence.source.resolved_turn
        || (previous.source.resolved_turn == occurrence.source.resolved_turn
            && previous.source.turn_occurrence >= occurrence.source.turn_occurrence)
    {
        return Err(FaintQueueError::NonCausalQueue);
    }
    Ok(())
}

fn party_for_side(battle: &BattleState, side: BattleSide) -> &[PokemonState] {
    match side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    }
}
