//! Private typed presentation barrier state for one local battle endpoint.

use std::collections::{BTreeMap, BTreeSet};

use er_types::battle_ids::BattlePresentationEventId;
use er_types::battle_ui::{
    BattlePresentationEvent, PresentationBlockingPolicy, PresentationSettlementOutcome,
    PresentationSkipPolicy,
};
use er_types::{OperationId, SafeU53, SeatId};
use thiserror::Error;

use crate::snapshot::{
    PendingPresentationsSnapshotV1, PresentationOutcomeSnapshotV1, PresentationPlanSnapshotV1,
    SnapshotError,
};

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
        let mut event_ids = BTreeSet::new();
        for (index, event) in self.events.iter().enumerate() {
            if !event_ids.insert(event.event_id.clone()) {
                return Err(BattlePresentationError::DuplicateEventId {
                    event_id: event.event_id.clone(),
                });
            }
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
    /// Retained for the staged plan-activation contract; current adapters do
    /// not construct this variant yet.
    #[allow(dead_code)]
    #[error("presentation state already has live events or a blocking barrier")]
    PlanActive,
    #[error("presentation state already reported M3_PRESENTATION_FAILED")]
    PresentationFailed,
    #[error("presentation operation identity was reused")]
    DuplicateOperationId { operation_id: OperationId },
    #[error("presentation event identity was reused")]
    DuplicateEventId { event_id: BattlePresentationEventId },
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

    /// Retained for settlement adapters and contract-focused callers.
    #[allow(dead_code)]
    pub(crate) fn is_idempotent(self) -> bool {
        self.idempotent
    }
}

/// Deterministic, owned presentation evidence for kernel snapshots and
/// resource accounting.  Plans remain ordered by operation identity, while
/// pending, blocking, and outcome projections retain their global BTree order.
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(dead_code)] // Retained as the staged typed snapshot contract.
pub(crate) struct BattlePresentationSnapshot {
    local_endpoint: SeatId,
    plans: BTreeMap<OperationId, BattlePresentationPlan>,
    last_plan_operation_id: Option<OperationId>,
    pending: BTreeSet<BattlePresentationEventId>,
    blocking: BTreeSet<BattlePresentationEventId>,
    outcomes: BTreeMap<BattlePresentationEventId, PresentationSettlementOutcome>,
    event_catalog: BTreeMap<BattlePresentationEventId, BattlePresentationEvent>,
    presentation_failed: bool,
    disposed: bool,
}

/// Accessors retained for staged presentation-contract consumers.
#[allow(dead_code)]
impl BattlePresentationSnapshot {
    pub(crate) fn local_endpoint(&self) -> SeatId {
        self.local_endpoint
    }

    pub(crate) fn plans(&self) -> &BTreeMap<OperationId, BattlePresentationPlan> {
        &self.plans
    }

    pub(crate) fn plan(&self) -> Option<&BattlePresentationPlan> {
        self.last_plan_operation_id
            .as_ref()
            .and_then(|operation_id| self.plans.get(operation_id))
    }

    pub(crate) fn plan_for(&self, operation_id: &OperationId) -> Option<&BattlePresentationPlan> {
        self.plans.get(operation_id)
    }

    pub(crate) fn plan_count(&self) -> usize {
        self.plans.len()
    }

    pub(crate) fn plan_operation_ids(&self) -> Vec<OperationId> {
        self.plans.keys().cloned().collect()
    }

    pub(crate) fn pending_ids(&self) -> &BTreeSet<BattlePresentationEventId> {
        &self.pending
    }

    pub(crate) fn blocking_ids(&self) -> &BTreeSet<BattlePresentationEventId> {
        &self.blocking
    }

    pub(crate) fn outcomes(
        &self,
    ) -> &BTreeMap<BattlePresentationEventId, PresentationSettlementOutcome> {
        &self.outcomes
    }

    pub(crate) fn event_catalog(
        &self,
    ) -> &BTreeMap<BattlePresentationEventId, BattlePresentationEvent> {
        &self.event_catalog
    }

    pub(crate) fn live_count(&self) -> usize {
        self.pending.len()
    }

    pub(crate) fn pending_count(&self) -> usize {
        self.pending.len()
    }

    pub(crate) fn blocking_count(&self) -> usize {
        self.blocking.len()
    }

    pub(crate) fn outcome_count(&self) -> usize {
        self.outcomes.len()
    }

    pub(crate) fn is_blocked(&self) -> bool {
        !self.blocking.is_empty()
    }

    pub(crate) fn is_failed(&self) -> bool {
        self.presentation_failed
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.disposed
    }

    pub(crate) fn terminal_reason(&self) -> Option<&'static str> {
        self.presentation_failed.then_some(M3_PRESENTATION_FAILED)
    }
}

/// Deterministic barrier and outcome tombstones for one local endpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BattlePresentationState {
    local_endpoint: SeatId,
    plans: BTreeMap<OperationId, BattlePresentationPlan>,
    last_plan_operation_id: Option<OperationId>,
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
            plans: BTreeMap::new(),
            last_plan_operation_id: None,
            pending: BTreeSet::new(),
            blocking: BTreeSet::new(),
            outcomes: BTreeMap::new(),
            event_catalog: BTreeMap::new(),
            presentation_failed: false,
            disposed: false,
        }
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
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
        if self.presentation_failed {
            return Err(BattlePresentationError::PresentationFailed);
        }
        let operation_id = plan.operation_id().clone();
        if self.plans.contains_key(&operation_id) {
            return Err(BattlePresentationError::DuplicateOperationId { operation_id });
        }

        let mut event_catalog = self.event_catalog.clone();
        for event in plan.events() {
            let event_id = event.event_id.clone();
            if let Some(existing) = event_catalog.get(&event_id) {
                if existing != event {
                    return Err(BattlePresentationError::ConflictingEventIdentity { event_id });
                }
                return Err(BattlePresentationError::DuplicateEventId { event_id });
            }
            event_catalog.insert(event_id, event.clone());
        }

        let mut candidate = self.clone();
        for event in plan.events() {
            let event_id = event.event_id.clone();
            if !candidate.outcomes.contains_key(&event_id) {
                candidate.pending.insert(event_id.clone());
                if event.policy == PresentationBlockingPolicy::BlocksHumanInput {
                    candidate.blocking.insert(event_id);
                }
            }
        }
        candidate.plans.insert(operation_id.clone(), plan);
        candidate.last_plan_operation_id = Some(operation_id);
        candidate.event_catalog = event_catalog;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub(crate) fn plans(&self) -> &BTreeMap<OperationId, BattlePresentationPlan> {
        &self.plans
    }

    /// Compatibility accessor for the original single-plan state.  With
    /// multiple plans it returns the most recently installed plan; callers
    /// needing an exact operation must use [`Self::plan_for`].
    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn plan(&self) -> Option<&BattlePresentationPlan> {
        self.last_plan_operation_id
            .as_ref()
            .and_then(|operation_id| self.plans.get(operation_id))
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn plan_for(&self, operation_id: &OperationId) -> Option<&BattlePresentationPlan> {
        self.plans.get(operation_id)
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn plan_count(&self) -> usize {
        self.plans.len()
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn plan_operation_ids(&self) -> Vec<OperationId> {
        self.plans.keys().cloned().collect()
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
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

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn outcome(
        &self,
        event_id: &BattlePresentationEventId,
    ) -> Option<&PresentationSettlementOutcome> {
        self.outcomes.get(event_id)
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn live_count(&self) -> usize {
        self.pending.len()
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn pending_count(&self) -> usize {
        self.pending.len()
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn blocking_count(&self) -> usize {
        self.blocking.len()
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn outcome_count(&self) -> usize {
        self.outcomes.len()
    }

    pub(crate) fn is_blocked(&self) -> bool {
        !self.blocking.is_empty()
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn is_disposed(&self) -> bool {
        self.disposed
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn is_failed(&self) -> bool {
        self.presentation_failed
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn snapshot(&self) -> BattlePresentationSnapshot {
        BattlePresentationSnapshot {
            local_endpoint: self.local_endpoint,
            plans: self.plans.clone(),
            last_plan_operation_id: self.last_plan_operation_id.clone(),
            pending: self.pending.clone(),
            blocking: self.blocking.clone(),
            outcomes: self.outcomes.clone(),
            event_catalog: self.event_catalog.clone(),
            presentation_failed: self.presentation_failed,
            disposed: self.disposed,
        }
    }

    /// Convert every typed plan, ordering identity, barrier projection, event
    /// catalog entry, and outcome tombstone into the closed snapshot DTO.
    pub(crate) fn snapshot_v1(&self) -> Result<PendingPresentationsSnapshotV1, SnapshotError> {
        self.validate()
            .map_err(|error| presentation_snapshot_invalid("pending_presentations", error))?;

        let snapshot = PendingPresentationsSnapshotV1 {
            local_endpoint: self.local_endpoint,
            plans: self
                .plans
                .values()
                .map(|plan| PresentationPlanSnapshotV1 {
                    operation_id: plan.operation_id().clone(),
                    events: plan.events().to_vec(),
                })
                .collect(),
            last_plan_operation_id: self.last_plan_operation_id.clone(),
            pending_barrier_ids: self.pending.iter().cloned().collect(),
            blocking_barrier_ids: self.blocking.iter().cloned().collect(),
            outcomes: self
                .outcomes
                .iter()
                .map(|(event_id, outcome)| PresentationOutcomeSnapshotV1 {
                    event_id: event_id.clone(),
                    outcome: outcome.clone(),
                })
                .collect(),
            event_catalog: self.event_catalog.values().cloned().collect(),
            presentation_failed: self.presentation_failed,
            disposed: self.disposed,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    /// Reconstruct typed plans before installing any state, then run the
    /// complete owner invariant check.  All tombstones and explicit disposal
    /// state are copied; no live state is inferred from an empty projection.
    pub(crate) fn from_snapshot_v1(
        snapshot: PendingPresentationsSnapshotV1,
    ) -> Result<Self, SnapshotError> {
        snapshot.validate()?;

        let mut plans = BTreeMap::new();
        for plan_snapshot in snapshot.plans {
            let operation_id = plan_snapshot.operation_id.clone();
            let plan = BattlePresentationPlan::new(operation_id.clone(), plan_snapshot.events)
                .map_err(|error| {
                    presentation_snapshot_invalid("pending_presentations.plans", error)
                })?;
            if plans.insert(operation_id, plan).is_some() {
                return Err(presentation_snapshot_invalid(
                    "pending_presentations.plans",
                    BattlePresentationError::InvalidState(
                        "duplicate plan operation identity during restoration",
                    ),
                ));
            }
        }

        let state = Self {
            local_endpoint: snapshot.local_endpoint,
            plans,
            last_plan_operation_id: snapshot.last_plan_operation_id,
            pending: snapshot.pending_barrier_ids.into_iter().collect(),
            blocking: snapshot.blocking_barrier_ids.into_iter().collect(),
            outcomes: snapshot
                .outcomes
                .into_iter()
                .map(|outcome| (outcome.event_id, outcome.outcome))
                .collect(),
            event_catalog: snapshot
                .event_catalog
                .into_iter()
                .map(|event| (event.event_id.clone(), event))
                .collect(),
            presentation_failed: snapshot.presentation_failed,
            disposed: snapshot.disposed,
        };
        state
            .validate()
            .map_err(|error| presentation_snapshot_invalid("pending_presentations", error))?;
        Ok(state)
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn restore_snapshot_v1(
        &mut self,
        snapshot: PendingPresentationsSnapshotV1,
    ) -> Result<(), SnapshotError> {
        let candidate = Self::from_snapshot_v1(snapshot)?;
        *self = candidate;
        Ok(())
    }

    pub(crate) fn settle(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<BattlePresentationSettlementReport, BattlePresentationError> {
        let mut candidate = self.clone();
        let report = candidate.settle_in_kernel_transaction(endpoint, event_id, outcome)?;
        candidate.validate()?;
        *self = candidate;
        Ok(report)
    }

    /// Settle one event inside the enclosing Battle clone/validate/swap
    /// transaction. Every fallible input check precedes mutation, and the
    /// transaction validates the complete presentation owner before commit.
    pub(crate) fn settle_in_kernel_transaction(
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

        let skip_allowed =
            self.owning_event(&event_id)?.skip_policy == PresentationSkipPolicy::Allowed;
        if !self.pending.contains(&event_id) {
            return Err(BattlePresentationError::UnknownEvent { event_id });
        }
        if matches!(
            &outcome,
            PresentationSettlementOutcome::IntentionallySkipped
        ) && !skip_allowed
        {
            return Err(BattlePresentationError::UnauthorizedSkip { event_id });
        }

        let was_blocked = self.is_blocked();
        self.pending.remove(&event_id);
        match &outcome {
            PresentationSettlementOutcome::Settled
            | PresentationSettlementOutcome::IntentionallySkipped => {
                self.blocking.remove(&event_id);
            }
            PresentationSettlementOutcome::Failed { .. } => {
                self.presentation_failed = true;
            }
        }
        self.outcomes.insert(event_id, outcome);

        Ok(BattlePresentationSettlementReport {
            barrier_cleared: was_blocked && self.blocking.is_empty(),
            terminal_reason: self.terminal_reason(),
            idempotent: false,
        })
    }

    #[allow(dead_code)] // Retained for staged presentation-contract consumers.
    pub(crate) fn record_outcome(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<BattlePresentationSettlementReport, BattlePresentationError> {
        self.settle(endpoint, event_id, outcome)
    }

    /// Teardown is terminal, repeatable, and retains only diagnostic tombstones.
    pub(crate) fn dispose(&mut self) {
        self.pending.clear();
        self.blocking.clear();
        self.plans.clear();
        self.last_plan_operation_id = None;
        self.disposed = true;
    }

    pub(crate) fn validate(&self) -> Result<(), BattlePresentationError> {
        if self.disposed
            && (!self.plans.is_empty() || !self.pending.is_empty() || !self.blocking.is_empty())
        {
            return Err(BattlePresentationError::InvalidState(
                "disposed state retains live presentation data",
            ));
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

        let mut plan_event_ids = BTreeSet::new();
        if self
            .last_plan_operation_id
            .as_ref()
            .is_some_and(|operation_id| !self.plans.contains_key(operation_id))
        {
            return Err(BattlePresentationError::InvalidState(
                "last plan identity is not retained in the plan map",
            ));
        }
        if self.last_plan_operation_id.is_none() && !self.plans.is_empty() {
            return Err(BattlePresentationError::InvalidState(
                "plan map is nonempty without a last plan identity",
            ));
        }
        for (operation_id, plan) in &self.plans {
            if operation_id != plan.operation_id() {
                return Err(BattlePresentationError::InvalidState(
                    "plan map key does not match operation identity",
                ));
            }
            plan.validate()?;
            for event in plan.events() {
                let event_id = &event.event_id;
                if !plan_event_ids.insert(event_id.clone()) {
                    return Err(BattlePresentationError::InvalidState(
                        "event identity belongs to more than one presentation plan",
                    ));
                }
                if self.event_catalog.get(event_id) != Some(event) {
                    return Err(BattlePresentationError::InvalidState(
                        "plan event differs from its catalog identity",
                    ));
                }
                if self.pending.contains(event_id) == self.outcomes.contains_key(event_id) {
                    return Err(BattlePresentationError::InvalidState(
                        "every retained plan event must have exactly one pending/outcome state",
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
        }

        for event_id in &self.pending {
            let Some(plan) = self.plans.get(&event_id.operation_id) else {
                return Err(BattlePresentationError::InvalidState(
                    "pending event is not in an active plan",
                ));
            };
            if !plan
                .events()
                .iter()
                .any(|event| &event.event_id == event_id)
            {
                return Err(BattlePresentationError::InvalidState(
                    "pending event is not in its owning plan",
                ));
            }
        }

        for event_id in &self.blocking {
            let Some(plan) = self.plans.get(&event_id.operation_id) else {
                return Err(BattlePresentationError::InvalidState(
                    "blocking event is not in an active plan",
                ));
            };
            let Some(event) = plan
                .events()
                .iter()
                .find(|event| &event.event_id == event_id)
            else {
                return Err(BattlePresentationError::InvalidState(
                    "blocking event is not in its owning plan",
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

    fn owning_event(
        &self,
        event_id: &BattlePresentationEventId,
    ) -> Result<&BattlePresentationEvent, BattlePresentationError> {
        let Some(plan) = self.plans.get(&event_id.operation_id) else {
            return Err(BattlePresentationError::UnknownEvent {
                event_id: event_id.clone(),
            });
        };
        let Some(event) = plan
            .events()
            .iter()
            .find(|event| &event.event_id == event_id)
        else {
            return Err(BattlePresentationError::UnknownEvent {
                event_id: event_id.clone(),
            });
        };
        if self.event_catalog.get(event_id) != Some(event) {
            return Err(BattlePresentationError::InvalidState(
                "settled event differs from its owning plan identity",
            ));
        }
        Ok(event)
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

fn presentation_snapshot_invalid(
    path: impl Into<String>,
    error: impl std::fmt::Display,
) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: error.to_string(),
    }
}
