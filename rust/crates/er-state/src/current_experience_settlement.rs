//! Retained descendants of a source-owned Victory experience transaction.
//! These are requests/results, never standalone authorization to mutate a run.
use er_types::battle_ids::{MoveId, MoveSlotIndex, PokemonId};
use er_types::battle_model::{BattleStats, MoveSlotState};
use er_types::run_ids::Experience;
use er_types::{EvolutionId, SafeU53};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentExperiencePhaseV1 {
    pub pending_id: SafeU53,
    pub pokemon: PokemonId,
    pub party_index: u8,
    pub on_field: bool,
    /// Ordinary unmodified applyPartyExp has already floored this argument.
    pub phase_argument: Experience,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentExperienceAwardV1 {
    pub phase: CurrentExperiencePhaseV1,
    pub experience: Experience,
    pub last_level: u16,
    pub last_experience: Experience,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentLevelUpV1 {
    pub award: CurrentExperienceAwardV1,
    pub previous_level: u16,
    pub new_level: u16,
    pub previous_stats: BattleStats,
}

/// Actual LevelUpPhase.end must still execute after its stat presentation.
/// Retain the request even if no move/evolution has yet been selected; absence
/// of a computed candidate list must never mean the descendants are complete.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentLevelUpEndV1 {
    pub level_up: CurrentLevelUpV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentLevelUpChildrenV1 {
    pub parent: CurrentLevelUpEndV1,
    /// Source getLevelMoves order, before batch start removes already-known moves.
    pub learn_move_candidates: Vec<MoveId>,
    /// Source getValidEvolutions result captured at LevelUpPhase.end. A learn
    /// decision cannot retrospectively alter this already-created child list.
    pub evolution_candidates: Vec<EvolutionId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentLearnMoveAssignmentV1 {
    pub move_id: MoveId,
    pub slot: MoveSlotIndex,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentLearnMoveBatchV1 {
    pub children: CurrentLevelUpChildrenV1,
    pub offered: Vec<MoveId>,
    pub original_moves: [Option<MoveSlotState>; 4],
    /// Assignment order is observable even when several moves overwrite one slot.
    pub assignments: Vec<CurrentLearnMoveAssignmentV1>,
    pub pending_move: Option<MoveId>,
    pub list_cursor: u16,
    pub cancel_confirmation: bool,
    pub complete: bool,
}
