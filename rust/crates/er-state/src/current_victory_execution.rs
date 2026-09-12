//! Retained source insertion order and explicit, unfinished XP descendants.
//! A stored request is not evidence that its mutation or presentation occurred.
use crate::current_experience_settlement::{
    CurrentExperienceAwardV1, CurrentExperiencePhaseV1, CurrentLearnMoveBatchV1,
    CurrentLevelUpChildrenV1, CurrentLevelUpEndV1, CurrentLevelUpV1,
};
use er_types::{PresentationEventId, SafeU53};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentVictoryExecutionV1 {
    /// Captured once by actual applyPartyExp insertion, before the first award.
    pub phases: Vec<CurrentExperiencePhaseV1>,
    pub next_phase: u8,
    /// Exact source-ordered completed prefix. Full material recomputation owns
    /// its history; restore does not pretend to reconstruct old party states.
    pub completed: Vec<CurrentExperienceAwardV1>,
    pub descendant: CurrentVictoryDescendantV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level_achievements: Option<crate::current_achievement_execution::CurrentLevelAchievementExecutionV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentVictoryDescendantV1 {
    Ready,
    AwardPresentation {
        award: CurrentExperienceAwardV1,
        event_id: PresentationEventId,
    },
    /// Off-field source applies XP before displaying its party bar. The
    /// optional already-produced LevelUp subtree runs before the bar hides.
    PartyAwardPresentation {
        award: CurrentExperienceAwardV1,
        level_up: Option<CurrentLevelUpV1>,
        event_id: PresentationEventId,
    },
    HidePartyBar {
        award: CurrentExperienceAwardV1,
    },
    HidePartyBarPresentation {
        award: CurrentExperienceAwardV1,
        event_id: PresentationEventId,
    },
    LevelUpStart {
        level_up: CurrentLevelUpV1,
    },
    LevelUpPresentation {
        end: CurrentLevelUpEndV1,
        event_id: PresentationEventId,
    },
    LevelUpChildren {
        children: CurrentLevelUpChildrenV1,
    },
    LearnMoveBatch {
        batch: CurrentLearnMoveBatchV1,
    },
    Evolution {
        children: CurrentLevelUpChildrenV1,
    },
    Complete,
}

impl CurrentVictoryExecutionV1 {
    pub fn valid(&self, pending_id: SafeU53) -> bool {
        if let Some(level) = &self.level_achievements {
            if !level.valid(pending_id)
                || !matches!(&self.descendant, CurrentVictoryDescendantV1::LevelUpStart { level_up } if level_up == &level.level_up) { return false; }
        }
        let next = usize::from(self.next_phase);
        if self.phases.len() > 6
            || next > self.phases.len()
            || self.completed.len() != next
            || self.phases.iter().any(|phase| {
                phase.pending_id != pending_id
                    || phase.pokemon.get() == SafeU53::ZERO
                    || phase.party_index >= 6
            })
            || self.phases.iter().enumerate().any(|(index, phase)| {
                self.phases[..index].iter().any(|prior| {
                    prior.pokemon == phase.pokemon || prior.party_index == phase.party_index
                })
            })
            || self
                .completed
                .iter()
                .zip(&self.phases)
                .any(|(award, phase)| award.phase != *phase || !valid_award(award))
        {
            return false;
        }
        let retained = match &self.descendant {
            CurrentVictoryDescendantV1::Complete => return next == self.phases.len(),
            CurrentVictoryDescendantV1::Ready => return next < self.phases.len(),
            CurrentVictoryDescendantV1::AwardPresentation { award, event_id } => {
                if !award.phase.on_field || event_id.get() == SafeU53::ZERO {
                    return false;
                }
                award
            }
            CurrentVictoryDescendantV1::PartyAwardPresentation {
                award,
                level_up,
                event_id,
            } => {
                if award.phase.on_field
                    || event_id.get() == SafeU53::ZERO
                    || level_up.as_ref().is_some_and(|level_up| {
                        !valid_level_up(level_up) || level_up.award != *award
                    })
                {
                    return false;
                }
                award
            }
            CurrentVictoryDescendantV1::HidePartyBar { award } => {
                if award.phase.on_field {
                    return false;
                }
                award
            }
            CurrentVictoryDescendantV1::HidePartyBarPresentation { award, event_id } => {
                if award.phase.on_field || event_id.get() == SafeU53::ZERO {
                    return false;
                }
                award
            }
            CurrentVictoryDescendantV1::LevelUpStart { level_up } => {
                if !valid_level_up(level_up) {
                    return false;
                }
                &level_up.award
            }
            CurrentVictoryDescendantV1::LevelUpPresentation { end, event_id } => {
                if event_id.get() == SafeU53::ZERO || !valid_level_up(&end.level_up) {
                    return false;
                }
                &end.level_up.award
            }
            CurrentVictoryDescendantV1::LevelUpChildren { children }
            | CurrentVictoryDescendantV1::Evolution { children } => {
                if !valid_level_up(&children.parent.level_up) {
                    return false;
                }
                &children.parent.level_up.award
            }
            CurrentVictoryDescendantV1::LearnMoveBatch { batch } => {
                if !valid_level_up(&batch.children.parent.level_up) {
                    return false;
                }
                &batch.children.parent.level_up.award
            }
        };
        self.phases.get(next) == Some(&retained.phase) && valid_award(retained)
    }
}

fn valid_award(award: &CurrentExperienceAwardV1) -> bool {
    award.last_level > 0 && award.experience == award.phase.phase_argument
}

fn valid_level_up(level_up: &CurrentLevelUpV1) -> bool {
    level_up.previous_level == level_up.award.last_level
        && level_up.new_level > level_up.previous_level
}
