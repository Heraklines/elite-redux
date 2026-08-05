//! Deterministic presentation adapters isolated from protocol truth.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use er_types::{PresentationEvent, PresentationEventId, PresentationOutcome};
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
        event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError>;

    fn settle(
        &mut self,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError>;

    fn diagnostics(&self) -> PresenterDiagnostics;

    fn dispose(&mut self);
}

#[derive(Debug, Default)]
pub struct InstantPresenter {
    settled: BTreeMap<PresentationEventId, PresentationOutcome>,
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
        event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        if self.settled.contains_key(&event.event_id) {
            return Err(PresenterError::AlreadySettled {
                event_id: event.event_id,
            });
        }

        let outcome = PresentationOutcome::Settled;
        self.settled.insert(event.event_id, outcome.clone());
        Ok(vec![PresentationCompletion {
            event_id: event.event_id,
            outcome,
        }])
    }

    fn settle(
        &mut self,
        event_id: PresentationEventId,
        _outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        if self.settled.contains_key(&event_id) {
            return Err(PresenterError::AlreadySettled { event_id });
        }
        Err(PresenterError::UnknownEvent { event_id })
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: BTreeSet::new(),
            settled_event_ids: self.settled.keys().copied().collect(),
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
    pending: BTreeSet<PresentationEventId>,
    settled: BTreeMap<PresentationEventId, PresentationOutcome>,
    disposed: bool,
}

impl FaultPresenter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn duplicate_completion(
        &mut self,
        event_id: PresentationEventId,
    ) -> Result<PresentationCompletion, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        self.settled
            .get(&event_id)
            .cloned()
            .map(|outcome| PresentationCompletion { event_id, outcome })
            .ok_or(PresenterError::UnknownEvent { event_id })
    }
}

impl Presenter for FaultPresenter {
    fn present(
        &mut self,
        event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        if self.settled.contains_key(&event.event_id) {
            return Err(PresenterError::AlreadySettled {
                event_id: event.event_id,
            });
        }

        self.pending.insert(event.event_id);
        Ok(Vec::new())
    }

    fn settle(
        &mut self,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        if self.disposed {
            return Err(PresenterError::Disposed);
        }
        if !self.pending.remove(&event_id) {
            if self.settled.contains_key(&event_id) {
                return Err(PresenterError::AlreadySettled { event_id });
            }
            return Err(PresenterError::UnknownEvent { event_id });
        }

        self.settled.insert(event_id, outcome.clone());
        Ok(vec![PresentationCompletion { event_id, outcome }])
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics {
            pending_event_ids: self.pending.clone(),
            settled_event_ids: self.settled.keys().copied().collect(),
            disposed: self.disposed,
        }
    }

    fn dispose(&mut self) {
        self.disposed = true;
        self.pending.clear();
        self.settled.clear();
    }
}
