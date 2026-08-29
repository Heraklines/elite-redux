//! Mandatory minimized regression-capsule corpus policy and replay.

use er_repro::FailureOracleV1;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::ReproCapsuleIdV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionWaiverV1 {
    pub owner: String,
    pub reason: String,
    pub expiry_day: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionCapsuleEntryV1 {
    pub id: String,
    pub capsule: Option<ReproCapsuleIdV1>,
    pub exact_failure_oracle: Option<FailureOracleV1>,
    pub issue_reference: String,
    pub fixed_commit: String,
    pub expected_fixed_outcome: String,
    pub impact_entry: String,
    pub waiver: Option<RegressionWaiverV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionCapsuleCorpusV1 {
    pub schema_version: u32,
    pub maximum_entries: usize,
    pub entries: Vec<RegressionCapsuleEntryV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionReplayResultV1 {
    pub id: String,
    pub passed: bool,
    pub observed: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionReplayReportV1 {
    pub passed: usize,
    pub failed: usize,
    pub waived: usize,
    pub results: Vec<RegressionReplayResultV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RegressionCorpusErrorV1 {
    #[error("regression corpus entry, order, or bound is invalid")]
    Invalid,
    #[error("bug fix lacks a capsule and active waiver")]
    MissingCapsule,
    #[error("regression replay backend failed: {0}")]
    Backend(String),
}

pub trait RegressionReplayBackendV1: std::fmt::Debug {
    fn replay_fixed(
        &self,
        capsule: &ReproCapsuleIdV1,
        oracle: &FailureOracleV1,
        expected_fixed_outcome: &str,
    ) -> Result<RegressionReplayResultV1, String>;
}

impl RegressionCapsuleCorpusV1 {
    pub fn validate(&self, current_day: u32) -> Result<(), RegressionCorpusErrorV1> {
        if self.schema_version != 1
            || self.maximum_entries == 0
            || self.entries.len() > self.maximum_entries
            || self.entries.windows(2).any(|pair| pair[0].id >= pair[1].id)
        {
            return Err(RegressionCorpusErrorV1::Invalid);
        }
        for entry in &self.entries {
            let common_invalid = entry.id.is_empty()
                || entry.issue_reference.is_empty()
                || entry.expected_fixed_outcome.is_empty()
                || entry.impact_entry.is_empty()
                || !valid_revision(&entry.fixed_commit);
            if common_invalid {
                return Err(RegressionCorpusErrorV1::Invalid);
            }
            match (&entry.capsule, &entry.exact_failure_oracle, &entry.waiver) {
                (Some(capsule), Some(_), None) if !capsule.0.is_empty() => {}
                (None, None, Some(waiver))
                    if !waiver.owner.is_empty()
                        && !waiver.reason.is_empty()
                        && waiver.expiry_day >= current_day => {}
                _ => return Err(RegressionCorpusErrorV1::MissingCapsule),
            }
        }
        Ok(())
    }

    pub fn replay<B: RegressionReplayBackendV1>(
        &self,
        current_day: u32,
        backend: &B,
    ) -> Result<RegressionReplayReportV1, RegressionCorpusErrorV1> {
        self.validate(current_day)?;
        let mut results = Vec::new();
        let mut waived = 0;
        for entry in &self.entries {
            if entry.waiver.is_some() {
                waived += 1;
                continue;
            }
            let mut result = backend
                .replay_fixed(
                    entry
                        .capsule
                        .as_ref()
                        .ok_or(RegressionCorpusErrorV1::MissingCapsule)?,
                    entry
                        .exact_failure_oracle
                        .as_ref()
                        .ok_or(RegressionCorpusErrorV1::MissingCapsule)?,
                    &entry.expected_fixed_outcome,
                )
                .map_err(RegressionCorpusErrorV1::Backend)?;
            result.id = entry.id.clone();
            results.push(result);
        }
        let passed = results.iter().filter(|result| result.passed).count();
        Ok(RegressionReplayReportV1 {
            passed,
            failed: results.len() - passed,
            waived,
            results,
        })
    }
}

fn valid_revision(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
