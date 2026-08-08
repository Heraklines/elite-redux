//! Deterministic in-memory storage with atomic recovery writes.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use er_types::{SafeU53, StorageRequest, StorageResult};
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

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum StorageAdapterError {
    #[error("storage adapter is disposed")]
    Disposed,
    #[error("storage request {request_id} is already pending")]
    DuplicateRequest { request_id: SafeU53 },
    #[error("atomic recovery write was rejected: {reason}")]
    AtomicWriteRejected { reason: String },
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

#[derive(Debug, Default)]
pub struct MemoryStorage {
    values: BTreeMap<String, Value>,
    pending_request_ids: BTreeSet<SafeU53>,
    next_atomic_write_rejection: Option<String>,
    disposed: bool,
}

impl MemoryStorage {
    pub fn new(initial: BTreeMap<String, Value>) -> Self {
        Self {
            values: initial,
            pending_request_ids: BTreeSet::new(),
            next_atomic_write_rejection: None,
            disposed: false,
        }
    }

    pub fn value(&self, key: &str) -> Option<&Value> {
        self.values.get(key)
    }

    /// Reject exactly the next atomic recovery write with a deterministic fault.
    pub fn reject_next_atomic_write(&mut self) {
        self.next_atomic_write_rejection = Some("injected atomic write rejection".to_owned());
    }

    /// Reject exactly the next atomic recovery write with a caller-supplied reason.
    pub fn reject_next_atomic_write_with_reason(&mut self, reason: impl Into<String>) {
        self.next_atomic_write_rejection = Some(reason.into());
    }
}

impl StorageAdapter for MemoryStorage {
    fn execute(&mut self, request: StorageRequest) -> Result<StorageResult, StorageAdapterError> {
        if self.disposed {
            return Err(StorageAdapterError::Disposed);
        }
        let StorageRequest {
            request_id,
            key,
            value,
        } = request;
        if self.pending_request_ids.contains(&request_id) {
            return Err(StorageAdapterError::DuplicateRequest { request_id });
        }
        self.pending_request_ids.insert(request_id);

        let result = match value {
            Some(value) => {
                self.values.insert(key, value);
                StorageResult::Persisted
            }
            None => StorageResult::Loaded {
                value: self.values.get(&key).cloned(),
            },
        };

        self.pending_request_ids.remove(&request_id);
        Ok(result)
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
            pending_request_ids: self.pending_request_ids.clone(),
            disposed: self.disposed,
        }
    }

    fn dispose(&mut self) {
        self.values.clear();
        self.pending_request_ids.clear();
        self.next_atomic_write_rejection = None;
        self.disposed = true;
    }
}
