//! Deterministic in-memory storage with atomic recovery writes.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use er_types::{SafeU53, SeatId, StorageRequest, StorageResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDiagnostics {
    pub keys: BTreeSet<String>,
    pub pending_request_ids: BTreeSet<SafeU53>,
    pub disposed: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StorageValueState {
    pub key: String,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StoragePendingRequestState {
    pub endpoint: SeatId,
    pub request: StorageRequest,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MemoryStorageState {
    /// None means the SafeU53 request-ID allocator is exhausted.
    pub next_request_id: Option<SafeU53>,
    pub values: Vec<StorageValueState>,
    pub pending_requests: Vec<StoragePendingRequestState>,
    pub one_shot_fault: Option<String>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum StorageAdapterError {
    #[error("storage adapter is disposed")]
    Disposed,
    #[error("storage request {request_id} is already pending")]
    DuplicateRequest { request_id: SafeU53 },
    #[error("storage request {request_id} is not pending for endpoint {endpoint}")]
    UnknownRequest {
        endpoint: SeatId,
        request_id: SafeU53,
    },
    #[error("storage result for request {request_id} is invalid: {reason}")]
    ResultMismatch {
        endpoint: SeatId,
        request_id: SafeU53,
        reason: String,
    },
    #[error("atomic recovery write was rejected: {reason}")]
    AtomicWriteRejected { reason: String },
    #[error("storage request id space is exhausted")]
    RequestIdExhausted,
    #[error("storage state is invalid: {reason}")]
    InvalidState { reason: String },
}

pub trait StorageAdapter: fmt::Debug {
    fn execute(&mut self, request: StorageRequest) -> Result<StorageResult, StorageAdapterError>;

    fn apply_recovery_atomically(
        &mut self,
        updates: BTreeMap<String, Value>,
    ) -> Result<(), StorageAdapterError>;

    fn diagnostics(&self) -> StorageDiagnostics;

    fn dispose(&mut self);
}

#[derive(Debug)]
pub struct MemoryStorage {
    values: BTreeMap<String, Value>,
    pending_requests: BTreeMap<(SeatId, SafeU53), StorageRequest>,
    next_request_id: Option<SafeU53>,
    next_atomic_write_rejection: Option<String>,
    disposed: bool,
}

impl Default for MemoryStorage {
    fn default() -> Self {
        Self::new(BTreeMap::new())
    }
}

impl MemoryStorage {
    pub fn new(initial: BTreeMap<String, Value>) -> Self {
        Self {
            values: initial,
            pending_requests: BTreeMap::new(),
            next_request_id: Some(SafeU53::ZERO),
            next_atomic_write_rejection: None,
            disposed: false,
        }
    }

    pub fn value(&self, key: &str) -> Option<&Value> {
        self.values.get(key)
    }

    pub fn export_state(&self) -> MemoryStorageState {
        MemoryStorageState {
            next_request_id: self.next_request_id,
            values: self
                .values
                .iter()
                .map(|(key, value)| StorageValueState {
                    key: key.clone(),
                    value: value.clone(),
                })
                .collect(),
            pending_requests: self
                .pending_requests
                .iter()
                .map(|((endpoint, _), request)| StoragePendingRequestState {
                    endpoint: *endpoint,
                    request: request.clone(),
                })
                .collect(),
            one_shot_fault: self.next_atomic_write_rejection.clone(),
            disposed: self.disposed,
        }
    }

    pub fn restorable_state(&self) -> MemoryStorageState {
        self.export_state()
    }

    pub fn from_state(state: MemoryStorageState) -> Result<Self, StorageAdapterError> {
        state.validate()?;
        let values = state
            .values
            .into_iter()
            .map(|value| (value.key, value.value))
            .collect();
        let pending_requests = state
            .pending_requests
            .into_iter()
            .map(|pending| {
                (
                    (pending.endpoint, pending.request.request_id),
                    pending.request,
                )
            })
            .collect();
        Ok(Self {
            values,
            pending_requests,
            next_request_id: state.next_request_id,
            next_atomic_write_rejection: state.one_shot_fault,
            disposed: state.disposed,
        })
    }

    pub fn from_restorable_state(state: MemoryStorageState) -> Result<Self, StorageAdapterError> {
        Self::from_state(state)
    }

    pub fn restore_state(&mut self, state: MemoryStorageState) -> Result<(), StorageAdapterError> {
        let restored = Self::from_state(state)?;
        *self = restored;
        Ok(())
    }

    pub fn next_request_id(&self) -> Option<SafeU53> {
        self.next_request_id
    }

    /// Allocate and retain an owner-qualified request for later settlement.
    pub fn allocate_request(
        &mut self,
        key: impl Into<String>,
        value: Option<Value>,
    ) -> Result<StorageRequest, StorageAdapterError> {
        self.allocate_request_for(SeatId::ZERO, key, value)
    }

    pub fn allocate_request_for(
        &mut self,
        endpoint: SeatId,
        key: impl Into<String>,
        value: Option<Value>,
    ) -> Result<StorageRequest, StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        let request_id = self
            .next_request_id
            .ok_or(StorageAdapterError::RequestIdExhausted)?;
        let request = StorageRequest {
            request_id,
            key: key.into(),
            value,
        };
        self.register_pending_request(endpoint, request.clone())?;
        Ok(request)
    }

    pub fn register_pending_request(
        &mut self,
        endpoint: SeatId,
        request: StorageRequest,
    ) -> Result<(), StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        let key = (endpoint, request.request_id);
        if self.pending_requests.contains_key(&key) {
            return Err(StorageAdapterError::DuplicateRequest {
                request_id: request.request_id,
            });
        }
        if self.next_request_id.is_none() {
            return Err(StorageAdapterError::RequestIdExhausted);
        }
        self.observe_request_id(request.request_id)?;
        self.pending_requests.insert(key, request);
        Ok(())
    }

    pub fn pending_request(
        &self,
        endpoint: SeatId,
        request_id: SafeU53,
    ) -> Option<&StorageRequest> {
        self.pending_requests.get(&(endpoint, request_id))
    }

    pub fn validate_pending_result(
        &self,
        endpoint: SeatId,
        request_id: SafeU53,
        result: &StorageResult,
    ) -> Result<(), StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        let request = self.pending_request(endpoint, request_id).ok_or(
            StorageAdapterError::UnknownRequest {
                endpoint,
                request_id,
            },
        )?;
        match (&request.value, result) {
            (_, StorageResult::Failed { reason }) if reason.is_empty() => {
                Err(StorageAdapterError::ResultMismatch {
                    endpoint,
                    request_id,
                    reason: "failure reason must not be empty".to_owned(),
                })
            }
            (None, StorageResult::Loaded { .. })
            | (Some(_), StorageResult::Persisted)
            | (_, StorageResult::Failed { .. }) => Ok(()),
            (None, StorageResult::Persisted) => Err(StorageAdapterError::ResultMismatch {
                endpoint,
                request_id,
                reason: "a load request requires Loaded or Failed".to_owned(),
            }),
            (Some(_), StorageResult::Loaded { .. }) => Err(StorageAdapterError::ResultMismatch {
                endpoint,
                request_id,
                reason: "a persist request requires Persisted or Failed".to_owned(),
            }),
        }
    }

    pub fn take_pending_request(
        &mut self,
        endpoint: SeatId,
        request_id: SafeU53,
    ) -> Result<StorageRequest, StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        self.pending_requests.remove(&(endpoint, request_id)).ok_or(
            StorageAdapterError::UnknownRequest {
                endpoint,
                request_id,
            },
        )
    }

    /// Validate and settle one exact restored request. All validation and the
    /// value-map write are staged before removing the pending request, so any
    /// error leaves both owner maps unchanged.
    pub fn settle_pending_request(
        &mut self,
        endpoint: SeatId,
        request_id: SafeU53,
        result: StorageResult,
    ) -> Result<(), StorageAdapterError> {
        self.validate_pending_result(endpoint, request_id, &result)?;
        let request = self.pending_request(endpoint, request_id).cloned().ok_or(
            StorageAdapterError::UnknownRequest {
                endpoint,
                request_id,
            },
        )?;
        let mut values = self.values.clone();
        if let StorageResult::Persisted = result {
            let Some(value) = request.value.clone() else {
                return Err(StorageAdapterError::ResultMismatch {
                    endpoint,
                    request_id,
                    reason: "persisted result has no pending value".to_owned(),
                });
            };
            values.insert(request.key, value);
        }
        self.values = values;
        self.pending_requests.remove(&(endpoint, request_id));
        Ok(())
    }

    /// The public adapter is synchronous: an exported live owner must never
    /// expose an in-flight request. Restored neutral states may retain a
    /// request for exact continuation, but pair boundaries can assert this
    /// invariant before mapping to the frozen DTO.
    pub fn validate_synchronous_boundary(&self) -> Result<(), StorageAdapterError> {
        if self.pending_requests.is_empty() {
            Ok(())
        } else {
            Err(StorageAdapterError::InvalidState {
                reason: "synchronous storage boundary cannot retain pending requests".to_owned(),
            })
        }
    }

    /// Reject exactly the next atomic recovery write with a deterministic fault.
    pub fn reject_next_atomic_write(&mut self) {
        self.next_atomic_write_rejection = Some("injected atomic write rejection".to_owned());
    }

    /// Reject exactly the next atomic recovery write with a caller-supplied reason.
    pub fn reject_next_atomic_write_with_reason(&mut self, reason: impl Into<String>) {
        self.next_atomic_write_rejection = Some(reason.into());
    }

    fn observe_request_id(&mut self, request_id: SafeU53) -> Result<(), StorageAdapterError> {
        let Some(next_request_id) = self.next_request_id else {
            return Err(StorageAdapterError::RequestIdExhausted);
        };
        if request_id < next_request_id {
            return Ok(());
        }
        self.next_request_id = if request_id == SafeU53::MAX {
            None
        } else {
            Some(
                SafeU53::new(request_id.get() + 1)
                    .map_err(|_| StorageAdapterError::RequestIdExhausted)?,
            )
        };
        Ok(())
    }

    /// Execute an immediate request for a specific endpoint while respecting
    /// any restored request with the same owner-qualified identity.
    pub fn execute_for(
        &mut self,
        endpoint: SeatId,
        request: StorageRequest,
    ) -> Result<StorageResult, StorageAdapterError> {
        self.execute_immediate(Some(endpoint), request)
    }

    fn execute_immediate(
        &mut self,
        endpoint: Option<SeatId>,
        request: StorageRequest,
    ) -> Result<StorageResult, StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        let StorageRequest {
            request_id,
            key,
            value,
        } = request;
        let duplicate = match endpoint {
            Some(endpoint) => self.pending_requests.contains_key(&(endpoint, request_id)),
            None => self
                .pending_requests
                .keys()
                .any(|(_, pending_request_id)| *pending_request_id == request_id),
        };
        if duplicate {
            return Err(StorageAdapterError::DuplicateRequest { request_id });
        }

        let mut staged = self.values.clone();
        let result = match value {
            Some(value) => {
                staged.insert(key, value);
                StorageResult::Persisted
            }
            None => StorageResult::Loaded {
                value: staged.get(&key).cloned(),
            },
        };
        self.values = staged;
        Ok(result)
    }
}

impl MemoryStorageState {
    pub fn validate(&self) -> Result<(), StorageAdapterError> {
        if self
            .values
            .windows(2)
            .any(|pair| pair[0].key >= pair[1].key)
        {
            return Err(StorageAdapterError::InvalidState {
                reason: "storage values must be strictly sorted and unique by key".to_owned(),
            });
        }
        if self.pending_requests.windows(2).any(|pair| {
            (pair[0].endpoint, pair[0].request.request_id)
                >= (pair[1].endpoint, pair[1].request.request_id)
        }) {
            return Err(StorageAdapterError::InvalidState {
                reason:
                    "pending requests must be strictly sorted and unique by endpoint and request ID"
                        .to_owned(),
            });
        }
        if let Some(next_request_id) = self.next_request_id
            && self
                .pending_requests
                .iter()
                .any(|pending| pending.request.request_id >= next_request_id)
        {
            return Err(StorageAdapterError::InvalidState {
                reason: "request allocator must be above every pending request ID".to_owned(),
            });
        }
        if let Some(reason) = &self.one_shot_fault
            && reason.is_empty()
        {
            return Err(StorageAdapterError::InvalidState {
                reason: "one-shot fault reason must not be empty".to_owned(),
            });
        }
        if self.disposed
            && (!self.values.is_empty()
                || !self.pending_requests.is_empty()
                || self.one_shot_fault.is_some())
        {
            return Err(StorageAdapterError::InvalidState {
                reason: "disposed storage cannot retain values, requests, or a one-shot fault"
                    .to_owned(),
            });
        }
        Ok(())
    }
}

impl StorageAdapter for MemoryStorage {
    fn execute(&mut self, request: StorageRequest) -> Result<StorageResult, StorageAdapterError> {
        self.execute_immediate(None, request)
    }

    fn apply_recovery_atomically(
        &mut self,
        updates: BTreeMap<String, Value>,
    ) -> Result<(), StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        if let Some(reason) = self.next_atomic_write_rejection.take() {
            return Err(StorageAdapterError::AtomicWriteRejected { reason });
        }

        let mut staged = self.values.clone();
        for (key, value) in updates {
            staged.insert(key, value);
        }
        self.values = staged;
        Ok(())
    }

    fn diagnostics(&self) -> StorageDiagnostics {
        StorageDiagnostics {
            keys: self.values.keys().cloned().collect(),
            pending_request_ids: self
                .pending_requests
                .keys()
                .map(|(_, request_id)| *request_id)
                .collect(),
            disposed: self.disposed,
        }
    }

    fn dispose(&mut self) {
        self.values.clear();
        self.pending_requests.clear();
        self.next_atomic_write_rejection = None;
        self.disposed = true;
    }
}
