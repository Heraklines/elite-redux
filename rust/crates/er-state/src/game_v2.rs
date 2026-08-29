//! Versioned M4 game root.
//!
//! `player_party` is the sole player-party owner. Battle state contains only
//! encounter enemies; all player field slots resolve through this vector.

use serde::{Deserialize, Serialize};

use er_types::battle_ids::{ContentPackHash, GameModeId, PartyIndex};
use er_types::run_ids::RunContentPackHash;

use crate::battle_v2::{BattleStateV2, BattleWorldStateV2};
use crate::pokemon_v2::PokemonStateV2;
use crate::run_v2::RunStateV2;
use crate::validation_v2::{StateValidationErrorV2, validate_game_state_v2};

pub const GAME_STATE_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameStateV2 {
    pub schema_version: u32,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub mode: GameModeId,
    pub run: RunStateV2,
    pub player_party: Vec<PokemonStateV2>,
    pub battle: Option<BattleStateV2>,
}

impl GameStateV2 {
    pub fn validate(&self) -> Result<(), StateValidationErrorV2> {
        validate_game_state_v2(self)
    }

    pub fn battle_world(&self) -> Option<BattleWorldStateV2<'_>> {
        self.battle
            .as_ref()
            .map(|battle| BattleWorldStateV2::new(&self.player_party, battle))
    }

    pub fn player(&self, index: PartyIndex) -> Option<&PokemonStateV2> {
        self.player_party.get(usize::from(index.get()))
    }

    pub fn player_by_id(
        &self,
        pokemon: er_types::battle_ids::PokemonId,
    ) -> Option<&PokemonStateV2> {
        self.player_party.iter().find(|value| value.id == pokemon)
    }
}
