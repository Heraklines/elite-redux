//! Source399d PLAYER reward roll engine. All pool predicates and generators must
//! be evaluated by the content-bound caller; sampled offers are never inputs.
//! This module does not grant a reward or bypass an unresolved source predicate.

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Offer {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub tier: u16,
    pub upgrade_count: u16,
    pub pregen_args: Option<PregenArgs>,
}

/// Only source-closed generator schemas are admitted. Further generators must
/// add exact variants; arbitrary any[] values are never coerced or discarded.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PregenArgs {
    Berry { kind: u8 },
    TemporaryStat { stat: u8 },
    BaseStat { stat: u8 },
    Mint { nature: u8 },
    AttackType { kind: u8 },
    Tera { kind: u8 },
    EvolutionItem { item: u16 },
    SpeciesItem(super::current_reward_generators::SpeciesItem),
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RollError {
    UnresolvedSource,
    Budget,
    Invalid,
}

/// Kept crate-private: an external client cannot nominate weights or offers.
/// Implementations must own the same RNG for every predicate/generator/draw,
/// and execute on a clone until the complete operation validates.
pub(crate) trait SourcePool {
    /// Equivalent to Object.hasOwn(pool,tier) && pool[tier].length > 0.
    fn has_tier(&self, tier: u16) -> bool;
    /// Regenerated source cumulative thresholds in JS numeric-key order.
    /// Each row is (exclusive upper bound, original source pool index).
    fn thresholds(&self, tier: u16) -> Result<Vec<(u32, usize)>, RollError>;
    fn party_luck(&self) -> Result<u8, RollError>;
    fn draw(&mut self, range: u32, minimum: u32) -> Result<u32, RollError>;
    /// Actual type generator, preserving generated pregenArgs and display name.
    /// Every internal generator/gate draw must consume the same operation budget.
    /// None has the source generateType-null meaning and triggers a same-tier retry.
    fn generate(
        &mut self,
        tier: u16,
        index: usize,
        budget: &mut usize,
    ) -> Result<Option<Offer>, RollError>;
    /// Every FormChangeItemModifierType calls the actual appearance gate, even
    /// non-mega form items. Other modifier classes return neutral true.
    fn appearance_gate(&mut self, offer: &Offer, budget: &mut usize) -> Result<bool, RollError>;
}

pub(super) fn bounded_draw(
    pool: &mut impl SourcePool,
    range: u32,
    budget: &mut usize,
) -> Result<u32, RollError> {
    bounded_draw_from(pool, range, 0, budget)
}
pub(super) fn bounded_draw_from(
    pool: &mut impl SourcePool,
    range: u32,
    minimum: u32,
    budget: &mut usize,
) -> Result<u32, RollError> {
    if range == 0 {
        return Err(RollError::Invalid);
    }
    let end = minimum.checked_add(range - 1).ok_or(RollError::Invalid)?;
    *budget = budget.checked_sub(1).ok_or(RollError::Budget)?;
    // Source randSeedInt(1,min) returns min without touching Phaser.RND.
    if range == 1 {
        return Ok(minimum);
    }
    let value = pool.draw(range, minimum)?;
    if value < minimum || value > end {
        return Err(RollError::Invalid);
    }
    Ok(value)
}
fn upgrade_odds(pool: &impl SourcePool) -> Result<u32, RollError> {
    let luck = u32::from(pool.party_luck()?);
    if luck > 18 {
        return Err(RollError::Invalid);
    }
    Ok((512 / (luck.min(14) + 5 + luck.saturating_sub(14) * 2)).max(1))
}

/// Port of getNewModifierTypeOption for ordinary PLAYER rewards with source
/// luck upgrades enabled. Recursion is represented by the retry loop; every
/// generated-null/gate-miss preserves tier, upgrade count and the same stream.
fn next(
    pool: &mut impl SourcePool,
    mut tier: Option<u16>,
    mut upgrades: Option<u16>,
    budget: &mut usize,
) -> Result<Offer, RollError> {
    let mut retries = 0_u16;
    loop {
        if tier.is_none() {
            let tier_value = bounded_draw(pool, 1024, budget)?;
            let mut count = upgrades.unwrap_or(0);
            if tier_value != 0 {
                let odds = upgrade_odds(pool)?;
                while bounded_draw(pool, odds, budget)? < 4 {
                    count = count.checked_add(1).ok_or(RollError::Budget)?;
                }
            }
            let base = if tier_value > 255 {
                0
            } else if tier_value > 60 {
                1
            } else if tier_value > 12 {
                2
            } else if tier_value != 0 {
                3
            } else {
                4
            };
            let mut resolved = base + count;
            while resolved > 0 && !pool.has_tier(resolved) {
                resolved -= 1;
                count = count.saturating_sub(1);
            }
            tier = Some(resolved);
            upgrades = Some(count);
        } else if upgrades.is_none() {
            let resolved = tier.ok_or(RollError::Invalid)?;
            let mut count = 0_u16;
            if resolved < 4 {
                let odds = upgrade_odds(pool)?;
                while pool.has_tier(resolved + count + 1) {
                    if bounded_draw(pool, odds, budget)? >= 4 {
                        break;
                    }
                    count = count.checked_add(1).ok_or(RollError::Budget)?;
                }
            }
            tier = Some(resolved + count);
            upgrades = Some(count);
        } else if retries >= 100 && tier != Some(0) {
            retries = 0;
            tier = tier.map(|value| value - 1);
        }
        let resolved = tier.ok_or(RollError::Invalid)?;
        let thresholds = pool.thresholds(resolved)?;
        let total = thresholds.last().ok_or(RollError::UnresolvedSource)?.0;
        let mut previous = 0;
        for &(threshold, _) in &thresholds {
            if threshold <= previous {
                return Err(RollError::Invalid);
            }
            previous = threshold;
        }
        let value = bounded_draw(pool, total, budget)?;
        let index = thresholds
            .iter()
            .find(|row| value < row.0)
            .ok_or(RollError::Invalid)?
            .1;
        if let Some(mut offer) = pool.generate(resolved, index, budget)?
            && pool.appearance_gate(&offer, budget)?
        {
            offer.tier = resolved;
            offer.upgrade_count = upgrades.ok_or(RollError::Invalid)?;
            return Ok(offer);
        }
        retries = retries.checked_add(1).ok_or(RollError::Budget)?;
    }
}

fn conflicts(left: &Offer, right: &Offer) -> bool {
    left.name == right.name
        || left
            .group
            .as_ref()
            .is_some_and(|group| right.group.as_ref() == Some(group))
}

/// Ordinary three-slot source path, without challenges/custom overrides/Moody
/// rewrites. The caller must positively qualify those conditions before entry.
/// Source de-duplication may return fewer than three; never fabricate a filler.
pub(crate) fn three_options(pool: &mut impl SourcePool) -> Result<Vec<Offer>, RollError> {
    let mut budget = 4096;
    let mut options = Vec::new();
    for _ in 0..3 {
        let mut candidate = next(pool, None, None, &mut budget)?;
        let mut retry = 0;
        while !options.is_empty() {
            retry += 1;
            if retry >= 15 || !options.iter().any(|offer| conflicts(offer, &candidate)) {
                break;
            }
            candidate = next(
                pool,
                Some(candidate.tier),
                Some(candidate.upgrade_count),
                &mut budget,
            )?;
        }
        options.push(candidate);
    }
    let mut unique = Vec::new();
    for option in options {
        if !unique.iter().any(|existing| conflicts(existing, &option)) {
            unique.push(option);
        }
    }
    Ok(unique)
}
