//! Battle outcome derivation from the canonical party state.

use er_state::battle::{BattleOutcome, BattleState, ReplacementProgress};
use er_types::battle_ids::BattleSide;

/// Derive the current outcome from whether either party has a living member.
///
/// Defeat takes precedence when the player's party is empty of living
/// members, including when neither party has a living member. A stored player
/// faint defers that terminal outcome until its separate REPLACEMENT
/// transaction applies.
pub fn derive_battle_outcome(battle: &BattleState) -> BattleOutcome {
    let player_living = battle
        .player_party
        .iter()
        .any(|pokemon| !pokemon.fainted && pokemon.hp > 0);
    if !player_living {
        if has_unresolved_player_replacement(battle) {
            return BattleOutcome::Ongoing;
        }
        return BattleOutcome::Defeat;
    }

    let enemy_living = battle
        .enemy_party
        .iter()
        .any(|pokemon| !pokemon.fainted && pokemon.hp > 0);
    if !enemy_living {
        BattleOutcome::Victory
    } else {
        BattleOutcome::Ongoing
    }
}

fn has_unresolved_player_replacement(battle: &BattleState) -> bool {
    battle.faint_queue.iter().any(|occurrence| {
        occurrence.slot.side == BattleSide::Player
            && occurrence.replacement != ReplacementProgress::Applied
    })
}
