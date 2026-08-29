//! M3A-07 owns canonical battle and party state.

use serde::{Deserialize, Serialize};

use crate::conditions::{
    ArenaConditionState, GlobalAbilitySuppressionState, TerrainState, WeatherState,
};
use crate::field::FieldState;
use crate::format::BattleFormat;
use crate::pokemon::PokemonState;

pub const BATTLE_STATE_SCHEMA_VERSION: u32 = 1;

pub use er_rng::battle::BattleRngState;
pub use er_types::SeatId;

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

/// Canonical mechanical state for one active battle.
///
/// Full Pokémon records live only in the two party vectors. `field` stores
/// stable identities into those vectors, and `battle_rng` is the exact shared
/// RNG state rather than a state-local approximation. Cross-field and content
/// invariants are deliberately owned by M3A-08.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleState {
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    /// Exact production `BattleScene.waveSeed` used by isolated seed-offset
    /// mechanics such as the supported speed-tie shuffle.
    pub wave_seed: String,
    pub turn: TurnIndex,
    pub format: BattleFormat,
    pub authority_seat: SeatId,
    pub player_party: Vec<PokemonState>,
    pub enemy_party: Vec<PokemonState>,
    pub field: FieldState,
    pub weather: WeatherState,
    pub terrain: TerrainState,
    pub arena_conditions: Vec<ArenaConditionState>,
    pub global_ability_suppression: GlobalAbilitySuppressionState,
    pub battle_rng: BattleRngState,
    pub command_state: CommandCollectionState,
    pub faint_queue: Vec<FaintOccurrence>,
    pub next_faint_occurrence: FaintOccurrenceId,
    pub outcome: BattleOutcome,
}
