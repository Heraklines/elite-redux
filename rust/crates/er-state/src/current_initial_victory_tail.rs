//! Source-addressed first-wave tail; retained independently of a live turn.
use serde::{Deserialize, Serialize};
use er_types::{SafeU53, battle_ids::PokemonId};
use crate::current_experience_owner::CurrentExperienceRecipientV1;
use crate::current_faint_execution::CurrentFaintAddressV1;
use crate::current_turn_execution::CurrentTurnExecutionV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentInitialVictoryTailV1 {
    pub faint: CurrentFaintAddressV1,
    /// Exact selected actions, including the suffix source removes from its queue.
    /// Retaining these is not an assertion that the suffix executed.
    pub original_turn: Box<CurrentTurnExecutionV1>,
    pub cancelled_from: u8,
    pub cancelled_to: u8,
    pub phase: CurrentInitialVictoryTailPhaseV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentInitialVictoryTailPhaseV1 {
    /// Win-site predicates were observed before the queued XP children executed.
    Claimed,
    TurnSettlement { xp_endpoint: Vec<CurrentExperienceRecipientV1> },
    BattleEnd { xp_endpoint: Vec<CurrentExperienceRecipientV1>, field_turns: Vec<CurrentFieldTurnCountV1> },
    /// This is a real post-BattleEnd state, not a reward or next-wave grant.
    EggLapse {
        xp_endpoint: Vec<CurrentExperienceRecipientV1>,
        field_turns: Vec<CurrentFieldTurnCountV1>,
        accounting: CurrentInitialBattleEndAccountingV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFieldTurnCountV1 {
    pub pokemon: PokemonId,
    pub turn_count: SafeU53,
    pub wave_turn_count: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentInitialBattleEndAccountingV1 {
    /// These are source totals after the first battle of an actual fresh account.
    pub battles: SafeU53,
    pub score: SafeU53,
    pub money_streaks: Vec<(PokemonId, SafeU53)>,
    pub money_multiplier: SafeU53,
    pub money_multiplier_captured: bool,
}

impl CurrentInitialVictoryTailV1 {
    pub fn xp_endpoint(&self) -> Option<&[CurrentExperienceRecipientV1]> {
        match &self.phase {
            CurrentInitialVictoryTailPhaseV1::Claimed => None,
            CurrentInitialVictoryTailPhaseV1::TurnSettlement { xp_endpoint }
            | CurrentInitialVictoryTailPhaseV1::BattleEnd { xp_endpoint, .. }
            | CurrentInitialVictoryTailPhaseV1::EggLapse { xp_endpoint, .. } => Some(xp_endpoint),
        }
    }

    pub fn turn_is_settled(&self) -> bool {
        matches!(&self.phase, CurrentInitialVictoryTailPhaseV1::BattleEnd { .. }
            | CurrentInitialVictoryTailPhaseV1::EggLapse { .. })
    }
}
