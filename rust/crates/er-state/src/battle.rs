//! M3A-07 owns canonical battle and party state.
//!
//! The composite `BattleState` DTO is intentionally held at the dependency
//! boundary until M3A-01 integrates the frozen `er_rng::battle::BattleRngState`
//! export.  Defining a local replacement would create a second RNG identity
//! and violate the M3 contract.  The already-integrated battle leaves are
//! re-exported here so callers use the shared IDs, condition/outcome values,
//! and command DTOs while that integration request is outstanding.

pub const BATTLE_STATE_SCHEMA_VERSION: u32 = 1;

pub use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandOffer, BattleCommandProposalV1,
    BattleReplacementProposalV1, BattleTargetSelection, CommandAdmissionSource,
    CommandCollectionState, CommandFingerprintEntry, CommandFrontierEntry, CommandFrontierStatus,
    OfferedMoveCommand, OfferedSwitchCommand, ReplacementProposalFingerprintEntry,
};
pub use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, MoveSlotIndex, PartyIndex,
    PokemonId, TurnIndex, WaveIndex,
};
pub use er_types::battle_model::{
    BattleOutcome, FaintOccurrence, FaintSource, ReplacementProgress,
};
