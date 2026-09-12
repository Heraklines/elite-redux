//! Source399d ROGUE/MASTER base predicates, before the owned tuning pass.
use super::{current_reward_common as common, current_reward_roll::RollError};
pub(crate) struct Context<'a> {
    pub common: &'a common::Context,
    pub rogue_balls: u32,
    pub master_balls: u32,
    pub mystery_last_legal_wave: u32,
    pub has_mystery_rate_modifier: bool,
    pub has_booster_energy: bool,
    pub unlocked_protosynthesis_or_quark: bool,
    pub has_damage_calculator: bool,
    pub daily: bool,
    pub fun: bool,
    pub fun_mega: bool,
    pub endless: bool,
    pub spliced_only: bool,
    pub event_fusions_boosted: bool,
    pub unfused_members: usize,
    pub fresh_start_challenge: bool,
    pub mini_black_hole_unlocked: bool,
    pub reroll_count: u32,
}
pub(crate) const ROGUE_IDS: [&str; 26] = [
    "ROGUE_BALL",
    "RELIC_GOLD",
    "LEFTOVERS",
    "SHELL_BELL",
    "BERRY_POUCH",
    "GRIP_CLAW",
    "SCOPE_LENS",
    "BATON",
    "SOUL_DEW",
    "CATCHING_CHARM",
    "ABILITY_CHARM",
    "ABILITY_RANDOMIZER",
    "MOVE_SLOT_EXPANDER",
    "ER_GREATER_MOVE_RANDOMIZER",
    "ER_OMNI_GEM",
    "ER_METRONOME_ITEM",
    "ER_BOOSTER_ENERGY",
    "DAMAGE_CALCULATOR",
    "FOCUS_BAND",
    "KINGS_ROCK",
    "LOCK_CAPSULE",
    "SUPER_EXP_CHARM",
    "RARE_FORM_CHANGE_ITEM",
    "MEGA_BRACELET",
    "DYNAMAX_BAND",
    "VOUCHER_PLUS",
];
pub(crate) const MASTER_IDS: [&str; 8] = [
    "MASTER_BALL",
    "SHINY_CHARM",
    "HEALING_CHARM",
    "MULTI_LENS",
    "VOUCHER_PREMIUM",
    "DNA_SPLICERS",
    "MINI_BLACK_HOLE",
    "ER_GREATER_ABILITY_RANDOMIZER",
];
fn validate(context: &Context<'_>) -> Result<(), RollError> {
    common::weights(context.common)?;
    if context.unfused_members > context.common.party.len() {
        return Err(RollError::Invalid);
    }
    Ok(())
}
pub(crate) fn rogue(context: &Context<'_>) -> Result<[u32; 26], RollError> {
    validate(context)?;
    let base = context.common;
    let late = base.classic && base.wave >= 199;
    let wave_step = base.wave.div_ceil(50).min(4);
    Ok([
        if base.classic && context.rogue_balls >= base.maximum_pokeballs {
            0
        } else {
            16
        },
        if late { 0 } else { 2 },
        3,
        3,
        4,
        5,
        4,
        2,
        7,
        if base.classic { 0 } else { 4 },
        if base.wave < context.mystery_last_legal_wave && !context.has_mystery_rate_modifier {
            6
        } else {
            0
        },
        4,
        4,
        if base.coop { 0 } else { 2 },
        3,
        3,
        if !context.has_booster_energy && context.unlocked_protosynthesis_or_quark {
            2
        } else {
            0
        },
        if context.has_damage_calculator { 0 } else { 4 },
        5,
        3,
        if base.classic { 0 } else { 3 },
        if late { 0 } else { 8 },
        if context.fun && context.fun_mega {
            0
        } else {
            wave_step * 6
        },
        wave_step * 9,
        wave_step * 9,
        if context.daily || context.fun {
            0
        } else {
            3_u32.saturating_sub(context.reroll_count)
        },
    ])
}
pub(crate) fn master(context: &Context<'_>) -> Result<[u32; 8], RollError> {
    validate(context)?;
    let base = context.common;
    let voucher = if !context.daily && !context.fun && !context.endless && !context.spliced_only {
        5_u32.saturating_sub(context.reroll_count.saturating_mul(2))
    } else {
        0
    };
    let fusion = !(base.classic && context.event_fusions_boosted)
        && !context.spliced_only
        && context.unfused_members > 1;
    Ok([
        if base.classic && context.master_balls >= base.maximum_pokeballs {
            0
        } else {
            24
        },
        14,
        18,
        18,
        voucher,
        if fusion { 24 } else { 0 },
        u32::from(
            context.daily || (!context.fresh_start_challenge && context.mini_black_hole_unlocked),
        ),
        2,
    ])
}
