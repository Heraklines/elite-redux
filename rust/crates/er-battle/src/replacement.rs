//! Stored faint-head replacement progress and occupancy resolution.
//!
//! The public resolver/orchestration boundary belongs to the later turn lane.
//! This module only provides the typed, engine-free core that that lane can
//! call after it has authenticated a material operation.  It never allocates
//! menus or presentation IDs and never touches battle RNG.

use er_state::battle::BattleState;
use er_state::field::FieldStateError;
use er_state::format::{FormatTopologyError, owner_seat_for, validate_slot};
use er_state::pokemon::PokemonState;
use er_types::OperationId;
use er_types::SeatId;
use er_types::battle_command::{
    BattleCommandError, OfferedSwitchCommand, ReplacementSelection,
    validate_replacement_operation_id,
};
use er_types::battle_ids::{
    BattleId, BattleSide, FaintOccurrenceId, FieldSlot, PartyIndex, PokemonId,
};
use er_types::battle_model::{FaintOccurrence, FaintSource, ReplacementProgress};
use thiserror::Error;

use crate::resolver::BattleMutation;

/// The exact stored identity needed by a later public replacement boundary.
///
/// This is an internal typed view, not a replacement command/control DTO.  In
/// particular, `occurrence` is the global queue identity while
/// `source.turn_occurrence` remains the operation-grammar identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StoredFaintSource {
    pub occurrence: FaintOccurrenceId,
    pub source: FaintSource,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub owner_seat: Option<SeatId>,
    pub replacement: ReplacementProgress,
}

/// One progress observation, optionally carrying the exact progress mutation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplacementProgressResult {
    pub stored: StoredFaintSource,
    pub before: ReplacementProgress,
    pub after: ReplacementProgress,
    pub mutation: Option<BattleMutation>,
}

/// Successful player replacement resolution evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplacementResolution {
    pub occurrence: FaintOccurrence,
    pub selection: ReplacementSelection,
    pub mutations: Vec<BattleMutation>,
}

/// Successful non-player/non-replacement faint resolution evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NonReplacementResolution {
    pub occurrence: FaintOccurrence,
    pub mutations: Vec<BattleMutation>,
}

/// Fail-closed errors from stored faint and replacement validation.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReplacementError {
    #[error("replacement field is invalid: {source}")]
    InvalidField {
        #[source]
        source: FieldStateError,
    },
    #[error("replacement slot {slot:?} has invalid topology: {source}")]
    InvalidSlot {
        slot: FieldSlot,
        #[source]
        source: FormatTopologyError,
    },
    #[error("there is no unresolved faint occurrence")]
    NoUnresolvedOccurrence,
    #[error("faint occurrence {requested:?} is not the unresolved queue head {head:?}")]
    NotQueueHead {
        requested: FaintOccurrenceId,
        head: FaintOccurrenceId,
    },
    #[error("faint occurrence {occurrence:?} does not require a player replacement")]
    ReplacementNotRequired { occurrence: FaintOccurrenceId },
    #[error("faint occurrence {occurrence:?} has progress {progress:?}, not Pending")]
    ProgressNotPending {
        occurrence: FaintOccurrenceId,
        progress: ReplacementProgress,
    },
    #[error("faint occurrence {occurrence:?} has invalid stored progress")]
    InvalidStoredProgress { occurrence: FaintOccurrenceId },
    #[error("stored faint occurrence {occurrence:?} is detached from its field slot")]
    StoredFieldMismatch { occurrence: FaintOccurrenceId },
    #[error("stored faint occurrence {occurrence:?} actor is absent from its party")]
    StoredPartyMissing { occurrence: FaintOccurrenceId },
    #[error("stored faint occurrence {occurrence:?} actor appears more than once")]
    StoredPartyDuplicate { occurrence: FaintOccurrenceId },
    #[error("stored faint occurrence {occurrence:?} has the wrong owner")]
    StoredOwnerMismatch { occurrence: FaintOccurrenceId },
    #[error("stored faint occurrence {occurrence:?} actor is not zero-HP and fainted")]
    StoredActorNotFainted { occurrence: FaintOccurrenceId },
    #[error("replacement party slot {party_slot:?} is absent")]
    CandidatePartySlotMissing { party_slot: PartyIndex },
    #[error("replacement party slot {party_slot:?} contains {actual:?}, not selected {expected:?}")]
    CandidatePartyIdentityMismatch {
        party_slot: PartyIndex,
        expected: PokemonId,
        actual: PokemonId,
    },
    #[error("replacement candidate {pokemon:?} has the wrong owner")]
    CandidateOwnerMismatch { pokemon: PokemonId },
    #[error("replacement candidate {pokemon:?} is fainted or has zero HP")]
    CandidateNotLiving { pokemon: PokemonId },
    #[error("replacement candidate {pokemon:?} already occupies {slot:?}")]
    CandidateAlreadyOnField { pokemon: PokemonId, slot: FieldSlot },
    #[error("replacement candidate {pokemon:?} appears more than once in the party")]
    CandidatePartyDuplicate { pokemon: PokemonId },
    #[error("a legal replacement exists, so NO_LEGAL_REPLACEMENT is invalid")]
    LegalReplacementExists,
    #[error("NO_LEGAL_REPLACEMENT is an internal decision and cannot be externally proposed")]
    NoLegalReplacementExternal,
    #[error("the stored faint occurrence has no human owner")]
    MissingOwner,
    #[error("replacement operation is invalid: {0}")]
    Operation(#[from] BattleCommandError),
    #[error("replacement party index {index} exceeds the selected six-member party")]
    PartyIndexInvariant { index: usize },
    #[error("stored faint occurrence {occurrence:?} has invalid wave/turn coordinates")]
    StoredSourceCoordinateMismatch { occurrence: FaintOccurrenceId },
}

/// Return the exact stored queue-head source/actor tuple for B10 validation.
pub fn stored_faint_source(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<StoredFaintSource, ReplacementError> {
    let (_, stored) = validate_head(battle, occurrence)?;
    Ok(stored)
}

/// Validate the exact REPLACEMENT operation grammar for a stored player faint.
///
/// The global occurrence is intentionally not passed to the operation helper;
/// only `source.turn_occurrence` supplies the operation's `o` component.
pub fn validate_stored_replacement_operation(
    operation: &OperationId,
    battle_id: BattleId,
    stored: StoredFaintSource,
) -> Result<(), ReplacementError> {
    if stored.field_slot.side != BattleSide::Player {
        return Err(ReplacementError::ReplacementNotRequired {
            occurrence: stored.occurrence,
        });
    }
    let owner = stored.owner_seat.ok_or(ReplacementError::MissingOwner)?;
    validate_replacement_operation_id(
        operation,
        stored.source.epoch,
        battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence,
        stored.field_slot,
        owner,
    )?;
    Ok(())
}

/// Return exact living, off-field, same-owner player replacement candidates.
pub fn legal_replacement_candidates(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<Vec<OfferedSwitchCommand>, ReplacementError> {
    let (_index, stored) = validate_head(battle, occurrence)?;
    replacement_candidates_for_stored(battle, stored)
}

/// Compute replacement progress without changing the battle.
///
/// Player-owned pending occurrences become `Pending` when at least one exact
/// same-owner living off-field candidate exists.  The no-candidate result is
/// observable only as an internal deterministic result; external proposals
/// cannot submit it.
pub fn compute_replacement_progress(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<ReplacementProgress, ReplacementError> {
    let (_index, stored) = validate_head(battle, occurrence)?;
    compute_progress_for_stored(battle, stored)
}

/// Compatibility name for callers that treat the calculation as an
/// assessment rather than a pure computation.
pub fn assess_replacement_progress(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<ReplacementProgress, ReplacementError> {
    compute_replacement_progress(battle, occurrence)
}

/// Advance a player-owned pending head to the internal no-candidate state.
///
/// A legal candidate leaves the occurrence pending and emits no mutation.  A
/// no-candidate head emits exactly one `FaintProgressChanged` mutation and is
/// ready for [`resolve_no_legal_replacement`].
pub fn advance_replacement_progress(
    battle: &mut BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<ReplacementProgressResult, ReplacementError> {
    let (index, stored) = validate_head(battle, occurrence)?;
    require_player_replacement(stored)?;
    let before = battle.faint_queue[index].replacement;
    if before == ReplacementProgress::NoLegalReplacement {
        return Ok(ReplacementProgressResult {
            stored,
            before,
            after: before,
            mutation: None,
        });
    }
    if before != ReplacementProgress::Pending {
        return Err(ReplacementError::ProgressNotPending {
            occurrence,
            progress: before,
        });
    }

    let candidates = replacement_candidates_for_stored(battle, stored)?;
    if !candidates.is_empty() {
        return Ok(ReplacementProgressResult {
            stored,
            before,
            after: ReplacementProgress::Pending,
            mutation: None,
        });
    }

    let after = ReplacementProgress::NoLegalReplacement;
    battle.faint_queue[index].replacement = after;
    Ok(ReplacementProgressResult {
        stored,
        before,
        after,
        mutation: Some(BattleMutation::FaintProgressChanged {
            occurrence,
            before,
            after,
        }),
    })
}

/// Apply a selected player replacement.  The selection must be an exact
/// party-slot/identity pair and is applied only to the first unresolved head.
/// The later B10 resolver owns the public `resolve_replacement` orchestration.
pub fn apply_selected_replacement(
    battle: &mut BattleState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
) -> Result<ReplacementResolution, ReplacementError> {
    let ReplacementSelection::Selected {
        party_slot,
        pokemon,
    } = *selection
    else {
        return Err(ReplacementError::NoLegalReplacementExternal);
    };
    let (index, stored) = validate_head(battle, occurrence)?;
    require_player_replacement(stored)?;
    let before = battle.faint_queue[index].replacement;
    if before != ReplacementProgress::Pending {
        return Err(ReplacementError::ProgressNotPending {
            occurrence,
            progress: before,
        });
    }
    validate_selected_candidate(battle, stored, party_slot, pokemon)?;
    let field_index = field_index_for(battle, stored.field_slot)?;

    let after = ReplacementProgress::Selected {
        party_slot,
        pokemon,
    };
    battle.faint_queue[index].replacement = after;
    let before_occupant = battle.field.slots[field_index].occupant;
    battle.field.slots[field_index].occupant = Some(pokemon);
    battle.faint_queue[index].replacement = ReplacementProgress::Applied;
    let resolved_occurrence = battle.faint_queue[index];

    Ok(ReplacementResolution {
        occurrence: resolved_occurrence,
        selection: *selection,
        mutations: vec![
            BattleMutation::FaintProgressChanged {
                occurrence,
                before,
                after,
            },
            BattleMutation::FieldChanged {
                slot: stored.field_slot,
                before: before_occupant,
                after: Some(pokemon),
            },
            BattleMutation::FaintResolved { occurrence },
        ],
    })
}

/// Resolve the internal deterministic no-candidate branch.
///
/// This function has no `ReplacementSelection` argument, which keeps
/// `NoLegalReplacement` out of any externally proposed command path.
pub fn resolve_no_legal_replacement(
    battle: &mut BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<ReplacementResolution, ReplacementError> {
    let (index, stored) = validate_head(battle, occurrence)?;
    require_player_replacement(stored)?;
    let before = battle.faint_queue[index].replacement;
    if before != ReplacementProgress::Pending && before != ReplacementProgress::NoLegalReplacement {
        return Err(ReplacementError::ProgressNotPending {
            occurrence,
            progress: before,
        });
    }
    if !replacement_candidates_for_stored(battle, stored)?.is_empty() {
        return Err(ReplacementError::LegalReplacementExists);
    }

    let mut mutations = Vec::with_capacity(3);
    if before == ReplacementProgress::Pending {
        let after = ReplacementProgress::NoLegalReplacement;
        battle.faint_queue[index].replacement = after;
        mutations.push(BattleMutation::FaintProgressChanged {
            occurrence,
            before,
            after,
        });
    }

    let field_index = field_index_for(battle, stored.field_slot)?;
    let before_occupant = battle.field.slots[field_index].occupant;
    battle.field.slots[field_index].occupant = None;
    battle.faint_queue[index].replacement = ReplacementProgress::Applied;
    let resolved_occurrence = battle.faint_queue[index];
    mutations.push(BattleMutation::FieldChanged {
        slot: stored.field_slot,
        before: before_occupant,
        after: None,
    });
    mutations.push(BattleMutation::FaintResolved { occurrence });

    Ok(ReplacementResolution {
        occurrence: resolved_occurrence,
        selection: ReplacementSelection::NoLegalReplacement,
        mutations,
    })
}

/// Resolve an enemy/non-owned faint whose stored progress is
/// `NotRequired`.  It clears the old occupancy and leaves replacement choice
/// to the later outcome/turn lane.
pub fn resolve_not_required(
    battle: &mut BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<NonReplacementResolution, ReplacementError> {
    let (index, stored) = validate_head(battle, occurrence)?;
    if stored.field_slot.side == BattleSide::Player || stored.owner_seat.is_some() {
        return Err(ReplacementError::ReplacementNotRequired { occurrence });
    }
    if battle.faint_queue[index].replacement != ReplacementProgress::NotRequired {
        return Err(ReplacementError::InvalidStoredProgress { occurrence });
    }
    let field_index = field_index_for(battle, stored.field_slot)?;
    let before_occupant = battle.field.slots[field_index].occupant;
    battle.field.slots[field_index].occupant = None;
    battle.faint_queue[index].replacement = ReplacementProgress::Applied;
    let resolved_occurrence = battle.faint_queue[index];
    Ok(NonReplacementResolution {
        occurrence: resolved_occurrence,
        mutations: vec![
            BattleMutation::FieldChanged {
                slot: stored.field_slot,
                before: before_occupant,
                after: None,
            },
            BattleMutation::FaintResolved { occurrence },
        ],
    })
}

/// Compatibility alias for the enemy/non-owned resolution seam.
pub fn resolve_non_player_faint(
    battle: &mut BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<NonReplacementResolution, ReplacementError> {
    resolve_not_required(battle, occurrence)
}

fn validate_head(
    battle: &BattleState,
    requested: FaintOccurrenceId,
) -> Result<(usize, StoredFaintSource), ReplacementError> {
    battle
        .field
        .validate_for_format(&battle.format)
        .map_err(|source| ReplacementError::InvalidField { source })?;
    let index = battle
        .faint_queue
        .iter()
        .position(|occurrence| occurrence.replacement != ReplacementProgress::Applied)
        .ok_or(ReplacementError::NoUnresolvedOccurrence)?;
    let head = battle.faint_queue[index];
    if head.id != requested {
        return Err(ReplacementError::NotQueueHead {
            requested,
            head: head.id,
        });
    }
    let stored = validate_stored_occurrence(battle, index)?;
    Ok((index, stored))
}

fn validate_stored_occurrence(
    battle: &BattleState,
    index: usize,
) -> Result<StoredFaintSource, ReplacementError> {
    let occurrence = battle.faint_queue[index];
    validate_slot(&battle.format, occurrence.slot).map_err(|source| {
        ReplacementError::InvalidSlot {
            slot: occurrence.slot,
            source,
        }
    })?;
    let expected_owner = owner_seat_for(&battle.format, occurrence.slot).map_err(|source| {
        ReplacementError::InvalidSlot {
            slot: occurrence.slot,
            source,
        }
    })?;
    if occurrence.owner_seat != expected_owner {
        return Err(ReplacementError::StoredOwnerMismatch {
            occurrence: occurrence.id,
        });
    }
    if occurrence.source.wave != battle.wave || occurrence.source.resolved_turn > battle.turn {
        return Err(ReplacementError::StoredSourceCoordinateMismatch {
            occurrence: occurrence.id,
        });
    }
    let field_index = field_index_for(battle, occurrence.slot)?;
    if battle.field.slots[field_index].occupant != Some(occurrence.pokemon) {
        return Err(ReplacementError::StoredFieldMismatch {
            occurrence: occurrence.id,
        });
    }

    let party = party_for_side(battle, occurrence.slot.side);
    let mut found: Option<&PokemonState> = None;
    for pokemon in party {
        if pokemon.id != occurrence.pokemon {
            continue;
        }
        if found.is_some() {
            return Err(ReplacementError::StoredPartyDuplicate {
                occurrence: occurrence.id,
            });
        }
        found = Some(pokemon);
    }
    let actor = found.ok_or(ReplacementError::StoredPartyMissing {
        occurrence: occurrence.id,
    })?;
    if actor.owner_seat != expected_owner {
        return Err(ReplacementError::StoredOwnerMismatch {
            occurrence: occurrence.id,
        });
    }
    if actor.hp != 0 || !actor.fainted {
        return Err(ReplacementError::StoredActorNotFainted {
            occurrence: occurrence.id,
        });
    }
    if occurrence.slot.side == BattleSide::Player {
        if expected_owner.is_none()
            || !matches!(
                occurrence.replacement,
                ReplacementProgress::Pending
                    | ReplacementProgress::Selected { .. }
                    | ReplacementProgress::NoLegalReplacement
            )
        {
            return Err(ReplacementError::InvalidStoredProgress {
                occurrence: occurrence.id,
            });
        }
    } else if occurrence.replacement != ReplacementProgress::NotRequired {
        return Err(ReplacementError::InvalidStoredProgress {
            occurrence: occurrence.id,
        });
    }

    let stored = StoredFaintSource {
        occurrence: occurrence.id,
        source: occurrence.source,
        actor: occurrence.pokemon,
        field_slot: occurrence.slot,
        owner_seat: occurrence.owner_seat,
        replacement: occurrence.replacement,
    };
    if let ReplacementProgress::Selected {
        party_slot,
        pokemon,
    } = occurrence.replacement
    {
        validate_selected_candidate(battle, stored, party_slot, pokemon)?;
    }
    if occurrence.replacement == ReplacementProgress::NoLegalReplacement
        && !replacement_candidates_for_stored(battle, stored)?.is_empty()
    {
        return Err(ReplacementError::LegalReplacementExists);
    }
    Ok(stored)
}

fn require_player_replacement(stored: StoredFaintSource) -> Result<(), ReplacementError> {
    if stored.field_slot.side != BattleSide::Player || stored.owner_seat.is_none() {
        return Err(ReplacementError::ReplacementNotRequired {
            occurrence: stored.occurrence,
        });
    }
    Ok(())
}

fn compute_progress_for_stored(
    battle: &BattleState,
    stored: StoredFaintSource,
) -> Result<ReplacementProgress, ReplacementError> {
    let current = current_progress(battle, stored.occurrence)?;
    if stored.field_slot.side != BattleSide::Player || stored.owner_seat.is_none() {
        return Ok(ReplacementProgress::NotRequired);
    }
    if current != ReplacementProgress::Pending {
        return Ok(current);
    }
    if replacement_candidates_for_stored(battle, stored)?.is_empty() {
        Ok(ReplacementProgress::NoLegalReplacement)
    } else {
        Ok(ReplacementProgress::Pending)
    }
}

fn current_progress(
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<ReplacementProgress, ReplacementError> {
    battle
        .faint_queue
        .iter()
        .find(|entry| entry.id == occurrence)
        .map(|entry| entry.replacement)
        .ok_or(ReplacementError::NoUnresolvedOccurrence)
}

fn replacement_candidates_for_stored(
    battle: &BattleState,
    stored: StoredFaintSource,
) -> Result<Vec<OfferedSwitchCommand>, ReplacementError> {
    let Some(owner) = stored.owner_seat else {
        return Ok(Vec::new());
    };
    if stored.field_slot.side != BattleSide::Player {
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    for (index, pokemon) in battle.player_party.iter().enumerate() {
        if pokemon.owner_seat != Some(owner)
            || pokemon.fainted
            || pokemon.hp == 0
            || field_slot_for_actor(battle, pokemon.id).is_some()
        {
            continue;
        }
        let index =
            u8::try_from(index).map_err(|_| ReplacementError::PartyIndexInvariant { index })?;
        let party_slot =
            PartyIndex::new(index).map_err(|_| ReplacementError::PartyIndexInvariant {
                index: usize::from(index),
            })?;
        candidates.push(OfferedSwitchCommand::new(party_slot, pokemon.id));
    }
    Ok(candidates)
}

fn validate_selected_candidate(
    battle: &BattleState,
    stored: StoredFaintSource,
    party_slot: PartyIndex,
    pokemon: PokemonId,
) -> Result<(), ReplacementError> {
    let selected = battle
        .player_party
        .get(usize::from(party_slot.get()))
        .ok_or(ReplacementError::CandidatePartySlotMissing { party_slot })?;
    if battle
        .player_party
        .iter()
        .filter(|candidate| candidate.id == pokemon)
        .nth(1)
        .is_some()
    {
        return Err(ReplacementError::CandidatePartyDuplicate { pokemon });
    }
    if selected.id != pokemon {
        return Err(ReplacementError::CandidatePartyIdentityMismatch {
            party_slot,
            expected: pokemon,
            actual: selected.id,
        });
    }
    if selected.owner_seat != stored.owner_seat {
        return Err(ReplacementError::CandidateOwnerMismatch { pokemon });
    }
    if selected.fainted || selected.hp == 0 {
        return Err(ReplacementError::CandidateNotLiving { pokemon });
    }
    if let Some(slot) = field_slot_for_actor(battle, pokemon) {
        return Err(ReplacementError::CandidateAlreadyOnField { pokemon, slot });
    }
    Ok(())
}

fn field_index_for(battle: &BattleState, slot: FieldSlot) -> Result<usize, ReplacementError> {
    battle
        .field
        .slots
        .iter()
        .position(|entry| entry.slot == slot)
        .ok_or(ReplacementError::InvalidSlot {
            slot,
            source: FormatTopologyError::SlotOutsideCapacity { slot },
        })
}

fn party_for_side(battle: &BattleState, side: BattleSide) -> &[PokemonState] {
    match side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    }
}

fn field_slot_for_actor(battle: &BattleState, pokemon: PokemonId) -> Option<FieldSlot> {
    battle
        .field
        .slots
        .iter()
        .find(|entry| entry.occupant == Some(pokemon))
        .map(|entry| entry.slot)
}
