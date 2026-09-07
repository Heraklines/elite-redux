//! Pure arithmetic for pinned399d addFriendship/addStarterCandy over existing
//! account entries. Resolutions are caller evidence, not independently verified
//! species/modifier/mode lookups. No runtime, account creation or payment owner.
use thiserror::Error;

pub const FRIENDSHIP_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
/// Actual pinned registry defaults; the complete pinned tuning JSON has no override.
/// Callers still supply their resolved table explicitly; this is not a fallback.
pub const PINNED_FRIENDSHIP_CAPS: [u16; 10] = [25, 50, 75, 100, 150, 200, 300, 450, 450, 600];
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;
const MAX_CANDY: f64 = 9_999.0;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FriendshipSourceProvenance {
    pub oracle_sha: String,
    /// Caller-owned digest binding source/content, root maps, modifier result,
    /// event observation, mode and reward-rate resolution. Syntax is checked;
    /// this module cannot establish the truth of the caller's evidence.
    pub resolution_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExistingStarterAccount {
    pub species_id: u32,
    /// Caller has already normalized the source's absent/zero progress to zero.
    pub friendship_progress: u64,
    pub candy_count: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedFriendshipStarter {
    /// PokemonSpecies.getRootSpeciesId(false); this is the progress object key.
    pub source_root: u32,
    /// GameData.getRootStarterSpeciesId after custom-Mega normalization and the
    /// explicit Pikachu-line exception. It can differ from source_root.
    pub candy_account_root: u32,
    pub starter_cost: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ResolvedFriendshipMode {
    Classic { candy_multiplier: f64 },
    NonClassic,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedPositiveFriendship {
    pub provenance: FriendshipSourceProvenance,
    /// Actual original Pokemon species, for the source's one ribbon-line call.
    pub pokemon_species: u32,
    pub starter: ResolvedFriendshipStarter,
    pub fusion_starter: Option<ResolvedFriendshipStarter>,
    /// Actual post-dispatch NumberHolder.value, not assumed neutral.
    pub boosted_amount: f64,
    pub capped: bool,
    pub fun_debug: bool,
    /// Explicit source mode and actual event-or-tuning multiplier; no fallback.
    pub mode: ResolvedFriendshipMode,
    pub event_boosts_fusions: bool,
    pub friendship_caps: Vec<u16>,
    /// Actual getCurrentErRewardRates().totalCandy, including valid zero.
    pub total_candy_rate: u8,
}

#[derive(Clone, Debug, PartialEq)]
pub enum FriendshipIntent {
    ValidateMaxFriendshipAchievement,
    /// The external ribbon owner resolves custom Mega and every pre-evolution.
    AwardFriendshipRibbonToSpeciesLine { original_species: u32 },
    /// Source requests this before assigning the resulting candy count. The
    /// displayed amount is the full scaled request, not the saturated delta.
    ShowStarterCandy { root: u32, scaled_count: i64, before_candy: i64, after_candy: i64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct FriendshipPlan {
    pub friendship: f64,
    pub accounts: Vec<ExistingStarterAccount>,
    /// Source order: achievement, one ribbon line, then each ordered candy bar.
    /// These are requests only; no external effect has been executed.
    pub intents: Vec<FriendshipIntent>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StarterCandyResult {
    pub candy_count: i64,
    pub returned_true: bool,
    pub candy_bar_count: Option<i64>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum CurrentFriendshipError {
    #[error("missing or unsupported resolved friendship input")]
    Input,
    #[error("friendship arithmetic exceeds finite safe-number bounds")]
    Arithmetic,
    #[error("required existing starter account is missing or ambiguous")]
    Account,
}

fn safe(value: f64) -> Result<f64, CurrentFriendshipError> {
    if !value.is_finite() || value.abs() > MAX_SAFE {
        return Err(CurrentFriendshipError::Arithmetic);
    }
    Ok(value)
}

fn nonnegative_integer(value: f64) -> Result<u64, CurrentFriendshipError> {
    safe(value)?;
    if value < 0.0 || value.fract() != 0.0 {
        return Err(CurrentFriendshipError::Arithmetic);
    }
    Ok(value as u64)
}

/// One actual booster application only. Applicability, number/order of matching
/// modifiers and getStackCount resolution remain caller-owned. No booster is
/// not equivalent to applying a zero-stack booster to a fractional amount.
pub fn friendship_booster_step(amount: f64, resolved_stack: u8) -> Result<f64, CurrentFriendshipError> {
    safe(amount)?;
    if amount <= 0.0 || resolved_stack > 3 {
        return Err(CurrentFriendshipError::Input);
    }
    Ok(safe(amount * (1.0 + 0.5 * f64::from(resolved_stack)))?.floor())
}

pub fn starter_friendship_cap(cost: f64, caps: &[u16]) -> Result<u16, CurrentFriendshipError> {
    safe(cost)?;
    if caps.len() != 10 || caps.iter().any(|cap| !(1..=10_000).contains(cap))
        || caps.windows(2).any(|pair| pair[0] > pair[1]) {
        return Err(CurrentFriendshipError::Input);
    }
    let index = cost.floor().max(1.0).min(caps.len() as f64) as usize - 1;
    caps.get(index).copied().ok_or(CurrentFriendshipError::Input)
}

/// Arithmetic of addStarterCandy after its source root/account resolution.
/// Counts are signed because the source does not lower-clamp explicit negative
/// grants. Existing-count >=9999 and Fun-debug short circuits remain exact.
/// Unsafe intermediates are unsupported, even if later saturation could hide them.
pub fn add_resolved_starter_candy(before: i64, count: i64, from_egg: bool,
    show_bar: bool, fun_debug: bool, total_candy_rate: u8) -> Result<StarterCandyResult, CurrentFriendshipError> {
    if fun_debug {
        return Ok(StarterCandyResult { candy_count: before, returned_true: false, candy_bar_count: None });
    }
    safe(before as f64)?;
    if before as f64 >= MAX_CANDY {
        return Ok(StarterCandyResult { candy_count: before, returned_true: false, candy_bar_count: None });
    }
    let mut scaled = safe(count as f64)?;
    if count > 0 && !from_egg {
        if total_candy_rate > 50 {
            return Err(CurrentFriendshipError::Input);
        }
        scaled = safe(scaled * f64::from(total_candy_rate))?;
    }
    let after = safe(before as f64 + scaled)?.min(MAX_CANDY) as i64;
    Ok(StarterCandyResult { candy_count: after, returned_true: true,
        candy_bar_count: show_bar.then_some(scaled as i64) })
}

fn account_index(accounts: &[ExistingStarterAccount], root: u32) -> Result<usize, CurrentFriendshipError> {
    accounts.iter().position(|entry| entry.species_id == root).ok_or(CurrentFriendshipError::Account)
}

/// Plans a whole source-order call using a private account copy. At most two
/// progress roots and two resolved candy roots are needed. Equal roots share
/// the same entry and observe prior iteration mutations; no deduplicated payout.
/// Negative/zero calls do not inspect resolution/account contents. The four-entry
/// input capacity still applies. Fun-debug stops after
/// the Pokemon mutation. Other errors expose no partially changed caller state.
pub fn plan_resolved_friendship(before_friendship: f64, original_delta: f64,
    accounts: &[ExistingStarterAccount], resolved: Option<&ResolvedPositiveFriendship>)
    -> Result<FriendshipPlan, CurrentFriendshipError> {
    safe(before_friendship)?;
    safe(original_delta)?;
    if !(0.0..=255.0).contains(&before_friendship) || accounts.len() > 4 {
        return Err(CurrentFriendshipError::Input);
    }
    let mut plan = FriendshipPlan { friendship: before_friendship, accounts: accounts.to_vec(), intents: Vec::new() };
    if original_delta <= 0.0 {
        plan.friendship = safe(before_friendship + original_delta)?.max(0.0);
        return Ok(plan);
    }
    let resolved = resolved.ok_or(CurrentFriendshipError::Input)?;
    safe(resolved.boosted_amount)?;
    if resolved.boosted_amount < 0.0 {
        return Err(CurrentFriendshipError::Input);
    }
    let next = safe(before_friendship + resolved.boosted_amount)?;
    let capped = if resolved.capped && next > 200.0 { before_friendship.max(200.0) } else { next };
    plan.friendship = capped.min(255.0);
    if resolved.fun_debug {
        return Ok(plan);
    }
    if resolved.provenance.oracle_sha != FRIENDSHIP_ORACLE_SHA
        || resolved.provenance.resolution_sha256.len() != 64
        || !resolved.provenance.resolution_sha256.bytes().all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
        || resolved.pokemon_species == 0 || accounts.is_empty() || accounts.len() > 4 {
        return Err(CurrentFriendshipError::Input);
    }
    for (index, entry) in accounts.iter().enumerate() {
        if entry.species_id == 0 || entry.candy_count < 0
            || accounts[..index].iter().any(|prior| prior.species_id == entry.species_id) {
            return Err(CurrentFriendshipError::Account);
        }
        nonnegative_integer(entry.friendship_progress as f64)?;
        safe(entry.candy_count as f64)?;
    }
    if plan.friendship >= 255.0 {
        plan.intents.push(FriendshipIntent::ValidateMaxFriendshipAchievement);
        plan.intents.push(FriendshipIntent::AwardFriendshipRibbonToSpeciesLine { original_species: resolved.pokemon_species });
    }
    let mut multiplier = match resolved.mode {
        ResolvedFriendshipMode::Classic { candy_multiplier } => candy_multiplier,
        ResolvedFriendshipMode::NonClassic => 1.0,
    };
    safe(multiplier)?;
    if multiplier <= 0.0 {
        return Err(CurrentFriendshipError::Input);
    }
    if resolved.fusion_starter.is_some() {
        multiplier /= if resolved.event_boosts_fusions { 1.5 } else { 2.0 };
    }
    let gain = nonnegative_integer(safe(resolved.boosted_amount * multiplier)?.floor())?;
    for starter in std::iter::once(&resolved.starter).chain(resolved.fusion_starter.iter()) {
        let progress_index = account_index(&plan.accounts, starter.source_root)?;
        let candy_index = account_index(&plan.accounts, starter.candy_account_root)?;
        let cap = starter_friendship_cap(starter.starter_cost, &resolved.friendship_caps)?;
        let progress = nonnegative_integer(safe(plan.accounts[progress_index].friendship_progress as f64 + gain as f64)?)?;
        plan.accounts[progress_index].friendship_progress = progress;
        if progress >= u64::from(cap) {
            let count = nonnegative_integer((progress as f64 / f64::from(cap)).floor())?;
            let before_candy = plan.accounts[candy_index].candy_count;
            let candy = add_resolved_starter_candy(before_candy, count as i64, false, true, false, resolved.total_candy_rate)?;
            if let Some(scaled_count) = candy.candy_bar_count {
                plan.intents.push(FriendshipIntent::ShowStarterCandy { root: starter.candy_account_root,
                    scaled_count, before_candy, after_candy: candy.candy_count });
            }
            plan.accounts[candy_index].candy_count = candy.candy_count;
            plan.accounts[progress_index].friendship_progress = if candy.returned_true {
                nonnegative_integer(progress as f64 % f64::from(cap))?
            } else { u64::from(cap) - 1 };
        }
    }
    Ok(plan)
}
