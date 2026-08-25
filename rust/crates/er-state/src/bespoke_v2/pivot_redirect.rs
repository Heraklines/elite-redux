//! Canonical typed state for the SWITCH_TRAP_REDIRECT bespoke family.
//!
//! This module owns the closed state surface for pivot/trap/redirection/
//! Commander mechanics: redirect directives drawn this turn, live trap
//! instances, the optional Commander occupancy pairing, and staged pivot
//! intents. Every participant is identified by a stable field slot plus the
//! expected occupant Pokémon ID ([`OccupantIdentity`]); no fixed battler
//! index ever enters canonical state.
//!
//! All mutating helpers are pure: they clone, mutate the clone, validate, and
//! return the updated state. Creation ordinals advance under checked
//! arithmetic and stay strictly ahead of every stored entry, mirroring the
//! `MechanicStateStoreV2` conventions.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::SafeU53;
use er_types::battle_ids::{FieldSlot, PokemonId};

/// Schema version of the pivot/trap/redirect canonical state.
pub const PIVOT_REDIRECT_STATE_SCHEMA_VERSION: u32 = 1;

/// Stable participant identity: a field slot plus the Pokémon expected to
/// occupy it at validation time. Species or object identity is never a target
/// identity on its own.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccupantIdentity {
    pub slot: FieldSlot,
    pub pokemon: PokemonId,
}

impl OccupantIdentity {
    pub const fn new(slot: FieldSlot, pokemon: PokemonId) -> Self {
        Self { slot, pokemon }
    }
}

/// Closed redirection vocabulary observed in the frozen catalog. Type-directed
/// redirection (Lightning Rod / Storm Drain family) outranks the Follow Me
/// tier; Follow Me and Rage Powder share one tier and are separated by their
/// supplied immunity facts plus declaration order.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RedirectKind {
    FollowMe,
    RagePowder,
    TypeDirected,
}

impl RedirectKind {
    /// Frozen precedence tier; higher values win ties against lower ones.
    pub const fn precedence(self) -> u8 {
        match self {
            Self::FollowMe | Self::RagePowder => 2,
            Self::TypeDirected => 3,
        }
    }
}

/// One active redirection drawn for the current turn.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedirectDirectiveState {
    /// The battler drawing the move toward itself.
    pub source: OccupantIdentity,
    pub kind: RedirectKind,
    /// Turn-relative declaration order; breaks precedence ties.
    pub creation_ordinal: SafeU53,
}

impl RedirectDirectiveState {
    /// Deterministic resolution key: precedence descending, then declaration
    /// order ascending.
    pub fn resolution_key(&self) -> (std::cmp::Reverse<u8>, SafeU53) {
        (
            std::cmp::Reverse(self.kind.precedence()),
            self.creation_ordinal,
        )
    }
}

/// Closed trapping vocabulary: a binding hold placed by an identifiable
/// trapper, or an area denial trap with no single owner.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrapKind {
    Binding,
    Arena,
}

/// One live trap instance anchored to its trapped subject.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrapInstanceState {
    pub kind: TrapKind,
    pub subject: OccupantIdentity,
    /// The battler that placed the trap; `None` for ownerless arena traps.
    /// A `Some` trapper that leaves the field ends the trap.
    pub trapper: Option<OccupantIdentity>,
    /// Remaining full turns; `None` lasts until the trapper leaves.
    pub remaining_turns: Option<u16>,
    pub creation_ordinal: SafeU53,
}

/// Commander occupancy pairing: the commanding Pokémon occupies no field slot
/// while paired, and its former slot stays reserved for its return.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommanderPairingState {
    pub commander: PokemonId,
    /// The field slot the commander left; it must remain vacant while paired.
    pub commander_slot: FieldSlot,
    pub host: OccupantIdentity,
    pub creation_ordinal: SafeU53,
}

/// Whether a pivot was chosen voluntarily or forced by an external effect.
/// Forced pivots ignore trapping but respect typed forced-switch immunities;
/// voluntary pivots respect trapping escape legality.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PivotKind {
    Voluntary,
    Forced,
}

/// A staged switch-out request awaiting the atomic battle transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotIntentState {
    pub subject: OccupantIdentity,
    pub kind: PivotKind,
    /// Bench Pokémon intended to enter the subject's slot.
    pub replacement: PokemonId,
    pub creation_ordinal: SafeU53,
}

/// Canonical state root for the SWITCH_TRAP_REDIRECT family.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotRedirectStateV2 {
    pub schema_version: u32,
    pub next_creation_ordinal: SafeU53,
    /// Sorted ascending by creation ordinal.
    pub redirects: Vec<RedirectDirectiveState>,
    /// Sorted ascending by creation ordinal.
    pub traps: Vec<TrapInstanceState>,
    pub commander: Option<CommanderPairingState>,
    /// Sorted ascending by creation ordinal.
    pub pivot_intents: Vec<PivotIntentState>,
}

impl Default for PivotRedirectStateV2 {
    fn default() -> Self {
        Self {
            schema_version: PIVOT_REDIRECT_STATE_SCHEMA_VERSION,
            next_creation_ordinal: SafeU53::new(1).unwrap_or(SafeU53::ZERO),
            redirects: Vec::new(),
            traps: Vec::new(),
            commander: None,
            pivot_intents: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PivotRedirectStateError {
    #[error("pivot/redirect state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("next creation ordinal must be positive")]
    ZeroNextCreationOrdinal,
    #[error("creation ordinal counter overflowed the safe integer bound")]
    CreationOrdinalOverflow,
    #[error("stored entry {entry} is not behind the next creation ordinal {next}")]
    CreationOrdinalNotAhead { entry: u64, next: u64 },
    #[error("creation ordinals must be unique across all family entries")]
    DuplicateCreationOrdinal,
    #[error("redirects must be sorted by creation ordinal")]
    RedirectsOutOfOrder,
    #[error("a Pokémon may hold at most one active redirect directive")]
    DuplicateRedirectSource,
    #[error("traps must be sorted by creation ordinal")]
    TrapsOutOfOrder,
    #[error("a subject may carry at most one trap of a given kind")]
    DuplicateTrapSubject,
    #[error("pivot intents must be sorted by creation ordinal")]
    IntentsOutOfOrder,
    #[error("a Pokémon may carry at most one staged pivot intent")]
    DuplicateIntentSubject,
    #[error("the commander cannot pair with itself as host")]
    CommanderSelfPairing,
    #[error("the commanding Pokémon is referenced by another family entry")]
    CommanderOccupiedElsewhere,
    #[error("trap remaining turns must be positive when present")]
    ZeroRemainingTurns,
}

impl PivotRedirectStateV2 {
    /// Validates schema, ordering, uniqueness, and occupancy invariants.
    pub fn validate(&self) -> Result<(), PivotRedirectStateError> {
        if self.schema_version != PIVOT_REDIRECT_STATE_SCHEMA_VERSION {
            return Err(PivotRedirectStateError::SchemaVersion {
                expected: PIVOT_REDIRECT_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.next_creation_ordinal == SafeU53::ZERO {
            return Err(PivotRedirectStateError::ZeroNextCreationOrdinal);
        }

        let mut ordinals = std::collections::BTreeSet::new();
        let mut insert_ordinal = |ordinal: SafeU53| -> Result<(), PivotRedirectStateError> {
            if ordinal >= self.next_creation_ordinal {
                return Err(PivotRedirectStateError::CreationOrdinalNotAhead {
                    entry: ordinal.get(),
                    next: self.next_creation_ordinal.get(),
                });
            }
            if !ordinals.insert(ordinal) {
                return Err(PivotRedirectStateError::DuplicateCreationOrdinal);
            }
            Ok(())
        };

        let mut previous_redirect: Option<SafeU53> = None;
        let mut redirect_sources = std::collections::BTreeSet::new();
        for redirect in &self.redirects {
            insert_ordinal(redirect.creation_ordinal)?;
            if previous_redirect.is_some_and(|previous| previous >= redirect.creation_ordinal) {
                return Err(PivotRedirectStateError::RedirectsOutOfOrder);
            }
            previous_redirect = Some(redirect.creation_ordinal);
            if !redirect_sources.insert(redirect.source.pokemon) {
                return Err(PivotRedirectStateError::DuplicateRedirectSource);
            }
        }

        let mut previous_trap: Option<SafeU53> = None;
        let mut trap_subjects = std::collections::BTreeSet::new();
        for trap in &self.traps {
            insert_ordinal(trap.creation_ordinal)?;
            if previous_trap.is_some_and(|previous| previous >= trap.creation_ordinal) {
                return Err(PivotRedirectStateError::TrapsOutOfOrder);
            }
            previous_trap = Some(trap.creation_ordinal);
            if trap.remaining_turns == Some(0) {
                return Err(PivotRedirectStateError::ZeroRemainingTurns);
            }
            if !trap_subjects.insert((trap.subject.pokemon, trap.kind)) {
                return Err(PivotRedirectStateError::DuplicateTrapSubject);
            }
        }

        let mut previous_intent: Option<SafeU53> = None;
        let mut intent_subjects = std::collections::BTreeSet::new();
        for intent in &self.pivot_intents {
            insert_ordinal(intent.creation_ordinal)?;
            if previous_intent.is_some_and(|previous| previous >= intent.creation_ordinal) {
                return Err(PivotRedirectStateError::IntentsOutOfOrder);
            }
            previous_intent = Some(intent.creation_ordinal);
            if !intent_subjects.insert(intent.subject.pokemon) {
                return Err(PivotRedirectStateError::DuplicateIntentSubject);
            }
        }

        if let Some(pairing) = &self.commander {
            if pairing.host.pokemon == pairing.commander {
                return Err(PivotRedirectStateError::CommanderSelfPairing);
            }
            let commander_elsewhere = redirect_sources.contains(&pairing.commander)
                || trap_subjects
                    .iter()
                    .any(|(subject, _)| *subject == pairing.commander)
                || intent_subjects.contains(&pairing.commander);
            if commander_elsewhere {
                return Err(PivotRedirectStateError::CommanderOccupiedElsewhere);
            }
        }
        Ok(())
    }

    /// Allocates the next creation ordinal under checked arithmetic and
    /// returns the advanced state root.
    fn advance_ordinal(&self) -> Result<Self, PivotRedirectStateError> {
        let next_value = self
            .next_creation_ordinal
            .get()
            .checked_add(1)
            .ok_or(PivotRedirectStateError::CreationOrdinalOverflow)?;
        let next_creation_ordinal = SafeU53::new(next_value)
            .map_err(|_| PivotRedirectStateError::CreationOrdinalOverflow)?;
        let mut advanced = self.clone();
        advanced.next_creation_ordinal = next_creation_ordinal;
        Ok(advanced)
    }

    fn validated(mut self) -> Result<Self, PivotRedirectStateError> {
        self.validate()?;
        Ok(self)
    }

    /// Records one redirect directive for this turn. Pure: returns the
    /// updated state and the stored directive.
    pub fn admit_redirect(
        &self,
        source: OccupantIdentity,
        kind: RedirectKind,
    ) -> Result<(Self, RedirectDirectiveState), PivotRedirectStateError> {
        let creation_ordinal = self.next_creation_ordinal;
        let directive = RedirectDirectiveState {
            source,
            kind,
            creation_ordinal,
        };
        let mut next = self.advance_ordinal()?;
        next.redirects.push(directive.clone());
        let next = next.validated()?;
        Ok((next, directive))
    }

    /// Records one live trap instance. Pure.
    pub fn admit_trap(
        &self,
        kind: TrapKind,
        subject: OccupantIdentity,
        trapper: Option<OccupantIdentity>,
        remaining_turns: Option<u16>,
    ) -> Result<(Self, TrapInstanceState), PivotRedirectStateError> {
        let creation_ordinal = self.next_creation_ordinal;
        let trap = TrapInstanceState {
            kind,
            subject,
            trapper,
            remaining_turns,
            creation_ordinal,
        };
        let mut next = self.advance_ordinal()?;
        next.traps.push(trap.clone());
        let next = next.validated()?;
        Ok((next, trap))
    }

    /// Stages one pivot intent. Pure.
    pub fn record_pivot_intent(
        &self,
        subject: OccupantIdentity,
        kind: PivotKind,
        replacement: PokemonId,
    ) -> Result<(Self, PivotIntentState), PivotRedirectStateError> {
        let creation_ordinal = self.next_creation_ordinal;
        let intent = PivotIntentState {
            subject,
            kind,
            replacement,
            creation_ordinal,
        };
        let mut next = self.advance_ordinal()?;
        next.pivot_intents.push(intent.clone());
        let next = next.validated()?;
        Ok((next, intent))
    }

    /// Establishes the Commander occupancy pairing. Pure.
    pub fn assign_commander(
        &self,
        commander: PokemonId,
        commander_slot: FieldSlot,
        host: OccupantIdentity,
    ) -> Result<(Self, CommanderPairingState), PivotRedirectStateError> {
        let creation_ordinal = self.next_creation_ordinal;
        let pairing = CommanderPairingState {
            commander,
            commander_slot,
            host,
            creation_ordinal,
        };
        let mut next = self.advance_ordinal()?;
        next.commander = Some(pairing.clone());
        let next = next.validated()?;
        Ok((next, pairing))
    }

    /// Clears the Commander pairing. Pure.
    pub fn clear_commander(&self) -> Result<Self, PivotRedirectStateError> {
        let mut next = self.clone();
        next.commander = None;
        next.validated()
    }

    /// Ends every trap owned by `trapper`, returning the ended traps.
    /// Pure.
    pub fn end_traps_owned_by(
        &self,
        trapper: PokemonId,
    ) -> Result<(Self, Vec<TrapInstanceState>), PivotRedirectStateError> {
        let (ended, kept): (Vec<_>, Vec<_>) = self
            .traps
            .iter()
            .cloned()
            .partition(|trap| trap.trapper.is_some_and(|owner| owner.pokemon == trapper));
        let mut next = self.clone();
        next.traps = kept;
        let next = next.validated()?;
        Ok((next, ended))
    }

    /// Ends every trap anchored to `subject` (for example because the
    /// subject fainted), returning the ended traps. Pure.
    pub fn end_traps_on(
        &self,
        subject: PokemonId,
    ) -> Result<(Self, Vec<TrapInstanceState>), PivotRedirectStateError> {
        let (ended, kept): (Vec<_>, Vec<_>) = self
            .traps
            .iter()
            .cloned()
            .partition(|trap| trap.subject.pokemon == subject);
        let mut next = self.clone();
        next.traps = kept;
        let next = next.validated()?;
        Ok((next, ended))
    }

    /// Drops every redirect directive sourced by `source`, returning the
    /// dropped directives. Pure.
    pub fn drop_redirects_from(
        &self,
        source: PokemonId,
    ) -> Result<(Self, Vec<RedirectDirectiveState>), PivotRedirectStateError> {
        let (dropped, kept): (Vec<_>, Vec<_>) = self
            .redirects
            .iter()
            .cloned()
            .partition(|directive| directive.source.pokemon == source);
        let mut next = self.clone();
        next.redirects = kept;
        let next = next.validated()?;
        Ok((next, dropped))
    }

    /// Drops every staged pivot intent belonging to `subject`, returning
    /// the dropped intents. Pure.
    pub fn drop_intents_for(
        &self,
        subject: PokemonId,
    ) -> Result<(Self, Vec<PivotIntentState>), PivotRedirectStateError> {
        let (dropped, kept): (Vec<_>, Vec<_>) = self
            .pivot_intents
            .iter()
            .cloned()
            .partition(|intent| intent.subject.pokemon == subject);
        let mut next = self.clone();
        next.pivot_intents = kept;
        let next = next.validated()?;
        Ok((next, dropped))
    }

    /// Ages every timed trap by one turn, ending traps whose counter reaches
    /// zero. Untimed traps persist until their trapper leaves. Pure.
    pub fn tick_traps(&self) -> Result<(Self, Vec<TrapInstanceState>), PivotRedirectStateError> {
        let mut expired = Vec::new();
        let mut aged = Vec::with_capacity(self.traps.len());
        for trap in &self.traps {
            match trap.remaining_turns {
                None => aged.push(trap.clone()),
                Some(remaining) => {
                    if remaining <= 1 {
                        expired.push(trap.clone());
                    } else {
                        let mut aged_trap = trap.clone();
                        aged_trap.remaining_turns = Some(remaining - 1);
                        aged.push(aged_trap);
                    }
                }
            }
        }
        let mut next = self.clone();
        next.traps = aged;
        let next = next.validated()?;
        Ok((next, expired))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::battle_ids::BattleSide;

    fn slot(side: BattleSide, position: u8) -> FieldSlot {
        FieldSlot { side, position }
    }

    fn player(position: u8) -> FieldSlot {
        slot(BattleSide::Player, position)
    }

    fn enemy(position: u8) -> FieldSlot {
        slot(BattleSide::Enemy, position)
    }

    fn occupant(at: FieldSlot, pokemon: u64) -> OccupantIdentity {
        OccupantIdentity::new(at, PokemonId::try_from_u64(pokemon).expect("pokemon id"))
    }

    #[test]
    fn admits_and_orders_family_entries() {
        let state = PivotRedirectStateV2::default();
        let (state, follow_me) = state
            .admit_redirect(occupant(enemy(1), 9), RedirectKind::FollowMe)
            .expect("admit redirect");
        let (state, trap) = state
            .admit_trap(
                TrapKind::Binding,
                occupant(player(0), 5),
                Some(occupant(enemy(1), 9)),
                None,
            )
            .expect("admit trap");
        let (state, intent) = state
            .record_pivot_intent(
                occupant(player(0), 5),
                PivotKind::Forced,
                PokemonId::try_from_u64(6).expect("pokemon id"),
            )
            .expect("stage intent");
        assert!(RedirectKind::TypeDirected.precedence() > follow_me.kind.precedence());
        assert_eq!(
            trap.subject.pokemon.get(),
            PokemonId::try_from_u64(5).expect("pokemon id").get()
        );
        assert_eq!(intent.kind, PivotKind::Forced);
        assert_eq!(state.redirects.len(), 1);
        assert_eq!(state.traps.len(), 1);
        assert_eq!(state.pivot_intents.len(), 1);
        state.validate().expect("valid state");
    }

    #[test]
    fn rejects_duplicate_redirect_source() {
        let state = PivotRedirectStateV2::default();
        let (state, _) = state
            .admit_redirect(occupant(player(0), 7), RedirectKind::FollowMe)
            .expect("first redirect");
        let error = state
            .admit_redirect(occupant(player(0), 7), RedirectKind::RagePowder)
            .expect_err("duplicate source must fail");
        assert_eq!(error, PivotRedirectStateError::DuplicateRedirectSource);
    }

    #[test]
    fn rejects_commander_self_pairing_and_outside_references() {
        let state = PivotRedirectStateV2::default();
        let commander = PokemonId::try_from_u64(11).expect("pokemon id");
        let host = occupant(player(1), 12);
        let error = state
            .assign_commander(host.pokemon, host.slot, host)
            .expect_err("self pairing must fail");
        assert_eq!(error, PivotRedirectStateError::CommanderSelfPairing);

        let (state, _) = state
            .admit_redirect(occupant(player(0), commander.get()), RedirectKind::FollowMe)
            .expect("redirect");
        let error = state
            .assign_commander(commander, player(0), host)
            .expect_err("commander referenced elsewhere must fail");
        assert_eq!(error, PivotRedirectStateError::CommanderOccupiedElsewhere);
    }

    #[test]
    fn cleanup_helpers_remove_owned_entries_and_validate() {
        let state = PivotRedirectStateV2::default();
        let trapper = occupant(player(1), 20);
        let trapped = occupant(enemy(0), 21);
        let (state, _) = state
            .admit_redirect(trapper, RedirectKind::FollowMe)
            .expect("redirect");
        let (state, _) = state
            .admit_trap(TrapKind::Binding, trapped, Some(trapper), None)
            .expect("trap");
        let (state, dropped_redirects) = state.drop_redirects_from(trapper.pokemon).expect("drop");
        assert_eq!(dropped_redirects.len(), 1);
        let (_, ended_traps) = state
            .end_traps_owned_by(trapper.pokemon)
            .expect("end traps");
        assert_eq!(ended_traps.len(), 1);
    }

    #[test]
    fn tick_expires_only_timed_traps() {
        let state = PivotRedirectStateV2::default();
        let (state, timed) = state
            .admit_trap(TrapKind::Arena, occupant(enemy(0), 30), None, Some(1))
            .expect("timed trap");
        let (state, untimed) = state
            .admit_trap(
                TrapKind::Binding,
                occupant(enemy(1), 31),
                Some(occupant(player(0), 32)),
                None,
            )
            .expect("untimed trap");
        let (after, expired) = state.tick_traps().expect("tick");
        assert_eq!(expired, vec![timed]);
        assert_eq!(after.traps, vec![untimed]);
    }

    #[test]
    fn rejects_zero_remaining_turns() {
        let state = PivotRedirectStateV2::default();
        let error = state
            .admit_trap(TrapKind::Arena, occupant(enemy(0), 40), None, Some(0))
            .expect_err("zero remaining turns must fail");
        assert_eq!(error, PivotRedirectStateError::ZeroRemainingTurns);
    }
}
