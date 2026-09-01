//! Bounded deterministic internal-event FIFO for one GameKernelV7 external step.

use std::collections::VecDeque;

use er_ai::full_surface::AiActionV1;
use er_types::battle_command::BattleCommand;
use er_types::{
    GameActionV1, GameControlPlanV2, OperationId, PlatformRequestId, PresentationEventId, SeatId,
    TerminalState, TimerId,
};
use thiserror::Error;

use crate::m9e_material_v6::{
    GameMaterialApplyOutcomeV6, GamePlatformEffectV2, GamePresentationEffectV2,
};
use crate::m9e_runtime_v6::{GameActionDispatchContextV1, PreparedGameTransitionV2};

pub const GAME_INTERNAL_EVENT_BUDGET_V2: usize = 4_096;
pub const GAME_INTERNAL_PRESENTATION_BUDGET_V2: usize = 4_096;
pub const GAME_INTERNAL_PLATFORM_BUDGET_V2: usize = 256;
pub const GAME_INTERNAL_AI_DECISION_BUDGET_V2: usize = 16;
pub const GAME_INTERNAL_MATERIAL_APPLY_BUDGET_V2: usize = 32;
pub const GAME_INTERNAL_TIMER_CONSEQUENCE_BUDGET_V2: usize = 1_024;
pub const GAME_INTERNAL_FRAME_BYTES_V2: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageResultV2 {
    Read(Option<Vec<u8>>),
    Written,
    Deleted,
    Slots(Vec<String>),
    Failed(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum GameInternalEventV2 {
    ControlSelected {
        action: GameActionV1,
        context: GameActionDispatchContextV1,
    },
    ControlCancelled {
        action: GameActionV1,
        context: GameActionDispatchContextV1,
    },
    ProposalPrepared {
        operation_id: OperationId,
        bytes: Vec<u8>,
    },
    ProposalAdmitted {
        operation_id: OperationId,
    },
    BattleCommandCollected(BattleCommand),
    AiCommandRequested {
        actor: er_types::battle_ids::PokemonId,
    },
    AiCommandResolved(AiActionV1),
    TransitionPrepared(PreparedGameTransitionV2),
    MaterialEncoded {
        operation_id: OperationId,
        bytes: Vec<u8>,
    },
    MaterialApplied {
        operation_id: OperationId,
        outcome: GameMaterialApplyOutcomeV6,
    },
    PresentationQueued(GamePresentationEffectV2),
    PlatformRequestQueued(GamePlatformEffectV2),
    TimerFired {
        timer_id: TimerId,
    },
    StorageResultReceived {
        request_id: PlatformRequestId,
        result: StorageResultV2,
    },
    NetworkFrameReceived {
        peer: SeatId,
        bytes: Vec<u8>,
    },
    ControlInstalled(GameControlPlanV2),
    PresentationSettled {
        event_id: PresentationEventId,
    },
    TerminalReached(TerminalState),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum GameInternalEventKindV2 {
    ControlSelected,
    ControlCancelled,
    ProposalPrepared,
    ProposalAdmitted,
    BattleCommandCollected,
    AiCommandRequested,
    AiCommandResolved,
    TransitionPrepared,
    MaterialEncoded,
    MaterialApplied,
    PresentationQueued,
    PlatformRequestQueued,
    TimerFired,
    StorageResultReceived,
    NetworkFrameReceived,
    ControlInstalled,
    PresentationSettled,
    TerminalReached,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GameInternalEventCountersV2 {
    pub processed: usize,
    pub presentations: usize,
    pub platform_requests: usize,
    pub ai_decisions: usize,
    pub material_applications: usize,
    pub timer_consequences: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InternalEventFailureEvidenceV2 {
    pub counters: GameInternalEventCountersV2,
    pub processed_kinds: Vec<GameInternalEventKindV2>,
    pub pending_kinds: Vec<GameInternalEventKindV2>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameInternalEventQueueErrorV2 {
    #[error("internal event V2 budget or payload bound exceeded")]
    Budget(InternalEventFailureEvidenceV2),
    #[error("internal event V2 handler failed: {cause}")]
    Handler {
        cause: String,
        evidence: InternalEventFailureEvidenceV2,
    },
    #[error("internal event V2 queue was published before quiescence")]
    NotQuiescent(InternalEventFailureEvidenceV2),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GameInternalEventQueueV2 {
    pending: VecDeque<GameInternalEventV2>,
    counters: GameInternalEventCountersV2,
    processed_kinds: Vec<GameInternalEventKindV2>,
}

impl GameInternalEventV2 {
    pub const fn kind(&self) -> GameInternalEventKindV2 {
        match self {
            Self::ControlSelected { .. } => GameInternalEventKindV2::ControlSelected,
            Self::ControlCancelled { .. } => GameInternalEventKindV2::ControlCancelled,
            Self::ProposalPrepared { .. } => GameInternalEventKindV2::ProposalPrepared,
            Self::ProposalAdmitted { .. } => GameInternalEventKindV2::ProposalAdmitted,
            Self::BattleCommandCollected(_) => GameInternalEventKindV2::BattleCommandCollected,
            Self::AiCommandRequested { .. } => GameInternalEventKindV2::AiCommandRequested,
            Self::AiCommandResolved(_) => GameInternalEventKindV2::AiCommandResolved,
            Self::TransitionPrepared(_) => GameInternalEventKindV2::TransitionPrepared,
            Self::MaterialEncoded { .. } => GameInternalEventKindV2::MaterialEncoded,
            Self::MaterialApplied { .. } => GameInternalEventKindV2::MaterialApplied,
            Self::PresentationQueued(_) => GameInternalEventKindV2::PresentationQueued,
            Self::PlatformRequestQueued(_) => GameInternalEventKindV2::PlatformRequestQueued,
            Self::TimerFired { .. } => GameInternalEventKindV2::TimerFired,
            Self::StorageResultReceived { .. } => GameInternalEventKindV2::StorageResultReceived,
            Self::NetworkFrameReceived { .. } => GameInternalEventKindV2::NetworkFrameReceived,
            Self::ControlInstalled(_) => GameInternalEventKindV2::ControlInstalled,
            Self::PresentationSettled { .. } => GameInternalEventKindV2::PresentationSettled,
            Self::TerminalReached(_) => GameInternalEventKindV2::TerminalReached,
        }
    }
}

impl GameInternalEventQueueV2 {
    pub fn new(initial: GameInternalEventV2) -> Result<Self, GameInternalEventQueueErrorV2> {
        let mut value = Self::default();
        value.push_back(initial)?;
        Ok(value)
    }

    pub fn push_back(
        &mut self,
        event: GameInternalEventV2,
    ) -> Result<(), GameInternalEventQueueErrorV2> {
        if self.pending.len() >= GAME_INTERNAL_EVENT_BUDGET_V2 || invalid_payload(&event) {
            return Err(GameInternalEventQueueErrorV2::Budget(self.evidence()));
        }
        self.pending.push_back(event);
        Ok(())
    }

    pub fn extend(
        &mut self,
        events: impl IntoIterator<Item = GameInternalEventV2>,
    ) -> Result<(), GameInternalEventQueueErrorV2> {
        for event in events {
            self.push_back(event)?;
        }
        Ok(())
    }

    pub fn pop_front(
        &mut self,
    ) -> Result<Option<GameInternalEventV2>, GameInternalEventQueueErrorV2> {
        let Some(event) = self.pending.front() else {
            return Ok(None);
        };
        let next = next_counters(&self.counters, event.kind());
        if exceeds_budget(&next) {
            return Err(GameInternalEventQueueErrorV2::Budget(self.evidence()));
        }
        let event = self
            .pending
            .pop_front()
            .ok_or_else(|| GameInternalEventQueueErrorV2::Budget(self.evidence()))?;
        self.counters = next;
        self.processed_kinds.push(event.kind());
        Ok(Some(event))
    }

    pub fn run_to_quiescence(
        &mut self,
        mut handler: impl FnMut(GameInternalEventV2) -> Result<Vec<GameInternalEventV2>, String>,
    ) -> Result<(), GameInternalEventQueueErrorV2> {
        while let Some(event) = self.pop_front()? {
            let children =
                handler(event).map_err(|cause| GameInternalEventQueueErrorV2::Handler {
                    cause,
                    evidence: self.evidence(),
                })?;
            self.extend(children)?;
        }
        self.validate_quiescent()
    }

    pub fn counters(&self) -> &GameInternalEventCountersV2 {
        &self.counters
    }

    pub fn processed_kinds(&self) -> &[GameInternalEventKindV2] {
        &self.processed_kinds
    }

    pub fn is_quiescent(&self) -> bool {
        self.pending.is_empty()
    }

    pub fn validate_quiescent(&self) -> Result<(), GameInternalEventQueueErrorV2> {
        if self.is_quiescent() {
            Ok(())
        } else {
            Err(GameInternalEventQueueErrorV2::NotQuiescent(self.evidence()))
        }
    }

    pub fn evidence(&self) -> InternalEventFailureEvidenceV2 {
        InternalEventFailureEvidenceV2 {
            counters: self.counters.clone(),
            processed_kinds: self.processed_kinds.clone(),
            pending_kinds: self.pending.iter().map(GameInternalEventV2::kind).collect(),
        }
    }
}

fn next_counters(
    current: &GameInternalEventCountersV2,
    kind: GameInternalEventKindV2,
) -> GameInternalEventCountersV2 {
    let mut next = current.clone();
    next.processed += 1;
    match kind {
        GameInternalEventKindV2::PresentationQueued => next.presentations += 1,
        GameInternalEventKindV2::PlatformRequestQueued => next.platform_requests += 1,
        GameInternalEventKindV2::AiCommandRequested
        | GameInternalEventKindV2::AiCommandResolved => {
            next.ai_decisions += 1;
        }
        GameInternalEventKindV2::MaterialApplied => next.material_applications += 1,
        GameInternalEventKindV2::TimerFired => next.timer_consequences += 1,
        _ => {}
    }
    next
}

fn exceeds_budget(counters: &GameInternalEventCountersV2) -> bool {
    counters.processed > GAME_INTERNAL_EVENT_BUDGET_V2
        || counters.presentations > GAME_INTERNAL_PRESENTATION_BUDGET_V2
        || counters.platform_requests > GAME_INTERNAL_PLATFORM_BUDGET_V2
        || counters.ai_decisions > GAME_INTERNAL_AI_DECISION_BUDGET_V2
        || counters.material_applications > GAME_INTERNAL_MATERIAL_APPLY_BUDGET_V2
        || counters.timer_consequences > GAME_INTERNAL_TIMER_CONSEQUENCE_BUDGET_V2
}

fn invalid_payload(event: &GameInternalEventV2) -> bool {
    match event {
        GameInternalEventV2::ProposalPrepared { bytes, .. }
        | GameInternalEventV2::MaterialEncoded { bytes, .. }
        | GameInternalEventV2::NetworkFrameReceived { bytes, .. } => {
            bytes.is_empty() || bytes.len() > GAME_INTERNAL_FRAME_BYTES_V2
        }
        GameInternalEventV2::StorageResultReceived {
            result: StorageResultV2::Read(Some(bytes)),
            ..
        } => bytes.len() > GAME_INTERNAL_FRAME_BYTES_V2,
        GameInternalEventV2::StorageResultReceived {
            result: StorageResultV2::Slots(slots),
            ..
        } => slots.len() > 256 || slots.iter().any(String::is_empty),
        GameInternalEventV2::StorageResultReceived {
            result: StorageResultV2::Failed(reason),
            ..
        } => reason.is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use er_types::battle_ids::PokemonId;
    use er_types::{SafeU53, TimerId};

    use super::{
        GAME_INTERNAL_AI_DECISION_BUDGET_V2, GameInternalEventKindV2,
        GameInternalEventQueueErrorV2, GameInternalEventQueueV2, GameInternalEventV2,
    };

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("test value is safe")
    }

    #[test]
    fn fifo_processes_children_to_quiescence_in_order() {
        let mut queue = GameInternalEventQueueV2::new(GameInternalEventV2::TimerFired {
            timer_id: TimerId::new(safe(1)),
        })
        .expect("initial event is valid");
        queue
            .run_to_quiescence(|event| match event {
                GameInternalEventV2::TimerFired { .. } => {
                    Ok(vec![GameInternalEventV2::PresentationSettled {
                        event_id: er_types::PresentationEventId::new(safe(1)),
                    }])
                }
                GameInternalEventV2::PresentationSettled { .. } => Ok(Vec::new()),
                _ => Err("unexpected event".to_owned()),
            })
            .expect("queue reaches quiescence");
        assert!(queue.is_quiescent());
        assert_eq!(
            queue.processed_kinds(),
            &[
                GameInternalEventKindV2::TimerFired,
                GameInternalEventKindV2::PresentationSettled,
            ]
        );
    }

    #[test]
    fn AI_budget_failure_retains_replayable_evidence() {
        let event = || GameInternalEventV2::AiCommandRequested {
            actor: PokemonId::new(safe(1)),
        };
        let mut queue = GameInternalEventQueueV2::new(event()).expect("initial event is valid");
        for _ in 1..=GAME_INTERNAL_AI_DECISION_BUDGET_V2 {
            queue
                .push_back(event())
                .expect("pending event fits total bound");
        }
        for _ in 0..GAME_INTERNAL_AI_DECISION_BUDGET_V2 {
            assert!(queue.pop_front().expect("within budget").is_some());
        }
        let error = queue.pop_front().expect_err("next AI event exceeds budget");
        assert!(matches!(&error, GameInternalEventQueueErrorV2::Budget(_)));
        let GameInternalEventQueueErrorV2::Budget(evidence) = error else {
            return;
        };
        assert_eq!(
            evidence.counters.ai_decisions,
            GAME_INTERNAL_AI_DECISION_BUDGET_V2
        );
        assert_eq!(
            evidence.pending_kinds,
            vec![GameInternalEventKindV2::AiCommandRequested]
        );
    }

    #[test]
    fn empty_network_frame_is_rejected_before_processing() {
        let error = GameInternalEventQueueV2::new(GameInternalEventV2::NetworkFrameReceived {
            peer: er_types::SeatId::new(safe(1)),
            bytes: Vec::new(),
        })
        .expect_err("empty frame is invalid");
        assert!(matches!(error, GameInternalEventQueueErrorV2::Budget(_)));
    }
}
