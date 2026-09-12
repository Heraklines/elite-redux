//! Rare Candy owns its level/stat parent; it is never a fabricated XP award.
use crate::current_experience_owner::CurrentFriendshipClockRequestV1;
use crate::current_friendship_profile::CurrentFriendshipProfileV1;
use crate::m7_state::PokemonStateV5;
use er_types::{PresentationEventId, SafeU53};
use er_types::battle_ids::PokemonId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardCandyV1 {
    pub pending: SafeU53,
    pub offer: u8,
    pub holder: PokemonId,
    pub pokemon_before: Box<PokemonStateV5>,
    pub profile_before: Box<CurrentFriendshipProfileV1>,
    pub pokemon_head: Box<PokemonStateV5>,
    /// Both snapshots are frozen at apply; a later LevelUp must not recalculate.
    pub pokemon_after: Option<Box<PokemonStateV5>>,
    pub phase: CurrentRewardCandyPhaseV1,
    pub max_clock: Option<CurrentFriendshipClockRequestV1>,
    pub max_utc: Option<i64>,
    pub event_clock: Option<CurrentFriendshipClockRequestV1>,
    pub event_utc: Option<i64>,
    pub message_event: Option<PresentationEventId>,
    pub stats_event: Option<PresentationEventId>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag="kind", rename_all="SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CurrentRewardCandyPhaseV1 {
    Queued,
    Friendship,
    LevelStart,
    Message { event_id: PresentationEventId },
    Stats { event_id: PresentationEventId },
    Complete,
}