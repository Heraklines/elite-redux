//! Deterministic presentation adapters isolated from protocol truth.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use er_types::battle_ids::BattlePresentationEventId;
use er_types::battle_ui::{BattlePresentationEvent, PresentationSettlementOutcome};
use er_types::{PresentationEvent, PresentationEventId, PresentationOutcome, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresenterMode {
    Instant,
    FaultControlled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationCompletion {
    pub event_id: PresentationEventId,
    pub outcome: PresentationOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattlePresentationCompletion {
    pub event_id: BattlePresentationEventId,
    pub outcome: PresentationSettlementOutcome,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PresenterPendingState {
    pub endpoint: SeatId,
    pub event: PresentationEvent,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PresenterOutcomeState {
    pub endpoint: SeatId,
    pub event_id: PresentationEventId,
    pub outcome: PresentationOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PresenterBattlePendingState {
    pub endpoint: SeatId,
    pub event: BattlePresentationEvent,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PresenterBattleOutcomeState {
    pub endpoint: SeatId,
    pub event_id: BattlePresentationEventId,
    pub outcome: PresentationSettlementOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PresenterTombstoneState {
    pub endpoint: SeatId,
    pub event_id: BattlePresentationEventId,
}

/// Complete neutral state for either presenter implementation.  The mode is
/// an owner seam, not a new wire field; a production M3 pair may choose to
/// accept only `FaultControlled` while legacy callers can still round-trip the
/// instant adapter.
#[derive(Clone, Debug, PartialEq)]
pub struct PresenterState {
    pub mode: PresenterMode,
    pub pending: Vec<PresenterPendingState>,
    pub outcomes: Vec<PresenterOutcomeState>,
    pub battle_pending: Vec<PresenterBattlePendingState>,
    pub battle_outcomes: Vec<PresenterBattleOutcomeState>,
    pub tombstones: Vec<PresenterTombstoneState>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenterDiagnostics {
    pub pending_event_ids: BTreeSet<PresentationEventId>,
    pub settled_event_ids: BTreeSet<PresentationEventId>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PresenterError {
    #[error("presenter is disposed")]
    Disposed,
    #[error("presentation event {event_id} is unknown")]
    UnknownEvent { event_id: PresentationEventId },
    #[error("presentation event {event_id} is already settled")]
    AlreadySettled { event_id: PresentationEventId },
    #[error("battle presentation event {event_id:?} is unknown")]
    UnknownBattleEvent { event_id: BattlePresentationEventId },
    #[error("battle presentation event {event_id:?} is already settled")]
    BattleAlreadySettled { event_id: BattlePresentationEventId },
    #[error("battle presentation settlement outcome is invalid")]
    InvalidBattleOutcome,
    #[error("presenter state is invalid: {reason}")]
    InvalidState { reason: String },
    #[error("presenter mode does not match the requested owner")]
    ModeMismatch,
}

pub trait Presenter: fmt::Debug + Send {
    fn present(
        &mut self,
        endpoint: SeatId,
        event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError>;

    fn settle(
        &mut self,
        endpoint: SeatId,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError>;

    fn present_battle(
        &mut self,
        endpoint: SeatId,
        event: BattlePresentationEvent,
    ) -> Result<Vec<BattlePresentationCompletion>, PresenterError>;

    fn settle_battle(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<Vec<BattlePresentationCompletion>, PresenterError>;

    fn pending_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId>;

    fn settled_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId>;

    fn pending_battle_event_ids(&self, endpoint: SeatId) -> BTreeSet<BattlePresentationEventId>;

    fn settled_battle_event_ids(&self, endpoint: SeatId) -> BTreeSet<BattlePresentationEventId>;

    fn diagnostics_for(&self, endpoint: SeatId) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: self.pending_event_ids(endpoint),
            settled_event_ids: self.settled_event_ids(endpoint),
            disposed: self.diagnostics().disposed,
        }
    }

    fn diagnostics(&self) -> PresenterDiagnostics;

    fn mode(&self) -> PresenterMode;

    fn export_state(&self) -> Result<PresenterState, PresenterError>;

    fn restorable_state(&self) -> Result<PresenterState, PresenterError> {
        self.export_state()
    }

    fn dispose(&mut self);
}

/// Restore a presenter without downcasting a trait object.  Validation is
/// completed before any owner is returned, and each concrete constructor is
/// fresh-owner/fail-atomic.
pub fn restore_presenter(state: PresenterState) -> Result<Box<dyn Presenter>, PresenterError> {
    state.validate()?;
    match state.mode {
        PresenterMode::Instant => Ok(Box::new(InstantPresenter::from_state(state)?)),
        PresenterMode::FaultControlled => Ok(Box::new(FaultPresenter::from_state(state)?)),
    }
}

impl PresenterState {
    pub fn validate(&self) -> Result<(), PresenterError> {
        if has_duplicate_or_unsorted(
            self.pending
                .iter()
                .map(|entry| (entry.endpoint, entry.event.event_id)),
        ) {
            return Err(PresenterError::InvalidState {
                reason: "legacy pending events must be strictly sorted and unique".to_owned(),
            });
        }
        if has_duplicate_or_unsorted(
            self.outcomes
                .iter()
                .map(|entry| (entry.endpoint, entry.event_id)),
        ) {
            return Err(PresenterError::InvalidState {
                reason: "legacy outcomes must be strictly sorted and unique".to_owned(),
            });
        }
        if has_duplicate_or_unsorted(
            self.battle_pending
                .iter()
                .map(|entry| (entry.endpoint, entry.event.event_id.clone())),
        ) {
            return Err(PresenterError::InvalidState {
                reason: "battle pending events must be strictly sorted and unique".to_owned(),
            });
        }
        if has_duplicate_or_unsorted(
            self.battle_outcomes
                .iter()
                .map(|entry| (entry.endpoint, entry.event_id.clone())),
        ) {
            return Err(PresenterError::InvalidState {
                reason: "battle outcomes must be strictly sorted and unique".to_owned(),
            });
        }
        if has_duplicate_or_unsorted(
            self.tombstones
                .iter()
                .map(|entry| (entry.endpoint, entry.event_id.clone())),
        ) {
            return Err(PresenterError::InvalidState {
                reason: "battle tombstones must be strictly sorted and unique".to_owned(),
            });
        }

        let pending = self
            .battle_pending
            .iter()
            .map(|entry| (entry.endpoint, entry.event.event_id.clone()))
            .collect::<BTreeSet<_>>();
        let outcomes = self
            .battle_outcomes
            .iter()
            .map(|entry| (entry.endpoint, entry.event_id.clone()))
            .collect::<BTreeSet<_>>();
        let tombstones = self
            .tombstones
            .iter()
            .map(|entry| (entry.endpoint, entry.event_id.clone()))
            .collect::<BTreeSet<_>>();
        if pending
            .iter()
            .any(|key| outcomes.contains(key) || tombstones.contains(key))
            || outcomes != tombstones
        {
            return Err(PresenterError::InvalidState {
                reason:
                    "battle pending identities must be unsettled and outcomes must match tombstones"
                        .to_owned(),
            });
        }

        let legacy_pending = self
            .pending
            .iter()
            .map(|entry| (entry.endpoint, entry.event.event_id))
            .collect::<BTreeSet<_>>();
        let legacy_outcomes = self
            .outcomes
            .iter()
            .map(|entry| (entry.endpoint, entry.event_id))
            .collect::<BTreeSet<_>>();
        if legacy_pending
            .iter()
            .any(|key| legacy_outcomes.contains(key))
        {
            return Err(PresenterError::InvalidState {
                reason: "legacy pending identities must not have outcomes".to_owned(),
            });
        }

        if self.mode == PresenterMode::Instant
            && (!self.pending.is_empty() || !self.battle_pending.is_empty())
        {
            return Err(PresenterError::InvalidState {
                reason: "instant presenter cannot retain pending events".to_owned(),
            });
        }
        for outcome in &self.battle_outcomes {
            outcome
                .outcome
                .validate()
                .map_err(|error| PresenterError::InvalidState {
                    reason: error.to_string(),
                })?;
        }
        if self.disposed
            && (!self.pending.is_empty()
                || !self.outcomes.is_empty()
                || !self.battle_pending.is_empty())
        {
            return Err(PresenterError::InvalidState {
                reason: "disposed presenter cannot retain pending or legacy outcome state"
                    .to_owned(),
            });
        }
        Ok(())
    }
}

fn has_duplicate_or_unsorted<T, I>(values: I) -> bool
where
    T: Ord,
    I: IntoIterator<Item = T>,
{
    let values = values.into_iter().collect::<Vec<_>>();
    values.windows(2).any(|pair| pair[0] >= pair[1])
}

#[derive(Debug, Default)]
pub struct InstantPresenter {
    settled: BTreeMap<(SeatId, PresentationEventId), PresentationOutcome>,
    battle_settled: BTreeMap<(SeatId, BattlePresentationEventId), PresentationSettlementOutcome>,
    disposed: bool,
}

impl InstantPresenter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn export_state(&self) -> Result<PresenterState, PresenterError> {
        let state = PresenterState {
            mode: PresenterMode::Instant,
            pending: Vec::new(),
            outcomes: self
                .settled
                .iter()
                .map(|((endpoint, event_id), outcome)| PresenterOutcomeState {
                    endpoint: *endpoint,
                    event_id: *event_id,
                    outcome: outcome.clone(),
                })
                .collect(),
            battle_pending: Vec::new(),
            battle_outcomes: self
                .battle_settled
                .iter()
                .map(
                    |((endpoint, event_id), outcome)| PresenterBattleOutcomeState {
                        endpoint: *endpoint,
                        event_id: event_id.clone(),
                        outcome: outcome.clone(),
                    },
                )
                .collect(),
            tombstones: self
                .battle_settled
                .keys()
                .map(|(endpoint, event_id)| PresenterTombstoneState {
                    endpoint: *endpoint,
                    event_id: event_id.clone(),
                })
                .collect(),
            disposed: self.disposed,
        };
        state.validate()?;
        Ok(state)
    }

    pub fn restorable_state(&self) -> Result<PresenterState, PresenterError> {
        self.export_state()
    }

    pub fn from_restorable_state(state: PresenterState) -> Result<Self, PresenterError> {
        Self::from_state(state)
    }

    pub fn from_state(state: PresenterState) -> Result<Self, PresenterError> {
        state.validate()?;
        if state.mode != PresenterMode::Instant {
            return Err(PresenterError::ModeMismatch);
        }
        Ok(Self {
            settled: state
                .outcomes
                .into_iter()
                .map(|outcome| ((outcome.endpoint, outcome.event_id), outcome.outcome))
                .collect(),
            battle_settled: state
                .battle_outcomes
                .into_iter()
                .map(|outcome| ((outcome.endpoint, outcome.event_id), outcome.outcome))
                .collect(),
            disposed: state.disposed,
        })
    }

    pub fn restore_state(&mut self, state: PresenterState) -> Result<(), PresenterError> {
        let restored = Self::from_state(state)?;
        *self = restored;
        Ok(())
    }
}

impl Presenter for InstantPresenter {
    fn present(
        &mut self,
        endpoint: SeatId,
        event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        let key = (endpoint, event.event_id);
        if self.settled.contains_key(&key) {
            return Err(PresenterError::AlreadySettled {
                event_id: event.event_id,
            });
        }

        let outcome = PresentationOutcome::Settled;
        self.settled.insert(key, outcome.clone());
        Ok(vec![PresentationCompletion {
            event_id: event.event_id,
            outcome,
        }])
    }

    fn settle(
        &mut self,
        endpoint: SeatId,
        event_id: PresentationEventId,
        _outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        if self.settled.contains_key(&(endpoint, event_id)) {
            return Err(PresenterError::AlreadySettled { event_id });
        }
        Err(PresenterError::UnknownEvent { event_id })
    }

    fn present_battle(
        &mut self,
        endpoint: SeatId,
        event: BattlePresentationEvent,
    ) -> Result<Vec<BattlePresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        let event_id = event.event_id.clone();
        let key = (endpoint, event_id.clone());
        if self.battle_settled.contains_key(&key) {
            return Err(PresenterError::BattleAlreadySettled { event_id });
        }

        let outcome = PresentationSettlementOutcome::Settled;
        self.battle_settled.insert(key, outcome.clone());
        Ok(vec![BattlePresentationCompletion { event_id, outcome }])
    }

    fn settle_battle(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        _outcome: PresentationSettlementOutcome,
    ) -> Result<Vec<BattlePresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        if self
            .battle_settled
            .contains_key(&(endpoint, event_id.clone()))
        {
            return Err(PresenterError::BattleAlreadySettled { event_id });
        }
        Err(PresenterError::UnknownBattleEvent { event_id })
    }

    fn pending_event_ids(&self, _endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        BTreeSet::new()
    }

    fn settled_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        self.settled
            .keys()
            .filter_map(|(key_endpoint, event_id)| (*key_endpoint == endpoint).then_some(*event_id))
            .collect()
    }

    fn pending_battle_event_ids(&self, _endpoint: SeatId) -> BTreeSet<BattlePresentationEventId> {
        BTreeSet::new()
    }

    fn settled_battle_event_ids(&self, endpoint: SeatId) -> BTreeSet<BattlePresentationEventId> {
        self.battle_settled
            .keys()
            .filter_map(|(key_endpoint, event_id)| {
                (*key_endpoint == endpoint).then_some(event_id.clone())
            })
            .collect()
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: BTreeSet::new(),
            settled_event_ids: self.settled.keys().map(|(_, event_id)| *event_id).collect(),
            disposed: self.disposed,
        }
    }

    fn mode(&self) -> PresenterMode {
        PresenterMode::Instant
    }

    fn export_state(&self) -> Result<PresenterState, PresenterError> {
        InstantPresenter::export_state(self)
    }

    fn dispose(&mut self) {
        self.disposed = true;
        self.settled.clear();
        // Settled battle outcomes are retained as diagnostic tombstones; only
        // legacy outcomes are live adapter state on this presenter surface.
    }
}

#[derive(Debug, Default)]
pub struct FaultPresenter {
    pending: BTreeMap<(SeatId, PresentationEventId), PresentationEvent>,
    settled: BTreeMap<(SeatId, PresentationEventId), PresentationOutcome>,
    battle_pending: BTreeMap<(SeatId, BattlePresentationEventId), BattlePresentationEvent>,
    battle_settled: BTreeMap<(SeatId, BattlePresentationEventId), PresentationSettlementOutcome>,
    battle_tombstones: BTreeSet<(SeatId, BattlePresentationEventId)>,
    disposed: bool,
}

impl FaultPresenter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn export_state(&self) -> Result<PresenterState, PresenterError> {
        let state = PresenterState {
            mode: PresenterMode::FaultControlled,
            pending: self
                .pending
                .iter()
                .map(|((endpoint, _), event)| PresenterPendingState {
                    endpoint: *endpoint,
                    event: event.clone(),
                })
                .collect(),
            outcomes: self
                .settled
                .iter()
                .map(|((endpoint, event_id), outcome)| PresenterOutcomeState {
                    endpoint: *endpoint,
                    event_id: *event_id,
                    outcome: outcome.clone(),
                })
                .collect(),
            battle_pending: self
                .battle_pending
                .iter()
                .map(|((endpoint, _), event)| PresenterBattlePendingState {
                    endpoint: *endpoint,
                    event: event.clone(),
                })
                .collect(),
            battle_outcomes: self
                .battle_settled
                .iter()
                .map(
                    |((endpoint, event_id), outcome)| PresenterBattleOutcomeState {
                        endpoint: *endpoint,
                        event_id: event_id.clone(),
                        outcome: outcome.clone(),
                    },
                )
                .collect(),
            tombstones: self
                .battle_tombstones
                .iter()
                .map(|(endpoint, event_id)| PresenterTombstoneState {
                    endpoint: *endpoint,
                    event_id: event_id.clone(),
                })
                .collect(),
            disposed: self.disposed,
        };
        state.validate()?;
        Ok(state)
    }

    pub fn restorable_state(&self) -> Result<PresenterState, PresenterError> {
        self.export_state()
    }

    pub fn from_restorable_state(state: PresenterState) -> Result<Self, PresenterError> {
        Self::from_state(state)
    }

    pub fn from_state(state: PresenterState) -> Result<Self, PresenterError> {
        state.validate()?;
        if state.mode != PresenterMode::FaultControlled {
            return Err(PresenterError::ModeMismatch);
        }
        Ok(Self {
            pending: state
                .pending
                .into_iter()
                .map(|pending| ((pending.endpoint, pending.event.event_id), pending.event))
                .collect(),
            settled: state
                .outcomes
                .into_iter()
                .map(|outcome| ((outcome.endpoint, outcome.event_id), outcome.outcome))
                .collect(),
            battle_pending: state
                .battle_pending
                .into_iter()
                .map(|pending| {
                    (
                        (pending.endpoint, pending.event.event_id.clone()),
                        pending.event,
                    )
                })
                .collect(),
            battle_settled: state
                .battle_outcomes
                .into_iter()
                .map(|outcome| {
                    (
                        (outcome.endpoint, outcome.event_id.clone()),
                        outcome.outcome,
                    )
                })
                .collect(),
            battle_tombstones: state
                .tombstones
                .into_iter()
                .map(|tombstone| (tombstone.endpoint, tombstone.event_id))
                .collect(),
            disposed: state.disposed,
        })
    }

    pub fn restore_state(&mut self, state: PresenterState) -> Result<(), PresenterError> {
        let restored = Self::from_state(state)?;
        *self = restored;
        Ok(())
    }

    pub fn duplicate_completion(
        &mut self,
        endpoint: SeatId,
        event_id: PresentationEventId,
    ) -> Result<PresentationCompletion, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        self.settled
            .get(&(endpoint, event_id))
            .cloned()
            .map(|outcome| PresentationCompletion { event_id, outcome })
            .ok_or(PresenterError::UnknownEvent { event_id })
    }
}

impl Presenter for FaultPresenter {
    fn present(
        &mut self,
        endpoint: SeatId,
        event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        let key = (endpoint, event.event_id);
        if self.settled.contains_key(&key) {
            return Err(PresenterError::AlreadySettled {
                event_id: event.event_id,
            });
        }

        self.pending.entry(key).or_insert(event);
        Ok(Vec::new())
    }

    fn settle(
        &mut self,
        endpoint: SeatId,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        let key = (endpoint, event_id);
        if self.pending.remove(&key).is_none() {
            if self.settled.contains_key(&key) {
                return Err(PresenterError::AlreadySettled { event_id });
            }
            return Err(PresenterError::UnknownEvent { event_id });
        }

        self.settled.insert(key, outcome.clone());
        Ok(vec![PresentationCompletion { event_id, outcome }])
    }

    fn present_battle(
        &mut self,
        endpoint: SeatId,
        event: BattlePresentationEvent,
    ) -> Result<Vec<BattlePresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        let event_id = event.event_id.clone();
        let key = (endpoint, event_id.clone());
        if self.battle_settled.contains_key(&key) {
            return Err(PresenterError::BattleAlreadySettled { event_id });
        }
        self.battle_pending.entry(key).or_insert(event);
        Ok(Vec::new())
    }

    fn settle_battle(
        &mut self,
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    ) -> Result<Vec<BattlePresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        outcome
            .validate()
            .map_err(|_| PresenterError::InvalidBattleOutcome)?;
        let key = (endpoint, event_id.clone());
        if self.battle_pending.remove(&key).is_none() {
            if self.battle_settled.contains_key(&key) {
                return Err(PresenterError::BattleAlreadySettled { event_id });
            }
            return Err(PresenterError::UnknownBattleEvent { event_id });
        }

        self.battle_settled.insert(key, outcome.clone());
        self.battle_tombstones.insert((endpoint, event_id.clone()));
        Ok(vec![BattlePresentationCompletion { event_id, outcome }])
    }

    fn pending_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        self.pending
            .iter()
            .filter_map(|((key_endpoint, event_id), _)| {
                (*key_endpoint == endpoint).then_some(*event_id)
            })
            .collect()
    }

    fn settled_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        self.settled
            .keys()
            .filter_map(|(key_endpoint, event_id)| (*key_endpoint == endpoint).then_some(*event_id))
            .collect()
    }

    fn pending_battle_event_ids(&self, endpoint: SeatId) -> BTreeSet<BattlePresentationEventId> {
        self.battle_pending
            .iter()
            .filter_map(|((key_endpoint, event_id), _)| {
                (*key_endpoint == endpoint).then_some(event_id.clone())
            })
            .collect()
    }

    fn settled_battle_event_ids(&self, endpoint: SeatId) -> BTreeSet<BattlePresentationEventId> {
        self.battle_settled
            .keys()
            .filter_map(|(key_endpoint, event_id)| {
                (*key_endpoint == endpoint).then_some(event_id.clone())
            })
            .collect()
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: self.pending.keys().map(|(_, event_id)| *event_id).collect(),
            settled_event_ids: self.settled.keys().map(|(_, event_id)| *event_id).collect(),
            disposed: self.disposed,
        }
    }

    fn mode(&self) -> PresenterMode {
        PresenterMode::FaultControlled
    }

    fn export_state(&self) -> Result<PresenterState, PresenterError> {
        FaultPresenter::export_state(self)
    }

    fn dispose(&mut self) {
        self.disposed = true;
        self.pending.clear();
        self.settled.clear();
        self.battle_pending.clear();
        // Match the disposed Battle kernel owner: settled battle outcomes are
        // diagnostic tombstones, not live presentation resources. Retaining
        // them keeps the restorable pair owner graph exact at shared terminal.
    }
}
