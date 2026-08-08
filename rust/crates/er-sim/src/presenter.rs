//! Deterministic presentation adapters isolated from protocol truth.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

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
}

pub trait Presenter: fmt::Debug {
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

    fn pending_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId>;

    fn settled_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId>;

    fn diagnostics_for(&self, endpoint: SeatId) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: self.pending_event_ids(endpoint),
            settled_event_ids: self.settled_event_ids(endpoint),
            disposed: self.diagnostics().disposed,
        }
    }

    fn diagnostics(&self) -> PresenterDiagnostics;

    fn dispose(&mut self);
}

#[derive(Debug, Default)]
pub struct InstantPresenter {
    settled: BTreeMap<(SeatId, PresentationEventId), PresentationOutcome>,
    disposed: bool,
}

impl InstantPresenter {
    pub fn new() -> Self {
        Self::default()
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

    fn pending_event_ids(&self, _endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        BTreeSet::new()
    }

    fn settled_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        self.settled
            .keys()
            .filter_map(|(key_endpoint, event_id)| {
                (*key_endpoint == endpoint).then_some(*event_id)
            })
            .collect()
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: BTreeSet::new(),
            settled_event_ids: self
                .settled
                .keys()
                .map(|(_, event_id)| *event_id)
                .collect(),
            disposed: self.disposed,
        }
    }

    fn dispose(&mut self) {
        self.disposed = true;
        self.settled.clear();
    }
}

#[derive(Debug, Default)]
pub struct FaultPresenter {
    pending: BTreeSet<(SeatId, PresentationEventId)>,
    settled: BTreeMap<(SeatId, PresentationEventId), PresentationOutcome>,
    disposed: bool,
}

impl FaultPresenter {
    pub fn new() -> Self {
        Self::default()
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

        self.pending.insert(key);
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
        if !self.pending.remove(&key) {
            if self.settled.contains_key(&key) {
                return Err(PresenterError::AlreadySettled { event_id });
            }
            return Err(PresenterError::UnknownEvent { event_id });
        }

        self.settled.insert(key, outcome.clone());
        Ok(vec![PresentationCompletion { event_id, outcome }])
    }

    fn pending_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        self.pending
            .iter()
            .filter_map(|(key_endpoint, event_id)| {
                (*key_endpoint == endpoint).then_some(*event_id)
            })
            .collect()
    }

    fn settled_event_ids(&self, endpoint: SeatId) -> BTreeSet<PresentationEventId> {
        self.settled
            .keys()
            .filter_map(|(key_endpoint, event_id)| {
                (*key_endpoint == endpoint).then_some(*event_id)
            })
            .collect()
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: self
                .pending
                .iter()
                .map(|(_, event_id)| *event_id)
                .collect(),
            settled_event_ids: self
                .settled
                .keys()
                .map(|(_, event_id)| *event_id)
                .collect(),
            disposed: self.disposed,
        }
    }

    fn dispose(&mut self) {
        self.disposed = true;
        self.pending.clear();
        self.settled.clear();
    }
}
