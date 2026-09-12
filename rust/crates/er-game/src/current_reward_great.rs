//! Exact source399d GREAT pool predicates. Every contextual fact is supplied by
//! the private content-bound state projection; no historical absence is guessed.
use super::{current_reward_common as common, current_reward_roll::RollError};

pub(crate) struct PartyFacts {
    pub has_status: bool,
    pub held_status_matches: bool,
    pub level: u16,
    pub learnable_level_moves: usize,
    pub held_blunder_policy: bool,
    pub inaccurate_move: bool,
    pub unlocked_magic_guard: bool,
    pub excluded_tera_species: bool,
    pub fused: bool,
}
pub(crate) struct Context<'a> {
    pub common: &'a common::Context,
    pub party: Vec<PartyFacts>,
    pub great_balls: u32,
    pub daily: bool,
    pub fun: bool,
    pub spliced_only: bool,
    pub event_fusions_boosted: bool,
    pub reroll_count: u32,
}
pub(crate) const IDS: [&str; 32] = [
    "GREAT_BALL",
    "PP_UP",
    "FULL_HEAL",
    "REVIVE",
    "MAX_REVIVE",
    "SACRED_ASH",
    "HYPER_POTION",
    "MAX_POTION",
    "FULL_RESTORE",
    "ELIXIR",
    "MAX_ELIXIR",
    "DIRE_HIT",
    "SUPER_LURE",
    "NUGGET",
    "SPECIES_STAT_BOOSTER",
    "EVOLUTION_ITEM",
    "ER_UPGRADED_MAP",
    "SOOTHE_BELL",
    "MEMORY_MUSHROOM",
    "ER_ABILITY_CAPSULE",
    "ER_EJECT_BUTTON",
    "ER_EJECT_PACK",
    "ER_SHED_SHELL",
    "ER_ADRENALINE_ORB",
    "ER_ROOM_SERVICE",
    "ER_MENTAL_HERB",
    "ER_BLUNDER_POLICY",
    "ER_STICKY_BARB",
    "BASE_STAT_BOOSTER",
    "TERA_SHARD",
    "DNA_SPLICERS",
    "VOUCHER",
];
pub(crate) fn weights(context: &Context<'_>) -> Result<[u32; 32], RollError> {
    let base = context.common;
    let common = common::weights(base)?;
    if context.party.len() != base.party.len() || context.party.iter().any(|p| p.level == 0) {
        return Err(RollError::Invalid);
    }
    let mut status = 0_u32;
    let mut fainted = 0_u32;
    let mut hyper = 0_u32;
    let mut maximum = 0_u32;
    for (member, facts) in base.party.iter().zip(&context.party) {
        if member.hp != 0 && facts.has_status && !facts.held_status_matches {
            status += 1;
        }
        if member.fainted {
            fainted += 1;
        }
        let ratio = f64::from(member.hp) / f64::from(member.max_hp);
        if member.max_hp - member.hp >= 100 && !member.fainted {
            if ratio <= 0.625 {
                hyper += 1;
            }
            if ratio <= 0.5 {
                maximum += 1;
            }
        }
    }
    let lure_blocked = base.coop
        || base.forced_doubles
        || base.forced_triples
        || (base.classic && base.wave == 199)
        || base.lures.iter().any(|lure| {
            lure.max_battles == 15
                && f64::from(lure.battles_left) >= f64::from(lure.max_battles) * 0.6
        });
    let highest_level = context
        .party
        .iter()
        .map(|member| u32::from(member.level))
        .max()
        .unwrap_or(1);
    let memory = if context
        .party
        .iter()
        .any(|member| member.learnable_level_moves > 0)
    {
        highest_level.div_ceil(20).min(4)
    } else {
        0
    };
    let blunder = !context
        .party
        .iter()
        .any(|member| member.held_blunder_policy)
        && context.party.iter().any(|member| member.inaccurate_move);
    let fusion = if context.party.iter().filter(|member| !member.fused).count() > 1 {
        if context.spliced_only {
            4
        } else if base.classic && context.event_fusions_boosted {
            2
        } else {
            0
        }
    } else {
        0
    };
    Ok([
        if base.classic && context.great_balls >= base.maximum_pokeballs {
            0
        } else {
            6
        },
        2,
        status.min(3) * 6,
        fainted.min(3) * 9,
        fainted.min(3) * 3,
        u32::from(fainted as usize >= base.party.len().div_ceil(2)),
        hyper.min(3) * 3,
        maximum.min(3),
        (maximum.min(3) + status.min(3)) / 2,
        common[4],
        common[5],
        4,
        if lure_blocked { 0 } else { 4 },
        if base.classic && base.wave >= 199 {
            0
        } else {
            5
        },
        2,
        base.wave.div_ceil(15).min(8),
        if base.classic && base.wave < 180 {
            2
        } else {
            0
        },
        2,
        memory,
        2,
        4,
        4,
        4,
        4,
        4,
        4,
        if blunder { 4 } else { 0 },
        if context
            .party
            .iter()
            .any(|member| member.unlocked_magic_guard)
        {
            4
        } else {
            0
        },
        3,
        u32::from(
            context
                .party
                .iter()
                .any(|member| !member.excluded_tera_species),
        ),
        fusion,
        if context.daily || context.fun {
            0
        } else {
            1_u32.saturating_sub(context.reroll_count)
        },
    ])
}
