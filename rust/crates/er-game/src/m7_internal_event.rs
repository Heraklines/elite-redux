//! Deterministic internal event frontier for one M7 external step.

use std::collections::VecDeque;

use er_types::{GameActionResultV1, GameControlKindV2, SafeU53, TimerId};
use thiserror::Error;

use crate::m7_runtime::GameControlIntentV2;

pub const GAME_INTERNAL_EVENT_BUDGET_V1: usize = 4_096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameInternalEventV1 {
    ControlSelected(GameControlIntentV2),
    ControlCancelled(GameControlIntentV2),
    TransitionApplied(GameActionResultV1),
    ControlInstalled {
        kind: GameControlKindV2,
        revision: SafeU53,
    },
    TimerFired {
        timer_id: TimerId,
    },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum GameInternalEventKindV1 {
    ControlSelected,
    ControlCancelled,
    TransitionApplied,
    ControlInstalled,
    TimerFired,
}
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameInternalEventQueueErrorV1 {
    #[error("M7 internal event budget exceeded after {processed} events")]
    BudgetExceeded { processed: usize },
    #[error("M7 internal event queue was published before quiescence")]
    NotQuiescent,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GameInternalEventQueueV1 {
    pending: VecDeque<GameInternalEventV1>,
    processed: usize,
    processed_kinds: Vec<GameInternalEventKindV1>,
}

impl GameInternalEventV1 {
    pub const fn kind(&self) -> GameInternalEventKindV1 {
        match self {
            Self::ControlSelected(_) => GameInternalEventKindV1::ControlSelected,
            Self::ControlCancelled(_) => GameInternalEventKindV1::ControlCancelled,
            Self::TransitionApplied(_) => GameInternalEventKindV1::TransitionApplied,
            Self::ControlInstalled { .. } => GameInternalEventKindV1::ControlInstalled,
            Self::TimerFired { .. } => GameInternalEventKindV1::TimerFired,
        }
    }
}

impl GameInternalEventQueueV1 {
    pub fn new(initial: GameInternalEventV1) -> Self {
        Self {
            pending: VecDeque::from([initial]),
            ..Self::default()
        }
    }

    pub fn push_back(&mut self, event: GameInternalEventV1) {
        self.pending.push_back(event);
    }

    pub fn extend(&mut self, events: impl IntoIterator<Item = GameInternalEventV1>) {
        self.pending.extend(events);
    }

    pub fn pop_front(
        &mut self,
    ) -> Result<Option<GameInternalEventV1>, GameInternalEventQueueErrorV1> {
        if self.pending.is_empty() {
            return Ok(None);
        }
        if self.processed >= GAME_INTERNAL_EVENT_BUDGET_V1 {
            return Err(GameInternalEventQueueErrorV1::BudgetExceeded {
                processed: self.processed,
            });
        }
        let event = self.pending.pop_front();
        if let Some(event) = &event {
            self.processed += 1;
            self.processed_kinds.push(event.kind());
        }
        Ok(event)
    }

    pub fn processed(&self) -> usize {
        self.processed
    }

    pub fn processed_kinds(&self) -> &[GameInternalEventKindV1] {
        &self.processed_kinds
    }

    pub fn is_quiescent(&self) -> bool {
        self.pending.is_empty()
    }

    pub fn validate_quiescent(&self) -> Result<(), GameInternalEventQueueErrorV1> {
        if self.is_quiescent() {
            Ok(())
        } else {
            Err(GameInternalEventQueueErrorV1::NotQuiescent)
        }
    }
}

#[cfg(test)]
mod tests {
    use er_types::{GameControlKindV2, SafeU53, TimerId};

    use super::{
        GAME_INTERNAL_EVENT_BUDGET_V1, GameInternalEventKindV1, GameInternalEventQueueErrorV1,
        GameInternalEventQueueV1, GameInternalEventV1,
    };

    #[test]
    fn fifo_is_ordered_budgeted_and_quiescent() {
        let mut queue = GameInternalEventQueueV1::default();
        queue.push_back(GameInternalEventV1::ControlInstalled {
            kind: GameControlKindV2::Reward,
            revision: SafeU53::ZERO,
        });
        queue.push_back(GameInternalEventV1::TimerFired {
            timer_id: TimerId::new(SafeU53::new(1).expect("timer")),
        });
        assert_eq!(
            queue.pop_front().expect("pop").map(|event| event.kind()),
            Some(GameInternalEventKindV1::ControlInstalled)
        );
        assert_eq!(
            queue.pop_front().expect("pop").map(|event| event.kind()),
            Some(GameInternalEventKindV1::TimerFired)
        );
        assert!(queue.is_quiescent());
        assert_eq!(queue.processed(), 2);

        let mut budgeted = GameInternalEventQueueV1::default();
        for _ in 0..=GAME_INTERNAL_EVENT_BUDGET_V1 {
            budgeted.push_back(GameInternalEventV1::ControlInstalled {
                kind: GameControlKindV2::Reward,
                revision: SafeU53::ZERO,
            });
        }
        for _ in 0..GAME_INTERNAL_EVENT_BUDGET_V1 {
            budgeted.pop_front().expect("within budget");
        }
        assert_eq!(
            budgeted.pop_front(),
            Err(GameInternalEventQueueErrorV1::BudgetExceeded {
                processed: GAME_INTERNAL_EVENT_BUDGET_V1,
            })
        );
    }
}
