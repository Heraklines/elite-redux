//! Retained source phase progress. A completed friendship call does not pay XP.
use super::{CurrentExperienceOwnerError, CurrentPendingExperienceV1};
use er_types::battle_ids::{PokemonId, SpeciesId};
use er_types::{PlatformRequestId, SafeU53};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentFriendshipClockPurposeV1 {
    MaxAchievement,
    TimedEvent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipClockRequestV1 {
    pub request: PlatformRequestId,
    pub pending: SafeU53,
    pub recipient: PokemonId,
    pub purpose: CurrentFriendshipClockPurposeV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipHeadV1 {
    pub recipient: PokemonId,
    pub before: u16,
    pub after: u16,
    /// First-unlock Date call, distinct from the subsequent timed-event call.
    pub max_clock: Option<CurrentFriendshipClockRequestV1>,
    pub max_utc_milliseconds: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipAwardV1 {
    pub request: CurrentFriendshipClockRequestV1,
    pub utc_milliseconds: i64,
    pub source_root: SpeciesId,
    pub candy_root: SpeciesId,
    pub pokemon_friendship_before: u16,
    pub pokemon_friendship_after: u16,
    pub progress_before: SafeU53,
    pub progress_after: SafeU53,
    pub candy_before: SafeU53,
    pub candy_after: SafeU53,
    pub max_clock: Option<CurrentFriendshipClockRequestV1>,
    pub max_utc_milliseconds: Option<i64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipPhaseV1 {
    pub clock: Option<CurrentFriendshipClockRequestV1>,
    pub head: Option<CurrentFriendshipHeadV1>,
    pub awards: Vec<CurrentFriendshipAwardV1>,
    pub complete: bool,
}

impl CurrentFriendshipPhaseV1 {
    /// The phase runs the source living-participant loop before XP cap filtering.
    pub fn recipients(pending: &CurrentPendingExperienceV1) -> Vec<PokemonId> {
        pending.recipients.iter().filter(|recipient| {
            recipient.hp > 0 && pending.participants.iter().any(|participant| {
                participant.pokemon == recipient.pokemon
            })
        }).map(|recipient| recipient.pokemon).collect()
    }

    pub fn validate(&self, pending: &CurrentPendingExperienceV1)
        -> Result<(), CurrentExperienceOwnerError>
    {
        let recipients = Self::recipients(pending);
        if recipients.len() > 6 || self.awards.len() > recipients.len()
            || (self.complete && (self.awards.len() != recipients.len()
                || self.clock.is_some() || self.head.is_some()))
        {
            return Err(CurrentExperienceOwnerError::Invalid);
        }
        for (index, (award, recipient)) in self.awards.iter().zip(&recipients).enumerate() {
            if award.request.pending != pending.id || award.request.recipient != *recipient
                || award.request.request.get() == SafeU53::ZERO
                || award.request.purpose != CurrentFriendshipClockPurposeV1::TimedEvent
                || !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&award.utc_milliseconds)
                || award.source_root.get() == SafeU53::ZERO || award.candy_root.get() == SafeU53::ZERO
                || award.pokemon_friendship_before > 255 || award.pokemon_friendship_after > 255
                || self.awards[..index].iter().any(|prior| prior.request.request == award.request.request)
            {
                return Err(CurrentExperienceOwnerError::Invalid);
            }
            validate_max_clock(award.max_clock.as_ref(), award.max_utc_milliseconds,
                pending.id, *recipient, Some(award.request.request))?;
        }
        if self.clock.is_some() != self.head.is_some() {
            return Err(CurrentExperienceOwnerError::Invalid);
        }
        if let Some(clock) = &self.clock {
            let head = self.head.as_ref().ok_or(CurrentExperienceOwnerError::Invalid)?;
            if self.complete || clock.pending != pending.id
                || clock.request.get() == SafeU53::ZERO
                || recipients.get(self.awards.len()) != Some(&clock.recipient)
                || self.awards.iter().any(|award| award.request.request == clock.request)
                || head.recipient != clock.recipient || head.before > 255
                || head.after != head.before.saturating_add(3).min(255)
                || (clock.purpose == CurrentFriendshipClockPurposeV1::MaxAchievement
                    && (head.after != 255 || head.max_clock.is_some()
                        || head.max_utc_milliseconds.is_some()))
            {
                return Err(CurrentExperienceOwnerError::Invalid);
            }
            validate_max_clock(head.max_clock.as_ref(), head.max_utc_milliseconds,
                pending.id, head.recipient, Some(clock.request))?;
        }
        Ok(())
    }
}

fn validate_max_clock(
    clock: Option<&CurrentFriendshipClockRequestV1>, utc: Option<i64>,
    pending: SafeU53, recipient: PokemonId, timed_request: Option<PlatformRequestId>,
) -> Result<(), CurrentExperienceOwnerError> {
    match (clock, utc) {
        (None, None) => Ok(()),
        (Some(clock), Some(utc)) if clock.pending == pending
            && clock.recipient == recipient
            && clock.purpose == CurrentFriendshipClockPurposeV1::MaxAchievement
            && clock.request.get() != SafeU53::ZERO
            && Some(clock.request) != timed_request
            && (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc) => Ok(()),
        _ => Err(CurrentExperienceOwnerError::Invalid),
    }
}
