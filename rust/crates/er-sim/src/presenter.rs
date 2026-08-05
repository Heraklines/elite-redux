//! Deterministic presentation adapters isolated from protocol truth.

use std::collections::BTreeSet;
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
    _contract: (),
}

impl InstantPresenter {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Presenter for InstantPresenter {
    fn present(
        &mut self,
        _event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        Err(PresenterError::Disposed)
    }

    fn settle(
        &mut self,
        event_id: PresentationEventId,
        _outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        Err(PresenterError::UnknownEvent { event_id })
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics::default()
    }

    fn dispose(&mut self) {}
}

#[derive(Debug, Default)]
pub struct FaultPresenter {
    _contract: (),
}

impl FaultPresenter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn duplicate_completion(
        &mut self,
        event_id: PresentationEventId,
    ) -> Result<PresentationCompletion, PresenterError> {
        Err(PresenterError::UnknownEvent { event_id })
    }
}

impl Presenter for FaultPresenter {
    fn present(
        &mut self,
        _event: PresentationEvent,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        Err(PresenterError::Disposed)
    }

    fn settle(
        &mut self,
        event_id: PresentationEventId,
        _outcome: PresentationOutcome,
    ) -> Result<Vec<PresentationCompletion>, PresenterError> {
        Err(PresenterError::UnknownEvent { event_id })
    }

    fn diagnostics(&self) -> PresenterDiagnostics {
        PresenterDiagnostics::default()
    }

    fn dispose(&mut self) {}
}
