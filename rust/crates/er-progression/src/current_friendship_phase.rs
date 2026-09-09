//! Bridge for the source-ordered Pokemon head, achievement interlude and tail.
//! Canonical ownership, account resolution and clocks belong to the game phase.
use crate::current_friendship::{
    CurrentFriendshipError, ExistingStarterAccount, FriendshipPlan, ResolvedPositiveFriendship,
    StarterCandyResult, continue_friendship_tail, positive_friendship_value,
    prepare_friendship_head,
};

/// Private fields prevent changing the arithmetic head between the two calls.
/// Restored game owners must reconstruct this value from their retained inputs.
#[derive(Clone, Debug, PartialEq)]
pub struct FriendshipPhaseHeadV1 {
    before: f64,
    original_delta: f64,
    boosted_amount: f64,
    capped: bool,
    fun_debug: bool,
    friendship: f64,
    has_tail: bool,
}

impl FriendshipPhaseHeadV1 {
    pub fn friendship(&self) -> f64 {
        self.friendship
    }

    pub fn has_tail(&self) -> bool {
        self.has_tail
    }

    pub fn requires_max_check(&self) -> bool {
        self.has_tail && self.friendship >= 255.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FriendshipPhaseCandyCallV1 {
    pub species: u32,
    pub root: u32,
    pub requested_count: i64,
    pub before_candy: i64,
    pub result: StarterCandyResult,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FriendshipPhaseTailV1 {
    pub plan: FriendshipPlan,
    /// Includes actual saturated false-return requests, even without a bar cue.
    pub candy_calls: Vec<FriendshipPhaseCandyCallV1>,
}

/// Computes only the source head. No Date, candy multiplier or account balance
/// is required before the source reaches its achievement/timed-event calls.
pub fn prepare_phase_head(
    before: f64,
    original_delta: f64,
    boosted_amount: Option<f64>,
    capped: bool,
    fun_debug: bool,
) -> Result<FriendshipPhaseHeadV1, CurrentFriendshipError> {
    const MAX_SAFE: f64 = 9_007_199_254_740_991.0;
    if !before.is_finite() || !original_delta.is_finite() || original_delta.abs() > MAX_SAFE {
        return Err(CurrentFriendshipError::Arithmetic);
    }
    if !(0.0..=255.0).contains(&before) {
        return Err(CurrentFriendshipError::Input);
    }
    if original_delta <= 0.0 {
        let next = before + original_delta;
        if !next.is_finite() || next.abs() > MAX_SAFE {
            return Err(CurrentFriendshipError::Arithmetic);
        }
        return Ok(FriendshipPhaseHeadV1 {
            before,
            original_delta,
            boosted_amount: 0.0,
            capped,
            fun_debug,
            friendship: next.max(0.0),
            has_tail: false,
        });
    }
    let amount = boosted_amount.ok_or(CurrentFriendshipError::Input)?;
    if !amount.is_finite() || amount.abs() > MAX_SAFE {
        return Err(CurrentFriendshipError::Arithmetic);
    }
    if amount < 0.0 {
        return Err(CurrentFriendshipError::Input);
    }
    let friendship = positive_friendship_value(before, amount, capped)?;
    Ok(FriendshipPhaseHeadV1 {
        before,
        original_delta,
        boosted_amount: amount,
        capped,
        fun_debug,
        friendship,
        has_tail: !fun_debug,
    })
}

/// Resume after the canonical achievement/ribbon owner settled. The supplied
/// account projection is the live post-achievement account state, never a stale
/// plan captured before nested reward grants. This emits only the ordinary tail.
pub fn finish_phase_tail(
    head: &FriendshipPhaseHeadV1,
    current_accounts: &[ExistingStarterAccount],
    resolved: &ResolvedPositiveFriendship,
) -> Result<FriendshipPhaseTailV1, CurrentFriendshipError> {
    if !head.has_tail
        || resolved.boosted_amount != head.boosted_amount
        || resolved.capped != head.capped
        || resolved.fun_debug != head.fun_debug
    {
        return Err(CurrentFriendshipError::Input);
    }
    let checked = prepare_friendship_head(
        head.before,
        head.original_delta,
        current_accounts,
        Some(resolved),
    )?;
    if !checked.has_tail || checked.plan.friendship != head.friendship {
        return Err(CurrentFriendshipError::Input);
    }
    let mut calls = Vec::new();
    let plan = continue_friendship_tail(checked.plan, resolved, Some(&mut calls))?;
    Ok(FriendshipPhaseTailV1 {
        plan,
        candy_calls: calls
            .into_iter()
            .map(|call| FriendshipPhaseCandyCallV1 {
                species: call.species,
                root: call.root,
                requested_count: call.requested_count,
                before_candy: call.before_candy,
                result: call.result,
            })
            .collect(),
    })
}
