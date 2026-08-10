//! Private typed presentation barrier state for one local battle endpoint.

use std::collections::{BTreeMap, BTreeSet};

use er_types::battle_ids::BattlePresentationEventId;
use er_types::battle_ui::{
    BattlePresentationEvent, PresentationBlockingPolicy, PresentationSettlementOutcome,
    PresentationSkipPolicy,
};
use er_types::{OperationId, SafeU53, SeatId};
use thiserror::Error;

pub(crate) const M3_PRESENTATION_FAILED: &str = "M3_PRESENTATION_FAILED";

/// One immutable, ordered presentation plan owned by a local endpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BattlePresentationPlan {
    operation_id: OperationId,
    events: Vec<BattlePresentationEvent>,
}

impl BattlePresentationPlan {
    pub(crate) fn new(
        operation_id: OperationId,
        events: Vec<BattlePresentationEvent>,
    ) -> Result<Self, BattlePresentationError> {
        let plan = Self {
            operation_id,
            events,
        };
        plan.validate()?;
        Ok(plan)
    }

    pub(crate) fn operation_id(&self) -> &OperationId {
        &self.operation_id
    }

    pub(crate) fn events(&self) -> &[BattlePresentationEvent] {
        &self.events
    }

    pub(crate) fn validate(&self) -> Result<(), BattlePresentationError> {
        for (index, event) in self.events.iter().enumerate() {
            let expected_sequence = expected_sequence(index)?;
            if event.event_id.operation_id != self.operation_id {
                return Err(BattlePresentationError::PlanOperationMismatch {
                    event_id: event.event_id.clone(),
                    expected: self.operation_id.clone(),
                    actual: event.event_id.operation_id.clone(),
                });
            }
            if event.event_id.sequence != expected_sequence {
                return Err(BattlePresentationError::PlanSequenceMismatch {
                    event_id: event.event_id.clone(),
                    expected: expected_sequence,
                    actual: event.event_id.sequence,
                });
            }
        }
        Ok(())
    }
}

fn expected_sequence(index: usize) -> Result<SafeU53, BattlePresentationError> {
    let index = u64::try_from(index).map_err(|_| BattlePresentationError::SequenceOverflow)?;
    SafeU53::new(index).map_err(|_| BattlePresentationError::SequenceOverflow)
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub(crate) enum BattlePresentationError {
    #[error("presentation state is disposed")]
    Disposed,
    #[error("presentation state already has live events or a blocking barrier")]
    PlanActive,
    #[error("presentation state already reported M3_PRESENTATION_FAILED")]
    PresentationFailed,
    #[error("presentation plan event {event_id:?} has the wrong operation identity")]
    PlanOperationMismatch {
        event_id: BattlePresentationEventId,
        expected: OperationId,
        actual: OperationId,
    },
    #[error("presentation plan event {event_id:?} is not at its zero-based sequence")]
    PlanSequenceMismatch {
        event_id: BattlePresentationEventId,
        expected: SafeU53,
        actual: SafeU53,
    },
    #[error("presentation event was submitted by the wrong endpoint")]
    WrongEndpoint { expected: SeatId, actual: SeatId },
    #[error("presentation event identity is unknown")]
    UnknownEvent { event_id: BattlePresentationEventId },
    #[error("presentation event does not allow intentional skipping")]
    UnauthorizedSkip { event_id: BattlePresentationEventId },
    #[error("presentation failure reason must not be empty")]
    EmptyFailureReason,
    #[error("presentation event received a conflicting duplicate outcome")]
    ConflictingDuplicate {
        event_id: BattlePresentationEventId,
        previous: PresentationSettlementOutcome,
        incoming: PresentationSettlementOutcome,
    },
    #[error("presentation event identity was reused with different typed data")]
    ConflictingEventIdentity { event_id: BattlePresentationEventId },
    #[error("presentation sequence cannot be represented by SafeU53")]
    SequenceOverflow,
    #[error("presentation state invariant failed: {0}")]
    InvalidState(&'static str),
}

/// Evidence returned after accepting an outcome or replaying an exact tombstone.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct BattlePresentationSettlementReport {
    pub(crate) barrier_cleared: bool,
    pub(crate) terminal_reason: Option<&'static str>,
    pub(crate) idempotent: bool,
}

impl BattlePresentationSettlementReport {
    pub(crate) fn barrier_cleared(self) -> bool {
        self.barrier_cleared
    }

    pub(crate) fn terminal_reason(self) -> Option<&'static str> {
        self.terminal_reason
    }

    pub(crate) fn is_idempotent(self) -> bool {
        self.idempotent
    }
}

/// Deterministic barrier and outcome tombstones for one local endpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BattlePresentationState {
    local_endpoint: SeatId,
    plan: Option<BattlePresentationPlan>,
    pending: BTreeSet<BattlePresentationEventId>,
    blocking: BTreeSet<BattlePresentationEventId>,
    outcomes: BTreeMap<BattlePresentationEventId, PresentationSettlementOutcome>,
    event_catalog: BTreeMap<BattlePresentationEventId, BattlePresentationEvent>,
    presentation_failed: bool,
    disposed: bool,
}

impl BattlePresentationState {
    pub(crate) fn new(local_endpoint: SeatId) -> Self {
        Self {
            local_endpoint,
            plan: None,
            pending: BTreeSet::new(),
            blocking: BTreeSet::new(),
            outcomes: BTreeMap::new(),
            event_catalog: BTreeMap::new(),
            presentation_failed: false,
            disposed: false,
        }
    }

    pub(crate) fn local_endpoint(&self) -> SeatId {
        self.local_endpoint
    }

    pub(crate) fn install_plan(
        &mut self,
        operation_id: OperationId,
        events: Vec<BattlePresentationEvent>,
    ) -> Result<(), BattlePresentationError> {
        self.ensure_live()?;
        let plan = BattlePresentationPlan::new(operation_id, events)?;
        if !self.pending.is_empty() || !self.blocking.is_empty() {
            return Err(BattlePresentationError::PlanActive);
        }
        if self.presentation_failed {
            return Err(BattlePresentationError::PresentationFailed);
        }

        let mut event_catalog = self.event_catalog.clone();
        for event in plan.events() {
            let event_id = event.event_id.clone();
            if let Some(existing) = event_catalog.get(&event_id)
                && existing != event
            {
                return Err(BattlePresentationError::ConflictingEventIdentity { event_id });
            }
            event_catalog.insert(event_id, event.clone());
        }

        let pending = plan
            .events()
            .iter()
            .filter(|event| !self.outcomes.contains_key(&event.event_id))
            .map(|event| event.event_id.clone())
            .collect();
        let blocking = plan
            .events()
            .iter()
            .filter(|event| {
                event.policy == PresentationBlockingPolicy::BlocksHumanInput
                    && !self.outcomes.contains_key(&event.event_id)
            })
            .map(|event| event.event_id.clone())
            .collect();

        let mut candidate = self.clone();
        candidate.plan = Some(plan);
        candidate.pending = pending;
        candidate.blocking = blocking;
        candidate.event_catalog = event_catalog;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub(crate) fn plan(&self) -> Option<&BattlePresentationPlan> {
        self.plan.as_ref()
    }

    pub(crate) fn blocking_ids(&self) -> &BTreeSet<BattlePresentationEventId> {
        &self.blocking
    }

    pub(crate) fn pending_ids(&self) -> &BTreeSet<BattlePresentationEventId> {
        &self.pending
    }

    pub(crate) fn outcomes(
        &self,
    ) -> &BTreeMap<BattlePresentationEventId, PresentationSettlementOutcome> {
        &self.outcomes
    }

    pub(crate) fn outcome(
        &self,
        event_id: &BattlePresentationEventId,
    ) -> Option<&PresentationSettlementOutcome> {
        self.outcomes.get(event_id)
    }

    pub(crate) fn live_count(&self) -> usize {
        self.pending.len()
    }

    pub(crate) fn is_blocked(&self) -> bool {
        !self.blocking.is_empty()
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.disposed
    }

    pub(crate) fn settle(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<BattlePresentationSettlementReport, BattlePresentationError> {
        if endpoint != self.local_endpoint {
            return Err(BattlePresentationError::WrongEndpoint {
                expected: self.local_endpoint,
                actual: endpoint,
            });
        }
        self.ensure_live()?;
        outcome
            .validate()
            .map_err(|_| BattlePresentationError::EmptyFailureReason)?;

        if let Some(previous) = self.outcomes.get(&event_id) {
            if previous == &outcome {
                return Ok(BattlePresentationSettlementReport {
                    barrier_cleared: false,
                    terminal_reason: self.terminal_reason(),
                    idempotent: true,
                });
            }
            return Err(BattlePresentationError::ConflictingDuplicate {
                event_id,
                previous: previous.clone(),
                incoming: outcome,
            });
        }

        let Some(event) = self.plan.as_ref().and_then(|plan| {
            plan.events()
                .iter()
                .find(|event| event.event_id == event_id)
                .cloned()
        }) else {
            return Err(BattlePresentationError::UnknownEvent { event_id });
        };
        if !self.pending.contains(&event_id) {
            return Err(BattlePresentationError::UnknownEvent { event_id });
        }
        if matches!(&outcome, PresentationSettlementOutcome::IntentionallySkipped)
            && event.skip_policy != PresentationSkipPolicy::Allowed
        {
            return Err(BattlePresentationError::UnauthorizedSkip { event_id });
        }

        let was_blocked = self.is_blocked();
        let mut candidate = self.clone();
        candidate.pending.remove(&event_id);
        match &outcome {
            PresentationSettlementOutcome::Settled
            | PresentationSettlementOutcome::IntentionallySkipped => {
                candidate.blocking.remove(&event_id);
            }
            PresentationSettlementOutcome::Failed { .. } => {
                candidate.presentation_failed = true;
            }
        }
        candidate.outcomes.insert(event_id, outcome);
        candidate.validate()?;

        let report = BattlePresentationSettlementReport {
            barrier_cleared: was_blocked && candidate.blocking.is_empty(),
            terminal_reason: candidate.terminal_reason(),
            idempotent: false,
        };
        *self = candidate;
        Ok(report)
    }

    pub(crate) fn record_outcome(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<BattlePresentationSettlementReport, BattlePresentationError> {
        self.settle(endpoint, event_id, outcome)
    }

    /// Drops every live presentation request and barrier without erasing tombstones.
    pub(crate) fn clear(&mut self) {
        self.pending.clear();
        self.blocking.clear();
    }

    /// Teardown is terminal, repeatable, and retains only diagnostic tombstones.
    pub(crate) fn dispose(&mut self) {
        self.clear();
        self.plan = None;
        self.disposed = true;
    }

    pub(crate) fn validate(&self) -> Result<(), BattlePresentationError> {
        if self.disposed {
            if self.plan.is_some() || !self.pending.is_empty() || !self.blocking.is_empty() {
                return Err(BattlePresentationError::InvalidState(
                    "disposed state retains live presentation data",
                ));
            }
        }

        for (event_id, event) in &self.event_catalog {
            if &event.event_id != event_id {
                return Err(BattlePresentationError::InvalidState(
                    "event catalog key does not match event identity",
                ));
            }
        }
        for (event_id, outcome) in &self.outcomes {
            if !self.event_catalog.contains_key(event_id) {
                return Err(BattlePresentationError::InvalidState(
                    "outcome tombstone has no typed event identity",
                ));
            }
            outcome
                .validate()
                .map_err(|_| BattlePresentationError::EmptyFailureReason)?;
        }

        let has_failure = self
            .outcomes
            .values()
            .any(|outcome| matches!(outcome, PresentationSettlementOutcome::Failed { .. }));
        if has_failure != self.presentation_failed {
            return Err(BattlePresentationError::InvalidState(
                "failure terminal marker does not match outcome tombstones",
            ));
        }

        let Some(plan) = self.plan.as_ref() else {
            if !self.pending.is_empty() || !self.blocking.is_empty() {
                return Err(BattlePresentationError::InvalidState(
                    "live presentation data exists without a plan",
                ));
            }
            return Ok(());
        };
        plan.validate()?;

        for event in plan.events() {
            let event_id = &event.event_id;
            if self.event_catalog.get(event_id) != Some(event) {
                return Err(BattlePresentationError::InvalidState(
                    "active plan event differs from its catalog identity",
                ));
            }
            if self.pending.contains(event_id) && self.outcomes.contains_key(event_id) {
                return Err(BattlePresentationError::InvalidState(
                    "pending event also has an outcome tombstone",
                ));
            }

            let has_failed_outcome = matches!(
                self.outcomes.get(event_id),
                Some(PresentationSettlementOutcome::Failed { .. })
            );
            let should_block = event.policy == PresentationBlockingPolicy::BlocksHumanInput
                && (self.pending.contains(event_id) || has_failed_outcome);
            if should_block != self.blocking.contains(event_id) {
                return Err(BattlePresentationError::InvalidState(
                    "barrier does not match the exact blocking event set",
                ));
            }
        }

        for event_id in &self.pending {
            if !plan.events().iter().any(|event| &event.event_id == event_id) {
                return Err(BattlePresentationError::InvalidState(
                    "pending event is not in the active plan",
                ));
            }
        }
        for event_id in &self.blocking {
            let Some(event) = plan
                .events()
                .iter()
                .find(|event| &event.event_id == event_id)
            else {
                return Err(BattlePresentationError::InvalidState(
                    "blocking event is not in the active plan",
                ));
            };
            if event.policy != PresentationBlockingPolicy::BlocksHumanInput {
                return Err(BattlePresentationError::InvalidState(
                    "nonblocking event entered the barrier",
                ));
            }
        }
        Ok(())
    }

    fn terminal_reason(&self) -> Option<&'static str> {
        self.presentation_failed.then_some(M3_PRESENTATION_FAILED)
    }

    fn ensure_live(&self) -> Result<(), BattlePresentationError> {
        if self.disposed {
            Err(BattlePresentationError::Disposed)
        } else {
            Ok(())
        }
    }
}
