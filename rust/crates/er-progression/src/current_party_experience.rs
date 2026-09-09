//! Pure normal-Classic `applyPartyExp` planning at the pinned 399d source boundary.
//!
//! This boundary excludes wave-value conversion, Sprint, Mystery encounters,
//! held XP boosters and Macho Brace. The caller must establish those exclusions.
//! It accepts the raw enemy XP value BEFORE the ordinary trainer adjustment and
//! the already resolved level cap. It does not mutate Pokemon, settle pending
//! ownership, run ExpPhase/global boosters/abilities, or award friendship.
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnboostedPartyExperienceMember {
    pub hp: u32,
    pub level: u16,
    pub participated: bool,
    pub pokerus: bool,
    pub on_field: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnboostedPartyExperienceInput {
    pub raw_exp_value: f64,
    pub trainer: bool,
    pub pokemon_defeated: bool,
    pub level_cap: u16,
    /// Full participant-set size, including fainted or at-cap participants.
    pub participant_count: u32,
    /// None and Some(0) preserve the source's modifier-presence distinction.
    pub exp_share_stacks: Option<u8>,
    pub exp_balance_stacks: Option<u8>,
    pub multiple_participant_stacks: Option<u8>,
    pub multiplier_override: Option<f64>,
    /// Actual party order, including fainted and at-cap members.
    pub party: Vec<UnboostedPartyExperienceMember>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PartyExperiencePhaseInsertion {
    pub party_index: usize,
    pub on_field: bool,
    /// Source phase argument. Exp Balance may leave a fractional value here.
    pub experience: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UnboostedPartyExperiencePlan {
    /// Battle-friendship calls occur first, including living at-cap participants.
    /// These are invocation indices, not applied friendship amounts or balances.
    pub battle_friendship_calls: Vec<usize>,
    /// Calls to unshiftPhase in source party order; execution order is not implied.
    pub phase_insertions: Vec<PartyExperiencePhaseInsertion>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PartyExperiencePlanError {
    #[error("ordinary unboosted party experience input is outside the admitted source domain")]
    Input,
    #[error("party experience arithmetic exceeds the finite nonnegative safe-integer domain")]
    Overflow,
}

fn finite_nonnegative(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_SAFE_INTEGER).contains(&value)
}

pub fn plan_unboosted_party_experience(
    input: &UnboostedPartyExperienceInput,
) -> Result<UnboostedPartyExperiencePlan, PartyExperiencePlanError> {
    // The modifier limits are the pinned classes' actual getMaxStackCount values.
    if !finite_nonnegative(input.raw_exp_value)
        || input.level_cap == 0
        || input.party.len() > usize::from(u16::MAX)
        || input.party.iter().any(|member| member.level == 0)
        || input
            .party
            .iter()
            .filter(|member| member.participated)
            .count()
            > input.participant_count as usize
        || input.exp_share_stacks.is_some_and(|stacks| stacks > 5)
        || input.exp_balance_stacks.is_some_and(|stacks| stacks > 4)
        || input
            .multiple_participant_stacks
            .is_some_and(|stacks| stacks > 5)
        || input
            .multiplier_override
            .is_some_and(|value| !finite_nonnegative(value))
    {
        return Err(PartyExperiencePlanError::Input);
    }
    let mut plan = UnboostedPartyExperiencePlan {
        battle_friendship_calls: Vec::new(),
        phase_insertions: Vec::new(),
    };
    if input.participant_count == 0 {
        return Ok(plan);
    }
    let exp_value = if input.trainer {
        (input.raw_exp_value * 1.5).floor()
    } else {
        input.raw_exp_value
    };
    if !finite_nonnegative(exp_value) {
        return Err(PartyExperiencePlanError::Overflow);
    }
    let mut recipients = Vec::new();
    let mut amounts = Vec::new();
    for (index, member) in input.party.iter().enumerate() {
        if member.hp == 0 {
            continue;
        }
        if member.participated && input.pokemon_defeated {
            plan.battle_friendship_calls.push(index);
        }
        if member.level >= input.level_cap {
            continue;
        }
        recipients.push(index);
        if !member.participated && input.exp_share_stacks.is_none() {
            amounts.push(0.0);
            continue;
        }
        let mut multiplier = 0.0;
        if member.participated {
            multiplier += 1.0 / f64::from(input.participant_count);
            if input.participant_count > 1
                && let Some(stacks) = input.multiple_participant_stacks
            {
                multiplier += f64::from(stacks) * 0.2;
            }
        } else if let Some(stacks) = input.exp_share_stacks {
            multiplier += (f64::from(stacks) * 0.2) / f64::from(input.participant_count);
        }
        if member.pokerus {
            multiplier *= 1.5;
        }
        if let Some(replacement) = input.multiplier_override {
            multiplier = replacement;
        }
        // Held PokemonExpBoosterModifier application is explicitly absent here.
        let amount = (exp_value * multiplier).floor();
        if !finite_nonnegative(amount) {
            return Err(PartyExperiencePlanError::Overflow);
        }
        amounts.push(amount);
    }
    if let Some(stacks) = input.exp_balance_stacks {
        let mut total_level = 0.0;
        let mut total_exp = 0.0;
        for (&index, &amount) in recipients.iter().zip(&amounts) {
            total_exp += amount;
            total_level += f64::from(input.party[index].level);
        }
        if !finite_nonnegative(total_exp) {
            return Err(PartyExperiencePlanError::Overflow);
        }
        // Empty source recipient arrays have no subsequent phase operations.
        if !recipients.is_empty() {
            let median_level = (total_level / recipients.len() as f64).floor();
            let eligible = recipients
                .iter()
                .filter(|&&index| f64::from(input.party[index].level) <= median_level)
                .count();
            let split_exp = (total_exp / eligible as f64).floor();
            for (&index, amount) in recipients.iter().zip(&mut amounts) {
                let target = if f64::from(input.party[index].level) <= median_level {
                    split_exp
                } else {
                    0.0
                };
                // Phaser.Math.Linear(p0, p1, t): preserve its binary64 order.
                *amount = (target - *amount) * (0.2 * f64::from(stacks)) + *amount;
                if !finite_nonnegative(*amount) {
                    return Err(PartyExperiencePlanError::Overflow);
                }
            }
        }
    }
    for (index, amount) in recipients.into_iter().zip(amounts) {
        if amount != 0.0 {
            plan.phase_insertions.push(PartyExperiencePhaseInsertion {
                party_index: index,
                on_field: input.party[index].on_field,
                experience: amount,
            });
        }
    }
    Ok(plan)
}
