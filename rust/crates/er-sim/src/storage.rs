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
    fn execute(
        &mut self,
        request: StorageRequest,
    ) -> Result<StorageResult, StorageAdapterError>;

    fn apply_recovery_atomically(
        &mut self,
        updates: BTreeMap<String, Value>,
    ) -> Result<(), StorageAdapterError>;

    fn diagnostics(&self) -> StorageDiagnostics;

    fn dispose(&mut self);
}

#[derive(Debug, Default)]
pub struct MemoryStorage {
    _contract: (),
}

impl MemoryStorage {
    pub fn new(_initial: BTreeMap<String, Value>) -> Self {
        Self::default()
    }

    pub fn value(&self, _key: &str) -> Option<&Value> {
        None
    }
}

impl StorageAdapter for MemoryStorage {
    fn execute(
        &mut self,
        _request: StorageRequest,
    ) -> Result<StorageResult, StorageAdapterError> {
        Err(StorageAdapterError::Disposed)
    }

    fn apply_recovery_atomically(
        &mut self,
        _updates: BTreeMap<String, Value>,
    ) -> Result<(), StorageAdapterError> {
        Err(StorageAdapterError::Disposed)
    }

    fn diagnostics(&self) -> StorageDiagnostics {
        StorageDiagnostics::default()
    }

    fn dispose(&mut self) {
    }
}
