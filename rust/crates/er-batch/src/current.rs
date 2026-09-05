//! Ordered, atomic batches over the current typed session and shared V2 content.
//!
//! Effects are returned in caller input order. This layer never settles platform
//! requests, delivers effects, or reorders operations by environment identity.

use std::collections::{BTreeMap, btree_map::Entry};
use std::io::{self, Write};
use std::sync::Arc;

use er_env::current::{
    CurrentExternalEvent, CurrentGameObservation, CurrentGameSession, CurrentSessionError,
};
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::GameKernelStepV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const CURRENT_BATCH_MAXIMUM_ENVIRONMENTS: usize = 256;
pub const CURRENT_BATCH_MAXIMUM_EVENTS: usize = 4096;
pub const CURRENT_BATCH_MAXIMUM_RESULT_BYTES: usize = 16 << 20;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CurrentBatchEnvironmentId(pub SafeU53);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBatchLimits {
    pub maximum_environments: usize,
    /// Per call, not a lifetime event count.
    pub maximum_events: usize,
    /// Complete JSON result array, including delimiters. Adapters must also
    /// bound their complete response envelope in the completion callback.
    pub maximum_result_bytes: usize,
}

impl Default for CurrentBatchLimits {
    fn default() -> Self {
        Self {
            maximum_environments: CURRENT_BATCH_MAXIMUM_ENVIRONMENTS,
            maximum_events: 256,
            maximum_result_bytes: 4 << 20,
        }
    }
}

impl CurrentBatchLimits {
    fn validate(self) -> Result<(), CurrentBatchError> {
        if !(1..=CURRENT_BATCH_MAXIMUM_ENVIRONMENTS).contains(&self.maximum_environments)
            || !(1..=CURRENT_BATCH_MAXIMUM_EVENTS).contains(&self.maximum_events)
            || !(2..=CURRENT_BATCH_MAXIMUM_RESULT_BYTES).contains(&self.maximum_result_bytes)
        {
            return Err(CurrentBatchError::InvalidLimits);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBatchEvent {
    pub environment: CurrentBatchEnvironmentId,
    pub event: CurrentExternalEvent,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBatchResult {
    pub ordinal: usize,
    pub environment: CurrentBatchEnvironmentId,
    pub step: GameKernelStepV7,
    pub observation: CurrentGameObservation,
}

#[derive(Debug, Error)]
pub enum CurrentBatchError {
    #[error("current batch limits are invalid")]
    InvalidLimits,
    #[error("current batch is disposed")]
    Disposed,
    #[error("current batch environment capacity {maximum} is exhausted")]
    EnvironmentCapacity { maximum: usize },
    #[error("current batch exceeds its per-call event capacity {maximum}")]
    EventCapacity { maximum: usize },
    #[error("current batch results exceed {maximum} JSON bytes")]
    ResultCapacity { maximum: usize },
    #[error("current batch result encoding failed: {0}")]
    Encoding(String),
    #[error("current batch environment {environment:?} already exists")]
    DuplicateEnvironment {
        environment: CurrentBatchEnvironmentId,
    },
    #[error("current batch environment {environment:?} does not exist")]
    MissingEnvironment {
        environment: CurrentBatchEnvironmentId,
    },
    #[error("current batch environment {environment:?} has incompatible content identity")]
    ContentMismatch {
        environment: CurrentBatchEnvironmentId,
    },
    #[error("current batch environment {environment:?} failed: {source}")]
    Session {
        environment: CurrentBatchEnvironmentId,
        source: CurrentSessionError,
    },
    #[error("current batch event {ordinal} for {environment:?} failed: {source}")]
    Event {
        ordinal: usize,
        environment: CurrentBatchEnvironmentId,
        source: CurrentSessionError,
    },
}

#[derive(Debug)]
pub struct CurrentBatch {
    content: Arc<PreparedGameContentV2>,
    limits: CurrentBatchLimits,
    entries: BTreeMap<CurrentBatchEnvironmentId, CurrentGameSession>,
    disposed: bool,
}

/// Read-only final candidate passed to aggregate response preparation. Unaffected
/// sessions are borrowed; only sessions named in the event list were forked.
#[derive(Debug)]
pub struct CurrentBatchCandidate<'a> {
    committed: &'a BTreeMap<CurrentBatchEnvironmentId, CurrentGameSession>,
    staged: &'a BTreeMap<CurrentBatchEnvironmentId, CurrentGameSession>,
}

impl CurrentBatchCandidate<'_> {
    pub fn session(
        &self,
        id: CurrentBatchEnvironmentId,
    ) -> Result<&CurrentGameSession, CurrentBatchError> {
        self.staged
            .get(&id)
            .or_else(|| self.committed.get(&id))
            .ok_or(CurrentBatchError::MissingEnvironment { environment: id })
    }

    pub fn snapshot(
        &self,
        id: CurrentBatchEnvironmentId,
    ) -> Result<CoreGameKernelSnapshotV7, CurrentBatchError> {
        self.session(id)?
            .snapshot()
            .map_err(|source| CurrentBatchError::Session {
                environment: id,
                source,
            })
    }

    pub fn observe(
        &self,
        id: CurrentBatchEnvironmentId,
    ) -> Result<CurrentGameObservation, CurrentBatchError> {
        self.session(id)?
            .observe()
            .map_err(|source| CurrentBatchError::Session {
                environment: id,
                source,
            })
    }
}

impl CurrentBatch {
    pub fn new(
        content: Arc<PreparedGameContentV2>,
        limits: CurrentBatchLimits,
    ) -> Result<Self, CurrentBatchError> {
        limits.validate()?;
        Ok(Self {
            content,
            limits,
            entries: BTreeMap::new(),
            disposed: false,
        })
    }

    pub fn from_sessions(
        content: Arc<PreparedGameContentV2>,
        limits: CurrentBatchLimits,
        sessions: Vec<(CurrentBatchEnvironmentId, CurrentGameSession)>,
    ) -> Result<Self, CurrentBatchError> {
        let mut batch = Self::new(content, limits)?;
        if sessions.len() > limits.maximum_environments {
            return Err(CurrentBatchError::EnvironmentCapacity {
                maximum: limits.maximum_environments,
            });
        }
        for (id, session) in sessions {
            batch.insert(id, session)?;
        }
        Ok(batch)
    }

    /// Equal content prepared independently is restored onto this batch's shared
    /// allocation before publication, preserving its actual seat, role and state.
    pub fn insert(
        &mut self,
        id: CurrentBatchEnvironmentId,
        session: CurrentGameSession,
    ) -> Result<(), CurrentBatchError> {
        self.available(id)?;
        if session.content().identity() != self.content.identity() {
            return Err(CurrentBatchError::ContentMismatch { environment: id });
        }
        let failure = |source| CurrentBatchError::Session {
            environment: id,
            source,
        };
        session.validate().map_err(failure)?;
        let session = if Arc::ptr_eq(session.content(), &self.content) {
            session
        } else {
            let (seat, role) = session.session_context().map_err(failure)?;
            CurrentGameSession::from_snapshot(
                session.snapshot().map_err(failure)?,
                seat,
                role,
                Arc::clone(&self.content),
            )
            .map_err(failure)?
        };
        let _ = self.entries.insert(id, session);
        Ok(())
    }

    pub fn session(
        &self,
        id: CurrentBatchEnvironmentId,
    ) -> Result<&CurrentGameSession, CurrentBatchError> {
        self.live()?;
        self.entries
            .get(&id)
            .ok_or(CurrentBatchError::MissingEnvironment { environment: id })
    }

    pub fn snapshot(
        &self,
        id: CurrentBatchEnvironmentId,
    ) -> Result<CoreGameKernelSnapshotV7, CurrentBatchError> {
        self.session(id)?
            .snapshot()
            .map_err(|source| CurrentBatchError::Session {
                environment: id,
                source,
            })
    }

    pub fn observe(
        &self,
        id: CurrentBatchEnvironmentId,
    ) -> Result<CurrentGameObservation, CurrentBatchError> {
        self.session(id)?
            .observe()
            .map_err(|source| CurrentBatchError::Session {
                environment: id,
                source,
            })
    }

    pub fn fork(
        &mut self,
        source: CurrentBatchEnvironmentId,
        destination: CurrentBatchEnvironmentId,
    ) -> Result<(), CurrentBatchError> {
        self.available(destination)?;
        let session =
            self.session(source)?
                .fork()
                .map_err(|source_error| CurrentBatchError::Session {
                    environment: source,
                    source: source_error,
                })?;
        self.insert(destination, session)
    }

    pub fn execute(
        &mut self,
        events: Vec<CurrentBatchEvent>,
    ) -> Result<Vec<CurrentBatchResult>, CurrentBatchError> {
        self.execute_with(events, |_, results| Ok(results))
    }

    /// Apply the complete causal list to private candidates, then prepare the
    /// aggregate adapter response before publishing any candidate. A completion
    /// must only prepare values: externally deliver returned effects after Ok.
    /// Panicking or failing completion also leaves the live batch unchanged.
    pub fn execute_with<R, E>(
        &mut self,
        events: Vec<CurrentBatchEvent>,
        finish: impl FnOnce(&CurrentBatchCandidate<'_>, Vec<CurrentBatchResult>) -> Result<R, E>,
    ) -> Result<R, E>
    where
        E: From<CurrentBatchError>,
    {
        self.live().map_err(E::from)?;
        if events.len() > self.limits.maximum_events {
            return Err(E::from(CurrentBatchError::EventCapacity {
                maximum: self.limits.maximum_events,
            }));
        }
        for operation in &events {
            self.session(operation.environment).map_err(E::from)?;
        }
        let mut staged = BTreeMap::new();
        for operation in &events {
            if let Entry::Vacant(entry) = staged.entry(operation.environment) {
                let session = self
                    .session(operation.environment)
                    .map_err(E::from)?
                    .fork()
                    .map_err(|source| {
                        E::from(CurrentBatchError::Session {
                            environment: operation.environment,
                            source,
                        })
                    })?;
                let _ = entry.insert(session);
            }
        }
        let mut results = Vec::with_capacity(events.len());
        let mut budget = ResultCounter {
            used: 2,
            maximum: self.limits.maximum_result_bytes,
            exceeded: false,
        };
        for (ordinal, operation) in events.into_iter().enumerate() {
            let environment = operation.environment;
            let session = staged
                .get_mut(&environment)
                .ok_or_else(|| E::from(CurrentBatchError::MissingEnvironment { environment }))?;
            let failure = |source| {
                E::from(CurrentBatchError::Event {
                    ordinal,
                    environment,
                    source,
                })
            };
            let step = session.apply(operation.event).map_err(failure)?;
            let observation = session.observe().map_err(failure)?;
            let result = CurrentBatchResult {
                ordinal,
                environment,
                step,
                observation,
            };
            budget.retain(&result, ordinal != 0).map_err(E::from)?;
            results.push(result);
        }
        let candidate = CurrentBatchCandidate {
            committed: &self.entries,
            staged: &staged,
        };
        let response = finish(&candidate, results)?;
        self.entries.extend(staged);
        Ok(response)
    }

    pub fn remove(&mut self, id: CurrentBatchEnvironmentId) -> Result<(), CurrentBatchError> {
        self.live()?;
        let mut session = self
            .entries
            .remove(&id)
            .ok_or(CurrentBatchError::MissingEnvironment { environment: id })?;
        session.dispose();
        Ok(())
    }

    /// Release every mutable session; the shared immutable content remains owned
    /// by this disposed handle until the handle itself is dropped.
    pub fn dispose(&mut self) {
        for session in self.entries.values_mut() {
            session.dispose();
        }
        self.entries.clear();
        self.disposed = true;
    }

    pub fn is_disposed(&self) -> bool {
        self.disposed
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn limits(&self) -> CurrentBatchLimits {
        self.limits
    }
    pub fn content(&self) -> &Arc<PreparedGameContentV2> {
        &self.content
    }
    pub fn environment_ids(&self) -> Vec<CurrentBatchEnvironmentId> {
        self.entries.keys().copied().collect()
    }

    fn live(&self) -> Result<(), CurrentBatchError> {
        if self.disposed {
            return Err(CurrentBatchError::Disposed);
        }
        Ok(())
    }

    fn available(&self, id: CurrentBatchEnvironmentId) -> Result<(), CurrentBatchError> {
        self.live()?;
        if self.entries.contains_key(&id) {
            return Err(CurrentBatchError::DuplicateEnvironment { environment: id });
        }
        if self.entries.len() >= self.limits.maximum_environments {
            return Err(CurrentBatchError::EnvironmentCapacity {
                maximum: self.limits.maximum_environments,
            });
        }
        Ok(())
    }
}

/// Count the exact serialized array without constructing another copy of it.
struct ResultCounter {
    used: usize,
    maximum: usize,
    exceeded: bool,
}

impl ResultCounter {
    fn retain(
        &mut self,
        result: &CurrentBatchResult,
        comma: bool,
    ) -> Result<(), CurrentBatchError> {
        if comma && self.write_all(b",").is_err() {
            return Err(CurrentBatchError::ResultCapacity {
                maximum: self.maximum,
            });
        }
        if let Err(error) = serde_json::to_writer(&mut *self, result) {
            return Err(if self.exceeded {
                CurrentBatchError::ResultCapacity {
                    maximum: self.maximum,
                }
            } else {
                CurrentBatchError::Encoding(error.to_string())
            });
        }
        Ok(())
    }
}

impl Write for ResultCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.maximum.saturating_sub(self.used) {
            self.exceeded = true;
            return Err(io::Error::other("current batch result byte limit"));
        }
        self.used += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
