//! Actual source TM history and queued learning descendant; no inventory grant
//! is substituted for the LearnMove phase or its blocking text acknowledgement.
use er_types::PresentationEventId;
use er_types::battle_ids::{MoveId, PokemonId};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CurrentUsedTmsV1 {
    /// Qualified fresh own-property with undefined value (not an empty array).
    Undefined,
    Values {
        moves: Vec<MoveId>,
    },
}
impl CurrentUsedTmsV1 {
    pub fn valid(&self) -> bool {
        match self {
            Self::Undefined => true,
            Self::Values { moves } => {
                moves.len() <= 4096 && moves.iter().all(|id| id.get() != er_types::SafeU53::ZERO)
            }
        }
    }
    pub fn append(&self, movement: MoveId) -> Option<Self> {
        if !self.valid() || movement.get() == er_types::SafeU53::ZERO {
            return None;
        }
        let mut moves = match self {
            Self::Undefined => Vec::new(),
            Self::Values { moves } => moves.clone(),
        };
        if moves.len() >= 4096 {
            return None;
        }
        moves.push(movement);
        Some(Self::Values { moves })
    }
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardTmV1 {
    pub holder: PokemonId,
    pub movement: MoveId,
    /// Exact ordinary auto-empty slot; full replacement has its own prompt.
    pub slot: u8,
    pub menu_instance: er_types::battle_ids::MenuInstanceId,
    pub messages: Vec<CurrentRewardTmMessageV1>,
    pub history_before: CurrentUsedTmsV1,
    pub tracker_before: Box<crate::current_achievement_tracker::CurrentAchievementTrackerV1>,
    pub phase: CurrentRewardTmPhaseV1,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CurrentRewardTmPhaseV1 {
    Queued,
    Intro { event_id: PresentationEventId },
    Replace,
    ForgetQueued,
    ForgetPrompt { event_id: PresentationEventId },
    ChooseSlot,
    Stop,
    DeclineQueued,
    DeclinePresent { event_id: PresentationEventId },
    Declined { event_id: PresentationEventId },
    LearningQueued,
    Forgotten { event_id: PresentationEventId },
    Present { event_id: PresentationEventId },
    Complete { event_id: PresentationEventId },
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardTmMessageV1 {
    pub kind: CurrentRewardTmMessageKindV1,
    pub event_id: PresentationEventId,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentRewardTmMessageKindV1 {
    Intro,
    ForgetQuestion,
    Forgotten,
    Learned,
    NotLearned,
}
impl CurrentRewardTmPhaseV1 {
    pub fn applied(&self) -> bool {
        matches!(
            self,
            Self::Forgotten { .. } | Self::Present { .. } | Self::Complete { .. }
        )
    }
    pub fn actionable(&self) -> bool {
        matches!(self, Self::Replace | Self::ChooseSlot | Self::Stop)
    }
    pub fn queued(&self) -> bool {
        matches!(
            self,
            Self::Queued | Self::ForgetQueued | Self::DeclineQueued | Self::LearningQueued
        )
    }
    pub fn event(&self) -> Option<PresentationEventId> {
        match self {
            Self::Intro { event_id }
            | Self::ForgetPrompt { event_id }
            | Self::Forgotten { event_id }
            | Self::Present { event_id }
            | Self::DeclinePresent { event_id } => Some(*event_id),
            _ => None,
        }
    }
}
