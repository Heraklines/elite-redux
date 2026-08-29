//! Bounded, content-addressed regression-corpus manifest.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::FailureOracleV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionCorpusEntryV1 {
    pub capsule_digest: String,
    pub capsule_size: u64,
    pub failure_oracle: FailureOracleV1,
    pub labels: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionCorpusV1 {
    pub schema_version: u32,
    pub maximum_entries: usize,
    pub maximum_capsule_bytes: u64,
    pub entries: Vec<RegressionCorpusEntryV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RegressionCorpusErrorV1 {
    #[error("regression corpus bound is zero or exceeded")]
    Bounds,
    #[error("regression corpus entry is invalid")]
    Entry,
    #[error("regression corpus contains a duplicate capsule digest")]
    Duplicate,
}

impl RegressionCorpusV1 {
    pub fn new(
        maximum_entries: usize,
        maximum_capsule_bytes: u64,
    ) -> Result<Self, RegressionCorpusErrorV1> {
        if maximum_entries == 0 || maximum_capsule_bytes == 0 {
            return Err(RegressionCorpusErrorV1::Bounds);
        }
        Ok(Self {
            schema_version: 1,
            maximum_entries,
            maximum_capsule_bytes,
            entries: Vec::new(),
        })
    }

    pub fn insert(
        &mut self,
        mut entry: RegressionCorpusEntryV1,
    ) -> Result<(), RegressionCorpusErrorV1> {
        if self.schema_version != 1 || self.maximum_entries == 0 || self.maximum_capsule_bytes == 0
        {
            return Err(RegressionCorpusErrorV1::Bounds);
        }
        if entry.capsule_digest.is_empty()
            || entry.capsule_size == 0
            || entry.capsule_size > self.maximum_capsule_bytes
            || entry.labels.iter().any(String::is_empty)
        {
            return Err(RegressionCorpusErrorV1::Entry);
        }
        entry.labels.sort();
        entry.labels.dedup();
        match self
            .entries
            .binary_search_by(|existing| existing.capsule_digest.cmp(&entry.capsule_digest))
        {
            Ok(_) => Err(RegressionCorpusErrorV1::Duplicate),
            Err(index) => {
                if self.entries.len() == self.maximum_entries {
                    return Err(RegressionCorpusErrorV1::Bounds);
                }
                self.entries.insert(index, entry);
                Ok(())
            }
        }
    }

    pub fn validate(&self) -> Result<(), RegressionCorpusErrorV1> {
        if self.schema_version != 1
            || self.maximum_entries == 0
            || self.maximum_capsule_bytes == 0
            || self.entries.len() > self.maximum_entries
        {
            return Err(RegressionCorpusErrorV1::Bounds);
        }
        if self.entries.iter().any(|entry| {
            entry.capsule_digest.is_empty()
                || entry.capsule_size == 0
                || entry.capsule_size > self.maximum_capsule_bytes
                || entry.labels.iter().any(String::is_empty)
                || entry.labels.windows(2).any(|pair| pair[0] >= pair[1])
        }) {
            return Err(RegressionCorpusErrorV1::Entry);
        }
        if self
            .entries
            .windows(2)
            .any(|pair| pair[0].capsule_digest >= pair[1].capsule_digest)
        {
            return Err(RegressionCorpusErrorV1::Duplicate);
        }
        Ok(())
    }
}
