//! Voluntary switch legality, occupancy mutation, and switch-in evidence.
//!
//! This boundary consumes the normalized command produced by [`crate::legality`].
//! It deliberately does not rebuild a command from the wire DTOs and does not
//! own ability, status, stage, faint, outcome, or presentation-ID policy.

use er_state::battle::BattleState;
use er_state::field::FieldStateError;
use er_state::format::{FormatTopologyError, owner_seat_for, validate_slot};
use er_state::pokemon::PokemonState;
use er_types::battle_ids::{BattleSide, FieldSlot, PartyIndex, PokemonId};
use er_types::battle_ui::BattlePresentationKind;
use er_types::{OperationId, SeatId};
use thiserror::Error;

use crate::command::NormalizedBattleCommand;
use crate::resolver::BattleMutation;

/// Typed failures from the normalized voluntary-switch boundary.
///
/// Every validation branch runs before the canonical field is changed.  The
/// caller can therefore retry or report any error while retaining the exact
/// input state.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SwitchError {
    /// The caller supplied a Fight command to the switch resolver.
    #[error("switch resolver requires a normalized Switch command")]
    NotSwitchCommand,
    /// The field topology cannot accept the command's source slot.
    #[error("switch source slot {slot:?} has invalid topology: {source}")]
    InvalidSourceTopology {
        slot: FieldSlot,
        #[source]
        source: FormatTopologyError,
    },
    /// Canonical field ordering, uniqueness, or format closure is invalid.
    #[error("switch field is invalid: {source}")]
    InvalidField {
        #[source]
        source: FieldStateError,
    },
    /// The normalized source slot is absent from the canonical field vector.
    #[error("switch source slot {slot:?} is absent from the field")]
    SourceSlotMissing { slot: FieldSlot },
    /// A voluntary switch must replace a current occupant.
    #[error("switch source slot {slot:?} is empty")]
    SourceSlotEmpty { slot: FieldSlot },
    /// The normalized actor must equal the source slot's current occupant.
    #[error("switch actor {actor:?} does not match source slot {slot:?} occupant {occupant:?}")]
    ActorMismatch {
        slot: FieldSlot,
        actor: PokemonId,
        occupant: PokemonId,
    },
    /// The active occupant must be present in the party belonging to the
    /// source side.
    #[error("active switch actor {actor:?} is not present on the {side:?} party")]
    ActiveActorMissing { actor: PokemonId, side: BattleSide },
    /// The active actor's owner must be the canonical owner of its source
    /// position.
    #[error("active actor {actor:?} on {slot:?} has owner {actual:?}, expected {expected:?}")]
    ActiveOwnerMismatch {
        slot: FieldSlot,
        actor: PokemonId,
        expected: Option<SeatId>,
        actual: Option<SeatId>,
    },
    /// A fainted active actor cannot voluntarily switch.
    #[error("active switch actor {actor:?} is fainted")]
    ActiveActorFainted { actor: PokemonId },
    /// The selected party slot does not exist on the source side.
    #[error("incoming party slot {party_slot:?} is absent from the {side:?} party")]
    IncomingPartySlotMissing {
        side: BattleSide,
        party_slot: PartyIndex,
    },
    /// A normalized command must retain the exact party identity admitted by
    /// the legality pipeline.
    #[error(
        "incoming command identity {incoming:?} does not match {side:?} party slot {party_slot:?} identity {party_member:?}"
    )]
    IncomingPartyIdentityMismatch {
        side: BattleSide,
        party_slot: PartyIndex,
        incoming: PokemonId,
        party_member: PokemonId,
    },
    /// The incoming party member must belong to the source slot's owner.
    #[error(
        "incoming Pokémon {incoming:?} has owner {actual:?}, expected {expected:?} for source slot {slot:?}"
    )]
    IncomingOwnerMismatch {
        slot: FieldSlot,
        incoming: PokemonId,
        expected: Option<SeatId>,
        actual: Option<SeatId>,
    },
    /// A fainted party member is not a legal voluntary destination.
    #[error("incoming Pokémon {incoming:?} is fainted")]
    IncomingFainted { incoming: PokemonId },
    /// A destination already occupying any field slot cannot be installed a
    /// second time.
    #[error("incoming Pokémon {incoming:?} already occupies field slot {slot:?}")]
    IncomingAlreadyOnField {
        incoming: PokemonId,
        slot: FieldSlot,
    },
}

/// Stable semantic evidence for one successful switch.
///
/// `operation_id` is carried from the already-admitted normalized command.  No
/// presentation event ID is allocated here; the integration layer can derive
/// one when it assembles the complete presentation plan.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwitchEvidence {
    pub operation_id: OperationId,
    pub slot: FieldSlot,
    pub outgoing: Option<PokemonId>,
    pub incoming: PokemonId,
    pub semantic: BattlePresentationKind,
}

impl SwitchEvidence {
    /// Construct the existing typed presentation kind without allocating its
    /// later `BattlePresentationEventId`.
    pub fn presentation_kind(&self) -> BattlePresentationKind {
        self.semantic.clone()
    }
}

/// Typed result of a successful switch and its caller-owned post-switch seam.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwitchResolution<T> {
    /// The mechanical field mutation that replays the canonical occupancy
    /// change.
    pub mutation: BattleMutation,
    /// The semantic switch evidence produced after occupancy installation.
    pub evidence: SwitchEvidence,
    /// Evidence returned by the caller-supplied switch-in trigger adapter.
    pub post_switch: T,
}

struct ValidatedSwitch {
    operation_id: OperationId,
    source_index: usize,
    slot: FieldSlot,
    outgoing: PokemonId,
    incoming: PokemonId,
}

/// Validate a normalized switch without changing the battle.
pub fn validate_switch(
    battle: &BattleState,
    command: &NormalizedBattleCommand,
) -> Result<(), SwitchError> {
    validate_switch_command(battle, command).map(|_| ())
}

/// Resolve one normalized voluntary switch.
///
/// Validation is complete before the source occupancy is changed.  The
/// successful order is fixed as:
///
/// 1. install the incoming identity in the canonical field slot;
/// 2. construct field and `Switched` semantic evidence;
/// 3. call `post_switch` with a read-only view of the updated battle and that
///    evidence.
///
/// The callback is intentionally generic and read-only over canonical state.
/// B07 can plan and return its own typed trigger/effect evidence without
/// making this module depend on the ability implementation or permitting
/// untracked callback mutation.
pub fn resolve_switch<T, F>(
    battle: &mut BattleState,
    command: &NormalizedBattleCommand,
    post_switch: F,
) -> Result<SwitchResolution<T>, SwitchError>
where
    F: FnOnce(&BattleState, &SwitchEvidence) -> T,
{
    let validated = validate_switch_command(battle, command)?;
    battle.field.slots[validated.source_index].occupant = Some(validated.incoming);

    let mutation = BattleMutation::FieldChanged {
        slot: validated.slot,
        before: Some(validated.outgoing),
        after: Some(validated.incoming),
    };
    let evidence = SwitchEvidence {
        operation_id: validated.operation_id,
        slot: validated.slot,
        outgoing: Some(validated.outgoing),
        incoming: validated.incoming,
        semantic: BattlePresentationKind::Switched {
            slot: validated.slot,
            outgoing: Some(validated.outgoing),
            incoming: validated.incoming,
        },
    };
    let post_switch = post_switch(battle, &evidence);

    Ok(SwitchResolution {
        mutation,
        evidence,
        post_switch,
    })
}

/// Naming alias for integrations that call mechanics mutators `apply_*`.
pub fn apply_switch<T, F>(
    battle: &mut BattleState,
    command: &NormalizedBattleCommand,
    post_switch: F,
) -> Result<SwitchResolution<T>, SwitchError>
where
    F: FnOnce(&BattleState, &SwitchEvidence) -> T,
{
    resolve_switch(battle, command, post_switch)
}

fn validate_switch_command(
    battle: &BattleState,
    command: &NormalizedBattleCommand,
) -> Result<ValidatedSwitch, SwitchError> {
    let NormalizedBattleCommand::Switch {
        operation_id,
        actor,
        field_slot,
        party_slot,
        incoming,
    } = command
    else {
        return Err(SwitchError::NotSwitchCommand);
    };

    battle
        .field
        .validate_for_format(&battle.format)
        .map_err(|source| SwitchError::InvalidField { source })?;
    validate_slot(&battle.format, *field_slot).map_err(|source| {
        SwitchError::InvalidSourceTopology {
            slot: *field_slot,
            source,
        }
    })?;
    let source_index = battle
        .field
        .slots
        .iter()
        .position(|entry| entry.slot == *field_slot)
        .ok_or(SwitchError::SourceSlotMissing { slot: *field_slot })?;
    let outgoing = battle.field.slots[source_index]
        .occupant
        .ok_or(SwitchError::SourceSlotEmpty { slot: *field_slot })?;
    if outgoing != *actor {
        return Err(SwitchError::ActorMismatch {
            slot: *field_slot,
            actor: *actor,
            occupant: outgoing,
        });
    }

    let expected_owner = owner_seat_for(&battle.format, *field_slot).map_err(|source| {
        SwitchError::InvalidSourceTopology {
            slot: *field_slot,
            source,
        }
    })?;
    let active = party_for_side(battle, field_slot.side)
        .iter()
        .find(|pokemon| pokemon.id == *actor)
        .ok_or(SwitchError::ActiveActorMissing {
            actor: *actor,
            side: field_slot.side,
        })?;
    if active.owner_seat != expected_owner {
        return Err(SwitchError::ActiveOwnerMismatch {
            slot: *field_slot,
            actor: *actor,
            expected: expected_owner,
            actual: active.owner_seat,
        });
    }
    if active.fainted || active.hp == 0 {
        return Err(SwitchError::ActiveActorFainted { actor: *actor });
    }

    let party = party_for_side(battle, field_slot.side);
    let incoming_state =
        party
            .get(usize::from(party_slot.get()))
            .ok_or(SwitchError::IncomingPartySlotMissing {
                side: field_slot.side,
                party_slot: *party_slot,
            })?;
    if incoming_state.id != *incoming {
        return Err(SwitchError::IncomingPartyIdentityMismatch {
            side: field_slot.side,
            party_slot: *party_slot,
            incoming: *incoming,
            party_member: incoming_state.id,
        });
    }
    if incoming_state.owner_seat != expected_owner {
        return Err(SwitchError::IncomingOwnerMismatch {
            slot: *field_slot,
            incoming: *incoming,
            expected: expected_owner,
            actual: incoming_state.owner_seat,
        });
    }
    if incoming_state.fainted || incoming_state.hp == 0 {
        return Err(SwitchError::IncomingFainted {
            incoming: *incoming,
        });
    }
    if let Some(entry) = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.occupant == Some(*incoming))
    {
        return Err(SwitchError::IncomingAlreadyOnField {
            incoming: *incoming,
            slot: entry.slot,
        });
    }

    Ok(ValidatedSwitch {
        operation_id: operation_id.clone(),
        source_index,
        slot: *field_slot,
        outgoing,
        incoming: *incoming,
    })
}

fn party_for_side(battle: &BattleState, side: BattleSide) -> &[PokemonState] {
    match side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    }
}
