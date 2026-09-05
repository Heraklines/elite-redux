//! Complete game-owned battle-world access for M4.

use crate::battle_v2::{BattleStateV2, BattleWorldStateV2, ResolvedBattleWorldV2};
use crate::game_v2::GameStateV2;
use crate::pokemon_v2::PokemonStateV2;

pub fn battle_world(state: &GameStateV2) -> Option<BattleWorldStateV2<'_>> {
    state
        .battle
        .as_ref()
        .map(|battle| BattleWorldStateV2::new(&state.player_party, battle))
}

pub fn resolve_battle_world(state: &GameStateV2) -> Option<ResolvedBattleWorldV2> {
    battle_world(state).map(|world| world.resolve())
}

pub fn resolve_player_party(state: &GameStateV2) -> &[PokemonStateV2] {
    &state.player_party
}

pub fn resolve_battle(state: &GameStateV2) -> Option<&BattleStateV2> {
    state.battle.as_ref()
}
