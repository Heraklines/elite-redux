//! Actual current resolver decisions consumed by canonical source phase hooks.
//! Not presentation, and never reconstructed from final HP or fresh RNG draws.
use er_types::battle_ids::{FieldSlot, MoveId, PokemonId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentMoveUseModeV1 { Direct }

/// Closed pinned399d HitCheckResult names, including distinct no-message result.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentHitCheckV1 {
    Pending, Hit, NoEffect, NoEffectNoMessage, Protected, Miss,
    Reflected, TargetNotOnField, Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentResolvedHitCheckV1 {
    pub target: PokemonId,
    pub slot: FieldSlot,
    pub result: CurrentHitCheckV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentBattleSourceEventV1 {
    MoveResolution {
        user: PokemonId,
        source_slot: FieldSlot,
        move_id: MoveId,
        use_mode: CurrentMoveUseModeV1,
        first_hit: bool,
        /// Same ordered target list and hit decisions actually used by the move.
        targets: Vec<CurrentResolvedHitCheckV1>,
    },
    MoveDamage {
        user: PokemonId,
        source_slot: FieldSlot,
        target: PokemonId,
        target_slot: FieldSlot,
        move_id: MoveId,
        use_mode: CurrentMoveUseModeV1,
        /// Actual argument to the source damage hook, not an inferred final delta.
        damage: u32,
        critical: bool,
        target_hp_before: u32,
        target_hp_after: u32,
        target_max_hp: u32,
        super_effective: bool,
        hit_count: u8,
        hits_left: u8,
    },
}
