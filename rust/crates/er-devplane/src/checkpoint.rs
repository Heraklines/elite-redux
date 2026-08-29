//! Byte-bounded deterministic checkpoint retention.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointEntryV1 {
    pub checkpoint_id: String,
    pub sequence: u64,
    pub virtual_time_ms: u64,
    pub snapshot_digest: String,
    pub snapshot_bytes: Vec<u8>,
    pub pinned: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CheckpointStoreV1 {
    entries: VecDeque<CheckpointEntryV1>,
    retained_bytes: usize,
    maximum_bytes: usize,
    maximum_entries: usize,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CheckpointErrorV1 {
    #[error("checkpoint store bound or identity is invalid")]
    Invalid,
    #[error("checkpoint store cannot evict a legal entry")]
    Capacity,
    #[error("checkpoint does not exist")]
    Missing,
}

impl CheckpointStoreV1 {
    pub fn new(maximum_bytes: usize, maximum_entries: usize) -> Result<Self, CheckpointErrorV1> {
        if maximum_bytes == 0 || maximum_entries == 0 {
            return Err(CheckpointErrorV1::Invalid);
        }
        Ok(Self {
            entries: VecDeque::new(),
            retained_bytes: 0,
            maximum_bytes,
            maximum_entries,
        })
    }

    pub fn insert(&mut self, entry: CheckpointEntryV1) -> Result<(), CheckpointErrorV1> {
        if entry.checkpoint_id.is_empty()
            || entry.snapshot_digest.is_empty()
            || entry.snapshot_bytes.is_empty()
            || entry.snapshot_bytes.len() > self.maximum_bytes
            || self
                .entries
                .iter()
                .any(|current| current.checkpoint_id == entry.checkpoint_id)
        {
            return Err(CheckpointErrorV1::Invalid);
        }
        while self.entries.len() >= self.maximum_entries
            || self
                .retained_bytes
                .checked_add(entry.snapshot_bytes.len())
                .is_none_or(|bytes| bytes > self.maximum_bytes)
        {
            let index = self
                .entries
                .iter()
                .position(|candidate| !candidate.pinned)
                .ok_or(CheckpointErrorV1::Capacity)?;
            let removed = self
                .entries
                .remove(index)
                .ok_or(CheckpointErrorV1::Capacity)?;
            self.retained_bytes = self
                .retained_bytes
                .checked_sub(removed.snapshot_bytes.len())
                .ok_or(CheckpointErrorV1::Invalid)?;
        }
        self.retained_bytes = self
            .retained_bytes
            .checked_add(entry.snapshot_bytes.len())
            .ok_or(CheckpointErrorV1::Capacity)?;
        self.entries.push_back(entry);
        Ok(())
    }

    pub fn nearest_at_or_before(&self, sequence: u64) -> Option<&CheckpointEntryV1> {
        self.entries
            .iter()
            .filter(|entry| entry.sequence <= sequence)
            .max_by_key(|entry| entry.sequence)
    }

    pub fn get(&self, checkpoint_id: &str) -> Result<&CheckpointEntryV1, CheckpointErrorV1> {
        self.entries
            .iter()
            .find(|entry| entry.checkpoint_id == checkpoint_id)
            .ok_or(CheckpointErrorV1::Missing)
    }

    pub fn retained_bytes(&self) -> usize {
        self.retained_bytes
    }

    pub fn entries(&self) -> &VecDeque<CheckpointEntryV1> {
        &self.entries
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.retained_bytes = 0;
    }
}
