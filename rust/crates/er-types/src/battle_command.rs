//! M3A-09 dependency-leaf command, replacement, and admission DTOs.
//!
//! This module deliberately stops at typed identity, canonical ordering, and
//! fingerprinting.  Battle legality, admission mutation, PP, RNG, and
//! resolution belong to the later `er-battle`/`er-game` layers.

use std::{cmp::Ordering, fmt};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

use crate::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, MAX_FIELD_POSITION,
    MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex, WaveIndex,
};
use crate::ids::{
    OperationId, SafeU53, SeatId, validate_authority_material_digest,
    validate_authority_operation_id,
};

/// The schema version frozen for human and scripted command DTOs.
pub const BATTLE_COMMAND_SCHEMA_VERSION: u32 = 1;
/// The schema version frozen for replacement proposals.
pub const BATTLE_REPLACEMENT_PROPOSAL_SCHEMA_VERSION: u32 = 1;
/// The schema version frozen for scripted enemy policy DTOs.
pub const SCRIPTED_ENEMY_POLICY_SCHEMA_VERSION: u32 = 1;

const COMMAND_FINGERPRINT_PREFIX: &str = "bc1-";
const REPLACEMENT_FINGERPRINT_PREFIX: &str = "brp1-";
const FNV1A64_OFFSET: u64 = 0xcbf29ce484222325;
const FNV1A64_PRIME: u64 = 0x100000001b3;

/// Errors raised by intrinsic command DTO construction and validation.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleCommandError {
    #[error("schema version must be {expected}, got {actual}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("selected target list must not be empty")]
    EmptyTargetSelection,
    #[error("selected targets must be sorted by canonical field-slot order")]
    UnsortedTargetSelection,
    #[error("selected targets must not contain duplicates")]
    DuplicateTargetSelection,
    #[error("offered move entries must be sorted by move slot")]
    UnsortedMoveOffers,
    #[error("offered move entries must not contain duplicate move slots")]
    DuplicateMoveOffer,
    #[error("offered switch entries must be sorted by party slot")]
    UnsortedSwitchOffers,
    #[error("offered switch entries must not contain duplicate party slots")]
    DuplicateSwitchOffer,
    #[error("offered switch entries must not contain duplicate Pokémon")]
    DuplicateSwitchPokemon,
    #[error("offered target selections must be sorted deterministically")]
    UnsortedOfferedTargets,
    #[error("offered target selections must not contain duplicates")]
    DuplicateOfferedTarget,
    #[error("an offered move must contain at least one legal target selection")]
    EmptyOfferedTargets,
    #[error("operation ID is invalid: {0}")]
    InvalidOperationId(String),
    #[error("operation ID does not match the expected {context} identity")]
    OperationIdMismatch { context: &'static str },
    #[error("operation ID has the wrong {context} grammar")]
    OperationGrammarMismatch { context: &'static str },
    #[error("field slot has the wrong side for a {context} command")]
    WrongFieldSide { context: &'static str },
    #[error("field position {position} is outside the shared topology bound")]
    InvalidFieldPosition { position: u8 },
    #[error("command actor does not match its enclosing DTO actor")]
    ActorMismatch,
    #[error("control ID must be a non-empty Authority wire string")]
    InvalidControlId,
    #[error("replacement proposal cannot submit NO_LEGAL_REPLACEMENT")]
    NoLegalReplacementProposal,
    #[error("command frontier must be sorted by canonical field-slot order")]
    UnsortedCommandFrontier,
    #[error("command frontier must not contain duplicate operation IDs")]
    DuplicateCommandOperation,
    #[error("command frontier must not contain duplicate field slots")]
    DuplicateCommandFieldSlot,
    #[error("command tombstones must be sorted by canonical operation-ID order")]
    UnsortedCommandTombstones,
    #[error("command tombstones must not contain duplicate operation IDs")]
    DuplicateCommandTombstone,
    #[error("a command tombstone may not share a live frontier operation ID")]
    LiveCommandTombstoneCollision,
    #[error("accepted command does not match its frontier entry")]
    FrontierCommandMismatch,
    #[error("admission source does not match the accepted command kind")]
    AdmissionSourceMismatch,
    #[error("command set must be sorted by canonical field-slot order")]
    UnsortedCommandSet,
    #[error("command set must not contain duplicate field slots")]
    DuplicateCommandSetFieldSlot,
    #[error("command set must not contain duplicate operation IDs")]
    DuplicateCommandSetOperation,
    #[error("scripted enemy commands must be sorted by script cursor")]
    UnsortedScriptedPolicy,
    #[error("scripted enemy policy must not contain duplicate script cursors")]
    DuplicateScriptCursor,
    #[error("fingerprint has the wrong format")]
    InvalidFingerprintFormat,
    #[error("fingerprint does not match the canonical payload")]
    FingerprintMismatch,
}

/// Backwards-friendly name for callers that want to distinguish validation
/// failures from mechanics errors.
pub type BattleCommandValidationError = BattleCommandError;

/// A typed command selected for one actor in one command window.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BattleCommand {
    Fight {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        targets: BattleTargetSelection,
    },
    Switch {
        actor: PokemonId,
        party_slot: PartyIndex,
    },
}

impl BattleCommand {
    /// Construct a Fight command after checking its target-vector invariants.
    pub fn fight(
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        targets: BattleTargetSelection,
    ) -> Result<Self, BattleCommandError> {
        let command = Self::Fight {
            actor,
            move_slot,
            targets,
        };
        command.validate()?;
        Ok(command)
    }

    /// Construct a Switch command.  The shared slot wrappers already enforce
    /// the intrinsic bounds; party occupancy is a later legality concern.
    pub const fn switch(actor: PokemonId, party_slot: PartyIndex) -> Self {
        Self::Switch { actor, party_slot }
    }

    /// Validate the identity-level invariants of this command.
    pub fn validate(&self) -> Result<(), BattleCommandError> {
        if let Self::Fight { targets, .. } = self {
            targets.validate()?;
        }
        Ok(())
    }

    pub const fn actor(&self) -> PokemonId {
        match self {
            Self::Fight { actor, .. } | Self::Switch { actor, .. } => *actor,
        }
    }
}

/// The explicit target identity carried by a command or a legal offer.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum BattleTargetSelection {
    Implicit,
    Selected(Vec<FieldSlot>),
}

impl BattleTargetSelection {
    pub const fn implicit() -> Self {
        Self::Implicit
    }

    /// Construct a selected target set without silently reordering it.
    pub fn selected(targets: Vec<FieldSlot>) -> Result<Self, BattleCommandError> {
        let selection = Self::Selected(targets);
        selection.validate()?;
        Ok(selection)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        let Self::Selected(targets) = self else {
            return Ok(());
        };
        validate_sorted_unique_field_slots(targets)
    }

    pub fn validate_canonical_order(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }

    pub fn selected_targets(&self) -> Option<&[FieldSlot]> {
        match self {
            Self::Implicit => None,
            Self::Selected(targets) => Some(targets),
        }
    }
}

/// One move and all legal target selections offered for it.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfferedMoveCommand {
    pub move_slot: MoveSlotIndex,
    pub legal_targets: Vec<BattleTargetSelection>,
}

impl OfferedMoveCommand {
    pub fn new(
        move_slot: MoveSlotIndex,
        legal_targets: Vec<BattleTargetSelection>,
    ) -> Result<Self, BattleCommandError> {
        let offer = Self {
            move_slot,
            legal_targets,
        };
        offer.validate()?;
        Ok(offer)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        if self.legal_targets.is_empty() {
            return Err(BattleCommandError::EmptyOfferedTargets);
        }
        for target in &self.legal_targets {
            target.validate()?;
        }
        for pair in self.legal_targets.windows(2) {
            match compare_target_selections(&pair[0], &pair[1]) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedOfferedTargets),
                Ordering::Equal => return Err(BattleCommandError::DuplicateOfferedTarget),
                Ordering::Less => {}
            }
        }
        Ok(())
    }

    pub fn validate_canonical_order(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }
}

/// One legal voluntary switch option.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfferedSwitchCommand {
    pub party_slot: PartyIndex,
    pub pokemon: PokemonId,
}

impl OfferedSwitchCommand {
    pub const fn new(party_slot: PartyIndex, pokemon: PokemonId) -> Self {
        Self {
            party_slot,
            pokemon,
        }
    }

    pub const fn validate(&self) -> Result<(), BattleCommandError> {
        Ok(())
    }
}

/// The exact legal offer retained in a command frontier entry.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleCommandOffer {
    pub fight: Vec<OfferedMoveCommand>,
    pub switches: Vec<OfferedSwitchCommand>,
}

impl BattleCommandOffer {
    pub fn new(
        fight: Vec<OfferedMoveCommand>,
        switches: Vec<OfferedSwitchCommand>,
    ) -> Result<Self, BattleCommandError> {
        let offer = Self { fight, switches };
        offer.validate()?;
        Ok(offer)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        for move_offer in &self.fight {
            move_offer.validate()?;
        }
        for pair in self.fight.windows(2) {
            match pair[0].move_slot.cmp(&pair[1].move_slot) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedMoveOffers),
                Ordering::Equal => return Err(BattleCommandError::DuplicateMoveOffer),
                Ordering::Less => {}
            }
        }

        for pair in self.switches.windows(2) {
            match pair[0].party_slot.cmp(&pair[1].party_slot) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedSwitchOffers),
                Ordering::Equal => return Err(BattleCommandError::DuplicateSwitchOffer),
                Ordering::Less => {}
            }
        }
        for (index, left) in self.switches.iter().enumerate() {
            if self.switches[..index]
                .iter()
                .any(|right| right.pokemon == left.pokemon)
            {
                return Err(BattleCommandError::DuplicateSwitchPokemon);
            }
        }
        Ok(())
    }

    pub fn is_canonical(&self) -> bool {
        self.validate().is_ok()
    }

    pub fn validate_canonical_order(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }
}

/// The source of an accepted command, expressed relative to the authority.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommandAdmissionSource {
    AuthorityLocalInternal,
    AuthorityRemoteProposal,
    ScriptedEnemy,
}

/// A command frontier entry's retained/admitted state.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommandFrontierStatus {
    Pending,
    Retained {
        command: AcceptedBattleCommand,
        source: CommandAdmissionSource,
    },
    Admitted {
        command: AcceptedBattleCommand,
        source: CommandAdmissionSource,
    },
}

/// One command decision window in the deterministic frontier.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandFrontierEntry {
    pub operation_id: OperationId,
    pub owner_seat: Option<SeatId>,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub offer: BattleCommandOffer,
    pub status: CommandFrontierStatus,
}

impl CommandFrontierEntry {
    pub fn new(
        operation_id: OperationId,
        owner_seat: Option<SeatId>,
        actor: PokemonId,
        field_slot: FieldSlot,
        offer: BattleCommandOffer,
        status: CommandFrontierStatus,
    ) -> Result<Self, BattleCommandError> {
        let entry = Self {
            operation_id,
            owner_seat,
            actor,
            field_slot,
            offer,
            status,
        };
        entry.validate()?;
        Ok(entry)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_field_slot(self.field_slot)?;
        validate_operation_id(&self.operation_id)?;
        self.offer.validate()?;
        match self.field_slot.side {
            BattleSide::Player if self.owner_seat.is_none() => {
                Err(BattleCommandError::AdmissionSourceMismatch)
            }
            BattleSide::Enemy if self.owner_seat.is_some() => {
                Err(BattleCommandError::AdmissionSourceMismatch)
            }
            _ => self.validate_status(),
        }
    }

    fn validate_status(&self) -> Result<(), BattleCommandError> {
        let (command, source) = match &self.status {
            CommandFrontierStatus::Pending => return Ok(()),
            CommandFrontierStatus::Retained { command, source }
            | CommandFrontierStatus::Admitted { command, source } => (command, source),
        };
        command.validate()?;
        if command.operation_id() != &self.operation_id
            || command.actor() != self.actor
            || command.field_slot() != self.field_slot
        {
            return Err(BattleCommandError::FrontierCommandMismatch);
        }
        match (self.field_slot.side, command, source) {
            (
                BattleSide::Player,
                AcceptedBattleCommand::Human { proposal, .. },
                CommandAdmissionSource::AuthorityLocalInternal
                | CommandAdmissionSource::AuthorityRemoteProposal,
            ) if Some(proposal.owner_seat) == self.owner_seat => Ok(()),
            (
                BattleSide::Enemy,
                AcceptedBattleCommand::ScriptedEnemy { .. },
                CommandAdmissionSource::ScriptedEnemy,
            ) => Ok(()),
            _ => Err(BattleCommandError::AdmissionSourceMismatch),
        }
    }
}

/// A command fingerprint retained as an admission tombstone.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandFingerprintEntry {
    pub operation_id: OperationId,
    pub fingerprint: BattleCommandFingerprint,
}

impl CommandFingerprintEntry {
    pub fn new(
        operation_id: OperationId,
        fingerprint: BattleCommandFingerprint,
    ) -> Result<Self, BattleCommandError> {
        validate_operation_id(&operation_id)?;
        fingerprint.validate()?;
        Ok(Self {
            operation_id,
            fingerprint,
        })
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_operation_id(&self.operation_id)?;
        self.fingerprint.validate()
    }
}

/// A replacement fingerprint retained as an admission tombstone.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplacementProposalFingerprintEntry {
    pub operation_id: OperationId,
    pub fingerprint: BattleReplacementProposalFingerprint,
}

impl ReplacementProposalFingerprintEntry {
    pub fn new(
        operation_id: OperationId,
        fingerprint: BattleReplacementProposalFingerprint,
    ) -> Result<Self, BattleCommandError> {
        validate_operation_id(&operation_id)?;
        fingerprint.validate()?;
        Ok(Self {
            operation_id,
            fingerprint,
        })
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_operation_id(&self.operation_id)?;
        self.fingerprint.validate()
    }
}

/// The serializable command collection stored in battle state.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandCollectionState {
    pub frontier: Vec<CommandFrontierEntry>,
    pub tombstones: Vec<CommandFingerprintEntry>,
}

impl CommandCollectionState {
    pub fn new(
        frontier: Vec<CommandFrontierEntry>,
        tombstones: Vec<CommandFingerprintEntry>,
    ) -> Result<Self, BattleCommandError> {
        let state = Self {
            frontier,
            tombstones,
        };
        state.validate()?;
        Ok(state)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        for entry in &self.frontier {
            entry.validate()?;
        }
        for pair in self.frontier.windows(2) {
            match pair[0].field_slot.cmp(&pair[1].field_slot) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedCommandFrontier),
                Ordering::Equal => return Err(BattleCommandError::DuplicateCommandFieldSlot),
                Ordering::Less => {}
            }
        }
        for (index, entry) in self.frontier.iter().enumerate() {
            if self.frontier[..index]
                .iter()
                .any(|previous| previous.operation_id == entry.operation_id)
            {
                return Err(BattleCommandError::DuplicateCommandOperation);
            }
        }

        for entry in &self.tombstones {
            entry.validate()?;
        }
        for pair in self.tombstones.windows(2) {
            match cmp_operation_ids(&pair[0].operation_id, &pair[1].operation_id) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedCommandTombstones),
                Ordering::Equal => return Err(BattleCommandError::DuplicateCommandTombstone),
                Ordering::Less => {}
            }
        }
        if self.frontier.iter().any(|entry| {
            self.tombstones
                .iter()
                .any(|tombstone| tombstone.operation_id == entry.operation_id)
        }) {
            return Err(BattleCommandError::LiveCommandTombstoneCollision);
        }
        Ok(())
    }

    /// Project only admitted entries in the already-canonical frontier order.
    pub fn admitted_command_set(&self) -> Result<CommandSet, BattleCommandError> {
        let mut entries = Vec::with_capacity(self.frontier.len());
        for frontier in &self.frontier {
            let CommandFrontierStatus::Admitted { command, .. } = &frontier.status else {
                return Err(BattleCommandError::FrontierCommandMismatch);
            };
            entries.push(command.clone());
        }
        CommandSet::new(entries)
    }

    pub fn is_canonical(&self) -> bool {
        self.validate().is_ok()
    }

    pub fn validate_canonical_order(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }
}

/// A human command proposal submitted for admission.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleCommandProposalV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub owner_seat: SeatId,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub command: BattleCommand,
    pub menu_instance_id: MenuInstanceId,
    pub control_id: String,
}

impl BattleCommandProposalV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        operation_id: OperationId,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        owner_seat: SeatId,
        actor: PokemonId,
        field_slot: FieldSlot,
        command: BattleCommand,
        menu_instance_id: MenuInstanceId,
        control_id: impl Into<String>,
    ) -> Result<Self, BattleCommandError> {
        let proposal = Self {
            schema_version: BATTLE_COMMAND_SCHEMA_VERSION,
            operation_id,
            battle_id,
            wave,
            turn,
            owner_seat,
            actor,
            field_slot,
            command,
            menu_instance_id,
            control_id: control_id.into(),
        };
        proposal.validate()?;
        Ok(proposal)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_schema_version(
        schema_version: u32,
        operation_id: OperationId,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        owner_seat: SeatId,
        actor: PokemonId,
        field_slot: FieldSlot,
        command: BattleCommand,
        menu_instance_id: MenuInstanceId,
        control_id: impl Into<String>,
    ) -> Result<Self, BattleCommandError> {
        let proposal = Self {
            schema_version,
            operation_id,
            battle_id,
            wave,
            turn,
            owner_seat,
            actor,
            field_slot,
            command,
            menu_instance_id,
            control_id: control_id.into(),
        };
        proposal.validate()?;
        Ok(proposal)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_schema(self.schema_version, BATTLE_COMMAND_SCHEMA_VERSION)?;
        validate_field_slot(self.field_slot)?;
        validate_operation_id(&self.operation_id)?;
        if self.field_slot.side != BattleSide::Player {
            return Err(BattleCommandError::WrongFieldSide { context: "human" });
        }
        if self.command.actor() != self.actor {
            return Err(BattleCommandError::ActorMismatch);
        }
        self.command.validate()?;
        validate_control_id(&self.control_id)?;
        validate_player_command_operation_id(
            &self.operation_id,
            self.battle_id,
            self.wave,
            self.turn,
            self.field_slot,
            self.owner_seat,
        )
    }

    pub fn canonical_json(&self) -> String {
        canonical_human_envelope(self)
    }

    pub fn fingerprint(&self) -> BattleCommandFingerprint {
        BattleCommandFingerprint::from_canonical_payload(
            COMMAND_FINGERPRINT_PREFIX,
            &self.canonical_json(),
        )
    }

    pub fn expected_operation_id(&self) -> Result<OperationId, BattleCommandError> {
        player_command_operation_id(
            self.battle_id,
            self.wave,
            self.turn,
            self.field_slot,
            self.owner_seat,
        )
    }
}

/// A replacement selection in a forced replacement window.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ReplacementSelection {
    Selected {
        party_slot: PartyIndex,
        pokemon: PokemonId,
    },
    NoLegalReplacement,
}

impl ReplacementSelection {
    pub const fn selected(party_slot: PartyIndex, pokemon: PokemonId) -> Self {
        Self::Selected {
            party_slot,
            pokemon,
        }
    }

    pub const fn no_legal_replacement() -> Self {
        Self::NoLegalReplacement
    }

    pub const fn is_external_submission(&self) -> bool {
        matches!(self, Self::Selected { .. })
    }

    pub const fn validate(&self) -> Result<(), BattleCommandError> {
        Ok(())
    }

    pub const fn validate_external(&self) -> Result<(), BattleCommandError> {
        if self.is_external_submission() {
            Ok(())
        } else {
            Err(BattleCommandError::NoLegalReplacementProposal)
        }
    }

    pub const fn validate_internal(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }
}

/// A human forced-replacement proposal submitted for admission.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleReplacementProposalV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub owner_seat: SeatId,
    pub occurrence: FaintOccurrenceId,
    pub turn_occurrence: u32,
    pub field_slot: FieldSlot,
    pub selection: ReplacementSelection,
    pub menu_instance_id: MenuInstanceId,
    pub control_id: String,
}

impl BattleReplacementProposalV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        operation_id: OperationId,
        battle_id: BattleId,
        wave: WaveIndex,
        resolved_turn: TurnIndex,
        owner_seat: SeatId,
        occurrence: FaintOccurrenceId,
        turn_occurrence: u32,
        field_slot: FieldSlot,
        selection: ReplacementSelection,
        menu_instance_id: MenuInstanceId,
        control_id: impl Into<String>,
    ) -> Result<Self, BattleCommandError> {
        let proposal = Self {
            schema_version: BATTLE_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
            operation_id,
            battle_id,
            wave,
            resolved_turn,
            owner_seat,
            occurrence,
            turn_occurrence,
            field_slot,
            selection,
            menu_instance_id,
            control_id: control_id.into(),
        };
        proposal.validate()?;
        Ok(proposal)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_schema_version(
        schema_version: u32,
        operation_id: OperationId,
        battle_id: BattleId,
        wave: WaveIndex,
        resolved_turn: TurnIndex,
        owner_seat: SeatId,
        occurrence: FaintOccurrenceId,
        turn_occurrence: u32,
        field_slot: FieldSlot,
        selection: ReplacementSelection,
        menu_instance_id: MenuInstanceId,
        control_id: impl Into<String>,
    ) -> Result<Self, BattleCommandError> {
        let proposal = Self {
            schema_version,
            operation_id,
            battle_id,
            wave,
            resolved_turn,
            owner_seat,
            occurrence,
            turn_occurrence,
            field_slot,
            selection,
            menu_instance_id,
            control_id: control_id.into(),
        };
        proposal.validate()?;
        Ok(proposal)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_schema(
            self.schema_version,
            BATTLE_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
        )?;
        validate_field_slot(self.field_slot)?;
        validate_operation_id(&self.operation_id)?;
        if self.field_slot.side != BattleSide::Player {
            return Err(BattleCommandError::WrongFieldSide {
                context: "replacement",
            });
        }
        self.selection.validate_external()?;
        validate_control_id(&self.control_id)?;
        validate_replacement_operation_skeleton(
            &self.operation_id,
            self.battle_id,
            self.wave,
            self.resolved_turn,
            self.turn_occurrence,
            self.field_slot,
            self.owner_seat,
        )
    }

    /// Validate the complete replacement grammar when the authority epoch is
    /// available at the adapter boundary.
    pub fn validate_with_epoch(&self, epoch: AuthorityEpoch) -> Result<(), BattleCommandError> {
        self.validate()?;
        validate_replacement_operation_id(
            &self.operation_id,
            epoch,
            self.battle_id,
            self.wave,
            self.resolved_turn,
            self.turn_occurrence,
            self.field_slot,
            self.owner_seat,
        )
    }

    pub fn canonical_json(&self) -> String {
        canonical_replacement_proposal(self)
    }

    pub fn fingerprint(&self) -> BattleReplacementProposalFingerprint {
        BattleReplacementProposalFingerprint::from_canonical_payload(
            REPLACEMENT_FINGERPRINT_PREFIX,
            &self.canonical_json(),
        )
    }

    pub fn expected_operation_id(
        &self,
        epoch: AuthorityEpoch,
    ) -> Result<OperationId, BattleCommandError> {
        replacement_operation_id(
            epoch,
            self.battle_id,
            self.wave,
            self.resolved_turn,
            self.turn_occurrence,
            self.field_slot,
            self.owner_seat,
        )
    }
}

/// A command accepted into the common command ledger.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum AcceptedBattleCommand {
    Human {
        proposal: BattleCommandProposalV1,
        fingerprint: BattleCommandFingerprint,
    },
    ScriptedEnemy {
        command: ScriptedEnemyBattleCommandV1,
        fingerprint: BattleCommandFingerprint,
    },
}

impl AcceptedBattleCommand {
    pub fn human(proposal: BattleCommandProposalV1) -> Self {
        let fingerprint = proposal.fingerprint();
        Self::Human {
            proposal,
            fingerprint,
        }
    }

    pub fn scripted_enemy(command: ScriptedEnemyBattleCommandV1) -> Self {
        let fingerprint = command.fingerprint();
        Self::ScriptedEnemy {
            command,
            fingerprint,
        }
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        match self {
            Self::Human {
                proposal,
                fingerprint,
            } => {
                proposal.validate()?;
                if &proposal.fingerprint() == fingerprint {
                    Ok(())
                } else {
                    Err(BattleCommandError::FingerprintMismatch)
                }
            }
            Self::ScriptedEnemy {
                command,
                fingerprint,
            } => {
                command.validate()?;
                if &command.fingerprint() == fingerprint {
                    Ok(())
                } else {
                    Err(BattleCommandError::FingerprintMismatch)
                }
            }
        }
    }

    pub fn fingerprint(&self) -> &BattleCommandFingerprint {
        match self {
            Self::Human { fingerprint, .. } | Self::ScriptedEnemy { fingerprint, .. } => {
                fingerprint
            }
        }
    }

    pub fn operation_id(&self) -> &OperationId {
        match self {
            Self::Human { proposal, .. } => &proposal.operation_id,
            Self::ScriptedEnemy { command, .. } => &command.operation_id,
        }
    }

    pub const fn actor(&self) -> PokemonId {
        match self {
            Self::Human { proposal, .. } => proposal.actor,
            Self::ScriptedEnemy { command, .. } => command.actor,
        }
    }

    pub const fn field_slot(&self) -> FieldSlot {
        match self {
            Self::Human { proposal, .. } => proposal.field_slot,
            Self::ScriptedEnemy { command, .. } => command.field_slot,
        }
    }

    pub fn canonical_json(&self) -> String {
        match self {
            Self::Human { proposal, .. } => canonical_human_envelope(proposal),
            Self::ScriptedEnemy { command, .. } => canonical_enemy_envelope(command),
        }
    }
}

/// A scripted enemy command with an immutable policy cursor.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedEnemyBattleCommandV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub script_cursor: SafeU53,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub command: BattleCommand,
}

impl ScriptedEnemyBattleCommandV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        operation_id: OperationId,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        script_cursor: SafeU53,
        actor: PokemonId,
        field_slot: FieldSlot,
        command: BattleCommand,
    ) -> Result<Self, BattleCommandError> {
        let command = Self {
            schema_version: BATTLE_COMMAND_SCHEMA_VERSION,
            operation_id,
            battle_id,
            wave,
            turn,
            script_cursor,
            actor,
            field_slot,
            command,
        };
        command.validate()?;
        Ok(command)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_schema_version(
        schema_version: u32,
        operation_id: OperationId,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        script_cursor: SafeU53,
        actor: PokemonId,
        field_slot: FieldSlot,
        command: BattleCommand,
    ) -> Result<Self, BattleCommandError> {
        let value = Self {
            schema_version,
            operation_id,
            battle_id,
            wave,
            turn,
            script_cursor,
            actor,
            field_slot,
            command,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_schema(self.schema_version, BATTLE_COMMAND_SCHEMA_VERSION)?;
        validate_field_slot(self.field_slot)?;
        validate_operation_id(&self.operation_id)?;
        if self.field_slot.side != BattleSide::Enemy {
            return Err(BattleCommandError::WrongFieldSide {
                context: "scripted enemy",
            });
        }
        if self.command.actor() != self.actor {
            return Err(BattleCommandError::ActorMismatch);
        }
        self.command.validate()?;
        validate_scripted_enemy_command_operation_id(
            &self.operation_id,
            self.battle_id,
            self.wave,
            self.turn,
            self.field_slot,
            self.script_cursor,
        )
    }

    pub fn canonical_json(&self) -> String {
        canonical_enemy_envelope(self)
    }

    pub fn fingerprint(&self) -> BattleCommandFingerprint {
        BattleCommandFingerprint::from_canonical_payload(
            COMMAND_FINGERPRINT_PREFIX,
            &self.canonical_json(),
        )
    }

    pub fn expected_operation_id(&self) -> Result<OperationId, BattleCommandError> {
        scripted_enemy_command_operation_id(
            self.battle_id,
            self.wave,
            self.turn,
            self.field_slot,
            self.script_cursor,
        )
    }
}

/// A deterministic, serializable script of already-typed enemy commands.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedEnemyPolicyV1 {
    pub schema_version: u32,
    pub cursor: SafeU53,
    pub commands: Vec<ScriptedEnemyBattleCommandV1>,
}

impl ScriptedEnemyPolicyV1 {
    pub fn new(
        cursor: SafeU53,
        commands: Vec<ScriptedEnemyBattleCommandV1>,
    ) -> Result<Self, BattleCommandError> {
        let policy = Self {
            schema_version: SCRIPTED_ENEMY_POLICY_SCHEMA_VERSION,
            cursor,
            commands,
        };
        policy.validate()?;
        Ok(policy)
    }

    pub fn with_schema_version(
        schema_version: u32,
        cursor: SafeU53,
        commands: Vec<ScriptedEnemyBattleCommandV1>,
    ) -> Result<Self, BattleCommandError> {
        let policy = Self {
            schema_version,
            cursor,
            commands,
        };
        policy.validate()?;
        Ok(policy)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_schema(self.schema_version, SCRIPTED_ENEMY_POLICY_SCHEMA_VERSION)?;
        for command in &self.commands {
            command.validate()?;
        }
        for pair in self.commands.windows(2) {
            match pair[0].script_cursor.cmp(&pair[1].script_cursor) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedScriptedPolicy),
                Ordering::Equal => return Err(BattleCommandError::DuplicateScriptCursor),
                Ordering::Less => {}
            }
        }
        Ok(())
    }

    pub fn next_command(&self) -> Option<&ScriptedEnemyBattleCommandV1> {
        self.commands
            .iter()
            .find(|command| command.script_cursor == self.cursor)
    }

    pub fn is_canonical(&self) -> bool {
        self.validate().is_ok()
    }

    pub fn validate_canonical_order(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }
}

/// Strict `bc1-<UTF-16 length>-<FNV-1a64>` command fingerprint.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BattleCommandFingerprint(String);

impl BattleCommandFingerprint {
    pub fn new(value: impl Into<String>) -> Result<Self, BattleCommandError> {
        let value = value.into();
        validate_fingerprint(&value, COMMAND_FINGERPRINT_PREFIX)?;
        Ok(Self(value))
    }

    pub fn from_human_proposal(proposal: &BattleCommandProposalV1) -> Self {
        proposal.fingerprint()
    }

    pub fn from_scripted_enemy(command: &ScriptedEnemyBattleCommandV1) -> Self {
        command.fingerprint()
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_fingerprint(&self.0, COMMAND_FINGERPRINT_PREFIX)
    }

    fn from_canonical_payload(prefix: &str, payload: &str) -> Self {
        let length = payload.encode_utf16().count();
        let hash = fnv1a64_utf16(payload);
        Self(format!("{prefix}{length}-{hash:016x}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl AsRef<str> for BattleCommandFingerprint {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for BattleCommandFingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Serialize for BattleCommandFingerprint {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for BattleCommandFingerprint {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

impl TryFrom<String> for BattleCommandFingerprint {
    type Error = BattleCommandError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

/// Strict `brp1-<UTF-16 length>-<FNV-1a64>` replacement fingerprint.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BattleReplacementProposalFingerprint(String);

impl BattleReplacementProposalFingerprint {
    pub fn new(value: impl Into<String>) -> Result<Self, BattleCommandError> {
        let value = value.into();
        validate_fingerprint(&value, REPLACEMENT_FINGERPRINT_PREFIX)?;
        Ok(Self(value))
    }

    pub fn from_proposal(proposal: &BattleReplacementProposalV1) -> Self {
        proposal.fingerprint()
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        validate_fingerprint(&self.0, REPLACEMENT_FINGERPRINT_PREFIX)
    }

    fn from_canonical_payload(prefix: &str, payload: &str) -> Self {
        let length = payload.encode_utf16().count();
        let hash = fnv1a64_utf16(payload);
        Self(format!("{prefix}{length}-{hash:016x}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl AsRef<str> for BattleReplacementProposalFingerprint {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for BattleReplacementProposalFingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Serialize for BattleReplacementProposalFingerprint {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for BattleReplacementProposalFingerprint {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

impl TryFrom<String> for BattleReplacementProposalFingerprint {
    type Error = BattleCommandError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

/// The fully admitted commands projected in canonical frontier order.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandSet {
    pub entries: Vec<AcceptedBattleCommand>,
}

impl CommandSet {
    pub fn new(entries: Vec<AcceptedBattleCommand>) -> Result<Self, BattleCommandError> {
        let set = Self { entries };
        set.validate()?;
        Ok(set)
    }

    pub fn validate(&self) -> Result<(), BattleCommandError> {
        for entry in &self.entries {
            entry.validate()?;
        }
        for pair in self.entries.windows(2) {
            match pair[0].field_slot().cmp(&pair[1].field_slot()) {
                Ordering::Greater => return Err(BattleCommandError::UnsortedCommandSet),
                Ordering::Equal => return Err(BattleCommandError::DuplicateCommandSetFieldSlot),
                Ordering::Less => {}
            }
        }
        for (index, entry) in self.entries.iter().enumerate() {
            if self.entries[..index]
                .iter()
                .any(|previous| previous.operation_id() == entry.operation_id())
            {
                return Err(BattleCommandError::DuplicateCommandSetOperation);
            }
        }
        Ok(())
    }

    pub fn is_canonical(&self) -> bool {
        self.validate().is_ok()
    }

    pub fn validate_canonical_order(&self) -> Result<(), BattleCommandError> {
        self.validate()
    }
}

/// Build a human/player command-window operation ID.
pub fn player_command_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<OperationId, BattleCommandError> {
    validate_field_slot(field_slot)?;
    if field_slot.side != BattleSide::Player {
        return Err(BattleCommandError::WrongFieldSide { context: "human" });
    }
    operation(format!(
        "battle/{}/wave/{}/turn/{}/command/player/{}/seat/{}",
        number(battle_id),
        number(wave),
        number(turn),
        field_slot.position,
        number(owner_seat.get()),
    ))
}

/// Build a scripted-enemy command-window operation ID.
pub fn scripted_enemy_command_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    script_cursor: SafeU53,
) -> Result<OperationId, BattleCommandError> {
    validate_field_slot(field_slot)?;
    if field_slot.side != BattleSide::Enemy {
        return Err(BattleCommandError::WrongFieldSide {
            context: "scripted enemy",
        });
    }
    operation(format!(
        "battle/{}/wave/{}/turn/{}/command/enemy/{}/script/{}",
        number(battle_id),
        number(wave),
        number(turn),
        field_slot.position,
        number(script_cursor),
    ))
}

/// Build a TURN result operation ID.
pub fn turn_result_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
) -> Result<OperationId, BattleCommandError> {
    operation(format!(
        "battle/{}/wave/{}/turn/{}/result",
        number(battle_id),
        number(wave),
        number(turn),
    ))
}

/// Build the exact Authority-compatible REPLACEMENT operation ID.
#[allow(clippy::too_many_arguments)]
pub fn replacement_operation_id(
    epoch: AuthorityEpoch,
    battle_id: BattleId,
    wave: WaveIndex,
    resolved_turn: TurnIndex,
    turn_occurrence: u32,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<OperationId, BattleCommandError> {
    validate_field_slot(field_slot)?;
    if field_slot.side != BattleSide::Player {
        return Err(BattleCommandError::WrongFieldSide {
            context: "replacement",
        });
    }
    operation(format!(
        "RC/e{}/b{}/w{}/t{}/o{}/f{}/s{}",
        number(epoch),
        number(battle_id),
        number(wave),
        number(resolved_turn),
        number(turn_occurrence),
        field_slot.position,
        number(owner_seat.get()),
    ))
}

/// Validate a human/player command-window operation against its typed identity.
pub fn validate_player_command_operation_id(
    operation: &OperationId,
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<(), BattleCommandError> {
    let expected = player_command_operation_id(battle_id, wave, turn, field_slot, owner_seat)?;
    validate_exact_operation(operation, &expected, "player command")
}

/// Validate a scripted-enemy command-window operation against its typed identity.
pub fn validate_scripted_enemy_command_operation_id(
    operation: &OperationId,
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    script_cursor: SafeU53,
) -> Result<(), BattleCommandError> {
    let expected =
        scripted_enemy_command_operation_id(battle_id, wave, turn, field_slot, script_cursor)?;
    validate_exact_operation(operation, &expected, "scripted enemy command")
}

/// Validate a TURN result operation against its typed identity.
pub fn validate_turn_result_operation_id(
    operation: &OperationId,
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
) -> Result<(), BattleCommandError> {
    let expected = turn_result_operation_id(battle_id, wave, turn)?;
    validate_exact_operation(operation, &expected, "turn result")
}

/// Validate a complete REPLACEMENT operation against all of its components.
#[allow(clippy::too_many_arguments)]
pub fn validate_replacement_operation_id(
    operation: &OperationId,
    epoch: AuthorityEpoch,
    battle_id: BattleId,
    wave: WaveIndex,
    resolved_turn: TurnIndex,
    turn_occurrence: u32,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<(), BattleCommandError> {
    let expected = replacement_operation_id(
        epoch,
        battle_id,
        wave,
        resolved_turn,
        turn_occurrence,
        field_slot,
        owner_seat,
    )?;
    validate_exact_operation(operation, &expected, "replacement")
}

/// Alias with the shorter name used by some adapters.
pub fn command_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<OperationId, BattleCommandError> {
    player_command_operation_id(battle_id, wave, turn, field_slot, owner_seat)
}

/// Explicit builder aliases for adapters that name operation construction as
/// a build step.
pub fn build_command_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<OperationId, BattleCommandError> {
    command_operation_id(battle_id, wave, turn, field_slot, owner_seat)
}

pub fn build_scripted_enemy_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    script_cursor: SafeU53,
) -> Result<OperationId, BattleCommandError> {
    scripted_enemy_command_operation_id(battle_id, wave, turn, field_slot, script_cursor)
}

pub fn build_turn_result_operation_id(
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
) -> Result<OperationId, BattleCommandError> {
    turn_result_operation_id(battle_id, wave, turn)
}

#[allow(clippy::too_many_arguments)]
pub fn build_replacement_operation_id(
    epoch: AuthorityEpoch,
    battle_id: BattleId,
    wave: WaveIndex,
    resolved_turn: TurnIndex,
    turn_occurrence: u32,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<OperationId, BattleCommandError> {
    replacement_operation_id(
        epoch,
        battle_id,
        wave,
        resolved_turn,
        turn_occurrence,
        field_slot,
        owner_seat,
    )
}

pub fn validate_command_operation_id(
    operation: &OperationId,
    battle_id: BattleId,
    wave: WaveIndex,
    turn: TurnIndex,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<(), BattleCommandError> {
    validate_player_command_operation_id(operation, battle_id, wave, turn, field_slot, owner_seat)
}

#[allow(clippy::too_many_arguments)]
fn validate_replacement_operation_skeleton(
    operation: &OperationId,
    battle_id: BattleId,
    wave: WaveIndex,
    resolved_turn: TurnIndex,
    turn_occurrence: u32,
    field_slot: FieldSlot,
    owner_seat: SeatId,
) -> Result<(), BattleCommandError> {
    validate_operation_id(operation)?;
    validate_field_slot(field_slot)?;
    if field_slot.side != BattleSide::Player {
        return Err(BattleCommandError::WrongFieldSide {
            context: "replacement",
        });
    }
    let parts: Vec<&str> = operation.as_str().split('/').collect();
    if parts.len() != 8 || parts[0] != "RC" {
        return Err(BattleCommandError::OperationGrammarMismatch {
            context: "replacement",
        });
    }
    let _epoch = parse_prefixed_decimal(parts[1], 'e')?;
    expect_prefixed_decimal(parts[2], 'b', number(battle_id))?;
    expect_prefixed_decimal(parts[3], 'w', number(wave))?;
    expect_prefixed_decimal(parts[4], 't', number(resolved_turn))?;
    expect_prefixed_decimal(parts[5], 'o', number(turn_occurrence))?;
    expect_prefixed_decimal(parts[6], 'f', u64::from(field_slot.position))?;
    expect_prefixed_decimal(parts[7], 's', number(owner_seat.get()))?;
    Ok(())
}

fn validate_schema(actual: u32, expected: u32) -> Result<(), BattleCommandError> {
    if actual == expected {
        Ok(())
    } else {
        Err(BattleCommandError::SchemaVersionMismatch { expected, actual })
    }
}

fn validate_control_id(value: &str) -> Result<(), BattleCommandError> {
    validate_authority_material_digest(value).map_err(|_| BattleCommandError::InvalidControlId)
}

fn validate_operation_id(value: &OperationId) -> Result<(), BattleCommandError> {
    validate_authority_operation_id(value.as_str())
        .map_err(|error| BattleCommandError::InvalidOperationId(error.to_string()))
}

fn operation(value: String) -> Result<OperationId, BattleCommandError> {
    let id = OperationId::new(value)
        .map_err(|error| BattleCommandError::InvalidOperationId(error.to_string()))?;
    validate_operation_id(&id)?;
    Ok(id)
}

fn validate_exact_operation(
    actual: &OperationId,
    expected: &OperationId,
    context: &'static str,
) -> Result<(), BattleCommandError> {
    validate_operation_id(actual)?;
    if actual == expected {
        Ok(())
    } else {
        Err(BattleCommandError::OperationIdMismatch { context })
    }
}

fn parse_prefixed_decimal(value: &str, prefix: char) -> Result<u64, BattleCommandError> {
    let Some(decimal) = value.strip_prefix(prefix) else {
        return Err(BattleCommandError::OperationGrammarMismatch {
            context: "replacement",
        });
    };
    parse_canonical_decimal(decimal)
}

fn expect_prefixed_decimal(
    value: &str,
    prefix: char,
    expected: u64,
) -> Result<(), BattleCommandError> {
    if parse_prefixed_decimal(value, prefix)? == expected {
        Ok(())
    } else {
        Err(BattleCommandError::OperationIdMismatch {
            context: "replacement",
        })
    }
}

fn parse_canonical_decimal(value: &str) -> Result<u64, BattleCommandError> {
    if value.is_empty()
        || (value.len() > 1 && value.as_bytes().first() == Some(&b'0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(BattleCommandError::OperationGrammarMismatch {
            context: "replacement",
        });
    }
    let parsed =
        value
            .parse::<u64>()
            .map_err(|_| BattleCommandError::OperationGrammarMismatch {
                context: "replacement",
            })?;
    SafeU53::new(parsed).map_err(|_| BattleCommandError::OperationGrammarMismatch {
        context: "replacement",
    })?;
    Ok(parsed)
}

fn validate_sorted_unique_field_slots(slots: &[FieldSlot]) -> Result<(), BattleCommandError> {
    if slots.is_empty() {
        return Err(BattleCommandError::EmptyTargetSelection);
    }
    for slot in slots {
        validate_field_slot(*slot)?;
    }
    for pair in slots.windows(2) {
        match pair[0].cmp(&pair[1]) {
            Ordering::Greater => return Err(BattleCommandError::UnsortedTargetSelection),
            Ordering::Equal => return Err(BattleCommandError::DuplicateTargetSelection),
            Ordering::Less => {}
        }
    }
    Ok(())
}

fn validate_field_slot(slot: FieldSlot) -> Result<(), BattleCommandError> {
    if slot.position <= MAX_FIELD_POSITION {
        Ok(())
    } else {
        Err(BattleCommandError::InvalidFieldPosition {
            position: slot.position,
        })
    }
}

fn compare_target_selections(
    left: &BattleTargetSelection,
    right: &BattleTargetSelection,
) -> Ordering {
    match (left, right) {
        (BattleTargetSelection::Implicit, BattleTargetSelection::Implicit) => Ordering::Equal,
        (BattleTargetSelection::Implicit, BattleTargetSelection::Selected(_)) => Ordering::Less,
        (BattleTargetSelection::Selected(_), BattleTargetSelection::Implicit) => Ordering::Greater,
        (BattleTargetSelection::Selected(left), BattleTargetSelection::Selected(right)) => {
            left.cmp(right)
        }
    }
}

fn cmp_operation_ids(left: &OperationId, right: &OperationId) -> Ordering {
    cmp_utf16(left.as_str(), right.as_str())
}

fn cmp_utf16(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn validate_fingerprint(value: &str, prefix: &str) -> Result<(), BattleCommandError> {
    validate_authority_material_digest(value)
        .map_err(|_| BattleCommandError::InvalidFingerprintFormat)?;
    let Some(rest) = value.strip_prefix(prefix) else {
        return Err(BattleCommandError::InvalidFingerprintFormat);
    };
    let Some((length, hash)) = rest.split_once('-') else {
        return Err(BattleCommandError::InvalidFingerprintFormat);
    };
    if length.is_empty()
        || (length.len() > 1 && length.as_bytes().first() == Some(&b'0'))
        || !length.bytes().all(|byte| byte.is_ascii_digit())
        || length.parse::<usize>().is_err()
        || hash.len() != 16
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(BattleCommandError::InvalidFingerprintFormat);
    }
    Ok(())
}

fn number<T: Into<u64>>(value: T) -> u64 {
    value.into()
}

fn canonical_human_envelope(proposal: &BattleCommandProposalV1) -> String {
    canonical_object(vec![
        ("kind", json_string("HUMAN")),
        ("proposal", canonical_human_proposal(proposal)),
    ])
}

fn canonical_enemy_envelope(command: &ScriptedEnemyBattleCommandV1) -> String {
    canonical_object(vec![
        ("kind", json_string("SCRIPTED_ENEMY")),
        ("command", canonical_scripted_command(command)),
    ])
}

fn canonical_human_proposal(proposal: &BattleCommandProposalV1) -> String {
    canonical_object(vec![
        (
            "schema_version",
            json_u64(u64::from(proposal.schema_version)),
        ),
        ("operation_id", json_string(proposal.operation_id.as_str())),
        ("battle_id", json_u64(number(proposal.battle_id))),
        ("wave", json_u64(number(proposal.wave))),
        ("turn", json_u64(number(proposal.turn))),
        ("owner_seat", json_u64(number(proposal.owner_seat.get()))),
        ("actor", json_u64(number(proposal.actor))),
        ("field_slot", canonical_field_slot(proposal.field_slot)),
        ("command", canonical_command(&proposal.command)),
        (
            "menu_instance_id",
            json_u64(number(proposal.menu_instance_id)),
        ),
        ("control_id", json_string(&proposal.control_id)),
    ])
}

fn canonical_scripted_command(command: &ScriptedEnemyBattleCommandV1) -> String {
    canonical_object(vec![
        (
            "schema_version",
            json_u64(u64::from(command.schema_version)),
        ),
        ("operation_id", json_string(command.operation_id.as_str())),
        ("battle_id", json_u64(number(command.battle_id))),
        ("wave", json_u64(number(command.wave))),
        ("turn", json_u64(number(command.turn))),
        ("script_cursor", json_u64(number(command.script_cursor))),
        ("actor", json_u64(number(command.actor))),
        ("field_slot", canonical_field_slot(command.field_slot)),
        ("command", canonical_command(&command.command)),
    ])
}

fn canonical_replacement_proposal(proposal: &BattleReplacementProposalV1) -> String {
    canonical_object(vec![
        (
            "schema_version",
            json_u64(u64::from(proposal.schema_version)),
        ),
        ("operation_id", json_string(proposal.operation_id.as_str())),
        ("battle_id", json_u64(number(proposal.battle_id))),
        ("wave", json_u64(number(proposal.wave))),
        ("resolved_turn", json_u64(number(proposal.resolved_turn))),
        ("owner_seat", json_u64(number(proposal.owner_seat.get()))),
        ("occurrence", json_u64(number(proposal.occurrence))),
        (
            "turn_occurrence",
            json_u64(u64::from(proposal.turn_occurrence)),
        ),
        ("field_slot", canonical_field_slot(proposal.field_slot)),
        (
            "selection",
            canonical_replacement_selection(proposal.selection),
        ),
        (
            "menu_instance_id",
            json_u64(number(proposal.menu_instance_id)),
        ),
        ("control_id", json_string(&proposal.control_id)),
    ])
}

fn canonical_command(command: &BattleCommand) -> String {
    match command {
        BattleCommand::Fight {
            actor,
            move_slot,
            targets,
        } => canonical_object(vec![
            ("kind", json_string("FIGHT")),
            ("actor", json_u64(number(*actor))),
            ("move_slot", json_u64(u64::from(move_slot.get()))),
            ("targets", canonical_target_selection(targets)),
        ]),
        BattleCommand::Switch { actor, party_slot } => canonical_object(vec![
            ("kind", json_string("SWITCH")),
            ("actor", json_u64(number(*actor))),
            ("party_slot", json_u64(u64::from(party_slot.get()))),
        ]),
    }
}

fn canonical_target_selection(selection: &BattleTargetSelection) -> String {
    match selection {
        BattleTargetSelection::Implicit => {
            canonical_object(vec![("kind", json_string("IMPLICIT"))])
        }
        BattleTargetSelection::Selected(targets) => canonical_object(vec![
            ("kind", json_string("SELECTED")),
            (
                "value",
                canonical_array(targets.iter().copied().map(canonical_field_slot).collect()),
            ),
        ]),
    }
}

fn canonical_replacement_selection(selection: ReplacementSelection) -> String {
    match selection {
        ReplacementSelection::Selected {
            party_slot,
            pokemon,
        } => canonical_object(vec![
            ("kind", json_string("SELECTED")),
            ("party_slot", json_u64(u64::from(party_slot.get()))),
            ("pokemon", json_u64(number(pokemon))),
        ]),
        ReplacementSelection::NoLegalReplacement => {
            canonical_object(vec![("kind", json_string("NO_LEGAL_REPLACEMENT"))])
        }
    }
}

fn canonical_field_slot(slot: FieldSlot) -> String {
    canonical_object(vec![
        (
            "side",
            json_string(match slot.side {
                BattleSide::Player => "PLAYER",
                BattleSide::Enemy => "ENEMY",
            }),
        ),
        ("position", json_u64(u64::from(slot.position))),
    ])
}

fn canonical_object(mut fields: Vec<(&str, String)>) -> String {
    fields.sort_by(|left, right| cmp_utf16(left.0, right.0));
    let mut output = String::from("{");
    for (index, (key, value)) in fields.into_iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        output.push_str(&json_string(key));
        output.push(':');
        output.push_str(&value);
    }
    output.push('}');
    output
}

fn canonical_array(values: Vec<String>) -> String {
    let mut output = String::from("[");
    for (index, value) in values.into_iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        output.push_str(&value);
    }
    output.push(']');
    output
}

fn json_u64(value: u64) -> String {
    value.to_string()
}

fn json_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{001f}' => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

fn fnv1a64_utf16(value: &str) -> u64 {
    let mut hash = FNV1A64_OFFSET;
    for unit in value.encode_utf16() {
        hash ^= u64::from(unit);
        hash = hash.wrapping_mul(FNV1A64_PRIME);
    }
    hash
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::battle_ids::{BattleId, FieldSlot, MoveSlotIndex, PartyIndex, PokemonId};
    use crate::ids::{JS_MAX_SAFE_INTEGER, SafeU53};

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).unwrap_or(SafeU53::ZERO)
    }

    fn battle_id(value: u64) -> BattleId {
        BattleId::new(safe(value))
    }

    fn pokemon(value: u64) -> PokemonId {
        PokemonId::new(safe(value))
    }

    fn player(position: u8) -> FieldSlot {
        FieldSlot::new(BattleSide::Player, position).unwrap_or(FieldSlot {
            side: BattleSide::Player,
            position: 0,
        })
    }

    fn enemy(position: u8) -> FieldSlot {
        FieldSlot::new(BattleSide::Enemy, position).unwrap_or(FieldSlot {
            side: BattleSide::Enemy,
            position: 0,
        })
    }

    fn operation(value: String) -> OperationId {
        OperationId::new(value).unwrap_or_else(|_| OperationId::new("invalid").unwrap())
    }

    fn fight_command(actor: PokemonId, target: FieldSlot) -> BattleCommand {
        BattleCommand::fight(
            actor,
            MoveSlotIndex::new(0).unwrap_or(MoveSlotIndex::ZERO),
            BattleTargetSelection::selected(vec![target])
                .unwrap_or(BattleTargetSelection::Implicit),
        )
        .unwrap_or_else(|_| BattleCommand::switch(actor, PartyIndex::ZERO))
    }

    fn human_proposal() -> BattleCommandProposalV1 {
        let battle = battle_id(7);
        let wave = WaveIndex::new(safe(2)).unwrap_or_else(|_| WaveIndex::new(safe(1)).unwrap());
        let turn = TurnIndex::new(safe(3)).unwrap_or_else(|_| TurnIndex::new(safe(1)).unwrap());
        let slot = player(0);
        let operation =
            player_command_operation_id(battle, wave, turn, slot, SeatId::new(safe(1))).unwrap();
        BattleCommandProposalV1::new(
            operation,
            battle,
            wave,
            turn,
            SeatId::new(safe(1)),
            pokemon(11),
            slot,
            fight_command(pokemon(11), enemy(0)),
            MenuInstanceId::new(safe(9)),
            "control/é🙂",
        )
        .unwrap()
    }

    fn scripted_command() -> ScriptedEnemyBattleCommandV1 {
        let battle = battle_id(7);
        let wave = WaveIndex::new(safe(2)).unwrap_or_else(|_| WaveIndex::new(safe(1)).unwrap());
        let turn = TurnIndex::new(safe(3)).unwrap_or_else(|_| TurnIndex::new(safe(1)).unwrap());
        let slot = enemy(0);
        let operation =
            scripted_enemy_command_operation_id(battle, wave, turn, slot, safe(4)).unwrap();
        ScriptedEnemyBattleCommandV1::new(
            operation,
            battle,
            wave,
            turn,
            safe(4),
            pokemon(21),
            slot,
            fight_command(pokemon(21), player(0)),
        )
        .unwrap()
    }

    #[test]
    fn target_selection_rejects_empty_duplicate_and_unsorted_vectors() {
        assert_eq!(
            BattleTargetSelection::selected(Vec::new()),
            Err(BattleCommandError::EmptyTargetSelection)
        );
        assert_eq!(
            BattleTargetSelection::selected(vec![enemy(0), enemy(0)]),
            Err(BattleCommandError::DuplicateTargetSelection)
        );
        assert_eq!(
            BattleTargetSelection::selected(vec![enemy(1), enemy(0)]),
            Err(BattleCommandError::UnsortedTargetSelection)
        );
    }

    #[test]
    fn offers_and_command_frontiers_require_deterministic_order() {
        let move_zero = OfferedMoveCommand::new(
            MoveSlotIndex::new(0).unwrap(),
            vec![BattleTargetSelection::Implicit],
        )
        .unwrap();
        let move_one = OfferedMoveCommand::new(
            MoveSlotIndex::new(1).unwrap(),
            vec![BattleTargetSelection::selected(vec![enemy(0)]).unwrap()],
        )
        .unwrap();
        let offer = BattleCommandOffer::new(vec![move_zero.clone(), move_one], vec![]).unwrap();
        assert!(offer.is_canonical());
        assert!(
            BattleCommandOffer::new(vec![move_zero.clone(), move_zero.clone()], vec![]).is_err()
        );
        assert!(
            BattleCommandOffer::new(
                vec![
                    OfferedMoveCommand::new(
                        MoveSlotIndex::new(1).unwrap(),
                        vec![BattleTargetSelection::Implicit],
                    )
                    .unwrap(),
                    move_zero.clone(),
                ],
                vec![]
            )
            .is_err()
        );
    }

    #[test]
    fn operation_builders_and_validators_are_exact_and_reject_stale_or_malformed_ids() {
        let proposal = human_proposal();
        assert_eq!(
            proposal.expected_operation_id().unwrap(),
            proposal.operation_id
        );
        assert!(
            validate_player_command_operation_id(
                &proposal.operation_id,
                proposal.battle_id,
                proposal.wave,
                proposal.turn,
                proposal.field_slot,
                proposal.owner_seat,
            )
            .is_ok()
        );
        let stale = operation("battle/7/wave/2/turn/4/command/player/0/seat/1".to_owned());
        assert!(
            validate_player_command_operation_id(
                &stale,
                proposal.battle_id,
                proposal.wave,
                proposal.turn,
                proposal.field_slot,
                proposal.owner_seat,
            )
            .is_err()
        );
        let malformed = operation("battle/07/wave/2/turn/3/command/player/0/seat/1".to_owned());
        assert!(
            validate_player_command_operation_id(
                &malformed,
                proposal.battle_id,
                proposal.wave,
                proposal.turn,
                proposal.field_slot,
                proposal.owner_seat,
            )
            .is_err()
        );

        let replacement = replacement_operation_id(
            AuthorityEpoch::new(safe(8)),
            proposal.battle_id,
            proposal.wave,
            proposal.turn,
            5,
            player(1),
            proposal.owner_seat,
        )
        .unwrap();
        assert!(
            validate_replacement_operation_id(
                &replacement,
                AuthorityEpoch::new(safe(8)),
                proposal.battle_id,
                proposal.wave,
                proposal.turn,
                5,
                player(1),
                proposal.owner_seat,
            )
            .is_ok()
        );
        assert!(
            validate_replacement_operation_id(
                &replacement,
                AuthorityEpoch::new(safe(9)),
                proposal.battle_id,
                proposal.wave,
                proposal.turn,
                5,
                player(1),
                proposal.owner_seat,
            )
            .is_err()
        );
    }

    #[test]
    fn fingerprints_use_explicit_tags_sorted_keys_utf16_length_and_fnv1a64() {
        let proposal = human_proposal();
        let canonical = proposal.canonical_json();
        assert!(canonical.starts_with(r#"{"kind":"HUMAN","proposal":{"actor"#));
        assert!(canonical.contains("\"control_id\":\"control/é🙂\""));
        let fingerprint = proposal.fingerprint();
        let suffix = fingerprint.as_str().strip_prefix("bc1-").unwrap_or("");
        let length = suffix
            .split('-')
            .next()
            .unwrap_or("")
            .parse::<usize>()
            .unwrap_or(0);
        assert_eq!(length, canonical.encode_utf16().count());
        assert_eq!(
            fingerprint.as_str(),
            BattleCommandFingerprint::from_human_proposal(&proposal).as_str()
        );

        let scripted = scripted_command();
        assert!(
            scripted
                .canonical_json()
                .contains(r#""kind":"SCRIPTED_ENEMY""#)
        );
        let enemy_fingerprint = scripted.fingerprint();
        assert!(enemy_fingerprint.as_str().starts_with("bc1-"));
        assert_ne!(fingerprint, enemy_fingerprint);
    }

    #[test]
    fn replacement_occurrence_identities_have_distinct_operation_and_fingerprint_roles() {
        let human = human_proposal();
        let epoch = AuthorityEpoch::new(safe(1));
        let replacement_operation = replacement_operation_id(
            epoch,
            human.battle_id,
            human.wave,
            human.turn,
            2,
            human.field_slot,
            human.owner_seat,
        )
        .unwrap();
        let first = BattleReplacementProposalV1::new(
            replacement_operation.clone(),
            human.battle_id,
            human.wave,
            human.turn,
            human.owner_seat,
            FaintOccurrenceId::new(safe(9)),
            2,
            human.field_slot,
            ReplacementSelection::selected(PartyIndex::ZERO, human.actor),
            human.menu_instance_id,
            "replacement/first",
        )
        .unwrap();
        let second = BattleReplacementProposalV1 {
            occurrence: FaintOccurrenceId::new(safe(10)),
            ..first.clone()
        };
        second.validate().unwrap();

        assert_eq!(first.operation_id, second.operation_id);
        assert_eq!(
            first.expected_operation_id(epoch).unwrap(),
            replacement_operation
        );
        assert_ne!(first.fingerprint(), second.fingerprint());
        assert!(first.canonical_json().contains(r#""occurrence":9"#));
        assert!(first.canonical_json().contains(r#""turn_occurrence":2"#));

        let later_operation = replacement_operation_id(
            epoch,
            human.battle_id,
            human.wave,
            human.turn,
            3,
            human.field_slot,
            human.owner_seat,
        )
        .unwrap();
        assert_ne!(replacement_operation, later_operation);
        assert!(later_operation.as_str().contains("/o3/f"));

        let substituted_global = BattleReplacementProposalV1 {
            operation_id: operation("RC/e1/b7/w2/t3/o9/f0/s1".to_owned()),
            ..first
        };
        assert_eq!(
            substituted_global.validate(),
            Err(BattleCommandError::OperationIdMismatch {
                context: "replacement"
            })
        );
    }

    #[test]
    fn replacement_fingerprint_includes_unicode_and_rejects_internal_no_legal_submission() {
        let human = human_proposal();
        let operation = replacement_operation_id(
            AuthorityEpoch::new(safe(1)),
            human.battle_id,
            human.wave,
            human.turn,
            0,
            human.field_slot,
            human.owner_seat,
        )
        .unwrap();
        let proposal = BattleReplacementProposalV1::new(
            operation,
            human.battle_id,
            human.wave,
            human.turn,
            human.owner_seat,
            FaintOccurrenceId::new(safe(2)),
            0,
            human.field_slot,
            ReplacementSelection::selected(PartyIndex::ZERO, human.actor),
            human.menu_instance_id,
            "replacement/🙂",
        )
        .unwrap();
        let fingerprint = proposal.fingerprint();
        let payload_length = proposal.canonical_json().encode_utf16().count();
        assert_eq!(
            fingerprint
                .as_str()
                .strip_prefix("brp1-")
                .and_then(|value| value.split('-').next())
                .and_then(|value| value.parse::<usize>().ok()),
            Some(payload_length)
        );

        let no_legal_operation = replacement_operation_id(
            AuthorityEpoch::new(safe(1)),
            human.battle_id,
            human.wave,
            human.turn,
            0,
            human.field_slot,
            human.owner_seat,
        )
        .unwrap();
        assert_eq!(
            BattleReplacementProposalV1::new(
                no_legal_operation,
                human.battle_id,
                human.wave,
                human.turn,
                human.owner_seat,
                FaintOccurrenceId::new(safe(2)),
                0,
                human.field_slot,
                ReplacementSelection::NoLegalReplacement,
                human.menu_instance_id,
                "replacement",
            )
            .err(),
            Some(BattleCommandError::NoLegalReplacementProposal)
        );
    }

    #[test]
    fn accepted_commands_and_policy_reject_forged_fingerprints_or_wrong_order() {
        let proposal = human_proposal();
        let accepted = AcceptedBattleCommand::human(proposal.clone());
        assert!(accepted.validate().is_ok());
        let forged = AcceptedBattleCommand::Human {
            proposal,
            fingerprint: BattleCommandFingerprint::new("bc1-1-0000000000000000").unwrap(),
        };
        assert_eq!(
            forged.validate(),
            Err(BattleCommandError::FingerprintMismatch)
        );

        let command = scripted_command();
        let later_cursor = safe(5);
        let later_operation = scripted_enemy_command_operation_id(
            command.battle_id,
            command.wave,
            command.turn,
            command.field_slot,
            later_cursor,
        )
        .unwrap_or_else(|_| command.operation_id.clone());
        let later = ScriptedEnemyBattleCommandV1 {
            operation_id: later_operation,
            script_cursor: later_cursor,
            ..command.clone()
        };
        let policy = ScriptedEnemyPolicyV1::new(safe(4), vec![command.clone(), later]);
        assert!(policy.is_ok());
        assert_eq!(policy.unwrap().next_command(), Some(&command));
        let duplicate = ScriptedEnemyPolicyV1::new(safe(4), vec![command.clone(), command]);
        assert_eq!(
            duplicate.err(),
            Some(BattleCommandError::DuplicateScriptCursor)
        );
    }

    #[test]
    fn strict_tagged_serde_requires_fields_rejects_unknowns_and_round_trips() {
        let command = fight_command(pokemon(3), enemy(0));
        let encoded = serde_json::to_string(&command).unwrap();
        assert_eq!(
            encoded,
            r#"{"kind":"FIGHT","actor":3,"move_slot":0,"targets":{"kind":"SELECTED","value":[{"side":"ENEMY","position":0}]}}"#
        );
        let decoded: BattleCommand = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, command);
        assert!(serde_json::from_str::<BattleCommand>(
            r#"{"kind":"FIGHT","actor":3,"move_slot":0,"targets":{"kind":"SELECTED","value":[{"side":"ENEMY","position":0}]},"extra":true}"#
        )
        .is_err());
        assert!(serde_json::from_str::<BattleCommand>(r#"{"kind":"FIGHT","actor":3}"#).is_err());
        assert!(serde_json::from_str::<BattleCommand>(r#"{"kind":"FLY","actor":3}"#).is_err());

        let fingerprint = BattleCommandFingerprint::new("bc1-1-0123456789abcdef").unwrap();
        assert_eq!(
            serde_json::to_string(&fingerprint).unwrap(),
            r#""bc1-1-0123456789abcdef""#
        );
        assert!(BattleCommandFingerprint::new("bc1-01-0123456789abcdef").is_err());
        assert!(BattleCommandFingerprint::new("bc1-1-0123456789ABCDEf").is_err());
        assert!(
            serde_json::from_str::<BattleCommandFingerprint>(r#""bc1-1-0123456789abcdeg""#)
                .is_err()
        );
    }

    #[test]
    fn max_safe_ids_are_preserved_in_operation_grammar_and_fingerprint_payloads() {
        let battle = battle_id(JS_MAX_SAFE_INTEGER);
        let wave = WaveIndex::new(SafeU53::MAX).unwrap();
        let turn = TurnIndex::new(SafeU53::MAX).unwrap();
        let operation =
            player_command_operation_id(battle, wave, turn, player(2), SeatId::new(SafeU53::MAX))
                .unwrap();
        assert!(operation.as_str().contains("9007199254740991"));
        let proposal = BattleCommandProposalV1::new(
            operation,
            battle,
            wave,
            turn,
            SeatId::new(SafeU53::MAX),
            pokemon(JS_MAX_SAFE_INTEGER),
            player(2),
            BattleCommand::switch(pokemon(JS_MAX_SAFE_INTEGER), PartyIndex::new(5).unwrap()),
            MenuInstanceId::new(SafeU53::MAX),
            "control/max",
        )
        .unwrap();
        assert!(proposal.fingerprint().as_str().starts_with("bc1-"));
        assert!(proposal.validate().is_ok());
    }

    #[test]
    fn command_set_and_collection_validate_canonical_slot_order_and_projection() {
        let human = AcceptedBattleCommand::human(human_proposal());
        let scripted = AcceptedBattleCommand::scripted_enemy(scripted_command());
        let set = CommandSet::new(vec![human.clone(), scripted.clone()]).unwrap();
        assert!(set.is_canonical());
        assert!(CommandSet::new(vec![scripted.clone(), human.clone()]).is_err());

        let player_entry = CommandFrontierEntry::new(
            human.operation_id().clone(),
            Some(SeatId::new(safe(1))),
            human.actor(),
            human.field_slot(),
            BattleCommandOffer::new(vec![], vec![]).unwrap(),
            CommandFrontierStatus::Admitted {
                command: human,
                source: CommandAdmissionSource::AuthorityRemoteProposal,
            },
        )
        .unwrap();
        let enemy_entry = CommandFrontierEntry::new(
            scripted.operation_id().clone(),
            None,
            scripted.actor(),
            scripted.field_slot(),
            BattleCommandOffer::new(vec![], vec![]).unwrap(),
            CommandFrontierStatus::Admitted {
                command: scripted,
                source: CommandAdmissionSource::ScriptedEnemy,
            },
        )
        .unwrap();
        let state = CommandCollectionState::new(vec![player_entry, enemy_entry], vec![]).unwrap();
        assert_eq!(state.admitted_command_set().unwrap().entries.len(), 2);
    }
}
