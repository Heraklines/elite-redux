//! Actual source generator arithmetic. Eligibility inputs must be derived from
//! complete content/state predicates; sampled generated identities are forbidden.
use super::current_reward_roll::{
    PregenArgs, RollError, SourcePool, bounded_draw, bounded_draw_from,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SpeciesItem {
    LightBall,
    ThickClub,
    MetalPowder,
    QuickPowder,
    DeepSeaScale,
    DeepSeaTooth,
}
impl SpeciesItem {
    pub(crate) fn source_key(self) -> &'static str {
        match self {
            Self::LightBall => "LIGHT_BALL",
            Self::ThickClub => "THICK_CLUB",
            Self::MetalPowder => "METAL_POWDER",
            Self::QuickPowder => "QUICK_POWDER",
            Self::DeepSeaScale => "DEEP_SEA_SCALE",
            Self::DeepSeaTooth => "DEEP_SEA_TOOTH",
        }
    }
}
pub(crate) struct SpeciesMember {
    pub species: u32,
    pub fusion_species: Option<u32>,
    /// Actual SpeciesStatBoosterModifier.contains(species,stat) membership.
    pub held_contains: Vec<(u32, u8)>,
}

pub(crate) fn simple(
    id: &str,
    pool: &mut impl SourcePool,
    budget: &mut usize,
) -> Result<PregenArgs, RollError> {
    match id {
        "BASE_STAT_BOOSTER" => Ok(PregenArgs::BaseStat {
            stat: bounded_draw(pool, 6, budget)? as u8,
        }),
        "MINT" => Ok(PregenArgs::Mint {
            nature: bounded_draw(pool, 25, budget)? as u8,
        }),
        _ => super::current_reward_common::generate_argument(id, pool, budget),
    }
}

/// `moves` contains each actual AttackMove's resolved spawn types, in party /
/// moveset / variable-type order, after the source challenge eligibility test.
pub(crate) fn attack_type(
    moves: &[Vec<u8>],
    pool: &mut impl SourcePool,
    budget: &mut usize,
) -> Result<Option<PregenArgs>, RollError> {
    if moves.len() > 24 {
        return Err(RollError::Invalid);
    }
    let mut weights: Vec<(u8, u32)> = Vec::new();
    let mut total = 0;
    for types in moves {
        if types.len() > 19 {
            return Err(RollError::Invalid);
        }
        for &kind in types {
            if kind > 18 {
                return Err(RollError::UnresolvedSource);
            }
            let index = match weights.iter().position(|row| row.0 == kind) {
                Some(index) => index,
                None => {
                    weights.push((kind, 0));
                    weights.len() - 1
                }
            };
            if weights[index].1 < 3 {
                weights[index].1 += 1;
                total += 1;
            }
        }
    }
    if total == 0 {
        return Ok(None);
    }
    let draw = bounded_draw(pool, total, budget)?;
    let mut cumulative = 0;
    for (kind, weight) in weights {
        cumulative += weight;
        if draw < cumulative {
            return Ok(Some(PregenArgs::AttackType { kind }));
        }
    }
    Err(RollError::Invalid)
}

pub(crate) fn species_item(
    rare: bool,
    new_content: bool,
    party: &[SpeciesMember],
    pool: &mut impl SourcePool,
    budget: &mut usize,
) -> Result<Option<PregenArgs>, RollError> {
    if party.len() > 6 {
        return Err(RollError::Invalid);
    }
    use SpeciesItem::*;
    let thick = if new_content {
        vec![104, 105, 2105, 70060]
    } else {
        vec![104, 105, 2105]
    };
    let rows = [
        (LightBall, true, vec![25], 1),
        (ThickClub, true, thick, 1),
        (MetalPowder, true, vec![132], 2),
        (QuickPowder, true, vec![132], 5),
        (DeepSeaScale, false, vec![366], 4),
        (DeepSeaTooth, false, vec![366], 3),
    ];
    let mut weights = Vec::new();
    let mut total = 0;
    for (key, item_rare, species, first_stat) in rows {
        if item_rare != rare {
            continue;
        }
        let count = party
            .iter()
            .filter(|member| {
                !member.held_contains.contains(&(species[0], first_stat))
                    && (species.contains(&member.species)
                        || member
                            .fusion_species
                            .is_some_and(|id| id != 0 && species.contains(&id)))
            })
            .count() as u32;
        // Source hasFling is explicitly false; no unimplemented move bonus.
        total += count;
        weights.push((key, count));
    }
    if total == 0 {
        return Ok(None);
    }
    let draw = bounded_draw_from(pool, total, 1, budget)?;
    let mut cumulative = 0;
    for (key, weight) in weights {
        if weight == 0 {
            continue;
        }
        cumulative += weight;
        if draw <= cumulative {
            return Ok(Some(PregenArgs::SpeciesItem(key)));
        }
    }
    Err(RollError::Invalid)
}

/// Eligible tera types exclude actual Terapagos/Ogerpon/Shedinja as source
/// hasSpecies resolves them. No access modifier means immediate null/no draws.
pub(crate) fn tera(
    access: bool,
    eligible_types: &[u8],
    pool: &mut impl SourcePool,
    budget: &mut usize,
) -> Result<Option<PregenArgs>, RollError> {
    if !access {
        return Ok(None);
    }
    if eligible_types.len() > 6 || eligible_types.iter().any(|kind| *kind > 18) {
        return Err(RollError::Invalid);
    }
    let excluded = eligible_types
        .first()
        .copied()
        .filter(|first| eligible_types.iter().all(|kind| kind == first));
    loop {
        let kind = if bounded_draw(pool, 64, budget)? != 0 {
            bounded_draw(pool, 18, budget)? as u8
        } else {
            18
        };
        if Some(kind) != excluded {
            return Ok(Some(PregenArgs::Tera { kind }));
        }
    }
}

/// Inputs preserve source normal-party-then-fusion order and are already checked
/// by actual isValidItemEvolution predicates. Filtering never deduplicates items.
pub(crate) fn evolution_item(
    rare: bool,
    valid_items: &[u16],
    pool: &mut impl SourcePool,
    budget: &mut usize,
) -> Result<Option<PregenArgs>, RollError> {
    if valid_items.len() > 256 {
        return Err(RollError::Invalid);
    }
    let candidates = valid_items
        .iter()
        .copied()
        .filter(|item| *item != 0 && (*item > 50) == rare)
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Ok(None);
    }
    let index = bounded_draw(pool, candidates.len() as u32, budget)? as usize;
    Ok(Some(PregenArgs::EvolutionItem {
        item: candidates[index],
    }))
}
