//! Pure cached399d COMMON pool predicates, in original source index order.
//! Input flags must come from owned source state; absence is not false.
use super::current_reward_roll::RollError;

pub(crate) struct MovePp { pub total: u32, pub used: u32 }
pub(crate) struct PartyMember {
    pub hp: u32,
    pub max_hp: u32,
    pub fainted: bool,
    pub has_leppa: bool,
    pub moves: Vec<MovePp>,
}
pub(crate) struct Lure { pub max_battles: u32, pub battles_left: u32 }
pub(crate) struct Context {
    pub party: Vec<PartyMember>,
    pub classic: bool,
    pub coop: bool,
    pub forced_doubles: bool,
    pub forced_triples: bool,
    pub wave: u32,
    pub pokeballs: u32,
    pub maximum_pokeballs: u32,
    pub lures: Vec<Lure>,
}

pub(crate) const IDS: [&str; 10] = [
    "POKEBALL", "RARE_CANDY", "POTION", "SUPER_POTION", "ETHER", "MAX_ETHER",
    "LURE", "TEMP_STAT_STAGE_BOOSTER", "BERRY", "TM_CASE",
];

pub(crate) fn weights(context: &Context) -> Result<[u32; 10], RollError> {
    if context.party.len() > 6 || context.maximum_pokeballs == 0 || context.wave == 0 {
        return Err(RollError::Invalid);
    }
    let mut potion = 0_u32;
    let mut super_potion = 0_u32;
    let mut ether = 0_u32;
    for member in &context.party {
        if member.max_hp == 0 || member.hp > member.max_hp || member.moves.len() > 4 {
            return Err(RollError::Invalid);
        }
        let inverse = member.max_hp - member.hp;
        // Source uses IEEE-754 division; preserve that evaluation rather than
        // replacing it with a threshold formula with different rounding.
        let ratio = f64::from(member.hp) / f64::from(member.max_hp);
        if inverse >= 10 && ratio <= 0.875 && !member.fainted { potion += 1; }
        if inverse >= 25 && ratio <= 0.75 && !member.fainted { super_potion += 1; }
        let mut needy = false;
        for movement in &member.moves {
            if movement.used > movement.total { return Err(RollError::Invalid); }
            if movement.used > 0 && movement.total - movement.used <= 5 && movement.used > movement.total / 2 {
                needy = true;
            }
        }
        if member.hp != 0 && !member.has_leppa && needy { ether += 1; }
    }
    let lure_blocked = context.coop || context.forced_doubles || context.forced_triples
        || (context.classic && context.wave == 199)
        || context.lures.iter().any(|lure| lure.max_battles == 10 && f64::from(lure.battles_left) >= f64::from(lure.max_battles) * 0.6);
    Ok([
        if context.classic && context.pokeballs >= context.maximum_pokeballs { 0 } else { 6 },
        2, potion.min(3) * 3, super_potion.min(3), ether.min(3) * 3, ether.min(3),
        if lure_blocked { 0 } else { 2 }, 4, 2, 2,
    ])
}

/// Exact source common generator draws. The resulting typed argument is then
/// resolved through content-owned display identity/effect construction.
pub(crate) fn generate_argument(
    id: &str,
    pool: &mut impl super::current_reward_roll::SourcePool,
    budget: &mut usize,
) -> Result<super::current_reward_roll::PregenArgs, RollError> {
    use super::current_reward_roll::{PregenArgs, bounded_draw, bounded_draw_from};
    match id {
        "TEMP_STAT_STAGE_BOOSTER" => Ok(PregenArgs::TemporaryStat {
            stat: bounded_draw_from(pool, 6, 1, budget)? as u8,
        }),
        "BERRY" => {
            let first = bounded_draw(pool, 12, budget)?;
            let kind = if first < 2 { 0 } else if first < 4 { 1 } else if first < 6 { 10 }
                else { (bounded_draw(pool, 8, budget)? + 2) as u8 };
            Ok(PregenArgs::Berry { kind })
        }
        _ => Err(RollError::UnresolvedSource),
    }
}
