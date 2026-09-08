//! Read-only ordinary attack-score observations over the current battle resolver.
//!
//! This query does not activate an AI profile or select a command. It inherits
//! the ordinary damage query's supported modifiers and does not model hidden
//! ability knowledge, forced critical hits, strategy, or the full source AI.

use er_ai::m9e_standard_attack_score::standard_attack_score;
use er_battle::m7_resolver::{
    BattleV5Error, effective_move_definition_v5, query_simulated_move_damage_v5,
};
use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_state::m7_state::RunStateV3;
use er_types::battle_ids::{FieldSlot, MoveSlotIndex};
use er_types::battle_model::MoveAccuracy;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrdinaryAttackScore {
    pub damage: u32,
    pub score: f64,
}

pub fn query_ordinary_attack_score(
    content: &PreparedBattleContentV3,
    run: &RunStateV3,
    source_slot: FieldSlot,
    move_slot: MoveSlotIndex,
    target_slot: FieldSlot,
) -> Result<OrdinaryAttackScore, BattleV5Error> {
    // Validate and simulate through the actual shared resolver before observing
    // the corresponding immutable move and target metadata.
    let damage = query_simulated_move_damage_v5(content, run, source_slot, move_slot, target_slot)?;
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    let occupant = |slot| {
        battle.field.slots.iter().find(|field| field.slot == slot)
            .and_then(|field| field.occupant)
            .and_then(|id| run.party.iter().chain(battle.enemy_party.iter()).find(|pokemon| pokemon.id == id))
    };
    let actor = occupant(source_slot).ok_or(BattleV5Error::Target)?;
    let target = occupant(target_slot).ok_or(BattleV5Error::Target)?;
    let (definition, _) = effective_move_definition_v5(content, actor, move_slot)?;
    let accuracy = match definition.accuracy {
        MoveAccuracy::AlwaysHits => 0,
        MoveAccuracy::Percent(value) => i16::from(value),
    };
    Ok(OrdinaryAttackScore {
        damage,
        score: standard_attack_score(damage, target.max_hp, target.hp, accuracy),
    })
}
