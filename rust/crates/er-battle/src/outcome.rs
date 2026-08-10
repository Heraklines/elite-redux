//! Battle outcome derivation from the canonical party state.

/// Derive the current outcome from whether either party has a living member.
///
/// Defeat takes precedence when the player's party is empty of living
/// members, including when neither party has a living member.
pub fn derive_battle_outcome(
    battle: &er_state::battle::BattleState,
) -> er_state::battle::BattleOutcome {
    let player_living = battle
        .player_party
        .iter()
        .any(|pokemon| !pokemon.fainted && pokemon.hp > 0);
    if !player_living {
        return er_state::battle::BattleOutcome::Defeat;
    }

    let enemy_living = battle
        .enemy_party
        .iter()
        .any(|pokemon| !pokemon.fainted && pokemon.hp > 0);
    if !enemy_living {
        er_state::battle::BattleOutcome::Victory
    } else {
        er_state::battle::BattleOutcome::Ongoing
    }
}
