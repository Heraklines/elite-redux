//! Actual initial enemy Faint bookkeeping and asynchronous descendant ownership.
use er_types::{SafeU53, PresentationEventId, battle_ids::{PokemonId, MoveId, FieldSlot, TurnIndex, BattleSide}};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFaintAddressV1 {
    pub pending_id: SafeU53,
    pub observation: SafeU53,
    pub faint_id: SafeU53,
    pub pokemon: PokemonId,
    pub slot: FieldSlot,
    pub turn: TurnIndex,
    pub source: PokemonId,
    pub move_id: MoveId,
    pub score_increase: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentEnemyFaintHistoryV1 {
    pub pokemon: PokemonId,
    pub turn: TurnIndex,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentFaintPhaseV1 {
    Animation { address: CurrentFaintAddressV1, event_id: PresentationEventId },
    MessageReady { address: CurrentFaintAddressV1 },
    Message { address: CurrentFaintAddressV1, event_id: PresentationEventId },
    ReadyForVictory { address: CurrentFaintAddressV1 },
}

impl CurrentFaintPhaseV1 {
    pub fn address(&self) -> &CurrentFaintAddressV1 {
        match self {
            Self::Animation { address, .. } | Self::MessageReady { address }
            | Self::Message { address, .. } | Self::ReadyForVictory { address } => address,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentInitialEnemyFaintV1 {
    pub enemy_faints: u8,
    pub battle_score: SafeU53,
    pub history: Vec<CurrentEnemyFaintHistoryV1>,
    pub phase: Option<CurrentFaintPhaseV1>,
}

impl CurrentInitialEnemyFaintV1 {
    pub fn fresh() -> Self {
        Self { enemy_faints: 0, battle_score: SafeU53::ZERO, history: Vec::new(), phase: None }
    }

    pub fn valid(&self, initial_enemy: PokemonId) -> bool {
        let Some(phase) = &self.phase else {
            return self.enemy_faints == 0 && self.battle_score == SafeU53::ZERO && self.history.is_empty();
        };
        let address = phase.address();
        if self.enemy_faints != 1 || self.history.len() != 1
            || self.history[0].pokemon != initial_enemy || self.history[0].turn != address.turn
            || address.pokemon != initial_enemy || address.slot.side != BattleSide::Enemy
            || address.slot.position != 0 || address.pending_id == SafeU53::ZERO
            || address.source == initial_enemy || address.source.get() == SafeU53::ZERO
            || address.move_id.get() == SafeU53::ZERO
        { return false; }
        match phase {
            CurrentFaintPhaseV1::Animation { event_id, .. } => event_id.get() != SafeU53::ZERO && self.battle_score == SafeU53::ZERO,
            CurrentFaintPhaseV1::Message { event_id, .. } => event_id.get() != SafeU53::ZERO && self.battle_score == address.score_increase,
            CurrentFaintPhaseV1::MessageReady { .. } | CurrentFaintPhaseV1::ReadyForVictory { .. } => self.battle_score == address.score_increase,
        }
    }
}
